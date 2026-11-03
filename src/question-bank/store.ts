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
import { resolveBankUpdate, shouldUpdateBank } from './update';
import type {
  InstallationProgress,
  InstalledBankSummary,
  QuestionBankCatalog,
} from './types';

export type QuestionBankStatus = 'idle' | 'loading' | 'empty' | 'ready';

/** 更新本机已编辑过的下载库时如何处理本地修改 */
export type LocalEditsDecision = 'overwrite' | 'keepCopy';

export interface UpdateBankOptions {
  /** 未给出且题库被本地编辑过时，不下载也不覆盖，返回 needsConfirmation */
  onLocalEdits?: LocalEditsDecision;
}

export interface UpdateBankResult {
  added: number;
  removed: number;
  updated: boolean;
  /** 有新版本但题库被本地编辑过，需调用方确认后带 onLocalEdits 重试 */
  needsConfirmation?: boolean;
  /** keepCopy 时另存的副本 bankId */
  copiedBankId?: string;
}

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
  /**
   * 为本地题库关联在线更新地址。用于找回旧版本（≤ v0.1.1 读源时丢弃 sourceUrl）
   * 编辑保存后丢失的更新入口；关联后视为「已修改」，首次更新前会先征求确认。
   */
  setBankSourceUrl(bankId: string, url: string): Promise<void>;
  switchBank(catalogId: string): Promise<void>;
  /**
   * 仅按发布/包内版本判断是否更新；更新时沿用原 catalogId。
   * 题库被本地编辑过时须给出 onLocalEdits，否则返回 needsConfirmation 且不做任何改动。
   */
  updateBank(catalogId: string, options?: UpdateBankOptions): Promise<UpdateBankResult>;
  /** 把全部本地题库（含图片资产）打包为备份 ZIP，返回分享用路径 */
  exportBackup(): Promise<{ zipPath: string; bankCount: number }>;
  /** 从备份 ZIP 增量导入题库（id 冲突时自动换新 id 加「导入」后缀） */
  importBackup(fileUri: string): Promise<{ imported: BackupImportSummary[] }>;
}

