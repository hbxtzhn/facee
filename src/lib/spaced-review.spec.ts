import { describe, it, expect } from '@jest/globals';
import {
  REVIEW_INTERVAL_MS,
  computeDueQuestionIds,
  isReviewDue,
  mergeBankReviewRecords,
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
    );
    expect(merged).toEqual({
      q1: { mastery: 'fuzzy', markedAt: NOW - DAY },
      q2: { mastery: 'known', markedAt: NOW - 8 * DAY },
    });
  });

  it('mergeBankReviewRecords：没打过标的库返回空档案', () => {
    expect(mergeBankReviewRecords('none', { 'bank-a': { q1: 'known' } }, {})).toEqual({});
  });
});
