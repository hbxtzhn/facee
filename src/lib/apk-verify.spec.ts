import { describe, expect, it, jest } from '@jest/globals';
import { createHash } from 'node:crypto';

jest.mock('expo-file-system', () => {
  const files = new Map<string, Uint8Array>();
  return {
    FileMode: { ReadOnly: 'r' },
    File: class {
      uri: string;
      constructor(uri: string) {
        this.uri = uri;
      }
      open() {
        const bytes = files.get(this.uri);
        if (!bytes) throw new Error(`文件不存在：${this.uri}`);
        let offset = 0;
        return {
          offset: 0,
          size: bytes.length,
          readBytes: (length: number) => {
            const slice = bytes.subarray(offset, offset + length);
            offset += slice.length;
            return slice;
          },
          close: () => {},
        };
      }
    },
    __setFile: (uri: string, bytes: Uint8Array) => files.set(uri, bytes),
  };
});

import * as ExpoFileSystem from 'expo-file-system';
import { computeFileSha256Hex, computeSha256Hex } from './apk-verify';

const setFile = (ExpoFileSystem as unknown as { __setFile: (uri: string, bytes: Uint8Array) => void })
  .__setFile;

const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

describe('computeFileSha256Hex（FileHandle 分块读）', () => {
  it('小文件与 Node crypto 结果一致', async () => {
    const bytes = new TextEncoder().encode('FaceE 安装包');
    setFile('file:///cache/a.apk', bytes);
    expect(await computeFileSha256Hex('file:///cache/a.apk')).toBe(sha256Hex(bytes));
  });

  it('空文件是 SHA-256 的空串摘要', async () => {
    setFile('file:///cache/empty.apk', new Uint8Array(0));
    expect(await computeFileSha256Hex('file:///cache/empty.apk')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('跨 1MB 块边界的大文件分块读取仍正确', async () => {
    const bytes = new Uint8Array(1_500_000);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 31) % 256;
    setFile('file:///cache/big.apk', bytes);
    expect(await computeFileSha256Hex('file:///cache/big.apk')).toBe(sha256Hex(bytes));
  });
});

describe('computeSha256Hex（可注入读取器）', () => {
  /** 按固定切块回供数据，用于验证切块点与 64 字节块边界的对齐 */
  function chunkedReader(bytes: Uint8Array, chunkSize: number) {
    let offset = 0;
    return async (requested: number) => {
      const size = Math.min(requested, chunkSize);
      const slice = bytes.subarray(offset, offset + size);
      offset += slice.length;
      return slice;
    };
  }

  it('63/64/65 字节切块都得到相同摘要', async () => {
    const bytes = new Uint8Array(200);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = i % 256;
    const expected = sha256Hex(bytes);
    for (const size of [1, 63, 64, 65, 199, 200, 201]) {
      expect(await computeSha256Hex(chunkedReader(bytes, size), size)).toBe(expected);
    }
  });

  it('读取器立即返回空块时按空流处理', async () => {
    expect(await computeSha256Hex(async () => null)).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});
