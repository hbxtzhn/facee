import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildBank, resolveBaseUrl } from '../lib/build.mjs';
import { compileBank } from '../lib/compile.mjs';
import { CONTENT_HASH_FIELDS, canonicalJson, questionContentHash, sha256Hex } from '../lib/canonical.mjs';
import { readCentralDirectory, inflateEntry } from '../lib/zip.mjs';
import * as rules from '../lib/rules.mjs';
import {
  PKG_DIR, REPO_DIR, SAMPLE_BANK, SAMPLE_DIST, QID, copySampleBank, tempDir, validateSchema, writeBank, questionMd, DEFAULT_BODY,
} from './helpers.mjs';

const bundleSchema = JSON.parse(readFileSync(join(PKG_DIR, 'schema', 'bundle.schema.json'), 'utf8'));
const latestSchema = JSON.parse(readFileSync(join(PKG_DIR, 'schema', 'latest.schema.json'), 'utf8'));
const typesTs = readFileSync(join(REPO_DIR, 'src', 'bank', 'types.ts'), 'utf8');
const PUBLISHED_AT = '2026-11-05T00:00:00Z';

const R1 = 'q_01M6B1YQ006MV342WKV7JTR8H1'; // Redis 过期删除（含图片）
const R3 = 'q_01M6B22C60ED5XXJXQWP3KD9RG'; // 穿透 / 击穿 / 雪崩
const R4 = 'q_01M6B246S0HK05NM2HC5EC52F8'; // 选择题
const R5 = 'q_01M6B261C0ZAPARVE2GQ1GDDW8'; // 分布式限流
const M1 = 'q_01M6B27VZ068DC8PEV0GWCQG5K'; // B+ 树

function build(bankDir, opts = {}) {
  const out = tempDir('bank-dist-');
  const res = buildBank(bankDir, { out, publishedAt: PUBLISHED_AT, ...opts });
  return { ...res, out, read: (f) => readFileSync(join(out, f)) };
}

// ---------------- 与 src/bank/types.ts 的一致性 ----------------

/** 从 types.ts 提取 `export interface X { ... }` 的字段：name → optional */
function interfaceFields(name) {
  const src = typesTs.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const start = src.indexOf(`export interface ${name} `);
  assert.ok(start >= 0, `types.ts 中没有 interface ${name}`);
  let i = src.indexOf('{', start) + 1;
  let depth = 1;
  let body = '';
  while (depth > 0) {
    const ch = src[i++];
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    // 只保留第一层字段（嵌套对象内的字段替换为空白）
    body += depth === 1 || (depth === 2 && ch === '{') ? ch : ' ';
  }
  const fields = {};
  for (const m of body.matchAll(/^\s*(\w+)(\?)?\s*:/gm)) fields[m[1]] = Boolean(m[2]);
  return fields;
}

function schemaFields(schema) {
  const fields = {};
  for (const k of Object.keys(schema.properties)) fields[k] = !(schema.required ?? []).includes(k);
  return fields;
}

test('JSON Schema 的字段与必填性与 types.ts 的 interface 完全一致', () => {
  const defs = bundleSchema.$defs;
  const pairs = [
    ['Bundle', bundleSchema],
    ['BankMeta', defs.BankMeta],
    ['Category', defs.Category],
    ['Tag', defs.Tag],
    ['Collection', defs.Collection],
    ['Lifecycle', defs.Lifecycle],
    ['KeyPoint', defs.KeyPoint],
    ['Followup', defs.Followup],
    ['Answer', defs.Answer],
    ['ChoiceOption', defs.Choice.properties.options.items],
    ['Choice', defs.Choice],
    ['Source', defs.Source],
    ['Reference', defs.Reference],
    ['Question', defs.Question],
    ['Manifest', latestSchema],
    ['ArtifactRef', latestSchema.$defs.ArtifactRef],
  ];
  for (const [name, schema] of pairs) {
    assert.deepEqual(schemaFields(schema), interfaceFields(name), `${name} 字段不一致`);
  }
  assert.deepEqual(schemaFields(defs.BankMeta.properties.update), { manifest: false, fallback: true });
});

