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

/** `sha256:` + 题目对象（去掉 contentHash 字段）的规范化 JSON 摘要 */
export function questionContentHash(question) {
  const { contentHash: _ignored, ...rest } = question;
  return `sha256:${sha256Hex(Buffer.from(canonicalJson(rest), 'utf8'))}`;
}
