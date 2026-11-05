import type { Mastery } from './model';

/**
 * 间隔复习排期（移植自 v1 src/lib/spaced-review.ts，口径不变）：
 *
 *   1. 不会 1 天 / 模糊 3 天（两者都把「连续会了」清零）；
 *   2. 会了按连续次数扩张：第 1 次 7 天，第 2 次 14 天，第 3 次 30 天，第 4 次起 60 天封顶；
 *   3. 打标即排期：每次打标刷新 markedAt，dueAt = markedAt + 当前间隔；
 *   4. 清除标记（null）= 退出复习循环；
 *   5. 到期 = 距上次打标已满当前间隔（整边界即算到期）；
 *   6. 之前就是「会了」：已到期（完成了一次复习）再确认 ⇒ 连续次数 +1；
 *      未到期的重复确认 ⇒ 保持不变，避免短时间连点把间隔刷到 60 天。
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

export const REVIEW_INTERVAL_MS: Record<Mastery, number> = {
  unknown: 1 * DAY_MS,
  fuzzy: 3 * DAY_MS,
  known: 7 * DAY_MS,
};

/** 「会了」的扩张阶梯：下标 = 连续会了次数 - 1，超出取最后一档 */
export const KNOWN_INTERVAL_LADDER_MS: readonly number[] = [7, 14, 30, 60].map((days) => days * DAY_MS);

export interface ReviewRecord {
  mastery: Mastery;
  markedAt: number;
  /** 连续「会了」次数（仅 known 有意义，缺省按 1） */
  streak?: number;
}

export function normalizeStreak(mastery: Mastery, streak: number | undefined | null): number {
  if (mastery !== 'known') return 0;
  return typeof streak === 'number' && Number.isInteger(streak) && streak >= 1 ? streak : 1;
}

export function reviewIntervalMs(mastery: Mastery, streak?: number | null): number {
  if (mastery !== 'known') return REVIEW_INTERVAL_MS[mastery];
  const normalized = normalizeStreak(mastery, streak);
  return KNOWN_INTERVAL_LADDER_MS[Math.min(normalized, KNOWN_INTERVAL_LADDER_MS.length) - 1];
}

export function isReviewDue(record: ReviewRecord, now: number): boolean {
  return now - record.markedAt >= reviewIntervalMs(record.mastery, record.streak);
}

export function nextStreak(previous: ReviewRecord | null, next: Mastery, now: number): number {
  if (next !== 'known') return 0;
  if (!previous || previous.mastery !== 'known') return 1;
  const streak = normalizeStreak('known', previous.streak);
  return isReviewDue(previous, now) ? streak + 1 : streak;
}

/** 打标后的完整排期 */
export function scheduleMark(previous: ReviewRecord | null, next: Mastery, now: number): { streak: number; dueAt: number } {
  const streak = nextStreak(previous, next, now);
  return { streak, dueAt: now + reviewIntervalMs(next, streak) };
}
