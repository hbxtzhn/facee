// 每条校验规则一个失败夹具：在最小合法题库上做一处改动，断言出现对应错误码。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileBank } from '../lib/compile.mjs';
import { Raster, encodePng } from '../lib/png.mjs';
import { BANK_YAML, DEFAULT_BODY, QID, questionMd, writeBank } from './helpers.mjs';

const PNG = encodePng(new Raster(4, 4));
const body = (extra) => `${DEFAULT_BODY}\n${extra}`;
const withSection = (title, text) => body(`## ${title}\n${text}\n`);
const bankYaml = (replace) => replace.reduce((s, [a, b]) => {
  assert.ok(s.includes(a), `BANK_YAML 不含 ${a}`);
  return s.replace(a, b);
}, BANK_YAML);
const qa = (opts) => ({ 'questions/redis/a.md': questionMd({ id: QID.a, ...opts }) });
const prevManifest = (over = {}) => ({
  bankId: 'github.com/example/test-bank',
  schemaVersion: 2,
  version: '0.9.0',
  questions: { [QID.a]: 'sha256:x', [QID.b]: 'sha256:y' },
  ...over,
});

test('最小合法题库：0 诊断', () => {
  const res = compileBank(writeBank());
  assert.deepEqual(res.diagnostics, []);
  assert.equal(res.bundle.questions.length, 2);
});

