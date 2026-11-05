import { createSha256 } from '../lib/sha256';
import type { Question } from './types';

/** UTF-8 编码（不依赖运行时的 TextEncoder，Hermes / Node 行为一致） */
export function utf8Encode(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i += 1;
      }
    }
    if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd; // 孤立代理项
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
  }
  return Uint8Array.from(bytes);
}

export function sha256HexOfText(text: string): string {
  const hasher = createSha256();
  hasher.update(utf8Encode(text));
  return hasher.hex();
}

/**
 * 规范化 JSON：对象键按 UTF-16 码元升序（Array.prototype.sort 默认序）、无空白；
 * 数组保持顺序；值为 undefined 的键省略（与 JSON.stringify 一致）；字符串 / 数字按 JSON.stringify 输出。
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const text = JSON.stringify(value);
    return text === undefined ? 'null' : text;
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? 'null' : canonicalJson(item))).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

/**
 * 题目 contentHash：`sha256:` + 该题去掉 contentHash 字段后的规范化 JSON 的 UTF-8 sha256 十六进制。
 * 资源以 `asset:<sha256>.<ext>` 引用出现在 Markdown 字段里，因此资源哈希已包含在内。
 */
export function computeContentHash(question: Omit<Question, 'contentHash'> | Question): string {
  const { contentHash: _ignored, ...rest } = question as Question;
  return `sha256:${sha256HexOfText(canonicalJson(rest))}`;
}

/** 题库资源目录前缀：bankId 的 sha256 前 16 位（bankId 含 `/`，不能直接当目录名） */
export function bankDirKey(bankId: string): string {
  return sha256HexOfText(bankId).slice(0, 16);
}
