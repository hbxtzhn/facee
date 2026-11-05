import type { BankDatabase, SqlExecutor, SqlRunResult, SqlValue } from './types';

/**
 * 基于 Node 内置 node:sqlite（Node ≥ 22.5）的适配器，**仅供测试使用**。
 *
 * - 不被任何生产代码 import，Metro 不会把它打进 App；
 * - node:sqlite 自带的 SQLite（Node 22.20 为 3.50.x）开启了 FTS5，trigram 分词器可用，
 *   与 expo-sqlite 57 在 Android 上的能力一致，因此测试跑的是真实 SQL；
 * - 用一个异步互斥量模拟 expo 的独占事务：事务进行中，库上的其它调用排队等待。
 */

interface NodeStatement {
  run(...params: SqlValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  all(...params: SqlValue[]): unknown[];
  get(...params: SqlValue[]): unknown;
}

interface NodeDatabaseSync {
  exec(sql: string): void;
  prepare(sql: string): NodeStatement;
  close(): void;
}

export function openNodeBankDatabase(path = ':memory:'): BankDatabase {
  // 延迟 require：避免 TS / 打包器在非 Node 环境解析该内置模块
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => NodeDatabaseSync };
  const raw = new DatabaseSync(path);
  const statements = new Map<string, NodeStatement>();

  const prepare = (sql: string): NodeStatement => {
    let statement = statements.get(sql);
    if (!statement) {
      statement = raw.prepare(sql);
      statements.set(sql, statement);
    }
    return statement;
  };

  const direct: SqlExecutor = {
    async execAsync(sql) {
      raw.exec(sql);
    },
    async runAsync(sql, params = []): Promise<SqlRunResult> {
      const result = prepare(sql).run(...params);
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
    async getAllAsync<T>(sql: string, params: readonly SqlValue[] = []) {
      return prepare(sql).all(...params).map((row) => ({ ...(row as object) }) as T);
    },
    async getFirstAsync<T>(sql: string, params: readonly SqlValue[] = []) {
      const row = prepare(sql).get(...params);
      return row ? ({ ...(row as object) } as T) : null;
    },
  };

  let queue: Promise<unknown> = Promise.resolve();
  const locked = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = queue.then(operation, operation);
    queue = next.catch(() => undefined);
    return next;
  };

  return {
    execAsync: (sql) => locked(() => direct.execAsync(sql)),
    runAsync: (sql, params) => locked(() => direct.runAsync(sql, params)),
    getAllAsync: <T>(sql: string, params?: readonly SqlValue[]) => locked(() => direct.getAllAsync<T>(sql, params)),
    getFirstAsync: <T>(sql: string, params?: readonly SqlValue[]) => locked(() => direct.getFirstAsync<T>(sql, params)),
    withExclusiveTransactionAsync: (task) =>
      locked(async () => {
        raw.exec('BEGIN IMMEDIATE');
        try {
          await task(direct);
          raw.exec('COMMIT');
        } catch (error) {
          raw.exec('ROLLBACK');
          throw error;
        }
      }),
    closeAsync: async () => {
      statements.clear();
      raw.close();
    },
  };
}
