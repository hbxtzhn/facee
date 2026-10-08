# FaceE 实现方案 v2（轻量档）

> 依据：`pre.md`（FaceE 产品需求说明 §1–§33）
> 状态：**技术栈已定档，待开工**
> 配套文档：[`题库规范-v1.md`](./题库规范-v1.md)
> v2 变更：ZIP 改为「JS 解压为主 + 原生可切换」、依赖降到 RN 内置、保留 Web 预览、里程碑重排、新增性能决策门。

---

## 0. 已确认决策（你已拍板）

| # | 决策 | 结论 | 影响 |
|---|---|---|---|
| D1 | 题库来源 | **我生成示例题库 + 生成器**，并提供题库规范 v1 | 安装管线有真实、可重复的测试目标 |
| D2 | 本轮交付 | **只要方案文档，暂不写代码** | 本文档是最终产物；开工时机由你定 |
| D3 | 追问/关联格式 | **扩展题库规范 v1**：`followups.md` + `facee://question/<id>` | 结构化可校验，不留歧义 |
| D4 | 搜索范围 | 标题+标签即时；**正文全文搜索**（懒加载语料） | 满足 §6.2 上限要求，不牺牲性能 |
| D5 | ZIP 路线 | **JS（fflate）为主，`ArchivePort` 预留原生实现** | 日常可在 Expo Go 迭代；是否需要原生由压测数据决定 |
| D6 | 依赖档位 | **全用 RN 内置**（PanResponder / Animated / FlatList / Image） | 依赖从 15 个降到 8 个，去掉 reanimated/gesture-handler/flash-list/expo-image |
| D7 | Web 预览 | **保留** | 多一层存储适配，换来浏览器内的快速 UI 迭代与自动化验收 |
| D8 | 学习进度范围 | **只做「累计刷题总数」**；不做当日已刷、每日目标、连续学习天数（§14.1 降级实现） | 数据模型从「按日记录 + 连续天数推导」简化为单个计数器，去掉日期/时区/断签类边界 bug |
| D9 | 答案展开 | **做成用户设置项，由用户自选**（默认：隐藏，先读题目） | 比「全局偏好 + 单题覆盖」更简单可预期：一个设置值决定新题默认展开态，单题手动切换不写回设置 |
| D10 | 默认题库地址 | **已就位并实测通过**：`https://github.com/HBxtzhn/facee-bank/archive/refs/heads/main.zip` | 已真实下载 + 通过规范校验（§2.3）；地址可在「我的」页修改，用户值优先 |

---

## 1. 结论摘要（TL;DR）

| 项 | 结论 | 关键理由 |
|---|---|---|
| 技术栈 | Expo SDK **57** + RN **0.87** + TypeScript + expo-router，**8 个依赖** | 锁定当前 latest；不引入任何 UI 库与动画库 |
| **运行形态** | **第一阶段可全程在 Expo Go 里开发**（无原生模块） | 省掉 dev build 迭代成本；只有发版/性能不达标才需要原生构建 |
| ZIP 解压 | **JS（`fflate`）流式解压为默认路径**；`ArchivePort` 预留 `react-native-zip-archive` | 见 D5；且 JS 路线**安全性更强**（见 §7） |
| 安全模型 | **JS 主导**：中央目录预检 → 条目白名单 → **由我们自己写每个文件** → 落盘集合复核 | 路径穿越在结构上不可能发生，不依赖第三方对 `../` 的处理 |
| 安装模型 | **版本目录 + 指针文件原子切换**（`versions/<key>/` + `active.json`），失败零影响旧题库 | 满足 §25；天然获得免费回滚 |
| 正文全文搜索 | 安装期生成**单文件换行分隔语料 `index/body.txt` + 偏移表**，查询时用 `FileHandle` **分块流式扫描** | 常量内存（峰值约 256KB）、毫秒级、不需 SQLite、Web 端复用；从机制上满足 §28 |
| 标题/标签搜索 | catalog 常驻内存（2000 题约 1–2MB），零延迟 | §6.2 最低要求即时达成 |
| 状态与持久化 | Zustand（运行时）+ AsyncStorage（持久化），**不引入 SQLite** | 贴合 §31；数据量远在 AsyncStorage 舒适区 |
| 下载 | `File.createDownloadTask` + `onProgress`，自带暂停/续传/取消 | §14.4 进度与 §29 中断处理**免费拿到** |
| 可测试性核心决策 | 安装器与校验器是**纯 TypeScript + 注入式端口**（StoragePort / ArchivePort） | 恶意 ZIP、原子性、失败回滚可在 Node/Jest 里完整验证，**不依赖真机** |
| 交付顺序 | 先 Web/Expo Go 跑到功能闭环 → 压测门 → 再决定是否引入原生 | 反馈最快；"重"只在有证据时发生 |
| 本机可行性 | Android 可本地构建（JDK 21 + SDK 34–36 已就绪）；**iOS 本机不可构建** | iOS release 需 EAS 或 macOS，列为外部依赖 |

---

## 2. 环境事实核查（本机实测，2026-09-15）

| 项 | 实测值 | 影响 |
|---|---|---|
| Node / npm / pnpm | 22.20.0 / 11.13.0 / 11.9.0 | 满足 Expo SDK 57 |
| Git | 2.51.0.windows.1 | 题库仓库与规范版本管理 |
| JDK | 21.0.9 LTS | 满足 RN 0.87 Gradle（**发版阶段才需要**） |
| Android SDK | `%LOCALAPPDATA%\Android\Sdk`：platforms `android-34/35/36/36.1`、build-tools `35/36/36.1/37` | 可本地 `expo run:android` |
| 模拟器 | AVD：`Pixel_10_Pro`、`Pixel_API_36` | 有可用验收设备 |
| 待修项 | `ANDROID_HOME` 未设置、`adb` 不在 PATH | **不阻塞开工**（Expo Go 阶段不需要）；M6 发版前一次性配置 |
| 平台限制 | 宿主机 Windows | iOS 只能 EAS / macOS |

### 2.1 官方 API 事实（已核实，决定了几处设计）

| 能力 | 事实 | 用途 |
|---|---|---|
| 分块/随机读 | `File.open()` → `FileHandle.readBytes(n)`，`offset` 可任意定位 | §9.2 语料流式扫描 + §7 从尾部读 EOCD/中央目录 |
| 下载 | `File.createDownloadTask(url, dest, { onProgress })`，`pauseAsync/resumeAsync/cancel/savable`，支持 `AbortSignal` | §14.4 进度、§29 中断与续传 |
| 空间预检 | `Paths.availableDiskSpace` / `Paths.totalDiskSpace` | §29「存储空间不足」固定文案 |
| 目录原子操作 | `File.move()` / `Directory.move()`（同分区 rename） | §6 指针文件原子切换 |
| **平台支持** | 新 FS API 标注 **Android / iOS / tvOS，无 Web** | Web 预览必须自写存储适配（D7 的成本来源） |

