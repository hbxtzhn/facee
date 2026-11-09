import type { BankDatabase } from './types';

/**
 * SQLite 表结构与版本化迁移（docs/题库规范-v2-草案.md §6）。
 *
 * 版本号记在 `PRAGMA user_version`；每个迁移在一个独占事务内执行并同时写入新版本号，
 * 失败整体回滚。新增迁移只能追加到 MIGRATIONS 末尾，已发布的迁移不得修改。
 *
 * 表分两组：
 * - 题库表（BANK_TABLES）：安装 / 更新时按 bank_id 整库删除重建；
 * - 学习数据表（LEARNING_TABLES）：永不随题库安装 / 更新删除，只有 lifecycle 迁移会改写它们。
 */

/** 题库表：安装 / 更新时按 bank_id 整体替换（banks 本身单独 upsert） */
export const BANK_CONTENT_TABLES = [
  'questions',
  'question_tags',
  'categories',
  'tags',
  'collections',
  'lifecycle',
  'question_fts',
] as const;

/** 学习数据表：只在 lifecycle 迁移、用户操作、备份恢复、显式清除学习数据时改写 */
export const LEARNING_TABLES = [
  'progress',
  'keypoint_checks',
  'followup_progress',
  'favorites',
  'sessions',
  'user_sections',
  'user_section_categories',
] as const;

const MIGRATION_1 = `
CREATE TABLE banks (
  id TEXT PRIMARY KEY NOT NULL,
  origin TEXT NOT NULL,              -- 'remote' | 'local' | 'file'
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  locale TEXT,
  description TEXT,
  meta TEXT NOT NULL,                -- bundle.bank 完整 JSON
  manifest_url TEXT,
  fallback_url TEXT,
  feedback_url TEXT,
  asset_dir TEXT,                    -- 当前资源目录名（bank-assets/ 下），无资源为 NULL
  assets_sha256 TEXT,                -- 当前资源 ZIP 的 sha256，相同则更新时复用
  published_at TEXT,
  installed_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  checked_at INTEGER,
  check_result TEXT                  -- 最近一次 checkForUpdate 的 JSON 结果
);

CREATE TABLE questions (
  bank_id TEXT NOT NULL,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  importance INTEGER NOT NULL,
  category_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  sort INTEGER NOT NULL,             -- bundle 内顺序
  data TEXT NOT NULL,                -- 该题完整 JSON（bundle 中的对象）
  content_hash TEXT NOT NULL,
  PRIMARY KEY (bank_id, id)
);
CREATE INDEX questions_category ON questions (bank_id, category_id, sort);

CREATE TABLE question_tags (
  bank_id TEXT NOT NULL, question_id TEXT NOT NULL, tag_id TEXT NOT NULL,
  PRIMARY KEY (bank_id, question_id, tag_id)
);
CREATE INDEX question_tags_tag ON question_tags (bank_id, tag_id);

CREATE TABLE categories (
  bank_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, description TEXT,
  sort INTEGER NOT NULL, position INTEGER NOT NULL,
  PRIMARY KEY (bank_id, id)
);
CREATE TABLE tags (
  bank_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, parent_id TEXT,
  sort INTEGER NOT NULL, position INTEGER NOT NULL,
  PRIMARY KEY (bank_id, id)
);
CREATE TABLE collections (
  bank_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, description TEXT,
  question_ids TEXT NOT NULL,        -- JSON 数组
  position INTEGER NOT NULL,
  PRIMARY KEY (bank_id, id)
);
CREATE TABLE lifecycle (
  bank_id TEXT NOT NULL, question_id TEXT NOT NULL,
  kind TEXT NOT NULL,                -- 'removed' | 'merged'
  target_id TEXT,
  PRIMARY KEY (bank_id, question_id)
);

CREATE VIRTUAL TABLE question_fts USING fts5(
  bank_id UNINDEXED, question_id UNINDEXED, title, body, tokenize = 'trigram'
);

CREATE TABLE progress (
  bank_id TEXT NOT NULL, question_id TEXT NOT NULL,
  mastery TEXT,                      -- unknown | fuzzy | known；NULL = 未打标（只浏览过）
  streak INTEGER NOT NULL DEFAULT 0, -- 连续「会了」次数
  due_at INTEGER,
  marked_at INTEGER,
  seen_hash TEXT,
  viewed_at INTEGER,
  archived_at INTEGER,               -- 题目被 lifecycle.removed 时打上
  updated_at INTEGER NOT NULL,       -- 备份合并用
  PRIMARY KEY (bank_id, question_id)
);
CREATE INDEX progress_due ON progress (bank_id, due_at);

CREATE TABLE keypoint_checks (
  bank_id TEXT NOT NULL, question_id TEXT NOT NULL, keypoint_id TEXT NOT NULL,
  checked_at INTEGER NOT NULL,       -- 同一次自评的所有要点共用该时间戳
  covered INTEGER NOT NULL,
  PRIMARY KEY (bank_id, question_id, keypoint_id, checked_at)
);
CREATE TABLE followup_progress (
  bank_id TEXT NOT NULL, question_id TEXT NOT NULL, followup_id TEXT NOT NULL,
  mastery TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (bank_id, question_id, followup_id)
);
CREATE TABLE favorites (
  bank_id TEXT NOT NULL, question_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  archived_at INTEGER,
  PRIMARY KEY (bank_id, question_id)
);
CREATE TABLE sessions (
  bank_id TEXT PRIMARY KEY NOT NULL,
  queue TEXT NOT NULL, idx INTEGER NOT NULL, mode TEXT NOT NULL, title TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE user_sections (
  bank_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL,
  sort INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY (bank_id, id)
);
CREATE TABLE user_section_categories (
  bank_id TEXT NOT NULL, section_id TEXT NOT NULL, category_id TEXT NOT NULL, sort INTEGER NOT NULL,
  PRIMARY KEY (bank_id, section_id, category_id)
);

CREATE TABLE app_settings (key TEXT PRIMARY KEY NOT NULL, value TEXT);
`;

/** 标签范围说明与同义词（规范 v2 §2.3 tags[].description / aliases）；aliases 存 JSON 数组 */
const MIGRATION_2 = `
ALTER TABLE tags ADD COLUMN description TEXT;
ALTER TABLE tags ADD COLUMN aliases TEXT;
`;

/** 下标 i 的迁移把 user_version 从 i 升到 i + 1 */
export const MIGRATIONS: readonly string[] = [MIGRATION_1, MIGRATION_2];

export const SCHEMA_VERSION = MIGRATIONS.length;

export async function getSchemaVersion(db: BankDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  return row?.user_version ?? 0;
}

/** 把数据库迁移到最新版本；返回迁移前的版本号。比 App 新的库直接报错，避免旧 App 误写。 */
export async function migrate(db: BankDatabase, migrations: readonly string[] = MIGRATIONS): Promise<number> {
  const from = await getSchemaVersion(db);
  if (from > migrations.length) {
    throw new Error(`本地数据库版本 ${from} 高于当前 App 支持的 ${migrations.length}，请升级 App`);
  }
  for (let version = from; version < migrations.length; version += 1) {
    await db.withExclusiveTransactionAsync(async (tx) => {
      await tx.execAsync(migrations[version]);
      await tx.execAsync(`PRAGMA user_version = ${version + 1}`);
    });
  }
  return from;
}
