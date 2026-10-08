import { File, FileMode, type FileHandle } from 'expo-file-system';
import { createSha256 } from './sha256';

/**
 * 下载完的 APK 在交给系统安装器之前，用发布资产里的 SHA256SUMS 校验完整性。
 *
 * 为什么值得做：应用内更新是从公网下载 APK 直接拉起安装，链路上一旦被篡改
 * （DNS 劫持、代理、镜像站），校验和是系统签名校验之外的第一道防线。
 * 真正兜底的是 Android 自身的签名校验（签名不一致直接拒绝安装），
 * 所以这里失败时给出明确的中止提示即可。
 *
 * 分块读而不是整读：33MB 的包整读进内存再哈希峰值翻倍，FileHandle 1MB/块
 * 峰值恒定，也更适合低端机。
 */

/** 每次读入的块大小（1MB） */
const CHUNK_BYTES = 1 << 20;

/** 分块读取器：每次调用返回下一块数据，读完返回空块或 null */
export type ChunkReader = (chunkBytes: number) => Promise<Uint8Array | null>;

/** 用给定读取器把整个数据流算成 SHA-256 十六进制文本 */
export async function computeSha256Hex(
  readChunk: ChunkReader,
  chunkBytes: number = CHUNK_BYTES,
): Promise<string> {
  const hasher = createSha256();
  for (;;) {
    const chunk = await readChunk(chunkBytes);
    if (!chunk || chunk.length === 0) break;
    hasher.update(chunk);
    if (chunk.length < chunkBytes) break;
  }
  return hasher.hex();
}

/** 基于 expo-file-system FileHandle 的分块读取器（open/readBytes 均为同步原生绑定） */
export function fileChunkReader(uri: string): ChunkReader {
  let handle: FileHandle | null = null;

  return async (chunkBytes) => {
    handle ??= new File(uri).open(FileMode.ReadOnly);
    return handle.readBytes(chunkBytes);
  };
}

/** 计算本地文件的 SHA-256 */
export async function computeFileSha256Hex(uri: string): Promise<string> {
  return computeSha256Hex(fileChunkReader(uri));
}