### 2.2 依赖清单（8 个运行时依赖 + 1 个开发依赖）

| 包 | 版本 | 必需性 |
|---|---|---|
| `expo` | 57.0.22 | 必需（SDK） |
| `react-native` | 0.87.1 | 必需（随 SDK） |
| `expo-router` | 57.0.21 | 必需（= React Navigation，满足 §31） |
| `expo-file-system` | ~57.0.7 | 必需（离线存储的根） |
| `react-native-marked` | 8.3.0 | 必需（§7.2 Markdown，自定义 Renderer） |
| `zustand` | 5.0.15 | 必需（§31 指定） |
| `@react-native-async-storage/async-storage` | 3.1.1 | 必需（§31 指定） |
| `fflate` | 0.8.3 | 必需（ZIP 解压，纯 JS ~30KB） |
| `jest-expo`（dev） | 57.0.5 | 开发依赖（单测） |

**明确不引入**：`react-native-reanimated`、`react-native-gesture-handler`、`@shopify/flash-list`、`expo-image`、`expo-sqlite`、`react-native-zip-archive`（预留，未启用）、任何 UI 组件库。
**预留（按需再加）**：`react-native-zip-archive@9.5.1`（原生解压，见 §12 决策门）。

> 安装时统一用 `npx expo install`，由 Expo 决定彼此的兼容 patch 版本。

### 2.3 对**真实 GitHub 归档 ZIP** 的实测结论（已跑通，非推测）

题库已推成真实仓库，直接下载 `archive/refs/heads/main.zip` 用我们自己的校验器验证，得到三条会影响实现的硬事实：

| 实测发现 | 影响 | 处理 |
|---|---|---|
| 归档 ZIP **多一层 wrapper 目录**（`facee-bank-main/`） | 题库根不在包根 | 根定位规则（根或唯一顶层目录）**已实测生效** |
| 归档 ZIP **包含目录条目**（`questions/xxx/` 以 `/` 结尾） | 白名单与落盘集合比对会被目录条目污染 | 解析时跳过 `isDir` 条目 |
| 归档 ZIP **不设 UTF-8(EFS) 标志位** | 若按「未设 EFS 就告警」实现，每次真实安装会刷 97 条无信息量告警 | 改为：**仅当文件名含非 ASCII 字节**且未设 EFS 才告警（告警从 101 条降到 4 条） |

配套结论：GitHub 归档 ZIP **不带 bit3 数据描述符**（中央目录完整可信），但 ZIP64 / 数据描述符的解析分支**必须保留**（其他托管方式会产生）。

---

## 3. 技术选型理由（含对 §31 的偏差说明）

PRD §31 要求：RN + TypeScript + Expo + React Navigation + Zustand + AsyncStorage + Expo File System + ZIP 解压 + Markdown Renderer，且正式环境不能只依赖 Expo Go。

| 选型点 | 决定 | 理由 / 偏差 |
|---|---|---|
| 路由 | **expo-router** | 底层就是 React Navigation（**不算偏差**）；文件式路由让 §3 的 7 个模块显式可见 |
| ZIP | **JS 流式（fflate）** | ① 省掉原生构建，迭代快；② 我们控制每个文件的落盘路径 → 安全性更强（§7）；③ Web 端复用同一实现；④ 一次性安装场景对秒级耗时容忍度高。**偏差说明**：§31 只说"ZIP 解压能力"，未指定实现；且 `ArchivePort` 保留原生接口，性能不达标可无缝切换 |
| 手势/动画 | **RN 内置 `PanResponder` + `Animated`** | 本 App 的手势需求（横向切题、长按拖动 FAB）都是单指单手势，不需要手势竞争系统。`PanResponder` 的 `onMoveShouldSetPanResponder` 里做意图判定（`|dx| > 1.5×|dy|`）即可解决 §12.2 的冲突。省掉 reanimated 带来的 babel 插件与 worklets 复杂度 |
| 列表 | **RN 内置 `FlatList`** | 2000 条简单行远未到上限；配 `React.memo` + `windowSize` 调优。若压测掉帧再换 FlashList（接口兼容，改动局限于一个组件） |
| 图片 | **RN 内置 `Image`** | 本地 `file://` 图片无需远程缓存层；`expo-image` 的收益在远程图片场景 |
| Markdown | `react-native-marked` | 8.3.0 活跃；`RendererInterface` 可完全接管节点 → 内链拦截（§10）、本地图片（§21）、代码块样式都可控。**不用 WebView**（破坏 §28 性能目标） |
| 数据库 | **不引入 SQLite** | 正文搜索瓶颈是"读多少字节"而非"查得多快"；FTS5 中文分词（trigram tokenizer）在 `expo-sqlite` 是否可用未经验证，属无谓赌注 |
| 状态 | Zustand + AsyncStorage | §31 指定；键统一 `facee/v1/*` + schemaVersion |
| 依赖卫生 | 不引入 UI 库 | 让 §5–§14 的界面完全可控 |

---

## 4. 总体架构

```
┌──────────────────────────────────────────────────────────────┐
│ UI 层  app/**（expo-router 屏幕 + 组件）                       │
│  首页 / 题目列表 / 题目详情 / 连续刷题 / 收藏 / 我的 / 题库安装  │
└───────────────┬──────────────────────────────────────────────┘
                │ 订阅（Zustand selectors）
┌───────────────▼──────────────────────────────────────────────┐
│ 状态层  features/*/store.ts（Zustand → AsyncStorage）          │
│  bankStore · readingStore · favoriteStore · progressStore      │
│  installStore · uiStore（悬浮按钮位置等）                      │
└───────────────┬──────────────────────────────────────────────┘
                │ 纯函数调用（无 React 依赖）
┌───────────────▼──────────────────────────────────────────────┐
│ 领域层  packages/core（★ 纯 TypeScript，可在 Node 里单测）      │
│  · catalog 解析/校验   · 标签树与计数汇总   · 查询与稳定排序     │
│  · ZIP 中央目录解析    · 条目白名单与安全校验(E_*)             │
│  · 安装状态机          · 原子切换与 GC                          │
│  · followups.md 解析   · 搜索语料构建/扫描  · 关联题引用解析     │
│  · 进度/连续天数计算    · 端口接口：StoragePort / ArchivePort   │
└───────────────┬──────────────────────────────────────────────┘
                │ 端口实现（唯一允许碰平台 API 的地方）
┌───────────────▼──────────────────────────────────────────────┐
│ 适配层  packages/platform                                     │
│  fs :  native = expo-file-system；web = IndexedDB/内存 VFS     │
│  arc:  js = fflate（默认，Expo Go 可跑）                       │
│        native = react-native-zip-archive（预留，同一接口）      │
│  dev:  node-fs（Jest） / 内存 VFS（原子性与失败注入测试）        │
└──────────────────────────────────────────────────────────────┘
```

