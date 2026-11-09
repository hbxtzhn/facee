import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ulid, isUlid, ulidTime, newQuestionId, CROCKFORD } from '../lib/ulid.mjs';
import { fixIdsInSource, fixIds, newQuestion } from '../lib/ids.mjs';
import { compileBank, isQuestionId } from '../lib/compile.mjs';
import { questionMd, writeBank, QID } from './helpers.mjs';

test('ULID：26 位 Crockford Base32，时间戳可解码，随机部分来自注入源', () => {
  const now = Date.UTC(2026, 10, 5);
  const id = ulid(now, (n) => new Uint8Array(n).fill(0xff));
  assert.equal(id.length, 26);
  assert.ok(isUlid(id));
  assert.equal(ulidTime(id), now);
  assert.equal(id.slice(10), 'Z'.repeat(16));
  assert.equal(ulid(0, (n) => new Uint8Array(n)), '0'.repeat(26));
  // 最大时间戳 2^48-1 → 首字符 7
  assert.equal(ulid(2 ** 48 - 1, (n) => new Uint8Array(n))[0], '7');
  assert.throws(() => ulid(2 ** 48));
  assert.ok(!CROCKFORD.includes('I') && !CROCKFORD.includes('L') && !CROCKFORD.includes('O') && !CROCKFORD.includes('U'));
});

test('ULID：同毫秒内也不重复，题目 id 合法', () => {
  const ids = new Set();
  for (let i = 0; i < 1000; i++) ids.add(newQuestionId(1_700_000_000_000));
  assert.equal(ids.size, 1000);
  for (const id of ids) assert.ok(isQuestionId(id), id);
  assert.ok(!isQuestionId('q_81J0000000000000000000000A'), '超过 128 位');
  assert.ok(!isQuestionId('q_01j0000000000000000000000a'), '小写');
});

const fixedId = () => QID.d;

test('fix-ids：补齐题目 / 要点 / 追问 id，保留权重，已有 id 不改号', () => {
  const src = questionMd({
    id: '',
    body: `## 一句话
x

## 要点
- [kp1|2] 甲
- [|3] 乙
- 丙
- [kp2] 丁

## 追问
### 问一？
答一

### [f3] 问三？
答三

### [] 问四？
答四
`,
  });
  const { text, changes } = fixIdsInSource(src, { newId: fixedId });
  assert.ok(changes.length > 0);
  assert.match(text, new RegExp(`^---\\nid: ${QID.d}\\n`));
  assert.match(text, /- \[kp1\|2\] 甲\n- \[kp3\|3\] 乙\n- \[kp4\] 丙\n- \[kp2\] 丁/);
  // f3 存在 → f1、f2 是空洞，记入 retired；新追问从 f4 起
  assert.match(text, /### \[f4\] 问一？/);
  assert.match(text, /### \[f3\] 问三？/);
  assert.match(text, /### \[f5\] 问四？/);
  assert.match(text, /^retired: \[f1, f2\]$/m);

  // 幂等：再跑一次不再改变
  const again = fixIdsInSource(text, { newId: fixedId });
  assert.deepEqual(again.changes, []);
  assert.equal(again.text, text);
});

test('fix-ids：retired 中的 id 不复用；块状 retired 被改写为行内数组；CRLF 保留', () => {
  const src = questionMd({
    fm: { retired: '\n  - kp4' },
    body: `## 一句话
x

## 要点
- [kp1] a
- [kp2] b
- [kp3] c
- 新增

## 追问
### [f2] 问
答
`,
  }).replace(/\n/g, '\r\n');
  const { text } = fixIdsInSource(src, { newId: fixedId });
  assert.ok(text.includes('\r\n'));
  const lf = text.replace(/\r\n/g, '\n');
  assert.match(lf, /- \[kp5\] 新增/);
  assert.match(lf, /^retired: \[kp4, f1\]$/m);
  assert.doesNotMatch(lf, /^ {2}- kp4$/m);
  assert.deepEqual(fixIdsInSource(text, { newId: fixedId }).changes, []);
});

test('fix-ids：整库运行后通过校验，再次运行无改动', () => {
  const dir = writeBank({
    'questions/redis/c.md': questionMd({
      id: '',
      body: '## 一句话\n一句话。\n\n## 要点\n- 甲\n- 乙\n- 丙\n\n## 追问\n### 问？\n答。\n',
    }),
  });
  assert.ok(compileBank(dir).errorCount > 0);
  const report = fixIds(dir);
  assert.equal(report.length, 1);
  assert.equal(report[0].file, 'questions/redis/c.md');
  const res = compileBank(dir);
  assert.equal(res.errorCount, 0, JSON.stringify(res.diagnostics));
  const c = res.bundle.questions.find((q) => q.title === '缓存是什么？' && q.id !== QID.a);
  assert.deepEqual(c.answer.keyPoints.map((k) => k.id), ['kp1', 'kp2', 'kp3']);
  assert.deepEqual(c.followups.map((f) => f.id), ['f1']);
  const before = readFileSync(join(dir, 'questions/redis/c.md'), 'utf8');
  assert.deepEqual(fixIds(dir), []);
  assert.equal(readFileSync(join(dir, 'questions/redis/c.md'), 'utf8'), before);
});

test('new：生成骨架，经 fix-ids 补号后只剩 TODO 警告', () => {
  const dir = writeBank();
  const { id, file } = newQuestion(dir, { category: 'mysql', title: '索引是什么？', tags: ['storage'] });
  assert.ok(isQuestionId(id));
  assert.ok(file.endsWith(`${id}.md`));
  assert.ok(readdirSync(join(dir, 'questions', 'mysql')).includes(`${id}.md`));
  assert.throws(() => newQuestion(dir, { category: 'nope' }), /未在 bank.yaml/);
  assert.throws(() => newQuestion(dir, { category: 'mysql', tags: ['nope'] }), /标签「nope」未在 bank.yaml/);
  // 不给 tags：骨架为 tags: []，validate 报 TAG_COUNT 提醒补标签
  const bare = newQuestion(writeBank(), { category: 'mysql' });
  assert.match(readFileSync(bare.file, 'utf8'), /^tags: \[\]$/m);
  fixIds(dir);
  const res = compileBank(dir);
  assert.equal(res.errorCount, 0, JSON.stringify(res.diagnostics));
  assert.ok(res.diagnostics.some((d) => d.code === 'TODO_LEFT'));
  const q = res.bundle.questions.find((x) => x.id === id);
  assert.equal(q.title, '索引是什么？');
  assert.deepEqual(q.tags, ['storage']);
  assert.deepEqual(q.answer.keyPoints.map((k) => [k.id, k.weight]), [['kp1', 2], ['kp2', 2], ['kp3', 1]]);
});

test('fix-ids 不改动已完整的示例题库', () => {
  // 只做 dry-run：示例题库是提交在仓库里的源文件
  const report = fixIds(join(import.meta.dirname, '..', 'examples', 'sample-bank'), { dryRun: true });
  assert.deepEqual(report, []);
});
