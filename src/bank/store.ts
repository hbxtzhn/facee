import { create } from 'zustand';
import { BankError, toBankError, type BankErrorCode } from './errors';
import { migrate } from './db/schema';
import { createDefaultRuntime } from './runtime';
import type { BankRuntime } from './runtime-types';
import * as install from './install';
import * as repo from './repository';
import * as learning from './learning';
import * as sessions from './sessions';
import * as sections from './sections';
import * as local from './local';
import * as backup from './backup';
import type {
  BankSummary,
  CategoryInfo,
  CollectionInfo,
  KeypointAttempt,
  Mastery,
  QuestionDetail,
  QuestionFilter,
  QuestionListItem,
  SearchHit,
  TagInfo,
} from './model';
import type { Question } from './types';

/**
 * 题库 v2 对 UI 的唯一入口（zustand）。详见 src/bank/README.md。
 *
 * ## 结果约定（重要）
 * - 所有异步 action **永不 reject**，统一返回 `BankResult<T>`：
 *   成功 `{ ok: true, value }`，失败 `{ ok: false, error: { code, message, details? } }`；
 *   失败时同时写入 `lastError`（UI 可统一 toast，`clearError()` 清除）。
 * - 「独占操作」（安装 / 导入文件 / 更新 / 删除题库 / 本地题库编辑 / 恢复备份）同一时间只允许一个：
 *   进行中时 `busy` 非空，此时再调用独占操作直接返回 `code: 'busy'`，不排队。
 *   读取与学习数据写入不受 busy 限制。
 * - Web 预览：`initialize()` 后 `status === 'unsupported'`，所有 action 返回 `code: 'unsupported'`。
 * - 题库内容变化（安装 / 更新 / 编辑 / 切换）后 `contentVersion` +1；学习数据变化后 `learningVersion` +1。
 *   列表类页面把它们作为 effect 依赖重新查询即可，store 不缓存题目列表。
 */

export interface BankActionError {
  code: BankErrorCode;
  /** 可直接展示的中文说明 */
  message: string;
  /** 校验类错误的具体问题（路径 + 说明） */
  details?: string[];
}

export type BankResult<T> = { ok: true; value: T } | { ok: false; error: BankActionError };

export type BankStatus = 'idle' | 'initializing' | 'ready' | 'unsupported' | 'error';

export type BusyKind = 'install' | 'update' | 'delete' | 'local-edit' | 'backup-import';

export interface BusyState {
  kind: BusyKind;
  /** 正在操作的题库（安装前未知时为 null） */
  bankId: string | null;
}

export interface BankState {
  /** 初始化状态：ready 之后才能调用其它 action */
  status: BankStatus;
  /** 全部已安装题库 */
  banks: BankSummary[];
  /** 当前题库 id（持久化在数据库 app_settings 中） */
  activeBankId: string | null;
  /** 当前题库摘要（banks 中对应项） */
  activeBank: BankSummary | null;
  /** 当前题库的分类（含题数、掌握统计），按 order → id */
  categories: CategoryInfo[];
  /** 当前题库的标签（含子标签 id 与含子孙的题数） */
  tags: TagInfo[];
  /** 当前题库的专题 / 学习路径 */
  collections: CollectionInfo[];
  /** 当前题库的自定义分区（issue #3） */
  sections: sections.SectionInfo[];
  /** 当前题库学习统计（总数 / 已标 / 到期 / 收藏 / 内容更新） */
  stats: learning.BankLearningStats | null;
  /** 当前题库资源目录 URI（图片渲染用），无资源为 null */
  assetBaseUri: string | null;
  /** 进行中的独占操作 */
  busy: BusyState | null;
  /** 安装 / 更新进度（busy 期间有效） */
  progress: install.InstallProgress | null;
  /** 最近一次失败（任何 action） */
  lastError: BankActionError | null;
  /** 题库内容版本号：安装 / 更新 / 编辑 / 切换后 +1 */
  contentVersion: number;
  /** 学习数据版本号：打标 / 收藏 / 自评 / 分区 / 恢复备份后 +1 */
  learningVersion: number;

  // ---------- 生命周期 ----------
  /**
   * 打开数据库、执行迁移、加载题库列表与当前题库。重复调用安全（已 ready 直接返回）。
   * @param options.runtime 测试注入的运行时；缺省按平台创建（Web 返回 unsupported）
   */
  initialize: (options?: { runtime?: BankRuntime }) => Promise<BankResult<void>>;
  /** 重新加载题库列表与当前题库的分类 / 标签 / 专题 / 分区 / 统计 */
  refresh: () => Promise<BankResult<void>>;
  /** 清除 lastError */
  clearError: () => void;

