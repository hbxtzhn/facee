import { describe, expect, it } from '@jest/globals';
import { createHash } from 'node:crypto';
import { createSha256 } from './sha256';

const HEX = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('SHA-256（FIPS 180-4 官方向量）', () => {
  it('空串', () => {
    expect(createSha256().hex()).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('"abc"', () => {
    expect(createSha256With(HEX('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('56 字节（填充跨块的边界：0x80 后只剩 7 字节放不下位长，必须再补整块）', () => {
    expect(createSha256With(HEX('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('112 字节（两个完整块 + 填充块）', () => {
    expect(
      createSha256With(
        HEX('abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu'),
      ),
    ).toBe('cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1');
  });

  it('百万次 a（对拍 Node crypto，覆盖长消息的长度累加）', () => {
    const mega = new Uint8Array(1_000_000).fill(0x61);
    const expected = createHash('sha256').update(mega).digest('hex');
    expect(createSha256With(mega)).toBe(expected);
  });
});

describe('增量特性', () => {
  it('逐字节喂入与整块喂入结果一致', () => {
    const text = 'FaceE 安装包完整性校验 ' + 'x'.repeat(200);
    const whole = createSha256With(HEX(text));

    const hasher = createSha256();
    for (const byte of HEX(text)) hasher.update(new Uint8Array([byte]));
    expect(hasher.hex()).toBe(whole);
  });

  it('digest 之后可以继续 update（校验链路复用同一实例）', () => {
    const hasher = createSha256();
    hasher.update(HEX('abc'));
    const first = hasher.hex();
    hasher.update(HEX('def'));
    // 'abcdef' 的 sha256
    expect(hasher.hex()).toBe(createHash('sha256').update('abcdef').digest('hex'));
    expect(createSha256With(HEX('abc'))).toBe(first);
  });
});

function createSha256With(bytes: Uint8Array): string {
  const hasher = createSha256();
  hasher.update(bytes);
  return hasher.hex();
}
