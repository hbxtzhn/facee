import { describe, expect, it } from '@jest/globals';
import {
  buildBackupManifest,
  createBackupZip,
  parseBackupManifest,
  planBankImports,
  restoreBackupZip,
} from './backup';
import { TEST_QUESTION_BANK } from '../question-bank/fixture';
import type { LocalBankSource } from '../question-bank/types';

class MemoryFileSystem {
  readonly cacheDirectory = 'file:///cache/';
  readonly documentDirectory = 'file:///documents/';
  private readonly entries = new Map<string, { isDirectory: boolean; value?: string }>();

  async getInfoAsync(uri: string) {
    const entry = this.entries.get(uri);
    return { exists: Boolean(entry), isDirectory: entry?.isDirectory ?? false };
  }

  async makeDirectoryAsync(uri: string) {
    // 与真实行为一致：intermediates 逐级建目录条目，供目录枚举与 exists 判断
    let prefix = 'file:///';
    for (const segment of uri.slice('file:///'.length).split('/')) {
      if (!segment) continue;
      prefix += `${segment}/`;
      if (!this.entries.has(prefix)) this.entries.set(prefix, { isDirectory: true });
    }
  }

  async writeAsStringAsync(uri: string, value: string) {
    this.entries.set(uri, { isDirectory: false, value });
  }

  async readAsStringAsync(uri: string) {
    const entry = this.entries.get(uri);
    if (!entry || entry.isDirectory) throw new Error(`Missing file: ${uri}`);
    return entry.value ?? '';
  }

  async readDirectoryAsync(uri: string) {
    const prefix = uri.endsWith('/') ? uri : `${uri}/`;
    const children = new Set<string>();
    for (const key of this.entries.keys()) {
      if (!key.startsWith(prefix)) continue;
      const segment = key.slice(prefix.length).split('/')[0];
      if (segment) children.add(segment);
    }
    return [...children];
  }

  async deleteAsync(uri: string) {
    for (const key of [...this.entries.keys()]) {
      if (key === uri || key.startsWith(uri.endsWith('/') ? uri : `${uri}/`)) this.entries.delete(key);
    }
  }

  async copyAsync({ from, to }: { from: string; to: string }) {
    const fromPrefix = from.endsWith('/') ? from : `${from}/`;
    const toPrefix = to.endsWith('/') ? to : `${to}/`;
    for (const [key, value] of [...this.entries.entries()]) {
      if (key === from || key.startsWith(fromPrefix)) {
        this.entries.set(`${toPrefix}${key.slice(fromPrefix.length)}`, value);
      }
    }
  }
}

/** 假 zip：把 zip 时的目录树拍快照，unzip 时原样展开（同层结构） */
function createFakeZip(fileSystem: MemoryFileSystem) {
  let snapshot: [string, string][] = [];
  return {
    zip: async (source: string, target: string) => {
      snapshot = [];
      const walk = async (dir: string, relative: string) => {
        for (const child of await fileSystem.readDirectoryAsync(dir)) {
          const childPath = `${dir}${child}`;
          const asDir = await fileSystem.getInfoAsync(`${childPath}/`);
          if (asDir.exists && asDir.isDirectory) {
            await walk(`${childPath}/`, `${relative}${child}/`);
          } else {
            snapshot.push([`${relative}${child}`, await fileSystem.readAsStringAsync(childPath)]);
          }
        }
      };
      await walk(source, '');
      return target;
    },
    unzip: async (_source: string, target: string) => {
      for (const [relative, value] of snapshot) {
        await fileSystem.writeAsStringAsync(`${target}${relative}`, value);
      }
      return target;
    },
  };
}

function makeSource(bankId: string, title = bankId): LocalBankSource {
  const bank = { ...TEST_QUESTION_BANK, catalog: { ...TEST_QUESTION_BANK.catalog, id: bankId, title } };
  return { bankId, updatedAt: '', package: bank };
}

describe('backup 备份导入规划', () => {
  it('id 无冲突：原样导入', () => {
    const plans = planBankImports([makeSource('local-a')], new Set(['local-other']));
    expect(plans).toHaveLength(1);
    expect(plans[0].source.bankId).toBe('local-a');
    expect(plans[0].reusedExisting).toBe(false);
  });

  it('id 冲突：换新 id、标题加（导入）后缀，原 id 随行记录', () => {
    const plans = planBankImports([makeSource('local-a', '我的题库')], new Set(['local-a']));
    expect(plans).toHaveLength(1);
    expect(plans[0].originalBankId).toBe('local-a');
    expect(plans[0].reusedExisting).toBe(true);
    expect(plans[0].source.bankId).not.toBe('local-a');
    expect(plans[0].source.bankId).toMatch(/^local-/);
    expect(plans[0].source.package.catalog.title).toBe('我的题库（导入）');
    expect(plans[0].source.package.catalog.id).toBe(plans[0].source.bankId);
  });
});

