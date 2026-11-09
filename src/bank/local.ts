import { BankError } from './errors';
import {
  insertQuestionRows,
  upsertBankRow,
  writeTaxonomyRows,
  deleteBankContent,
} from './bank-rows';
import { computeContentHash } from './hash';
import { applyLifecycle } from './lifecycle';
import { joinUri } from './platform';
import type { SqlExecutor } from './db/types';
import type { BankRuntime } from './runtime-types';
import { newQuestionId, ulid } from './ulid';
import { validateBundle, validationError } from './validate';
import {
  BANK_SCHEMA_VERSION,
  SLUG_ID_PATTERN,
  type Answer,
  type BankMeta,
  type Bundle,
  type Category,
  type Collection,
  type Followup,
  type KeyPoint,
  type Lifecycle,
  type Question,
  type Tag,
} from './types';

/**
 * 本地自建题库（§6.1 origin = 'local'）。
 *
 * - 题库 id：`local/device/<ULID>`。BANK_ID_PATTERN 要求三段，第一段 `local` 不是域名，
 *   不会与 `<host>/<owner>/<repo>` 形式的在线题库冲突；导出再导入时 id 不变，仍按本地题库（可编辑）处理。
 * - 题目 id `q_<ULID>`；要点 / 追问 id `kpN` / `fN`，题内单调递增、删除后不复用
 *   （计数器存在 app_settings 的 `local_counter:<bankId>:<questionId>` 键，
 *   导出到别的设备后按现存最大编号续号）。
 * - contentHash 与构建工具同一算法：`sha256:` + 去掉 contentHash 的题目规范化 JSON（键排序、无空白）。
 * - 每次修改都用与远程题库相同的 validateBundle 校验整库，不放宽规则；版本号 patch 位自增。
 * - 删除题目会写入 lifecycle.removed（学习数据归档），并从其它题的 related / prerequisites、专题中摘除。
 */

export const LOCAL_BANK_PREFIX = 'local/device/';
const DEFAULT_CATEGORY: Category = { id: 'default', name: '默认分类', order: 1000 };

function now(rt: BankRuntime): number {
  return rt.now ? rt.now() : Date.now();
}

export function isLocalBankId(bankId: string): boolean {
  return bankId.startsWith('local/');
}

// ---------- 读出整库为 Bundle ----------

/** 从数据库还原某题库的 bundle（任何来源均可；本地题库导出 / 备份使用） */
export async function exportBundle(rt: BankRuntime | { db: SqlExecutor }, bankId: string): Promise<Bundle> {
  const db = rt.db;
  const bank = await db.getFirstAsync<{ meta: string; version: string; name: string; description: string | null }>(
    'SELECT meta, version, name, description FROM banks WHERE id = ?',
    [bankId],
  );
  if (!bank) throw new BankError('not-found', '题库不存在');
  const meta = { ...(JSON.parse(bank.meta) as BankMeta), id: bankId, name: bank.name, version: bank.version };
  if (bank.description) meta.description = bank.description;
  else delete meta.description;
  const categories = (
    await db.getAllAsync<{ id: string; name: string; description: string | null; sort: number }>(
      'SELECT id, name, description, sort FROM categories WHERE bank_id = ? ORDER BY position, id',
      [bankId],
    )
  ).map((c): Category => ({ id: c.id, name: c.name, order: c.sort, ...(c.description ? { description: c.description } : {}) }));
  const tags = (
    await db.getAllAsync<{ id: string; name: string; parent_id: string | null; sort: number; description: string | null; aliases: string | null }>(
      'SELECT id, name, parent_id, sort, description, aliases FROM tags WHERE bank_id = ? ORDER BY position, id',
      [bankId],
    )
  ).map(
    (t): Tag => ({
      id: t.id,
      name: t.name,
      parent: t.parent_id,
      order: t.sort,
      ...(t.description ? { description: t.description } : {}),
      ...(t.aliases ? { aliases: JSON.parse(t.aliases) as string[] } : {}),
    }),
  );
  const collections = (
    await db.getAllAsync<{ id: string; name: string; description: string | null; question_ids: string }>(
      'SELECT id, name, description, question_ids FROM collections WHERE bank_id = ? ORDER BY position, id',
      [bankId],
    )
  ).map((c): Collection => ({
    id: c.id,
    name: c.name,
    ...(c.description ? { description: c.description } : {}),
    questions: JSON.parse(c.question_ids) as string[],
  }));
  const lifecycleRows = await db.getAllAsync<{ question_id: string; kind: string; target_id: string | null }>(
    'SELECT question_id, kind, target_id FROM lifecycle WHERE bank_id = ? ORDER BY question_id',
    [bankId],
  );
  const lifecycle: Lifecycle = { removed: [], merged: {} };
  for (const row of lifecycleRows) {
    if (row.kind === 'removed') lifecycle.removed.push(row.question_id);
    else if (row.kind === 'merged' && row.target_id) lifecycle.merged[row.question_id] = row.target_id;
  }
  const questions = (
    await db.getAllAsync<{ data: string }>('SELECT data FROM questions WHERE bank_id = ? ORDER BY sort, id', [bankId])
  ).map((row) => JSON.parse(row.data) as Question);
  return { schemaVersion: BANK_SCHEMA_VERSION, bank: meta, categories, tags, collections, lifecycle, questions };
}

