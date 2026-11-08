import { BankError } from './errors';
import { getAssetBaseUri, rewriteMarkdownAssets, type UpdateCheck } from './install';
import { getQuestionLearning } from './learning';
import { LEARNING_TABLES } from './db/schema';
import { deleteBankContent, placeholders } from './bank-rows';
import { joinUri } from './platform';
import type { SqlValue } from './db/types';
import type { BankRuntime } from './runtime-types';
import type { Question } from './types';
import type {
  BankSummary,
  CategoryInfo,
  CollectionInfo,
  Mastery,
  QuestionDetail,
  LinkedQuestion,
  QuestionFilter,
  QuestionListItem,
  SearchHit,
  TagInfo,
} from './model';

/**
 * 题库只读查询 + 题库级管理（列表、当前题库、删除）。
 * 列表 / 筛选 / 搜索只读冗余列与 FTS；详情读 `data` JSON。
 */

const ACTIVE_BANK_KEY = 'active_bank_id';

function now(rt: BankRuntime): number {
  return rt.now ? rt.now() : Date.now();
}

// ---------- 题库 ----------

interface BankRow {
  id: string;
  origin: BankSummary['origin'];
  name: string;
  version: string;
  locale: string | null;
  description: string | null;
  meta: string;
  manifest_url: string | null;
  feedback_url: string | null;
  installed_at: number;
  updated_at: number;
  checked_at: number | null;
  check_result: string | null;
  question_count: number;
}

function toSummary(row: BankRow): BankSummary {
  let meta: { homepage?: string; license?: string } = {};
  try {
    meta = JSON.parse(row.meta) as typeof meta;
  } catch {
    // meta 损坏不影响列表
  }
  let lastCheck: UpdateCheck | null = null;
  try {
    lastCheck = row.check_result ? (JSON.parse(row.check_result) as UpdateCheck) : null;
  } catch {
    lastCheck = null;
  }
  return {
    id: row.id,
    origin: row.origin,
    name: row.name,
    version: row.version,
    locale: row.locale ?? 'zh-CN',
    description: row.description,
    homepage: meta.homepage ?? null,
    license: meta.license ?? null,
    feedbackUrl: row.feedback_url,
    manifestUrl: row.manifest_url,
    questionCount: row.question_count,
    installedAt: row.installed_at,
    updatedAt: row.updated_at,
    checkedAt: row.checked_at,
    lastCheck,
  };
}

const BANK_SELECT = `SELECT b.*, (SELECT COUNT(*) FROM questions q WHERE q.bank_id = b.id) AS question_count FROM banks b`;

/** 全部已安装题库（按安装时间） */
export async function listBanks(rt: BankRuntime): Promise<BankSummary[]> {
  const rows = await rt.db.getAllAsync<BankRow>(`${BANK_SELECT} ORDER BY b.installed_at, b.id`);
  return rows.map(toSummary);
}

export async function getBank(rt: BankRuntime, bankId: string): Promise<BankSummary | null> {
  const row = await rt.db.getFirstAsync<BankRow>(`${BANK_SELECT} WHERE b.id = ?`, [bankId]);
  return row ? toSummary(row) : null;
}

/**
 * 持久化的当前题库 id；没有设置或指向的题库已不存在时，回退到最早安装的题库，
 * 并把这次回退选择写回——否则之后再装题库（或安装时间相同）时，回退结果可能变化，
 * 当前题库会在用户没操作的情况下悄悄切换。都没有题库时返回 null。
 */
