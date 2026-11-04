import type { Mastery } from '../store/masteryStore';

/**
 * 间隔复习的计入口径（纯逻辑便于单测）：
 *
 *   1. 不会 1 天 / 模糊 3 天（两者都把「连续会了」清零）；
 *   2. 会了按连续次数扩张：第 1 次 7 天，第 2 次 14 天，第 3 次 30 天，第 4 次起 60 天封顶；
 *   3. 打标即排期：每次打标（含复习时重新打标）刷新 markedAt，到期时间顺延；
 *   4. 清除标记（null）= 退出复习循环；
 *   5. 到期 = 距上次打标已满当前间隔（整边界即算到期）；
 *   6. 复习队列按上次打标时间升序（最久没碰的最先），同刻按题目 id 稳定排序。
 *
 * 单题记录与掌握度表（masteryStore）一一对应；时间全部用 epoch 毫秒。
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** 各档的「首档」间隔（会了 = 连续第 1 次）。保留旧导出名，兼容既有调用方。 */
export const REVIEW_INTERVAL_MS: Record<Mastery, number> = {
  unknown: 1 * DAY_MS,
  fuzzy: 3 * DAY_MS,
  known: 7 * DAY_MS,
};

/** 「会了」的扩张阶梯：下标 = 连续会了次数 - 1，超出取最后一档（60 天封顶） */
export const KNOWN_INTERVAL_LADDER_MS: readonly number[] = [7, 14, 30, 60].map((days) => days * DAY_MS);

/** 一道题的复习档案：当前掌握度 + 最后一次打标时间 + 连续「会了」次数 */
export interface ReviewRecord {
  mastery: Mastery;
  markedAt: number;
  /**
   * 连续「会了」次数（仅 known 有意义）。缺省 / 非法值按 1 计——
   * 升级前的「会了」都相当于首档 7 天，迁移后不会突然提前或推后到期。
   */
  knownStreak?: number;
}

export type BankReviewRecords = Record<string, ReviewRecord>;

/** 规整连续次数：known 至少为 1，其余档恒为 0 */
export function normalizeKnownStreak(mastery: Mastery, streak: number | undefined): number {
  if (mastery !== 'known') return 0;
  return typeof streak === 'number' && Number.isInteger(streak) && streak >= 1 ? streak : 1;
}

/** 当前档案的复习间隔 */
export function reviewIntervalMs(mastery: Mastery, knownStreak?: number): number {
  if (mastery !== 'known') return REVIEW_INTERVAL_MS[mastery];
  const streak = normalizeKnownStreak(mastery, knownStreak);
  return KNOWN_INTERVAL_LADDER_MS[Math.min(streak, KNOWN_INTERVAL_LADDER_MS.length) - 1];
}

/** 是否到期：now 距上次打标已满当前间隔 */
export function isReviewDue(record: ReviewRecord, now: number): boolean {
  return now - record.markedAt >= reviewIntervalMs(record.mastery, record.knownStreak);
}

/**
 * 打标后的新连续次数（masteryStore.setMark 使用）：
 * - 不会 / 模糊 ⇒ 0（清零）；
 * - 之前不是「会了」⇒ 1；
 * - 之前就是「会了」：已到期（完成了一次复习）⇒ +1；未到期的重复确认 ⇒ 保持不变，
 *   避免短时间内连点把间隔刷到 60 天。
 */
export function nextKnownStreak(previous: ReviewRecord | null, next: Mastery, now: number): number {
  if (next !== 'known') return 0;
  if (!previous || previous.mastery !== 'known') return 1;
  const streak = normalizeKnownStreak('known', previous.knownStreak);
  return isReviewDue(previous, now) ? streak + 1 : streak;
}

type StreakTable = Record<string, Record<string, number>>;

/**
 * 从 masteryStore 的平行切片（marks + markedAt + knownStreaks）合成单库复习档案。
 * 缺时间戳的旧条目跳过（理论上只出现在迁移前的极端脏数据，不参与排期）。
 *
 * knownStreaks 省略时回退读 masteryStore 当前状态。
 * TODO(merge): HomeScreen 目前只传 marks + markedAt（不在本次改动范围），集成时让它订阅
 * `useMasteryStore((s) => s.knownStreaks)` 并显式传入第 4 个参数，然后删掉这个回退。
 */
export function mergeBankReviewRecords(
  bankId: string,
  marks: Record<string, Record<string, Mastery>>,
  markedAt: Record<string, Record<string, number>>,
  knownStreaks: StreakTable = readStoreStreaks(),
): BankReviewRecords {
  const bankMarks = marks[bankId];
  if (!bankMarks) return {};
  const bankMarkedAt = markedAt[bankId] ?? {};
  const bankStreaks = knownStreaks[bankId] ?? {};

  const records: BankReviewRecords = {};
  for (const [questionId, mastery] of Object.entries(bankMarks)) {
    const markedAtMs = bankMarkedAt[questionId];
    if (typeof markedAtMs !== 'number' || !Number.isFinite(markedAtMs)) continue;
    const record: ReviewRecord = { mastery, markedAt: markedAtMs };
    if (mastery === 'known') record.knownStreak = normalizeKnownStreak(mastery, bankStreaks[questionId]);
    records[questionId] = record;
  }
  return records;
}

function readStoreStreaks(): StreakTable {
  try {
    // 运行时惰性读取，避免 masteryStore ⇄ spaced-review 的静态循环依赖
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useMasteryStore } = require('../store/masteryStore') as typeof import('../store/masteryStore');
    return useMasteryStore.getState().knownStreaks;
  } catch {
    return {};
  }
}

/** 单库到期题 id 列表：到期过滤 + 最久未复习优先，同刻按题目 id 决胜 */
export function computeDueQuestionIds(records: BankReviewRecords, now: number): string[] {
  return Object.entries(records)
    .filter(([, record]) => isReviewDue(record, now))
    .sort(([leftId, left], [rightId, right]) => left.markedAt - right.markedAt || leftId.localeCompare(rightId))
    .map(([questionId]) => questionId);
}