/** 把题库导出为 bundle.json 文件（缓存目录），返回文件 URI；可分享、可用 addBankFromBundleFile 再导入 */
export async function exportBundleFile(rt: BankRuntime, bankId: string): Promise<string> {
  const bundle = await exportBundle(rt, bankId);
  const dir = joinUri(rt.platform.cacheDirectory, 'bank-exports/');
  await rt.platform.makeDirectory(dir);
  const safeName = bundle.bank.name.replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40) || 'bank';
  const uri = joinUri(dir, `${safeName}-${bundle.bank.version}.json`);
  await rt.platform.writeText(uri, JSON.stringify(bundle, null, 2));
  return uri;
}

// ---------- 写回整库 ----------

function bumpPatch(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) return '1.0.0';
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

async function requireLocalBank(rt: BankRuntime, bankId: string): Promise<void> {
  const row = await rt.db.getFirstAsync<{ origin: string }>('SELECT origin FROM banks WHERE id = ?', [bankId]);
  if (!row) throw new BankError('not-found', '题库不存在');
  if (row.origin !== 'local') throw new BankError('forbidden', '只能编辑本地自建题库');
}

/**
 * 读出整库 → 交给 mutate 修改 → 整库校验 → 单事务写回（题库表整体替换，学习数据只做 lifecycle 迁移）。
 * 本地题库规模小（百级），整库重写换来与安装器完全一致的不变量。
 */
async function mutateLocalBank<T>(rt: BankRuntime, bankId: string, mutate: (bundle: Bundle) => T): Promise<T> {
  await requireLocalBank(rt, bankId);
  const bundle = await exportBundle(rt, bankId);
  const result = mutate(bundle);
  bundle.bank.version = bumpPatch(bundle.bank.version);
  const validation = validateBundle(bundle);
  if (!validation.ok) throw validationError('本地题库', validation.errors);
  const timestamp = now(rt);
  await rt.db.withExclusiveTransactionAsync(async (tx) => {
    const row = await tx.getFirstAsync<{ asset_dir: string | null; assets_sha256: string | null }>(
      'SELECT asset_dir, assets_sha256 FROM banks WHERE id = ?',
      [bankId],
    );
    await deleteBankContent(tx, bankId);
    await upsertBankRow(tx, {
      meta: bundle.bank,
      origin: 'local',
      manifestUrl: null,
      assetDir: row?.asset_dir ?? null,
      assetsSha256: row?.assets_sha256 ?? null,
      publishedAt: null,
      now: timestamp,
    });
    await writeTaxonomyRows(tx, bundle);
    await insertQuestionRows(tx, bankId, bundle.questions);
    await applyLifecycle(tx, bankId, timestamp);
  });
  return result;
}

