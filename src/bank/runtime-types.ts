import type { BankDatabase } from './db/types';
import type { BankPlatform } from './platform';

/** 数据层运行所需的全部外部依赖：生产由 runtime(.native).ts 创建，测试注入 Node 实现 */
export interface BankRuntime {
  db: BankDatabase;
  platform: BankPlatform;
  /** 可注入的时钟（测试用），缺省 Date.now */
  now?: () => number;
}
