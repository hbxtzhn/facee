import { BankError } from './errors';
import { ulid } from './ulid';
import type { BankRuntime } from './runtime-types';

/**
 * 自定义分区（issue #3）：用户在分类之上建的个人目录，只引用分类 id，不改题库。
 * 属于学习数据层，不随题库更新删除；引用的分类在更新后消失时，分区保留、
 * 该分类以 `exists: false` 返回（UI 显示「已不在题库中」并可移除）。
 */

export interface SectionCategory {
  id: string;
  /** 分类不在题库中时为 null */
  name: string | null;
  exists: boolean;
  questionCount: number;
}

export interface SectionInfo {
  id: string;
  name: string;
  order: number;
  categories: SectionCategory[];
}

const MAX_NAME_LENGTH = 30;

function now(rt: BankRuntime): number {
  return rt.now ? rt.now() : Date.now();
}

function cleanName(name: string): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) throw new BankError('invalid', '分区名称不能为空');
  if ([...trimmed].length > MAX_NAME_LENGTH) throw new BankError('invalid', `分区名称不能超过 ${MAX_NAME_LENGTH} 个字`);
  return trimmed;
}

async function requireSection(rt: BankRuntime, bankId: string, sectionId: string): Promise<void> {
  const row = await rt.db.getFirstAsync<{ id: string }>('SELECT id FROM user_sections WHERE bank_id = ? AND id = ?', [bankId, sectionId]);
  if (!row) throw new BankError('not-found', '分区不存在');
}

async function touch(rt: BankRuntime, bankId: string, sectionId: string): Promise<void> {
  await rt.db.runAsync('UPDATE user_sections SET updated_at = ? WHERE bank_id = ? AND id = ?', [now(rt), bankId, sectionId]);
}

export async function listSections(rt: BankRuntime, bankId: string): Promise<SectionInfo[]> {
  const sections = await rt.db.getAllAsync<{ id: string; name: string; sort: number }>(
    'SELECT id, name, sort FROM user_sections WHERE bank_id = ? ORDER BY sort, created_at, id',
    [bankId],
  );
  const links = await rt.db.getAllAsync<{ section_id: string; category_id: string; name: string | null; question_count: number }>(
    `SELECT l.section_id, l.category_id, c.name,
       (SELECT COUNT(*) FROM questions q WHERE q.bank_id = l.bank_id AND q.category_id = l.category_id) AS question_count
     FROM user_section_categories l LEFT JOIN categories c ON c.bank_id = l.bank_id AND c.id = l.category_id
     WHERE l.bank_id = ? ORDER BY l.section_id, l.sort, l.category_id`,
    [bankId],
  );
  return sections.map((section) => ({
    id: section.id,
    name: section.name,
    order: section.sort,
    categories: links
      .filter((link) => link.section_id === section.id)
      .map((link) => ({
        id: link.category_id,
        name: link.name ?? null,
        exists: link.name !== null && link.name !== undefined,
        questionCount: link.question_count,
      })),
  }));
}

/** 新建分区（排在最后），返回分区 id */
export async function createSection(rt: BankRuntime, bankId: string, name: string): Promise<string> {
  const clean = cleanName(name);
  const bank = await rt.db.getFirstAsync<{ id: string }>('SELECT id FROM banks WHERE id = ?', [bankId]);
  if (!bank) throw new BankError('not-found', '题库不存在');
  const max = await rt.db.getFirstAsync<{ m: number | null }>('SELECT MAX(sort) AS m FROM user_sections WHERE bank_id = ?', [bankId]);
  const id = `s_${ulid(now(rt))}`;
  const timestamp = now(rt);
  await rt.db.runAsync(
    'INSERT INTO user_sections (bank_id, id, name, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [bankId, id, clean, (max?.m ?? -1) + 1, timestamp, timestamp],
  );
  return id;
}

export async function renameSection(rt: BankRuntime, bankId: string, sectionId: string, name: string): Promise<void> {
  const clean = cleanName(name);
  await requireSection(rt, bankId, sectionId);
  await rt.db.runAsync('UPDATE user_sections SET name = ?, updated_at = ? WHERE bank_id = ? AND id = ?', [clean, now(rt), bankId, sectionId]);
}

