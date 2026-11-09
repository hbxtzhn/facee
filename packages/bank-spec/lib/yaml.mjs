// YAML 读取：返回普通 JS 值 + 「路径 → 行号」查询，用于输出 file:line 诊断。

import { LineCounter, parseDocument, isNode } from 'yaml';

/**
 * @param {string} text
 * @param {number} [lineOffset] 文本在原文件中的起始行偏移（front matter 从第 2 行开始时为 1）
 */
export function readYaml(text, lineOffset = 0) {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, uniqueKeys: true, prettyErrors: false, version: '1.2' });
  const errors = doc.errors.map((e) => ({
    line: (e.linePos?.[0]?.line ?? 1) + lineOffset,
    message: e.message.split('\n')[0],
  }));
  let value = null;
  if (errors.length === 0) {
    try {
      value = doc.toJS({ maxAliasCount: 0 });
    } catch (err) {
      errors.push({ line: 1 + lineOffset, message: String(err.message ?? err) });
    }
  }

  /** 找到路径对应节点所在行；找不到时逐级退回父节点，最终退回第 1 行 */
  function lineOf(path = []) {
    for (let n = path.length; n >= 0; n--) {
      const sub = path.slice(0, n);
      let node = null;
      if (sub.length === 0) node = doc.contents;
      else if (doc.contents && typeof doc.getIn === 'function') {
        try {
          node = doc.getIn(sub, true);
          // 映射里的标量值：优先定位到键所在行
          if (node && !isNode(node)) node = null;
        } catch {
          node = null;
        }
      }
      const pair = findPair(doc.contents, sub);
      const range = pair?.key?.range ?? node?.range;
      if (range) return lineCounter.linePos(range[0]).line + lineOffset;
    }
    return 1 + lineOffset;
  }

  return { value, errors, lineOf };
}

function findPair(contents, path) {
  if (!path.length || !contents) return null;
  let node = contents;
  let pair = null;
  for (const seg of path) {
    if (!node) return null;
    if (Array.isArray(node.items) && typeof seg === 'number') {
      const item = node.items[seg];
      pair = null;
      node = item;
      if (item?.range) pair = { key: item };
      continue;
    }
    if (!Array.isArray(node.items)) return null;
    pair = node.items.find((p) => p?.key && (p.key.value ?? p.key.source) === seg) ?? null;
    if (!pair) return null;
    node = pair.value;
  }
  return pair;
}
