# FaceE

**面向 GitHub 题库的刷题助手。** 题库放在 Git 仓库里，App 拉下来之后完全离线刷题。

[![CI](https://github.com/HBxtzhn/facee/actions/workflows/ci.yml/badge.svg)](https://github.com/HBxtzhn/facee/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/HBxtzhn/facee?label=release)](https://github.com/HBxtzhn/facee/releases/latest)
[![Android](https://img.shields.io/badge/platform-Android%208.0%2B%20arm64-green)](https://github.com/HBxtzhn/facee/releases/latest)

## 为什么做成这样

面试题散落在博客、PDF、各种仓库里，手机上刷要么没网、要么排版乱、要么被某个 App 绑死。

FaceE 换个做法：**题库就是一个 Git 仓库**。

- 刷什么你说了算 —— Java 后端、数据库、算法，或你自己整理的那一套，都是一份题库
- 换题库不用换 App —— 在「我的」里改一个地址就行
- 装完就能断网 —— 之后浏览、搜索、收藏、连续刷题全在本地

## 快速开始

1. 下载安装 [最新版 APK](https://github.com/HBxtzhn/facee/releases/latest)（Android 8.0+，arm64，需允许安装未知来源）
2. 打开 App →「我的」→「增加题库」，粘贴题库 ZIP 地址（比如 [facee-bank](https://github.com/HBxtzhn/facee-bank) Release 里的下载链接）
3. 开始刷题，之后可以关掉网络

## 能做什么

**刷题与记录**

- 连续刷题：只在你当前的筛选结果里切换；左右滑屏切题，悬浮进度按钮点按展开答案、长按拖动
- 间隔复习：标记「不会 / 模糊 / 会了」后按 1 / 3 / 7 天排期，到期出现在首页「今日复习」
- 收藏与错题本：错题（不会 / 模糊）自动汇聚，收藏页支持题内搜索
- 掌握度与进度按题库隔离，换题库不串味

**找题与看题**

- 分类 / 标签（父标签自动含子孙）/ 难度多选，全文搜索（标题 + 正文）
- 完整 Markdown：表格、代码块（等宽字体）、图片可点击放大（双指缩放）
- 参考答案与面试官追问折叠、关联题跳转
- 手势：详情页与列表页左缘右滑返回，看图下滑关闭

**题库管理**

- 从 URL 安装题库 ZIP：结构预检 → 白名单 → 原子安装，装坏了不丢旧题库
- 已装题库一键**在线更新**，显示新增 / 移除数量
- 已装题库（含线上）一键**复制为本地可编辑副本**，增删改题自由发挥
- **本地题库**：从零新建、手动录题；多题库共存、随时切换
- **备份与恢复**：本地题库（含图片资产）打包 ZIP 走系统分享，增量导入
- **AI 从文本出题**：导入 .md/.txt 或粘贴面经笔记，按段生成题目，预览勾选后并入；对不满意的题可让 AI 重写对比

**更新**

- 应用与题库都能在 App 内更新。安装包只从 GitHub 官方域名经 https 下载，安装前比对发布页的 SHA256SUMS，最终由系统签名校验兜底

## 隐私

FaceE 没有账号、没有统计、没有广告。所有数据（题库、收藏、掌握度、设置）只存本机。
除此之外，如实说明以下几点：

- **APP 可选功能「AI 从文本出题」会联网**：它把你导入的文本发送到**你自己在「AI 设置」里填的第三方服务**（OpenAI 兼容端点）。不配置就完全不启用，功能与数据都在本地。
- API Key 存在系统加密存储中（Android Keystore / iOS Keychain），不参与系统备份，也不进入题库备份 ZIP；换机后需要重新填写。Web 预览没有安全存储实现，会退化到浏览器本地存储（仅供功能预览）。
- 填 `http://` 开头（非 https）的服务地址时，App 会提示：Key 与文本将以明文发送。
- 系统自动备份（`allowBackup`）保持开启，用于迁移时恢复收藏与进度；其中已不含 LLM Key。
- 联网清单：下载题库、检查应用与题库更新、上述可选的 AI 调用，以及题目 Markdown 引用的远程图片。远程图片会向其服务器发起请求（可暴露 IP），断网时无法加载；需要完全离线的题库应把图片放进 ZIP 的 assets/。

安全漏洞请按 [SECURITY.md](SECURITY.md) 私下报告。

## 许可

- **App 代码**：[MIT](LICENSE) © HBxtzhn（起步于 Expo 模板，Expo SDK 采用 MIT）
- **示例题库内容**：独立的 [facee-bank](https://github.com/HBxtzhn/facee-bank) 仓库，采用 **CC-BY-4.0**，与 App 是两份许可
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

任何仓库，只要符合 [题库规范 v1](docs/题库规范-v1.md) 就能用：

```
catalog.json
questions/<id>/question.md      # 题面
questions/<id>/answer.md        # 参考答案（可选）
questions/<id>/followups.md     # 面试官追问（可选）
questions/<id>/assets/          # 图片（可选）
```

题库的生成器、校验器与恶意包回归在 `packages/bank-spec`。题目勘误与缺题请到
[facee-bank](https://github.com/HBxtzhn/facee-bank/issues) 反馈。
