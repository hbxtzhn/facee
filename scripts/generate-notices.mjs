#!/usr/bin/env node
// 从当前锁定的生产依赖收集版权与完整许可文本；包含构建工具依赖，宁可多收不漏收。
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const groups = JSON.parse(execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], {
  cwd: root, encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 10 * 1024 * 1024,
}));
// pnpm licenses 的 paths 在 hoisted 布局下可能仍指向不存在的 .pnpm 路径。
// 按实际安装的 name/version 查找全部副本，不能把「路径不存在」当上游缺许可。
const installed = new Map();
const visited = new Set();
function scanModules(directory) {
  if (!existsSync(directory)) return;
  const real = realpathSync(directory);
  if (visited.has(real)) return;
  visited.add(real);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || (!entry.isDirectory() && !entry.isSymbolicLink())) continue;
    const path = join(directory, entry.name);
    if (entry.name.startsWith('@')) {
      scanModules(path);
      continue;
    }
    const manifest = join(path, 'package.json');
    if (existsSync(manifest)) {
      const { name, version } = JSON.parse(readFileSync(manifest, 'utf8'));
      const key = `${name}@${version}`;
      if (!installed.has(key)) installed.set(key, new Set());
      installed.get(key).add(path);
    }
    scanModules(join(path, 'node_modules'));
  }
}
scanModules(join(root, 'node_modules'));
const packages = Object.values(groups).flat().sort((a, b) => a.name.localeCompare(b.name, 'en'));
const sections = ['FaceE copyright and third-party license notices\nGenerated from pnpm-lock.yaml. Includes production dependency graph and build tools.', readFileSync(join(root, 'LICENSE'), 'utf8').replace(/\r\n/g, '\n').trim()];
const missing = [];
for (const pkg of packages) {
  const texts = new Set();
  const paths = new Set();
  for (const version of pkg.versions) {
    const found = installed.get(`${pkg.name}@${version}`);
    if (!found?.size) throw new Error(`许可收集缺少已安装依赖 ${pkg.name}@${version}；请检查安装布局`);
    for (const path of found) paths.add(path);
  }
  for (const path of paths) {
    for (const file of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      if (file.isFile() && /^(licen[cs]e|copying|notice)([.-]|$)/i.test(file.name)) {
        texts.add(readFileSync(join(path, file.name), 'utf8').replace(/\r\n/g, '\n').trim());
      }
    }
  }
  if (!texts.size) missing.push(pkg.name);
  sections.push(`${pkg.name} @ ${[...pkg.versions].sort().join(', ')}\nLicense: ${pkg.license}\nAuthor: ${typeof pkg.author === 'string' ? pkg.author : JSON.stringify(pkg.author ?? '')}\nHomepage: ${pkg.homepage ?? ''}\n\n${[...texts].sort().join('\n\n') || 'No standalone license file supplied by upstream; see package metadata and homepage.'}`);
}
sections.push(`JetBrains Mono\n${readFileSync(join(root, 'assets/fonts/OFL.txt'), 'utf8').replace(/\r\n/g, '\n').trim()}`);
const result = sections.join('\n\n' + '='.repeat(72) + '\n\n').replace(/[ \t]+$/gm, '') + '\n';
const target = join(root, 'docs/third-party-licenses.txt');
if (process.argv.includes('--check')) {
  const expected = readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
  if (expected !== result) {
    const diagnostic = join(process.env.RUNNER_TEMP || tmpdir(), 'facee-third-party-licenses.actual.txt');
    writeFileSync(diagnostic, result);
    throw new Error(`第三方许可清单过期，请运行 pnpm notices；实际内容：${diagnostic}`);
  }
} else {
  writeFileSync(target, result);
}
console.log(`Collected ${packages.length} packages; ${missing.length} upstream packages without standalone license files: ${missing.join(', ')}`);
