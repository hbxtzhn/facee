// 题目文件解析（docs/题库规范-v2-草案.md §2.1）：YAML front matter + 固定 `##` 分段。
//
// 只做「语法」层面的解析与诊断（分段名 / 顺序 / 行格式）；取值约束由 compile.mjs 负责。
// 所有行号均为 1 起算的源文件行号。

import { readYaml } from './yaml.mjs';
import { scanFences } from './markdown.mjs';

/** 分段：标题 → 字段 key；数组顺序即规定顺序 */
export const SECTIONS = [
  { title: '题目', key: 'prompt' },
  { title: '一句话', key: 'summary', required: true },
  { title: '要点', key: 'keyPoints', required: true },
  { title: '详解', key: 'detail' },
  { title: '示例', key: 'examples' },
  { title: '易错点', key: 'pitfalls' },
  { title: '追问', key: 'followups' },
  { title: '选项', key: 'choice' },
];
const SECTION_INDEX = new Map(SECTIONS.map((s, i) => [s.title, i]));

const H1_RE = /^#(?:\s|$)/;
const H2_RE = /^##(?!#)(?:\s+(.*?))?\s*#*\s*$/;
const H3_RE = /^###(?!#)(?:\s+(.*?))?\s*$/;
const LIST_RE = /^[-*+]\s+(.*)$/;
// `[kp1]`、`[kp1|2]`、`[|2]`、`[]`（id 留空待 fix-ids 补号）
const ID_BRACKET_RE = /^\[\s*([A-Za-z0-9_-]*)\s*(?:\|\s*([^\]]*?)\s*)?\]\s*(.*)$/;
const CORRECT_MARK_RE = /\s*[✓✔]\s*$/;

/**
 * @typedef {{ line: number, code: string, message: string, severity?: 'error'|'warning' }} Diag
 * @typedef {{ text: string, line: number }} MdField  Markdown 文本及其首行行号
 */

/**
 * @param {string} source 文件全文
 */
export function parseQuestionFile(source) {
  const text = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  /** @type {Diag[]} */
  const diags = [];
  const err = (line, code, message) => diags.push({ line, code, message, severity: 'error' });

  const result = {
    lines,
    frontMatter: null,
    fmLines: { start: 0, end: 0 },
    lineOfFm: () => 1,
    sections: [],
    prompt: null,
    summary: null,
    keyPoints: null,
    detail: null,
    examples: null,
    pitfalls: null,
    followups: null,
    choice: null,
    diags,
  };

  // ---- front matter ----
  if (lines[0] !== '---') {
    err(1, 'FM_MISSING', '文件必须以 `---` 开头的 YAML front matter 起始');
    return result;
  }
  let fmEnd = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---' || lines[i] === '...') {
      fmEnd = i;
      break;
    }
  }
  if (fmEnd < 0) {
    err(1, 'FM_MISSING', 'front matter 缺少结束行 `---`');
    return result;
  }
  result.fmLines = { start: 1, end: fmEnd + 1 };
  const fmText = lines.slice(1, fmEnd).join('\n');
  const yaml = readYaml(fmText, 1);
  for (const e of yaml.errors) err(e.line, 'FM_YAML', `front matter 不是合法 YAML：${e.message}`);
  if (yaml.errors.length === 0) {
    if (yaml.value === null || typeof yaml.value !== 'object' || Array.isArray(yaml.value)) {
      err(2, 'FM_YAML', 'front matter 必须是 YAML 映射');
    } else {
      result.frontMatter = yaml.value;
    }
  }
  result.lineOfFm = yaml.lineOf;

  // ---- body：按 `##` 切分（忽略代码块内的 `#`）----
  const bodyStart = fmEnd + 1;
  const body = lines.slice(bodyStart);
  const { inFence, blocks } = scanFences(body);
  for (const b of blocks) {
    if (!b.closed) err(bodyStart + b.start + 1, 'CODE_UNCLOSED', '代码块没有闭合');
  }

  /** @type {{title: string, line: number, from: number, to: number}[]} */
  const raw = [];
  for (let i = 0; i < body.length; i++) {
    if (inFence[i]) continue;
    const line = body[i];
    const lineNo = bodyStart + i + 1;
    if (H1_RE.test(line)) {
      err(lineNo, 'H1_FORBIDDEN', '不允许一级标题；题目标题写在 front matter `title`');
      continue;
    }
    const m = H2_RE.exec(line);
    if (m) {
      raw.push({ title: (m[1] ?? '').trim(), line: lineNo, from: i + 1, to: body.length });
      if (raw.length > 1) raw[raw.length - 2].to = i;
      continue;
    }
    if (raw.length === 0 && line.trim() !== '') {
      err(lineNo, 'TEXT_OUTSIDE_SECTION', '正文必须位于 `##` 分段之内');
    }
  }

  let lastIndex = -1;
  const seen = new Set();
  for (const s of raw) {
    const idx = SECTION_INDEX.get(s.title);
    if (idx === undefined) {
      err(s.line, 'SECTION_UNKNOWN', `未知分段「${s.title}」；只允许：${SECTIONS.map((x) => x.title).join('、')}`);
      continue;
    }
    if (seen.has(s.title)) {
      err(s.line, 'SECTION_DUPLICATE', `分段「${s.title}」重复`);
      continue;
    }
    if (idx < lastIndex) {
      err(s.line, 'SECTION_ORDER', `分段「${s.title}」顺序错误；规定顺序：${SECTIONS.map((x) => x.title).join(' → ')}`);
    }
    seen.add(s.title);
    lastIndex = Math.max(lastIndex, idx);
    const sec = SECTIONS[idx];
    const segLines = body.slice(s.from, s.to);
    const segFence = inFence.slice(s.from, s.to);
    const firstLine = bodyStart + s.from + 1;
    result.sections.push({ title: s.title, key: sec.key, line: s.line });
    parseSection(result, sec.key, segLines, segFence, firstLine, s.line, err);
  }

  return result;
}

