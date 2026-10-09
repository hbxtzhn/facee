# 第三方声明

FaceE 自身代码采用 [MIT](LICENSE) 许可，但包含或依赖下列第三方组件，其许可条款
独立适用。

## 字体

**JetBrains Mono**（`assets/fonts/JetBrainsMono-Regular.ttf`）
Copyright 2020 The JetBrains Mono Project Authors
许可：SIL Open Font License 1.1（完整文本见 [assets/fonts/OFL.txt](assets/fonts/OFL.txt)）
用途：题目正文中的行内代码与代码块等宽字体。
根据 OFL-1.1 第 1 条，字体随分发一同提供且不得单独销售；本文件满足 Reserved Font
Name 之外的声明义务。

## 运行时依赖

以下 npm 依赖随应用分发（Expo SDK 57 生态完整清单见 `pnpm-lock.yaml`）：

| 组件 | 许可 |
| --- | --- |
| Expo / React Native / React | MIT |
| React Navigation（native / native-stack / bottom-tabs） | MIT |
| react-native-markdown-display / markdown-it | MIT / MIT |
| lucide-react-native | ISC |
| react-native-svg | MIT |
| zustand | MIT |
| @react-native-async-storage/async-storage | MIT |
| expo-sharing / expo-file-system / expo-secure-store / expo-splash-screen / expo-document-picker / expo-intent-launcher / expo-constants / expo-font | MIT |
| react-native-zip-archive | MIT |
| react-native-safe-area-context / react-native-screens | MIT |

完整收集文本见 [docs/third-party-licenses.txt](docs/third-party-licenses.txt)，使用 `pnpm notices`
从锁定的生产依赖生成，包含构建工具依赖（并不表示所有列出包都会进入 APK）。
发布流程将其作为 `THIRD_PARTY_LICENSES.txt` 一同分发。部分上游包未提供独立许可文件，
生成结果会明确标记；本清单不替代上游许可或 Android 原生传递依赖的独立法律核查。
上游许可如有变更，以各组件仓库中的许可文件为准。

## 关联项目

**[facee-bank](https://github.com/HBxtzhn/facee-bank)**（题库内容）为独立仓库，
采用 **CC-BY-4.0**（署名 4.0 国际），与 App 的 MIT 是两份许可，使用时请分别遵守。
