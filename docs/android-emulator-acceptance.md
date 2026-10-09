# Android 模拟器验收记录

日期：2026-10-08（主机时间；模拟器时钟仍为 2026-09-29）。

**当前结论：未全通过，发现 1 个阻塞缺陷。**

## 环境与边界

- 用户已有 AVD `Pixel_API_36`，Android API 36，x86_64，1280×2856。
- 安装包：`com.facee.app`，0.1.0 / versionCode 8，Debug 签名。
- 原模拟器安装为 1.2.1 / versionCode 4 的 Debug 包，通过 `adb install -r` 覆盖安装，未卸载或清空数据。
- 之前的 arm64-only APK 在该模拟器上安装成功但因缺少 x86_64 `libreactnative.so` 启动失败；重编译 x86_64 后解决。
- 主机 Metro 连接遇到 `connect EACCES ::1:8081`，因此把当前 JS bundle 内置到生成的 Android 工程，构建离线可启动 Debug 包。没有把这一步当作正式 Release 验证。
- 操作通过 ADB + Android UIAutomator 页面结构与截图，非浏览器预览。
- 题库与 AI 使用本机测试服务。AI Key 是无效的虚拟字符串，不调用真实第三方账户，不验证真实模型的抽取质量。

## 已通过的功能

| 流程 | 实测结果 |
| --- | --- |
| 覆盖安装 | 保留既有题库和累计刷题数据，首页正常启动 |
| 题库安装 | 经界面填写 ZIP URL，下载校验后启用 29 题 / 9 类示例库 |
| 分类 / 难度 | JVM 类显示 4 题，困难筛选仅保留 1 题，取消筛选恢复 4 题 |
| Markdown 图片 | 本地 PNG 正常渲染，点击可全屏，系统返回可退出全屏 |
| 收藏 / 错题 | 收藏后可在收藏夹找到；标记「不会」后进入错题本 |
| 离线与重启 | 开飞行模式、关闭 WiFi、移除题库/Metro端口转发后强制重启；题库、上次练习、收藏仍可读取，本地图片可加载 |
| 备份导出 | 生成 ZIP 并拉起系统分享面板；校验实际导出文件 |
| 同名备份恢复 | 用系统文件选择器导入测试题库备份，作为新题库添加且显示成功提示 |
| 恢复图片隔离 | 源 ID 和目标 ID 不同；新库 PNG 与导出前 SHA-256 一致，原库 PNG 和已有注册表映射未改变；新库界面图片也正常显示 |
| AI 模型列表 | 模拟 `/models` 返回 1 个模型，可展示并选择 |
| AI 响应体超时 | 服务立即发送响应头后不发送正文；约 30 秒提示「网络请求超时，请检查网络后重试」，服务侧同时观察到客户端断开 |
| AI 取消 | 抽取中取消后回到输入界面且清空内容；约 5.3 秒时服务观察到客户端断开，没有取消后的重试 |
| AI 错误提示 | 模拟 HTTP 401，两次请求后显示块序号与 HTTP 状态，界面可继续重试 |
| AI 文件抽取 / 筛选 | 系统选择 `.txt` 后生成 1 个草稿，可取消/恢复勾选并交给编辑器 |
| AI 配置恢复 | 测试前无真实 Key；虚拟 Key 已通过界面删除，原连接配置行恢复，其他学习数据没有回滚 |

恢复图片 SHA-256：
`4a339688fe4073d5980ae5db66cc92086d1353342122dcf14895a69344946695`

## 阻塞缺陷：复制 / 恢复的题库新增题目无法保存

复现：

1. 安装示例题库，把它作为本地题库备份并恢复为新库。
2. 在新库编辑器中从文本导入一个 AI 草稿，编辑器显示 30 题。
3. 点击「保存并启用」。

实际错误：

```text
Invalid question bank: questions[29].categoryId references an unknown category
```

强制重启后仍是原有 29 题，新增题没有持久化。没有宣称 AI 导入完整链路通过。

根因：`src/question-bank/local-banks.ts:164` 为新题固定设置 `categoryId: 'local'`，
但返回的 `catalog.categories` 没有补入该分类。线上复制/备份恢复保留原分类列表，通常不含 `local`。
`src/screens/profile/BankEditorModal.tsx:81` 的 AI 草稿导入和手动新增均复用该模型函数，后者也受同一机制影响（尚未单独进行完整 UI 复测）。
`src/question-bank/local-banks.spec.ts:156` 的现有用例只断言新题分类 ID，未校验生成包满足 schema。

建议修复：仅在新增题需要时补入默认分类，保留原分类与原题归属，避免重复加入；增加 schema 合法性回归，再跑模拟器保存/重启验证。

## 证据

- [题目与图片](acceptance-evidence/question-image.png)
- [备份冲突导入成功](acceptance-evidence/backup-conflict-success.png)
- [恢复的新题库图片](acceptance-evidence/restored-image.png)
- [AI 模型列表响应体超时](acceptance-evidence/ai-models-timeout.png)
- [取消后返回输入界面](acceptance-evidence/ai-cancel-success.png)
- [AI 导入后保存失败](acceptance-evidence/ai-save-failed.png)

## 尚未覆盖

- 正式签名 APK 的系统安装、覆盖更新与 Release 专属行为。
- 真机、其他 API/ABI、通知/权限全部组合、磁盘不足及进程中断恢复。
- 真实第三方模型调用、流量消耗和抽取质量。
- 完整无障碍检查；截图中的浅色系统状态栏图标在浅色背景上对比不足，建议另行调整。

用户既有题库未删除；本轮留下两个用于验收的示例本地题库（原下载库与备份恢复库）。
原网络与 AI 配置已恢复；仅本次启动的 Metro、题库文件服务、AI 模拟服务和测试端口转发已清理，模拟器保留运行。
用户选择仅保留验收报告，阻塞缺陷未在本轮修复。
没有新增性能基准或压测，没有提交代码或发布 Release。