describe('backup manifest', () => {
  it('构建与解析互逆，schema 校验拒绝更高版本与损坏文件', () => {
    const sources = [makeSource('local-a'), makeSource('local-b')];
    const manifest = buildBackupManifest(sources, '2026-10-01T00:00:00.000Z');
    expect(manifest.banks).toEqual([
      { bankId: 'local-a', title: 'local-a', questionCount: 6 },
      { bankId: 'local-b', title: 'local-b', questionCount: 6 },
    ]);
    expect(parseBackupManifest(JSON.stringify(manifest)).schemaVersion).toBe(1);
    expect(() =>
      parseBackupManifest(JSON.stringify({ ...manifest, schemaVersion: 99 })),
    ).toThrow('先升级');
    expect(() => parseBackupManifest('{oops')).toThrow('损坏');
  });
});

describe('backup 打包与恢复 round-trip', () => {
  it('导出 ZIP 后可恢复：无冲突原样进，冲突作为新库加入', async () => {
    const fileSystem = new MemoryFileSystem();
    const zip = createFakeZip(fileSystem);
    const stagedAssets: string[] = [];

    const { zipPath, manifest } = await createBackupZip({
      sources: [makeSource('local-a', '我的题库')],
      stageLocalBankAssets: async (root) => {
        stagedAssets.push(root);
        await fileSystem.makeDirectoryAsync(`${root}local-a/fixture-java-001/assets/`);
        await fileSystem.writeAsStringAsync(`${root}local-a/fixture-java-001/assets/diagram.png`, 'png-bytes');
        return 1;
      },
      now: new Date('2026-10-01T00:00:00.000Z'),
      zipArchive: zip,
      cacheDirectory: 'file:///cache/',
      fileSystem: fileSystem as never,
    });
    expect(manifest.banks).toHaveLength(1);
    expect(zipPath).toContain('facee-backup-');

    // 首次恢复：无冲突，原 id 进入，资产按原 id 回填
    const installBank = jest.fn(async () => undefined);
    const restoreCalls: string[] = [];
    const first = await restoreBackupZip({
      zipPath,
      existingCatalogIds: new Set(),
      cacheDirectory: 'file:///cache/',
      fileSystem: fileSystem as never,
      installBank,
      restoreBankAssets: async (assetsRoot, catalogId) => {
        restoreCalls.push(catalogId);
        const info = await fileSystem.getInfoAsync(`${assetsRoot}${catalogId}/fixture-java-001/assets/diagram.png`);
        expect(info.exists).toBe(true);
      },
      zipArchive: zip,
    });
    expect(first.imported).toEqual([
      { bankId: 'local-a', title: '我的题库', questionCount: 6, reusedExisting: false },
    ]);
    expect(installBank).toHaveBeenCalledTimes(1);
    expect(restoreCalls).toEqual(['local-a']);

    // 二次恢复（id 已存在）：换新 id + （导入）
    const second = await restoreBackupZip({
      zipPath,
      existingCatalogIds: new Set(['local-a']),
      cacheDirectory: 'file:///cache/',
      fileSystem: fileSystem as never,
      installBank: async () => undefined,
      restoreBankAssets: async () => undefined,
      zipArchive: zip,
    });
    expect(second.imported[0].reusedExisting).toBe(true);
    expect(second.imported[0].bankId).not.toBe('local-a');
    expect(second.imported[0].title).toBe('我的题库（导入）');
  });

  it('manifest 声明的库缺失源文件时跳过；备份里没有题库时报错', async () => {
    const fileSystem = new MemoryFileSystem();
    createFakeZip(fileSystem);
    await fileSystem.writeAsStringAsync(
      'file:///cache/loose/manifest.json',
      JSON.stringify(buildBackupManifest([makeSource('local-a')])),
    );
    // 没写 sources/local-a.json
    await expect(
      restoreBackupZip({
        zipPath: 'file:///cache/loose.zip',
        existingCatalogIds: new Set(),
        cacheDirectory: 'file:///cache/',
        fileSystem: fileSystem as never,
        installBank: async () => undefined,
        restoreBankAssets: async () => undefined,
        zipArchive: {
          zip: async () => 'file:///cache/x.zip',
          unzip: async (_s: string, target: string) => {
            const manifest = await fileSystem.readAsStringAsync('file:///cache/loose/manifest.json');
            await fileSystem.writeAsStringAsync(`${target}manifest.json`, manifest);
            return target;
          },
        },
      }),
    ).rejects.toThrow('没有可导入的题库');
  });
});
