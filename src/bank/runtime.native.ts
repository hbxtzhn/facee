import { openBankDatabase } from './db/open.native';
import type { BankPlatform } from './platform';
import type { BankRuntime } from './runtime-types';
import { BankError } from './errors';
import { withNetworkTimeout } from '../lib/network';
import { createSha256 } from '../lib/sha256';
import { fileChunkReader } from '../lib/apk-verify';

/**
 * 原生端默认运行时：expo-sqlite + expo-file-system + react-native-zip-archive + expo-constants。
 * 原生模块都在函数内延迟 require，避免测试 / 预览环境在 import 时就加载它们。
 * Web 端由 Metro 解析同名 runtime.ts（返回 null）。
 */

interface LegacyFs {
  documentDirectory: string | null;
  cacheDirectory: string | null;
  downloadAsync(url: string, fileUri: string): Promise<{ status: number }>;
  readAsStringAsync(uri: string, options?: { encoding?: 'utf8' }): Promise<string>;
  writeAsStringAsync(uri: string, contents: string, options?: { encoding?: 'utf8' }): Promise<void>;
  getInfoAsync(uri: string, options?: { size?: boolean }): Promise<{ exists: boolean; size?: number; isDirectory?: boolean }>;
  readDirectoryAsync(uri: string): Promise<string[]>;
  makeDirectoryAsync(uri: string, options?: { intermediates?: boolean }): Promise<void>;
  deleteAsync(uri: string, options?: { idempotent?: boolean }): Promise<void>;
  moveAsync(options: { from: string; to: string }): Promise<void>;
}

interface ZipArchive {
  unzip(source: string, target: string, charset?: string): Promise<string>;
  listContents?(source: string, charset?: string): Promise<string[]>;
}

const HASH_CHUNK_BYTES = 512 * 1024;

/**
 * 分块计算文件 sha256：纯 JS 实现在 Hermes 上约 1–3 秒 / 3 MB（Node --jitless 实测 1.4 s），
 * 每块之间让出一次宏任务，避免长时间阻塞 UI 线程上的 JS 帧。
 */
async function sha256FileYielding(uri: string): Promise<string> {
  const read = fileChunkReader(uri);
  const hasher = createSha256();
  for (;;) {
    const chunk = await read(HASH_CHUNK_BYTES);
    if (!chunk || chunk.length === 0) break;
    hasher.update(chunk);
    if (chunk.length < HASH_CHUNK_BYTES) break;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return hasher.hex();
}

function createNativePlatform(): BankPlatform {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('expo-file-system/legacy') as LegacyFs;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Constants = (require('expo-constants') as { default: { expoConfig?: { version?: string } | null } }).default;
  let zip: ZipArchive | null = null;
  const getZip = (): ZipArchive => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    zip ??= require('react-native-zip-archive') as ZipArchive;
    return zip;
  };
  if (!fs.documentDirectory || !fs.cacheDirectory) {
    throw new BankError('unsupported', '当前环境没有可用的文件目录');
  }
  return {
    appVersion: Constants.expoConfig?.version ?? '0.0.0',
    documentDirectory: fs.documentDirectory,
    cacheDirectory: fs.cacheDirectory,
    fetchText: (url, timeoutMs) =>
      withNetworkTimeout(async (signal) => {
        const response = await fetch(url, { signal, headers: { 'Cache-Control': 'no-cache' } });
        if (!response.ok) throw new BankError('network', `请求失败（HTTP ${response.status}）：${url}`);
        return response.text();
      }, { timeoutMs }),
    downloadFile: (url, destination, timeoutMs) =>
      withNetworkTimeout(async () => {
        const result = await fs.downloadAsync(url, destination);
        if (!result || result.status < 200 || result.status >= 300) {
          throw new BankError('network', `下载失败（HTTP ${result?.status ?? 'unknown'}）：${url}`);
        }
      }, { timeoutMs }),
    readText: (uri) => fs.readAsStringAsync(uri, { encoding: 'utf8' }),
    writeText: (uri, text) => fs.writeAsStringAsync(uri, text, { encoding: 'utf8' }),
    fileSize: async (uri) => {
      const info = await fs.getInfoAsync(uri, { size: true });
      return info.exists && !info.isDirectory ? (info.size ?? 0) : null;
    },
    sha256File: sha256FileYielding,
    listZipEntries: async (zipUri) => {
      const archive = getZip();
      return archive.listContents ? archive.listContents(zipUri, 'UTF-8') : [];
    },
    unzip: async (zipUri, destinationDir) => {
      await getZip().unzip(zipUri, destinationDir, 'UTF-8');
    },
    listFiles: async (dirUri) => {
      const info = await fs.getInfoAsync(dirUri);
      if (!info.exists) return [];
      return fs.readDirectoryAsync(dirUri);
    },
    makeDirectory: (dirUri) => fs.makeDirectoryAsync(dirUri, { intermediates: true }).catch(async (error) => {
      const info = await fs.getInfoAsync(dirUri);
      if (!info.exists) throw error;
    }),
    deletePath: (uri) => fs.deleteAsync(uri, { idempotent: true }),
    movePath: (from, to) => fs.moveAsync({ from, to }),
  };
}

export async function createDefaultRuntime(): Promise<BankRuntime | null> {
  const platform = createNativePlatform();
  const db = await openBankDatabase();
  return { db, platform };
}
