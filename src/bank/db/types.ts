/**
 * 数据库适配接口：只镜像本模块实际用到的 expo-sqlite 异步 API。
 *
 * - 生产实现包装 expo-sqlite（db/open.native.ts）；
 * - 测试实现包装 Node 内置 node:sqlite（db/node-sqlite.ts），跑真实 SQL，不做 mock；
 * - Web 不提供实现（db/open.ts 直接报「不支持」），见 README「Web 行为」。
 *
 * 约定：参数一律用位置参数数组；事务只用 withExclusiveTransactionAsync，
 * 事务回调里必须使用回调参数 `tx` 执行语句（expo 的独占事务跑在独立连接上）。
 */

export type SqlValue = string | number | null;

export interface SqlRunResult {
  changes: number;
  lastInsertRowId: number;
}

/** 可执行语句的对象：数据库本身或事务内的 tx */
export interface SqlExecutor {
  /** 执行一段（可多条）不带参数的 SQL */
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params?: readonly SqlValue[]): Promise<SqlRunResult>;
  getAllAsync<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params?: readonly SqlValue[]): Promise<T | null>;
}

export interface BankDatabase extends SqlExecutor {
  /**
   * 独占事务：回调成功则提交，抛错则整体回滚并把错误继续抛出。
   * 不要嵌套调用；事务内只用 `tx`。
   */
  withExclusiveTransactionAsync(task: (tx: SqlExecutor) => Promise<void>): Promise<void>;
  closeAsync(): Promise<void>;
}
