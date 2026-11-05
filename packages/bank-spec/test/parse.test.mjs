import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuestionFile, parseIdBracket } from '../lib/parse.mjs';
import { scanFences, findHtml, findImages, charCount } from '../lib/markdown.mjs';
import { questionMd } from './helpers.mjs';

const codes = (p) => p.diags.map((d) => d.code);

test('front matter 与分段按规定解析，行号为源文件行号', () => {
  const src = questionMd({
    body: `## 题目
给定场景。

## 一句话
第一句。第二句。

## 要点
- [kp1|2] 甲
- [kp2] 乙
- 丙

## 详解
### 小标题
正文

## 示例
\`\`\`java
int a = 1;
\`\`\`

## 易错点
- 坑一
- 坑二

## 追问
### [f1] 问一？
答一

第二段。

### 问二？
答二
`,
  });
  const p = parseQuestionFile(src);
  assert.deepEqual(p.diags, []);
  assert.equal(p.frontMatter.title, '缓存是什么？');
  assert.deepEqual(p.sections.map((s) => s.title), ['题目', '一句话', '要点', '详解', '示例', '易错点', '追问']);
  assert.equal(p.prompt.text, '给定场景。');
  assert.equal(p.prompt.line, 11);
  assert.equal(p.summary.text, '第一句。第二句。');
  assert.deepEqual(
    p.keyPoints.items.map(({ id, weight, text }) => ({ id, weight, text })),
    [
      { id: 'kp1', weight: '2', text: '甲' },
      { id: 'kp2', weight: null, text: '乙' },
      { id: null, weight: null, text: '丙' },
    ],
  );
  assert.equal(p.detail.text, '### 小标题\n正文');
  assert.equal(p.examples.text, '```java\nint a = 1;\n```');
  assert.deepEqual(p.pitfalls.items.map((i) => i.text), ['坑一', '坑二']);
  assert.equal(p.followups.items.length, 2);
  assert.deepEqual(
    { id: p.followups.items[0].id, q: p.followups.items[0].q, a: p.followups.items[0].a.text },
    { id: 'f1', q: '问一？', a: '答一\n\n第二段。' },
  );
  assert.equal(p.followups.items[1].id, null);
  assert.equal(p.followups.items[1].q, '问二？');
  // 「- 丙」所在行
  assert.equal(src.split('\n')[p.keyPoints.items[2].line - 1], '- 丙');
});

test('代码块内的 ## / ### / # 不切分分段', () => {
  const p = parseQuestionFile(
    questionMd({
      body: `## 一句话
一句话。

## 要点
- [kp1] a
- [kp2] b
- [kp3] c

## 示例
\`\`\`bash
## 这不是分段
# 也不是一级标题
\`\`\`

~~~~python
## still code
~~~~

## 追问
### [f1] 问？
\`\`\`text
### 不是新追问
\`\`\`
`,
    }),
  );
  assert.deepEqual(codes(p), []);
  assert.deepEqual(p.sections.map((s) => s.title), ['一句话', '要点', '示例', '追问']);
  assert.match(p.examples.text, /## 这不是分段/);
  assert.match(p.examples.text, /~~~~python\n## still code\n~~~~/);
  assert.equal(p.followups.items.length, 1);
  assert.match(p.followups.items[0].a.text, /### 不是新追问/);
});

test('未知分段、重复、顺序错误、一级标题、分段外文字', () => {
  const p = parseQuestionFile(
    questionMd({
      body: `游离文字
# 一级标题
## 要点
- [kp1] a
## 一句话
x
## 要点
## 答案
`,
    }),
  );
  assert.deepEqual(codes(p).sort(), ['H1_FORBIDDEN', 'SECTION_DUPLICATE', 'SECTION_ORDER', 'SECTION_UNKNOWN', 'TEXT_OUTSIDE_SECTION'].sort());
});

test('未闭合的代码块', () => {
  const p = parseQuestionFile(questionMd({ body: '## 一句话\nx\n\n## 示例\n```js\nlet a\n' }));
  assert.ok(codes(p).includes('CODE_UNCLOSED'));
});

test('front matter 缺失 / 未结束 / YAML 错误', () => {
  assert.deepEqual(codes(parseQuestionFile('## 一句话\nx\n')), ['FM_MISSING']);
  assert.deepEqual(codes(parseQuestionFile('---\ntitle: x\n')), ['FM_MISSING']);
  const bad = parseQuestionFile('---\ntitle: [unclosed\n---\n');
  assert.equal(bad.diags[0].code, 'FM_YAML');
  assert.equal(bad.frontMatter, null);
});

test('CRLF 与 BOM 被规范化', () => {
  const src = `﻿${questionMd()}`.replace(/\n/g, '\r\n');
  const p = parseQuestionFile(src);
  assert.deepEqual(p.diags, []);
  assert.equal(p.keyPoints.items.length, 3);
});

test('要点 / 易错点 / 选项的行格式错误', () => {
  const p = parseQuestionFile(
    questionMd({
      fm: { type: 'choice' },
      body: `## 一句话
x

## 要点
- [kp1] a
不是列表

## 易错点
1. 有序列表不行

## 追问
前置文字
### [f1] 问？
答

## 选项
- [a] 甲 ✓
- [b] 乙
- 丙没有方括号
`,
    }),
  );
  assert.deepEqual(codes(p).sort(), ['CHOICE_SYNTAX', 'FOLLOWUP_SYNTAX', 'KEYPOINT_SYNTAX', 'PITFALL_SYNTAX']);
  assert.deepEqual(p.choice.options.map((o) => [o.id, o.text, o.correct]), [
    ['a', '甲', true],
    ['b', '乙', false],
  ]);
});

test('parseIdBracket：id / 权重 / 留空 / 链接', () => {
  assert.deepEqual(parseIdBracket('[kp3|2] 文字'), { id: 'kp3', weight: '2', text: '文字', hasBracket: true });
  assert.deepEqual(parseIdBracket('[|3] 文字'), { id: null, weight: '3', text: '文字', hasBracket: true });
  assert.deepEqual(parseIdBracket('[] 文字'), { id: null, weight: null, text: '文字', hasBracket: true });
  assert.deepEqual(parseIdBracket('普通文字'), { id: null, weight: null, text: '普通文字', hasBracket: false });
  assert.equal(parseIdBracket('[链接](https://x.y) 说明').hasBracket, false);
});

test('Markdown 工具：代码块、HTML、图片、字数', () => {
  const { blocks } = scanFences(['```', 'a', '```', '````js', '```', '````']);
  assert.deepEqual(blocks.map((b) => [b.lang, b.lines, b.closed]), [['', 1, true], ['js', 1, true]]);
  assert.equal(findHtml('a <br> b'), '<br>');
  assert.equal(findHtml('<div class="x">'), '<div class="x">');
  assert.equal(findHtml('<!-- c -->'), '<!--');
  assert.equal(findHtml('a < b > c'), null);
  assert.equal(findHtml('见 <https://example.com>'), null);
  assert.equal(findHtml('`<div>` 在行内代码中'), null);
  assert.deepEqual(findImages('![图](./a.png "t") 与 `![x](b.png)`').map((i) => [i.alt, i.target]), [['图', './a.png']]);
  assert.equal(charCount('中文'), 2);
  assert.equal(charCount('abcd'), 2);
  assert.equal(charCount('abc'), 2);
  assert.equal(charCount('中a'), 2);
});
