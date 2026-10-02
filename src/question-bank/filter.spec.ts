import { describe, expect, it } from '@jest/globals';
import { TEST_QUESTION_BANK } from './fixture';
import { collectTagSubtreeIds, filterCatalogQuestions } from './catalog';

describe('question-bank local filtering', () => {
  it('includes descendants when filtering by a parent tag', () => {
    const backendIds = collectTagSubtreeIds(TEST_QUESTION_BANK.catalog.tags, 'backend');
    expect([...backendIds].sort()).toEqual(['backend', 'database', 'java'].sort());
    expect(filterCatalogQuestions(TEST_QUESTION_BANK.catalog, { tagId: 'backend' })).toHaveLength(4);
  });

  it('combines case-insensitive query and difficulty filters (§6.3 多选)', () => {
    const results = filterCatalogQuestions(TEST_QUESTION_BANK.catalog, {
      query: '缓存',
      difficulties: [2],
    });
    expect(results.map((question) => question.id)).toEqual(['fixture-arch-002']);
  });

  it('难度多选按并集过滤；空数组视为不限', () => {
    const union = filterCatalogQuestions(TEST_QUESTION_BANK.catalog, { difficulties: [1, 3] });
    expect(union.map((question) => question.id).sort()).toEqual([
      'fixture-arch-001',
      'fixture-db-001',
      'fixture-db-002',
      'fixture-java-001',
    ]);
    expect(filterCatalogQuestions(TEST_QUESTION_BANK.catalog, { difficulties: [] })).toHaveLength(6);
  });

  it('标签多选按并集过滤（父含子孙），父子同选去重', () => {
    const union = filterCatalogQuestions(TEST_QUESTION_BANK.catalog, { tagIds: ['java', 'database'] });
    expect(union).toHaveLength(4);
    const deduped = filterCatalogQuestions(TEST_QUESTION_BANK.catalog, { tagIds: ['backend', 'java'] });
    expect(deduped).toHaveLength(4);
  });

  it('tagId（范围）与 tagIds（chips 收窄）叠加时取交集语义', () => {
    const narrowed = filterCatalogQuestions(TEST_QUESTION_BANK.catalog, {
      tagId: 'backend',
      tagIds: ['database'],
    });
    expect(narrowed.map((question) => question.id).sort()).toEqual(['fixture-db-001', 'fixture-db-002']);
  });

  it('returns stable sort order and no results for an unknown tag', () => {
    const all = filterCatalogQuestions(TEST_QUESTION_BANK.catalog);
    expect(all.map((question) => question.sort)).toEqual([10, 20, 30, 40, 50, 60]);
    expect(filterCatalogQuestions(TEST_QUESTION_BANK.catalog, { tagId: 'does-not-exist' })).toEqual([]);
  });
});
