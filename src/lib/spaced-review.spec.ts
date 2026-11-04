import { describe, it, expect } from '@jest/globals';
import {
  KNOWN_INTERVAL_LADDER_MS,
  REVIEW_INTERVAL_MS,
  computeDueQuestionIds,
  isReviewDue,
  mergeBankReviewRecords,
  nextKnownStreak,
  reviewIntervalMs,
} from './spaced-review';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

function record(mastery: 'unknown' | 'fuzzy' | 'known', daysAgo: number) {
  return { mastery, markedAt: NOW - daysAgo * DAY };
}

describe('间隔复习口径（spaced-review）', () => {
  it('三档间隔是 1 / 3 / 7 天', () => {
    expect(REVIEW_INTERVAL_MS.unknown).toBe(1 * DAY);
    expect(REVIEW_INTERVAL_MS.fuzzy).toBe(3 * DAY);
    expect(REVIEW_INTERVAL_MS.known).toBe(7 * DAY);
  });

  it('到期判定：满整边界即算到期，差一毫秒不算', () => {
    expect(isReviewDue(record('unknown', 1), NOW)).toBe(true);
    expect(isReviewDue(record('unknown', 1 - 1 / DAY), NOW)).toBe(false);
    expect(isReviewDue(record('fuzzy', 3), NOW)).toBe(true);
    expect(isReviewDue(record('fuzzy', 2.5), NOW)).toBe(false);
    expect(isReviewDue(record('known', 7), NOW)).toBe(true);
    expect(isReviewDue(record('known', 6.9), NOW)).toBe(false);
  });

  it('刚打标的题不到期', () => {
    expect(isReviewDue(record('unknown', 0), NOW)).toBe(false);
  });

  it('computeDueQuestionIds 只含到期题，且最久未复习优先', () => {
    const records = {
      'q-known-fresh': record('known', 2), // 未到期
      'q-fuzzy-due-older': record('fuzzy', 5), // 到期，较久
      'q-unknown-due': record('unknown', 4), // 到期，较近
      'q-known-due': record('known', 9), // 到期，最久
    };
    expect(computeDueQuestionIds(records, NOW)).toEqual([
      'q-known-due', // 9 天前 > 5 天前 > 4 天前
      'q-fuzzy-due-older',
      'q-unknown-due',
    ]);
  });

  it('空档案 / 无到期时返回空数组', () => {
    expect(computeDueQuestionIds({}, NOW)).toEqual([]);
    expect(computeDueQuestionIds({ q1: record('known', 1) }, NOW)).toEqual([]);
  });

  it('同刻打标时按题目 id 决胜（v1 迁移整库同刻的场景）', () => {
    const sameAt = NOW - 8 * DAY;
    const records = {
      'q-10': { mastery: 'fuzzy' as const, markedAt: sameAt },
      'q-2': { mastery: 'fuzzy' as const, markedAt: sameAt },
      'q-1': { mastery: 'unknown' as const, markedAt: sameAt },
    };
    expect(computeDueQuestionIds(records, NOW)).toEqual(['q-1', 'q-10', 'q-2']);
  });

  it('mergeBankReviewRecords 合成单库档案，跳过缺时间戳的条目', () => {
    const merged = mergeBankReviewRecords(
      'bank-a',
      {
        'bank-a': { q1: 'fuzzy', q2: 'known', q3: 'unknown' },
        'bank-b': { q9: 'known' },
      },
      {
        'bank-a': { q1: NOW - DAY, q2: NOW - 8 * DAY }, // q3 缺时间戳
      },
      {},
    );
    expect(merged).toEqual({
      q1: { mastery: 'fuzzy', markedAt: NOW - DAY },
      // 连续次数表为空 ⇒ known 按首档 1 计
      q2: { mastery: 'known', markedAt: NOW - 8 * DAY, knownStreak: 1 },
    });
  });

  it('mergeBankReviewRecords：没打过标的库返回空档案', () => {
    expect(mergeBankReviewRecords('none', { 'bank-a': { q1: 'known' } }, {}, {})).toEqual({});
  });

  it('mergeBankReviewRecords 带上连续「会了」次数，非 known 不带', () => {
    const merged = mergeBankReviewRecords(
      'bank-a',
      { 'bank-a': { q1: 'known', q2: 'fuzzy' } },
      { 'bank-a': { q1: NOW - 20 * DAY, q2: NOW - DAY } },
      { 'bank-a': { q1: 3, q2: 5 } },
    );
    expect(merged).toEqual({
      q1: { mastery: 'known', markedAt: NOW - 20 * DAY, knownStreak: 3 },
      q2: { mastery: 'fuzzy', markedAt: NOW - DAY },
    });
    // 连续 3 次 ⇒ 30 天间隔，20 天前打标尚未到期
    expect(computeDueQuestionIds(merged, NOW)).toEqual([]);
  });
});

