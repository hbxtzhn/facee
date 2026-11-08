// merge-question / remove-question：引用改写、专题去重、合并链展开、查环、就地保留格式。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileBank } from '../lib/compile.mjs';
import { retireQuestion } from '../lib/retire.mjs';
import { BANK_YAML, PKG_DIR, QID, questionMd, writeBank } from './helpers.mjs';

const CLI = join(PKG_DIR, 'cli.mjs');
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
const read = (dir, rel) => readFileSync(join(dir, rel), 'utf8');
const fmOf = (dir, rel) => read(dir, rel).split('\n---')[0];
const ok = (dir) => {
  const res = compileBank(dir);
  assert.equal(res.errorCount, 0, res.diagnostics.map((d) => `${d.file}:${d.line}: ${d.code} ${d.message}`).join('\n'));
  return res.bundle;
};

/** a、b、c 三题；c 引用 a */
const threeQuestions = (cFm = {}) => ({
  'questions/redis/c.md': questionMd({ id: QID.c, fm: { title: '缓存击穿怎么办？', ...cFm } }),
});

test('merge：引用 A → B 并去重，专题去重，写 merged，删除 A 文件，结果通过校验', () => {
  const dir = writeBank(threeQuestions({ prerequisites: `[${QID.a}]`, related: `[${QID.a}, ${QID.b}]` }));
  const r = retireQuestion(dir, { from: QID.a, into: QID.b });
  assert.ok(r.changes.some((c) => c.includes('专题「core」删除')));
  assert.equal(existsSync(join(dir, 'questions/redis/a.md')), false);
  assert.match(fmOf(dir, 'questions/redis/c.md'), new RegExp(`^prerequisites: \\[${QID.b}\\]$`, 'm'));
  assert.match(fmOf(dir, 'questions/redis/c.md'), new RegExp(`^related: \\[${QID.b}\\]$`, 'm'));
  const bundle = ok(dir);
  assert.deepEqual(bundle.collections[0].questions, [QID.b]);
  assert.deepEqual(bundle.lifecycle, { removed: [], merged: { [QID.a]: QID.b } });
});

test('merge：B 自己引用 A 时删除该引用（不产生自引用）', () => {
  const dir = writeBank({ 'questions/redis/b.md': questionMd({ id: QID.b, fm: { title: 'B', related: `[${QID.a}]` } }) });
  retireQuestion(dir, { from: QID.a, into: QID.b });
  assert.match(fmOf(dir, 'questions/redis/b.md'), /^related: \[\]$/m);
  ok(dir);
});

test('merge：展开合并链 X → A 改为 X → B', () => {
  const dir = writeBank({ 'bank.yaml': BANK_YAML.replace('merged: {}', `merged: { ${QID.d}: ${QID.a} }`) });
  const r = retireQuestion(dir, { from: QID.a, into: QID.b });
  assert.ok(r.changes.some((c) => c.includes('展开合并链')));
  assert.deepEqual(ok(dir).lifecycle.merged, { [QID.d]: QID.b, [QID.a]: QID.b });
});

test('merge：改写后 prerequisites 成环则报错且不写任何文件', () => {
  const dir = writeBank({
    'questions/redis/b.md': questionMd({ id: QID.b, fm: { title: 'B', prerequisites: `[${QID.c}]` } }),
    ...threeQuestions({ prerequisites: `[${QID.a}]` }),
  });
  const before = ['bank.yaml', 'questions/redis/a.md', 'questions/redis/b.md', 'questions/redis/c.md'].map((f) => read(dir, f));
  assert.throws(() => retireQuestion(dir, { from: QID.a, into: QID.b }), /成环/);
  assert.deepEqual(['bank.yaml', 'questions/redis/a.md', 'questions/redis/b.md', 'questions/redis/c.md'].map((f) => read(dir, f)), before);
});

test('merge --dry-run 只报告不写文件；参数错误', () => {
  const dir = writeBank(threeQuestions({ related: `[${QID.a}]` }));
  const before = read(dir, 'bank.yaml');
  const r = retireQuestion(dir, { from: QID.a, into: QID.b, dryRun: true });
  assert.ok(r.changes.length >= 3);
  assert.equal(read(dir, 'bank.yaml'), before);
  assert.ok(existsSync(join(dir, 'questions/redis/a.md')));
  assert.throws(() => retireQuestion(dir, { from: QID.a, into: QID.a }), /不能相同/);
  assert.throws(() => retireQuestion(dir, { from: QID.d, into: QID.a }), /找不到题目/);
  assert.throws(() => retireQuestion(dir, { from: QID.a, into: QID.d }), /找不到合并目标/);
  assert.throws(() => retireQuestion(dir, { from: 'q_x', into: QID.b }), /不合法/);
});

