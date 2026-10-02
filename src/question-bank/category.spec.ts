import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseCatalog } from './schema';
import { buildCategorySummaries, filterCatalogQuestions, findCategoryName } from './catalog';

/** 基准同样取自 GitHub 上真实发布的题库（含 categories / categoryId）。 */
const catalog = parseCatalog(
  JSON.parse(
    readFileSync(join(__dirname, '__fixtures__', 'published-catalog.json'), 'utf8'),
  ),
);

describe('分类（§5.1 / §7.1）', () => {
  it('按 sort/id 稳定输出分类及题数', () => {
    const summaries = buildCategorySummaries(catalog);

    expect(summaries.map((item) => item.id)).toEqual([
      'java-basic', 'jvm', 'spring', 'mysql', 'redis', 'mq', 'network', 'os', 'distributed',
    ]);
    // 每类题数之和 = 题目总数
    const total = summaries.reduce((sum, item) => sum + item.questionCount, 0);
    expect(total).toBe(catalog.questions.length);
    expect(summaries.find((item) => item.id === 'jvm')?.questionCount).toBe(4);
  });

  it('分类名可反查（详情页「所属分类」）', () => {
    expect(findCategoryName(catalog, 'jvm')).toBe('JVM');
    expect(findCategoryName(catalog, 'distributed')).toBe('分布式系统');
    expect(findCategoryName(catalog, null)).toBeNull();
    expect(findCategoryName(catalog, 'nope')).toBeNull();
    expect(findCategoryName(null, 'jvm')).toBeNull();
  });

  it('题库未提供分类时返回空数组（旧格式不回归）', () => {
    const legacy = parseCatalog({
      schemaVersion: 1,
      id: 'legacy',
      title: '旧格式',
      tags: [{ id: 'java', name: 'Java', parentId: null, sort: 10 }],
      questions: [
        { id: 'q-01', title: 'Q', difficulty: 1, hasAnswer: true, sort: 10, tags: [{ id: 'java', name: 'Java' }] },
      ],
    });

    expect(buildCategorySummaries(legacy)).toEqual([]);
    expect(findCategoryName(legacy, 'java')).toBeNull();
  });

  it('按分类筛选题目', () => {
    const jvm = filterCatalogQuestions(catalog, { categoryId: 'jvm' });

    expect(jvm).toHaveLength(4);
    expect(jvm.every((question) => question.categoryId === 'jvm')).toBe(true);
  });

  it('分类与难度、关键词可以叠加，且排序稳定', () => {
    const hard = filterCatalogQuestions(catalog, { categoryId: 'jvm', difficulties: [3] });
    expect(hard.map((question) => question.id)).toEqual(['jvm-gc-02']);

    // 目前只搜标题（正文全文搜索是 §6.2 的后续项），所以「垃圾」只命中 jvm-gc-02 的标题
    const keyword = filterCatalogQuestions(catalog, { categoryId: 'jvm', query: '垃圾' });
    expect(keyword.map((question) => question.id)).toEqual(['jvm-gc-02']);

    // 同 order 值（本库多题共用 order）时按 id 字典序回退，保证每次顺序一致
    const twice = filterCatalogQuestions(catalog, { categoryId: 'jvm' });
    expect(twice.map((question) => question.id)).toEqual(
      filterCatalogQuestions(catalog, { categoryId: 'jvm' }).map((question) => question.id),
    );
  });

  it('不传筛选条件时返回全部题目', () => {
    expect(filterCatalogQuestions(catalog)).toHaveLength(catalog.questions.length);
  });
});