**架构纪律（三条硬约束）**

1. `packages/core` **禁止 import 任何 `expo-*` / `react-native*`**（用 ESLint `no-restricted-imports` 强制）。
2. 所有对外部世界的读写（文件、解压、网络、时钟、磁盘空间）都走端口，且端口可注入 → 失败注入测试成为可能。
3. 安装是**状态机**而非一串 `await`：每个状态可被 UI 观察、可被取消、可被断言。

### 4.1 数据流（首启 → 离线刷题）

```
启动 → 读 active.json → 有题库?
   ├─ 无 → 空状态（§5.3）→ 我的页填 ZIP 地址 → 安装流程
   └─ 有 → 加载 catalog.json（一次，常驻内存）
              ├─ 首页：分类+计数 / 继续学习（§5）
              ├─ 列表：catalog 内存筛选 + 排序（零 I/O）
              ├─ 详情：按需读 question.md（§28）→ 点"查看答案"再读 answer.md
              ├─ 追问：按需读 followups.md
              └─ 搜索：标题/标签走内存；正文走 index/body.txt 分块扫描
```

---

## 5. 工程目录结构

```
Face/
├─ app/                                  # expo-router 路由（= 页面骨架）
│  ├─ _layout.tsx                        # 根 Stack + Provider + 启动引导
│  ├─ (tabs)/
│  │  ├─ _layout.tsx                     # 底部 Tab：题库 / 收藏 / 我的
│  │  ├─ index.tsx                       # §5  题库首页
│  │  ├─ favorites.tsx                   # §13 收藏
│  │  └─ me.tsx                          # §14 我的
│  ├─ category/[categoryId].tsx          # §6  题目列表（搜索/难度/标签筛选）
│  ├─ question/[questionId].tsx          # §7–§12 题目详情 + 连续刷题
│  └─ bank/install.tsx                   # §14.3–14.4 题库地址与安装
├─ packages/
│  ├─ core/                              # ★ 纯 TS 领域层（可单测）
│  │  ├─ catalog/{parse.ts,validate.ts,selectors.ts,tagTree.ts}
│  │  ├─ zip/{centralDirectory.ts,guard.ts,entries.ts,errors.ts}
│  │  ├─ install/{stateMachine.ts,steps.ts,swap.ts,report.ts}
│  │  ├─ search/{buildCorpus.ts,scan.ts,normalize.ts}
│  │  ├─ markdown/{followups.ts,questionRef.ts,plainText.ts}
│  │  ├─ progress/{stats.ts,streak.ts}
│  │  └─ ports/{StoragePort.ts,ArchivePort.ts,Clock.ts,SpaceInfo.ts}
│  ├─ platform/
│  │  ├─ native/{fsStorage.ts,download.ts}
│  │  ├─ web/{idbStorage.ts,memoryVfs.ts}
│  │  ├─ archive/{fflateArchive.ts,zipArchiveNative.ts}   # 后者预留
│  │  └─ testing/{memoryStorage.ts,nodeFsStorage.ts,brokenStorage.ts}
│  └─ bank-spec/                         # 题库规范 + 生成器（Node 脚本）
│     ├─ generate.ts                     # 产出样例题库 / 压测库 / 恶意 fixtures
│     ├─ fixtures/malicious/             # 恶意 ZIP 测试样本
│     └─ sample/questions/**             # ~60 道示例题源
├─ features/                             # UI 与状态（按业务域切）
│  ├─ bank/{bankStore.ts,hooks.ts}
│  ├─ reading/{readingStore.ts,QuestionView.tsx,FollowupList.tsx,MarkdownView.tsx}
│  ├─ practice/{sessionStore.ts,FloatingPad.tsx,useSwipePager.ts}
│  ├─ favorite/{favoriteStore.ts}
│  ├─ progress/{progressStore.ts}
│  └─ install/{installStore.ts,useInstall.ts}
├─ components/                           # 通用展示组件（无业务）
├─ docs/                                 # 本方案 + 题库规范（md + 排版好的 html）
└─ tools/                                # 本地静态服务（假装是 GitHub）
```

---

## 6. 题库规范 v1（摘要）

完整规范见 [`题库规范-v1.md`](./题库规范-v1.md)。三处扩展（对应 D3）：

### 6.1 目录结构（在 §16 基础上扩展）

```
catalog.json
questions/
  spring-tx-01/
    question.md          # 必填，题目正文（§19）
    answer.md            # 选填，参考答案（§20：可不存在）
    followups.md         # ★扩展：面试官追问（§9）
    assets/              # 选填，图片（§21）
      architecture.png
```

### 6.2 `followups.md` 格式（§9 的结构化落地）

```markdown
## 追问 1：为什么这样设计？

这里是对追问 1 的回答，支持完整 Markdown（代码块 / 表格 / 图片）。

## 追问 2：如果数据量增加怎么办？

这里是对追问 2 的回答。
```

规则：顶层 H2 切分（代码块内的 `## ` 不切分）；`追问 N：` 前缀可选；`followupCount` 由安装器**实测推导**，不手写。视觉上四层区分（主问题 / 主答案 / 追问 / 追问答案），追问默认折叠（§9）。

### 6.3 题目关联语法（§10）

| 写法 | 语义 | 推荐度 |
|---|---|---|
| `[Redis 为什么这么快？](facee://question/redis-cache-01)` | 显式引用题目 ID | **推荐**，可校验、零歧义 |
| `[Redis 为什么这么快？](../redis-cache-01/question.md)` | 相对路径引用 | 兼容 |
| `相关题目：Redis 为什么这么快？`（纯文本） | 安装期用 catalog 标题表做**精确标题匹配**自动加链接 | 兼容兜底（§10 示意写法），匹配不到则原样显示 + 告警 |

跳转与返回：关联题用 `push` 进入，返回时按 `questionId` 恢复阅读状态（滚动位置 / 答案展开 / 追问展开），见 §11。

### 6.4 catalog.json v1 关键约定

- `difficulty ∈ {easy|medium|hard}`（对应 §6.3 三档）
- `categoryId` 单值（§7.1 显示"所属分类"）
- `tags` 引用标签 ID，**父标签筛选自动包含子孙**（§6.4 / §22）
- 排序：`order` 升序 → `id` 字典序兜底（§23）
- 题目 ID 正则 `^[a-z0-9][a-z0-9._-]{0,63}$` 且**必须等于目录名**（§18）