export async function getActiveBankId(rt: BankRuntime): Promise<string | null> {
  const row = await rt.db.getFirstAsync<{ value: string | null }>('SELECT value FROM app_settings WHERE key = ?', [ACTIVE_BANK_KEY]);
  if (row?.value) {
    const exists = await rt.db.getFirstAsync<{ id: string }>('SELECT id FROM banks WHERE id = ?', [row.value]);
    if (exists) return row.value;
  }
  const first = await rt.db.getFirstAsync<{ id: string }>('SELECT id FROM banks ORDER BY installed_at, id LIMIT 1');
  if (!first) return null;
  await rt.db.runAsync('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [ACTIVE_BANK_KEY, first.id]);
  return first.id;
}

export async function setActiveBankId(rt: BankRuntime, bankId: string | null): Promise<void> {
  if (bankId) {
    const exists = await rt.db.getFirstAsync<{ id: string }>('SELECT id FROM banks WHERE id = ?', [bankId]);
    if (!exists) throw new BankError('not-found', '题库不存在');
  }
  await rt.db.runAsync('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [ACTIVE_BANK_KEY, bankId]);
}

/**
 * 删除题库（题库表 + 资源目录）。学习数据默认保留（重新安装同 id 题库后恢复），
 * `purgeLearningData: true` 时一并清除。
 */
export async function deleteBank(rt: BankRuntime, bankId: string, options: { purgeLearningData?: boolean } = {}): Promise<void> {
  const row = await rt.db.getFirstAsync<{ asset_dir: string | null }>('SELECT asset_dir FROM banks WHERE id = ?', [bankId]);
  if (!row) throw new BankError('not-found', '题库不存在');
  await rt.db.withExclusiveTransactionAsync(async (tx) => {
    await deleteBankContent(tx, bankId);
    await tx.runAsync('DELETE FROM banks WHERE id = ?', [bankId]);
    if (options.purgeLearningData) {
      for (const table of LEARNING_TABLES) await tx.runAsync(`DELETE FROM ${table} WHERE bank_id = ?`, [bankId]);
    }
    await tx.runAsync('DELETE FROM app_settings WHERE key = ? AND value = ?', [ACTIVE_BANK_KEY, bankId]);
  });
  if (row.asset_dir) await rt.platform.deletePath(joinUri(rt.platform.documentDirectory, row.asset_dir)).catch(() => undefined);
}

// ---------- 分类 / 标签 / 专题 ----------

export async function listCategories(rt: BankRuntime, bankId: string): Promise<CategoryInfo[]> {
  const rows = await rt.db.getAllAsync<{
    id: string; name: string; description: string | null; sort: number;
    question_count: number; marked_count: number; known_count: number;
  }>(
    `SELECT c.id, c.name, c.description, c.sort,
       (SELECT COUNT(*) FROM questions q WHERE q.bank_id = c.bank_id AND q.category_id = c.id) AS question_count,
       (SELECT COUNT(*) FROM questions q JOIN progress p ON p.bank_id = q.bank_id AND p.question_id = q.id
          WHERE q.bank_id = c.bank_id AND q.category_id = c.id AND p.mastery IS NOT NULL) AS marked_count,
       (SELECT COUNT(*) FROM questions q JOIN progress p ON p.bank_id = q.bank_id AND p.question_id = q.id
          WHERE q.bank_id = c.bank_id AND q.category_id = c.id AND p.mastery = 'known') AS known_count
     FROM categories c WHERE c.bank_id = ? ORDER BY c.sort, c.id`,
    [bankId],
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    order: row.sort,
    questionCount: row.question_count,
    markedCount: row.marked_count,
    knownCount: row.known_count,
  }));
}

interface TagRow { id: string; name: string; parent_id: string | null; sort: number; description: string | null; aliases: string | null }

async function loadTags(rt: BankRuntime, bankId: string): Promise<TagRow[]> {
  return rt.db.getAllAsync<TagRow>('SELECT id, name, parent_id, sort, description, aliases FROM tags WHERE bank_id = ? ORDER BY sort, id', [bankId]);
}

/** 标签及其全部子孙标签 id */
export function expandTagIds(tags: readonly { id: string; parent_id: string | null }[], roots: readonly string[]): string[] {
  const children = new Map<string, string[]>();
  for (const tag of tags) {
    if (!tag.parent_id) continue;
    const list = children.get(tag.parent_id) ?? [];
    list.push(tag.id);
    children.set(tag.parent_id, list);
  }
  const result = new Set<string>();
  const stack = [...roots];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (result.has(id)) continue;
    result.add(id);
    stack.push(...(children.get(id) ?? []));
  }
  return [...result];
}