// ---------- 题库 ----------

export interface LocalBankInput {
  name: string;
  description?: string;
  locale?: string;
}

/** 新建本地题库（带一个「默认分类」），返回题库 id */
export async function createLocalBank(rt: BankRuntime, input: LocalBankInput): Promise<string> {
  const name = input.name?.trim();
  if (!name) throw new BankError('invalid', '题库名称不能为空');
  const bankId = `${LOCAL_BANK_PREFIX}${ulid(now(rt))}`;
  const meta: BankMeta = {
    id: bankId,
    name,
    version: '1.0.0',
    locale: input.locale ?? 'zh-CN',
    ...(input.description?.trim() ? { description: input.description.trim() } : {}),
  };
  const bundle: Bundle = {
    schemaVersion: BANK_SCHEMA_VERSION,
    bank: meta,
    categories: [DEFAULT_CATEGORY],
    tags: [],
    collections: [],
    lifecycle: { removed: [], merged: {} },
    questions: [],
  };
  const validation = validateBundle(bundle);
  if (!validation.ok) throw validationError('本地题库', validation.errors);
  const timestamp = now(rt);
  await rt.db.withExclusiveTransactionAsync(async (tx) => {
    await upsertBankRow(tx, { meta, origin: 'local', manifestUrl: null, assetDir: null, assetsSha256: null, publishedAt: null, now: timestamp });
    await writeTaxonomyRows(tx, bundle);
  });
  return bankId;
}

export async function updateLocalBankInfo(rt: BankRuntime, bankId: string, input: Partial<LocalBankInput>): Promise<void> {
  await mutateLocalBank(rt, bankId, (bundle) => {
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new BankError('invalid', '题库名称不能为空');
      bundle.bank.name = name;
    }
    if (input.description !== undefined) {
      if (input.description.trim()) bundle.bank.description = input.description.trim();
      else delete bundle.bank.description;
    }
    if (input.locale !== undefined) bundle.bank.locale = input.locale;
  });
}

// ---------- 分类 / 标签 ----------

function newSlug(prefix: string, rt: BankRuntime): string {
  return `${prefix}-${ulid(now(rt)).toLowerCase()}`;
}

function checkSlug(id: string, label: string): void {
  if (!SLUG_ID_PATTERN.test(id)) throw new BankError('invalid', `${label} id 只能包含小写字母、数字和连字符：${id}`);
}

export interface LocalCategoryInput {
  /** 缺省自动生成 */
  id?: string;
  name: string;
  order?: number;
  description?: string;
}

export async function addLocalCategory(rt: BankRuntime, bankId: string, input: LocalCategoryInput): Promise<string> {
  const id = input.id ?? newSlug('c', rt);
  checkSlug(id, '分类');
  return mutateLocalBank(rt, bankId, (bundle) => {
    if (bundle.categories.some((c) => c.id === id)) throw new BankError('invalid', `分类 id 已存在：${id}`);
    const order = input.order ?? Math.max(0, ...bundle.categories.map((c) => c.order ?? 1000)) + 10;
    bundle.categories.push({ id, name: input.name.trim(), order, ...(input.description ? { description: input.description } : {}) });
    return id;
  });
}

export async function updateLocalCategory(rt: BankRuntime, bankId: string, categoryId: string, input: Partial<Omit<LocalCategoryInput, 'id'>>): Promise<void> {
  await mutateLocalBank(rt, bankId, (bundle) => {
    const category = bundle.categories.find((c) => c.id === categoryId);
    if (!category) throw new BankError('not-found', '分类不存在');
    if (input.name !== undefined) category.name = input.name.trim();
    if (input.order !== undefined) category.order = input.order;
    if (input.description !== undefined) {
      if (input.description) category.description = input.description;
      else delete category.description;
    }
  });
}