/** [规则说明, 文件覆盖, 期望错误码, compile 选项] */
const ERROR_CASES = [
  // ---- front matter ----
  ['缺少 front matter', { 'questions/redis/a.md': DEFAULT_BODY }, 'FM_MISSING'],
  ['front matter YAML 语法错误', qa({ fm: { tags: '[cache' } }), 'FM_YAML'],
  ['未知 front matter 字段', qa({ fm: { level: 'easy' } }), 'FM_UNKNOWN_KEY'],
  ['缺少 title', qa({ fm: { title: null } }), 'FM_REQUIRED'],
  ['缺少题目 id', qa({ fm: { id: null } }), 'FM_REQUIRED'],
  ['type 取值非法', qa({ fm: { type: 'essay' } }), 'FM_INVALID'],
  ['difficulty 取值非法', qa({ fm: { difficulty: 'expert' } }), 'FM_INVALID'],
  ['importance 超范围', qa({ fm: { importance: 5 } }), 'FM_INVALID'],
  ['reviewedAt 不是合法日期', qa({ fm: { reviewedAt: '2026-02-30' } }), 'FM_INVALID'],
  ['estimatedMinutes 非正整数', qa({ fm: { estimatedMinutes: 0 } }), 'FM_INVALID'],
  ['references url 非 http(s)', qa({ fm: { references: '[{ title: a, url: "ftp://x" }]' } }), 'FM_INVALID'],
  ['source 缺 name', qa({ fm: { source: '{ license: MIT }' } }), 'FM_INVALID'],
  ['tags 不是字符串数组', qa({ fm: { tags: 'cache' } }), 'FM_INVALID'],
  ['缺少 tags', qa({ fm: { tags: null } }), 'TAG_COUNT'],
  ['tags 为空', qa({ fm: { tags: '[]' } }), 'TAG_COUNT'],
  ['tags 超过 3 个', { 'bank.yaml': bankYaml([['  - { id: cache, name: 缓存, parent: storage }', '  - { id: cache, name: 缓存, parent: storage }\n  - { id: a1, name: A1 }\n  - { id: a2, name: A2 }']]), ...qa({ fm: { tags: '[storage, cache, a1, a2]' } }) }, 'TAG_COUNT'],
  ['tags 重复', qa({ fm: { tags: '[cache, cache]' } }), 'ID_DUPLICATE'],
  // ---- id ----
  ['题目 id 格式非法', qa({ id: 'q_123' }), 'ID_INVALID'],
  ['题目 id 含非 Crockford 字符', qa({ id: 'q_01J0000000000000000000000I' }), 'ID_INVALID'],
  ['题目 id 跨文件重复', { 'questions/redis/b.md': questionMd({ id: QID.a }) }, 'ID_DUPLICATE'],
  ['要点 id 格式非法', qa({ body: DEFAULT_BODY.replace('[kp2]', '[k2]') }), 'ID_INVALID'],
  ['要点 id 重复', qa({ body: DEFAULT_BODY.replace('[kp2]', '[kp1]') }), 'ID_DUPLICATE'],
  ['要点缺少 id', qa({ body: DEFAULT_BODY.replace('[kp2] ', '') }), 'KEYPOINT_ID_MISSING'],
  ['复用 retired 中的 id', qa({ fm: { retired: '[kp3]' } }), 'ID_REUSED'],
  ['编号空洞未登记 retired', qa({ body: DEFAULT_BODY.replace('[kp3]', '[kp4]') }), 'ID_GAP'],
  ['retired 内容非法', qa({ fm: { retired: '[x1]' } }), 'ID_INVALID'],
  ['追问缺少 id', qa({ body: withSection('追问', '### 问？\n答。') }), 'FOLLOWUP_ID_MISSING'],
  ['追问 id 格式非法', qa({ body: withSection('追问', '### [q1] 问？\n答。') }), 'ID_INVALID'],
  ['追问 id 重复', qa({ body: withSection('追问', '### [f1] 问？\n答。\n### [f1] 再问？\n答。') }), 'ID_DUPLICATE'],
  // ---- 分段 ----
  ['缺少一句话', qa({ body: DEFAULT_BODY.replace(/## 一句话\n.*\n/, '') }), 'SECTION_REQUIRED'],
  ['缺少要点', qa({ body: '## 一句话\nx。\n' }), 'SECTION_REQUIRED'],
  ['未知分段', qa({ body: withSection('答案', 'x') }), 'SECTION_UNKNOWN'],
  ['分段重复', qa({ body: withSection('一句话', 'x') }), 'SECTION_DUPLICATE'],
  ['分段顺序错误', qa({ body: `## 详解\nx\n\n${DEFAULT_BODY}` }), 'SECTION_ORDER'],
  ['一级标题', qa({ body: `# 标题\n${DEFAULT_BODY}` }), 'H1_FORBIDDEN'],
  ['分段外文字', qa({ body: `前言\n${DEFAULT_BODY}` }), 'TEXT_OUTSIDE_SECTION'],
  ['空分段', qa({ body: withSection('详解', '') }), 'SECTION_EMPTY'],
  ['题目重复标题', qa({ body: `## 题目\n缓存是什么？\n\n${DEFAULT_BODY}` }), 'PROMPT_REPEATS_TITLE'],
  ['一句话超过 80 字', qa({ body: DEFAULT_BODY.replace('缓存把热点数据放在更快的存储里。', '长'.repeat(81)) }), 'SUMMARY_LENGTH'],
  ['一句话超过 2 句', qa({ body: DEFAULT_BODY.replace('缓存把热点数据放在更快的存储里。', '一。二。三。') }), 'SUMMARY_SENTENCES'],
  ['要点少于 3 条', qa({ body: DEFAULT_BODY.replace('- [kp3] 需要考虑过期与淘汰\n', '') }), 'KEYPOINT_COUNT'],
  ['要点多于 5 条', qa({ body: `${DEFAULT_BODY}- [kp4] d\n- [kp5] e\n- [kp6] f\n` }), 'KEYPOINT_COUNT'],
  ['要点超过 40 字', qa({ body: DEFAULT_BODY.replace('需要考虑一致性', '字'.repeat(41)) }), 'KEYPOINT_LENGTH'],
  ['要点权重非法', qa({ body: DEFAULT_BODY.replace('[kp1|2]', '[kp1|4]') }), 'KEYPOINT_WEIGHT'],
  ['要点不是列表', qa({ body: `${DEFAULT_BODY}补充说明\n` }), 'KEYPOINT_SYNTAX'],
  ['易错点不是无序列表', qa({ body: withSection('易错点', '1. 有序') }), 'PITFALL_SYNTAX'],
  ['追问答案超过 150 字', qa({ body: withSection('追问', `### [f1] 问？\n${'答'.repeat(151)}`) }), 'FOLLOWUP_ANSWER_LENGTH'],
  ['追问没有答案', qa({ body: withSection('追问', '### [f1] 问？') }), 'FOLLOWUP_ANSWER_EMPTY'],
  ['追问前有游离文字', qa({ body: withSection('追问', '说明\n### [f1] 问？\n答。') }), 'FOLLOWUP_SYNTAX'],
  // ---- 选择题 ----
  ['choice 缺少选项分段', qa({ fm: { type: 'choice' } }), 'CHOICE_REQUIRED'],
  ['非 choice 出现选项', qa({ body: withSection('选项', '- [a] 甲 ✓\n- [b] 乙') }), 'CHOICE_UNEXPECTED'],
  ['选项没有正确项', qa({ fm: { type: 'choice' }, body: withSection('选项', '- [a] 甲\n- [b] 乙') }), 'CHOICE_NO_CORRECT'],
  ['选项少于 2 个', qa({ fm: { type: 'choice' }, body: withSection('选项', '- [a] 甲 ✓') }), 'CHOICE_SYNTAX'],
  ['选项 id 非法', qa({ fm: { type: 'choice' }, body: withSection('选项', '- [A] 甲 ✓\n- [b] 乙') }), 'CHOICE_SYNTAX'],
  ['选项 id 重复', qa({ fm: { type: 'choice' }, body: withSection('选项', '- [a] 甲 ✓\n- [a] 乙') }), 'ID_DUPLICATE'],
  // ---- Markdown 内容 ----
  ['代码块未标语言', qa({ body: withSection('示例', '```\nls\n```') }), 'CODE_LANG'],
  ['代码块超过 40 行', qa({ body: withSection('示例', `\`\`\`text\n${'x\n'.repeat(41)}\`\`\``) }), 'CODE_TOO_LONG'],
  ['代码块未闭合', qa({ body: withSection('示例', '```bash\nls') }), 'CODE_UNCLOSED'],
  ['详解里出现 HTML', qa({ body: withSection('详解', '换行<br/>测试') }), 'HTML_FORBIDDEN'],
  ['追问答案里出现 HTML', qa({ body: withSection('追问', '### [f1] 问？\n<details>展开</details>') }), 'HTML_FORBIDDEN'],
  ['纯文本字段出现 HTML', qa({ body: DEFAULT_BODY.replace('需要考虑一致性', '需要<b>一致性</b>') }), 'HTML_FORBIDDEN'],
  // ---- 资源 ----
  ['图片不存在', qa({ body: withSection('详解', '![图](./assets/none.png)') }), 'ASSET_MISSING'],
  ['图片格式不支持', { ...qa({ body: withSection('详解', '![图](assets/x.png)') }), 'questions/redis/assets/x.png': 'GIF89a......' }, 'ASSET_FORMAT'],
  [
    '图片超过 1 MB',
    { ...qa({ body: withSection('详解', '![图](assets/big.png)') }), 'questions/redis/assets/big.png': Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]) },
    'ASSET_TOO_LARGE',
  ],
  ['远程图片', qa({ body: withSection('详解', '![图](https://example.com/a.png)') }), 'ASSET_PATH'],
  ['图片越出题库目录', qa({ body: withSection('详解', '![图](../../../outside.png)') }), 'ASSET_PATH'],
  // ---- 引用 ----
  ['分类未声明', qa({ fm: { category: 'kafka' } }), 'REF_MISSING'],
  ['标签未声明', qa({ fm: { tags: '[kafka]' } }), 'REF_MISSING'],
  ['related 引用不存在', qa({ fm: { related: `[${QID.c}]` } }), 'REF_MISSING'],
  ['prerequisites 引用不存在', qa({ fm: { prerequisites: `[${QID.c}]` } }), 'REF_MISSING'],
  ['related 引用自身', qa({ fm: { related: `[${QID.a}]` } }), 'REF_SELF'],
  ['related 重复', qa({ fm: { related: `[${QID.b}, ${QID.b}]` } }), 'ID_DUPLICATE'],
  ['专题引用不存在的题', { 'bank.yaml': bankYaml([[`[${QID.a}, ${QID.b}]`, `[${QID.a}, ${QID.c}]`]]) }, 'REF_MISSING'],
  ['专题重复引用', { 'bank.yaml': bankYaml([[`[${QID.a}, ${QID.b}]`, `[${QID.a}, ${QID.a}]`]]) }, 'ID_DUPLICATE'],
  ['标签父级不存在', { 'bank.yaml': bankYaml([['parent: storage', 'parent: nope']]) }, 'REF_MISSING'],
  ['标签别名与其他标签 name 相同', { 'bank.yaml': bankYaml([['{ id: cache, name: 缓存, parent: storage }', '{ id: cache, name: 缓存, parent: storage, aliases: [存储] }']]) }, 'TAG_ALIAS_CONFLICT'],
  ['标签别名与其他标签 id 相同（忽略大小写）', { 'bank.yaml': bankYaml([['{ id: cache, name: 缓存, parent: storage }', '{ id: cache, name: 缓存, parent: storage, aliases: [Storage] }']]) }, 'TAG_ALIAS_CONFLICT'],
  ['标签别名与本标签 name 相同', { 'bank.yaml': bankYaml([['{ id: cache, name: 缓存, parent: storage }', '{ id: cache, name: 缓存, parent: storage, aliases: [缓存] }']]) }, 'TAG_ALIAS_CONFLICT'],
  [
    '标签别名跨标签重复',
    { 'bank.yaml': bankYaml([['{ id: storage, name: 存储, parent: null }', '{ id: storage, name: 存储, parent: null, aliases: [Cache Layer] }'], ['{ id: cache, name: 缓存, parent: storage }', '{ id: cache, name: 缓存, parent: storage, aliases: [cache layer] }']]) },
    'TAG_ALIAS_CONFLICT',
  ],
  ['标签别名不是非空字符串数组', { 'bank.yaml': bankYaml([['{ id: cache, name: 缓存, parent: storage }', '{ id: cache, name: 缓存, parent: storage, aliases: [] }']]) }, 'BANK_FIELD'],
  ['标签说明为空', { 'bank.yaml': bankYaml([['{ id: cache, name: 缓存, parent: storage }', '{ id: cache, name: 缓存, parent: storage, description: "" }']]) }, 'BANK_FIELD'],
  [
    'prerequisites 成环',
    {
      'questions/redis/a.md': questionMd({ id: QID.a, fm: { prerequisites: `[${QID.b}]` } }),
      'questions/redis/b.md': questionMd({ id: QID.b, fm: { prerequisites: `[${QID.a}]` } }),
    },
    'PREREQ_CYCLE',
  ],
  ['标签父子成环', { 'bank.yaml': bankYaml([['{ id: storage, name: 存储, parent: null }', '{ id: storage, name: 存储, parent: cache }']]) }, 'TAG_CYCLE'],
  // ---- bank.yaml ----
  ['bank.yaml 缺失', { 'bank.yaml': null }, 'BANK_MISSING'],
  ['bank.yaml YAML 错误', { 'bank.yaml': 'bank: [' }, 'BANK_YAML'],
  ['schemaVersion 不是 2', { 'bank.yaml': bankYaml([['schemaVersion: 2', 'schemaVersion: 1']]) }, 'BANK_SCHEMA_VERSION'],
  ['bank.id 非法', { 'bank.yaml': bankYaml([['github.com/example/test-bank', 'test-bank']]) }, 'BANK_FIELD'],
  ['bank.version 不是 SemVer', { 'bank.yaml': bankYaml([['version: 1.0.0', 'version: "1.0"']]) }, 'BANK_FIELD'],
  ['bank.yaml 未知字段', { 'bank.yaml': `${BANK_YAML}mirrors: []\n` }, 'BANK_UNKNOWN_KEY'],
  ['分类 id 非法', { 'bank.yaml': bankYaml([['{ id: mysql, name: MySQL }', '{ id: MySQL, name: MySQL }']]) }, 'ID_INVALID'],
  ['分类 id 重复', { 'bank.yaml': bankYaml([['{ id: mysql, name: MySQL }', '{ id: redis, name: MySQL }']]) }, 'ID_DUPLICATE'],
  ['release.minAppVersion 非法', { 'bank.yaml': `${BANK_YAML}release: { minAppVersion: latest }\n` }, 'BANK_FIELD'],
  ['没有题目', { 'questions/redis/a.md': null, 'questions/redis/b.md': null, 'bank.yaml': bankYaml([[`[${QID.a}, ${QID.b}]`, '[]']]) }, 'NO_QUESTIONS'],
  // ---- 生命周期 ----
  ['removed 的题仍存在', { 'bank.yaml': bankYaml([['removed: []', `removed: [${QID.b}]`]]) }, 'LIFECYCLE_CONFLICT'],
  ['同时 removed 与 merged', { 'bank.yaml': bankYaml([['removed: []', `removed: [${QID.c}]`], ['merged: {}', `merged: { ${QID.c}: ${QID.a} }`]]) }, 'LIFECYCLE_CONFLICT'],
  ['merged 目标不存在', { 'bank.yaml': bankYaml([['merged: {}', `merged: { ${QID.c}: ${QID.d} }`]]) }, 'REF_MISSING'],
  ['上一版的题消失且未声明', { 'questions/redis/b.md': null, 'bank.yaml': bankYaml([[`[${QID.a}, ${QID.b}]`, `[${QID.a}]`]]) }, 'LIFECYCLE_MISSING', { previous: prevManifest() }],
  ['发版：版本未递增', {}, 'VERSION_NOT_INCREASED', { previous: prevManifest({ version: '1.0.0' }), release: true }],
  ['发版：预发布版本低于正式版', { 'bank.yaml': bankYaml([['version: 1.0.0', 'version: 1.0.0-rc.1']]) }, 'VERSION_NOT_INCREASED', { previous: prevManifest({ version: '1.0.0' }), release: true }],
  ['bank.id 与上一版不同', {}, 'BANK_MISMATCH', { previous: prevManifest({ bankId: 'github.com/example/other' }) }],
  ['上一版清单无效', {}, 'PREVIOUS_INVALID', { previous: { bankId: 'x' } }],
];

for (const [name, files, code, opts] of ERROR_CASES) {
  test(`错误 ${code}：${name}`, () => {
    const res = compileBank(writeBank(files), opts);
    const errors = res.diagnostics.filter((d) => d.severity === 'error');
    assert.ok(
      errors.some((d) => d.code === code),
      `期望 ${code}，实际：\n${res.diagnostics.map((d) => `${d.file}:${d.line}: ${d.code} ${d.message}`).join('\n')}`,
    );
    assert.equal(res.bundle, null, '有错误时不得产出 bundle');
  });
}

const WARNING_CASES = [
  ['详解超过 1500 字', qa({ body: withSection('详解', '字'.repeat(1501)) }), 'DETAIL_LENGTH'],
  ['题目里写出处', qa({ body: `## 题目\n来源：某面经\n\n${DEFAULT_BODY}` }), 'PROMPT_SOURCE'],
  ['资源未被引用', { 'questions/redis/assets/unused.png': PNG }, 'ASSET_UNUSED'],
  ['TODO 占位', qa({ body: withSection('详解', 'TODO 补充') }), 'TODO_LEFT'],
  ['核心要点超过 2 条', qa({ body: DEFAULT_BODY.replace('[kp1|2]', '[kp1|3]').replace('[kp2]', '[kp2|3]').replace('[kp3]', '[kp3|3]') }), 'KEYPOINT_CORE_COUNT'],
  ['标签超过两层', { 'bank.yaml': bankYaml([['  - { id: cache, name: 缓存, parent: storage }', '  - { id: cache, name: 缓存, parent: storage }\n  - { id: lru, name: LRU, parent: cache }']]) }, 'TAG_DEPTH'],
];

for (const [name, files, code] of WARNING_CASES) {
  test(`警告 ${code}：${name}（不阻止构建）`, () => {
    const res = compileBank(writeBank(files));
    assert.equal(res.errorCount, 0, JSON.stringify(res.diagnostics));
    assert.ok(res.diagnostics.some((d) => d.code === code && d.severity === 'warning'));
    assert.ok(res.bundle);
  });
}

test('诊断行号指向源文件中的出错行', () => {
  const md = questionMd({ id: QID.a, fm: { category: 'kafka' }, body: DEFAULT_BODY.replace('需要考虑一致性', '字'.repeat(41)) });
  const res = compileBank(writeBank({ 'questions/redis/a.md': md }));
  const lines = md.split('\n');
  const cat = res.diagnostics.find((d) => d.code === 'REF_MISSING');
  assert.equal(cat.file, 'questions/redis/a.md');
  assert.equal(lines[cat.line - 1], 'category: kafka');
  const kp = res.diagnostics.find((d) => d.code === 'KEYPOINT_LENGTH');
  assert.match(lines[kp.line - 1], /^- \[kp2\] 字+$/);

  const yamlRes = compileBank(writeBank({ 'bank.yaml': bankYaml([['parent: storage', 'parent: nope']]) }));
  const tag = yamlRes.diagnostics.find((d) => d.code === 'REF_MISSING');
  assert.equal(tag.file, 'bank.yaml');
  assert.match(BANK_YAML.split('\n')[tag.line - 1], /id: cache/);
});

test('代码块中的 HTML / 图片 / TODO 不触发校验', () => {
  const res = compileBank(
    writeBank(qa({ body: withSection('示例', '```html\n<div>TODO</div>\n![x](./none.png)\n```') })),
  );
  assert.deepEqual(res.diagnostics, []);
});

test('日常校验（非发版）对比上一版时不要求版本递增，但仍检查生命周期与 bank.id', () => {
  const same = compileBank(writeBank(), { previous: prevManifest({ version: '1.0.0' }) });
  assert.equal(same.errorCount, 0, JSON.stringify(same.diagnostics));
  const gone = compileBank(writeBank({ 'questions/redis/b.md': null, 'bank.yaml': bankYaml([[`[${QID.a}, ${QID.b}]`, `[${QID.a}]`]]) }), {
    previous: prevManifest({ version: '1.0.0' }),
  });
  assert.ok(gone.diagnostics.some((d) => d.code === 'LIFECYCLE_MISSING'));
});

test('标签 description / aliases 进入 bundle（去首尾空白），两层标签不报 TAG_DEPTH，核心要点 2 条不报警告', () => {
  const res = compileBank(
    writeBank({
      'bank.yaml': bankYaml([['{ id: cache, name: 缓存, parent: storage }', '{ id: cache, name: 缓存, parent: storage, description: " 读多写少的加速层 ", aliases: [" 缓存层 ", 缓冲] }']]),
      ...qa({ body: DEFAULT_BODY.replace('[kp2]', '[kp2|3]').replace('[kp1|2]', '[kp1|3]') }),
    }),
  );
  assert.deepEqual(res.diagnostics, []);
  const cache = res.bundle.tags.find((t) => t.id === 'cache');
  assert.deepEqual(cache, { id: 'cache', name: '缓存', parent: 'storage', description: '读多写少的加速层', aliases: ['缓存层', '缓冲'] });
  assert.deepEqual(res.bundle.tags.find((t) => t.id === 'storage'), { id: 'storage', name: '存储', parent: null });
});

test('合法的 lifecycle 声明通过校验', () => {
  const files = {
    'questions/redis/b.md': null,
    'bank.yaml': bankYaml([[`[${QID.a}, ${QID.b}]`, `[${QID.a}]`], ['removed: []', `removed: [${QID.b}]`]]),
  };
  const res = compileBank(writeBank(files), { previous: prevManifest() });
  assert.equal(res.errorCount, 0, JSON.stringify(res.diagnostics));
  assert.deepEqual(res.bundle.lifecycle, { removed: [QID.b], merged: {} });
});
