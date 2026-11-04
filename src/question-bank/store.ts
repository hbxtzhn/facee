import { create } from 'zustand';
import { Platform } from 'react-native';
import { asRemoteQuestionBankRepository, questionBankRepository } from './client';
import {
  findSourceSummaryByUrl,
  getConfiguredQuestionBankUrl,
  getSavedQuestionBankUrl,
  installConfiguredQuestionBank,
  saveQuestionBankUrl,
} from './installer';
import {
  copyBankAsLocal,
  createLocalBankPackage,
  deleteLocalBankSource,
  isOnlineBankSource,
  listLocalBankSources,
  loadLocalBankSource,
  saveLocalBankSource,
  type LocalBankSource,
  type LocalBankSourceSummary,
} from './local-banks';
import {
  createBackupZip,
  restoreBackupZip,
  type BackupImportSummary,
} from '../lib/backup';
import { resolveBankUpdate, shouldUpdateBank } from './update';
import type {
  BankCommitMeta,
  InstallationProgress,
  InstalledBankSummary,
  InstallResult,
  QuestionBankCatalog,
  QuestionBankPackage,
} from './types';

export type QuestionBankStatus = 'idle' | 'loading' | 'empty' | 'ready';

/** 更新本机已编辑过的下载库时如何处理本地修改 */
export type LocalEditsDecision = 'overwrite' | 'keepCopy';

export interface UpdateBankOptions {
  /**
   * 仅对旧模型下编辑过（locallyModified）的库生效；线上题库更新从不询问。
   * 未给出且线上确有新内容时，不覆盖，返回 needsConfirmation。
   * 'overwrite'：跳过版本短路强制重装线上包（恢复线上原样，复位已修改标记）。
   * 'keepCopy'：先把当前内容另存为本地副本再更新；线上没有变化时不会留下副本。
   */
  onLocalEdits?: LocalEditsDecision;
}

/** 「重新添加同一地址」弹窗用：本机由该地址下载的题库 */
export interface BankBySourceUrl {
  bankId: string;
  title: string;
  locallyModified: boolean;
}

