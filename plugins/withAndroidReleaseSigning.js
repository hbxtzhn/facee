const { withAppBuildGradle } = require('@expo/config-plugins');

/**
 * release 签名注入：把 Expo 模板默认的「release 也用 debug key」换成你自己的 keystore。
 *
 * ## 为什么必须做
 * Expo 模板的 release 直接复用 signingConfigs.debug（口令 android/androiddebugkey 全网公开），
 * 任何人生成的同名包 com.facee.app 都能覆盖安装正版，对带 REQUEST_INSTALL_PACKAGES
 * 和应用内更新的 App 风险更大。真正兜底是 Android 安装时的签名比对：换 key 之后，
 * 旧版本用户只能卸载重装（收藏与掌握度会丢），所以建议尽早切、趁用户少。
 *
 * ## 为什么写在 config plugin
 * `android/` 是 prebuild 产物（.gitignore），手改 build.gradle 会在下次
 * `expo prebuild` 时丢失，必须随 app.json 走插件链。
 *
 * ## 怎么用（不配则完全维持模板默认行为，不影响任何人）
 * 1. 生成 keystore（放到 gitignore 覆盖的位置，口令自己记牢，别入库）：
 *      keytool -genkeypair -v -keystore facee-release.jks \
 *        -alias facee -keyalg RSA -keysize 4096 -validity 10000
 * 2. 提供下列四项（gradle 属性优先，其次环境变量）：
 *      FACEE_UPLOAD_STORE_FILE      keystore 路径（建议绝对路径）
 *      FACEE_UPLOAD_STORE_PASSWORD  keystore 口令
 *      FACEE_UPLOAD_KEY_ALIAS       别名（如 facee）
 *      FACEE_UPLOAD_KEY_PASSWORD     Key 口令（缺省用 store 口令）
 *    gradle 属性写法：~/.gradle/gradle.properties 或 android/gradle.properties
 *      FACEE_UPLOAD_STORE_FILE=/absolute/path/facee-release.jks
 *    环境变量写法（本地出包）：
 *      export FACEE_UPLOAD_STORE_FILE=... FACEE_UPLOAD_STORE_PASSWORD=...
 *      FACEE_UPLOAD_KEY_ALIAS=facee FACEE_UPLOAD_KEY_PASSWORD=...
 * 3. 出包：cd android && ./gradlew assembleRelease
 *    四项齐全时自动用自己的签名，否则回退模板默认（debug key），构建不会静默失败。
 */

const withAndroidReleaseSigning = (config) => {
  return withAppBuildGradle(config, (gradleConfig) => {
    if (gradleConfig.modResults.language !== 'groovy') {
      throw new Error('withAndroidReleaseSigning 只支持 groovy 版 build.gradle');
    }
    let contents = gradleConfig.modResults.contents;
    // 幂等：prebuild 重复执行时不重复注入
    if (contents.includes('faceeRelease')) return gradleConfig;

    // signingConfigs 是累积容器：模板里已有 debug，直接追加 faceeRelease
    const signingAnchor = '    signingConfigs {\n';
    if (!contents.includes(signingAnchor)) {
      throw new Error('withAndroidReleaseSigning: 未找到 signingConfigs 区块，Android 模板可能已变更');
    }
    const signingInjection = [
      '        // 由 plugins/withAndroidReleaseSigning.js 注入',
      '        // 四项配置都不提供时这个 config 是空壳，release 仍走模板默认的 debug 签名',
      '        faceeRelease {',
      '            def faceeStorePath = project.findProperty("FACEE_UPLOAD_STORE_FILE") ?: System.getenv("FACEE_UPLOAD_STORE_FILE")',
      '            def faceeStorePassword = project.findProperty("FACEE_UPLOAD_STORE_PASSWORD") ?: System.getenv("FACEE_UPLOAD_STORE_PASSWORD") ?: ""',
      '            def faceeKeyAliasName = project.findProperty("FACEE_UPLOAD_KEY_ALIAS") ?: System.getenv("FACEE_UPLOAD_KEY_ALIAS")',
      '            def faceeKeyPassword = project.findProperty("FACEE_UPLOAD_KEY_PASSWORD") ?: System.getenv("FACEE_UPLOAD_KEY_PASSWORD") ?: faceeStorePassword',
      '            if (faceeStorePath != null) {',
      '                storeFile file(faceeStorePath)',
      '                storePassword faceeStorePassword',
      '                keyAlias faceeKeyAliasName',
      '                keyPassword faceeKeyPassword',
      '            }',
      '        }',
      '',
    ].join('\n');
    contents = contents.replace(signingAnchor, signingAnchor + signingInjection);

    // release 里的签名切换必须放在模板自带的 `signingConfig signingConfigs.debug`
    // 之后：Gradle 的 signingConfig 后赋值覆盖先赋值，放前面会被模板行覆盖回 debug。
    // 用 Caution 注释块做唯一定位，模板将来改了这个锚点会直接报错而不是静默失效。
    const debugSigningAnchor = [
      '            // Caution! In production, you need to generate your own keystore file.',
      '            // see https://reactnative.dev/docs/signed-apk-android.',
      '            signingConfig signingConfigs.debug',
      '',
    ].join('\n');
    if (!contents.includes(debugSigningAnchor)) {
      throw new Error('withAndroidReleaseSigning: 未找到 release 的 debug 签名行，Android 模板可能已变更');
    }
    const releaseInjection = [
      debugSigningAnchor,
      '            // 由 plugins/withAndroidReleaseSigning.js 注入；配了 keystore 则覆盖上面的 debug 签名',
      '            if (project.hasProperty("FACEE_UPLOAD_STORE_FILE") || System.getenv("FACEE_UPLOAD_STORE_FILE") != null) {',
      '                signingConfig signingConfigs.faceeRelease',
      '            }',
      '',
    ].join('\n');
    contents = contents.replace(debugSigningAnchor, releaseInjection);

    gradleConfig.modResults.contents = contents;
    return gradleConfig;
  });
};

module.exports = withAndroidReleaseSigning;