/** 按给定顺序重排分类（order 依次设为 10、20…） */
export async function reorderLocalCategories(rt: BankRuntime, bankId: string, orderedIds: string[]): Promise<void> {
  await mutateLocalBank(rt, bankId, (bundle) => {
    const ids = bundle.categories.map((c) => c.id).sort();
    const next = [...orderedIds].sort();
    if (ids.length !== next.length || ids.some((id, i) => id !== next[i])) throw new BankError('invalid', '分类排序必须包含全部分类');
    orderedIds.forEach((id, index) => {
      const category = bundle.categories.find((c) => c.id === id) as Category;
      category.order = (index + 1) * 10;
    });
    bundle.categories.sort((a, b) => orderedIds.indexOf(a.id) - orderedIds.indexOf(b.id));
  });
}

/** 删除分类；分类下仍有题目时需指定 moveQuestionsTo，否则拒绝 */
export async function deleteLocalCategory(rt: BankRuntime, bankId: string, categoryId: string, options: { moveQuestionsTo?: string } = {}): Promise<void> {
  await mutateLocalBank(rt, bankId, (bundle) => {
    if (!bundle.categories.some((c) => c.id === categoryId)) throw new BankError('not-found', '分类不存在');
    const affected = bundle.questions.filter((q) => q.categoryId === categoryId);
    if (affected.length > 0) {
      const target = options.moveQuestionsTo;
      if (!target || target === categoryId || !bundle.categories.some((c) => c.id === target)) {
        throw new BankError('invalid', `分类下还有 ${affected.length} 道题，请先指定要移入的分类`);
      }
      for (const question of affected) {
        question.categoryId = target;
        question.contentHash = computeContentHash(question);
      }
    }
    bundle.categories = bundle.categories.filter((c) => c.id !== categoryId);
  });
}

export interface LocalTagInput {
  id?: string;
  name: string;
  parent?: string | null;
  order?: number;
}

export async function addLocalTag(rt: BankRuntime, bankId: string, input: LocalTagInput): Promise<string> {
  const id = input.id ?? newSlug('t', rt);
  checkSlug(id, '标签');
  return mutateLocalBank(rt, bankId, (bundle) => {
    if (bundle.tags.some((t) => t.id === id)) throw new BankError('invalid', `标签 id 已存在：${id}`);
    bundle.tags.push({ id, name: input.name.trim(), parent: input.parent ?? null, ...(input.order !== undefined ? { order: input.order } : {}) });
    return id;
  });
}

export async function updateLocalTag(rt: BankRuntime, bankId: string, tagId: string, input: Partial<Omit<LocalTagInput, 'id'>>): Promise<void> {
  await mutateLocalBank(rt, bankId, (bundle) => {
    const tag = bundle.tags.find((t) => t.id === tagId);
    if (!tag) throw new BankError('not-found', '标签不存在');
    if (input.name !== undefined) tag.name = input.name.trim();
    if (input.parent !== undefined) tag.parent = input.parent;
    if (input.order !== undefined) tag.order = input.order;
  });
}

/** 删除标签：从题目上摘除，子标签挂到被删标签的父标签下 */
export async function deleteLocalTag(rt: BankRuntime, bankId: string, tagId: string): Promise<void> {
  await mutateLocalBank(rt, bankId, (bundle) => {
    const tag = bundle.tags.find((t) => t.id === tagId);
    if (!tag) throw new BankError('not-found', '标签不存在');
    for (const child of bundle.tags) if (child.parent === tagId) child.parent = tag.parent;
    bundle.tags = bundle.tags.filter((t) => t.id !== tagId);
    for (const question of bundle.questions) {
      if (!question.tags.includes(tagId)) continue;
      question.tags = question.tags.filter((t) => t !== tagId);
      question.contentHash = computeContentHash(question);
    }
  });
}

// ---------- 题目 ----------

