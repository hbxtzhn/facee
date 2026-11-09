import { openNodeBankDatabase } from '../db/node-sqlite';
import { getSchemaVersion, migrate, MIGRATIONS, SCHEMA_VERSION } from '../db/schema';

describe('数据库迁移与 node:sqlite 适配器', () => {
  it('空库迁移到最新版本，重复执行不变', async () => {
    const db = openNodeBankDatabase();
    expect(await getSchemaVersion(db)).toBe(0);
    expect(await migrate(db)).toBe(0);
    expect(await getSchemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(await migrate(db)).toBe(SCHEMA_VERSION);
    const tables = await db.getAllAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type IN ('table') ORDER BY name");
    const names = tables.map((t) => t.name);
    for (const table of ['banks', 'questions', 'progress', 'keypoint_checks', 'user_sections', 'question_fts', 'app_settings']) {
      expect(names).toContain(table);
    }
    await db.closeAsync();
  });

  it('按版本逐个执行追加的迁移；失败的迁移整体回滚且版本号不变', async () => {
    const db = openNodeBankDatabase();
    await migrate(db);
    const extra = [...MIGRATIONS, 'CREATE TABLE extra_a (x INTEGER);', 'CREATE TABLE extra_b (x INTEGER); SELECT * FROM missing_table;'];
    await expect(migrate(db, extra)).rejects.toThrow();
    expect(await getSchemaVersion(db)).toBe(SCHEMA_VERSION + 1);
    const extraB = await db.getFirstAsync("SELECT name FROM sqlite_master WHERE name = 'extra_b'");
    expect(extraB).toBeNull();
    await db.closeAsync();
  });

  it('数据库版本高于 App 时拒绝', async () => {
    const db = openNodeBankDatabase();
    await db.execAsync('PRAGMA user_version = 99');
    await expect(migrate(db)).rejects.toThrow('请升级 App');
    await db.closeAsync();
  });

  it('FTS5 trigram 可用，且独占事务失败时回滚', async () => {
    const db = openNodeBankDatabase();
    await migrate(db);
    await db.runAsync('INSERT INTO question_fts (bank_id, question_id, title, body) VALUES (?, ?, ?, ?)', ['b', 'q', 'Redis 过期策略', '惰性删除']);
    const hit = await db.getAllAsync<{ question_id: string }>('SELECT question_id FROM question_fts WHERE question_fts MATCH ?', ['"过期策"']);
    expect(hit).toEqual([{ question_id: 'q' }]);

    await expect(
      db.withExclusiveTransactionAsync(async (tx) => {
        await tx.runAsync("INSERT INTO app_settings (key, value) VALUES ('k', 'v')");
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await db.getFirstAsync("SELECT * FROM app_settings WHERE key = 'k'")).toBeNull();
    await db.closeAsync();
  });
});