---

### 6.5 已发布的题库地址（已实测可用）

| 用途 | URL |
|---|---|
| **App 默认题库地址**（稳定版） | `https://github.com/HBxtzhn/facee-bank/archive/refs/heads/main.zip` |
| 换版/回滚测试用（28 题，已删 `java-basic-03`） | `https://github.com/HBxtzhn/facee-bank/archive/refs/heads/v1.1.0.zip` |
| 仓库主页 | https://github.com/HBxtzhn/facee-bank |

实测结果（`node generate.mjs --verify <下载的 zip>`）：

```text
main.zip   51,364 B · 97 entries · 根定位 = facee-bank-main  · 29 题 ✅ PASS
v1.1.0.zip 50,148 B · 94 entries · 根定位 = facee-bank-1.1.0 · 28 题 ✅ PASS
```

验证方式交付说明：GitHub 的归档 ZIP **多一层目录**且**含目录条目**，两个真实包都通过了规范校验，说明根定位与条目过滤不是纸上设计。

---

## 7. ZIP 安全校验：JS 主导的四道闸（§24 / §29）

这是本方案的核心创新点：**因为解压由我们自己的代码完成，所有写入路径都由我们决定**，安全检查不再是"防御纵深"，而是唯一真相源。

| 闸 | 位置 | 做什么 | 拦掉的威胁 |
|---|---|---|---|
| **G1 结构预检** | JS 解析中央目录（自研约 150 行，ZIP APPNOTE） | 只读元数据、**不解压**：`FileHandle` 从文件尾定位 EOCD → 解析 CD 条目名、通用位标志（bit0 加密 / bit3 数据描述符）、压缩方式、原始大小、外部属性、条目总数；损坏/截断/不可解析即拒 | 非 ZIP、损坏 ZIP、加密 ZIP、ZIP64 误判、条目数爆炸、解压后体积超空间 |
| **G2 条目白名单** | `core/zip/entries.ts` | 逐条校验名字：无绝对路径、无 `..`、无盘符、无反斜杠、无空段、无控制字符、长度上限；规范化后**大小写不敏感去重**（防 iOS 大小写不敏感文件系统踩踏）；只允许普通文件（拒绝符号链接属性）；产出**显式文件清单**（绝不传目录名，避免子树扩张） | 路径穿越、绝对路径、重复条目、符号链接逃逸 |
| **G3 自控落盘** | `ArchivePort` + `StoragePort` | 解压流由我们驱动：每个条目的输出路径 = `stagingDir + 规范化后的相对路径`，**路径由 core 计算并再次断言在 staging 之内**后才写盘 | 第三方解压实现对 `../` 的静默处理 —— 结构上不可能发生 |
| **G4 落盘复核** | `core/install/steps.ts` | 递归遍历 staging，实际文件集合必须**等于**白名单集合（多一个即失败）；无符号链接；总大小与 G1 估算一致 | 实现 bug、并发写入、意外文件 |

### 7.1 为什么 JS 解压反而更安全

原生解压库的路径处理是不能被单测覆盖的黑盒；而 JS 路线里，"校验名字"和"写文件"是同一份可测试代码的两步，恶意 ZIP 的每一种变体都能在 Jest 里被断言为"拒绝 + 未产生任何文件"。**原生实现（预留）也将走同一套 G1/G2/G4，只把 G3 换成 `unzip(src, dst, 'UTF-8', 白名单entries)`。**

### 7.2 错误码表（同时是 UI 文案与单测用例清单）

| 码 | 含义 | 用户可见文案（示例） |
|---|---|---|
| `E_NET_OFFLINE` / `E_NET_HTTP` / `E_NET_TIMEOUT` | 网络类（§29） | 网络不可用 / 下载失败（HTTP 404）/ 下载超时 |
| `E_URL_INVALID` | 非法 URL | 题库地址无效，请检查 |
| `E_SPACE_LOW` | 空间不足 | **设备存储空间不足，无法安装题库。**（§29 固定文案） |
| `E_ZIP_CORRUPT` | EOCD/CD 不可解析、截断 | 题库包已损坏，请重新下载 |
| `E_ZIP_ENCRYPTED` | 加密位被设置 | 题库包已加密，无法安装 |
| `E_ZIP_PATH_ABSOLUTE` / `E_ZIP_PATH_TRAVERSAL` / `E_ZIP_PATH_ILLEGAL` | 路径类 | 题库包路径非法，禁止安装 |
| `E_ZIP_DUPLICATE_ENTRY` | 重复条目 | 题库包存在重复文件，禁止安装 |
| `E_ZIP_TOO_MANY_ENTRIES` / `E_ZIP_TOO_LARGE` | 规模超限 | 题库包结构异常，禁止安装 |
| `E_DECOMPRESS_FAILED` | 解压中断/校验和不符 | 题库包解压失败，请重新下载 |
| `E_EXTRACT_UNEXPECTED_FILE` | G4 发现多余文件 | 题库包校验未通过，禁止安装 |
| `E_CATALOG_ROOT` | 找不到题库根 / 多个候选根 | 题库包结构异常：未找到唯一的题库根目录 |
| `E_CATALOG_UNPARSABLE` | JSON 无法解析 | catalog.json 无法解析（§24） |
| `E_CATALOG_SCHEMA` | 字段缺失/类型错/枚举非法/未知 schemaVersion | catalog.json 字段不合法：<字段> |
| `E_ID_DUPLICATE` / `E_ID_ILLEGAL` / `E_ID_DIR_MISMATCH` | 题目 ID 类（§18/§24）：重复 / 非法 / 存在未被 catalog 声明的 `questions/<dir>/` 孤儿目录 | 题目 ID 重复 / 非法 / 与目录不一致 |
| `E_ZIP_ILLEGAL_COMPRESSION` | 压缩方式非 Store/Deflate | 题库包使用了不支持的压缩方式 |
| `E_QUESTION_FILE_MISSING` | 声明的题目文件不存在（§24） | 题目 <id> 缺少 question.md |
| `E_HASANSWER_MISMATCH` | `hasAnswer` 与文件不一致 | 题目 <id> 的 hasAnswer 与文件不一致 |
| `E_TAG_UNKNOWN` | 题目引用了不存在的标签（§24） | 题目 <id> 引用了不存在的标签 <tag> |
| `E_TAG_PARENT_CYCLE` / `E_TAG_PARENT_UNKNOWN` | 父子标签非法（§24） | 标签层级非法：<tag> |
| `E_DIFFICULTY_INVALID` | 难度枚举非法 | 题目 <id> 的难度值非法 |
| `E_CATEGORY_UNKNOWN` | categoryId 不存在 | 题目 <id> 的分类不存在 |
| `E_ASSET_MISSING` | Markdown 引用的本地图片不存在 | 题目 <id> 缺少图片资源 <path> |
| `W_REF_DANGLING` / `W_TITLE_REF_UNRESOLVED` / `W_FOLLOWUP_EMPTY` / `W_TITLE_MISMATCH` / `W_ZIP_ENCODING` / `W_ORDER_DUPLICATE` / `W_TAG_DUPLICATE` / `W_ASSET_UNUSED` / `W_NO_README` | **告警** | 记入安装报告，"我的"页可查，**不阻断安装**。注意 `W_ZIP_ENCODING` 仅在非 ASCII 文件名缺 EFS 位时触发（实测 GitHub 归档 ZIP 全部不设 EFS） |