test('块式 YAML + CRLF：只改受影响的条目，注释、缩进、换行符原样保留', () => {
  const bankYaml = `schemaVersion: 2
bank:
  id: github.com/example/test-bank
  name: 测试题库
  version: 1.0.0
categories:
  - { id: redis, name: Redis }
tags:
  - { id: storage, name: 存储, parent: null }
  - { id: cache, name: 缓存, parent: storage }
collections:
  - id: core
    name: 核心
    questions:
      - ${QID.a} # 缓存是什么
      - ${QID.b} # 一致性
  - id: path
    name: 路线
    questions:
      - ${QID.c} # 击穿
      - ${QID.a} # 缓存是什么
lifecycle:
  removed:
    - ${QID.d} # 已删
  merged:
    q_01J00000000000000000000000: ${QID.b} # 旧题
`.replace(/\n/g, '\r\n');
  const cMd = questionMd({ id: QID.c, fm: { title: '击穿' } }).replace(
    `tags: [cache]`,
    `tags: [cache]\nrelated:\n  - ${QID.b}\n  - ${QID.a} # 原题`,
  );
  const dir = writeBank({ 'bank.yaml': bankYaml, 'questions/redis/c.md': cMd.replace(/\n/g, '\r\n') });
  retireQuestion(dir, { from: QID.a, into: QID.b });
  const y = read(dir, 'bank.yaml');
  assert.ok(!/[^\r]\n/.test(y), '保持 CRLF');
  assert.equal(
    y,
    bankYaml
      .replace(`      - ${QID.a} # 缓存是什么\r\n      - ${QID.b} # 一致性`, `      - ${QID.b} # 一致性`)
      .replace(`      - ${QID.c} # 击穿\r\n      - ${QID.a} # 缓存是什么`, `      - ${QID.c} # 击穿\r\n      - ${QID.b} # 缓存是什么`)
      .replace(`${QID.b} # 旧题\r\n`, `${QID.b} # 旧题\r\n    ${QID.a}: ${QID.b}\r\n`),
  );
  // c 的块式 related 中 A 与已有的 B 重复：删掉 A 那一行
  assert.equal(read(dir, 'questions/redis/c.md'), cMd.replace(/\n/g, '\r\n').replace(`\r\n  - ${QID.a} # 原题`, ''));
  const bundle = ok(dir);
  assert.deepEqual(bundle.collections.map((c) => c.questions), [[QID.b], [QID.c, QID.b]]);
});

test('remove：清理引用与专题，写 removed；指向被删题的合并声明转为 removed', () => {
  const dir = writeBank({
    'bank.yaml': BANK_YAML.replace('merged: {}', `merged: { ${QID.d}: ${QID.a} }`),
    ...threeQuestions({ prerequisites: `[${QID.a}]` }),
  });
  const r = retireQuestion(dir, { from: QID.a });
  assert.ok(r.changes.some((c) => c.includes('改为 removed')));
  assert.equal(existsSync(join(dir, 'questions/redis/a.md')), false);
  assert.match(fmOf(dir, 'questions/redis/c.md'), /^prerequisites: \[\]$/m);
  const bundle = ok(dir);
  assert.deepEqual(bundle.collections[0].questions, [QID.b]);
  assert.deepEqual(bundle.lifecycle, { removed: [QID.d, QID.a], merged: {} });
});

test('remove：块式序列删空时写成 []；专题删空则报错且不写文件', () => {
  const cMd = questionMd({ id: QID.c, fm: { title: '击穿' } }).replace('tags: [cache]', `tags: [cache]\nrelated:\n  - ${QID.b}`);
  const dir = writeBank({ 'questions/redis/c.md': cMd });
  retireQuestion(dir, { from: QID.b });
  assert.match(read(dir, 'questions/redis/c.md'), /^related:\n {2}\[\]\n---$/m);
  ok(dir);

  const only = writeBank({ 'bank.yaml': BANK_YAML.replace(`[${QID.a}, ${QID.b}]`, `[${QID.a}]`) });
  const before = read(only, 'bank.yaml');
  assert.throws(() => retireQuestion(only, { from: QID.a }), /专题「core」删除 .* 后为空/);
  assert.equal(read(only, 'bank.yaml'), before);
  assert.ok(existsSync(join(only, 'questions/redis/a.md')));
});

test('缺少 lifecycle 时提示先写出 removed / merged', () => {
  const dir = writeBank({ 'bank.yaml': BANK_YAML.replace(/lifecycle:[\s\S]*$/, '') });
  assert.throws(() => retireQuestion(dir, { from: QID.a, into: QID.b }), /lifecycle\.removed/);
});

test('CLI merge-question / remove-question', () => {
  const dir = writeBank(threeQuestions({ related: `[${QID.a}]` }));
  assert.equal(run(['merge-question', '--bank', dir, '--from', QID.a]).status, 2);
  assert.equal(run(['remove-question', '--bank', dir]).status, 2);
  const missing = run(['merge-question', '--bank', dir, '--from', QID.d, '--into', QID.a]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /找不到题目/);
  const dry = run(['merge-question', '--bank', dir, '--from', QID.a, '--into', QID.b, '--dry-run']);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /\[dry-run\]/);
  assert.ok(existsSync(join(dir, 'questions/redis/a.md')));
  const merged = run(['merge-question', '--bank', dir, '--from', QID.a, '--into', QID.b]);
  assert.equal(merged.status, 0, merged.stderr);
  assert.equal(run(['validate', '--bank', dir]).status, 0);
  const removed = run(['remove-question', '--bank', dir, '--id', QID.c]);
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(run(['validate', '--bank', dir]).status, 0);
  writeFileSync(join(dir, 'questions/redis/x.md'), 'no front matter');
  assert.equal(run(['remove-question', '--bank', dir, '--id', QID.b]).status, 1);
});
