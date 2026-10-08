/**
 * 纯 TypeScript 实现的增量 SHA-256（FIPS 180-4）。
 *
 * 为什么不用 expo-crypto：它的 digest 是一次性 API，33MB 的 APK 要么整体读成
 * 字符串（base64 膨胀 44MB）才能算哈希；这里配 expo-file-system 的 FileHandle
 * 分块读（1MB/块），峰值内存恒定，也不需要为此多装一个原生依赖。
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const ROUNDS = 64;
const BLOCK_BYTES = 64;

export interface Sha256Hasher {
  /** 喂入一段数据（可多次调用，任意长度） */
  update(bytes: Uint8Array): void;
  /** 结束消息并返回摘要；调用后 hasher 状态不变，可继续 update */
  digest(): Uint8Array;
  /** 摘要的小写十六进制文本 */
  hex(): string;
}

export function createSha256(): Sha256Hasher {
  // 初始哈希值 H0..H7（前 8 个素数的平方根小数部分）
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  // 消息分块调度空间
  const w = new Uint32Array(ROUNDS);
  // 不足一块的尾巴
  let pending = new Uint8Array(BLOCK_BYTES);
  let pendingLength = 0;
  // 消息位长（64 位），JS Number 放不下 2^53 以上的精确整数，拆成两个 32 位
  let lengthLow = 0;
  let lengthHigh = 0;

  function processBlock(block: Uint8Array): void {
    for (let i = 0; i < 16; i += 1) {
      w[i] =
        ((block[i * 4] << 24) |
          (block[i * 4 + 1] << 16) |
          (block[i * 4 + 2] << 8) |
          block[i * 4 + 3]) >>>
        0;
    }
    for (let i = 16; i < ROUNDS; i += 1) {
      const x = w[i - 15];
      const y = w[i - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < ROUNDS; i += 1) {
      const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + K[i] + w[i]) >>> 0;
      const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  function addLengthBits(bits: number): void {
    const next = lengthLow + bits;
    if (next > 0xffffffff) lengthHigh = (lengthHigh + ((next - (next % 0x100000000)) / 0x100000000)) >>> 0;
    lengthLow = next >>> 0;
  }

  return {
    update(bytes) {
      addLengthBits(bytes.length * 8);
      let offset = 0;
      if (pendingLength > 0) {
        const need = Math.min(BLOCK_BYTES - pendingLength, bytes.length);
        pending.set(bytes.subarray(0, need), pendingLength);
        pendingLength += need;
        offset = need;
        if (pendingLength === BLOCK_BYTES) {
          processBlock(pending);
          pendingLength = 0;
        }
      }
      while (bytes.length - offset >= BLOCK_BYTES) {
        processBlock(bytes.subarray(offset, offset + BLOCK_BYTES));
        offset += BLOCK_BYTES;
      }
      if (offset < bytes.length) {
        pending.set(bytes.subarray(offset), 0);
        pendingLength = bytes.length - offset;
      }
    },

    digest() {
      // 在副本上完成填充，保持 hasher 可继续使用
      const savedW = w.slice();
      const savedH = [h0, h1, h2, h3, h4, h5, h6, h7];
      const tail = pending.slice(0, pendingLength);
      const bitLengthLow = lengthLow;
      const bitLengthHigh = lengthHigh;
      try {
        // 追加 0x80
        pending.set([0x80], pendingLength);
        pendingLength += 1;
        if (pendingLength > BLOCK_BYTES - 8) {
          pending.fill(0, pendingLength);
          processBlock(pending);
          pendingLength = 0;
        }
        // 补零到 56 字节，再写 64 位位长
        pending.fill(0, pendingLength, BLOCK_BYTES - 8);
        pending[BLOCK_BYTES - 8] = (bitLengthHigh >>> 24) & 0xff;
        pending[BLOCK_BYTES - 7] = (bitLengthHigh >>> 16) & 0xff;
        pending[BLOCK_BYTES - 6] = (bitLengthHigh >>> 8) & 0xff;
        pending[BLOCK_BYTES - 5] = bitLengthHigh & 0xff;
        pending[BLOCK_BYTES - 4] = (bitLengthLow >>> 24) & 0xff;
        pending[BLOCK_BYTES - 3] = (bitLengthLow >>> 16) & 0xff;
        pending[BLOCK_BYTES - 2] = (bitLengthLow >>> 8) & 0xff;
        pending[BLOCK_BYTES - 1] = bitLengthLow & 0xff;
        processBlock(pending);

        const out = new Uint8Array(32);
        const finals = [h0, h1, h2, h3, h4, h5, h6, h7];
        for (let i = 0; i < 8; i += 1) {
          out[i * 4] = (finals[i] >>> 24) & 0xff;
          out[i * 4 + 1] = (finals[i] >>> 16) & 0xff;
          out[i * 4 + 2] = (finals[i] >>> 8) & 0xff;
          out[i * 4 + 3] = finals[i] & 0xff;
        }
        return out;
      } finally {
        // 还原现场
        w.set(savedW);
        h0 = savedH[0];
        h1 = savedH[1];
        h2 = savedH[2];
        h3 = savedH[3];
        h4 = savedH[4];
        h5 = savedH[5];
        h6 = savedH[6];
        h7 = savedH[7];
        pending.set(tail, 0);
        pending.fill(0, tail.length);
        pendingLength = tail.length;
      }
    },

    hex() {
      const bytes = this.digest();
      let text = '';
      for (let i = 0; i < bytes.length; i += 1) {
        text += bytes[i].toString(16).padStart(2, '0');
      }
      return text;
    },
  };
}
