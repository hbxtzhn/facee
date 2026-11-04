// 收藏 store（AsyncStorage 持久化，按题库隔离）
//
// v1 只存一份全局 id 列表：别的题库的收藏看不到，复制出来的题库与原库共享同一批 id。
// v2 按题库 catalog.id 分桶；公开 API 保持不变——`ids` / `toggle` / `has` 永远作用于
// **当前激活的题库**（useQuestionBankStore.getState().catalog?.id），切库时 ids 自动跟随。
//
// 迁移：旧全局列表在首次「有激活题库」时整体归到那个题库，随后删除旧 key。
// 启动时题库可能还没初始化完（App.tsx 并行 load），没有激活题库时旧列表暂存在
// legacy 桶里，期间的 toggle 也作用于它，等题库就绪再一起归位。
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuestionBankStore } from '../question-bank/store';

/** v1 全局列表（只读，迁移后删除） */
export const LEGACY_FAVORITES_KEY = 'facee-favorites';
export const FAVORITES_STORAGE_KEY = 'facee-favorites.v2';

interface FavoritesState {
  /** 当前激活题库的收藏 id */
  ids: string[];
  load: () => Promise<void>;
  toggle: (id: string) => Promise<void>;
  has: (id: string) => boolean;
}

interface FavoritesInternal {
  /** 题库 id -> 收藏 id 列表 */
  byBank: Record<string, string[]>;
  /** 尚未归属任何题库的旧全局列表；null 表示无待迁移数据 */
  legacy: string[] | null;
  /** ids 当前对应的题库；null = 暂无激活题库（作用于 legacy 桶） */
  bankId: string | null;
}

// 内部状态不放进 zustand state：外部 setState({ ids }) 的测试/调用不受影响
const internal: FavoritesInternal = { byBank: {}, legacy: null, bankId: null };
let pendingPersist = Promise.resolve();

function activeBankId(): string | null {
  try {
    return useQuestionBankStore.getState().catalog?.id ?? null;
  } catch {
    return null;
  }
}

/** 把 legacy 桶并入激活题库（去重、保序）；返回是否发生迁移 */
function adoptLegacy(bankId: string | null): boolean {
  if (!bankId || internal.legacy === null) return false;
  const current = internal.byBank[bankId] ?? [];
  const merged = [...current];
  for (const id of internal.legacy) if (!merged.includes(id)) merged.push(id);
  internal.byBank[bankId] = merged;
  internal.legacy = null;
  return true;
}

function idsFor(bankId: string | null): string[] {
  if (!bankId) return internal.legacy ?? [];
  return internal.byBank[bankId] ?? [];
}

function queuePersist(dropLegacyKey: boolean): void {
  const byBank: Record<string, string[]> = {};
  for (const [bankId, ids] of Object.entries(internal.byBank)) {
    if (ids.length > 0) byBank[bankId] = ids;
  }
  const serialized = JSON.stringify({ byBank, legacy: internal.legacy });
  pendingPersist = pendingPersist
    .catch(() => undefined)
    .then(async () => {
      await AsyncStorage.setItem(FAVORITES_STORAGE_KEY, serialized);
      if (dropLegacyKey) await AsyncStorage.removeItem(LEGACY_FAVORITES_KEY);
    })
    .catch(() => undefined);
}

export const useFavoritesStore = create<FavoritesState>((set, get) => ({
  ids: [],
  load: async () => {
    try {
      const [rawV2, rawLegacy] = await Promise.all([
        AsyncStorage.getItem(FAVORITES_STORAGE_KEY),
        AsyncStorage.getItem(LEGACY_FAVORITES_KEY),
      ]);
      const parsed = parseV2(rawV2);
      internal.byBank = parsed.byBank;
      internal.legacy = parsed.legacy;
      const legacyList = parseIdList(rawLegacy);
      const hadLegacyKey = rawLegacy !== null;
      if (legacyList.length > 0) {
        internal.legacy = dedupe([...(internal.legacy ?? []), ...legacyList]);
      }
      const bankId = activeBankId();
      internal.bankId = bankId;
      const migrated = adoptLegacy(bankId);
      if (migrated || hadLegacyKey) queuePersist(hadLegacyKey);
      set({ ids: idsFor(bankId) });
    } catch {
      /* ignore：存储读失败保留内存态 */
    }
  },
  toggle: async (id: string) => {
    const bankId = activeBankId();
    if (bankId !== internal.bankId) syncActiveBank(bankId);
    // 同步后 ids 即当前题库的列表
    const cur = get().ids;
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    if (bankId) internal.byBank[bankId] = next;
    else internal.legacy = next.length > 0 ? next : null;
    set({ ids: next });
    queuePersist(false);
    await pendingPersist;
  },
  has: (id: string) => get().ids.includes(id),
}));

/** 激活题库变化：先把 legacy 归位（首次有题库时），再让 ids 跟随新题库 */
function syncActiveBank(bankId: string | null): void {
  internal.bankId = bankId;
  if (adoptLegacy(bankId)) queuePersist(false);
  useFavoritesStore.setState({ ids: idsFor(bankId) });
}

// 订阅题库切换。测试里 question-bank/store 常被替换成纯函数 mock，没有 subscribe，需防御。
if (typeof (useQuestionBankStore as { subscribe?: unknown }).subscribe === 'function') {
  useQuestionBankStore.subscribe((state) => {
    const bankId = state.catalog?.id ?? null;
    if (bankId !== internal.bankId) syncActiveBank(bankId);
  });
}

/** 测试用：等待排队中的写入落盘 */
export function flushFavoritesPersist(): Promise<void> {
  return pendingPersist;
}

/** 测试用：清空模块内部状态 */
export function resetFavoritesForTests(): void {
  internal.byBank = {};
  internal.legacy = null;
  internal.bankId = null;
  useFavoritesStore.setState({ ids: [] });
}

function parseV2(raw: string | null): { byBank: Record<string, string[]>; legacy: string[] | null } {
  if (!raw) return { byBank: {}, legacy: null };
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return { byBank: {}, legacy: null };
    const record = value as Record<string, unknown>;
    const byBank: Record<string, string[]> = {};
    if (typeof record.byBank === 'object' && record.byBank !== null) {
      for (const [bankId, list] of Object.entries(record.byBank as Record<string, unknown>)) {
        const ids = asIdList(list);
        if (ids.length > 0) byBank[bankId] = ids;
      }
    }
    const legacy = asIdList(record.legacy);
    return { byBank, legacy: legacy.length > 0 ? legacy : null };
  } catch {
    return { byBank: {}, legacy: null };
  }
}

function parseIdList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    return asIdList(JSON.parse(raw));
  } catch {
    return [];
  }
}

function asIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return dedupe(value.filter((item): item is string => typeof item === 'string' && item.length > 0));
}

function dedupe(ids: string[]): string[] {
  return [...new Set(ids)];
}
