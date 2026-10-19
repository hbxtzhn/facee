import { getBankReadingProgress } from './catalog';
import { TEST_QUESTION_BANK } from './fixture';

it('切到未刷过的题库，不使用其他题库的累计题数计算进度', () => {
  expect(getBankReadingProgress(TEST_QUESTION_BANK.catalog, ['other-1', 'other-2']))
    .toEqual({ viewedCount: 0, totalCount: 6, ratio: 0 });
});

it('仅计算当前目录仍存在的已刷题，重复记录不重复计数', () => {
  const ids = TEST_QUESTION_BANK.catalog.questions.map((q) => q.id);
  expect(getBankReadingProgress(TEST_QUESTION_BANK.catalog, [ids[0], ids[0], ids[1], 'deleted-question']))
    .toEqual({ viewedCount: 2, totalCount: 6, ratio: 2 / 6 });
});

it('无题库或空题库时进度为零', () => {
  expect(getBankReadingProgress(null, ['old'])).toEqual({ viewedCount: 0, totalCount: 0, ratio: 0 });
  expect(getBankReadingProgress({ ...TEST_QUESTION_BANK.catalog, questions: [] }, ['old']))
    .toEqual({ viewedCount: 0, totalCount: 0, ratio: 0 });
});
