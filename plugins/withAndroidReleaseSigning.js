const { withAppBuildGradle } = require('@expo/config-plugins');

/** Debug 开发不需要凭据；任何 release 构建必须显式配置自持 keystore。 */
const withAndroidReleaseSigning = (config) => withAppBuildGradle(config, (gradleConfig) => {
  if (gradleConfig.modResults.language !== 'groovy') {
    throw new Error('withAndroidReleaseSigning 只支持 groovy 版 build.gradle');
  }
  let contents = gradleConfig.modResults.contents;
  if (contents.includes('// faceeRequireReleaseSigning')) return gradleConfig;

  // 兼容已注入旧插件的工程；旧配置的签名切换仍可用，只补强制门禁。
  if (!contents.includes('faceeRelease')) {
    const signingAnchor = '    signingConfigs {\n';
    if (!contents.includes(signingAnchor)) {
      throw new Error('withAndroidReleaseSigning: 未找到 signingConfigs 区块，Android 模板可能已变更');
    }
    contents = contents.replace(signingAnchor, signingAnchor + [
      '        // 由 plugins/withAndroidReleaseSigning.js 注入',
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
    ].join('\n'));
    const anchor = [
      '            // Caution! In production, you need to generate your own keystore file.',
      '            // see https://reactnative.dev/docs/signed-apk-android.',
      '            signingConfig signingConfigs.debug',
      '',
    ].join('\n');
    if (!contents.includes(anchor)) {
      throw new Error('withAndroidReleaseSigning: 未找到 release 的 debug 签名行，Android 模板可能已变更');
    }
    contents = contents.replace(anchor, anchor + [
      '            if (project.hasProperty("FACEE_UPLOAD_STORE_FILE") || System.getenv("FACEE_UPLOAD_STORE_FILE") != null) {',
      '                signingConfig signingConfigs.faceeRelease',
      '            }',
      '',
    ].join('\n'));
  }

  contents += [
    '',
    '// faceeRequireReleaseSigning — release 不得回退到公开 debug 证书',
    'gradle.taskGraph.whenReady { graph ->',
    '    if (graph.allTasks.any { it.project == project && it.name.toLowerCase().contains("release") }) {',
    '        def signing = android.signingConfigs.faceeRelease',
    '        if (signing.storeFile == null || !signing.storeFile.exists() || !signing.storePassword || !signing.keyAlias || !signing.keyPassword) {',
    '            throw new GradleException("FaceE release requires FACEE_UPLOAD_STORE_FILE / STORE_PASSWORD / KEY_ALIAS / KEY_PASSWORD; debug signing is forbidden")',
    '        }',
    '    }',
    '}',
    '',
  ].join('\n');
  gradleConfig.modResults.contents = contents;
  return gradleConfig;
});

module.exports = withAndroidReleaseSigning;