export async function listTags(rt: BankRuntime, bankId: string): Promise<TagInfo[]> {
  const tags = await loadTags(rt, bankId);
  const links = await rt.db.getAllAsync<{ question_id: string; tag_id: string }>(
    'SELECT question_id, tag_id FROM question_tags WHERE bank_id = ?',
    [bankId],
  );
  const byTag = new Map<string, string[]>();
  for (const link of links) {
    const list = byTag.get(link.tag_id) ?? [];
    list.push(link.question_id);
    byTag.set(link.tag_id, list);
  }
  return tags.map((tag) => {
    const ids = new Set<string>();
    for (const id of expandTagIds(tags, [tag.id])) for (const q of byTag.get(id) ?? []) ids.add(q);
    return {
      id: tag.id,
      name: tag.name,
      parentId: tag.parent_id,
      order: tag.sort,
      description: tag.description,
      aliases: tag.aliases ? (JSON.parse(tag.aliases) as string[]) : [],
      childIds: tags.filter((t) => t.parent_id === tag.id).map((t) => t.id),
      questionCount: ids.size,
    };
  });
}

export async function listCollections(rt: BankRuntime, bankId: string): Promise<CollectionInfo[]> {
  const rows = await rt.db.getAllAsync<{ id: string; name: string; description: string | null; question_ids: string }>(
    'SELECT id, name, description, question_ids FROM collections WHERE bank_id = ? ORDER BY position, id',
    [bankId],
  );
  const existing = new Set(await getQuestionIds(rt, bankId));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    questionIds: parseIdList(row.question_ids).filter((id) => existing.has(id)),
  }));
}

function parseIdList(text: string | null): string[] {
  if (!text) return [];
  try {
    const value = JSON.parse(text) as unknown;
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/** 题库内全部题目 id（按分类顺序、题目顺序） */
export async function getQuestionIds(rt: BankRuntime, bankId: string): Promise<string[]> {
  const rows = await rt.db.getAllAsync<{ id: string }>(
    `SELECT q.id FROM questions q LEFT JOIN categories c ON c.bank_id = q.bank_id AND c.id = q.category_id
     WHERE q.bank_id = ? ORDER BY COALESCE(c.sort, 1000), q.category_id, q.sort, q.id`,
    [bankId],
  );
  return rows.map((row) => row.id);
}

// ---------- 列表 / 筛选 ----------

interface FilterSql {
  where: string[];
  params: SqlValue[];
  /** 专题筛选时的排序依据 */
  collectionOrder: string[] | null;
}

async function buildFilter(rt: BankRuntime, bankId: string, filter: QuestionFilter): Promise<FilterSql> {
  const where: string[] = ['q.bank_id = ?'];
  const params: SqlValue[] = [bankId];
  const inList = (column: string, values: readonly SqlValue[]) => {
    where.push(values.length === 0 ? '0' : `${column} IN (${placeholders(values.length)})`);
    params.push(...values);
  };
  if (filter.categoryIds) inList('q.category_id', filter.categoryIds);
  if (filter.difficulties) inList('q.difficulty', filter.difficulties);
  if (filter.types) inList('q.type', filter.types);
  if (filter.importance) inList('q.importance', filter.importance);
  if (filter.questionIds) inList('q.id', filter.questionIds);
  if (filter.tagIds) {
    const expanded = expandTagIds(await loadTags(rt, bankId), filter.tagIds);
    if (expanded.length === 0) where.push('0');
    else {
      where.push(`EXISTS (SELECT 1 FROM question_tags qt WHERE qt.bank_id = q.bank_id AND qt.question_id = q.id AND qt.tag_id IN (${placeholders(expanded.length)}))`);
      params.push(...expanded);
    }
  }
  let collectionOrder: string[] | null = null;
  if (filter.collectionId) {
    const row = await rt.db.getFirstAsync<{ question_ids: string }>(
      'SELECT question_ids FROM collections WHERE bank_id = ? AND id = ?',
      [bankId, filter.collectionId],
    );
    collectionOrder = parseIdList(row?.question_ids ?? null);
    inList('q.id', collectionOrder);
  }
  if (filter.mastery) {
    const marks = filter.mastery.filter((m): m is Mastery => m !== 'unmarked');
    const parts: string[] = [];
    if (marks.length > 0) {
      parts.push(`p.mastery IN (${placeholders(marks.length)})`);
      params.push(...marks);
    }
    if (filter.mastery.includes('unmarked')) parts.push('p.mastery IS NULL');
    where.push(parts.length > 0 ? `(${parts.join(' OR ')})` : '0');
  }
  if (filter.favoritesOnly) where.push('fav.question_id IS NOT NULL');
  if (filter.dueOnly) {
    where.push('p.mastery IS NOT NULL AND p.due_at <= ?');
    params.push(now(rt));
  }
  if (filter.updatedSinceSeen) where.push('p.seen_hash IS NOT NULL AND p.seen_hash <> q.content_hash');
  return { where, params, collectionOrder };
}

const LIST_JOINS = `
  LEFT JOIN progress p ON p.bank_id = q.bank_id AND p.question_id = q.id
  LEFT JOIN favorites fav ON fav.bank_id = q.bank_id AND fav.question_id = q.id
  LEFT JOIN categories c ON c.bank_id = q.bank_id AND c.id = q.category_id`;

const LIST_ORDER = 'ORDER BY COALESCE(c.sort, 1000), q.category_id, q.sort, q.id';

interface ListRow {
  id: string; title: string; type: QuestionListItem['type']; difficulty: QuestionListItem['difficulty'];
  importance: QuestionListItem['importance']; category_id: string; summary: string;
  mastery: Mastery | null; favorite: number; due_at: number | null; content_updated: number;
}

function sortByCollection<T extends { id: string }>(items: T[], order: string[] | null): T[] {
  if (!order) return items;
  const position = new Map(order.map((id, index) => [id, index]));
  return [...items].sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0));
}

