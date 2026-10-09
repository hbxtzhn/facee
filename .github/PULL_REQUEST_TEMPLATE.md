## 这个 PR 做了什么

<!-- 一段话说清改动；关联 issue 请用 Closes #123 -->

## 改动类型

- [ ] 新功能
- [ ] 问题修复
- [ ] 重构 / 工程改动（无行为变化）
- [ ] 文档

## 自检清单

- [ ] `pnpm typecheck` 通过
- [ ] `pnpm test` 通过（新逻辑有单测；UI 改动至少补冒烟）
- [ ] 只支持 Android；`app.json` 里 versionCode 已按需递增（改了发版相关内容时）
- [ ] 没有新增运行时依赖（确有必要请说明理由）
- [ ] 改了 `plugins/` 里 config plugin 的行为：已本地 `npx expo prebuild -p android` 验证
- [ ] 无敏感信息入库（keystore、口令、`.env`）

## 验证方式

<!-- 你怎么确认它真的工作了：跑了哪些测试 / 真机点了什么 -->
