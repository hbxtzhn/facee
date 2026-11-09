---
id: q_01M6B27VZ068DC8PEV0GWCQG5K
title: InnoDB 为什么选择 B+ 树作为索引结构？
type: concept
difficulty: medium
importance: 3
category: mysql
tags: [mysql, index]
appliesTo: ["MySQL >= 5.7", "InnoDB"]
source: { name: 自整理, license: CC-BY-4.0 }
references:
  - { title: "MySQL 8.0 Reference Manual: The Physical Structure of an InnoDB Index", url: "https://dev.mysql.com/doc/refman/8.0/en/innodb-physical-structure.html" }
reviewedAt: 2026-11-05
estimatedMinutes: 4
---

## 一句话
B+ 树矮胖、非叶子节点只存键，一次磁盘页读取能覆盖大量键；叶子节点有序且相连，范围查询高效。

## 要点
- [kp1|3] 节点大小与 16KB 页对齐，扇出大，千万级数据通常只需 3–4 层
- [kp2|2] 数据只在叶子节点，非叶子节点能放更多键，查询路径长度稳定
- [kp3|2] 叶子节点按键有序并用双向链表相连，范围查询和排序友好
- [kp4] 对比哈希：不支持范围；对比二叉树 / 红黑树：树太高、IO 多

## 详解
### 磁盘 IO 是瓶颈
InnoDB 以页（默认 16KB）为单位读写磁盘。索引查找的代价主要取决于需要读多少页，也就是树的高度。

### 扇出估算
假设主键为 BIGINT（8 字节），加上 6 字节的子页指针，一个非叶子页约能放 16KB / 14B ≈ 1170 个指针。若每个叶子页放 16 行数据：

- 2 层：1170 × 16 ≈ 1.9 万行
- 3 层：1170 × 1170 × 16 ≈ 2190 万行

根节点常驻 Buffer Pool，因此一次主键查找通常只需 1–2 次磁盘 IO。

### 聚簇索引与二级索引
- 聚簇索引（主键索引）的叶子节点存整行数据；
- 二级索引的叶子节点存「索引列 + 主键值」，查非索引列时需要回表；
- 覆盖索引：查询列全部在二级索引中，无需回表。

### 为什么不用 B 树
B 树非叶子节点也存数据，扇出更小、树更高；范围查询需要中序遍历回溯，而 B+ 树只需沿叶子链表顺序扫描。

## 易错点
- 以为 B+ 树叶子节点之间是单向链表；InnoDB 中是双向链表
- 以为二级索引叶子节点存的是行的物理地址；InnoDB 存的是主键值
- 忽略回表成本，以为走了索引就一定快

## 追问
### [f1] 为什么推荐使用自增主键？
自增主键使新记录总是追加到聚簇索引最右侧的页，页分裂少、空间利用率高。UUID 这类随机主键会在中间插入，频繁页分裂并产生碎片；而且主键越长，所有二级索引越大。

### [f2] 哈希索引在 InnoDB 中完全没有吗？
有自适应哈希索引（AHI）：InnoDB 监控热点等值查询，自动在内存中为部分 B+ 树页建立哈希索引，由 `innodb_adaptive_hash_index` 控制，用户不能手动创建。
