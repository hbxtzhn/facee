import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

/**
 * 题目级学习状态（掌握度）：本题库里每道题的「会 / 模糊 / 不会」，
 * 以及最后一次打标时间（间隔复习的排期依据，见 lib/spaced-review.ts）。
 *
 * 口径（评审定稿，实现必须与之一致）：
 *   1. 任何时候可评、可改、可清除——打标不依赖答案是否可见；
 *   2. 无答案题（hasAnswer=false）同样可以打标，闭环对它不能静默失效；
 *   3. **按题库 catalog.id 命名空间隔离**：同一 questionId 在不同题库互不影响，
 *      换题库不串味，旧库记录保留（换回旧库时恢复）；派生列表（如错题本）按
 *      当前题库过滤孤儿数据；
 *   4. 错题本 = unknown + fuzzy 的派生结果，不做第二个独立数据源；
 *   5. 打标即排期：每次打标刷新 markedAt（epoch ms），清除标记同时移除排期；
 *      v1 存量迁移时统一按迁移时刻计，老用户不会一升级就爆出一堆到期题。
 *
 * 持久化模板沿用 userStore（串行 queuePersist + 容错解析），不学 favoritesStore
 * 的裸 JSON.parse——那是全仓最弱的持久化样例。
 */

/** 三态掌握度。`unknown` 是「不会」，与「未打标」（无记录）严格区分。 */
export type Mastery = 'unknown' | 'fuzzy' | 'known';

/** 单个题库内的掌握度表：questionId -> Mastery */
export type BankMarks = Record<string, Mastery>;

/** 单个题库内的打标时间表：questionId -> epoch ms；与 marks 的键集合保持一致 */
export type BankMarkedAt = Record<string, number>;

interface MasteryData {
  /** 题库 catalog.id -> 该库的掌握度表 */
  marks: Record<string, BankMarks>;
  /** 题库 catalog.id -> 该库的打标时间表（与 marks 平行维护） */
  markedAt: Record<string, BankMarkedAt>;
}

interface MasteryActions {
  /** 打标；传 null 表示清除该题的记录（不是标成 unknown） */
  setMark: (bankId: string, questionId: string, mastery: Mastery | null) => void;
  /** 非响应式读取（与 favoritesStore.has 同类），渲染中请订阅 marks */
  getMark: (bankId: string, questionId: string) => Mastery | null;
  load: () => Promise<void>;
}

type MasteryState = MasteryData & MasteryActions;

const STORAGE_KEY = 'facee-mastery-state.v2';
const LEGACY_STORAGE_KEY = 'facee-mastery-state.v1';

const INITIAL_DATA: Readonly<MasteryData> = { marks: {}, markedAt: {} };

let pendingPersist = Promise.resolve();

export const useMasteryStore = create<MasteryState>((set, get) => ({
  ...INITIAL_DATA,

  setMark: (bankId, questionId, mastery) => {
    const bankMarks = { ...get().marks[bankId] };
    const bankMarkedAt = { ...get().markedAt[bankId] };
    if (mastery === null) {
      delete bankMarks[questionId];
      delete bankMarkedAt[questionId];
    } else {
      bankMarks[questionId] = mastery;
      bankMarkedAt[questionId] = Date.now();
    }

    const marks = { ...get().marks };
    const markedAt = { ...get().markedAt };
    if (Object.keys(bankMarks).length > 0) {
      marks[bankId] = bankMarks;
      markedAt[bankId] = bankMarkedAt;
    } else {
      delete marks[bankId];
      delete markedAt[bankId];
    }

    set({ marks, markedAt });
    queuePersist(get());
  },

  getMark: (bankId, questionId) => get().marks[bankId]?.[questionId] ?? null,

  load: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const persisted = parsePersistedData(raw);
        if (persisted) {
          set(persisted);
          return;
        }
        // v2 键存在但载荷损坏：不能在此返回——v1 存量可能是最后一份副本
        // （掌握度不进备份），继续走下方迁移可恢复数据并用健康载荷覆盖损坏的 v2。
      }

      // v1 → v2 迁移：老数据没有打标时间，统一按迁移时刻计（1/3/7 天后才陆续到期）
      const legacyRaw = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
      if (!legacyRaw) return;
      const legacy = parseLegacyMarks(legacyRaw);
      if (!legacy) return;
      const migratedAt = Date.now();
      const markedAt: Record<string, BankMarkedAt> = {};
      for (const [bankId, bankMarks] of Object.entries(legacy.marks)) {
        const bankMarkedAt: BankMarkedAt = {};
        for (const questionId of Object.keys(bankMarks)) bankMarkedAt[questionId] = migratedAt;
        markedAt[bankId] = bankMarkedAt;
      }
      set({ marks: legacy.marks, markedAt });
      queuePersist(get());
    } catch {
      // Storage is a cache: keep the usable in-memory defaults on read failure.
    }
  },
}));

/** v2 数据解析；markedAt 里没有对应掌握度记录的孤儿条目直接丢弃 */
function parsePersistedData(raw: string): MasteryData | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const marks = parseMarksContainer(value);
  if (!marks) return null;

  const markedAt: Record<string, BankMarkedAt> = {};
  const rawMarkedAt = isRecord(value) && isRecord(value.markedAt) ? value.markedAt : {};
  for (const [bankId, bankValue] of Object.entries(rawMarkedAt)) {
    const bankMarks = marks[bankId];
    if (!bankMarks || !isRecord(bankValue)) continue;
    const bankMarkedAt: BankMarkedAt = {};
    for (const [questionId, timestamp] of Object.entries(bankValue)) {
      if (!(questionId in bankMarks)) continue;
      if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp < 0) continue;
      bankMarkedAt[questionId] = timestamp;
    }
    if (Object.keys(bankMarkedAt).length > 0) markedAt[bankId] = bankMarkedAt;
  }
  return { marks, markedAt };
}

/** v1 数据解析（只有 marks） */
function parseLegacyMarks(raw: string): MasteryData | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const marks = parseMarksContainer(value);
  return marks ? { marks, markedAt: {} } : null;
}

function parseMarksContainer(value: unknown): Record<string, BankMarks> | null {
  if (!isRecord(value) || !isRecord(value.marks)) return null;

  const marks: Record<string, BankMarks> = {};
  for (const [bankId, bankValue] of Object.entries(value.marks)) {
    if (typeof bankId !== 'string' || bankId.length === 0 || !isRecord(bankValue)) continue;
    const bankMarks: BankMarks = {};
    for (const [questionId, mastery] of Object.entries(bankValue)) {
      if (questionId.length === 0 || !isMastery(mastery)) continue;
      bankMarks[questionId] = mastery;
    }
    if (Object.keys(bankMarks).length > 0) marks[bankId] = bankMarks;
  }
  return marks;
}

function isMastery(value: unknown): value is Mastery {
  return value === 'unknown' || value === 'fuzzy' || value === 'known';
}

function queuePersist(state: MasteryState): void {
  const serialized = JSON.stringify(toPersistedData(state));
  pendingPersist = pendingPersist
    .catch(() => undefined)
    .then(() => AsyncStorage.setItem(STORAGE_KEY, serialized))
    .catch(() => undefined);
}

function toPersistedData(state: MasteryState): MasteryData {
  return { marks: state.marks, markedAt: state.markedAt };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