/** 线上题库不能直接编辑（saveLocalBank 拒绝时的错误信息） */
export const ONLINE_BANK_NOT_EDITABLE_MESSAGE = '线上题库不能直接编辑，请先复制为本地题库';

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
  /**
   * 本机全部题库（本地 + 线上），Profile 题库管理弹窗使用。
   * source/editable 由本地源文件细分：下载且未编辑过的库与旧版非 local- 库为 'online'。
   */
  banks: InstalledBankSummary[];
  banksLoading: boolean;
  setSourceUrl(value: string): void;
  clearInstallError(): void;
  initialize(): Promise<void>;
  /** 安装/更新线上题库；任何失败（含正忙）都返回 false 并写 installError，不会 reject */
  installConfigured(): Promise<boolean>;
  refreshBanks(): Promise<void>;
  /**
   * 只读查询：本机是否已有由该地址（两端空白忽略）下载的题库；同地址多个时优先未修改的。
   * 不占用独占区，可在任何时候调用；读取失败视为没有。
   */
  findBankBySourceUrl(url: string): Promise<BankBySourceUrl | null>;
  /** 题库是否可直接编辑（按最近一次 refreshBanks 的结果；找不到返回 false） */
  isBankEditable(catalogId: string): boolean;
  /** 新建空本地题库（源文件 + 安装激活），返回 bankId */
  createLocalBank(title: string): Promise<string>;
  /** 把已装题库复制为新的本地可编辑题库（安装并激活），返回副本 bankId */
  copyBank(catalogId: string): Promise<string>;
  /**
   * 保存本地题库源并重建安装；若编辑的不是当前题库，保存后保持原题库激活。
   * 线上题库（有 sourceUrl 且未 locallyModified）拒绝保存：须先 copyBank。
   */
  saveLocalBank(source: LocalBankSource): Promise<void>;
  deleteLocalBank(bankId: string): Promise<void>;
  /**
   * 为本地题库关联在线更新地址。用于找回旧版本（≤ v0.1.1 读源时丢弃 sourceUrl）
   * 编辑保存后丢失的更新入口；关联后视为「已修改」，首次更新前会先征求确认。
   */
  setBankSourceUrl(bankId: string, url: string): Promise<void>;
  switchBank(catalogId: string): Promise<void>;
  /**
   * 仅按发布/包内版本（版本未知时按包内容指纹）判断是否更新；更新时沿用原 catalogId。
   * 线上题库从不询问。旧模型下编辑过的库：线上确有变化且未给出 onLocalEdits 时，
   * 返回 needsConfirmation 且不做任何改动。
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
    if (Platform.OS !== 'web') {
      // 旧安装补登记（一次性、幂等）；任何错误都不能阻塞启动
      try {
        await questionBankRepository.migrateLegacyBanks?.();
      } catch {
        // 忽略：下次启动重试
      }
    }
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
  }).catch((error: unknown) => {
    // 只有 exclusive 本身（正忙）会走到这里：按约定返回 false，不留未处理的 rejection
    set({ installError: error instanceof Error ? error.message : String(error) });
    return false;
  }),

  refreshBanks: async () => {
    set({ banksLoading: true });
    try {
      const banks = await questionBankRepository.listBanks();
      // 来源细分与在线更新入口：摘要已带 sourceUrl/locallyModified，每个源文件只解析一次
      const summaries = new Map<string, LocalBankSourceSummary>();
      if (Platform.OS !== 'web') {
        try {
          for (const summary of await listLocalBankSources()) summaries.set(summary.bankId, summary);
        } catch {
          // 读不到源文件时只是没有更新按钮，不影响列表
        }
      }
      set({
        banks: banks.map((bank) => classifyBank(bank, summaries.get(bank.catalogId))),
        banksLoading: false,
      });
    } catch {
      set({ banks: [], banksLoading: false });
    }
  },

  findBankBySourceUrl: async (url) => {
    if (Platform.OS === 'web' || !url.trim()) return null;
    try {
      const match = findSourceSummaryByUrl(await listLocalBankSources(), url);
      if (!match) return null;
      return { bankId: match.bankId, title: match.title, locallyModified: match.locallyModified === true };
    } catch {
      return null;
    }
  },

  isBankEditable: (catalogId) => {
    const bank = get().banks.find((candidate) => candidate.catalogId === catalogId);
    if (!bank) return false;
    return bank.editable ?? bank.source === 'local';
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
    // 线上题库只能在线更新：入参或磁盘上的源任一为线上题库都拒绝（防止调用方传入过期副本）
    const stored = await loadLocalBankSource(source.bankId);
    if (isOnlineBankSource(source) || (stored && isOnlineBankSource(stored))) {
      throw new Error(ONLINE_BANK_NOT_EDITABLE_MESSAGE);
    }
    // 保存前记住当前题库：编辑非激活的题库不应该把它顶成当前使用
    const activeIdBefore = get().catalog?.id ?? null;
    // 仅旧模型下已编辑过的下载库会走到这里（线上题库已被拒绝）：保持已修改标记，
    // 在线更新前需要用户确认，避免整包覆盖丢失编辑
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
    // keepCopy 的副本在「线上没变化」或更新失败时删掉：原库完好，副本只是多余的重复
    const discardCopy = async () => {
      if (!copiedBankId) return;
      const copyId = copiedBankId;
      copiedBankId = undefined;
      try {
        await questionBankRepository.deleteBank(copyId);
        await deleteLocalBankSource(copyId);
      } catch {
        // 尽力而为：清理失败只多留一个副本
      }
    };
    try {
      const currentVersion = source.package.catalog.version;
      const sourceUrl = source.sourceUrl;
      // 版本接口不可用时 latest 无版本、url 降级为 latest/download：由包内版本决定
      const latest = await resolveBankUpdate(sourceUrl);
      const onProgress = (progress: InstallationProgress) => set({ installProgress: progress });
      const install = (force: boolean) => remote.installFromUrl(latest.url, onProgress, {
        reuseCatalogId: catalogId, currentVersion,
        ...(force ? { force: true } : {}),
        // 新下载内容即线上原样：复位已修改标记，记下内容指纹供版本缺失时比较
        beforeCommit: (bank: QuestionBankPackage, meta?: BankCommitMeta) => saveLocalBankSource({
          bankId: catalogId, updatedAt: '', package: bank, sourceUrl,
          locallyModified: false,
          ...(meta?.fingerprint ? { remoteFingerprint: meta.fingerprint } : {}),
        }),
      });
      let result: InstallResult;
      if (!source.locallyModified) {
        // 线上题库：从不询问，语义与以往一致
        if (latest.version && !shouldUpdateBank(currentVersion, latest.version)) {
          return { added: 0, removed: 0, updated: false };
        }
        result = await install(false);
      } else if (options?.onLocalEdits === 'overwrite') {
        // 用户明确选择覆盖：即使版本相同也强制重装，恢复线上原样
        result = await install(true);
      } else {
        // 旧模型下编辑过的库：先确认线上确有变化，再询问/另存
        let changed: boolean;
        if (latest.version) {
          changed = shouldUpdateBank(currentVersion, latest.version);
        } else {
          // 版本未知（分支归档或版本接口不可用）：先下载校验包（不安装），比较后再决定
          set({ installProgress: { completed: 0, total: 1, label: '正在检查线上题库内容' } });
          const peek = await remote.installFromUrl(latest.url, onProgress, {
            reuseCatalogId: catalogId, currentVersion, dryRun: true,
          });
          changed = isRemotePackageChanged(source, peek);
        }
        if (!changed) return { added: 0, removed: 0, updated: false };
        if (!options?.onLocalEdits) {
          return { added: 0, removed: 0, updated: false, needsConfirmation: true };
        }
        set({ installProgress: { completed: 0, total: 1, label: '正在另存本地修改副本' } });
        copiedBankId = await copyBankInstalled(set, catalogId);
        result = await install(false);
      }
      if (result.unchanged) {
        if (copiedBankId) {
          // 包内版本未变：原库保持不动，删掉刚另存的副本并恢复激活题库
          await restoreActiveBank();
          await discardCopy();
          await reloadCatalog(set);
          await get().refreshBanks();
        }
        return { added: 0, removed: 0, updated: false };
      }
      const copied = copiedBankId ? { copiedBankId } : {};
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
        await discardCopy();
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
 * 按本地源摘要细分来源：有下载地址且未在本机编辑过 → 线上题库（只能在线更新）；
 * 旧模型下编辑过的下载库与自建/复制/导入库 → 本地题库；没有源文件的非 local- 旧库 → 线上。
 */
function classifyBank(
  bank: InstalledBankSummary,
  summary: LocalBankSourceSummary | undefined,
): InstalledBankSummary {
  let next: InstalledBankSummary = bank;
  if (summary?.sourceUrl) {
    next = summary.locallyModified
      ? { ...bank, source: 'local', sourceUrl: summary.sourceUrl, locallyModified: true }
      : { ...bank, source: 'online', sourceUrl: summary.sourceUrl };
  } else if (summary) {
    next = { ...bank, source: 'local' };
  }
  return { ...next, editable: next.source === 'local' };
}

/**
 * 旧模型编辑过的库在版本未知时，线上包是否与上次下载的不同。
 * 两边都有版本 → 按版本（与 installFromUrl 的短路一致）；否则比内容指纹；
 * 没有记录过指纹（旧源文件）时无法判断，保守视为有变化。
 */
function isRemotePackageChanged(source: LocalBankSource, peek: InstallResult): boolean {
  const current = source.package.catalog.version;
  if (current?.trim() && peek.version?.trim()) return shouldUpdateBank(current, peek.version);
  if (source.remoteFingerprint && peek.fingerprint) return peek.fingerprint !== source.remoteFingerprint;
  return true;
}

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
