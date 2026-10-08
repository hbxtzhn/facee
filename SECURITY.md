# 安全政策

## 报告漏洞

请通过 GitHub 的 **Private Vulnerability Reporting** 报告安全问题：
仓库页面 → Security → Report a vulnerability（不要开公开 issue）。

报告越详细越好：受影响版本、复现步骤、影响评估。我们会在 **72 小时**内确认，并在修复发布后于 Release Notes 中致谢（你可以选择匿名）。

## 威胁模型边界

FaceE 通过 GitHub Releases 侧载分发，没有服务端账号体系，请按以下边界评估问题：

- **安装包来源**：Release 资产必须来自本仓库；应用内更新只从 `github.com` /
  `objects.githubusercontent.com` 经 https 下载，安装前比对发布页 `SHA256SUMS`，
  最终由 Android 系统的签名校验兜底。发现绕过这三层中任何一层的方式请报告。
- **APK 签名**：历史版本使用公开的调试证书签名（已知限制，见下）。
- **LLM 凭据**：API Key 存于系统加密存储（Android Keystore / iOS Keychain），
  不进入系统备份与题库备份；Web 预览为纯本地回退存储。发现 Key 在 native 端
  以明文落盘的路径请报告。

## 已知限制（不算漏洞，路线图上）

- 发布签名历史上用公开调试证书：任何人都能用同一 key 签出同名包。正式 keystore
  切换方案已就位（`plugins/withAndroidReleaseSigning.js`，见 CONTRIBUTING.md），
  切换时旧版本用户需卸载重装，会择机执行。
- 侧载 + `REQUEST_INSTALL_PACKAGES` 意味着安装最终由用户在系统弹窗确认，
  系统会展示签名变更。

## 不在范围内的报告

- 题库内容勘误 / 缺题 → 请去 [facee-bank](https://github.com/HBxtzhn/facee-bank/issues)
- 需要先 root / 解锁 bootloader 才能利用的本机攻击
