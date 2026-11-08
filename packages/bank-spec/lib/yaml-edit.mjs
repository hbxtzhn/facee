// 按节点范围就地改写 YAML 文本：只替换受影响的节点，其余字节（注释、引号、空行、换行符）原样保留。
// yaml 库的 Document.toString() 会改写引号与格式，不能用于回写作者文件。

import { parseDocument, isMap, isSeq, isScalar } from 'yaml';

/** 解析为可定位的文档；有语法错误时抛出 */
export function parseEditable(text) {
  const doc = parseDocument(text, { version: '1.2', keepSourceTokens: false });
  if (doc.errors.length) throw new Error(`YAML 语法错误：${doc.errors[0].message.split('\n')[0]}`);
  return doc;
}

/** 映射里 key 对应的 Pair（只查一层） */
export function findPair(map, key) {
  if (!isMap(map)) return null;
  return map.items.find((p) => isScalar(p.key) && p.key.value === key) ?? null;
}

export function getIn(doc, path) {
  let node = doc.contents;
  for (const key of path) {
    const pair = findPair(node, key);
    if (!pair) return null;
    node = pair.value;
  }
  return node;
}

/** 一条编辑：把 text[start, end) 换成 insert */
const edit = (start, end, insert) => ({ start, end, insert });

/** 依次应用编辑（按起点倒序，互不重叠） */
export function applyEdits(text, edits) {
  const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].end > sorted[i - 1].start) throw new Error('内部错误：YAML 编辑区间重叠');
  }
  let out = text;
  for (const e of sorted) out = out.slice(0, e.start) + e.insert + out.slice(e.end);
  return out;
}

function lineStart(text, pos) {
  const i = text.lastIndexOf('\n', pos - 1);
  return i + 1;
}

/** pos 所在行末尾之后（含换行符）的位置 */
function lineEndInclusive(text, pos) {
  const i = text.indexOf('\n', pos);
  return i === -1 ? text.length : i + 1;
}

/** 渲染题目 id / slug 这类纯字符串：都是 [A-Za-z0-9_-]，无需引号 */
function plain(v) {
  if (!/^[A-Za-z0-9_.-]+$/.test(v)) throw new Error(`内部错误：值「${v}」需要引号`);
  return v;
}

/**
 * 把序列节点改成 next（字符串数组）。
 * - 流式 `[a, b]`：整体重写；
 * - 块式：保留未变的条目（含行尾注释），值变化的条目只替换标量，删除的条目删整行，新增条目追加到末尾。
 * `mapping(oldValue) → newValue | null`（null 表示删除）决定已有条目；`append` 为末尾追加的值。
 */
export function editSeq(text, node, { mapping = (v) => v, append = [] } = {}, eol = '\n') {
  if (!isSeq(node)) throw new Error('内部错误：不是序列节点');
  const values = node.items.map((it) => (isScalar(it) ? String(it.value) : null));
  if (values.some((v) => v === null)) throw new Error('序列中有非字符串条目，无法自动改写');
  const next = [];
  const ops = node.items.map((it, i) => {
    const v = mapping(values[i]);
    if (v === null || next.includes(v)) return { it, op: 'delete' };
    next.push(v);
    return { it, op: v === values[i] ? 'keep' : 'replace', value: v };
  });
  const appended = append.filter((v) => !next.includes(v));
  next.push(...appended);
  if (next.length === values.length && ops.every((o) => o.op === 'keep')) return { edits: [], next };

  if (node.flow || node.items.length === 0) {
    return { edits: [edit(node.range[0], node.range[1], `[${next.map(plain).join(', ')}]`)], next };
  }
  if (next.length === 0) {
    // 块式序列删空：整段换成同缩进的 `[]`，避免留下值为 null 的键
    const first = node.items[0];
    const start = lineStart(text, first.range[0]);
    const indent = text.slice(start, first.range[0]).replace(/-\s*$/, '');
    const end = lineEndInclusive(text, node.items[node.items.length - 1].range[1]);
    return { edits: [edit(start, end, `${indent}[]${eol}`)], next };
  }
  const edits = [];
  for (const o of ops) {
    if (o.op === 'replace') edits.push(edit(o.it.range[0], o.it.range[1], plain(o.value)));
    if (o.op === 'delete') edits.push(edit(lineStart(text, o.it.range[0]), lineEndInclusive(text, o.it.range[1]), ''));
  }
  if (appended.length) {
    const last = node.items[node.items.length - 1];
    const start = lineStart(text, last.range[0]);
    const prefix = text.slice(start, last.range[0]); // 如 `    - `
    const at = lineEndInclusive(text, last.range[1]);
    const needEol = at === text.length && !text.endsWith('\n') ? eol : '';
    edits.push(edit(at, at, needEol + appended.map((v) => `${prefix}${plain(v)}${eol}`).join('')));
  }
  return { edits, next };
}

/**
 * 改写字符串 → 字符串映射：`mapping(key, value) → value`，`add` 为新增键值。
 * 流式 `{ a: b }`：整体重写；块式：只替换值标量，新增键追加到末尾。
 */
export function editStringMap(text, node, { mapping = (_k, v) => v, add = {} } = {}, eol = '\n') {
  if (!isMap(node)) throw new Error('内部错误：不是映射节点');
  const entries = node.items.map((p) => [String(p.key?.value), isScalar(p.value) ? String(p.value.value) : null]);
  if (entries.some(([, v]) => v === null)) throw new Error('映射中有非字符串值，无法自动改写');
  const next = Object.fromEntries(entries.map(([k, v]) => [k, mapping(k, v)]));
  const added = Object.entries(add).filter(([k]) => !(k in next));
  for (const [k, v] of added) next[k] = v;
  const changed = entries.filter(([k, v]) => next[k] !== v);
  if (!changed.length && !added.length) return { edits: [], next };

  if (node.flow || node.items.length === 0) {
    const body = Object.entries(next).map(([k, v]) => `${plain(k)}: ${plain(v)}`).join(', ');
    return { edits: [edit(node.range[0], node.range[1], body ? `{ ${body} }` : '{}')], next };
  }
  const edits = [];
  for (const p of node.items) {
    const k = String(p.key.value);
    if (next[k] !== String(p.value.value)) edits.push(edit(p.value.range[0], p.value.range[1], plain(next[k])));
  }
  if (added.length) {
    const last = node.items[node.items.length - 1];
    const start = lineStart(text, last.key.range[0]);
    const prefix = text.slice(start, last.key.range[0]);
    const at = lineEndInclusive(text, last.value.range[1]);
    const needEol = at === text.length && !text.endsWith('\n') ? eol : '';
    edits.push(edit(at, at, needEol + added.map(([k, v]) => `${prefix}${plain(k)}: ${plain(v)}${eol}`).join('')));
  }
  return { edits, next };
}
