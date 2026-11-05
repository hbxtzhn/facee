/**
 * ULID（26 位 Crockford Base32 大写）：前 10 位毫秒时间戳，后 16 位随机。
 * 优先用 crypto.getRandomValues；不可用时退回 Math.random（本地 id 只需唯一，不涉及安全）。
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function randomBytes(count: number): Uint8Array {
  const bytes = new Uint8Array(count);
  const cryptoLike = (globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array } }).crypto;
  if (cryptoLike?.getRandomValues) {
    cryptoLike.getRandomValues(bytes);
  } else {
    for (let i = 0; i < count; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

export function ulid(now: number = Date.now()): string {
  let time = Math.max(0, Math.floor(now));
  let timePart = '';
  for (let i = 0; i < 10; i += 1) {
    timePart = ALPHABET[time % 32] + timePart;
    time = Math.floor(time / 32);
  }
  const random = randomBytes(16);
  let randomPart = '';
  for (let i = 0; i < 16; i += 1) randomPart += ALPHABET[random[i] % 32];
  return timePart + randomPart;
}

/** 题目 id：`q_` + ULID */
export function newQuestionId(now?: number): string {
  return `q_${ulid(now)}`;
}
