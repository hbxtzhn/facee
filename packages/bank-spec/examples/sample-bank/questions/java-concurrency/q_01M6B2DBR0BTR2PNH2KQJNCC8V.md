---
id: q_01M6B2DBR0BTR2PNH2KQJNCC8V
title: synchronized 和 ReentrantLock 有什么区别？
type: concept
difficulty: medium
importance: 3
category: java-concurrency
tags: [concurrency, lock]
appliesTo: ["Java >= 8"]
source: { name: 自整理, license: CC-BY-4.0 }
references:
  - { title: "Java SE 21 API: ReentrantLock", url: "https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/locks/ReentrantLock.html" }
reviewedAt: 2026-11-05
estimatedMinutes: 4
---

## 一句话
两者都是可重入的互斥锁；synchronized 是 JVM 内置关键字、自动释放，ReentrantLock 是 API，功能更多但必须手动 unlock。

## 要点
- [kp1|2] synchronized 由 JVM 用 monitor 实现，异常时也会自动释放锁
- [kp2|3] ReentrantLock 支持可中断、超时 tryLock、公平锁与多个 Condition
- [kp3|2] ReentrantLock 必须在 finally 中 unlock，否则可能永久持有锁
- [kp4] 性能已相近，无特殊需求优先 synchronized

## 详解
### 实现层面
- `synchronized`：编译为 `monitorenter` / `monitorexit`（方法上是 `ACC_SYNCHRONIZED` 标志），锁状态记录在对象头的 Mark Word 中；
- `ReentrantLock`：基于 AQS（`AbstractQueuedSynchronizer`），用 `state` 计数重入次数，竞争失败的线程进入 CLH 变体队列并 park。

### 功能对比

| 能力 | synchronized | ReentrantLock |
|---|---|---|
| 可重入 | ✓ | ✓ |
| 响应中断 | ✗ | `lockInterruptibly()` |
| 超时获取 | ✗ | `tryLock(timeout, unit)` |
| 公平锁 | ✗（非公平） | 构造参数 `true` |
| 条件队列 | 单个（wait / notify） | 多个 `Condition` |

### 关于锁升级
早期 JDK 为 synchronized 引入了偏向锁、轻量级锁、重量级锁的升级过程。JDK 15 起偏向锁默认禁用并被标记为废弃（JEP 374），之后的版本已将其移除，面试中不必再把偏向锁当作现行机制。

## 示例
```java
private final ReentrantLock lock = new ReentrantLock();

void transfer() throws InterruptedException {
    if (!lock.tryLock(100, TimeUnit.MILLISECONDS)) {
        throw new IllegalStateException("busy");
    }
    try {
        // 临界区
    } finally {
        lock.unlock();
    }
}
```

## 易错点
- 把 `lock.lock()` 写在 try 块内部：加锁失败时 finally 中的 unlock 会抛异常
- 以为公平锁性能更好；公平锁吞吐量通常更低
- 以为 synchronized 不可重入

## 追问
### [f1] 什么场景必须用 ReentrantLock？
需要可中断等待、超时放弃获取锁、公平性，或在一把锁上区分多个等待条件（如阻塞队列的 notEmpty / notFull）时。
