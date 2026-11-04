import type { QuestionBankPackage } from '../types';

/**
 * 跨层测试用的内存文件系统 + 可控「线上 ZIP」。
 *
 * 返回纯对象（方法是自有属性）：作为 jest.mock('expo-file-system/legacy') 的模块值时，
 * `import * as FileSystem` 的命名空间拷贝不会丢方法。目录是隐式的：任何以 `<uri>/`
 * 开头的条目存在即视为该目录存在（与真机解压后 assets/ 目录可被 getInfoAsync 看到一致）。
 */
export interface MemoryEntry {
  isDirectory: boolean;
  value?: string;
}

export interface MemoryRemoteState {
  /** 当前「线上」题库包；下载 + 解压会得到它 */
  package: QuestionBankPackage;
  /** 题目资产：questionId → { 相对 assets/ 的路径: 内容 } */
  assets: Record<string, Record<string, string>>;
  /** 下载返回的 HTTP 状态（默认 200） */
  downloadStatus: number;
  /** 依次记录的下载地址 */
  downloads: string[];
}

export function createMemoryFileSystem() {
  const entries = new Map<string, MemoryEntry>();
  const reads: string[] = [];
  const remote: MemoryRemoteState = {
    package: { catalog: { schemaVersion: 1, id: 'remote', title: 'remote', tags: [], questions: [] }, contents: [] },
    assets: {},
    downloadStatus: 200,
    downloads: [],
  };
  const asPrefix = (uri: string) => (uri.endsWith('/') ? uri : `${uri}/`);
  const hasChildren = (uri: string) => {
    const prefix = asPrefix(uri);
    for (const key of entries.keys()) if (key.startsWith(prefix)) return true;
    return false;
  };
  const write = (uri: string, value: string) => entries.set(uri, { isDirectory: false, value });

  const fs = {
    documentDirectory: 'file:///documents/',
    cacheDirectory: 'file:///cache/',
    entries,
    reads,
    remote,
    async getInfoAsync(uri: string) {
      const entry = entries.get(uri);
      if (entry) return { exists: true, isDirectory: entry.isDirectory, uri };
      if (hasChildren(uri)) return { exists: true, isDirectory: true, uri };
      return { exists: false, isDirectory: false, uri };
    },
    async makeDirectoryAsync(uri: string, _options?: unknown) {
      entries.set(uri, { isDirectory: true });
    },
    async writeAsStringAsync(uri: string, value: string, _options?: unknown) {
      write(uri, value);
    },
    async readAsStringAsync(uri: string, _options?: unknown) {
      reads.push(uri);
      const entry = entries.get(uri);
      if (!entry || entry.isDirectory) throw new Error(`Missing file: ${uri}`);
      return entry.value ?? '';
    },
    async readDirectoryAsync(uri: string) {
      const prefix = asPrefix(uri);
      const children = new Set<string>();
      for (const key of entries.keys()) {
        if (!key.startsWith(prefix)) continue;
        const segment = key.slice(prefix.length).split('/')[0];
        if (segment) children.add(segment);
      }
      if (children.size === 0 && !entries.has(uri)) throw new Error(`Missing directory: ${uri}`);
      return [...children];
    },
    async deleteAsync(uri: string, _options?: unknown) {
      const prefix = asPrefix(uri);
      for (const key of [...entries.keys()]) {
        if (key === uri || key.startsWith(prefix)) entries.delete(key);
      }
    },
    async moveAsync({ from, to }: { from: string; to: string }) {
      if (entries.has(to)) throw new Error(`Destination exists: ${to}`);
      const prefix = asPrefix(from);
      const moved = [...entries.entries()].filter(([key]) => key === from || key.startsWith(prefix));
      if (moved.length === 0) throw new Error(`Missing source: ${from}`);
      for (const [key, value] of moved) {
        entries.delete(key);
        entries.set(`${to}${key.slice(from.length)}`, value);
      }
    },
    async copyAsync({ from, to }: { from: string; to: string }) {
      const prefix = asPrefix(from);
      const copied = [...entries.entries()].filter(([key]) => key === from || key.startsWith(prefix));
      if (copied.length === 0) throw new Error(`Missing source: ${from}`);
      for (const [key, value] of copied) entries.set(`${to}${key.slice(from.length)}`, { ...value });
    },
    async downloadAsync(url: string, fileUri: string) {
      remote.downloads.push(url);
      if (remote.downloadStatus >= 200 && remote.downloadStatus < 300) write(fileUri, 'zip');
      return { uri: fileUri, status: remote.downloadStatus };
    },
  };
  return fs;
}

export type MemoryFileSystem = ReturnType<typeof createMemoryFileSystem>;

/** 由 remote 状态生成 ZIP 条目与解压结果的 react-native-zip-archive 替身 */
export function createMemoryZipArchive(fs: MemoryFileSystem) {
  const files = (): [string, string][] => {
    const { package: bank, assets } = fs.remote;
    const result: [string, string][] = [['catalog.json', JSON.stringify(bank.catalog)]];
    for (const content of bank.contents) {
      const base = `questions/${content.id}/`;
      result.push([`${base}question.md`, content.questionMd]);
      if (content.answerMd !== null) result.push([`${base}answer.md`, content.answerMd]);
      if (content.followupsMd) result.push([`${base}followups.md`, content.followupsMd]);
      for (const [path, value] of Object.entries(assets[content.id] ?? {})) {
        result.push([`${base}assets/${path}`, value]);
      }
    }
    return result;
  };
  return {
    async listContents(_source: string, _charset?: string) {
      const directories = new Set<string>(['questions']);
      for (const [path] of files()) {
        const segments = path.split('/');
        for (let index = 1; index < segments.length; index += 1) {
          directories.add(segments.slice(0, index).join('/'));
        }
      }
      return [
        ...[...directories].map((path) => ({ path, isDirectory: true })),
        ...files().map(([path]) => ({ path, isDirectory: false })),
      ];
    },
    async unzip(_source: string, target: string, _charset?: string) {
      for (const [path, value] of files()) await fs.writeAsStringAsync(`${target}${path}`, value);
      return target;
    },
  };
}