策略：**E_\* 一律阻断安装**（§24 明确"必须拒绝"）；**W_\* 写入安装报告**（比 PRD 多一点点，排查体验差别很大）。

---

## 8. 本地存储布局与原子安装（§25 / §27）

### 8.1 磁盘布局

```
<documents>/bank/
├─ active.json                 # {"versionKey":"...","installedAt":"...","schemaVersion":1}
├─ versions/
│  ├─ java-interview-1.2.0-1757900000/
│  │  ├─ catalog.json
│  │  ├─ questions/**
│  │  └─ index/{body.txt,body.idx.json,meta.json}
│  └─ java-interview-1.1.0-1757800000/     # 上一版：成功后保留一代，供回滚
└─ tmp/<uuid>/{bank.zip, extracted/**}     # 工作区，任何失败均可整目录删除
```

### 8.2 安装状态机

```
idle
 └─▶ precheck      URL 合法性 + Paths.availableDiskSpace ≥ 解压后预估 × 1.6（§29 空间不足）
      └─▶ downloading   File.createDownloadTask + onProgress（字节/总字节），可暂停/取消/续传
           └─▶ inspecting     G1+G2：解析中央目录 → 条目白名单 + 体积预估（第一、二道闸）
                └─▶ extracting     fflate 流式解压，逐条目经 G3 校验名字后由我们写盘
                     └─▶ scanning      G4：落盘目录树 vs 白名单集合复核
                          └─▶ validating    catalog/题目/标签/资源/引用 全量校验（§24）
                               └─▶ indexing      构建正文搜索语料 body.txt + 偏移表
                                    └─▶ committing   写 active.json.tmp → move 成 active.json（原子）
                                         └─▶ done       清理 tmp；保留一代旧版本；GC 更早版本
任意步骤 ─▶ failed(code, detail, hint)   # 旧题库全程只读、不受影响（§25）
```

**原子性论证**：新题库全程写在 `versions/<新 key>/` 与 `tmp/`；`active.json` 用"临时文件 + `move`（同分区 rename）"替换。读侧永远只按 `active.json` 指向的目录工作，因此不存在"半个题库"的可见状态；`failed` 时 `active.json` 从未被写过。这就是 §25「任何失败都不能破坏旧题库」的机械保证，且可被**故障注入存储**逐步骤单测验证。

**JS 解压的响应性**：CPU 密集段按块 `await` 让出事件循环（每 N 条或每 M 字节），保证进度条不卡、可取消。

### 8.3 幂等与 GC

- 重复安装同版本：`versionKey` 相同则跳过（"重新下载"可强制重建）。
- GC：保留 current + 1 代；启动时清空 `tmp/`（崩溃残留清理）。
- 回滚：把 `active.json` 指回上一代（UI 暂不暴露，先作为运维后手）。

---

## 9. 数据访问层与性能策略（§28）

### 9.1 三层数据，各按所需加载

| 层 | 内容 | 何时读 | 规模 | 内存 |
|---|---|---|---|---|
| L1 元数据 | `catalog.json` | 启动读一次，常驻 | 2000 题 ≈ 0.5MB JSON | 常驻 1–2MB |
| L2 正文 | `question.md` / `answer.md` / `followups.md` | 打开题目时按需读，LRU 缓存（40 条）+ 相邻题预取 ±1 | 单文件 1–20KB | 峰值几百 KB |
| L3 搜索语料 | `index/body.txt` + `body.idx.json` | 首次正文搜索时懒加载索引表，语料**分块流式扫描** | 2000 题 ≈ 4MB | 峰值 ≈ 1 个块（256KB） |

### 9.2 正文全文搜索设计（替代 SQLite 的方案）

**安装期构建**（在 staging 内，失败即整体安装失败，不影响旧库）：

1. 每题 `question.md`（+ `answer.md`）规范化：去 Markdown 标记、去代码块、去 URL、压缩空白、**转小写**、换行折成空格 → 每题一行。
2. `index/body.txt`：`<id>\t<规范化正文>\n` 顺序拼接。
3. `index/body.idx.json`：`[{id, start, len}]`（约 2000 × 60B ≈ 120KB）。
4. `index/meta.json`：构建时间、题数、总字节、来源题库版本。

**查询期**：

1. `FileHandle.readBytes()` 按 256KB 顺序读，块边界对齐换行符（天然避开多字节字符截断）。
2. 块内子串匹配（已小写化），命中即解析行首 `id`。
3. **结果流式返回**：UI 显示"搜索中…已找到 N 条"，可取消。
4. 需要精确片段时，只对命中的少数题目重读 `question.md`（保留原大小写）生成高亮摘要 —— 命中数少，代价可忽略。
5. 命中集合与难度/标签筛选取交集，再按 §23 稳定排序。

**为什么够用**：把"2000 个小文件随机读"降维成"1 个大文件顺序读"，4MB 顺序读 + JS 子串扫描通常是**个位数到几十毫秒**，内存恒定。风险点是超长题目导致语料膨胀 → 本方案不截断，改为在安装报告给出语料体积，并在 §12 的决策门里实测。

### 9.3 列表与渲染性能

- 题目列表用 RN `FlatList`：`React.memo` 行组件 + `getItemLayout`（行高固定时）+ `windowSize`/`initialNumToRender` 调优。2000 条简单行远未到上限；若 M5 压测掉帧，再换 `@shopify/flash-list`（接口兼容，改动局限于一个组件）。
- 筛选是**内存纯函数**（2000 项 ≈ 亚毫秒）；搜索输入用 `useDeferredValue` 保证输入框不掉帧。
- Markdown 默认 `ScrollView` + `react-native-marked` 的 `useMarkdown`；节点数 > 300 时才切虚拟化渲染（留阈值，不提前优化）。
- 图片用 RN `Image`，本地 `file://` URI。
- 连续刷题预取：进入详情即预读 ±1 题的 `question.md`，让切题"不卡顿"（§28）。

---

