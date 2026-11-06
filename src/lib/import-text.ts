/**
 * 文本导入：文件读取与分块。
 *
 * v1 只支持纯文本格式（.md / .markdown / .txt）——二进制格式（docx/pdf）
 * 需要文档解析依赖且提取质量不可控，明确不做。分块策略：按行贪心打包，
 * 尽量在 Markdown 标题行处开新块，让 LLM 每次看到完整的小节。
 */

export const SUPPORTED_IMPORT_EXTENSIONS = ['.md', '.markdown', '.txt'] as const;
/** 单块目标大小（字符）。太小会碎、太大稀释 LLM 注意力，6000 是平衡点 */
export const CHUNK_SIZE = 6000;
/** 一次导入最多处理的块数：超过说明文本太大，应让用户截选内容 */
export const MAX_CHUNKS = 30;

export interface TextChunks {
  chunks: string[];
  /** 文本超出 MAX_CHUNKS 被截断时为 true */
  truncated: boolean;
}

export function isSupportedImportFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return SUPPORTED_IMPORT_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/**
 * 把长文本切成适合 LLM 抽取的块。
 * 逐行贪心打包：整行放不下就开新块（保持段落完整），只有单行超过
 * chunkSize 才硬切；遇到 Markdown 标题行且当前块已过半时提前开新块。
 */
export function splitTextIntoChunks(text: string, chunkSize = CHUNK_SIZE): TextChunks {
  const normalized = text.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const chunks: string[] = [];
  let current: string[] = [];
  let currentLength = 0;

  const flush = () => {
    const joined = current.join('\n').trim();
    if (joined) chunks.push(joined);
    current = [];
    currentLength = 0;
  };

  for (const line of lines) {
    const isHeading = /^#{1,6}\s/.test(line);
    if (isHeading && currentLength > chunkSize / 2) flush();

    if (line.length > chunkSize) {
      // 单行超长才硬切
      if (currentLength > 0) flush();
      let offset = 0;
      while (offset < line.length) {
        const take = Math.min(chunkSize, line.length - offset);
        current.push(line.slice(offset, offset + take));
        offset += take;
        flush();
      }
      continue;
    }

    if (currentLength > 0 && currentLength + line.length + 1 > chunkSize) flush();
    current.push(line);
    currentLength += line.length + 1;
  }
  flush();

  if (chunks.length <= MAX_CHUNKS) return { chunks, truncated: false };
  return { chunks: chunks.slice(0, MAX_CHUNKS), truncated: true };
}

/** 读取选中的文本文件内容（document-picker 会把文件拷到应用缓存目录） */
export async function readImportedText(
  uri: string,
  readFile: (path: string) => Promise<string> = defaultRead,
): Promise<string> {
  return readFile(uri);
}

async function defaultRead(path: string): Promise<string> {
  const FileSystem = require('expo-file-system/legacy') as typeof import('expo-file-system/legacy');
  return FileSystem.readAsStringAsync(path, { encoding: 'utf8' });
}

/**
 * 规范字数（docs/题库规范-v2-草案.md §2.1）：非 ASCII 字符每个计 1，ASCII 字符每个计 0.5，合计向上取整。
 */
export function countSpecChars(text: string): number {
  let half = 0;
  for (const char of text) half += char.charCodeAt(0) < 0x80 ? 1 : 2;
  return Math.ceil(half / 2);
}

/** 按规范字数截断到 limit 以内 */
export function clipSpecChars(text: string, limit: number): string {
  let half = 0;
  let out = '';
  for (const char of text) {
    half += char.charCodeAt(0) < 0x80 ? 1 : 2;
    if (Math.ceil(half / 2) > limit) return out;
    out += char;
  }
  return out;
}