/** 去掉首尾空行，返回 { text, line } 或 null */
export function trimBlock(segLines, firstLine) {
  let a = 0;
  let b = segLines.length;
  while (a < b && segLines[a].trim() === '') a++;
  while (b > a && segLines[b - 1].trim() === '') b--;
  if (a === b) return null;
  return { text: segLines.slice(a, b).map((l) => l.replace(/\s+$/, '')).join('\n'), line: firstLine + a };
}

function parseSection(result, key, segLines, segFence, firstLine, headLine, err) {
  switch (key) {
    case 'prompt':
    case 'detail':
    case 'examples':
      result[key] = trimBlock(segLines, firstLine) ?? { text: '', line: headLine };
      return;
    case 'summary': {
      const block = trimBlock(segLines, firstLine);
      // 一句话是纯文本：多行合并为一行
      result.summary = block
        ? { text: block.text.split('\n').map((l) => l.trim()).join(''), line: block.line }
        : { text: '', line: headLine };
      return;
    }
    case 'keyPoints': {
      const items = [];
      segLines.forEach((line, i) => {
        const lineNo = firstLine + i;
        if (line.trim() === '') return;
        const m = segFence[i] ? null : LIST_RE.exec(line);
        if (!m) {
          err(lineNo, 'KEYPOINT_SYNTAX', '要点必须是单行列表项：`- [kpN|权重] 文字`');
          return;
        }
        items.push({ ...parseIdBracket(m[1]), line: lineNo });
      });
      result.keyPoints = { items, line: headLine };
      return;
    }
    case 'pitfalls': {
      const items = [];
      segLines.forEach((line, i) => {
        const lineNo = firstLine + i;
        if (line.trim() === '') return;
        const m = segFence[i] ? null : LIST_RE.exec(line);
        if (!m) {
          err(lineNo, 'PITFALL_SYNTAX', '易错点必须是单行无序列表项：`- 文字`');
          return;
        }
        items.push({ text: m[1].trim(), line: lineNo });
      });
      result.pitfalls = { items, line: headLine };
      return;
    }
    case 'followups': {
      const items = [];
      let cur = null;
      const flush = (end) => {
        if (!cur) return;
        const block = trimBlock(segLines.slice(cur.from, end), firstLine + cur.from);
        cur.a = block ?? { text: '', line: cur.line };
        delete cur.from;
        items.push(cur);
        cur = null;
      };
      segLines.forEach((line, i) => {
        const lineNo = firstLine + i;
        const m = segFence[i] ? null : H3_RE.exec(line);
        if (m) {
          flush(i);
          const head = parseIdBracket((m[1] ?? '').trim());
          cur = { id: head.id, q: head.text, hasBracket: head.hasBracket, line: lineNo, from: i + 1 };
          return;
        }
        if (!cur && line.trim() !== '') {
          err(lineNo, 'FOLLOWUP_SYNTAX', '追问必须以 `### [fN] 问题` 开头，答案写在其后');
        }
      });
      flush(segLines.length);
      result.followups = { items, line: headLine };
      return;
    }
    case 'choice': {
      const options = [];
      segLines.forEach((line, i) => {
        const lineNo = firstLine + i;
        if (line.trim() === '') return;
        const m = segFence[i] ? null : LIST_RE.exec(line);
        const b = m && /^\[\s*([^\]]*?)\s*\]\s*(.*)$/.exec(m[1]);
        if (!b) {
          err(lineNo, 'CHOICE_SYNTAX', '选项必须是 `- [a] 文字`，正确项末尾加 ✓');
          return;
        }
        const correct = CORRECT_MARK_RE.test(b[2]);
        options.push({ id: b[1], text: b[2].replace(CORRECT_MARK_RE, '').trim(), correct, line: lineNo });
      });
      result.choice = { options, line: headLine };
      return;
    }
    default:
      throw new Error(`unreachable section key ${key}`);
  }
}

/**
 * 解析 `[id|权重] 文字`；没有方括号时 id 为 null（待补号）。
 * 方括号后紧跟 `(` 视为 Markdown 链接，不当作 id。
 */
export function parseIdBracket(s) {
  const m = ID_BRACKET_RE.exec(s);
  if (!m || m[3].startsWith('(')) return { id: null, weight: null, text: s.trim(), hasBracket: false };
  return {
    id: m[1] === '' ? null : m[1],
    weight: m[2] === undefined || m[2] === '' ? null : m[2],
    text: m[3].trim(),
    hasBracket: true,
  };
}
