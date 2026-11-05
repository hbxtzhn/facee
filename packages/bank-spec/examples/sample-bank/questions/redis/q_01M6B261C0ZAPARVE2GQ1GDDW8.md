---
id: q_01M6B261C0ZAPARVE2GQ1GDDW8
title: 如何基于 Redis 设计一个分布式限流器？
type: design
difficulty: hard
importance: 2
category: redis
tags: [redis, system-design]
appliesTo: ["Redis >= 5"]
related: [q_01M6B22C60ED5XXJXQWP3KD9RG]
source: { name: 自整理, license: CC-BY-4.0 }
references:
  - { title: "Redis 文档：Scripting with Lua", url: "https://redis.io/docs/latest/develop/interact/programmability/eval-intro/" }
reviewedAt: 2026-11-05
estimatedMinutes: 8
---

## 题目
多个 API 网关实例需要共享同一个限流配额：每个用户每秒最多 100 次请求，允许短时突发。请给出设计并说明取舍。

## 一句话
用 Lua 脚本在 Redis 上原子地实现令牌桶或滑动窗口，所有网关实例共享同一份计数。

## 要点
- [kp1|3] 判断与扣减必须原子：用 Lua 脚本，避免先读后写的竞态
- [kp2|2] 固定窗口简单但有边界突刺；滑动窗口更平滑
- [kp3|2] 令牌桶按速率补充令牌，天然允许一定突发
- [kp4] 设置 key 过期时间，防止冷用户的 key 堆积
- [kp5] Redis 故障时要有降级：本地限流或放行

## 详解
### 算法对比
- **固定窗口**：`INCR` + `EXPIRE`，实现最简单；但在窗口交界处可能出现 2 倍流量。
- **滑动窗口日志**：ZSET 记录每次请求的时间戳，删除窗口外的成员后计数；精确，但每个请求占一条记录，内存大。
- **令牌桶**：存「剩余令牌数 + 上次补充时间」，每次请求按时间差补充令牌，有令牌则扣减；能平滑限流并允许突发，适合本题。

### 原子性
「读计数 → 判断 → 写回」若拆成多条命令，多实例并发时会超发。Redis 执行 Lua 脚本期间不会穿插执行其他命令，因此把整个判断放进脚本即可。

### 时间来源
不同网关的本地时钟可能有偏差。可以在脚本里调用 `redis.call('TIME')` 统一使用 Redis 服务器时间（Redis 5 起脚本默认按效果复制，允许这样做）。

### 集群
Redis Cluster 下，同一用户的 key 落在同一分片，脚本只访问一个 key 即可；热点用户可以考虑本地预取令牌，减少 Redis 往返。

## 示例
```lua
-- KEYS[1] = 桶 key；ARGV[1] = 容量，ARGV[2] = 每秒补充速率
local cap, rate = tonumber(ARGV[1]), tonumber(ARGV[2])
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local b = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(b[1]) or cap
local ts = tonumber(b[2]) or now
tokens = math.min(cap, tokens + (now - ts) * rate / 1000)
local allowed = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', KEYS[1], math.ceil(cap / rate * 1000) + 1000)
return allowed
```

## 易错点
- 用 GET 判断后再 INCR，多实例并发下超发
- 限流 key 不设过期时间，内存持续增长
- 各实例用本地时间计算，时钟偏差导致限流不准

## 追问
### [f1] 如果 Redis 挂了，限流器该怎么办？
不能让限流组件拖垮主链路：设置较短的超时，失败时降级为单机限流（按实例数折算配额）或直接放行，并告警。对安全敏感的接口可以选择失败即拒绝。
