import { create } from 'zustand';
import { Platform } from 'react-native';
import { asRemoteQuestionBankRepository, questionBankRepository } from './client';
import {
  getConfiguredQuestionBankUrl,
  getSavedQuestionBankUrl,
  installConfiguredQuestionBank,
  saveQuestionBankUrl,
} from './installer';
import {
  copyBankAsLocal,
  createLocalBankPackage,
  deleteLocalBankSource,
  listLocalBankSources,
  loadLocalBankSource,
  saveLocalBankSource,
  type LocalBankSource,
} from './local-banks';
import {
  createBackupZip,
  restoreBackupZip,
  type BackupImportSummary,
} from '../lib/backup';
import type {
  InstallationProgress,
  InstalledBankSummary,
  QuestionBankCatalog,
} from './types';

export type QuestionBankStatus = 'idle' | 'loading' | 'empty' | 'ready';

interface QuestionBankState {
  catalog: QuestionBankCatalog | null;
  status: QuestionBankStatus;
  installing: boolean;
  installProgress: InstallationProgress | null;
  installError: string | null;
  sourceUrl: string;
  /** 本机全部题库（本地 + 线上），Profile 题库管理弹窗使用 */
  banks: InstalledBankSummary[];
  banksLoading: boolean;
  setSourceUrl(value: string): void;
  clearInstallError(): void;
  initialize(): Promise<void>;
  installConfigured(): Promise<boolean>;
  refreshBanks(): Promise<void>;
  /** 新建空本地题库（源文件 + 安装激活），返回 bankId */
  createLocalBank(title: string): Promise<string>;
  /** 把已装题库复制为新的本地可编辑题库（安装并激活），返回副本 bankId */
  copyBank(catalogId: string): Promise<string>;
  /** 保存本地题库源并重建安装；若编辑的不是当前题库，保存后保持原题库激活 */
  saveLocalBank(source: LocalBankSource): Promise<void>;
  deleteLocalBank(bankId: string): Promise<void>;
  switchBank(catalogId: string): Promise<void>;
  /** 从题库记录的下载地址整包重下并原位替换（reuse 同 catalogId），返回题量差异 */
  updateBank(catalogId: string): Promise<{ added: number; removed: number }>;
  /** 把全部本地题库（含图片资产）打包为备份 ZIP，返回分享用路径 */
  exportBackup(): Promise<{ zipPath: string; bankCount: number }>;
  /** 从备份 ZIP 增量导入题库（id 冲突时自动换新 id 加「导入」后缀） */
  importBackup(fileUri: string): Promise<{ imported: BackupImportSummary[] }>;
}