test('正则常量与 types.ts、JSON Schema 一致', () => {
  const fromTs = Object.fromEntries(
    [...typesTs.matchAll(/export const (\w+_PATTERN) = \/(.+)\/;/g)].map((m) => [m[1], m[2]]),
  );
  assert.ok(Object.keys(fromTs).length >= 6);
  for (const [name, source] of Object.entries(fromTs)) {
    assert.equal(rules[name]?.source, source, `${name} 与 types.ts 不一致`);
  }
  const defs = bundleSchema.$defs;
  assert.equal(new RegExp(defs.BankId.pattern).source, rules.BANK_ID_PATTERN.source);
  assert.equal(new RegExp(defs.QuestionId.pattern).source, rules.QUESTION_ID_PATTERN.source);
  assert.equal(new RegExp(defs.KeyPointId.pattern).source, rules.KEY_POINT_ID_PATTERN.source);
  assert.equal(new RegExp(defs.FollowupId.pattern).source, rules.FOLLOWUP_ID_PATTERN.source);
  assert.equal(new RegExp(defs.SlugId.pattern).source, rules.SLUG_ID_PATTERN.source);
  assert.match(typesTs, /BANK_SCHEMA_VERSION = 2 as const/);
  assert.equal(rules.BANK_SCHEMA_VERSION, 2);
});

test('最小 JSON Schema 校验器能发现问题（自检）', () => {
  assert.deepEqual(validateSchema(bundleSchema, { schemaVersion: 2 }).length > 0, true);
  const errs = validateSchema(latestSchema, { bankId: 'a/b/c', schemaVersion: 2, version: '1.0.0', publishedAt: PUBLISHED_AT, bundle: { url: 'x', sha256: 'z', size: 1 }, questions: {}, extra: 1 }, { strict: true });
  assert.ok(errs.some((e) => e.includes('sha256')));
  assert.ok(errs.some((e) => e.includes('未知字段 extra')));
});

// ---------------- 示例题库构建 ----------------

test('示例题库：bundle / latest 满足 schema（严格模式：无多余字段）', () => {
  const res = build(SAMPLE_BANK, { pretty: true });
  assert.equal(res.errorCount, 0, JSON.stringify(res.diagnostics));
  assert.deepEqual(res.diagnostics, []);
  const bundle = JSON.parse(res.read('bundle-2.0.0.json'));
  const latest = JSON.parse(res.read('latest.json'));
  assert.deepEqual(validateSchema(bundleSchema, bundle, { strict: true }), []);
  assert.deepEqual(validateSchema(latestSchema, latest, { strict: true }), []);

  // 覆盖面：全部题型、prompt 有 / 无、选择题、图片、专题、标签层级
  const types = new Set(bundle.questions.map((q) => q.type));
  assert.deepEqual([...types].sort(), [...rules.QUESTION_TYPES].sort());
  assert.ok(bundle.questions.length >= 12);
  assert.ok(bundle.questions.some((q) => q.prompt) && bundle.questions.some((q) => q.prompt === null));
  assert.ok(bundle.questions.some((q) => q.followups.length) && bundle.questions.some((q) => q.answer.examples));
  assert.ok(bundle.questions.some((q) => q.prerequisites.length) && bundle.questions.some((q) => q.related.length));
  assert.ok(bundle.collections.length >= 1);
  assert.ok(bundle.tags.some((t) => t.parent), '有两层标签');
  assert.ok(!bundle.tags.some((t) => t.parent && bundle.tags.find((p) => p.id === t.parent)?.parent), '示例标签不超过两层');
  assert.ok(bundle.tags.some((t) => t.description) && bundle.tags.some((t) => t.aliases?.length), '覆盖标签说明与别名');
  for (const q of bundle.questions) assert.ok(q.tags.length >= 1 && q.tags.length <= 3, q.id);
  for (const q of bundle.questions) {
    assert.equal(q.choice === null, q.type !== 'choice');
    for (const c of q.choice?.correct ?? []) assert.ok(q.choice.options.some((o) => o.id === c));
  }
  assert.equal(latest.publishedAt, PUBLISHED_AT);
  assert.equal(latest.minAppVersion, '0.2.0');
  assert.match(latest.changes, /示例题库/);
  assert.equal(latest.bundle.mirrors, undefined, '暂不生成镜像');
});

