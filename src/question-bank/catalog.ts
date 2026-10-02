import type {
  Question,
  QuestionBankCatalog,
  QuestionFilter,
  QuestionTag,
} from './types';

/** Pure catalog queries shared by the native repository and screens. */
export function filterCatalogQuestions(
  catalog: QuestionBankCatalog,
  filter: QuestionFilter = {},
): Question[] {
  const query = (filter.query ?? '').trim().toLocaleLowerCase();
  const allowedTagIds = filter.tagId ? collectTagSubtreeIds(catalog.tags, filter.tagId) : null;
  // 标签 chips 多选：并集，父标签自动含子孙（§6.4）；父子同选由 Set 天然去重
  const chipTagIds = new Set<string>();
  for (const tagId of filter.tagIds ?? []) {
    for (const id of collectTagSubtreeIds(catalog.tags, tagId)) chipTagIds.add(id);
  }
  const difficulties = filter.difficulties && filter.difficulties.length > 0 ? filter.difficulties : null;

  return catalog.questions
    .filter((question) => {
      if (difficulties && !difficulties.includes(question.difficulty)) return false;
      if (filter.categoryId && (question.categoryId ?? null) !== filter.categoryId) return false;
      if (query && !question.title.toLocaleLowerCase().includes(query)) return false;
      if (allowedTagIds && !question.tags.some((tag) => allowedTagIds.has(tag.id))) return false;
      if (chipTagIds.size > 0 && !question.tags.some((tag) => chipTagIds.has(tag.id))) return false;
      return true;
    })
    .sort((left, right) => left.sort - right.sort || left.id.localeCompare(right.id));
}

/** 分类摘要（含题数），按 sort/id 稳定排序。题库未提供分类时返回空数组。 */
export function buildCategorySummaries(
  catalog: QuestionBankCatalog,
): { id: string; name: string; description?: string; questionCount: number }[] {
  if (!catalog.categories || catalog.categories.length === 0) return [];

  const counts = new Map<string, number>();
  for (const question of catalog.questions) {
    const categoryId = question.categoryId ?? null;
    if (!categoryId) continue;
    counts.set(categoryId, (counts.get(categoryId) ?? 0) + 1);
  }

  return [...catalog.categories]
    .sort((left, right) => left.sort - right.sort || left.id.localeCompare(right.id))
    .map((category) => ({
      id: category.id,
      name: category.name,
      ...(category.description ? { description: category.description } : {}),
      questionCount: counts.get(category.id) ?? 0,
    }));
}

/** 题目所属分类名（§7.1）；题库未提供分类或 id 未知时返回 null。 */
export function findCategoryName(
  catalog: QuestionBankCatalog | null,
  categoryId?: string | null,
): string | null {
  if (!catalog || !categoryId) return null;
  return catalog.categories?.find((category) => category.id === categoryId)?.name ?? null;
}

export function collectTagSubtreeIds(tags: readonly QuestionTag[], rootId: string): Set<string> {
  if (!tags.some((tag) => tag.id === rootId)) return new Set();

  const children = new Map<string, string[]>();
  for (const tag of tags) {
    const siblings = children.get(tag.parentId ?? '') ?? [];
    siblings.push(tag.id);
    children.set(tag.parentId ?? '', siblings);
  }

  const ids = new Set<string>();
  const pending = [rootId];
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (ids.has(id)) continue;
    ids.add(id);
    pending.push(...(children.get(id) ?? []));
  }
  return ids;
}
