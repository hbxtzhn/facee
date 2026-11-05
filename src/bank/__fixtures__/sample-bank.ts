import { computeContentHash, sha256HexOfText } from '../hash';
import type { Bundle, Question } from '../types';

/**
 * 手写的小型 v2 题库（按 src/bank/types.ts 构造），供数据层测试使用。
 * 每次调用返回全新对象，测试可随意修改；contentHash 由 computeContentHash 计算。
 */

export const QID = {
  redisExpire: 'q_01JC8ZQ4N3V6W8X0Y2Z4A6B8A1',
  redisPersist: 'q_01JC8ZQ4N3V6W8X0Y2Z4A6B8A2',
  mysqlTx: 'q_01JC8ZQ4N3V6W8X0Y2Z4A6B8A3',
  mysqlIndex: 'q_01JC8ZQ4N3V6W8X0Y2Z4A6B8A4',
  tcpHandshake: 'q_01JC8ZQ4N3V6W8X0Y2Z4A6B8A5',
  kafkaNew: 'q_01JC8ZQ4N3V6W8X0Y2Z4A6B8A6',
} as const;

export const SAMPLE_BANK_ID = 'github.com/facee-test/sample-bank';

/** 一张「图片」的内容与按 sha256 命名的文件名 */
export const SAMPLE_ASSET_CONTENT = 'fake-png-bytes-for-tests';
export const SAMPLE_ASSET_NAME = `${sha256HexOfText(SAMPLE_ASSET_CONTENT)}.png`;

type Draft = Omit<Question, 'contentHash'>;

function kp(id: number, text: string, weight: 1 | 2 | 3 = 1) {
  return { id: `kp${id}`, text, weight };
}

function drafts(): Draft[] {
  return [
    {
      id: QID.redisExpire,
      title: 'Redis 过期 key 的删除策略有哪些？',
      type: 'concept',
      difficulty: 'medium',
      importance: 3,
      categoryId: 'redis',
      tags: ['redis', 'memory'],
      appliesTo: ['Redis >= 6'],
      related: [QID.redisPersist],
      prompt: null,
      answer: {
        summary: '惰性删除与定期删除组合清理过期 key。',
        keyPoints: [kp(1, '访问 key 时检查是否过期（惰性删除）', 2), kp(2, '后台周期性抽样清理（定期删除）', 2), kp(3, '仍可能残留，靠内存淘汰策略兜底')],
        detail: `### 惰性删除\n访问时检查。\n\n![过期流程](asset:${SAMPLE_ASSET_NAME})`,
        examples: '```bash\nredis-cli CONFIG GET hz\n```',
        pitfalls: ['把过期删除与内存淘汰混为一谈'],
      },
      choice: null,
      followups: [{ id: 'f1', q: '大量 key 同时过期会怎样？', a: '定期删除压力集中，给过期时间加随机偏移。' }],
      source: { name: '自整理', license: 'CC-BY-4.0' },
      reviewedAt: '2026-11-05',
      estimatedMinutes: 3,
    },
    {
      id: QID.redisPersist,
      title: 'Redis 持久化 RDB 与 AOF 的区别',
      type: 'concept',
      difficulty: 'easy',
      importance: 2,
      categoryId: 'redis',
      tags: ['cache'],
      prompt: null,
      answer: {
        summary: 'RDB 是快照，AOF 是追加写命令日志。',
        keyPoints: [kp(1, 'RDB 定时快照，恢复快'), kp(2, 'AOF 记录写命令，数据更完整'), kp(3, '可混合持久化')],
      },
      choice: null,
      followups: [],
    },
    {
      id: QID.mysqlTx,
      title: 'MySQL 的隔离级别有哪些？',
      type: 'concept',
      difficulty: 'medium',
      importance: 3,
      categoryId: 'mysql',
      tags: ['tx'],
      prerequisites: [QID.mysqlIndex],
      prompt: '结合 InnoDB 说明。',
      answer: {
        summary: '读未提交、读已提交、可重复读、串行化四种事务隔离级别。',
        keyPoints: [kp(1, '读未提交会脏读', 1), kp(2, '可重复读是 InnoDB 默认', 3), kp(3, 'MVCC 实现快照读', 2), kp(4, '串行化完全加锁', 1)],
      },
      choice: null,
      followups: [
        { id: 'f1', q: '幻读如何解决？', a: '间隙锁 + MVCC。' },
        { id: 'f2', q: 'MVCC 的读视图何时创建？', a: '可重复读下首次读时创建。' },
      ],
    },
    {
      id: QID.mysqlIndex,
      title: 'MySQL 索引为什么用 B+ 树？',
      type: 'choice',
      difficulty: 'hard',
      importance: 1,
      categoryId: 'mysql',
      tags: ['db'],
      prompt: null,
      answer: {
        summary: 'B+ 树矮胖、范围查询友好。',
        keyPoints: [kp(1, '树高低，磁盘 IO 少'), kp(2, '叶子节点链表便于范围查询'), kp(3, '非叶子节点不存数据')],
      },
      choice: {
        options: [
          { id: 'a', text: '因为哈希表不支持等值查询' },
          { id: 'b', text: '因为 B+ 树矮胖且支持范围查询' },
        ],
        correct: ['b'],
        explanation: 'B+ 树更适合磁盘。',
      },
      followups: [],
    },
    {
      id: QID.tcpHandshake,
      title: 'TCP 为什么是三次握手？',
      type: 'concept',
      difficulty: 'easy',
      importance: 2,
      categoryId: 'network',
      tags: [],
      prompt: null,
      answer: {
        summary: '确认双方收发能力并同步初始序列号。',
        keyPoints: [kp(1, '同步双方初始序列号'), kp(2, '防止历史连接请求'), kp(3, '两次无法确认客户端接收能力')],
      },
      choice: null,
      followups: [],
    },
  ];
}

export function finalize(draft: Draft | Question): Question {
  const { contentHash: _drop, ...rest } = draft as Question;
  return { ...rest, contentHash: computeContentHash(rest) };
}

export function sampleBundle(version = '1.0.0'): Bundle {
  return {
    schemaVersion: 2,
    bank: {
      id: SAMPLE_BANK_ID,
      name: '测试题库',
      version,
      description: '数据层测试用',
      locale: 'zh-CN',
      license: 'CC-BY-4.0',
      homepage: 'https://example.com/sample',
      feedbackUrl: 'https://example.com/issues?q={questionId}',
      update: { manifest: 'https://example.com/sample/latest.json' },
    },
    categories: [
      { id: 'redis', name: 'Redis', order: 50 },
      { id: 'mysql', name: 'MySQL', order: 10 },
      { id: 'network', name: '网络', order: 50 },
    ],
    tags: [
      { id: 'db', name: '数据库', parent: null },
      { id: 'cache', name: '缓存', parent: 'db' },
      { id: 'redis', name: 'Redis', parent: 'cache' },
      { id: 'memory', name: '内存', parent: null },
      { id: 'tx', name: '事务', parent: 'db' },
    ],
    collections: [{ id: 'sprint', name: '冲刺', description: '高频题', questions: [QID.mysqlTx, QID.redisExpire] }],
    lifecycle: { removed: [], merged: {} },
    questions: drafts().map(finalize),
  };
}