/**
 * 按筛选条件列题（稳定排序：分类 order → 分类 id → 题目在 bundle 中的顺序 → 题目 id；
 * 指定专题时按专题顺序）。
 */
export async function listQuestions(rt: BankRuntime, bankId: string, filter: QuestionFilter = {}): Promise<QuestionListItem[]> {
  const { where, params, collectionOrder } = await buildFilter(rt, bankId, filter);
  const rows = await rt.db.getAllAsync<ListRow>(
    `SELECT q.id, q.title, q.type, q.difficulty, q.importance, q.category_id, q.summary,
       p.mastery, (fav.question_id IS NOT NULL) AS favorite, p.due_at,
       (p.seen_hash IS NOT NULL AND p.seen_hash <> q.content_hash) AS content_updated
     FROM questions q ${LIST_JOINS} WHERE ${where.join(' AND ')} ${LIST_ORDER}`,
    params,
  );
  return sortByCollection(
    rows.map((row) => ({
      id: row.id,
      title: row.title,
      type: row.type,
      difficulty: row.difficulty,
      importance: row.importance,
      categoryId: row.category_id,
      summary: row.summary,
      mastery: row.mastery ?? null,
      favorite: !!row.favorite,
      dueAt: row.mastery ? row.due_at : null,
      contentUpdated: !!row.content_updated,
    })),
    collectionOrder,
  );
}

// ---------- 详情 ----------

function rewriteQuestionAssets(question: Question, base: string | null): Question {
  if (!base) return question;
  return {
    ...question,
    prompt: rewriteMarkdownAssets(question.prompt, base),
    answer: {
      ...question.answer,
      detail: rewriteMarkdownAssets(question.answer.detail, base),
      examples: rewriteMarkdownAssets(question.answer.examples, base),
    },
    choice: question.choice ? { ...question.choice, explanation: rewriteMarkdownAssets(question.choice.explanation, base) } : null,
    followups: question.followups.map((f) => ({ ...f, a: rewriteMarkdownAssets(f.a, base) })),
  };
}

/** 读单题原始数据（不改写资源）；不存在返回 null */
export async function getRawQuestion(rt: BankRuntime, bankId: string, questionId: string): Promise<Question | null> {
  const row = await rt.db.getFirstAsync<{ data: string }>('SELECT data FROM questions WHERE bank_id = ? AND id = ?', [bankId, questionId]);
  return row ? (JSON.parse(row.data) as Question) : null;
}

/** 题目详情：解析 data、改写资源 URI、附带学习状态；不存在返回 null */
export async function getQuestion(rt: BankRuntime, bankId: string, questionId: string): Promise<QuestionDetail | null> {
  const raw = await getRawQuestion(rt, bankId, questionId);
  if (!raw) return null;
  const assetBaseUri = await getAssetBaseUri(rt, bankId);
  const category = await rt.db.getFirstAsync<{ name: string }>('SELECT name FROM categories WHERE bank_id = ? AND id = ?', [bankId, raw.categoryId]);
  return {
    bankId,
    question: rewriteQuestionAssets(raw, assetBaseUri),
    raw,
    categoryName: category?.name ?? null,
    assetBaseUri,
    learning: await getQuestionLearning(rt, bankId, raw),
    links: await getLinkedQuestions(rt, bankId, raw),
  };
}

