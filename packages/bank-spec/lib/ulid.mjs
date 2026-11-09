// ULID（https://github.com/ulid/spec）：48 位毫秒时间戳 + 80 位密码学随机数，
// Crockford Base32 大写编码，共 26 字符。题目 id = `q_` + ULID。

import { randomBytes } from 'node:crypto';

export const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

/**
 * @param {number} [now] 毫秒时间戳（测试可注入）
 * @param {(n: number) => Uint8Array} [rand] 随机源（测试可注入）
 */
export function ulid(now = Date.now(), rand = randomBytes) {
  if (!Number.isSafeInteger(now) || now < 0 || now > 2 ** 48 - 1) {
    throw new RangeError(`ulid: bad timestamp ${now}`);
  }
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  // 80 位随机数 = 16 个 5 位组
  const bytes = rand(10);
  let bits = 0n;
  for (const b of bytes) bits = (bits << 8n) | BigInt(b);
  let random = '';
  for (let i = 0; i < 16; i++) {
    random = CROCKFORD[Number(bits & 31n)] + random;
    bits >>= 5n;
  }
  return time + random;
}

export function newQuestionId(now, rand) {
  return `q_${ulid(now, rand)}`;
}

/** 合法 ULID：26 位 Crockford Base32 且不超过 128 位（首字符 ≤ 7） */
export function isUlid(s) {
  return typeof s === 'string' && ULID_RE.test(s);
}

/** 解码 ULID 时间戳（毫秒） */
export function ulidTime(s) {
  let t = 0;
  for (const c of s.slice(0, 10)) t = t * 32 + CROCKFORD.indexOf(c);
  return t;
}