/** 编辑输入：要点 / 追问的 id 可省略（新增条目自动分配）；保留 id 表示修改原条目 */
export interface LocalQuestionInput {
  title: string;
  type: Question['type'];
  difficulty: Question['difficulty'];
  importance: Question['importance'];
  categoryId: string;
  tags?: string[];
  appliesTo?: string[];
  prerequisites?: string[];
  related?: string[];
  prompt?: string | null;
  answer: Omit<Answer, 'keyPoints'> & { keyPoints: Array<Omit<KeyPoint, 'id' | 'weight'> & { id?: string; weight?: KeyPoint['weight'] }> };
  choice?: Question['choice'];
  followups?: Array<Omit<Followup, 'id'> & { id?: string }>;
  source?: Question['source'];
  references?: Question['references'];
  reviewedAt?: string;
  estimatedMinutes?: number;
}

function maxSuffix(ids: string[], prefix: string): number {
  let max = 0;
  for (const id of ids) {
    if (!id.startsWith(prefix)) continue;
    const n = Number.parseInt(id.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

async function getCounters(rt: BankRuntime, bankId: string, question: Question | null): Promise<{ kp: number; f: number }> {
  const row = question
    ? await rt.db.getFirstAsync<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', [counterKey(bankId, question.id)])
    : null;
  let stored = { kp: 0, f: 0 };
  try {
    if (row) stored = JSON.parse(row.value) as typeof stored;
  } catch {
    // 计数器损坏时按现存最大编号续号
  }
  return {
    kp: Math.max(stored.kp ?? 0, maxSuffix(question?.answer.keyPoints.map((k) => k.id) ?? [], 'kp')),
    f: Math.max(stored.f ?? 0, maxSuffix(question?.followups.map((f) => f.id) ?? [], 'f')),
  };
}

function counterKey(bankId: string, questionId: string): string {
  return `local_counter:${bankId}:${questionId}`;
}

/** 由输入构造题目（分配要点 / 追问 id、计算 contentHash）；只输出规范字段，空的可选字段省略 */
function buildQuestion(id: string, input: LocalQuestionInput, previous: Question | null, counters: { kp: number; f: number }): Question {
  const previousKp = new Set(previous?.answer.keyPoints.map((k) => k.id) ?? []);
  const previousF = new Set(previous?.followups.map((f) => f.id) ?? []);
  const keyPoints: KeyPoint[] = input.answer.keyPoints.map((kp) => {
    if (kp.id !== undefined && !previousKp.has(kp.id)) throw new BankError('invalid', `要点 id ${kp.id} 不属于该题，新增要点请省略 id`);
    return { id: kp.id ?? `kp${(counters.kp += 1)}`, text: kp.text.trim(), weight: kp.weight ?? 1 };
  });
  const followups: Followup[] = (input.followups ?? []).map((f) => {
    if (f.id !== undefined && !previousF.has(f.id)) throw new BankError('invalid', `追问 id ${f.id} 不属于该题，新增追问请省略 id`);
    return { id: f.id ?? `f${(counters.f += 1)}`, q: f.q.trim(), a: f.a };
  });
  const answer: Answer = { summary: input.answer.summary.trim(), keyPoints };
  if (input.answer.detail) answer.detail = input.answer.detail;
  if (input.answer.examples) answer.examples = input.answer.examples;
  if (input.answer.pitfalls && input.answer.pitfalls.length > 0) answer.pitfalls = input.answer.pitfalls;
  const question: Omit<Question, 'contentHash'> = {
    id,
    title: input.title.trim(),
    type: input.type,
    difficulty: input.difficulty,
    importance: input.importance,
    categoryId: input.categoryId,
    tags: input.tags ?? [],
    ...(input.appliesTo && input.appliesTo.length > 0 ? { appliesTo: input.appliesTo } : {}),
    ...(input.prerequisites && input.prerequisites.length > 0 ? { prerequisites: input.prerequisites } : {}),
    ...(input.related && input.related.length > 0 ? { related: input.related } : {}),
    prompt: input.prompt ? input.prompt : null,
    answer,
    choice: input.type === 'choice' ? (input.choice ?? null) : null,
    followups,
    ...(input.source ? { source: input.source } : {}),
    ...(input.references && input.references.length > 0 ? { references: input.references } : {}),
    ...(input.reviewedAt ? { reviewedAt: input.reviewedAt } : {}),
    ...(input.estimatedMinutes !== undefined ? { estimatedMinutes: input.estimatedMinutes } : {}),
  };
  return { ...question, contentHash: computeContentHash(question) };
}

async function saveCounters(rt: BankRuntime, bankId: string, questionId: string, counters: { kp: number; f: number }): Promise<void> {
  await rt.db.runAsync('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [counterKey(bankId, questionId), JSON.stringify(counters)]);
}

/** 新增题目，返回题目 id */
export async function addLocalQuestion(rt: BankRuntime, bankId: string, input: LocalQuestionInput): Promise<Question> {
  const id = newQuestionId(now(rt));
  const counters = await getCounters(rt, bankId, null);
  const question = buildQuestion(id, input, null, counters);
  await mutateLocalBank(rt, bankId, (bundle) => {
    bundle.questions.push(question);
  });
  await saveCounters(rt, bankId, id, counters);
  return question;
}

/** 修改题目（整体替换为 input；要点 / 追问按 id 对应） */
export async function updateLocalQuestion(rt: BankRuntime, bankId: string, questionId: string, input: LocalQuestionInput): Promise<Question> {
  const row = await rt.db.getFirstAsync<{ data: string }>('SELECT data FROM questions WHERE bank_id = ? AND id = ?', [bankId, questionId]);
  if (!row) throw new BankError('not-found', '题目不存在');
  const previous = JSON.parse(row.data) as Question;
  const counters = await getCounters(rt, bankId, previous);
  const question = buildQuestion(questionId, input, previous, counters);
  await mutateLocalBank(rt, bankId, (bundle) => {
    const index = bundle.questions.findIndex((q) => q.id === questionId);
    if (index === -1) throw new BankError('not-found', '题目不存在');
    bundle.questions[index] = question;
  });
  await saveCounters(rt, bankId, questionId, counters);
  return question;
}

/** 删除题目：写入 lifecycle.removed（学习数据归档）并清理其它题与专题对它的引用 */
export async function deleteLocalQuestion(rt: BankRuntime, bankId: string, questionId: string): Promise<void> {
  await mutateLocalBank(rt, bankId, (bundle) => {
    if (!bundle.questions.some((q) => q.id === questionId)) throw new BankError('not-found', '题目不存在');
    bundle.questions = bundle.questions.filter((q) => q.id !== questionId);
    for (const question of bundle.questions) {
      const prerequisites = question.prerequisites?.filter((id) => id !== questionId);
      const related = question.related?.filter((id) => id !== questionId);
      if (prerequisites?.length === question.prerequisites?.length && related?.length === question.related?.length) continue;
      if (prerequisites && prerequisites.length > 0) question.prerequisites = prerequisites;
      else delete question.prerequisites;
      if (related && related.length > 0) question.related = related;
      else delete question.related;
      question.contentHash = computeContentHash(question);
    }
    for (const collection of bundle.collections) collection.questions = collection.questions.filter((id) => id !== questionId);
    if (!bundle.lifecycle.removed.includes(questionId)) bundle.lifecycle.removed.push(questionId);
  });
  await rt.db.runAsync('DELETE FROM app_settings WHERE key = ?', [counterKey(bankId, questionId)]);
}

/** 题目在本地题库内的排序：按给定 id 顺序（必须是全部题目的排列） */
export async function reorderLocalQuestions(rt: BankRuntime, bankId: string, orderedIds: string[]): Promise<void> {
  await mutateLocalBank(rt, bankId, (bundle) => {
    const ids = bundle.questions.map((q) => q.id).sort();
    const next = [...orderedIds].sort();
    if (ids.length !== next.length || ids.some((id, i) => id !== next[i])) throw new BankError('invalid', '题目排序必须包含全部题目');
    const position = new Map(orderedIds.map((id, index) => [id, index]));
    bundle.questions.sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0));
  });
}

