// merge-question / remove-question：合并或删除题目时一次改完所有引用与生命周期声明（规范 §4）。
//
// merge-question --from A --into B
//   1. 所有题目的 prerequisites / related 中 A → B；已含 B 或本题就是 B 时直接删掉 A（不产生重复与自引用）；
//   2. bank.yaml 每条专题中 A → B；B 已在该专题时直接删掉 A（B 保持原位置）；
//   3. lifecycle.merged 中原本指向 A 的 X: A 改为 X: B（展开合并链），再写入 A: B；
//   4. 改写后 prerequisites 不得成环，否则不写任何文件；
//   5. 删除 A 的题目文件。内容合并（把 A 中有价值的要点 / 追问并入 B）须由作者事先手工完成。
// remove-question --id A
//   1. 所有题目的 prerequisites / related 与各专题中删除 A；专题因此变空时报错，须先手工处理该专题；
//   2. lifecycle.merged 中原本指向 A 的 X: A 改为 removed（目标已不存在）；A 写入 lifecycle.removed；
//   3. 删除 A 的题目文件。
//
// 所有改写都按 YAML 节点范围就地替换，保留文件其余内容与注释。

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BANK_FILE, isQuestionId, listBankFiles } from './compile.mjs';
import { applyEdits, editSeq, editStringMap, findPair, getIn, parseEditable } from './yaml-edit.mjs';
import { isMap, isSeq } from 'yaml';

/** 题目文件的 front matter 文本及其在文件中的偏移 */
function splitFrontMatter(src) {
  const m = /^---\r?\n/.exec(src);
  if (!m) return null;
  const re = /^(?:---|\.\.\.)\r?$/m;
  const rest = src.slice(m[0].length);
  const end = re.exec(rest);
  if (!end) return null;
  return { offset: m[0].length, text: rest.slice(0, end.index) };
}

function loadQuestions(bankDir) {
  const out = [];
  for (const file of listBankFiles(bankDir).filter((f) => f.endsWith('.md'))) {
    const src = readFileSync(join(bankDir, file), 'utf8');
    const fm = splitFrontMatter(src);
    if (!fm) throw new Error(`${file}：缺少 front matter，请先修正（bank-spec validate）`);
    let doc;
    try {
      doc = parseEditable(fm.text);
    } catch (err) {
      throw new Error(`${file}：${err.message}`);
    }
    const id = getIn(doc, ['id'])?.value;
    out.push({ file, src, fm, doc, id: typeof id === 'string' ? id : null, eol: src.includes('\r\n') ? '\r\n' : '\n' });
  }
  return out;
}

const REF_KEYS = ['prerequisites', 'related'];

/**
 * @param {string} bankDir
 * @param {{ from: string, into?: string|null, dryRun?: boolean }} opts  into 省略 = 删除题目
 * @returns {{ changes: string[], deleted: string, files: Map<string,string> }}
 */
