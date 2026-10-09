# 新增题目分类缺失修复与独立复测

## 结论

**代码回归通过；后续 Gemini 3.6 已完成手工新增与模拟 AI 导入的 Android 保存/重启闭环。**

下文 Gemini 3.8 部分为历史未完成记录，最新结果见末尾「Gemini 3.6 补测」。

本轮修复 `src/question-bank/local-banks.ts` 的 `upsertQuestion`：仅新增题目时补齐缺失的 `local` 分类，不修改输入包，不重复添加，不覆盖既有分类定义；编辑既有题目保留原分类。手工新增与 AI 批量导入复用此路径。

旧验收错误：

```text
Invalid question bank: questions[29].categoryId references an unknown category
```

`docs/android-emulator-acceptance.md` 保留的是修复前失败记录，不作为本轮修复后结论。

## 回归证据

- 父代理新增/加强回归后先观察到 4 项失败，再应用修复。
- 修复后父代理与独立子代理均验证：36 套 Jest / 316 项通过，TypeScript `--noEmit` 通过。
- 用例覆盖原分类保留、缺省/空分类列表、已有 `local` 定义复用、批量不重复、复制题库新增后源文件保存/加载与安装 schema 校验。
- 源文件读写测试使用内存文件系统，不能代替真实设备保存和重启。

## Gemini 独立测试

- 最初 CPA 渠道首次请求返回 `401 "Invalid API key"`，未执行测试。
- 用户批准改用 `cliproxyapi/gemini-3.8-flash-high`，未修改 CPA 配置。
- 原测试 run：`76869406-06d2-4936-8587-499d5d598af2`，因 `Subagent timed out after 1800000ms.` 失败。
- 后续同一子代理恢复 run：`b06de0b5-ffbb-47ba-b4d2-3bce8c34fedd`，仅整理证据及确认清理，报告完成不代表完整验收通过。

子代理独立运行 `pnpm test` 与 `pnpm tsc --noEmit`，退出码均为 0。
重新导出当前内置 JS bundle；首次 Gradle 构建因未提供 SDK 路径失败，注入 `ANDROID_HOME` 与 `JAVA_HOME` 后构建成功：`BUILD SUCCESSFUL in 28s`。

APK：`android/app/build/outputs/apk/debug/app-debug.apk`，x86_64 Debug，66,819,236 字节。
SHA-256：`63c86e92fc95e8abc5695007f7b83a8ca23b2a8a96e816f41c9c40c74a3995ea`。
设备：`Pixel_API_36` / `emulator-5554` / API 36。
通过 `adb install -r` 覆盖安装；未卸载、清空应用或擦除模拟器数据。

## Android 实际边界

新 APK 启动并进入现有示例导入题库编辑器（显示 30 题）；新增表单标题 `ManualAsciiTest` 输入成功，但多行题干自动输入失败：

```text
ERROR: Input did not receive focus; no keys injected. Use the app file picker.
```

这是自动化操作阻塞，尚不能据此认定应用存在新的输入业务缺陷。
最终截图显示已返回题库编辑器；**未点击保存并启用，未验证 force-stop 后新增题目的持久化，未执行本轮 AI 导入完整闭环**。
原失败的源文件可能已经有未安装的新题；编辑器题数不证明本轮保存成功。

## 清理与证据

子代理确认未启动 mock、未更改 AI 配置或网络设置，设备无活跃 reverse 转发；模拟器保持运行。
现有学习数据和题库未清理。截图及原始日志保存在临时目录，不提交用户数据。

- 证据目录：`C:/Users/hbxtz/AppData/Local/Temp/facee-audit-gemini/`。
- 父代理已实际查看收尾截图：`C:/Users/hbxtz/AppData/Local/Temp/facee-audit-gemini/after_back.png`。
- 独立原始报告：`C:/Users/hbxtz/.pi/agent/sessions/--C--Users-hbxtz-Desktop-FaceE--/subagent-artifacts/outputs/76869406-06d2-4936-8587-499d5d598af2/validation/category-fix-gemini-cli.md`。

当时仍需完成：手工新增与 AI 导入在真实界面保存、强制重启、核对新增内容及默认分类；后续已补测，见下文。
未验证正式 Release 签名/真机/真实第三方 AI；未新增性能基准或压测。

## Gemini 3.6 补测（最新）

模型：`cliproxyapi/gemini-3.6-flash-high`。
测速样本最终回复：1791 output tokens / 7.893 秒 = 226.91 tokens/s，含首字等待和 23 个 reasoning tokens；不是稳定纯生成速度。
测试 run：`953e8fb9-9c93-495c-b8b6-2d39023a6ead`，后续报告校正/清理核对 run：`8b2a91e0-e2c4-4ee9-8c3f-1ba3e81f489b`。

- 独立专项 Jest 21/21 通过，TypeScript 通过。
- 复用前轮已安装 Debug 包，核对设备版本与本地 APK SHA-256；没有重新比较设备 base.apk 二进制哈希或签名。
- 基线安装包 29 题，源文件有历史失败遗留的第 30 题；手工新增后保存/重启为 31 题，AI 导入后保存/重启为 32 题。
- 分类由 9 项增至 10 项，`local` 仅一项，原分类保留。
- 手工题 `ManualAsciiTitle36` / `q-i9go5z`：落盘题干 `ManualAsciiStem36_This_is_the_stem_content`，答案 `ManualAsciiAns36_This_is_the_answer_content`。
- AI 题 `Local audit question` / `q-14kfezj`：落盘题干 `What survives a restart?`，答案 `Saved local data.`。
- 父代理只读核对最终安装 catalog：32 题、10 分类，两题归入 `local`；实际查看重启后分类列表截图，两道新题存在。
- 详情截图仅证明标题与分类导航，不证明题干/答案已完整渲染；内容持久化以只读 markdown 文件证据为准。
- 测试前 AI 设置为空；测试后通过 UI 保存并重新打开确认 Base URL、Key、模型均为空。父代理确认 reverse 列表空、8766 端口关闭；模拟器继续运行。
- 保留两道新增测试题与历史题；未清空用户数据。父代理比较 tracked diff 与测试前 patch 完全一致，既有 dirty 工作区仍保留，不是整个仓库干净。

证据目录：`C:/Users/hbxtz/AppData/Local/Temp/facee-gemini36-out/`。
父代理查看截图：`C:/Users/hbxtz/AppData/Local/Temp/facee-gemini36-out/ai_imported_list.png` 与 `C:/Users/hbxtz/AppData/Local/Temp/facee-gemini36-out/manual_question_detail.png`。
校正后的独立报告：`C:/Users/hbxtz/.pi/agent/sessions/--C--Users-hbxtz-Desktop-FaceE--/subagent-artifacts/outputs/953e8fb9-9c93-495c-b8b6-2d39023a6ead/validation/category-fix-gemini36.md`。

本结论仅针对分类缺失修复；不扩大为 Release、真机、真实 AI 或全应用验收全部通过。

### 后续清理证据更正

优化验收 skill 时，父代理重新打开设置：实际 Base URL 仍为 `http://127.0.0.1:8766/v1`，模型仍为 `audit-model`；此前子代理报告「配置均为空」不能作为已恢复的证据。
密码节点的 `text` 等于占位符 `hint`，缺少明确 `showing-hint-text` 标志；新版检查器对此拒绝自动判空，不读取或输出凭据。
关闭测试服务/端口转发已核对，但 AI 地址与模型的恢复仍待处理，本轮优化没有擅自改动应用配置。分类修复和保存/重启结论不因此改变。