  // ---------- 题库管理（独占） ----------
  /** 通过 latest.json 地址添加在线题库（已安装同 id 则等同更新）；首个题库自动设为当前 */
  addOnlineBank: (manifestUrl: string) => Promise<BankResult<install.InstallResult>>;
  /** 导入本地 bundle.json 文件（分享的题库 / 本地题库导出）；可选资源 ZIP */
  importBankFile: (uri: string, assetsZipUri?: string) => Promise<BankResult<install.InstallResult>>;
  /** 检查更新（只拉 latest.json，不下载题库；非独占） */
  checkUpdate: (bankId: string) => Promise<BankResult<install.UpdateCheck>>;
  /** 安装清单中的最新版本 */
  updateBank: (bankId: string) => Promise<BankResult<install.InstallResult>>;
  /** 切换当前题库 */
  switchBank: (bankId: string) => Promise<BankResult<void>>;
  /** 删除题库及其资源；学习数据默认保留，purgeLearningData 时一并清除 */
  deleteBank: (bankId: string, options?: { purgeLearningData?: boolean }) => Promise<BankResult<void>>;
  /** 导出任一题库为 bundle.json（返回缓存目录中的文件 URI，交给系统分享） */
  exportBankFile: (bankId: string) => Promise<BankResult<string>>;

  // ---------- 本地自建题库（独占 local-edit） ----------
  /** 新建本地题库，返回题库 id；首个题库自动设为当前 */
  createLocalBank: (input: local.LocalBankInput) => Promise<BankResult<string>>;
  updateLocalBankInfo: (bankId: string, input: Partial<local.LocalBankInput>) => Promise<BankResult<void>>;
  addLocalCategory: (bankId: string, input: local.LocalCategoryInput) => Promise<BankResult<string>>;
  updateLocalCategory: (bankId: string, categoryId: string, input: Partial<Omit<local.LocalCategoryInput, 'id'>>) => Promise<BankResult<void>>;
  /** 删除分类；分类下有题时必须给出 moveQuestionsTo */
  deleteLocalCategory: (bankId: string, categoryId: string, options?: { moveQuestionsTo?: string }) => Promise<BankResult<void>>;
  reorderLocalCategories: (bankId: string, orderedIds: string[]) => Promise<BankResult<void>>;
  addLocalTag: (bankId: string, input: local.LocalTagInput) => Promise<BankResult<string>>;
  updateLocalTag: (bankId: string, tagId: string, input: Partial<Omit<local.LocalTagInput, 'id'>>) => Promise<BankResult<void>>;
  deleteLocalTag: (bankId: string, tagId: string) => Promise<BankResult<void>>;
  /** 新增题目（要点 / 追问 id 自动分配，contentHash 自动计算） */
  addLocalQuestion: (bankId: string, input: local.LocalQuestionInput) => Promise<BankResult<Question>>;
  /** 修改题目：要点 / 追问保留 id 表示修改原条目，省略 id 表示新增 */
  updateLocalQuestion: (bankId: string, questionId: string, input: local.LocalQuestionInput) => Promise<BankResult<Question>>;
  /** 删除题目（学习数据归档） */
  deleteLocalQuestion: (bankId: string, questionId: string) => Promise<BankResult<void>>;
  reorderLocalQuestions: (bankId: string, orderedIds: string[]) => Promise<BankResult<void>>;

  // ---------- 查询（当前题库；可显式传 bankId） ----------
  /** 按筛选列题（分类 order → 题目顺序；指定专题时按专题顺序） */
  listQuestions: (filter?: QuestionFilter, bankId?: string) => Promise<BankResult<QuestionListItem[]>>;
  /** 搜索：≥ 3 字走 FTS5 trigram，1–2 字走 LIKE；可叠加筛选 */
  search: (query: string, options?: { filter?: QuestionFilter; limit?: number; bankId?: string }) => Promise<BankResult<SearchHit[]>>;
  /** 题目详情（Markdown 资源已改写为文件 URI，附学习状态）；不存在返回 not-found */
  getQuestion: (questionId: string, bankId?: string) => Promise<BankResult<QuestionDetail>>;
  /** 今日到期复习题 id（最久未复习优先） */
  listDueQuestionIds: (bankId?: string) => Promise<BankResult<string[]>>;
  /** 「已移除题目」：仍有学习数据但已从题库删除的题 id */
  listArchivedQuestionIds: (bankId?: string) => Promise<BankResult<string[]>>;
  /** 某题全部要点自评（新的在前） */
  listKeypointAttempts: (questionId: string, bankId?: string) => Promise<BankResult<Array<KeypointAttempt & { archivedKeypointIds: string[] }>>>;