describe('扩张间隔（连续「会了」）', () => {
  it('不会 1 天 / 模糊 3 天，与连续次数无关', () => {
    expect(reviewIntervalMs('unknown', 4)).toBe(1 * DAY);
    expect(reviewIntervalMs('fuzzy', 4)).toBe(3 * DAY);
  });

  it('会了：7 → 14 → 30 → 60 天，之后封顶 60 天', () => {
    expect(reviewIntervalMs('known', 1)).toBe(7 * DAY);
    expect(reviewIntervalMs('known', 2)).toBe(14 * DAY);
    expect(reviewIntervalMs('known', 3)).toBe(30 * DAY);
    expect(reviewIntervalMs('known', 4)).toBe(60 * DAY);
    expect(reviewIntervalMs('known', 9)).toBe(60 * DAY);
    expect(KNOWN_INTERVAL_LADDER_MS.map((ms) => ms / DAY)).toEqual([7, 14, 30, 60]);
  });

  it('缺失 / 非法连续次数按 1 计（旧数据保持原 7 天排期）', () => {
    expect(reviewIntervalMs('known')).toBe(7 * DAY);
    expect(reviewIntervalMs('known', 0)).toBe(7 * DAY);
    expect(reviewIntervalMs('known', 1.5)).toBe(7 * DAY);
    expect(isReviewDue(record('known', 7), NOW)).toBe(true);
  });

  it('到期判定使用扩张后的间隔', () => {
    const at = (days: number, knownStreak: number) => ({ mastery: 'known' as const, markedAt: NOW - days * DAY, knownStreak });
    expect(isReviewDue(at(10, 2), NOW)).toBe(false);
    expect(isReviewDue(at(14, 2), NOW)).toBe(true);
    expect(isReviewDue(at(59, 4), NOW)).toBe(false);
    expect(isReviewDue(at(60, 7), NOW)).toBe(true);
  });

  it('nextKnownStreak：不会/模糊清零，首次会了为 1，到期复习 +1，未到期重复确认不变', () => {
    const known = (days: number, knownStreak?: number) => ({ mastery: 'known' as const, markedAt: NOW - days * DAY, knownStreak });
    expect(nextKnownStreak(known(30, 3), 'unknown', NOW)).toBe(0);
    expect(nextKnownStreak(known(30, 3), 'fuzzy', NOW)).toBe(0);
    expect(nextKnownStreak(null, 'known', NOW)).toBe(1);
    expect(nextKnownStreak(record('fuzzy', 5), 'known', NOW)).toBe(1);
    expect(nextKnownStreak(known(7, 1), 'known', NOW)).toBe(2);
    expect(nextKnownStreak(known(14, 2), 'known', NOW)).toBe(3);
    expect(nextKnownStreak(known(3, 2), 'known', NOW)).toBe(2);
    // 旧数据无连续次数：到期确认后进入第 2 档
    expect(nextKnownStreak(known(8), 'known', NOW)).toBe(2);
  });
});
