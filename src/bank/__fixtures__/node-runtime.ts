import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { openNodeBankDatabase } from '../db/node-sqlite';
import { migrate } from '../db/schema';
import type { BankDatabase } from '../db/types';
import type { BankPlatform } from '../platform';
import type { BankRuntime } from '../runtime-types';
import type { Bundle, Manifest } from '../types';

/**
 * 测试运行时：真实 SQLite（node:sqlite）+ 真实文件系统（临时目录）+ 内存「网络」。
 *
 * ZIP 用一个 JSON 容器文件代替（{ 文件名: base64 }）：安装器只通过 BankPlatform 的
 * listZipEntries / unzip 接触 ZIP，生产实现交给 react-native-zip-archive。
 */

export interface TestRuntime {
  rt: BankRuntime;
  db: BankDatabase;
  /** URL → 内容；fetchText / downloadFile 从这里取，不存在按 404 处理 */
  remote: Map<string, Buffer>;
  /** 每个 URL 被请求的次数 */
  requests: Map<string, number>;
  clock: { value: number };
  root: string;
  /** 写一个本地文件，返回 URI */
  writeLocalFile(name: string, content: string | Buffer): string;
  cleanup(): Promise<void>;
}

const toUri = (p: string) => p.replace(/\\/g, '/');

export function fakeZip(files: Record<string, string | Buffer>): Buffer {
  const entries = Object.fromEntries(
    Object.entries(files).map(([name, content]) => [name, Buffer.from(content).toString('base64')]),
  );
  return Buffer.from(JSON.stringify(entries));
}

export function sha256Hex(content: string | Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export async function createTestRuntime(options: { appVersion?: string; migrate?: boolean } = {}): Promise<TestRuntime> {
  const root = toUri(fs.mkdtempSync(path.join(os.tmpdir(), 'facee-bank-')));
  const documentDirectory = `${root}/documents/`;
  const cacheDirectory = `${root}/cache/`;
  fs.mkdirSync(documentDirectory, { recursive: true });
  fs.mkdirSync(cacheDirectory, { recursive: true });
  const remote = new Map<string, Buffer>();
  const requests = new Map<string, number>();
  const clock = { value: Date.UTC(2026, 10, 5, 8, 0, 0) };

  const fetchRemote = (url: string): Buffer => {
    requests.set(url, (requests.get(url) ?? 0) + 1);
    const content = remote.get(url);
    if (!content) throw new Error(`HTTP 404：${url}`);
    return content;
  };

  const platform: BankPlatform = {
    appVersion: options.appVersion ?? '0.2.0',
    documentDirectory,
    cacheDirectory,
    fetchText: async (url) => fetchRemote(url).toString('utf8'),
    downloadFile: async (url, destination) => {
      const content = fetchRemote(url);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, content);
    },
    readText: async (uri) => fs.readFileSync(uri, 'utf8'),
    writeText: async (uri, text) => {
      fs.mkdirSync(path.dirname(uri), { recursive: true });
      fs.writeFileSync(uri, text, 'utf8');
    },
    fileSize: async (uri) => (fs.existsSync(uri) && fs.statSync(uri).isFile() ? fs.statSync(uri).size : null),
    sha256File: async (uri) => sha256Hex(fs.readFileSync(uri)),
    listZipEntries: async (zipUri) => Object.keys(JSON.parse(fs.readFileSync(zipUri, 'utf8')) as Record<string, string>),
    unzip: async (zipUri, destinationDir) => {
      const entries = JSON.parse(fs.readFileSync(zipUri, 'utf8')) as Record<string, string>;
      for (const [name, base64] of Object.entries(entries)) {
        fs.writeFileSync(path.join(destinationDir, name), Buffer.from(base64, 'base64'));
      }
    },
    listFiles: async (dirUri) => (fs.existsSync(dirUri) ? fs.readdirSync(dirUri) : []),
    makeDirectory: async (dirUri) => {
      fs.mkdirSync(dirUri, { recursive: true });
    },
    deletePath: async (uri) => {
      fs.rmSync(uri, { recursive: true, force: true });
    },
    movePath: async (from, to) => {
      fs.renameSync(from, to);
    },
  };

  const db = openNodeBankDatabase(':memory:');
  if (options.migrate !== false) await migrate(db);
  const rt: BankRuntime = { db, platform, now: () => clock.value };
  return {
    rt,
    db,
    remote,
    requests,
    clock,
    root,
    writeLocalFile: (name, content) => {
      const uri = `${root}/local/${name}`;
      fs.mkdirSync(path.dirname(uri), { recursive: true });
      fs.writeFileSync(uri, content);
      return uri;
    },
    cleanup: async () => {
      await db.closeAsync().catch(() => undefined);
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

/**
 * 把 bundle（及可选资源）「发布」到内存网络，返回 latest.json 地址。
 * 可通过 tweak 修改清单（制造损坏 / 版本不符等）。
 */
export function publish(
  test: TestRuntime,
  bundle: Bundle,
  options: { base?: string; assets?: Record<string, string | Buffer>; tweak?: (manifest: Manifest) => void; changes?: string } = {},
): string {
  const base = options.base ?? 'https://example.com/sample';
  const version = bundle.bank.version;
  const bundleBytes = Buffer.from(JSON.stringify(bundle));
  const bundleUrl = `${base}/bundle-${version}.json`;
  test.remote.set(bundleUrl, bundleBytes);
  const manifest: Manifest = {
    bankId: bundle.bank.id,
    schemaVersion: 2,
    version,
    publishedAt: '2026-11-05T00:00:00Z',
    bundle: { url: bundleUrl, sha256: sha256Hex(bundleBytes), size: bundleBytes.length },
    questions: Object.fromEntries(bundle.questions.map((q) => [q.id, q.contentHash])),
    ...(options.changes ? { changes: options.changes } : {}),
  };
  if (options.assets) {
    const zip = fakeZip(options.assets);
    const zipUrl = `${base}/assets-${version}.zip`;
    test.remote.set(zipUrl, zip);
    manifest.assets = { url: zipUrl, sha256: sha256Hex(zip), size: zip.length };
  }
  options.tweak?.(manifest);
  const manifestUrl = `${base}/latest.json`;
  test.remote.set(manifestUrl, Buffer.from(JSON.stringify(manifest)));
  return manifestUrl;
}