export function retireQuestion(bankDir, { from, into = null, dryRun = false }) {
  const merge = into !== null && into !== undefined;
  if (!isQuestionId(from)) throw new Error(`题目 id「${from}」不合法`);
  if (merge && !isQuestionId(into)) throw new Error(`题目 id「${into}」不合法`);
  if (merge && from === into) throw new Error('--from 与 --into 不能相同');
  const bankPath = join(bankDir, BANK_FILE);
  if (!existsSync(bankPath)) throw new Error(`找不到 ${bankPath}`);

  const questions = loadQuestions(bankDir);
  const byId = new Map();
  for (const q of questions) {
    if (!q.id) continue;
    if (byId.has(q.id)) throw new Error(`题目 id ${q.id} 重复（${byId.get(q.id).file}、${q.file}），请先修正`);
    byId.set(q.id, q);
  }
  const source = byId.get(from);
  if (!source) throw new Error(`找不到题目 ${from}`);
  if (merge && !byId.has(into)) throw new Error(`找不到合并目标 ${into}`);

  const changes = [];
  const files = new Map(); // 相对路径 → 新内容
  const prereqs = new Map(); // 改写后的 prerequisites，用于查环

  // ---- 1. 题目引用 ----
  for (const q of questions) {
    if (q === source) continue;
    const edits = [];
    for (const key of REF_KEYS) {
      const node = getIn(q.doc, [key]);
      const list = isSeq(node) ? node.items.map((it) => String(it.value)) : [];
      if (key === 'prerequisites') prereqs.set(q.id, list);
      if (!isSeq(node) || !list.includes(from)) continue;
      const mapping = (v) => (v === from ? (merge && into !== q.id && !list.includes(into) ? into : null) : v);
      const res = editSeq(q.fm.text, node, { mapping }, q.eol);
      edits.push(...res.edits);
      if (key === 'prerequisites') prereqs.set(q.id, res.next);
      changes.push(`${q.file}: ${key} ${merge ? (into === q.id ? `删除对 ${from} 的引用（即本题）` : `${from} → ${into}`) : `删除 ${from}`}`);
    }
    if (edits.length) {
      const fmText = applyEdits(q.fm.text, edits);
      files.set(q.file, q.src.slice(0, q.fm.offset) + fmText + q.src.slice(q.fm.offset + q.fm.text.length));
    }
  }

  // ---- 查环 ----
  const state = new Map();
  const visit = (id, stack) => {
    state.set(id, 1);
    stack.push(id);
    for (const next of prereqs.get(id) ?? []) {
      if (!prereqs.has(next)) continue;
      if (state.get(next) === 1) throw new Error(`改写后 prerequisites 成环：${[...stack.slice(stack.indexOf(next)), next].join(' → ')}；未写入任何文件`);
      if (!state.get(next)) visit(next, stack);
    }
    stack.pop();
    state.set(id, 2);
  };
  for (const id of [...prereqs.keys()].sort()) if (!state.get(id)) visit(id, []);

  // ---- 2. bank.yaml：专题与生命周期 ----
  const bankSrc = readFileSync(bankPath, 'utf8');
  const eol = bankSrc.includes('\r\n') ? '\r\n' : '\n';
  const bankDoc = parseEditable(bankSrc);
  const bankEdits = [];
  const collections = getIn(bankDoc, ['collections']);
  if (isSeq(collections)) {
    for (const c of collections.items) {
      const qs = findPair(c, 'questions')?.value;
      if (!isSeq(qs)) continue;
      const list = qs.items.map((it) => String(it.value));
      if (!list.includes(from)) continue;
      const name = findPair(c, 'id')?.value?.value ?? '?';
      const res = editSeq(bankSrc, qs, { mapping: (v) => (v === from ? (merge && !list.includes(into) ? into : null) : v) }, eol);
      if (res.next.length === 0) throw new Error(`专题「${name}」删除 ${from} 后为空；请先在 bank.yaml 删除或调整该专题，未写入任何文件`);
      bankEdits.push(...res.edits);
      changes.push(`${BANK_FILE}: 专题「${name}」${merge ? (list.includes(into) ? `删除 ${from}（已含 ${into}）` : `${from} → ${into}`) : `删除 ${from}`}`);
    }
  }

  const lifecycle = getIn(bankDoc, ['lifecycle']);
  const removedNode = isMap(lifecycle) ? findPair(lifecycle, 'removed')?.value : null;
  const mergedNode = isMap(lifecycle) ? findPair(lifecycle, 'merged')?.value : null;
  if (!isSeq(removedNode) || !isMap(mergedNode)) {
    throw new Error('bank.yaml 需要写出 lifecycle.removed（数组）与 lifecycle.merged（映射），如 `removed: []`、`merged: {}`；未写入任何文件');
  }
  const mergedEntries = mergedNode.items.map((p) => [String(p.key.value), String(p.value?.value)]);
  const pointing = mergedEntries.filter(([, to]) => to === from).map(([k]) => k);
  if (merge) {
    const res = editStringMap(bankSrc, mergedNode, { mapping: (_k, v) => (v === from ? into : v), add: { [from]: into } }, eol);
    bankEdits.push(...res.edits);
    for (const k of pointing) changes.push(`${BANK_FILE}: lifecycle.merged ${k}: ${from} → ${into}（展开合并链）`);
    changes.push(`${BANK_FILE}: lifecycle.merged 写入 ${from}: ${into}`);
  } else {
    // 指向被删题的合并声明改为删除：目标已不存在，学习数据归档
    if (pointing.length) {
      const remaining = mergedEntries.filter(([, to]) => to !== from);
      const body = remaining.map(([k, v]) => `${k}: ${v}`).join(', ');
      bankEdits.push({ start: mergedNode.range[0], end: mergedNode.range[1], insert: body ? `{ ${body} }` : '{}' });
      for (const k of pointing) changes.push(`${BANK_FILE}: lifecycle.merged ${k}: ${from} 改为 removed（合并目标被删除）`);
    }
    const res = editSeq(bankSrc, removedNode, { append: [...pointing, from] }, eol);
    bankEdits.push(...res.edits);
    changes.push(`${BANK_FILE}: lifecycle.removed 写入 ${from}`);
  }
  files.set(BANK_FILE, applyEdits(bankSrc, bankEdits));
  changes.push(`${source.file}: 删除`);

  if (!dryRun) {
    for (const [file, text] of files) writeFileSync(join(bankDir, file), text, 'utf8');
    rmSync(join(bankDir, source.file));
  }
  return { changes, deleted: source.file, files };
}
