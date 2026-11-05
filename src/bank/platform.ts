/**
 * 安装器依赖的平台能力（网络、文件、哈希、解压、App 版本）。
 *
 * 生产实现见 runtime.native.ts（expo-file-system / react-native-zip-archive / expo-constants），
 * 测试实现见 __tests__/helpers.ts（Node fs，跑在临时目录）。路径一律是以 `/` 分隔的 URI 字符串，
 * 目录 URI 以 `/` 结尾，拼接用 `${dir}${name}`。
 */
export interface BankPlatform {
  /** 当前 App 版本（app.json expo.version），用于 minAppVersion 检查 */
  appVersion: string;
  /** 持久目录，以 `/` 结尾；资源放在 `${documentDirectory}bank-assets/` 下 */
  documentDirectory: string;
  /** 缓存目录，以 `/` 结尾；下载暂存放在 `${cacheDirectory}bank-staging/` 下 */
  cacheDirectory: string;
  /** GET 文本（带超时，HTTP 非 2xx 抛错） */
  fetchText(url: string, timeoutMs: number): Promise<string>;
  /** 下载到本地文件（带超时，HTTP 非 2xx 抛错） */
  downloadFile(url: string, destination: string, timeoutMs: number): Promise<void>;
  readText(uri: string): Promise<string>;
  writeText(uri: string, text: string): Promise<void>;
  /** 文件字节数；不存在返回 null */
  fileSize(uri: string): Promise<number | null>;
  /** 文件内容 sha256（小写十六进制） */
  sha256File(uri: string): Promise<string>;
  /** ZIP 内条目名列表（解压前检查） */
  listZipEntries(zipUri: string): Promise<string[]>;
  unzip(zipUri: string, destinationDir: string): Promise<void>;
  /** 目录下的文件名（不递归）；目录不存在返回空数组 */
  listFiles(dirUri: string): Promise<string[]>;
  /** 递归创建目录 */
  makeDirectory(dirUri: string): Promise<void>;
  /** 删除文件或目录（幂等） */
  deletePath(uri: string): Promise<void>;
  movePath(from: string, to: string): Promise<void>;
}

export function joinUri(dir: string, name: string): string {
  return dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`;
}

export function asDir(uri: string): string {
  return uri.endsWith('/') ? uri : `${uri}/`;
}
