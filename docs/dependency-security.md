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
| GHSA-vfj7-8cjw-p6xm | braces 3.0.3 | >=3.0.4 | Metro/micromatch 构建文件匹配；不要接受不可信 glob 配置 |
| GHSA-hp3w-g68c-fv3c | sprintf-js 1.0.3 | >=1.1.4 | js-yaml/argparse 测试与构建链；不要执行外部传入的格式字符串 |

CI 通过 `scripts/audit-dependencies.mjs` 仅放行这三个精确公告 ID + 对应包名，新增中危及以上公告仍会失败。
不使用 `pnpm audit --ignore`，防止 pnpm 11 将例外写回工作区并影响普通审计。
`pnpm audit:deps` 不忽略任何公告，便于维护者查看真实结果。
这不是安全审计结论，若发现公告可通过用户题库/文本进入 App 运行路径，应立即取消对应例外。

**移除条件：** 每次依赖升级和每次发布前检查 registry；补丁一旦可安装就升级、执行
完整测试/原生构建、更新许可清单，并移除对应脚本例外。下一次发布必须重新确认，
禁止将这些例外当成长期豁免。

## Expo 补丁升级（发布缺口已解决）

最新复核确认稳定的 `@expo/image-utils@0.11.6` 已发布。已升级 Expo **57.0.27**、
CLI **57.0.28**、prebuild-config **57.0.17**、DocumentPicker **57.0.3**、Constants **57.0.21**。
移除 CLI/prebuild 临时版本覆盖，并将 CI 的 `expo install --check` 恢复为硬门禁（移除 `continue-on-error`）。
没有使用 canary/next 绕过稳定 SDK 契约。

Windows 原 pnpm metadata 缓存仍返回旧的 image-utils 版本；用独立临时 metadata cache 重新解析后安装成功。
该缓存路径不写入项目配置或锁文件。`pnpm install --frozen-lockfile`、兼容性检查、316 项测试、
TypeScript、发布策略与重新生成的许可清单均通过本地验证。

安全公告仍为 **2 high / 1 moderate**；复核 registry 最新稳定版本为 node-forge **1.4.0**、
braces **3.0.3**、sprintf-js **1.1.3**，仍低于公告补丁要求。三个精确例外保留并继续作为未解决风险记录，
不将 Expo 补丁升级描述为「所有漏洞清零」。

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