export async function deleteSection(rt: BankRuntime, bankId: string, sectionId: string): Promise<void> {
  await rt.db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync('DELETE FROM user_section_categories WHERE bank_id = ? AND section_id = ?', [bankId, sectionId]);
    await tx.runAsync('DELETE FROM user_sections WHERE bank_id = ? AND id = ?', [bankId, sectionId]);
  });
}

function assertPermutation(current: string[], next: string[], label: string): void {
  const a = [...current].sort();
  const b = [...next].sort();
  if (a.length !== b.length || a.some((id, index) => id !== b[index])) {
    throw new BankError('invalid', `${label}排序必须包含且仅包含现有的全部项`);
  }
}

/** 按给定顺序重排分区（必须是现有分区 id 的完整排列） */
export async function reorderSections(rt: BankRuntime, bankId: string, orderedIds: string[]): Promise<void> {
  const current = (await rt.db.getAllAsync<{ id: string }>('SELECT id FROM user_sections WHERE bank_id = ?', [bankId])).map((r) => r.id);
  assertPermutation(current, orderedIds, '分区');
  const timestamp = now(rt);
  await rt.db.withExclusiveTransactionAsync(async (tx) => {
    for (const [index, id] of orderedIds.entries()) {
      await tx.runAsync('UPDATE user_sections SET sort = ?, updated_at = ? WHERE bank_id = ? AND id = ?', [index, timestamp, bankId, id]);
    }
  });
}

/** 把分类加入分区末尾（分类须在题库中存在；已在分区内则忽略） */
export async function addCategoryToSection(rt: BankRuntime, bankId: string, sectionId: string, categoryId: string): Promise<void> {
  await requireSection(rt, bankId, sectionId);
  const category = await rt.db.getFirstAsync<{ id: string }>('SELECT id FROM categories WHERE bank_id = ? AND id = ?', [bankId, categoryId]);
  if (!category) throw new BankError('not-found', '分类不存在');
  const max = await rt.db.getFirstAsync<{ m: number | null }>(
    'SELECT MAX(sort) AS m FROM user_section_categories WHERE bank_id = ? AND section_id = ?',
    [bankId, sectionId],
  );
  await rt.db.runAsync(
    'INSERT OR IGNORE INTO user_section_categories (bank_id, section_id, category_id, sort) VALUES (?, ?, ?, ?)',
    [bankId, sectionId, categoryId, (max?.m ?? -1) + 1],
  );
  await touch(rt, bankId, sectionId);
}

/** 从分区移除分类（含「已不在题库中」的分类） */
export async function removeCategoryFromSection(rt: BankRuntime, bankId: string, sectionId: string, categoryId: string): Promise<void> {
  await rt.db.runAsync(
    'DELETE FROM user_section_categories WHERE bank_id = ? AND section_id = ? AND category_id = ?',
    [bankId, sectionId, categoryId],
  );
  await touch(rt, bankId, sectionId);
}

export async function reorderSectionCategories(rt: BankRuntime, bankId: string, sectionId: string, orderedCategoryIds: string[]): Promise<void> {
  await requireSection(rt, bankId, sectionId);
  const current = (
    await rt.db.getAllAsync<{ category_id: string }>(
      'SELECT category_id FROM user_section_categories WHERE bank_id = ? AND section_id = ?',
      [bankId, sectionId],
    )
  ).map((r) => r.category_id);
  assertPermutation(current, orderedCategoryIds, '分区内分类');
  await rt.db.withExclusiveTransactionAsync(async (tx) => {
    for (const [index, id] of orderedCategoryIds.entries()) {
      await tx.runAsync(
        'UPDATE user_section_categories SET sort = ? WHERE bank_id = ? AND section_id = ? AND category_id = ?',
        [index, bankId, sectionId, id],
      );
    }
    await tx.runAsync('UPDATE user_sections SET updated_at = ? WHERE bank_id = ? AND id = ?', [now(rt), bankId, sectionId]);
  });
}
