---
id: q_01M6B20HK0ZNWA1FJ4RESDFN8M
title: Redis 内存满了会怎样？有哪些内存淘汰策略？
type: concept
difficulty: medium
importance: 3
category: redis
tags: [redis, memory, cache]
appliesTo: ["Redis >= 4.0"]
related: [q_01M6B1YQ006MV342WKV7JTR8H1]
source: { name: 自整理, license: CC-BY-4.0 }
references:
  - { title: "Redis 文档：Key eviction", url: "https://redis.io/docs/latest/develop/reference/eviction/" }
reviewedAt: 2026-11-05
estimatedMinutes: 4
---

## 一句话
内存达到 maxmemory 后按 maxmemory-policy 处理：默认 noeviction 拒绝写入，其余策略按 LRU、LFU、随机或 TTL 淘汰 key。

## 要点
- [kp1|3] 默认 noeviction：会增加内存的写命令报 OOM 错误，读和删除照常
- [kp2|2] allkeys-* 在全部 key 中淘汰，volatile-* 只在设了过期的 key 中淘汰
- [kp3|2] 可选 LRU、LFU（4.0+）、random，以及 volatile-ttl 优先淘汰将过期的
- [kp4] LRU / LFU 都是近似实现：按 maxmemory-samples 抽样，默认 5 个

## 详解
### 八种策略

| 范围 | LRU | LFU | 随机 | 其他 |
|---|---|---|---|---|
| 全部 key | allkeys-lru | allkeys-lfu | allkeys-random | — |
| 设了过期的 key | volatile-lru | volatile-lfu | volatile-random | volatile-ttl |

外加 `noeviction`。volatile-* 在没有可淘汰的 key 时，行为与 noeviction 相同。

### 近似 LRU
Redis 不维护全局 LRU 链表，而是每次抽样 `maxmemory-samples` 个 key，放入大小为 16 的淘汰池，淘汰空闲时间最长的。调大采样数更接近真实 LRU，但更耗 CPU。

### LFU
每个 key 用 8 位对数计数器记录访问频率，`lfu-log-factor` 控制增长速度，`lfu-decay-time`（分钟）控制衰减，避免历史热点一直不被淘汰。

### 怎么选
- 纯缓存、访问有明显热点：`allkeys-lfu` 或 `allkeys-lru`
- 缓存与持久数据混放：`volatile-*`，但要确保缓存 key 都设置了过期时间
- 不允许丢数据：`noeviction`，并做好容量告警

## 示例
```bash
redis-cli CONFIG SET maxmemory 2gb
redis-cli CONFIG SET maxmemory-policy allkeys-lfu
redis-cli INFO stats | grep evicted_keys
```

## 易错点
- 以为默认策略是 LRU，实际默认是 noeviction
- 用 volatile-lru 却没给 key 设置过期时间，结果写入直接报 OOM
- 以为 LRU 是精确实现

## 追问
### [f1] LRU 和 LFU 分别适合什么场景？
LRU 只看最近一次访问，偶发的全量扫描会把热点挤出去；LFU 看访问频率，更能保住长期热点，但新 key 初始计数低、容易被先淘汰。热点稳定选 LFU，访问模式随时间变化快选 LRU。
