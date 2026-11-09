// 规范化 JSON 与内容哈希（docs/题库规范-v2-草案.md §3.2 contentHash）。
//
// 规范化规则：
// - 对象键按 UTF-16 码元升序排列（即 JS 默认字符串排序，与 RFC 8785 JCS 一致）；
// - 值为 undefined 的键省略（与 JSON.stringify 一致）；数组保持原顺序；
// - 字符串、数字、布尔、null 按 JSON.stringify 输出；不含任何空白；
// - 结果按 UTF-8 编码后取 SHA-256，小写十六进制。
// 题目中仅出现字符串、整数、null，因此本实现与 JCS 输出逐字节一致。

import { createHash } from 'node:crypto';

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError('canonicalJson: non-finite number');
    }
    if (!['string', 'number', 'boolean'].includes(typeof value) && value !== null) {
      throw new TypeError(`canonicalJson: unsupported ${typeof value}`);
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`;
  }
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * 参与 contentHash 的字段：只有题目与答案内容（规范 §3.2）。
 * 题型、难度、重要度、分类、标签、关系、出处、参考资料、复核日期等元数据变化不改变 contentHash，
 * 因此不会让 App 把题标为「内容已更新」。与 src/bank/hash.ts 的 CONTENT_HASH_FIELDS 必须一致。
 */
export const CONTENT_HASH_FIELDS = ['title', 'prompt', 'answer', 'choice', 'followups'];

/** 只取参与 contentHash 的字段 */
export function contentHashInput(question) {
  const out = {};
  for (const k of CONTENT_HASH_FIELDS) if (question[k] !== undefined) out[k] = question[k];
  return out;
}

/** `sha256:` + 题目内容字段（CONTENT_HASH_FIELDS）的规范化 JSON 摘要 */
export function questionContentHash(question) {
  return `sha256:${sha256Hex(Buffer.from(canonicalJson(contentHashInput(question)), 'utf8'))}`;
}
