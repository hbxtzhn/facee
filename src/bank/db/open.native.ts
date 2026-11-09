import type { BankDatabase, SqlExecutor, SqlValue } from './types';

/**
 * 生产实现：包装 expo-sqlite（Android / iOS）。
 *
 * 平台分文件：Metro 在原生端解析本文件，Web 端解析同名 open.ts（直接报不支持），
 * 因此 expo-sqlite（Web 需 wasm + COOP/COEP 头）不会进入 Web 包。
 * expo-sqlite 57 在 Android 默认编译 FTS5（-DSQLITE_ENABLE_FTS5=1），内置 SQLite 3.50 支持 trigram。
 */

interface ExpoSqliteLike {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params: SqlValue[]): Promise<{ changes: number; lastInsertRowId: number }>;
  getAllAsync<T>(sql: string, params: SqlValue[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params: SqlValue[]): Promise<T | null>;
}

interface ExpoSqliteDatabase extends ExpoSqliteLike {
  withExclusiveTransactionAsync(task: (txn: ExpoSqliteLike) => Promise<void>): Promise<void>;
  closeAsync(): Promise<void>;
}

function wrapExecutor(target: ExpoSqliteLike): SqlExecutor {
  return {
    execAsync: (sql) => target.execAsync(sql),
    runAsync: async (sql, params = []) => {
      const result = await target.runAsync(sql, [...params]);
      return { changes: result.changes, lastInsertRowId: result.lastInsertRowId };
    },
    getAllAsync: <T>(sql: string, params: readonly SqlValue[] = []) => target.getAllAsync<T>(sql, [...params]),
    getFirstAsync: <T>(sql: string, params: readonly SqlValue[] = []) => target.getFirstAsync<T>(sql, [...params]),
  };
}

export const BANK_DATABASE_NAME = 'facee-bank-v2.db';

export async function openBankDatabase(name: string = BANK_DATABASE_NAME): Promise<BankDatabase> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const SQLite = require('expo-sqlite') as {
    openDatabaseAsync(name: string): Promise<ExpoSqliteDatabase>;
  };
  const db = await SQLite.openDatabaseAsync(name);
  // WAL：独占事务（独立连接）写入期间，主连接上的读取不被阻塞
  await db.execAsync('PRAGMA journal_mode = WAL;');
  return {
    ...wrapExecutor(db),
    withExclusiveTransactionAsync: (task) => db.withExclusiveTransactionAsync((txn) => task(wrapExecutor(txn))),
    closeAsync: () => db.closeAsync(),
  };
}
