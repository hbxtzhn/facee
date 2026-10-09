# FaceE 文档

## 对外

- [题库规范 v1](题库规范-v1.md) —— 想给 FaceE 做题库的仓库需要遵守的格式。
  题目勘误 / 缺题请到 [facee-bank](https://github.com/HBxtzhn/facee-bank/issues) 反馈。

- [Android 模拟器验收](android-emulator-acceptance.md) —— 原始原生操作、离线/备份/AI验证与历史阻塞缺陷。
- [新增分类修复复测](category-fix-verification.md) —— 保存/重启闭环与清理证据边界。
- [验收整改记录](acceptance-remediation.md) —— 本轮修改、验证证据与尚未关闭事项。
- [依赖安全记录](dependency-security.md) —— 最新补丁升级、临时例外与历史发布缺口。
- [第三方许可文本](third-party-licenses.txt) —— 从锁定依赖生成，随 Release 分发。

## internal/（过程文档，非承诺）

这些是开发过程中的设计与调研记录，反映当时的决策背景，**不保证与最新代码一致**，
读到时请以代码与 [CHANGELOG.md](../CHANGELOG.md) 为准：

| 文档 | 内容 |
| --- | --- |
| [FaceE-实现方案.md](internal/FaceE-实现方案.md) | 早期总体设计与实现记录 |
| [题库内容来源调研.md](internal/题库内容来源调研.md) | 题库来源调研（答案原创性约束） |
| [icon-redesign-plan.md](internal/icon-redesign-plan.md) | 图标重设计图纸与实现说明 |