  // ---------- 学习数据（当前题库） ----------
  /** 记录浏览（清除「内容已更新」标记） */
  markViewed: (questionId: string) => Promise<BankResult<void>>;
  /** 打标并排期；null 清除标记 */
  setMastery: (questionId: string, mastery: Mastery | null) => Promise<BankResult<learning.MasteryRecord>>;
  /** 记录一次要点自评（必须覆盖全部要点） */
  recordKeypointCheck: (questionId: string, covered: Record<string, boolean>) => Promise<BankResult<KeypointAttempt>>;
  /** 追问掌握度；null 清除 */
  setFollowupMastery: (questionId: string, followupId: string, mastery: Mastery | null) => Promise<BankResult<void>>;
  /** 切换收藏，返回切换后的状态 */
  toggleFavorite: (questionId: string) => Promise<BankResult<boolean>>;

  // ---------- 练习会话（当前题库） ----------
  /** 读取会话（已按当前题目校正；无会话返回 null） */
  getSession: () => Promise<BankResult<sessions.PracticeSession | null>>;
  /** 保存会话（覆盖） */
  saveSession: (input: sessions.PracticeSessionInput) => Promise<BankResult<sessions.PracticeSession | null>>;
  /** 推进下标 */
  updateSessionIndex: (index: number) => Promise<BankResult<void>>;
  clearSession: () => Promise<BankResult<void>>;

  // ---------- 自定义分区（当前题库，issue #3） ----------
  createSection: (name: string) => Promise<BankResult<string>>;
  renameSection: (sectionId: string, name: string) => Promise<BankResult<void>>;
  deleteSection: (sectionId: string) => Promise<BankResult<void>>;
  reorderSections: (orderedIds: string[]) => Promise<BankResult<void>>;
  addCategoryToSection: (sectionId: string, categoryId: string) => Promise<BankResult<void>>;
  /** 也用于移除「已不在题库中」的分类 */
  removeCategoryFromSection: (sectionId: string, categoryId: string) => Promise<BankResult<void>>;
  reorderSectionCategories: (sectionId: string, orderedCategoryIds: string[]) => Promise<BankResult<void>>;

  // ---------- 备份 ----------
  /** 导出备份（学习数据 + 本地题库），返回文件 URI */
  exportBackup: () => Promise<BankResult<string>>;
  /** 从备份文件恢复（合并，较新者胜出；独占） */
  importBackup: (uri: string) => Promise<BankResult<backup.BackupImportResult>>;
}

let runtime: BankRuntime | null = null;
let initializing: Promise<BankResult<void>> | null = null;

const EMPTY_ACTIVE = {
  activeBank: null,
  categories: [],
  tags: [],
  collections: [],
  sections: [],
  stats: null,
  assetBaseUri: null,
} satisfies Partial<BankState>;

function toActionError(error: unknown): BankActionError {
  const bankError = toBankError(error);
  return { code: bankError.code, message: bankError.message, ...(bankError.details ? { details: bankError.details } : {}) };
}

