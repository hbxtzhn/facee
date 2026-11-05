import type { SqlExecutor, SqlValue } from './db/types';
import { BANK_CONTENT_TABLES } from './db/schema';
import type { BankMeta, Bundle, Question } from './types';

/**
 * 题库表的写入原语（安装器与本地题库共用）。只写题库表，不碰学习数据表。
 */

export type BankOrigin = 'remote' | 'local' | 'file';

/** 一条 INSERT 的最大行数（参数总数远低于 SQLite 32766 上限） */
const BATCH_ROWS = 100;

export async function insertMany(
  tx: SqlExecutor,
  table: string,
  columns: readonly string[],
  rows: readonly SqlValue[][],
  verb = 'INSERT',
): Promise<void> {
  const rowPlaceholder = `(${columns.map(() => '?').join(', ')})`;
  for (let start = 0; start < rows.length; start += BATCH_ROWS) {
    const batch = rows.slice(start, start + BATCH_ROWS);
    await tx.runAsync(
      `${verb} INTO ${table} (${columns.join(', ')}) VALUES ${batch.map(() => rowPlaceholder).join(', ')}`,
      batch.flat(),
    );
  }
}

export function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

/** 搜索正文：一句话、要点、题目补充、详解、示例、易错点、追问、选项 */
export function buildSearchBody(question: Question): string {
  const parts: string[] = [question.answer.summary];
  for (const kp of question.answer.keyPoints) parts.push(kp.text);
  if (question.prompt) parts.push(question.prompt);
  if (question.answer.detail) parts.push(question.answer.detail);
  if (question.answer.examples) parts.push(question.answer.examples);
  for (const pitfall of question.answer.pitfalls ?? []) parts.push(pitfall);
  for (const followup of question.followups) parts.push(followup.q, followup.a);
  if (question.choice) {
    for (const option of question.choice.options) parts.push(option.text);
    if (question.choice.explanation) parts.push(question.choice.explanation);
  }
  // 资源引用对搜索无意义
  return parts.join('\n').replace(/asset:[0-9a-f]{64}\.[a-z]+/g, '');
}

export async function insertQuestionRows(tx: SqlExecutor, bankId: string, questions: readonly Question[], startSort = 0): Promise<void> {
  await insertMany(
    tx,
    'questions',
    ['bank_id', 'id', 'title', 'type', 'difficulty', 'importance', 'category_id', 'summary', 'sort', 'data', 'content_hash'],
    questions.map((q, index) => [
      bankId, q.id, q.title, q.type, q.difficulty, q.importance, q.categoryId, q.answer.summary,
      startSort + index, JSON.stringify(q), q.contentHash,
    ]),
  );
  await insertMany(
    tx,
    'question_tags',
    ['bank_id', 'question_id', 'tag_id'],
    questions.flatMap((q) => Array.from(new Set(q.tags)).map((tag) => [bankId, q.id, tag])),
  );
  await insertMany(
    tx,
    'question_fts',
    ['bank_id', 'question_id', 'title', 'body'],
    questions.map((q) => [bankId, q.id, q.title, buildSearchBody(q)]),
  );
}

export async function deleteQuestionRows(tx: SqlExecutor, bankId: string, questionId: string): Promise<void> {
  await tx.runAsync('DELETE FROM questions WHERE bank_id = ? AND id = ?', [bankId, questionId]);
  await tx.runAsync('DELETE FROM question_tags WHERE bank_id = ? AND question_id = ?', [bankId, questionId]);
  await tx.runAsync('DELETE FROM question_fts WHERE bank_id = ? AND question_id = ?', [bankId, questionId]);
}

export async function deleteBankContent(tx: SqlExecutor, bankId: string): Promise<void> {
  for (const table of BANK_CONTENT_TABLES) {
    await tx.runAsync(`DELETE FROM ${table} WHERE bank_id = ?`, [bankId]);
  }
}

export async function writeTaxonomyRows(tx: SqlExecutor, bundle: Pick<Bundle, 'bank' | 'categories' | 'tags' | 'collections' | 'lifecycle'>): Promise<void> {
  const bankId = bundle.bank.id;
  await insertMany(
    tx,
    'categories',
    ['bank_id', 'id', 'name', 'description', 'sort', 'position'],
    bundle.categories.map((c, index) => [bankId, c.id, c.name, c.description ?? null, c.order ?? 1000, index]),
  );
  await insertMany(
    tx,
    'tags',
    ['bank_id', 'id', 'name', 'parent_id', 'sort', 'position'],
    bundle.tags.map((t, index) => [bankId, t.id, t.name, t.parent ?? null, t.order ?? 1000, index]),
  );
  await insertMany(
    tx,
    'collections',
    ['bank_id', 'id', 'name', 'description', 'question_ids', 'position'],
    bundle.collections.map((c, index) => [bankId, c.id, c.name, c.description ?? null, JSON.stringify(c.questions), index]),
  );
  await insertMany(
    tx,
    'lifecycle',
    ['bank_id', 'question_id', 'kind', 'target_id'],
    [
      ...bundle.lifecycle.removed.map((id) => [bankId, id, 'removed', null] as SqlValue[]),
      ...Object.entries(bundle.lifecycle.merged).map(([from, to]) => [bankId, from, 'merged', to] as SqlValue[]),
    ],
    'INSERT OR REPLACE',
  );
}

export interface BankRowInput {
  meta: BankMeta;
  origin: BankOrigin;
  manifestUrl: string | null;
  assetDir: string | null;
  assetsSha256: string | null;
  publishedAt: string | null;
  now: number;
}

/** upsert banks 行；installed_at 首次写入后保持不变 */
export async function upsertBankRow(tx: SqlExecutor, input: BankRowInput): Promise<void> {
  const { meta } = input;
  await tx.runAsync(
    `INSERT INTO banks (id, origin, name, version, locale, description, meta, manifest_url, fallback_url, feedback_url,
       asset_dir, assets_sha256, published_at, installed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET origin = excluded.origin, name = excluded.name, version = excluded.version,
       locale = excluded.locale, description = excluded.description, meta = excluded.meta,
       manifest_url = excluded.manifest_url, fallback_url = excluded.fallback_url, feedback_url = excluded.feedback_url,
       asset_dir = excluded.asset_dir, assets_sha256 = excluded.assets_sha256, published_at = excluded.published_at,
       updated_at = excluded.updated_at`,
    [
      meta.id, input.origin, meta.name, meta.version, meta.locale ?? 'zh-CN', meta.description ?? null, JSON.stringify(meta),
      input.manifestUrl, meta.update?.fallback ?? null, meta.feedbackUrl ?? null,
      input.assetDir, input.assetsSha256, input.publishedAt, input.now, input.now,
    ],
  );
}