## 10. 页面实现要点（PRD 逐条映射）

| PRD | 页面 | 实现要点 |
|---|---|---|
| §4 首次使用 | 启动引导 → 首页空状态 → 我的页配置 | 无题库不阻断进入；空状态给"前往配置题库"入口直达 §14.3 |
| §5.1 分类 | 首页 | 分类卡：名称 + 题目数（由 catalog 统计，**不写死**）；点击进列表 |
| §5.2 继续学习 | 首页 | 读 `readingStore.lastQuestionId`，卡片展示标题 + 断点；无记录则隐藏 |
| §5.3 空题库 | 首页 | 三件套：暂无题库 / 下载提示 / 配置入口 |
| §5.4 刷新 | 首页 | 下拉刷新 = **重读本地**（不触网）；失败给明确错误 |
| §6.1 列表项 | 题目列表 | 标题 + 难度芯片 + 标签（最多 3 个 + "+N"）+ 收藏星标 |
| §6.2 搜索 | 题目列表 | 标题即时匹配（高亮）+ 标签匹配；正文走 §9.2 流式搜索，结果分区展示 |
| §6.3 难度 | 题目列表 | 简单/中等/困难**多选**（并集），芯片可清空 |
| §6.4 标签 | 题目列表 | 标签树抽屉，父标签含所有子孙题；多选并集，父子同选时去重 |
| §6.5 筛选回显 | 题目列表 | 顶部条："共 N 题" + 关键词 + 难度芯片 + 标签面包屑，均可单独移除、一键清空 |
| §7.1 详情头 | 题目详情 | 标题 / 难度 / 所属分类 / 标签 / 收藏按钮（吸顶） |
| §7.2 正文 | 题目详情 | 标题、段落、粗斜体、列表、引用、分割线、行内代码、代码块（等宽 + 横滑 + 复制）、表格（横滑）、图片（点击全屏缩放）、链接（§11 外链走系统浏览器）。**不支持 HTML**（安全默认） |
| §8 参考答案 | 题目详情 + 设置页 | 默认隐藏（先读题目），"查看答案/隐藏答案"切换；**默认展开与否由「设置」里的用户选项决定（D9）**；无 `answer.md` → "暂无参考答案" |
| §9 面试官追问 | 题目详情 | 四层视觉区分；追问默认折叠，点击展开；追问答案完整 Markdown |
| §10 关联跳转 | 题目详情 | 内链拦截 → `router.push`；返回恢复滚动位置、答案展开态、追问展开态 |
| §11 外部链接 | 题目详情 | `Linking.openURL`，失败提示 |
| §12.1 上/下一题 | 连续刷题 | 会话冻结进入时的**筛选结果序列**（如 Spring+中等），切题不重新查询（§12.1 要求） |
| §12.2 手势 | 连续刷题 | `PanResponder` + 意图判定：`|dx| > 1.5×|dy|` 且起点不在横向可滚动子区（代码块/表格）才接管 → 从机制上避免与纵向滚动冲突 |
| §12.3 悬浮操作区 | 连续刷题 | 四按钮（上一题/下一题/答案/返回）；长按 300ms 进入拖动（`Animated.ValueXY` + `useNativeDriver`），松手存位置，下次按安全区+屏尺寸夹取恢复；不做吸附 |
| §13 收藏 | 收藏页 | 按 ID 存储 + 快照（标题/难度/标签）以便离线渲染；题库更新后按 ID 回连，已删除的**记录保留但不展示**（§13.1） |
| §14.1 学习进度 | 我的 | **只做「累计刷题总数」+ 每日目标可选项（D8 降级实现）**：不存日期、不算连续天数。"刷题"计数口径：**每次打开题目详情计 1 次（同一题重复打开也计）**；存储就是一个 `number`，无时区/断签边界问题 |
| §14.1b 设置 | 我的 | 一个「设置」区：**答案默认展开（开/关）**、悬浮按钮位置重置、题库地址管理入口 |
| §14.2 题库信息 | 我的 | 是否安装 / 名称 / 版本 / 题目总数 / 最近更新时间（`bank.*` + `active.json`） |
| §14.3 题库地址 | 我的 | 输入/修改/保存 ZIP 地址；**默认地址内置常量，用户保存值优先**；非法 URL 即时校验 |
| §14.4 下载安装 | 我的 | 下载/重新下载；显示状态 + 进度（`onProgress`）+ 阶段（正在下载/正在解压/正在校验/正在安装/安装完成）+ 失败原因 + 安装报告 |
| §15 更新机制 | 安装流程 | 完整包替换 + 版本目录切换；不做增量/Git diff（§32） |
| §16–§23 规范 | 安装器 | 见 §6 与配套规范文档 |
| §24 安全 | G1–G4 | 见 §7 |
| §26 离线 | 全局 | 除下载外**零网络调用**：core 无网络端口，联网能力仅存在于 install 步骤，并用 lint 规则禁止其他模块 import 网络 API |
| §27 本地数据 | 全局 | 题库文件 + 地址 + 收藏 + 最近查看 + 学习记录 + 每日数量 + 连续天数 + 悬浮位置 + 每日目标全本地；AsyncStorage 键统一 `facee/v1/*` + schemaVersion |
| §29 异常 | 全局 | 错误码表（§7.2）→ 统一错误组件：文案 + 原因 + 可操作建议（重试/换地址） |
| §30 Web | 平台层 | 自写 IndexedDB/内存 VFS 实现 `StoragePort`；Web 不提供 ZIP 本地安装，改为"加载内置示例题库"用于 UI 调试与 Markdown 展示验证 |
| §31 技术约束 | 全局 | 见 §3；dev build 仅在需要原生模块/release 时启用 |
| §32 不做 | — | 方案中**不含**登录/后端/云同步/在线编辑/AI 相关模块与依赖 |
| §33 闭环 | 里程碑 | M1–M5 逐段覆盖，M5 做端到端验收 |

---

## 11. 交互细节（容易踩坑的地方）

1. **阅读状态恢复（§10）**：`readingStore` 保存 `{ [questionId]: { scrollY, answerVisible, expandedFollowups: number[] } }`。expo-router 的 Stack 保留上一屏，配合 store 可做到"返回后连展开的追问都还在"。关联题用 `push`（不是 `replace`）。
2. **手势冲突（§12.2）**：用 `PanResponder` 的**意图判定**（`|dx| > 1.5×|dy|`）而非事件顺序；并且用"触摸起点是否落在横向可滚动子区（代码块/表格 ScrollView）"的标记位做二次否决，让横向滚动优先。这条必须在真机/模拟器上手工验证，不能只靠逻辑推断。
3. **拖动与点击的冲突（§12.3）**：拖动过程中禁用按钮点击（避免"拖完误触下一题"）；位置以左上角锚点 + 屏幕相对百分比存储，横竖屏/不同机型都能还原到合理位置；不吸附（PRD 明确不要求）。
4. **切题时的滚动复位**：切到新题滚回顶部；返回旧题恢复到原位置 —— 二者用**不同**的恢复策略，别共用一套。
5. **答案展开态（D9）**：由设置项决定**新题的默认展开态**；用户在单题上手动切换是临时状态，**不写回设置**。切题时不跟着乱跳。
6. **JS 解压期间的可取消性**：每个 `await` 边界检查取消标志；取消后删除整个 `tmp/<uuid>/`。