test('资源：扁平 ZIP、按 sha256 命名、Markdown 引用改写为 asset:', () => {
  const res = build(SAMPLE_BANK);
  const bundle = JSON.parse(res.read('bundle-2.0.0.json'));
  const latest = JSON.parse(res.read('latest.json'));
  const zip = res.read('assets-2.0.0.zip');
  assert.equal(latest.assets.sha256, sha256Hex(zip));
  assert.equal(latest.assets.size, zip.length);
  const bundleBytes = res.read('bundle-2.0.0.json');
  assert.equal(latest.bundle.sha256, sha256Hex(bundleBytes));
  assert.equal(latest.bundle.size, bundleBytes.length);

  const cd = readCentralDirectory(zip);
  assert.ok(cd.ok);
  const names = cd.entries.map((e) => e.name);
  for (const e of cd.entries) {
    assert.match(e.name, /^[0-9a-f]{64}\.(png|jpg|webp)$/);
    assert.equal(`${sha256Hex(inflateEntry(zip, e))}.${e.name.split('.')[1]}`, e.name);
  }
  const json = JSON.stringify(bundle);
  const refs = [...json.matchAll(/\]\((asset:[^)\s]+)\)/g)].map((m) => m[1]);
  assert.ok(refs.length >= 1);
  for (const r of refs) {
    assert.match(r, rules.ASSET_REF_PATTERN);
    assert.ok(names.includes(r.slice('asset:'.length)));
  }
  assert.doesNotMatch(json, /\]\(\.?\/?assets\//, '不得残留相对路径');
  const r1 = bundle.questions.find((q) => q.id === R1);
  assert.match(r1.answer.detail, /!\[[^\]]+\]\(asset:[0-9a-f]{64}\.png\)/);
});

test('构建可复现：同输入同字节；提交的 examples/dist 与源文件一致', () => {
  const a = build(SAMPLE_BANK, { pretty: true });
  const b = build(SAMPLE_BANK, { pretty: true });
  for (const f of a.files) assert.ok(a.read(f).equals(b.read(f)), f);
  const committed = readdirSync(SAMPLE_DIST).sort();
  assert.deepEqual(committed, [...a.files].sort());
  for (const f of a.files) {
    // Windows 上 git 可能把 json 检出为 CRLF：比较时统一换行
    const norm = (buf) => (f.endsWith('.json') ? buf.toString('utf8').replace(/\r\n/g, '\n') : buf);
    assert.deepEqual(norm(readFileSync(join(SAMPLE_DIST, f))), norm(a.read(f)), `${f} 过期：请重新构建示例（见 bank.yaml 顶部命令）`);
  }
});

// ---------------- contentHash ----------------

test('contentHash = sha256(内容字段的规范化 JSON)，与键顺序无关', () => {
  assert.deepEqual(CONTENT_HASH_FIELDS, ['title', 'prompt', 'answer', 'choice', 'followups']);
  const res = compileBank(SAMPLE_BANK);
  for (const q of res.bundle.questions) {
    assert.equal(q.contentHash, questionContentHash(q));
    const { title, prompt, answer, choice, followups } = q;
    assert.equal(q.contentHash, `sha256:${sha256Hex(canonicalJson({ title, prompt, answer, choice, followups }))}`);
    const reversed = Object.fromEntries(Object.entries(q).reverse());
    assert.equal(questionContentHash(reversed), q.contentHash);
  }
  assert.equal(canonicalJson({ b: 1, a: [true, null, 'x'], c: { y: '中', x: undefined } }), '{"a":[true,null,"x"],"b":1,"c":{"y":"中"}}');
  assert.throws(() => canonicalJson({ a: Number.NaN }));
});

