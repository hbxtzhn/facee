#!/usr/bin/env node
/**
 * FaceE 一键发版：构建 → 核对包信息 → 生成 SHA256SUMS → 打 tag → 建 GitHub Release。
 *
 * 用法（在仓库根目录，发版前先提交代码）：
 *   node scripts/release.mjs                    # 完整流程（gradle 构建 + 发布）
 *   node scripts/release.mjs --skip-build       # 复用已构建的 APK
 *   node scripts/release.mjs --notes-file x.md  # 用自己的发布说明（默认取 CHANGELOG 对应段）
 *
 * 前置条件：
 *   - Node 22+、本地 Android SDK（local.properties 就绪）、gh 已登录（gh auth status）
 *   - 自定义签名：配置 FACEE_UPLOAD_STORE_FILE / FACEE_UPLOAD_STORE_PASSWORD /
 *     FACEE_UPLOAD_KEY_ALIAS / FACEE_UPLOAD_KEY_PASSWORD，见 plugins/withAndroidReleaseSigning.js；
 *     不配置则用 Expo 模板默认的调试证书（仅适合自用分发）
 *
 * 为什么强制 SHA256SUMS：App 的应用内更新会下载并校验这个文件，哈希不匹配即中止安装。
 */

import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE_DIR = join(ROOT, 'release');
const APK_OUTPUT = 'android/app/build/outputs/apk/release/app-release.apk';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const optionValue = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};

const skipBuild = flag('--skip-build');
const notesFile = optionValue('--notes-file');

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

// 默认不走 shell：Windows 下 shell:true 会把参数按空格拼串再交给 cmd，
// 任何带空格的参数（tag 消息、release 标题）都会被拆碎。
// 只有 .bat（gradlew.bat）这类必须经 cmd 执行的目标才显式传 shell: true。
function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: ROOT,
    stdio: 'inherit',
    ...options,
  });
  if (result.error) fail(`命令无法执行：${command}（${result.error.message}）`);
  if (result.status !== 0) fail(`命令失败：${command} ${commandArgs.join(' ')}`);
}

function readAppInfo() {
  const appConfig = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8')).expo;
  const gradle = readFileSync(join(ROOT, 'android/app/build.gradle'), 'utf8');
  const versionCode = /versionCode\s+(\d+)/.exec(gradle)?.[1];
  const versionName = /versionName\s+"([^"]+)"/.exec(gradle)?.[1];
  if (!versionCode || !versionName) fail('读不到 android/app/build.gradle 里的 versionCode/versionName');
  if (versionCode !== String(appConfig.android.versionCode)) {
    fail(`versionCode 不一致：app.json=${appConfig.android.versionCode}，build.gradle=${versionCode}（先跑 npx expo prebuild）`);
  }
  if (versionName !== appConfig.version) {
    fail(`versionName 不一致：app.json=${appConfig.version}，build.gradle=${versionName}（先跑 npx expo prebuild）`);
  }
  return { version: appConfig.version, versionCode, packageName: appConfig.android.package };
}

function extractChangelog(version) {
  const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
  // 注意（?![\s\S]) 表示「后面一个字符都没有」，不能用 $：m 标志下 $ 在每行末都成立，
  // 懒惰匹配会立刻停在标题行尾、抽出空内容。遇到任何「## 」二级标题即截断：
  // CHANGELOG 里 1.x 历史线是 ## 开头的大节，不能混进新版发布说明。
  const pattern = new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\][^\\n]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm');
  const body = pattern.exec(changelog)?.[1]?.trim();
  if (!body) fail(`CHANGELOG.md 里找不到 ${version} 的小节，请补充或用 --notes-file 指定`);
  return body;
}

