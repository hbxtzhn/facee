# src/bank — 题库 v2 数据层

规范见 [`docs/题库规范-v2-草案.md`](../../docs/题库规范-v2-草案.md)。分发格式契约在 `types.ts`（构建工具与 App 共享，不要随意改）。
本模块与旧版 `src/question-bank/**`、`src/store/**` 并存且互不读取（v2 从零开始）。

UI 只从 `src/bank`（`index.ts`）导入，核心是 zustand store `useBankStore`。

## 快速上手

```ts
import { useBankStore } from '../bank';

// App 启动时调用一次（重复调用安全）
await useBankStore.getState().initialize();

const { status, activeBank, categories, busy, progress, lastError } = useBankStore();
const result = await useBankStore.getState().addOnlineBank(url);
if (!result.ok) showToast(result.error.message);
```

## 结果约定

- **所有异步 action 永不 reject**，返回 `BankResult<T>`：`{ ok: true, value }` 或 `{ ok: false, error: { code, message, details? } }`。
  失败同时写入 `lastError`（可统一 toast，`clearError()` 清除）。`message` 是可直接展示的中文。
- `error.code`（`BankErrorCode`）：`unsupported`（Web）、`not-ready`、`busy`、`network`、`integrity`（size / sha256 / 资源不符）、
  `invalid`（不符合规范，`details` 为带路径的问题列表）、`schema-version`（需升级 App）、`app-too-old`（低于 minAppVersion）、
  `not-found`、`forbidden`（如编辑非本地题库）、`unknown`。
- **独占操作**：`addOnlineBank`、`importBankFile`、`updateBank`、`deleteBank`、本地题库 / 题目的所有增删改、`importBackup`。
  进行中 `busy = { kind, bankId }`，安装 / 更新时 `progress = { stage, message }`；此时再发起独占操作立即返回 `code: 'busy'`（不排队）。
  查询与学习数据写入不受 busy 限制。
- **刷新信号**：store 不缓存题目列表。题库内容变化（安装 / 更新 / 编辑 / 切换 / 删除）后 `contentVersion` +1；
  学习数据变化（打标 / 收藏 / 自评 / 浏览 / 分区 / 恢复备份）后 `learningVersion` +1。列表页把二者作为 effect 依赖重新查询。
- 带「当前题库」语义的 action（学习数据、会话、分区）作用于 `activeBankId`；查询类可传 `bankId` 覆盖。

## 状态

| 字段 | 说明 |
|---|---|
| `status` | `idle` / `initializing` / `ready` / `unsupported`（Web）/ `error` |
| `banks` | 全部题库 `BankSummary[]`（origin：`remote` 在线可更新 / `local` 自建可编辑 / `file` 文件导入只读；`lastCheck` 为最近检查更新结果） |
| `activeBankId` / `activeBank` | 当前题库（持久化在 SQLite `app_settings`） |
| `categories` | 当前题库分类：题数、已标数、会了数；按 order → id |
| `tags` | 标签：`parentId`、`childIds`、含子孙的题数 |
| `collections` | 专题（有序题单，只含存在的题） |
| `sections` | 自定义分区（issue #3）；分类已不在题库中时 `exists: false, name: null` |
| `stats` | 当前题库学习统计（总数 / 已标 / 各档 / 到期 / 收藏 / 内容已更新） |
| `assetBaseUri` | 当前题库资源目录；`resolveActiveAssetUri('asset:<sha>.png')` 同步解析 |
| `busy` / `progress` / `lastError` | 见上 |

## Action 一览

| 分组 | action |
|---|---|
| 生命周期 | `initialize(options?)`、`refresh()`、`clearError()` |
| 题库管理 | `addOnlineBank(manifestUrl)`、`importBankFile(uri, assetsZipUri?)`、`checkUpdate(bankId)`（只拉 latest.json，返回新增 / 修改 / 删除 id 与 changes）、`updateBank(bankId)`、`switchBank(bankId)`、`deleteBank(bankId, { purgeLearningData? })`、`exportBankFile(bankId)` |
| 本地题库 | `createLocalBank`、`updateLocalBankInfo`、`addLocalCategory` / `updateLocalCategory` / `deleteLocalCategory(…, { moveQuestionsTo })` / `reorderLocalCategories`、`addLocalTag` / `updateLocalTag` / `deleteLocalTag`、`addLocalQuestion` / `updateLocalQuestion` / `deleteLocalQuestion` / `reorderLocalQuestions` |
| 查询 | `listQuestions(filter?)`、`search(query, { filter?, limit? })`、`getQuestion(id)`、`listDueQuestionIds()`、`listArchivedQuestionIds()`、`listKeypointAttempts(id)` |
| 学习数据 | `markViewed(id)`、`setMastery(id, mastery \| null)`、`recordKeypointCheck(id, { kp1: true, … })`、`setFollowupMastery(id, fid, mastery \| null)`、`toggleFavorite(id)` |
| 练习会话 | `getSession()`、`saveSession({ queue, index, mode, title? })`、`updateSessionIndex(i)`、`clearSession()` |
| 自定义分区 | `createSection(name)`、`renameSection`、`deleteSection`、`reorderSections(ids)`、`addCategoryToSection`、`removeCategoryFromSection`、`reorderSectionCategories` |
| 备份 | `exportBackup()`（返回 JSON 文件 URI）、`importBackup(uri)`（合并，返回导入 / 跳过的本地题库与本机缺少的在线题库） |

`QuestionFilter`：`categoryIds`、`tagIds`（自动含子孙标签）、`difficulties`、`types`、`importance`、`collectionId`（按专题顺序）、
`mastery`（含 `'unmarked'`）、`favoritesOnly`、`dueOnly`、`updatedSinceSeen`、`questionIds`。
默认排序：分类 order → 分类 id → 题目在 bundle 中的顺序 → 题目 id。