test('contentHash：只随本题内容（含引用图片）变化，不受文件位置与题库元数据影响', () => {
  const base = compileBank(SAMPLE_BANK).bundle;
  const hashOf = (bundle, id) => bundle.questions.find((q) => q.id === id).contentHash;

  const dir = copySampleBank();
  // 1) 移动文件 + 改题库元数据：哈希不变
  const from = join(dir, 'questions', 'mysql', `${M1}.md`);
  writeFileSync(join(dir, 'questions', 'redis', `${M1}.md`), readFileSync(from));
  rmSync(from);
  const bankYaml = join(dir, 'bank.yaml');
  writeFileSync(bankYaml, readFileSync(bankYaml, 'utf8').replace('name: FaceE 示例题库', 'name: 改名后的题库'));
  let res = compileBank(dir);
  assert.equal(res.errorCount, 0, JSON.stringify(res.diagnostics));
  for (const q of base.questions) assert.equal(hashOf(res.bundle, q.id), q.contentHash);

  // 2) 只改题目元数据（题型以外的标签、难度、重要度、关系、参考资料、复核日期）：哈希不变
  const m1 = join(dir, 'questions', 'redis', `${M1}.md`);
  const meta = readFileSync(m1, 'utf8')
    .replace(/^difficulty: \w+/m, 'difficulty: hard')
    .replace(/^importance: \d/m, 'importance: 1')
    .replace(/^reviewedAt: .*/m, 'reviewedAt: 2026-01-01')
    .replace(/^estimatedMinutes: .*/m, 'estimatedMinutes: 9');
  assert.notEqual(meta, readFileSync(m1, 'utf8'), '测试前提：元数据确实被改动');
  writeFileSync(m1, meta);
  res = compileBank(dir);
  assert.equal(res.errorCount, 0, JSON.stringify(res.diagnostics));
  const changedMeta = res.bundle.questions.find((q) => q.id === M1);
  assert.equal(changedMeta.difficulty, 'hard');
  assert.equal(changedMeta.contentHash, hashOf(base, M1));

  // 3) 只替换图片内容：引用它的题哈希变化，其余不变
  const png = join(dir, 'questions', 'redis', 'assets', 'expire-cycle.png');
  const bytes = readFileSync(png);
  writeFileSync(png, Buffer.concat([bytes, Buffer.from([0])])); // PNG 尾部附加字节仍可识别
  res = compileBank(dir);
  assert.notEqual(hashOf(res.bundle, R1), hashOf(base, R1));
  assert.equal(hashOf(res.bundle, M1), hashOf(base, M1));
});

// ---------------- 第二版：生命周期 ----------------