function badgingCheck(apkPath, expected) {
  const sdkDir = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (!sdkDir) {
    console.log('· 未设置 ANDROID_HOME，跳过 aapt 核对');
    return;
  }
  const buildTools = join(sdkDir, 'build-tools');
  if (!existsSync(buildTools)) {
    console.log('· 未找到 build-tools，跳过 aapt 核对');
    return;
  }
  const versions = readdirSync(buildTools, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();
  const binary = process.platform === 'win32' ? 'aapt2.exe' : 'aapt2';
  const aapt = versions
    .map((version) => join(buildTools, version, binary))
    .find((candidate) => existsSync(candidate));
  if (!aapt) {
    console.log('· 未找到 aapt2，跳过包信息核对');
    return;
  }
  const output = execFileSync(aapt, ['dump', 'badging', apkPath], { encoding: 'utf8' });
  const packageMatch = /package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/.exec(output);
  if (!packageMatch) fail('aapt2 输出里解析不到包信息');
  const [, name, code, name2] = packageMatch;
  if (name !== expected.packageName) fail(`包名不符：${name} ≠ ${expected.packageName}`);
  if (code !== String(expected.versionCode)) fail(`versionCode 不符：${code} ≠ ${expected.versionCode}`);
  if (name2 !== expected.version) fail(`versionName 不符：${name2} ≠ ${expected.version}`);
  console.log(`· aapt2 核对通过：${name} ${name2}（versionCode ${code}）`);
}

function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function main() {
  if (!existsSync(join(ROOT, 'android'))) {
    fail('android/ 不存在，先执行 npx expo prebuild -p android');
  }
  if (!existsSync(join(ROOT, '.git'))) fail('请在 git 仓库根目录运行');

  const info = readAppInfo();
  const tag = `v${info.version}`;
  console.log(`\n● 发版 ${tag}（versionCode ${info.versionCode}）\n`);

  const status = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
  if (status.trim()) {
    fail(`工作区有未提交改动，先提交再发版：\n${status}`);
  }

  if (!skipBuild) {
    console.log('· 构建 release APK（arm64）');
    // Windows 的 cmd 不认 ./gradlew 这种 Git Bash 写法，用 gradlew.bat 并经 cmd 执行
    const isWin = process.platform === 'win32';
    const gradlew = isWin ? 'gradlew.bat' : './gradlew';
    run(gradlew, ['assembleRelease'], { cwd: join(ROOT, 'android'), shell: isWin });
  }

  const builtApk = join(ROOT, APK_OUTPUT);
  if (!existsSync(builtApk)) fail(`找不到构建产物：${APK_OUTPUT}`);
  badgingCheck(builtApk, info);

  rmSync(RELEASE_DIR, { recursive: true, force: true });
  mkdirSync(RELEASE_DIR, { recursive: true });
  const apkName = `FaceE-arm64-${info.version}-release.apk`;
  const stagedApk = join(RELEASE_DIR, apkName);
  copyFileSync(builtApk, stagedApk);

  const digest = sha256File(stagedApk);
  writeFileSync(join(RELEASE_DIR, 'SHA256SUMS'), `${digest}  ${apkName}\n`);
  console.log(`· sha256 ${digest}`);

  const notes = notesFile
    ? readFileSync(resolve(ROOT, notesFile), 'utf8')
    : `${extractChangelog(info.version)}\n\n---\n\n安装包 sha256（SHA256SUMS 同附在资产里）：\n\`${digest}\`\n`;
  const notesPath = join(RELEASE_DIR, 'RELEASE_NOTES.md');
  writeFileSync(notesPath, notes);

  const hasTag = spawnSync('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], { cwd: ROOT })
    .status === 0;
  if (hasTag) {
    console.log(`· tag ${tag} 已存在，复用`);
  } else {
    run('git', ['tag', '-a', tag, '-m', `FaceE ${tag}`]);
    console.log(`· 已打 tag ${tag}`);
  }

  run('gh', [
    'release',
    'create',
    tag,
    stagedApk,
    join(RELEASE_DIR, 'SHA256SUMS'),
    '--title',
    `FaceE ${tag}`,
    '--notes-file',
    notesPath,
  ]);

  console.log(`\n✔ 发布完成：https://github.com/HBxtzhn/facee/releases/tag/${tag}`);
  console.log(`  推送 tag：git push origin ${tag}\n`);
}

main();
