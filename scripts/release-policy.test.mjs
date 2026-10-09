import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertReleaseCertificate, assertTagTarget, RELEASE_CERTIFICATE_SHA256 } from './release-policy.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const plugin = require('../plugins/withAndroidReleaseSigning.js');

test('发布只接受项目证书，拒绝 debug/缺失/多签名证书', () => {
  const valid = `Signer #1 certificate SHA-256 digest: ${RELEASE_CERTIFICATE_SHA256}`;
  assert.doesNotThrow(() => assertReleaseCertificate(valid));
  const modern = `V2 Signer: certificate SHA-256 digest: ${RELEASE_CERTIFICATE_SHA256}\r\n`;
  assert.doesNotThrow(() => assertReleaseCertificate(modern));
  assert.throws(() => assertReleaseCertificate(modern.replace(RELEASE_CERTIFICATE_SHA256, '0'.repeat(64))));
  assert.throws(() => assertReleaseCertificate(modern + modern));
  assert.throws(() => assertReleaseCertificate('untrusted prefix ' + modern));
  assert.throws(() => assertReleaseCertificate('Signer #1 certificate SHA-256 digest: ' + '0'.repeat(64)));
  assert.throws(() => assertReleaseCertificate(''));
  assert.throws(() => assertReleaseCertificate(valid + '\n' + valid.replace('#1', '#2')));
});

test('禁止复用非 HEAD tag', () => {
  assert.doesNotThrow(() => assertTagTarget('abc\n', 'abc'));
  assert.throws(() => assertTagTarget('old', 'new'));
});

test('签名插件注入门禁且幂等', async () => {
  // 使用 Expo 的真实 mod API，但底层 IO 改成内存，不触碰本机原生工程。
  const base = 'android {\n    signingConfigs {\n    }\n    buildTypes {\n        release {\n            // Caution! In production, you need to generate your own keystore file.\n            // see https://reactnative.dev/docs/signed-apk-android.\n            signingConfig signingConfigs.debug\n        }\n    }\n}\n';
  const apply = async (contents) => {
    let config = plugin({ name: 'test', slug: 'test' });
    const action = config.mods.android.appBuildGradle;
    const result = await action({ ...config, modResults: { language: 'groovy', contents }, modRequest: {} });
    return result.modResults.contents;
  };
  const first = await apply(base);
  assert.match(first, /faceeRequireReleaseSigning/);
  assert.match(first, /debug signing is forbidden/);
  assert.equal(await apply(first), first);
  assert.match(await apply(first.slice(0, first.indexOf('// faceeRequireReleaseSigning'))), /faceeRequireReleaseSigning/);
});