function makeV2(dir, { declare = true, version = '2.1.0' } = {}) {
  const yamlPath = join(dir, 'bank.yaml');
  let y = readFileSync(yamlPath, 'utf8');
  y = y.replace('version: 2.0.0', `version: ${version}`);
  // 删除选择题；限流题并入「穿透 / 击穿 / 雪崩」
  rmSync(join(dir, 'questions', 'redis', `${R4}.md`));
  rmSync(join(dir, 'questions', 'redis', `${R5}.md`));
  y = y.replace(/\n\s+- q_01M6B261C0ZAPARVE2GQ1GDDW8 # 分布式限流/, '');
  if (declare) {
    y = y.replace('removed: []', `removed: [${R4}]`).replace('merged: {}', `merged: { ${R5}: ${R3} }`);
  }
  y = y.replace(/changes: .*/, 'changes: 删除 1 题、合并 1 题；修正 Redis 过期策略要点。');
  writeFileSync(yamlPath, y);
  // 去掉指向已删除题目的引用
  for (const [id, cat] of [[R3, 'redis'], ['q_01M6B20HK0ZNWA1FJ4RESDFN8M', 'redis']]) {
    const p = join(dir, 'questions', cat, `${id}.md`);
    writeFileSync(p, readFileSync(p, 'utf8').replace(`related: [${R5}]`, 'related: []'));
  }
  // 修改一题内容
  const r1 = join(dir, 'questions', 'redis', `${R1}.md`);
  writeFileSync(r1, readFileSync(r1, 'utf8').replace('残留的再由内存淘汰策略兜底。', '残留的 key 最终由内存淘汰策略兜底。'));
}

test('第二版：removed + merged + 内容修改，对比上一版 latest.json', () => {
  const v1 = JSON.parse(readFileSync(join(SAMPLE_DIST, 'latest.json'), 'utf8'));
  const dir = copySampleBank();
  makeV2(dir);
  const res = build(dir, { previous: v1, previousFile: 'latest.json' });
  assert.equal(res.errorCount, 0, res.diagnostics.map((d) => `${d.file}:${d.line}: ${d.code} ${d.message}`).join('\n'));
  const v2 = JSON.parse(res.read('latest.json'));
  const bundle = JSON.parse(res.read('bundle-2.1.0.json'));
  assert.deepEqual(validateSchema(latestSchema, v2, { strict: true }), []);
  assert.deepEqual(validateSchema(bundleSchema, bundle, { strict: true }), []);
  assert.equal(v2.version, '2.1.0');
  assert.ok(res.files.includes('assets-2.1.0.zip'));
  assert.deepEqual(bundle.lifecycle, { removed: [R4], merged: { [R5]: R3 } });

  // App 侧「新增 / 修改 / 删除」计算
  const removed = Object.keys(v1.questions).filter((id) => !(id in v2.questions));
  const changed = Object.keys(v2.questions).filter((id) => id in v1.questions && v1.questions[id] !== v2.questions[id]);
  assert.deepEqual(removed.sort(), [R4, R5].sort());
  assert.ok(changed.includes(R1), '修改过的题 contentHash 必须变化');
  assert.ok(!changed.includes(R3), 'related 属于元数据，变化不算内容变化');
  assert.equal(v2.questions[M1], v1.questions[M1], '未改动的题 contentHash 不变');
});

test('第二版：未声明消失的题 → LIFECYCLE_MISSING；版本未递增 → VERSION_NOT_INCREASED', () => {
  const v1 = JSON.parse(readFileSync(join(SAMPLE_DIST, 'latest.json'), 'utf8'));
  const dir = copySampleBank();
  makeV2(dir, { declare: false, version: '2.0.0' });
  const res = build(dir, { previous: v1 });
  assert.equal(res.manifest, null);
  const codes = res.diagnostics.filter((d) => d.severity === 'error').map((d) => d.code);
  assert.equal(codes.filter((c) => c === 'LIFECYCLE_MISSING').length, 2);
  assert.ok(codes.includes('VERSION_NOT_INCREASED'));
  assert.ok(!existsSync(join(res.out, 'latest.json')), '失败时不写产物');
});

// ---------------- 其他构建行为 ----------------

test('无资源时省略 assets zip 与 manifest.assets；base-url 解析', () => {
  const res = build(writeBank(), { baseUrl: 'https://cdn.example.com/bank/' });
  assert.deepEqual(res.files.sort(), ['bundle-1.0.0.json', 'latest.json']);
  const latest = JSON.parse(res.read('latest.json'));
  assert.equal(latest.assets, undefined);
  assert.equal(latest.bundle.url, 'https://cdn.example.com/bank/bundle-1.0.0.json');
  assert.equal(resolveBaseUrl(undefined, 'https://h/o/r/releases/latest/download/latest.json'), 'https://h/o/r/releases/latest/download');
  assert.equal(resolveBaseUrl(undefined, undefined), '');
  // 题目按 id 排序，默认 importance = 2，keyPoint 默认权重 1
  const bundle = JSON.parse(res.read('bundle-1.0.0.json'));
  assert.deepEqual(bundle.questions.map((q) => q.id), [QID.a, QID.b]);
  assert.equal(bundle.questions[0].importance, 2);
  assert.deepEqual(bundle.questions[0].answer.keyPoints.map((k) => k.weight), [2, 1, 1]);
  assert.deepEqual(bundle.questions[0].answer.pitfalls, []);
  assert.equal(bundle.questions[0].answer.detail, null);
});

test('选择题的「详解」作为 choice.explanation，answer.detail 为 null', () => {
  const md = questionMd({ id: QID.a, fm: { type: 'choice' }, body: `${DEFAULT_BODY}\n## 详解\n解析。\n\n## 选项\n- [a] 甲 ✓\n- [b] 乙 ✔\n- [c] 丙\n` });
  const res = compileBank(writeBank({ 'questions/redis/a.md': md }));
  assert.equal(res.errorCount, 0, JSON.stringify(res.diagnostics));
  const q = res.bundle.questions.find((x) => x.id === QID.a);
  assert.equal(q.answer.detail, null);
  assert.deepEqual(q.choice, { options: [{ id: 'a', text: '甲' }, { id: 'b', text: '乙' }, { id: 'c', text: '丙' }], correct: ['a', 'b'], explanation: '解析。' });
});

// ---------------- CLI ----------------

const CLI = join(PKG_DIR, 'cli.mjs');
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

test('CLI validate：错误输出 file:line: CODE message，退出码 1', () => {
  const dir = writeBank({ 'questions/redis/a.md': questionMd({ id: QID.a, fm: { category: 'kafka' } }) });
  const r = run(['validate', '--bank', dir]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^questions\/redis\/a\.md:\d+: REF_MISSING .+$/m);
  const ok = run(['validate', '--bank', SAMPLE_BANK]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /校验通过：14 题/);
});

test('CLI validate：警告不影响退出码，格式为 file:line: warning CODE message', () => {
  const dir = writeBank({ 'questions/redis/assets/unused.png': 'x' });
  const r = run(['validate', '--bank', dir]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^questions\/redis\/assets\/unused\.png:1: warning ASSET_UNUSED /m);
});

test('CLI build / new / fix-ids 与参数错误', () => {
  const out = tempDir('bank-cli-');
  const prev = join(SAMPLE_DIST, 'latest.json');
  const dir = copySampleBank();
  makeV2(dir);
  const r = run(['build', '--bank', dir, '--out', out, '--previous', prev, '--published-at', PUBLISHED_AT]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(out, 'bundle-2.1.0.json')));
  const bad = run(['build', '--bank', SAMPLE_BANK, '--out', tempDir(), '--previous', prev]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /bank\.yaml:\d+: VERSION_NOT_INCREASED /);
  // 发版必须二选一：--previous 或显式 --first-release
  assert.equal(run(['build', '--bank', SAMPLE_BANK, '--out', tempDir()]).status, 2);
  assert.equal(run(['build', '--bank', SAMPLE_BANK, '--out', tempDir(), '--previous', prev, '--first-release']).status, 2);
  const first = run(['build', '--bank', SAMPLE_BANK, '--out', tempDir(), '--first-release']);
  assert.equal(first.status, 0, first.stderr);
  // 日常 validate 对比上一版：版本没升也通过
  assert.equal(run(['validate', '--bank', SAMPLE_BANK, '--previous', prev]).status, 0);

  const created = run(['new', '--bank', dir, '--category', 'mysql', '--title', '新题', '--tags', 'index']);
  assert.equal(created.status, 0, created.stderr);
  const id = created.stdout.split('\n')[0].trim();
  assert.match(id, rules.QUESTION_ID_PATTERN);
  const fixed = run(['fix-ids', '--bank', dir]);
  assert.equal(fixed.status, 0, fixed.stderr);
  assert.match(fixed.stdout, /fix-ids：1 个文件已更新/);
  assert.equal(run(['validate', '--bank', dir]).status, 0);

  assert.equal(run([]).status, 2);
  assert.equal(run(['validate']).status, 2);
  assert.equal(run(['nope', '--bank', dir]).status, 2);
  assert.equal(run(['validate', '--bank', dir, '--unknown']).status, 2);
});

test('package.json 提供 bank 脚本', () => {
  const pkg = JSON.parse(readFileSync(join(REPO_DIR, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.bank, /packages\/bank-spec\/cli\.mjs/);
  execFileSync(process.execPath, [CLI, '--help']);
});