---

## 12. 测试与验收方案

### 12.1 可自动化（覆盖风险最高的部分）

| 测试对象 | 环境 | 用例要点 |
|---|---|---|
| ZIP 中央目录解析 | Jest + 真实 ZIP 字节 | 正常包 / 数据描述符(bit3) / ZIP64 / 加密 / 截断 EOCD / 随机字节 |
| 安全校验（G1/G2/G4） | Jest + 恶意 fixture | **§7.2 每个 E_\* 码对应一个失败用例**，并断言"未产生任何非预期文件" |
| 安装状态机 | Jest + 内存 VFS + **故障注入** | 在 precheck→…→committing **每一步**注入失败（含网络中断、空间不足、解压中途失败），断言：`active.json` 未变、旧题库可读、tmp 被清理 |
| 原子提交 | Jest + node-fs | 提交瞬间指针一致性；崩溃残留清理 |
| 标签树与筛选 | Jest | 父含子孙、多选并集去重、难度并集、排序稳定性（同 order 按 id） |
| 搜索语料与扫描 | Jest | 规范化正确性、跨块命中、多字节字符边界、中文子串、大小写不敏感、性能基准（2000 题合成语料 < 200ms） |
| followups 解析 | Jest | 正常 / 无文件 / 单条 / 标题变体 / 代码块内含 `##`（不应误切） |
| 进度与连续天数 | Jest + 假时钟 | 跨日、跨时区、断签、同题当日去重、目标修改 |
| 关键 UI 流程 | Web 构建 + 浏览器自动化 | 空状态 → 配置 → 安装 → 列表筛选 → 详情 → 追问展开 → 收藏 → 进度 |
| JS 解压性能/内存 | Node 基准脚本 | 20MB / 2000 条 ZIP 的解压耗时与峰值内存（预测真机表现） |

### 12.2 必须真机/模拟器验证

| 项 | 方式 | 通过标准 |
|---|---|---|
| 端到端安装 | Expo Go（真机或模拟器） | 示例题库 ZIP 安装成功；**全部恶意 fixture 被拒且旧库完好** |
| 中断与恢复 | 手动断网 / 杀进程 | 下载中断有明确提示并可续传；重启后旧题库仍可用 |
| 性能指标（§28） | 2000 题合成题库 | 冷启动到首页可交互 < 1.5s；列表滚动无明显掉帧；正文搜索首结果 < 300ms；切题无可感卡顿 |
| 安装耗时（决策门输入） | 2000 题合成题库 | 记录真实数字，与 §12.3 的门槛比较 |
| 手势与悬浮按钮 | 模拟器 + 真机 | 纵向滚动不被切题手势打断；长按拖动顺滑；重启位置还原 |
| 空间不足 | 模拟器限制存储 | 显示 §29 固定文案，且不启动安装 |

### 12.3 ★ 性能决策门（M5，决定是否引入原生解压）

> D5 的"原生预留"是否启用，由实测数据说话，而不是偏好。

| 指标 | 通过线 | 不通过则 |
|---|---|---|
| 2000 题安装总耗时（下载后计入） | **≤ 60s** | 引入 `react-native-zip-archive`（改 `ArchivePort` 一处实现 + dev build） |
| 解压阶段峰值内存 | **≤ 150MB** | 同上 |
| 解压期间 UI 可交互（进度条不冻结） | 30fps 以上 | 同上（或加大让出频率） |
| 语料体积 | ≤ 32MB | 调整语料上限或分片策略 |

若全部通过 → **永远不需要原生模块**，Android/iOS 发布仍可用 Expo 的构建流程（需要时 EAS）。

---

## 13. 里程碑（含验收标准）

| 里程碑 | 内容 | 交付物 | 验收标准 | 估时 |
|---|---|---|---|---|
| **M0 骨架** | Expo SDK 57 工程初始化、TS 严格模式、ESLint 边界规则（core 禁 RN/expo import、禁网络 import）、Jest 通路、expo-router 空壳导航 | 能在 **Expo Go + 浏览器**里跑起来的空 App | `npx expo start` 双端可打开；`npm test` 通过；lint 能拦住越界 import | 0.5 天 |
| **M1 题库规范 + 生成器** ✅ **已完成** | 规范 v1 文档、**29 题示例题库**（覆盖全部验收样本）、生成器 CLI、**24 个恶意 ZIP fixtures**、真实 GitHub 仓库与两个版本分支 | `bank-spec` 包 + 已发布的题库地址（§6.5） | ✅ **已验收**：24/24 fixtures 被正确拒绝；29 题示例库 0 error；**两个真实 GitHub 归档 ZIP 均通过校验**（含 wrapper 目录与目录条目） | 1–1.5 天（已完成） |
| **M2 安装管线** | G1 中央目录解析、G2 白名单、G3 自控落盘（fflate 流式）、G4 复核、校验器全套、状态机、原子提交、进度与取消、错误码 UI、安装报告 | 安装页 + core 单测全绿 | §12.1 安装/安全用例 100% 通过；故障注入下旧库零损坏 | 2–3 天 |
| **M3 浏览闭环** | 首页（分类/继续学习/空状态/刷新）、题目列表（搜索/难度/标签/筛选回显）、详情（Markdown 全元素/答案/追问/外链/关联跳转） | §5–§11 全部可用 | 对照 §10 映射表逐条演示通过；浏览器自动化流程全绿 | 3–4 天 |
| **M4 刷题体验** | 连续刷题会话、上/下题、手势切题、可拖动悬浮区、阅读状态恢复、收藏、学习进度 | §12–§14 全部可用 | 手势不冲突；位置还原正确；收藏在换版后按 ID 保留 | 2–3 天 |
| **M5 搜索 + 性能门 + 端到端** | `index/body.txt` 语料与流式搜索、2000 题压测、§12.3 决策门判定、§33 闭环验收 | 压测报告 + 是否需要原生解压的结论 | §12.2 指标全部达标；决策门有明确结论 | 1.5–2 天 |
| **M6 发布准备**（可选/按需） | Android release 构建（配置 `ANDROID_HOME`+`adb`、keystore）、需要时的原生解压实现、iOS 走 EAS | Android release 包 | 真机安装可离线使用完整闭环 | 1–2 天 |

