# FaceE

**面向 GitHub 题库的刷题助手。** 题库放在 Git 仓库里，App 拉下来之后完全离线刷题。

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

- **装题库**：从仓库归档 ZIP 下载 → 校验 → 原子安装，装坏了不会弄丢旧题库
- **找题**：分类 / 标签（父标签自动含子孙）/ 难度筛选，标题 + 正文全文搜索
- **看题**：完整 Markdown（表格、代码块、图片可点击放大）、参考答案折叠、面试官追问折叠
- **刷题**：连续刷题只在你当前的筛选结果里切换；左右滑屏切题，悬浮进度按钮可点按展开答案、长按拖动
- **手势**：详情页与列表页都支持左缘右滑返回，看图下滑关闭
- **记录**：收藏、继续上次、刷题总数
- **更新**：题库与应用都能在 App 内更新

## 题库格式

任何仓库，只要符合 [题库规范 v1](docs/题库规范-v1.md) 就能用：

```
catalog.json
questions/<id>/question.md      # 题面
questions/<id>/answer.md        # 参考答案（可选）
questions/<id>/followups.md     # 面试官追问（可选）
questions/<id>/assets/          # 图片（可选）
```

## 隐私

题库、收藏、进度、设置全部只存本机；没有账号、没有统计、没有广告。
联网只有两件事：下载题库、检查更新。

## 开发

需要 Node 22、pnpm 与 Android SDK（目前仅支持 Android）：

```
pnpm install && pnpm test       # 33 suites / 263 tests
npx expo run:android
```

题库的生成器、校验器与恶意包回归在 `packages/bank-spec`。

## 许可

[MIT](LICENSE) © HBxtzhn。项目基于 Expo 模板起步（Expo SDK 采用 MIT 许可）。