/** Owns the application-level question-bank lifecycle for every screen. */
export const useQuestionBankStore = create<QuestionBankState>((set, get) => {
  async function exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (get().installing) throw new Error('正在处理题库，请稍后再试');
    set({ installing: true, installError: null, installProgress: null });
    try {
      return await operation();
    } catch (error) {
      set({ installError: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      set({ installing: false, installProgress: null });
    }
  }
  return ({
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

  installConfigured: () => exclusive(async () => {
    const sourceUrl = get().sourceUrl.trim();
    set({
      installError: null,
      installProgress: { completed: 0, total: 1, label: '正在准备完整题库下载' },
    });
    try {
      await saveQuestionBankUrl(sourceUrl);
      await installConfiguredQuestionBank(questionBankRepository, (installProgress) => {
        set({ installProgress });
      }, sourceUrl);
      const catalog = await questionBankRepository.getCatalog();
      if (!catalog) throw new Error('题库安装完成，但无法读取本地目录');
      set({ catalog, status: 'ready' });
      await get().refreshBanks();
      return true;
    } catch (error) {
      set({
        installError: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }),

  refreshBanks: async () => {
    set({ banksLoading: true });
    try {
      const banks = await questionBankRepository.listBanks();
      // 线上更新入口：本地源文件里记录了下载地址的库才可在线更新（尽力而为）
      const sourceUrls = new Map<string, { sourceUrl: string; locallyModified: boolean }>();
      if (Platform.OS !== 'web') {
        try {
          for (const summary of await listLocalBankSources()) {
            const full = await loadLocalBankSource(summary.bankId);
            if (full?.sourceUrl) {
              sourceUrls.set(full.bankId, {
                sourceUrl: full.sourceUrl, locallyModified: full.locallyModified === true,
              });
            }
          }
        } catch {
          // 读不到源文件时只是没有更新按钮，不影响列表
        }
      }
      set({
        banks: banks.map((bank) => {
          const remote = sourceUrls.get(bank.catalogId);
          if (!remote) return bank;
          return remote.locallyModified
            ? { ...bank, sourceUrl: remote.sourceUrl, locallyModified: true }
            : { ...bank, sourceUrl: remote.sourceUrl };
        }),
        banksLoading: false,
      });
    } catch {
      set({ banks: [], banksLoading: false });
    }
  },

  createLocalBank: (title) => exclusive(async () => {
    assertNativeBankOperations();
    const bank = createLocalBankPackage(title);
    const source: LocalBankSource = { bankId: bank.catalog.id, updatedAt: '', package: bank };
    await runInstall(set, () => questionBankRepository.install(bank, undefined, {
      beforeCommit: () => saveLocalBankSource(source),
    }));
    await get().refreshBanks();
    return bank.catalog.id;
  }),

  copyBank: (catalogId) => exclusive(async () => {
    assertNativeBankOperations();
    const bankId = await copyBankInstalled(set, catalogId);
    await get().refreshBanks();
    return bankId;
  }),

  saveLocalBank: (source) => exclusive(async () => {
    assertNativeBankOperations();
    // 保存前记住当前题库：编辑非激活的题库不应该把它顶成当前使用
    const activeIdBefore = get().catalog?.id ?? null;
    // 下载库被编辑后标记为已修改：在线更新前需要用户确认，避免整包覆盖丢失编辑
    const persisted: LocalBankSource = source.sourceUrl ? { ...source, locallyModified: true } : source;
    try {
      await runInstall(set, () => questionBankRepository.install(persisted.package, undefined, {
        beforeCommit: () => saveLocalBankSource(persisted),
      }));
    } finally {
      if (activeIdBefore && activeIdBefore !== source.bankId) {
        await questionBankRepository.switchBank(activeIdBefore);
      }
      await reloadCatalog(set);
      await get().refreshBanks();
    }
  }),

  setBankSourceUrl: (bankId, url) => exclusive(async () => {
    assertNativeBankOperations();
    const normalized = url.trim();
    if (!/^https:\/\/[^\s]+$/i.test(normalized)) throw new Error('更新地址需要以 https:// 开头');
    const source = await loadLocalBankSource(bankId);
    if (!source) throw new Error(`没有找到本地题库：${bankId}`);
    // 无法判断丢地址前是否改过题：保守视为已修改，更新时先让用户选择是否覆盖
    await saveLocalBankSource({ ...source, sourceUrl: normalized, locallyModified: true });
    await get().refreshBanks();
  }),

  deleteLocalBank: (bankId) => exclusive(async () => {
    assertNativeBankOperations();
    await questionBankRepository.deleteBank(bankId);
    await deleteLocalBankSource(bankId);
    await reloadCatalog(set);
    await get().refreshBanks();
  }),

  switchBank: (catalogId) => exclusive(async () => {
    assertNativeBankOperations();
    await questionBankRepository.switchBank(catalogId);
    await reloadCatalog(set);
    await get().refreshBanks();
  }),

  updateBank: (catalogId, options) => exclusive(async () => {
    assertNativeBankOperations();
    const source = await loadLocalBankSource(catalogId);
    if (!source?.sourceUrl) throw new Error('该题库没有记录下载地址，无法在线更新');
    const before = await questionBankRepository.getQuestionIds(catalogId);
    // install 会把更新的库置为激活；更新非当前库后要切回去
    const activeIdBefore = get().catalog?.id ?? null;
    const remote = asRemoteQuestionBankRepository(questionBankRepository);
    if (!remote) throw new Error('当前平台暂不支持在线更新题库');
    let copiedBankId: string | undefined;
    // 另存副本会激活副本：副本存在时即使更新的就是当前库，也要切回原库
    const restoreActiveBank = async () => {
      if (activeIdBefore && (copiedBankId || activeIdBefore !== catalogId)) {
        await questionBankRepository.switchBank(activeIdBefore);
      }
    };
    set({
      installError: null,
      installProgress: { completed: 0, total: 1, label: '正在检查题库版本' },
    });
    try {
      const currentVersion = source.package.catalog.version;
      const latest = await resolveBankUpdate(source.sourceUrl);
      if (!shouldUpdateBank(currentVersion, latest.version)) {
        return { added: 0, removed: 0, updated: false };
      }
      // 先确认确有新版本再询问；本地编辑过且调用方未决定时，不下载、不覆盖
      if (source.locallyModified && !options?.onLocalEdits) {
        return { added: 0, removed: 0, updated: false, needsConfirmation: true };
      }
      if (source.locallyModified && options?.onLocalEdits === 'keepCopy') {
        set({ installProgress: { completed: 0, total: 1, label: '正在另存本地修改副本' } });
        copiedBankId = await copyBankInstalled(set, catalogId);
      }
      const copied = copiedBankId ? { copiedBankId } : {};
      const result = await remote.installFromUrl(
        latest.url,
        (progress) => set({ installProgress: progress }),
        {
          reuseCatalogId: catalogId, currentVersion,
          // 新下载内容即线上原样：复位已修改标记
          beforeCommit: (bank) => saveLocalBankSource({
            bankId: catalogId, updatedAt: '', package: bank, sourceUrl: source.sourceUrl,
            locallyModified: false,
          }),
        },
      );
      if (result.unchanged) {
        if (copiedBankId) {
          // 包内版本未变：原库保持不动，已另存的副本保留，仅恢复激活题库
          await restoreActiveBank();
          await reloadCatalog(set);
          await get().refreshBanks();
        }
        return { added: 0, removed: 0, updated: false, ...copied };
      }
      await restoreActiveBank();
      await reloadCatalog(set);
      set({ installProgress: null });
      await get().refreshBanks();
      const after = await questionBankRepository.getQuestionIds(catalogId);
      const added = after && before ? [...after].filter((id) => !before.has(id)).length : after?.size ?? 0;
      const removed = before && after ? [...before].filter((id) => !after.has(id)).length : 0;
      return { added, removed, updated: true, ...copied };
    } catch (error) {
      try {
        await restoreActiveBank();
        await reloadCatalog(set);
        await get().refreshBanks();
      } finally {
        set({ installError: error instanceof Error ? error.message : String(error), installProgress: null });
      }
      throw error;
    }
  }),

  exportBackup: () => exclusive(async () => {
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
  }),

  importBackup: (fileUri) => exclusive(async () => {
    assertNativeBankOperations();
    const existing = new Set([
      ...(await questionBankRepository.listBanks()).map((bank) => bank.catalogId),
      ...(await listLocalBankSources()).map((bank) => bank.bankId),
    ]);
    const result = await restoreBackupZip({
      zipPath: fileUri,
      existingCatalogIds: existing,
      installBank: async (source) => {
        await runInstall(set, () => questionBankRepository.install(source.package, undefined, {
          beforeCommit: () => saveLocalBankSource(source),
        }));
      },
      restoreBankAssets: (assetsRoot, sourceCatalogId, targetCatalogId) =>
        questionBankRepository.restoreBankAssets(assetsRoot, sourceCatalogId, targetCatalogId),
    });
    await reloadCatalog(set);
    await get().refreshBanks();
    return result;
  }),
  });
});

type SetQuestionBankState = (partial: Partial<QuestionBankState>) => void;

/**
 * 把已装题库复制为新的本地题库（安装并激活 + 拷图片资产），返回副本 bankId。
 * 不加 exclusive：供 copyBank 与 updateBank(keepCopy) 在各自的独占区内复用。
 */
async function copyBankInstalled(set: SetQuestionBankState, catalogId: string): Promise<string> {
  const exported = await questionBankRepository.exportPackage(catalogId);
  if (!exported) throw new Error(`没有找到题库：${catalogId}`);
  const source = copyBankAsLocal(exported);
  await runInstall(set, () => questionBankRepository.install(source.package, undefined, {
    beforeCommit: () => saveLocalBankSource(source),
  }));
  // install 只落 markdown；题目图片资产从源库逐题拷贝（方法内部尽力而为）
  await questionBankRepository.copyBankAssets(catalogId, source.bankId);
  return source.bankId;
}

/** 重建安装题库并刷新 catalog；失败时写 installError 并向上抛出 */
async function runInstall(
  set: SetQuestionBankState,
  perform: () => Promise<unknown>,
): Promise<void> {
  set({ installError: null });
  try {
    await perform();
    const catalog = await questionBankRepository.getCatalog();
    if (!catalog) throw new Error('题库保存完成，但无法读取本地目录');
    set({ catalog, status: 'ready' });
  } catch (error) {
    set({
      installError: error instanceof Error ? error.message : String(error),
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