合计约 **11–16 个工作日**（单人节奏，不含 iOS 构建）。每个里程碑结束都可交付验收，而不是最后一次性交付。

---

## 14. 风险与未决问题

### 14.1 风险登记（v2 已按轻量档重估）

| 风险 | 等级 | 应对 |
|---|---|---|
| **JS 解压性能/内存不达标** | **中** | 这是本方案唯一被"轻量"换来的实质风险，已用 **§12.3 决策门**量化前置；兜底实现（原生解压）已预留同一接口，切换成本 < 100 行 + 一次 dev build |
| JS 解压阻塞 UI 线程 | 低-中 | 分块 `await` 让出；真机验收"进度条不冻结" |
| ZIP64 / 数据描述符解析（GitHub codeload 的 ZIP 常带 bit3） | 中 | G1 把"bit3 数据描述符"与"ZIP64 EOCD"作为**一等测试用例**，不是后补 |
| Web 存储适配工作量被低估 | 低-中 | Web 只服务 UI 调试（§30 不要求 ZIP 安装）→ 用内存/IndexedDB VFS + 内置示例题库，不追求完整离线 |
| 手势冲突（§12.2）在真机上的实际表现 | 中 | 意图判定 + 起点否决双条件；列为**必须真机手工验证**项，接受一次可能的迭代 |
| FlatList 在极端列表下掉帧 | 低 | 已在 §9.3 写明升级路径（换 FlashList，改动局限于一个组件） |
| 首次原生构建（仅 M6 需要）失败 | 低（已推迟） | 与业务开发解耦；必要时降 SDK 56（同架构，改动小） |
| iOS 本机不可构建 | 中 | 外部依赖：EAS 或 macOS；代码层保证无平台特化逻辑 |
| 正文语料体积超预期 | 低-中 | 安装报告给出体积；§12.3 设 32MB 门槛 |
| 中文全文搜索召回预期 | 低 | 子串匹配天然覆盖中文；不引入分词 = 不丢召回；用排序（标题 > 标签 > 正文）缓解命中偏多 |

### 14.2 相对 v1 方案的变化（透明记录）

| 变化 | v1 | v2 | 代价 |
|---|---|---|---|
| ZIP | 原生为主 + JS 兜底 | **JS 为主 + 原生预留** | 换取"无原生构建的快速迭代"；性能风险前置到决策门 |
| 安全模型 | 三层防御（防原生库） | **四道闸（G3 由我们写盘）** | 安全性提升，不再是"信任第三方" |
| 依赖 | 15 个 | **8 个** | 去掉 reanimated / gesture-handler / flash-list / expo-image |
| 里程碑 | 12–18 天，M1 就做原生 | **11–16 天，M0 即可双端跑** | 前期反馈快；发布成本后移 |
| Web | 端口 web 实现 | 同（明确 IndexedDB VFS，因新 FS API 无 Web 支持） | 事实核实后的细化 |

### 14.3 需要你拍板的开放问题（不影响开工）

1. **默认题库 ZIP 地址**用什么？（§14.3 允许内置默认值；样例阶段内置本地静态服务地址，你给真地址我就换）
2. **"刷题"计数口径**：按"当日首次打开某题 = 1 次，同题当日去重"，是否就是你要的口径？
3. **答案展开偏好的记忆方式**：全局偏好 + 单题覆盖（推荐）vs 仅单题。
4. **示例题库规模**：建议 ~60 题（覆盖全部特性）+ 2000 题合成压测库，两套分开。
5. **iOS 是否本轮就要**：要则必须走 EAS（需账号/额度）或 macOS 机器。
6. **GitHub 题库的真实形态**：你说是"线上 git 题库"——如果是仓库源码 ZIP（`codeload`），我们的目录规范要求 `catalog.json` 在根或唯一顶层目录下；如果你的仓库结构不同（例如题库在子目录 `bank/`），告诉我，我在 G1 里加一层"根定位规则"（成本很小，但需要你给结构）。

---

## 15. 附录：可追溯性矩阵（PRD 覆盖检查）

| PRD 条款 | 实现位置 | 里程碑 | 验收方式 |
|---|---|---|---|
| §4 首启 | 启动引导 / 空状态 / 我的 | M3 | 手工 + 浏览器自动化 |
| §5 首页 | `(tabs)/index.tsx` | M3 | 手工 + 浏览器自动化 |
| §6 列表/搜索/筛选 | `category/[id].tsx` + core 选择器 | M3/M5 | 单测 + 手工 |
| §7 详情 | `question/[id].tsx` + Markdown 渲染器 | M3 | 手工（全元素样例题） |
| §8 参考答案 | 同上 + 设置页 | M3 | 无答案题样例 + 设置项切换 |
| §9 追问 | `followups.md` 解析 + 折叠组件 | M3 | 单测 + 手工 |
| §10 关联跳转 | `questionRef.ts` + push/返回恢复 | M3 | 样例题库含关联题 |
| §11 外链 | `Linking.openURL` | M3 | 手工 |
| §12 连续刷题 | 会话 store + PanResponder + 悬浮区 | M4 | 模拟器/真机手工 |
| §13 收藏 | `favoriteStore`（ID + 快照） | M4 | 单测（换版保留 / 删除隐藏） |
| §14 我的 | `(tabs)/me.tsx` + 安装页 | M2/M4 | 手工 + 浏览器自动化 |
| §15 更新机制 | 完整包 + 版本目录 | M2 | 单测（原子性） |
| §16–§23 规范 | `packages/bank-spec` + core 校验 | M1/M2 | 生成器 + 单测 |
| §24 ZIP 安全 | 四道闸 G1–G4 | M2 | 恶意 fixture 单测（逐码） |
| §25 原子安装 | 指针文件 + 版本目录 | M2 | 故障注入单测 |
| §26 离线 | core 无网络 + lint 边界 | M2/M5 | lint + 断网手工验收 |
| §27 本地数据 | AsyncStorage `facee/v1/*` | M2–M4 | 单测 + 重启验证 |
| §28 性能 | 三层按需加载 + FlatList + 预取 | M5 | 压测报告 |
| §29 异常 | 错误码表 + 统一错误组件 | M2 | 单测 + 手工 |
| §30 Web | 自写 VFS + 内置示例题库 | M0/M3 | 浏览器自动化 |
| §31 技术约束 | 选型表 §3 | M0 | 依赖清单评审 |
| §32 不做 | 无相关依赖与模块 | 全程 | 依赖清单评审 |
| §33 闭环 | M1–M5 | M5 | 端到端演示 |
