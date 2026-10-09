#!/usr/bin/env node
// 不使用 pnpm audit --ignore：pnpm 11 会把它持久化到项目配置，隐藏普通审计结果。
import { spawnSync } from 'node:child_process';
import { verifyDependencyBackports } from './verify-dependency-patches.mjs';
const patched = verifyDependencyBackports();
const exceptions = new Map([
  ['GHSA-86w9-cpqp-85rv', 'node-forge'],
]);
const result = spawnSync('pnpm', ['audit', '--prod', '--json'], {
  encoding: 'utf8', shell: process.platform === 'win32', timeout: 90_000, maxBuffer: 10 * 1024 * 1024,
});
if (result.error) throw result.error;
const report = JSON.parse(result.stdout);
if (!report.advisories || !report.metadata || ![0, 1].includes(result.status)) {
  throw new Error(`依赖审计不可用，禁止跳过：${result.stderr || result.stdout}`);
}
let blocked = false;
for (const advisory of Object.values(report.advisories)) {
  const id = advisory.github_advisory_id;
  if (patched.get(id) === advisory.module_name) {
    console.warn(`LOCAL BACKPORT VERIFIED ${id} ${advisory.module_name} — original version still appears in audit; see docs/dependency-security.md`);
  } else if (exceptions.get(id) === advisory.module_name) {
    console.warn(`TEMPORARY EXCEPTION ${id} ${advisory.module_name} (${advisory.severity}) — see docs/dependency-security.md; review before release`);
  } else if (['moderate', 'high', 'critical'].includes(advisory.severity)) {
    console.error(`BLOCKED ${id} ${advisory.module_name}: ${advisory.title}`);
    blocked = true;
  }
}
if (blocked) process.exit(1);
console.log('No unrecorded moderate-or-higher advisories. Two local backports require installed-file hashes and security regression; ordinary pnpm audit remains unfiltered.');
