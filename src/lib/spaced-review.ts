import type { Mastery } from '../store/masteryStore';

/**
 * 间隔复习的计入口径（评审定稿，纯逻辑便于单测）：
 *
 *   1. 三档掌握度即复习间隔：不会 1 天 / 模糊 3 天 / 掌握 7 天；
 *   2. 打标即排期：每次打标（含复习时重新打标）刷新 markedAt，到期时间顺延；
 *   3. 清除标记（null）= 退出复习循环；
 *   4. 到期 = 距上次打标已满该档间隔（整边界即算到期）；
 *   5. 复习队列按上次打标时间升序（最久没碰的最先），同刻按题目 id 稳定排序。
 *
 * 单题记录与掌握度表（masteryStore）一一对应；时间全部用 epoch 毫秒。
 */

export const REVIEW_INTERVAL_MS: Record<Mastery, number> = {
  unknown: 1 * 24 * 60 * 60 * 1000,
  fuzzy: 3 * 24 * 60 * 60 * 1000,
  known: 7 * 24 * 60 * 60 * 1000,
};

/** 一道题的复习档案：当前掌握度 + 最后一次打标时间 */
export interface ReviewRecord {
  mastery: Mastery;
  markedAt: number;
}

export type BankReviewRecords = Record<string, ReviewRecord>;

/** 是否到期：now 距上次打标已满该档间隔 */
export function isReviewDue(record: ReviewRecord, now: number): boolean {
  return now - record.markedAt >= REVIEW_INTERVAL_MS[record.mastery];
}

/**
 * 从 masteryStore 的两个平行切片（marks + markedAt）合成单库复习档案。
 * 缺时间戳的旧条目跳过（理论上只出现在迁移前的极端脏数据，不参与排期）。
 */
export function mergeBankReviewRecords(
  bankId: string,
  marks: Record<string, Record<string, Mastery>>,
  markedAt: Record<string, Record<string, number>>,
): BankReviewRecords {
  const bankMarks = marks[bankId];
  if (!bankMarks) return {};
  const bankMarkedAt = markedAt[bankId] ?? {};

  const records: BankReviewRecords = {};
  for (const [questionId, mastery] of Object.entries(bankMarks)) {
    const markedAtMs = bankMarkedAt[questionId];
    if (typeof markedAtMs !== 'number' || !Number.isFinite(markedAtMs)) continue;
    records[questionId] = { mastery, markedAt: markedAtMs };
  }
  return records;
}

/** 单库到期题 id 列表：到期过滤 + 最久未复习优先，同刻按题目 id 决胜（口径第 5 条） */
export function computeDueQuestionIds(records: BankReviewRecords, now: number): string[] {
  return Object.entries(records)
    .filter(([, record]) => isReviewDue(record, now))
    .sort(([leftId, left], [rightId, right]) => left.markedAt - right.markedAt || leftId.localeCompare(rightId))
    .map(([questionId]) => questionId);
}
