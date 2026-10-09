# 参与贡献 FaceE

感谢愿意给 FaceE 出力。这份文档覆盖：环境准备 → 日常开发 → 测试规范 → 发布流程 → 题库贡献。

## 这个项目是什么

面向 GitHub 题库的离线刷题助手（Expo SDK 57 / React Native 0.86 / pnpm）。
**只支持 Android**（侧载分发，未上架）；`app.json` 里的 iOS 配置只是模板残留，
不做 iOS 支持承诺，没有 iOS 真机验证。Web 端仅作功能预览，不是交付目标。

## 环境准备

| 依赖 | 版本 | 说明 |
| --- | --- | --- |
| Node | 22.13+ | 建议用 fnm / nvm 管理 |
| pnpm | 11（packageManager 固定补丁） | 本项目不用 npm / yarn 装依赖 |
| JDK | 17 | Android Gradle Plugin 需要 |
| Android SDK | platform 36 / build-tools 36 | 配好 `ANDROID_HOME` |

```bash
git clone https://github.com/HBxtzhn/facee.git && cd facee
pnpm install
```

> 注意：`pnpm-workspace.yaml` 里固定了 `nodeLinker: hoisted`（pnpm 11 已不从旧
> `.npmrc` 读取这类非 registry 项目配置）。这是 Windows 上的硬性要求——
> pnpm 默认的隔离布局会让 CMake 原生构建路径超过 Windows 260 字符上限而失败
> （ninja 报 "Filename longer than 260 characters"）。别改回去。

```bash
pnpm typecheck        # tsc --noEmit，strict + noUnusedLocals
pnpm test             # jest（jest-expo + @testing-library/react-native）
pnpm start            # Metro；npx expo start --web 开 Web 预览
```

## 原生工程（android/）

`android/` 与 `ios/` 都是 prebuild 产物，**不入库**；所有原生侧改动必须写成
config plugin 放进 `plugins/`，并在 `app.json` 的 `plugins` 里登记，否则贡献者
prebuild 之后配置就丢了。现有插件：

- `withAndroidArm64Release.js`：release 只打 arm64-v8a
- `withAndroidReleaseSigning.js`：release 签名注入（见下）

改了插件之后本地验证：`npx expo prebuild -p android` 然后看
`android/app/build.gradle` 是否如预期变化。

## 发布签名（维护者）

Expo 模板默认 release 用公开的调试证书（口令全网公开），意味着任何人都能签出同名
`com.facee.app` 覆盖安装。`plugins/withAndroidReleaseSigning.js` 负责把 release 切到
你自己的 keystore：**不配置时 release 构建直接失败**，debug 开发不受影响。发布脚本还会核对项目证书 SHA256 指纹，阻止误发 debug 或其他证书包。

> 现状：维护者本机已切换为自持 keystore（凭据在 `~/.gradle/gradle.properties`，
> keystore 文件在仓库外）。**丢失该 keystore 将永远无法给已装用户发更新**，务必备份。

```bash
# 1. 生成 keystore（*.jks 与口令都别入库，.gitignore 已覆盖 *.jks）
keytool -genkeypair -v -keystore facee-release.jks \
  -alias facee -keyalg RSA -keysize 4096 -validity 10000

# 2. 提供四项配置（gradle 属性优先，其次环境变量）
#    FACEE_UPLOAD_STORE_FILE      keystore 路径（建议绝对路径）
#    FACEE_UPLOAD_STORE_PASSWORD  keystore 口令
#    FACEE_UPLOAD_KEY_ALIAS       别名
#    FACEE_UPLOAD_KEY_PASSWORD     Key 口令（缺省用 store 口令）

# 3. 出包
cd android && ./gradlew assembleRelease
```

**注意**：切换 keystore 后，已装旧版本的用户无法覆盖更新，只能卸载重装
（会丢收藏与掌握度），所以要挑时机、并在 Release Notes 里提前说明。

## 测试约定

- 纯逻辑（`src/lib/`、`src/question-bank/` 的纯函数）必须有单测；
  UI 改动至少补「渲染 + 关键交互」的冒烟（参考 `src/screens/**/*.spec.tsx`）
- 遵循 RTL v14 的异步约定：`render` 后 `await act(async () => {})` 再断言；
  触发 onChangeText / press 后用 `await act(async () => { … })` 包裹
- `jest.mock` 的工厂函数里**不能引用外部作用域变量**（包括构造器参数属性），
  需要共享状态时用 `__xxx` 前缀导出
- 不写具体测试数到 README（用 CI 徽章）

## 提交规范

- Conventional Commits（`feat:` / `fix:` / `refactor:` / `docs:` / `chore:`），
  scope 用模块名，如 `feat(review): …`
- 一个提交只做一件事；提交信息写「为什么」，代码注释写「约束是什么」
- 提交前跑全量 `pnpm typecheck && pnpm test && pnpm test:release`

## 发版流程（维护者）

```bash
# 1. 按改动量升 app.json 的 version / versionCode（versionCode 必须递增，
#    Android 靠它判断能否覆盖安装；versionName 不参与判定）
# 2. 在 CHANGELOG.md 补对应版本小节（发布说明从这里自动取）
# 3. 提交、合并到 main
npx expo prebuild -p android --no-install # 先同步配置与插件（脚本不会自动 prebuild）
node scripts/release.mjs            # assembleRelease → 包信息与签名核对 →
                                    # 生成 SHA256SUMS → 打 tag → 建 GitHub Release
node scripts/release.mjs --skip-build   # APK 已构建时复用
git push origin main --tags
```

发布前必须设置 `ANDROID_HOME`（或 `ANDROID_SDK_ROOT`），不能跳过包信息或签名校验。
已有 tag 必须指向当前 HEAD；请先推送 main，避免 GitHub 无法找到待发布提交。
证书指纹固定在 `scripts/release-policy.mjs`，不是秘密，禁止为绕过检查随意修改。
发布还会检查许可清单与依赖一致，并附带 `THIRD_PARTY_LICENSES.txt`。

依赖变更后运行 `pnpm notices` 更新许可文件；依赖安全例外与 Expo 补丁阻塞见
[依赖安全记录](docs/dependency-security.md)。本项目不增加性能基准；CI 的安全/功能回归不是压测。

`SHA256SUMS` 是硬要求：App 的应用内更新会下载并校验它，哈希不匹配即中止安装。

## 题库内容贡献

App 只是阅读器，题目在独立的 [facee-bank](https://github.com/HBxtzhn/facee-bank)
仓库（CC-BY-4.0，与 App 的 MIT 分开）。格式见
[题库规范 v1](docs/题库规范-v1.md)；题目勘误 / 缺题请去 facee-bank 提 issue。
规范本身的改动建议在本仓库开 issue 讨论。

## 行为准则

见 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)（Contributor Covenant v2.1）。