/** 前置题 / 相关题的标题与掌握度；已不在题库中的引用省略 */
async function getLinkedQuestions(rt: BankRuntime, bankId: string, question: Question): Promise<QuestionDetail['links']> {
  const prerequisites = question.prerequisites ?? [];
  const related = question.related ?? [];
  const ids = Array.from(new Set([...prerequisites, ...related]));
  if (ids.length === 0) return { prerequisites: [], related: [] };
  const rows = await rt.db.getAllAsync<{ id: string; title: string; mastery: Mastery | null }>(
    `SELECT q.id, q.title, p.mastery FROM questions q
       LEFT JOIN progress p ON p.bank_id = q.bank_id AND p.question_id = q.id AND p.archived_at IS NULL
      WHERE q.bank_id = ? AND q.id IN (${ids.map(() => '?').join(', ')})`,
    [bankId, ...ids],
  );
  const byId = new Map(rows.map((row) => [row.id, { id: row.id, title: row.title, mastery: row.mastery ?? null }]));
  const pick = (list: string[]): LinkedQuestion[] => list.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  return { prerequisites: pick(prerequisites), related: pick(related) };
}

// ---------- 搜索 ----------

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function makeSnippet(text: string, terms: string[]): string {
  const flat = text.replace(/[#>*`|_~]+/g, ' ').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();
  const lower = flat.toLowerCase();
  let position = -1;
  for (const term of terms) {
    const found = lower.indexOf(term.toLowerCase());
    if (found !== -1 && (position === -1 || found < position)) position = found;
  }
  if (position === -1) return flat.slice(0, 60);
  const start = Math.max(0, position - 20);
  const end = Math.min(flat.length, position + 60);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}

/**
 * 题库内搜索标题与正文。按空白拆词，全部命中才算（AND）：
 * - 长度 ≥ 3 的词走 FTS5 trigram；
 * - 1–2 字的词（如「事务」）退回对同一 FTS 表的 LIKE 扫描。
 * 可叠加列表筛选条件；标题命中排在正文命中之前。
 */
export async function searchQuestions(
  rt: BankRuntime,
  bankId: string,
  query: string,
  options: { filter?: QuestionFilter; limit?: number } = {},
): Promise<SearchHit[]> {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const longTerms = terms.filter((term) => [...term].length >= 3);
  const shortTerms = terms.filter((term) => [...term].length < 3);
  const { where, params } = await buildFilter(rt, bankId, options.filter ?? {});
  const ftsWhere: string[] = ['question_fts.bank_id = ?'];
  const ftsParams: SqlValue[] = [bankId];
  if (longTerms.length > 0) {
    ftsWhere.push('question_fts MATCH ?');
    ftsParams.push(longTerms.map((term) => `"${term.replace(/"/g, '""')}"`).join(' '));
  }
  for (const term of shortTerms) {
    ftsWhere.push("(question_fts.title LIKE ? ESCAPE '\\' OR question_fts.body LIKE ? ESCAPE '\\')");
    const pattern = `%${escapeLike(term)}%`;
    ftsParams.push(pattern, pattern);
  }
  const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
  const rows = await rt.db.getAllAsync<{ id: string; title: string; category_id: string; body: string }>(
    `SELECT q.id, q.title, q.category_id, question_fts.body AS body
     FROM question_fts JOIN questions q ON q.bank_id = question_fts.bank_id AND q.id = question_fts.question_id
     ${LIST_JOINS}
     WHERE ${[...ftsWhere, ...where].join(' AND ')}
     ${longTerms.length > 0 ? 'ORDER BY question_fts.rank, q.id' : LIST_ORDER}
     LIMIT ?`,
    [...ftsParams, ...params, limit],
  );
  const hits = rows.map((row) => {
    const titleLower = row.title.toLowerCase();
    const inTitle = terms.some((term) => titleLower.includes(term.toLowerCase()));
    return {
      id: row.id,
      title: row.title,
      categoryId: row.category_id,
      snippet: makeSnippet(row.body, terms),
      matchedIn: inTitle ? ('title' as const) : ('body' as const),
    };
  });
  // 稳定排序：标题命中优先，其余保持 SQL 顺序
  return [...hits.filter((h) => h.matchedIn === 'title'), ...hits.filter((h) => h.matchedIn === 'body')];
}
