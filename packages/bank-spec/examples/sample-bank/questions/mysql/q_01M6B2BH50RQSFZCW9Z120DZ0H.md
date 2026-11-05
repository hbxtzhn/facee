---
id: q_01M6B2BH50RQSFZCW9Z120DZ0H
title: 线上出现慢 SQL，你会如何定位和优化？
type: scenario
difficulty: medium
importance: 3
category: mysql
tags: [mysql, index, performance, troubleshooting]
appliesTo: ["MySQL >= 8.0"]
prerequisites: [q_01M6B27VZ068DC8PEV0GWCQG5K]
source: { name: 自整理, license: CC-BY-4.0 }
references:
  - { title: "MySQL 8.0 Reference Manual: EXPLAIN Output Format", url: "https://dev.mysql.com/doc/refman/8.0/en/explain-output.html" }
  - { title: "MySQL 8.0 Reference Manual: The Slow Query Log", url: "https://dev.mysql.com/doc/refman/8.0/en/slow-query-log.html" }
reviewedAt: 2026-11-05
estimatedMinutes: 5
---

## 题目
订单列表接口 P99 从 80ms 升到 2s，监控显示数据库 CPU 升高。相关查询如下：

```sql
SELECT * FROM orders
WHERE user_id = ? AND status = 'PAID'
ORDER BY created_at DESC
LIMIT 20;
```

## 一句话
先用慢查询日志找到 SQL，再用 EXPLAIN 看执行计划，针对全表扫描、回表、文件排序等问题调整索引或改写语句。

## 要点
- [kp1|2] 开启慢查询日志，用 pt-query-digest 等工具聚合出最耗时的 SQL
- [kp2|3] EXPLAIN 重点看 type、key、rows、Extra
- [kp3|2] 为查询建立联合索引，兼顾过滤与排序，避免 Using filesort
- [kp4] 用 EXPLAIN ANALYZE 对比优化前后的实际耗时

## 详解
### 1. 找到慢 SQL
`slow_query_log = ON`，`long_query_time` 设为合适阈值（如 0.5 秒），再聚合分析，优先处理「总耗时」最高的，而不只是单次最慢的。

### 2. 读执行计划
- `type`：从好到差大致为 const、eq_ref、ref、range、index、ALL；
- `key` / `rows`：实际用的索引与预估扫描行数；
- `Extra`：`Using filesort` 表示额外排序，`Using temporary` 表示用了临时表，`Using index` 表示覆盖索引。

### 3. 本例的优化
只有 `user_id` 单列索引时，需要回表过滤 `status`，再对结果做文件排序。建立联合索引 `(user_id, status, created_at)` 后，等值条件定位到一段有序的索引区间，直接按 `created_at` 倒序取 20 条，不再排序。

若只需要少量列，可以让索引覆盖这些列，进一步避免回表。

## 示例
```sql
ALTER TABLE orders ADD INDEX idx_user_status_created (user_id, status, created_at);

EXPLAIN ANALYZE
SELECT id, amount, created_at FROM orders
WHERE user_id = 42 AND status = 'PAID'
ORDER BY created_at DESC
LIMIT 20;
```

## 易错点
- 在索引列上使用函数或隐式类型转换，导致索引失效
- 联合索引不满足最左前缀，或范围条件之后的列无法用于排序
- 只看单次执行时间，忽略高频执行的「中等慢」SQL

## 追问
### [f1] 深分页 LIMIT 100000, 20 很慢怎么办？
先按索引定位到上一页最后一条记录，用「WHERE created_at < 上次的值」做游标分页；或先用覆盖索引查出 20 个主键，再关联回表取整行，减少回表行数。
