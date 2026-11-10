# FaceE

**面向 GitHub 题库的刷题助手。** 题库放在 Git 仓库里，App 拉下来之后完全离线刷题。

[![CI](https://github.com/hbxtzhn/facee/actions/workflows/ci.yml/badge.svg)](https://github.com/hbxtzhn/facee/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/hbxtzhn/facee?label=release)](https://github.com/hbxtzhn/facee/releases/latest)
[![Android](https://img.shields.io/badge/platform-Android%208.0%2B%20arm64-green)](https://github.com/hbxtzhn/facee/releases/latest)

## 为什么做成这样

面试题散落在博客、PDF、各种仓库里，手机上刷要么没网、要么排版乱、要么被某个 App 绑死。

FaceE 换个做法：**题库就是一个 Git 仓库**。

- 刷什么你说了算 —— Java 后端、数据库、算法，或你自己整理的那一套，都是一份题库
- 换题库不用换 App —— 在「我的」里改一个地址就行
- 装完就能断网 —— 之后浏览、搜索、收藏、连续刷题全在本地

## 快速开始

1. 下载安装 [最新版 APK](https://github.com/hbxtzhn/facee/releases/latest)（Android 8.0+，arm64，需允许安装未知来源）
2. 打开 App →「我的」→「线上题库」，一键安装官方题库，或粘贴其他题库 Release 里的 `latest.json` 地址；也可以在「题库管理」里导入题库文件或新建本地题库
3. 开始刷题，之后可以关掉网络

## 能做什么

**刷题与记录**

- 每道题先给「一句话」结论和 3–5 条「要点」：练习时答案先遮住，自己答完再展开
- **要点自评**：逐条勾选自己答到了哪些要点，按加权覆盖率建议「不会 / 模糊 / 会了」，由你确认
- 追问逐条折叠，可单独标记会不会；支持选择题（提交后显示对错与解析）
- 间隔复习：不会 1 天、模糊 3 天，会了按 7 → 14 → 30 → 60 天逐次拉长；到期出现在首页「今日复习」
- 连续刷题：左右滑动翻页，底部操作栏放掌握度、显示答案与上一题 / 下一题；「继续上次练习」按题库恢复原队列与位置
- 收藏与错题本（不会 / 模糊）按题库隔离；阅读字号三档可调

**找题与看题**

- 分类、标签（父标签含子孙）、专题（作者整理的有序题单）、难度 / 题型 / 重要度 / 掌握度筛选
- **自定义分区**：把多个分类归到自己建的分区里，可改名、排序、删除，不影响题库本身
- 全文搜索整个题库（标题、一句话、要点、详解、追问）
- 题目内容更新后标记「内容已更新」；完整 Markdown（表格、代码块、图片放大）；题库提供纠错地址时每题有「内容有误？」入口

**题库管理**

- **线上题库**：只读、可在线更新。检查更新只拉一个几 KB 的清单，先显示「新增 / 修改 / 删除了几题」与更新说明，确认后再下载；整库在一个事务内替换，失败时旧版本完好
- **本地题库**：新建或把线上题库复制为本地后自由编辑，表单按结构编辑一句话、要点、追问、选择题等；可导出为题库文件分享，也可导入别人分享的题库文件
- 更新或删除题库不影响学习记录；删除时可选择是否一并清除
- **备份与恢复**：收藏、掌握度、自评、分区与本地题库导出为一个文件，在新设备上合并恢复
- **AI 出题**：从文本或单张 JPEG/PNG/WebP 图片（≤8 MB）抽取结构化题目，预览勾选后加入本地题库；对不满意的题可让 AI 改写对比

**更新**

- 应用与题库都能在 App 内更新。应用安装包只从 GitHub 官方域名经 https 下载，安装前比对发布页的 SHA256SUMS，最终由系统签名校验兜底；题库包下载后校验清单中的 SHA-256 与大小

## 隐私

FaceE 没有账号、没有统计、没有广告。所有数据（题库、收藏、掌握度、设置）只存本机。
除此之外，如实说明以下几点：

- **APP 可选功能「AI 导入」会联网**：它把你确认导入的文本或图片发送到**你自己在「AI 设置」里填的第三方服务**（OpenAI 兼容端点），可能产生费用。不配置就不会调用 AI。图片选择/预览本身不上传，需另点「发送图片并抽取」，且模型必须支持视觉输入；图片可能包含个人信息或原始元数据，请谨慎上传。图片不作为题库附件保存，只有确认勾选的题目内容进入题库；系统选择器可能保留临时缓存。不增加拍照/录音权限。
- API Key 存在系统加密存储中（Android Keystore / iOS Keychain），不参与系统备份，也不进入 App 的备份文件；换机后需要重新填写。Web 预览没有安全存储实现，会退化到浏览器本地存储（仅供功能预览）。
- 填 `http://` 开头（非 https）的服务地址时，App 会提示：Key 与文本将以明文发送。
- 系统自动备份（`allowBackup`）保持开启，用于迁移时恢复收藏与进度；其中已不含 LLM Key。
- 联网清单：下载题库、检查应用与题库更新、上述可选的 AI 调用，以及题目 Markdown 引用的远程图片。官方构建工具只允许题库自带的本地图片；手动导入的题库文件若引用远程图片，加载时会向其服务器发起请求（可暴露 IP），断网时无法显示。

安全漏洞请按 [SECURITY.md](SECURITY.md) 私下报告。

## 许可

- **App 代码**：[MIT](LICENSE) © HBxtzhn（起步于 Expo 模板，Expo SDK 采用 MIT）
- **示例题库内容**：独立的 [facee-bank](https://github.com/hbxtzhn/facee-bank) 仓库，采用 **CC-BY-4.0**，与 App 是两份许可
- **第三方组件与字体许可**：见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)；发布资产同时提供 `THIRD_PARTY_LICENSES.txt`，重新分发时请保留许可声明

## 开发

需要 Node **22.13+**、pnpm **11** 与 Android SDK（**目前仅支持 Android**，iOS 配置为模板残留未作支持承诺；Web 仅供功能预览）：

```bash
pnpm install && pnpm test
npx expo run:android
```

环境细节、prebuild、config plugin、发布签名与一键发版（`scripts/release.mjs`）见
[CONTRIBUTING.md](CONTRIBUTING.md)。更新记录见 [CHANGELOG.md](CHANGELOG.md)。

## 题库格式

题库按 [题库规范 v2](docs/题库规范-v2-草案.md) 编写与发布：

```
bank.yaml                                  # 题库信息、分类、标签、专题、生命周期
questions/<分组>/<题目 id>.md               # 每题一个文件：元数据 + 题目 / 一句话 / 要点 / 详解 / 示例 / 易错点 / 追问
questions/<分组>/assets/                    # 图片（可选）
```

`packages/bank-spec` 提供 `new` / `fix-ids` / `validate` / `build` 命令（`pnpm bank <命令>`），
构建出 App 下载的 `bundle-<版本>.json`、资源包与 `latest.json` 更新清单；示例题库见
`packages/bank-spec/examples/sample-bank`。题目勘误与缺题请到
[facee-bank](https://github.com/hbxtzhn/facee-bank/issues) 反馈。
