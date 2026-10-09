/** 图片仅用于 AI 输入，不持久化到题库；内容识别不信任扩展名或 picker MIME。 */
export const MAX_IMPORT_IMAGE_BYTES = 8 * 1024 * 1024;
export type ImportImageMime = 'image/jpeg' | 'image/png' | 'image/webp';
export interface LlmImageInput {
  base64: string;
  mimeType: ImportImageMime;
}
export interface ImageAssetInput {
  uri: string;
  size?: number;
  fileSize?: number;
  /** Web picker 提供的本地文件，不 fetch 任意 URI。 */
  file?: Blob;
}
export interface ImportedImage extends LlmImageInput {
  uri: string;
}

function checkSize(size: number): void {
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error('图片为空或无法读取大小');
  if (size > MAX_IMPORT_IMAGE_BYTES) throw new Error('图片不能超过 8 MB，请先缩小图片');
}

/** 在不解码整个图片的情况下验证 base64、真实体积与图片签名。 */
export function inspectImageBase64(base64: string): ImportImageMime {
  if (!base64 || base64.length > Math.ceil(MAX_IMPORT_IMAGE_BYTES / 3) * 4) {
    throw new Error('图片为空或超过 8 MB，请先缩小图片');
  }
  if (base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
    throw new Error('图片数据无效，请重新选择');
  }
  checkSize(base64.length / 4 * 3 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0));
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const header: number[] = [];
  for (let i = 0; i < Math.min(base64.length, 16); i += 4) {
    const bits = (alphabet.indexOf(base64[i]) << 18) | (alphabet.indexOf(base64[i + 1]) << 12)
      | (Math.max(0, alphabet.indexOf(base64[i + 2])) << 6) | Math.max(0, alphabet.indexOf(base64[i + 3]));
    header.push((bits >>> 16) & 255);
    if (base64[i + 2] !== '=') header.push((bits >>> 8) & 255);
    if (base64[i + 3] !== '=') header.push(bits & 255);
  }
  if (header.length >= 3 && header[0] === 255 && header[1] === 216 && header[2] === 255) return 'image/jpeg';
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => header[i] === byte)) return 'image/png';
  if ([82, 73, 70, 70].every((byte, i) => header[i] === byte)
      && [87, 69, 66, 80].every((byte, i) => header[i + 8] === byte)) return 'image/webp';
  throw new Error('只支持 JPEG / PNG / WebP 图片；HEIC 等格式请先转换');
}

export async function readImportedImage(
  asset: ImageAssetInput,
  readBase64: (asset: ImageAssetInput) => Promise<string> = defaultRead,
): Promise<ImportedImage> {
  if (!asset.uri) throw new Error('无法读取所选图片');
  const declaredSize = asset.size ?? asset.fileSize;
  if (declaredSize !== undefined) checkSize(declaredSize);
  const base64 = await readBase64(asset);
  return { uri: asset.uri, base64, mimeType: inspectImageBase64(base64) };
}

async function defaultRead(asset: ImageAssetInput): Promise<string> {
  if (asset.file) {
    checkSize(asset.file.size);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result !== 'string' || !reader.result.includes(',')) {
          reject(new Error('无法读取所选图片'));
        } else resolve(reader.result.slice(reader.result.indexOf(',') + 1));
      };
      reader.onerror = () => reject(new Error('无法读取所选图片'));
      reader.readAsDataURL(asset.file!);
    });
  }
  // SDK 57 新 API，先检查实际本地文件大小，避免在读入内存后才拒绝大文件。
  if (!/^file:\/\//.test(asset.uri)) throw new Error('请选择本地图片文件');
  const { File } = require('expo-file-system') as typeof import('expo-file-system');
  const file = new File(asset.uri);
  checkSize(file.size);
  return file.base64();
}