/** Owns the application-level question-bank lifecycle for every screen. */
export const useQuestionBankStore = create<QuestionBankState>((set, get) => ({
  catalog: null,
  status: 'idle',
  installing: false,
  installProgress: null,
  installError: null,
  sourceUrl: getConfiguredQuestionBankUrl() ?? '',
  banks: [],
  banksLoading: false,
  setSourceUrl: (sourceUrl) => set({ sourceUrl }),
  clearInstallError: () => set({ installError: null }),

  initialize: async () => {
    set({ status: 'loading' });
    try {
      const [catalog, savedUrl] = await Promise.all([
        questionBankRepository.getCatalog(),
        getSavedQuestionBankUrl(),
      ]);
      set({
        catalog,
        sourceUrl: savedUrl ?? getConfiguredQuestionBankUrl() ?? '',
        status: catalog ? 'ready' : 'empty',
      });
      await get().refreshBanks();
    } catch (error) {
      set({
        catalog: null,
        status: 'empty',
        installError: error instanceof Error ? error.message : String(error),
      });
    }
  },

  installConfigured: async () => {
    const sourceUrl = get().sourceUrl.trim();
    await saveQuestionBankUrl(sourceUrl);
    set({
      installing: true,
      installError: null,
      installProgress: { completed: 0, total: 1, label: '正在准备完整题库下载' },
    });
    try {
      await installConfiguredQuestionBank(questionBankRepository, (installProgress) => {
        set({ installProgress });
      }, sourceUrl);
      const catalog = await questionBankRepository.getCatalog();
      if (!catalog) throw new Error('题库安装完成，但无法读取本地目录');
      set({ catalog, status: 'ready', installing: false });
      await get().refreshBanks();
      return true;
    } catch (error) {
      set({
        installError: error instanceof Error ? error.message : String(error),
        installing: false,
      });
      return false;
    }
  },

  refreshBanks: async () => {
    set({ banksLoading: true });
    try {
      const banks = await questionBankRepository.listBanks();
      // 线上更新入口：本地源文件里记录了下载地址的库才可在线更新（尽力而为）
      const sourceUrls = new Map<string, string>();
      if (Platform.OS !== 'web') {
        try {
          for (const summary of await listLocalBankSources()) {
            const full = await loadLocalBankSource(summary.bankId);
            if (full?.sourceUrl) sourceUrls.set(full.bankId, full.sourceUrl);
          }
        } catch {
          // 读不到源文件时只是没有更新按钮，不影响列表
        }
      }
      set({
        banks: banks.map((bank) =>
          sourceUrls.has(bank.catalogId) ? { ...bank, sourceUrl: sourceUrls.get(bank.catalogId) } : bank,
        ),
        banksLoading: false,
      });
    } catch {
      set({ banks: [], banksLoading: false });
    }
  },

  createLocalBank: async (title) => {
    assertNativeBankOperations();
    const bank = createLocalBankPackage(title);
    const source: LocalBankSource = { bankId: bank.catalog.id, updatedAt: '', package: bank };
    await saveLocalBankSource(source);
    await runInstall(set, () => questionBankRepository.install(bank));
    await get().refreshBanks();
    return bank.catalog.id;
  },

  copyBank: async (catalogId) => {
    assertNativeBankOperations();
    const exported = await questionBankRepository.exportPackage(catalogId);
    if (!exported) throw new Error(`没有找到题库：${catalogId}`);
    const source = copyBankAsLocal(exported);
    await saveLocalBankSource(source);
    await runInstall(set, () => questionBankRepository.install(source.package));
    // install 只落 markdown；题目图片资产从源库逐题拷贝（方法内部尽力而为）
    await questionBankRepository.copyBankAssets(catalogId, source.bankId);
    await get().refreshBanks();
    return source.bankId;
  },

  saveLocalBank: async (source) => {
    assertNativeBankOperations();
    // 保存前记住当前题库：编辑非激活的题库不应该把它顶成当前使用
    const activeIdBefore = get().catalog?.id ?? null;
    await saveLocalBankSource(source);
    await runInstall(set, () => questionBankRepository.install(source.package));
    if (activeIdBefore && activeIdBefore !== source.bankId) {
      await questionBankRepository.switchBank(activeIdBefore);
    }
    await get().refreshBanks();
  },

  deleteLocalBank: async (bankId) => {
    assertNativeBankOperations();
    await deleteLocalBankSource(bankId);
    await questionBankRepository.deleteBank(bankId);
    await reloadCatalog(set);
    await get().refreshBanks();
  },

  switchBank: async (catalogId) => {
    assertNativeBankOperations();
    await questionBankRepository.switchBank(catalogId);
    await reloadCatalog(set);
    await get().refreshBanks();
  },

  updateBank: async (catalogId) => {
    assertNativeBankOperations();
    const source = await loadLocalBankSource(catalogId);
    if (!source?.sourceUrl) throw new Error('该题库没有记录下载地址，无法在线更新');
    const before = await questionBankRepository.getQuestionIds(catalogId);
    // install 会把更新的库置为激活；更新非当前库后要切回去
    const activeIdBefore = get().catalog?.id ?? null;
    const remote = asRemoteQuestionBankRepository(questionBankRepository);
    if (!remote) throw new Error('当前平台暂不支持在线更新题库');
    set({
      installing: true,
      installError: null,
      installProgress: { completed: 0, total: 1, label: '正在下载题库更新' },
    });
    try {
      const result = await remote.installFromUrl(
        source.sourceUrl,
        (progress) => set({ installProgress: progress }),
        { reuseCatalogId: catalogId },
      );
      if (result.localSource) await saveLocalBankSource(result.localSource);
      if (activeIdBefore && activeIdBefore !== catalogId) {
        await questionBankRepository.switchBank(activeIdBefore);
      }
      await reloadCatalog(set);
      set({ installing: false, installProgress: null });
      await get().refreshBanks();
      const after = await questionBankRepository.getQuestionIds(catalogId);
      const added = after && before ? [...after].filter((id) => !before.has(id)).length : after?.size ?? 0;
      const removed = before && after ? [...before].filter((id) => !after.has(id)).length : 0;
      return { added, removed };
    } catch (error) {
      set({
        installError: error instanceof Error ? error.message : String(error),
        installing: false,
      });
      throw error;
    }
  },

  exportBackup: async () => {
    assertNativeBankOperations();
    const summaries = await listLocalBankSources();
    const sources: LocalBankSource[] = [];
    for (const summary of summaries) {
      const full = await loadLocalBankSource(summary.bankId);
      if (full) sources.push(full);
    }
    const { zipPath, manifest } = await createBackupZip({
      sources,
      stageLocalBankAssets: (root) => questionBankRepository.stageLocalBankAssets(root),
    });
    return { zipPath, bankCount: manifest.banks.length };
  },

  importBackup: async (fileUri) => {
    assertNativeBankOperations();
    const existing = new Set([
      ...(await questionBankRepository.listBanks()).map((bank) => bank.catalogId),
      ...(await listLocalBankSources()).map((bank) => bank.bankId),
    ]);
    const result = await restoreBackupZip({
      zipPath: fileUri,
      existingCatalogIds: existing,
      installBank: async (source) => {
        await saveLocalBankSource(source);
        await runInstall(set, () => questionBankRepository.install(source.package));
      },
      restoreBankAssets: (assetsRoot, sourceCatalogId, targetCatalogId) =>
        questionBankRepository.restoreBankAssets(assetsRoot, sourceCatalogId, targetCatalogId),
    });
    await reloadCatalog(set);
    await get().refreshBanks();
    return result;
  },
}));

type SetQuestionBankState = (partial: Partial<QuestionBankState>) => void;

/** 重建安装题库并刷新 catalog；失败时写 installError 并向上抛出 */
async function runInstall(
  set: SetQuestionBankState,
  perform: () => Promise<unknown>,
): Promise<void> {
  set({ installing: true, installError: null });
  try {
    await perform();
    const catalog = await questionBankRepository.getCatalog();
    if (!catalog) throw new Error('题库保存完成，但无法读取本地目录');
    set({ catalog, status: 'ready', installing: false });
  } catch (error) {
    set({
      installError: error instanceof Error ? error.message : String(error),
      installing: false,
    });
    throw error;
  }
}

async function reloadCatalog(set: SetQuestionBankState): Promise<void> {
  const catalog = await questionBankRepository.getCatalog();
  set({ catalog, status: catalog ? 'ready' : 'empty' });
}

/** 本地题库操作依赖 documentDirectory，Web 预览一律拒绝 */
function assertNativeBankOperations(): void {
  if (Platform.OS === 'web') {
    throw new Error('Web 预览不支持本地题库，请在移动端使用');
  }
}
