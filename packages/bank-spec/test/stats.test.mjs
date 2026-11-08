// stats：分布、标签使用、专题覆盖、复核时效；有错误时仍基于可解析部分统计。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { bankStats, formatStats } from '../lib/stats.mjs';
import { BANK_YAML, PKG_DIR, QID, SAMPLE_BANK, questionMd, writeBank } from './helpers.mjs';

const CLI = join(PKG_DIR, 'cli.mjs');
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

const bank = () =>
  writeBank({
    'bank.yaml': BANK_YAML.replace('  - { id: cache, name: 缓存, parent: storage }', '  - { id: cache, name: 缓存, parent: storage }\n  - { id: idle, name: 闲置 }'),
    'questions/redis/a.md': questionMd({ id: QID.a, fm: { importance: 3, reviewedAt: '2026-01-01', references: '[{ title: 文档, url: "https://example.com" }]' } }),
    'questions/redis/b.md': questionMd({ id: QID.b, fm: { title: 'B？', difficulty: 'hard', tags: '[storage]', reviewedAt: '2026-11-01' } }),
    'questions/mysql/c.md': questionMd({ id: QID.c, fm: { title: 'C？', category: 'mysql', type: 'scenario' } }),
  });

test('stats：分类 / 题型 / 难度 / 重要度分布与标签使用', () => {
  const s = bankStats(bank(), { staleDays: 180, today: '2026-11-08' });
  assert.equal(s.ok, true);
  assert.equal(s.total, 3);
  assert.equal(s.errorCount, 0);
  assert.deepEqual(s.categories.map((r) => [r.key, r.name, r.count]), [['redis', 'Redis', 2], ['mysql', 'MySQL', 1]]);
  assert.deepEqual(s.types.find((r) => r.key === 'scenario'), { key: 'scenario', count: 1, ratio: 1 / 3 });
  assert.equal(s.types.find((r) => r.key === 'choice').count, 0, '没有的题型也列出');
  assert.deepEqual(s.difficulties.map((r) => r.count), [2, 0, 1]);
  assert.deepEqual(s.importance.map((r) => [r.key, r.count]), [[3, 1], [2, 2], [1, 0]]);
  assert.deepEqual(s.tags.map((t) => [t.id, t.count, t.withChildren]), [['storage', 1, 3], ['cache', 2, 2], ['idle', 0, 0]]);
  assert.deepEqual(s.unusedTags, ['idle']);
  assert.deepEqual(s.singleUseTags, ['storage']);
  assert.deepEqual(s.collections, [{ id: 'core', name: '核心', count: 2 }]);
  assert.deepEqual(s.notInAnyCollection, [QID.c]);
  assert.equal(s.withoutReferences, 2);
  assert.deepEqual(s.neverReviewed.map((r) => r.id), [QID.c]);
  assert.deepEqual(s.stale.map((r) => [r.id, r.ageDays]), [[QID.a, 311]]);
  const text = formatStats(s);
  assert.match(text, /题目总数：3/);
  assert.match(text, /未使用：idle/);
  assert.match(text, /复核超过 180 天：1/);
});

test('stats：题目有校验错误时仍统计可解析部分并给出错误数', () => {
  const dir = writeBank({ 'questions/redis/b.md': questionMd({ id: QID.b, fm: { tags: '[]' } }) });
  const s = bankStats(dir);
  assert.equal(s.ok, true);
  assert.ok(s.errorCount > 0);
  assert.equal(s.total, 2);
  assert.match(formatStats(s), /校验错误/);
});

test('CLI stats：文本 / JSON；bank.yaml 缺失退出码 1；--stale-days 非法退出码 2', () => {
  const text = run(['stats', '--bank', SAMPLE_BANK, '--today', '2026-11-08']);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /## 标签/);
  const json = run(['stats', '--bank', SAMPLE_BANK, '--json', '--stale-days', '0', '--today', '2026-11-08']);
  assert.equal(json.status, 0, json.stderr);
  const s = JSON.parse(json.stdout);
  assert.equal(s.total, 14);
  assert.equal(s.stale.length, 14);
  assert.equal(run(['stats', '--bank', writeBank({ 'bank.yaml': null })]).status, 1);
  assert.equal(run(['stats', '--bank', SAMPLE_BANK, '--stale-days', '-1']).status, 2);
});