`getQuestion` 返回 `QuestionDetail`：`question`（Markdown 中 `asset:` 已改写为文件 URI，直接渲染）、`raw`（原始数据，编辑本地题用）、
`categoryName`、`learning`（掌握度、排期、收藏、「内容已更新」、追问掌握、最近一次要点自评）。

## 行为说明

- **间隔复习**（`spaced-review.ts`，与 v1 口径一致）：不会 1 天、模糊 3 天、会了 7 → 14 → 30 → 60 天（封顶）；
  「会了」的连续次数只有在**到期后**再次确认才增长，未到期重复确认保持不变；不会 / 模糊清零。
- **要点自评**：每次自评整组记录（同一时间戳），按要点权重算覆盖率；`suggestMasteryFromCoverage` 给出建议（≥0.8 会了、≥0.4 模糊），不自动打标。
  题库更新删掉的要点，其历史记录归入 `archivedKeypointIds`。
- **「内容已更新」**：浏览或打标时记下 `seen_hash`，与当前 `content_hash` 不同即为已更新；`markViewed` 清除。
- **搜索**：按空白拆词并 AND；≥ 3 字的词走 FTS5 trigram，1–2 字（如「事务」）对同一 FTS 表做 LIKE；标题命中排在前面。
- **lifecycle**：`merged` 的学习数据并入最终目标题（冲突取最近一次标记，收藏 / 自评并集，会话队列改写）；`removed` 的标记归档（`listArchivedQuestionIds`）。
- **本地题库**：id 为 `local/device/<ULID>`（满足三段式 BANK_ID_PATTERN，`local` 不是域名，不会与在线题库冲突）。
  每次修改都用与在线题库相同的 `validateBundle` 整库校验（要点 3–5 条等规则不放宽），版本号 patch 位自增；
  要点 / 追问 id 单调递增、删除后不复用；删除题目写入 `lifecycle.removed`。导出的 bundle 可分享，`importBankFile` 再导入后仍为可编辑的本地题库。
- **contentHash**：`sha256:` + 去掉 `contentHash` 的题目对象规范化 JSON（键按 UTF-16 码元排序、无空白、省略 undefined）的 UTF-8 sha256；
  资源以 `asset:<sha256>.<ext>` 出现在 Markdown 中，因此资源哈希已包含在内。安装时只校验其格式，不重算。
- **备份**：纯 JSON（本地题库暂不支持图片，无需 ZIP），含全部学习数据表 + 本地题库 bundle + 已安装题库清单；
  恢复按主键合并，`updated_at` 较新者胜出，收藏与自评取并集，本地题库仅在不存在或备份版本更高时导入。

## Web

expo-sqlite 在 Web 需要 wasm 与 COOP/COEP 头，预览环境不具备。平台分文件：`runtime.ts` / `db/open.ts`（Web，返回 null / 报 unsupported）
与 `runtime.native.ts` / `db/open.native.ts`（原生）。Web 包里不含 expo-sqlite（已用 `expo export --platform web` 验证）。
`initialize()` 后 `status === 'unsupported'`，UI 应显示「Web 预览不支持本地题库」。

## 安装 / 更新的原子性

清单 → 下载 bundle 到缓存暂存目录并校验 size + sha256（失败按 `mirrors` 顺序重试）→ 解析 + 规范校验 → 资源 ZIP 校验后解压到**新的**
`documentDirectory/bank-assets/<bankId 哈希前 16 位>-<token>/`，逐个校验文件 sha256 与文件名一致 → **单个独占事务**内删除该库题库行、
插入新行与 FTS、执行 lifecycle 迁移、更新 banks 行 → 提交后才删除旧资源目录。任一步失败，上一版本完整保留。
资源 ZIP 的 sha256 与已安装的相同时直接复用旧目录、不重复下载。

sha256 是纯 JS 实现（`src/lib/sha256.ts`），V8 上约 85 ms / 3 MB，`node --jitless`（近似 Hermes 解释执行）约 1.4 s / 3 MB；
原生端按 512 KB 分块计算并在块间让出事件循环，避免长时间阻塞 UI。

## 测试

测试跑真实 SQL：`db/node-sqlite.ts` 用 Node 内置 `node:sqlite`（Node 22.20 自带 SQLite 3.50，含 FTS5 + trigram）实现同一适配接口；
`__fixtures__/node-runtime.ts` 提供临时目录文件系统与内存「网络」，`__fixtures__/sample-bank.ts` 是手写的小题库。

## 文件

| 文件 | 职责 |
|---|---|
| `store.ts` | UI 入口（zustand），结果约定、busy、刷新信号 |
| `install.ts` | 添加 / 导入 / 检查更新 / 更新、资源解析 |
| `repository.ts` | 题库列表、当前题库、删除、分类 / 标签 / 专题、列表筛选、详情、搜索 |
| `learning.ts` | 掌握度与排期、浏览、要点自评、追问、收藏、到期、统计、已移除题目 |
| `sessions.ts` / `sections.ts` | 练习会话 / 自定义分区 |
| `local.ts` | 本地自建题库 CRUD、导出 |
| `backup.ts` | 备份导出 / 恢复 |
| `validate.ts` | bundle / manifest 运行时校验、SemVer 比较 |
| `lifecycle.ts` | 安装后的学习数据迁移 |
| `bank-rows.ts` | 题库表写入原语 |
| `db/` | 适配接口、迁移、expo-sqlite（原生）/ node:sqlite（测试）实现 |
| `hash.ts` / `ulid.ts` / `spaced-review.ts` | contentHash、ULID、复习间隔 |
