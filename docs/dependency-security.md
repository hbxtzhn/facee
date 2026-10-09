# 依赖安全与兼容性记录

## 已完成的修复

`pnpm-workspace.yaml` 对以下传递依赖进行覆盖，并由锁文件记录实际版本：

- markdown-display 的旧 markdown-it → 14.3.2（修复其旧解析器与 linkify-it 的资源耗尽公告）
- xcode 的 uuid → 11.1.1（仅限该父依赖；需通过原生配置生成验证 API 兼容性）
- source-map-js → 1.2.2
- shell-quote → 1.11.0 以上

`pnpm audit --prod` 的结果从 11 条（critical 1 / high 5 / moderate 5）下降至
3 条（high 2 / moderate 1）。依赖图里的 production 标记不等于 APK 实际打包路径；
Expo CLI、Metro 与测试转换器也在该图中。

## 临时安全例外（不是修复、不是认定无风险）

整改检查时 npm registry 尚未提供以下公告要求的补丁版本：

| 公告 | 当前版本 | 要求补丁 | 主要路径 / 暂时处理 |
| --- | --- | --- | --- |
| GHSA-86w9-cpqp-85rv | node-forge 1.4.0 | >=1.4.1 | Expo CLI 证书工具；应用安装包用 Android apksigner/系统签名校验，不使用此库。不要用 CLI 处理不可信证书 |

CI 通过 `scripts/audit-dependencies.mjs` 仅对 node-forge 保留未修复例外。braces 与 sprintf-js 按下文已安装本地补丁核验，新增中危及以上公告仍会失败。
不使用 `pnpm audit --ignore`，防止 pnpm 11 将例外写回工作区并影响普通审计。
`pnpm audit:deps` 不忽略任何公告，便于维护者查看真实结果。
这不是安全审计结论，若发现公告可通过用户题库/文本进入 App 运行路径，应立即取消对应例外。

**移除条件：** 每次依赖升级和每次发布前检查 registry；补丁一旦可安装就升级、执行
完整测试/原生构建、更新许可清单，并移除对应脚本例外。下一次发布必须重新确认，
禁止将这些例外当成长期豁免。

## braces / sprintf-js 本地安全补丁

用户本轮只要求处理以下两项；node-forge 未改动。
GitHub 公告的 `first_patched_version` 均为 null，registry 尚无稳定的 braces 3.0.4 / sprintf-js 1.1.4。
没有伪造版本号或关闭审计，使用 pnpm 的 `patchedDependencies` 固定本地补丁，干净安装自动应用。

- **GHSA-vfj7-8cjw-p6xm / CVE-2026-93687**：`patches/braces@3.0.3.patch`。
  解析器同时限制花括号、圆括号的结构深度为 **128**，所有递归 AST walker 也有边界（含公开的 AST 输入接口）。
  越界是可预测的 `SyntaxError`，不再递归到 `Maximum call stack size exceeded`。
  字面量、引号、转义不误算为结构；正常展开与编译保持兼容。
  调用方仍需捕获不可信模式的校验异常；此补丁不承诺任意格式错误都不会终止未捕获异常的调用方。
  依据：[上游 issue #70](https://github.com/micromatch/braces/issues/70) 推荐的深度限制，项目采用固定边界而非允许选项绕过。
- **GHSA-hp3w-g68c-fv3c / CVE-2026-97058**：`patches/sprintf-js@1.0.3.patch`。
  数值 `%f` / `%e` / `%g` 精度上限 **100**，`%g` 下限 **1**。超过范围的精度会截到边界，
  避免把 `RangeError` 换成另一个未捕获错误；这是项目明确选择的非法格式兼容策略，不冒称官方修复。
  有效精度、默认精度、命名/位置参数保持行为；源入口与 minified 入口均修补。
  宽度、缓存增长等其他行为不属于本次修复的精度公告范围。
  依据：[上游 issue #237](https://github.com/alexei/sprintf.js/issues/237) 的浮点精度根因与复现。

回归：`node --test scripts/dependency-security.test.mjs`，覆盖越界、边界、直接 AST、转义/引号、正常展开及两个 sprintf 入口。
补丁清单 `patches/security-backports.json` 记录补丁和已安装关键文件的 SHA-256（统一 LF）；
`scripts/verify-dependency-patches.mjs` 检查注册、准确版本、关键文件哈希及安全回归，未应用或被修改即阻断 CI。

**报告边界：** 普通 `pnpm audit` 和 Dependabot 按上游版本判断，仍可能报告这两项；项目门禁明确标为
`LOCAL BACKPORT VERIFIED`，不是未修复例外，也不是官方公告已经关闭。官方稳定补丁发布后应迁移、复测并删除本地补丁。

## Expo 补丁升级（发布缺口已解决）

最新复核确认稳定的 `@expo/image-utils@0.11.6` 已发布。已升级 Expo **57.0.27**、
CLI **57.0.28**、prebuild-config **57.0.17**、DocumentPicker **57.0.3**、Constants **57.0.21**。
移除 CLI/prebuild 临时版本覆盖，并将 CI 的 `expo install --check` 恢复为硬门禁（移除 `continue-on-error`）。
没有使用 canary/next 绕过稳定 SDK 契约。

Windows 原 pnpm metadata 缓存仍返回旧的 image-utils 版本；用独立临时 metadata cache 重新解析后安装成功。
该缓存路径不写入项目配置或锁文件。`pnpm install --frozen-lockfile`、兼容性检查、316 项测试、
TypeScript、发布策略与重新生成的许可清单均通过本地验证。

原始版本审计仍可能显示 **2 high / 1 moderate**；复核 registry 最新稳定版本为 node-forge **1.4.0**、
braces **3.0.3**、sprintf-js **1.1.3**。braces 与项目实际使用的 sprintf-js **1.0.3** 已按上文回补；
node-forge 是仍未修复的剩余高危例外。不将本地回补描述为「官方漏洞清零」。

安装时还存在测试工具 `react-reconciler@0.34.0` 要求 React `^19.3.0` 的 peer 警告，
SDK 57 固定 React 19.2.3；目前测试通过，不能为消除警告擅自将 SDK 的 React 升为 19.3。

## 复核命令

```bash
pnpm install --frozen-lockfile
pnpm audit:deps
pnpm check:expo
pnpm typecheck
pnpm test --runInBand
pnpm test:release
pnpm notices
npx expo prebuild -p android --no-install
```

以上都是构建、安全与功能验证，不新增性能基准或压力测试。