export const useBankStore = create<BankState>((set, get) => {
  const fail = <T>(error: unknown): BankResult<T> => {
    const actionError = toActionError(error);
    set({ lastError: actionError });
    return { ok: false, error: actionError };
  };

  const requireRuntime = (): BankRuntime => {
    const { status } = get();
    if (status === 'unsupported') throw new BankError('unsupported', 'Web 预览不支持本地题库，请在 Android App 中使用');
    if (!runtime || status !== 'ready') throw new BankError('not-ready', '题库尚未初始化');
    return runtime;
  };

  const requireActive = (bankId?: string): string => {
    const id = bankId ?? get().activeBankId;
    if (!id) throw new BankError('not-found', '还没有选择题库');
    return id;
  };

  /** 普通 action：不受 busy 限制 */
  const run = async <T>(operation: (rt: BankRuntime) => Promise<T>): Promise<BankResult<T>> => {
    try {
      return { ok: true, value: await operation(requireRuntime()) };
    } catch (error) {
      return fail<T>(error);
    }
  };

  /** 独占 action：busy 时直接返回 busy；结束后清除 busy / progress */
  const exclusive = async <T>(kind: BusyKind, bankId: string | null, operation: (rt: BankRuntime) => Promise<T>): Promise<BankResult<T>> => {
    let rt: BankRuntime;
    try {
      rt = requireRuntime();
    } catch (error) {
      return fail<T>(error);
    }
    if (get().busy) return fail<T>(new BankError('busy', '正在进行其它题库操作，请稍候'));
    set({ busy: { kind, bankId }, progress: null, lastError: null });
    try {
      return { ok: true, value: await operation(rt) };
    } catch (error) {
      return fail<T>(error);
    } finally {
      set({ busy: null, progress: null });
    }
  };

  const onProgress = (progress: install.InstallProgress) => set({ progress });

  /** 重新加载题库列表与当前题库的派生数据 */
  const reload = async (rt: BankRuntime, preferredActive?: string | null): Promise<void> => {
    if (preferredActive) await repo.setActiveBankId(rt, preferredActive);
    const banks = await repo.listBanks(rt);
    const activeBankId = await repo.getActiveBankId(rt);
    if (!activeBankId) {
      set({ banks, activeBankId: null, ...EMPTY_ACTIVE, contentVersion: get().contentVersion + 1 });
      return;
    }
    const [categories, tags, collections, sectionList, stats, assetBaseUri] = await Promise.all([
      repo.listCategories(rt, activeBankId),
      repo.listTags(rt, activeBankId),
      repo.listCollections(rt, activeBankId),
      sections.listSections(rt, activeBankId),
      learning.getLearningStats(rt, activeBankId),
      install.getAssetBaseUri(rt, activeBankId),
    ]);
    set({
      banks,
      activeBankId,
      activeBank: banks.find((b) => b.id === activeBankId) ?? null,
      categories,
      tags,
      collections,
      sections: sectionList,
      stats,
      assetBaseUri,
      contentVersion: get().contentVersion + 1,
    });
  };

  /** 学习数据变化后：刷新统计、分类掌握数与分区，learningVersion +1 */
  const afterLearning = async (rt: BankRuntime, bankId: string): Promise<void> => {
    if (bankId !== get().activeBankId) return;
    const [stats, categories, sectionList] = await Promise.all([
      learning.getLearningStats(rt, bankId),
      repo.listCategories(rt, bankId),
      sections.listSections(rt, bankId),
    ]);
    set({ stats, categories, sections: sectionList, learningVersion: get().learningVersion + 1 });
  };

  /** 安装 / 导入后：没有当前题库时把新题库设为当前 */
  const afterInstall = async (rt: BankRuntime, bankId: string): Promise<void> => {
    const current = await repo.getActiveBankId(rt);
    await reload(rt, current ? null : bankId);
  };

  const localEdit = <T>(bankId: string, operation: (rt: BankRuntime) => Promise<T>) =>
    exclusive('local-edit', bankId, async (rt) => {
      const value = await operation(rt);
      await reload(rt);
      return value;
    });

  return {
    status: 'idle',
    banks: [],
    activeBankId: null,
    ...EMPTY_ACTIVE,
    busy: null,
    progress: null,
    lastError: null,
    contentVersion: 0,
    learningVersion: 0,

    initialize: (options) => {
      if (get().status === 'ready' || get().status === 'unsupported') return Promise.resolve({ ok: true, value: undefined });
      if (initializing) return initializing;
      initializing = (async (): Promise<BankResult<void>> => {
        set({ status: 'initializing', lastError: null });
        try {
          const rt = options?.runtime ?? (await createDefaultRuntime());
          if (!rt) {
            const error = new BankError('unsupported', 'Web 预览不支持本地题库，请在 Android App 中使用');
            set({ status: 'unsupported' });
            return fail<void>(error);
          }
          await migrate(rt.db);
          runtime = rt;
          set({ status: 'ready' });
          await reload(rt);
          return { ok: true, value: undefined };
        } catch (error) {
          runtime = null;
          set({ status: 'error' });
          return fail<void>(error);
        } finally {
          initializing = null;
        }
      })();
      return initializing;
    },

    refresh: () => run((rt) => reload(rt)),
    clearError: () => set({ lastError: null }),

    addOnlineBank: (manifestUrl) =>
      exclusive('install', null, async (rt) => {
        const result = await install.addBankFromManifestUrl(rt, manifestUrl, { onProgress });
        await afterInstall(rt, result.bankId);
        return result;
      }),
    importBankFile: (uri, assetsZipUri) =>
      exclusive('install', null, async (rt) => {
        const result = await install.addBankFromBundleFile(rt, uri, { onProgress, assetsZipUri });
        await afterInstall(rt, result.bankId);
        return result;
      }),
    checkUpdate: (bankId) =>
      run(async (rt) => {
        const result = await install.checkForUpdate(rt, bankId);
        set({ banks: await repo.listBanks(rt) });
        set({ activeBank: get().banks.find((b) => b.id === get().activeBankId) ?? null });
        return result;
      }),
    updateBank: (bankId) =>
      exclusive('update', bankId, async (rt) => {
        const result = await install.updateBank(rt, bankId, { onProgress });
        await reload(rt);
        return result;
      }),
    switchBank: (bankId) =>
      run(async (rt) => {
        await reload(rt, bankId);
      }),
    deleteBank: (bankId, options) =>
      exclusive('delete', bankId, async (rt) => {
        await repo.deleteBank(rt, bankId, options);
        await reload(rt);
      }),
    exportBankFile: (bankId) => run((rt) => local.exportBundleFile(rt, bankId)),

    createLocalBank: (input) =>
      exclusive('local-edit', null, async (rt) => {
        const bankId = await local.createLocalBank(rt, input);
        await afterInstall(rt, bankId);
        return bankId;
      }),
    updateLocalBankInfo: (bankId, input) => localEdit(bankId, (rt) => local.updateLocalBankInfo(rt, bankId, input)),
    addLocalCategory: (bankId, input) => localEdit(bankId, (rt) => local.addLocalCategory(rt, bankId, input)),
    updateLocalCategory: (bankId, categoryId, input) => localEdit(bankId, (rt) => local.updateLocalCategory(rt, bankId, categoryId, input)),
    deleteLocalCategory: (bankId, categoryId, options) => localEdit(bankId, (rt) => local.deleteLocalCategory(rt, bankId, categoryId, options)),
    reorderLocalCategories: (bankId, orderedIds) => localEdit(bankId, (rt) => local.reorderLocalCategories(rt, bankId, orderedIds)),
    addLocalTag: (bankId, input) => localEdit(bankId, (rt) => local.addLocalTag(rt, bankId, input)),
    updateLocalTag: (bankId, tagId, input) => localEdit(bankId, (rt) => local.updateLocalTag(rt, bankId, tagId, input)),
    deleteLocalTag: (bankId, tagId) => localEdit(bankId, (rt) => local.deleteLocalTag(rt, bankId, tagId)),
    addLocalQuestion: (bankId, input) => localEdit(bankId, (rt) => local.addLocalQuestion(rt, bankId, input)),
    updateLocalQuestion: (bankId, questionId, input) => localEdit(bankId, (rt) => local.updateLocalQuestion(rt, bankId, questionId, input)),
    deleteLocalQuestion: (bankId, questionId) => localEdit(bankId, (rt) => local.deleteLocalQuestion(rt, bankId, questionId)),
    reorderLocalQuestions: (bankId, orderedIds) => localEdit(bankId, (rt) => local.reorderLocalQuestions(rt, bankId, orderedIds)),

    listQuestions: (filter, bankId) => run((rt) => repo.listQuestions(rt, requireActive(bankId), filter)),
    search: (query, options) =>
      run((rt) => repo.searchQuestions(rt, requireActive(options?.bankId), query, { filter: options?.filter, limit: options?.limit })),
    getQuestion: (questionId, bankId) =>
      run(async (rt) => {
        const detail = await repo.getQuestion(rt, requireActive(bankId), questionId);
        if (!detail) throw new BankError('not-found', '题目不存在或已从题库移除');
        return detail;
      }),
    listDueQuestionIds: (bankId) => run((rt) => learning.listDueQuestionIds(rt, requireActive(bankId))),
    listArchivedQuestionIds: (bankId) => run((rt) => learning.listArchivedQuestionIds(rt, requireActive(bankId))),
    listKeypointAttempts: (questionId, bankId) => run((rt) => learning.listKeypointAttempts(rt, requireActive(bankId), questionId)),

    markViewed: (questionId) =>
      run(async (rt) => {
        const bankId = requireActive();
        await learning.markViewed(rt, bankId, questionId);
        await afterLearning(rt, bankId);
      }),
    setMastery: (questionId, mastery) =>
      run(async (rt) => {
        const bankId = requireActive();
        const record = await learning.setMastery(rt, bankId, questionId, mastery);
        await afterLearning(rt, bankId);
        return record;
      }),
    recordKeypointCheck: (questionId, covered) =>
      run(async (rt) => {
        const bankId = requireActive();
        const attempt = await learning.recordKeypointCheck(rt, bankId, questionId, covered);
        await afterLearning(rt, bankId);
        return attempt;
      }),
    setFollowupMastery: (questionId, followupId, mastery) =>
      run(async (rt) => {
        const bankId = requireActive();
        await learning.setFollowupMastery(rt, bankId, questionId, followupId, mastery);
        await afterLearning(rt, bankId);
      }),
    toggleFavorite: (questionId) =>
      run(async (rt) => {
        const bankId = requireActive();
        const favorite = await learning.toggleFavorite(rt, bankId, questionId);
        await afterLearning(rt, bankId);
        return favorite;
      }),

    getSession: () => run((rt) => sessions.getSession(rt, requireActive())),
    saveSession: (input) => run((rt) => sessions.saveSession(rt, requireActive(), input)),
    updateSessionIndex: (index) => run((rt) => sessions.updateSessionIndex(rt, requireActive(), index)),
    clearSession: () => run((rt) => sessions.clearSession(rt, requireActive())),

    createSection: (name) =>
      run(async (rt) => {
        const bankId = requireActive();
        const id = await sections.createSection(rt, bankId, name);
        await afterLearning(rt, bankId);
        return id;
      }),
    renameSection: (sectionId, name) =>
      run(async (rt) => {
        const bankId = requireActive();
        await sections.renameSection(rt, bankId, sectionId, name);
        await afterLearning(rt, bankId);
      }),
    deleteSection: (sectionId) =>
      run(async (rt) => {
        const bankId = requireActive();
        await sections.deleteSection(rt, bankId, sectionId);
        await afterLearning(rt, bankId);
      }),
    reorderSections: (orderedIds) =>
      run(async (rt) => {
        const bankId = requireActive();
        await sections.reorderSections(rt, bankId, orderedIds);
        await afterLearning(rt, bankId);
      }),
    addCategoryToSection: (sectionId, categoryId) =>
      run(async (rt) => {
        const bankId = requireActive();
        await sections.addCategoryToSection(rt, bankId, sectionId, categoryId);
        await afterLearning(rt, bankId);
      }),
    removeCategoryFromSection: (sectionId, categoryId) =>
      run(async (rt) => {
        const bankId = requireActive();
        await sections.removeCategoryFromSection(rt, bankId, sectionId, categoryId);
        await afterLearning(rt, bankId);
      }),
    reorderSectionCategories: (sectionId, orderedCategoryIds) =>
      run(async (rt) => {
        const bankId = requireActive();
        await sections.reorderSectionCategories(rt, bankId, sectionId, orderedCategoryIds);
        await afterLearning(rt, bankId);
      }),

    exportBackup: () => run((rt) => backup.exportBackupFile(rt)),
    importBackup: (uri) =>
      exclusive('backup-import', null, async (rt) => {
        const result = await backup.importBackupFile(rt, uri);
        await reload(rt);
        set({ learningVersion: get().learningVersion + 1 });
        return result;
      }),
  };
});

/** 同步解析 `asset:<sha256>.<ext>`（使用当前题库的资源目录）；无法解析返回 null */
export function resolveActiveAssetUri(ref: string): string | null {
  return install.resolveAssetRef(useBankStore.getState().assetBaseUri, ref);
}

/** 测试用：关闭数据库并把 store 恢复到初始状态 */
export async function resetBankStoreForTests(): Promise<void> {
  const rt = runtime;
  runtime = null;
  initializing = null;
  useBankStore.setState({
    status: 'idle',
    banks: [],
    activeBankId: null,
    ...EMPTY_ACTIVE,
    busy: null,
    progress: null,
    lastError: null,
    contentVersion: 0,
    learningVersion: 0,
  });
  await rt?.db.closeAsync().catch(() => undefined);
}
