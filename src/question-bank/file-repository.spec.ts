import { describe, expect, it } from '@jest/globals';
import {
  FileSystemQuestionBankRepository,
  normalizeAssetRelativePath,
  normalizeQuestionBankZipPath,
  resolveAssetUri,
  resolveQuestionAssetMarkdown,
  validateDecodedPackage,
  validateQuestionBankZipEntries,
  validateQuestionBankZipPath,
} from './file-repository';
import { TEST_QUESTION_BANK } from './fixture';
import type { ZipEntryLike } from './file-repository';

class MemoryFileSystem {
  readonly documentDirectory = 'file:///documents/';
  readonly cacheDirectory = 'file:///cache/';
  protected readonly entries = new Map<string, { isDirectory: boolean; value?: string }>();

  async getInfoAsync(uri: string) {
    const entry = this.entries.get(uri);
    return { exists: Boolean(entry), isDirectory: entry?.isDirectory ?? false };
  }

  async makeDirectoryAsync(uri: string) {
    this.entries.set(uri, { isDirectory: true });
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
    for (const key of this.entries.keys()) {
      if (key === uri || key.startsWith(uri.endsWith('/') ? uri : `${uri}/`)) this.entries.delete(key);
    }
  }

  async moveAsync({ from, to }: { from: string; to: string }) {
    if (this.entries.has(to)) throw new Error(`Destination exists: ${to}`);
    const moved = [...this.entries.entries()].filter(([key]) => key === from || key.startsWith(from.endsWith('/') ? from : `${from}/`));
    if (moved.length === 0) throw new Error(`Missing source: ${from}`);
    for (const [key, value] of moved) {
      this.entries.delete(key);
      this.entries.set(`${to}${key.slice(from.length)}`, value);
    }
  }

  async downloadAsync(_url: string, fileUri: string) {
    await this.writeAsStringAsync(fileUri, 'zip');
    return { uri: fileUri, status: 200 };
  }
}

/** 统计 catalog.json 的磁盘读取次数，用于断言内存缓存命中 */
class CountingFileSystem extends MemoryFileSystem {
  catalogReads = 0;

  override async readAsStringAsync(uri: string) {
    if (uri.includes('catalog.json')) this.catalogReads += 1;
    return super.readAsStringAsync(uri);
  }
}

function zipEntriesForFixture(): ZipEntryLike[] {
  return [
    { path: 'catalog.json', isDirectory: false },
    { path: 'questions', isDirectory: true },
    ...TEST_QUESTION_BANK.contents.flatMap((content) => [
      { path: `questions/${content.id}`, isDirectory: true },
      { path: `questions/${content.id}/question.md`, isDirectory: false },
      ...(content.answerMd === null ? [] : [{ path: `questions/${content.id}/answer.md`, isDirectory: false }]),
    ]),
  ];
}

function createZipArchive(
  fileSystem: MemoryFileSystem,
  options: { failAfterFirstFile?: boolean; missingReferencedAsset?: boolean } = {},
) {
  const entries = zipEntriesForFixture();
  return {
    listContents: async () => entries,
    unzip: async (_source: string, target: string) => {
      await fileSystem.writeAsStringAsync(`${target}catalog.json`, JSON.stringify(TEST_QUESTION_BANK.catalog));
      await fileSystem.writeAsStringAsync(
        `${target}questions/${TEST_QUESTION_BANK.contents[0].id}/question.md`,
        TEST_QUESTION_BANK.contents[0].questionMd,
      );
      if (options.failAfterFirstFile) throw new Error('Injected extraction failure');
      for (const content of TEST_QUESTION_BANK.contents) {
        const questionMd =
          options.missingReferencedAsset && content.id === TEST_QUESTION_BANK.contents[0].id
            ? `${content.questionMd}\n![missing](./assets/missing.png)`
            : content.questionMd;
        await fileSystem.writeAsStringAsync(
          `${target}questions/${content.id}/question.md`,
          questionMd,
        );
        if (content.answerMd !== null) {
          await fileSystem.writeAsStringAsync(
            `${target}questions/${content.id}/answer.md`,
            content.answerMd,
          );
        }
      }
      return target;
    },
  };
}

describe('question-bank ZIP path validation', () => {
  it('accepts the fixed catalog, Markdown, and nested asset layout', () => {
    const entries = [
      { path: 'catalog.json', isDirectory: false },
      { path: 'questions', isDirectory: true },
      { path: 'questions/java-1', isDirectory: true },
      { path: 'questions/java-1/question.md', isDirectory: false },
      { path: 'questions/java-1/answer.md', isDirectory: false },
      { path: 'questions/java-1/assets', isDirectory: true },
      { path: 'questions/java-1/assets/diagrams/hash-map.png', isDirectory: false },
    ];

    expect(validateQuestionBankZipEntries(entries)).toEqual(entries.map((entry) => entry.path));
  });

  it('rejects traversal, absolute paths, duplicate files, and encrypted entries', () => {
    expect(() => normalizeQuestionBankZipPath('../catalog.json')).toThrow('Unsafe');
    expect(() => normalizeQuestionBankZipPath('questions/q/assets/%2e%2e/secret.txt')).toThrow('Unsafe');
    expect(normalizeQuestionBankZipPath('questions/q/assets/diagram%20one.png')).toBe('questions/q/assets/diagram one.png');
    expect(() => validateQuestionBankZipPath('/catalog.json')).toThrow('Unsafe');
    expect(() => validateQuestionBankZipEntries([
      { path: 'catalog.json', isDirectory: false },
      { path: 'catalog.json', isDirectory: false },
    ])).toThrow('Duplicate');
    expect(() => validateQuestionBankZipEntries([
      { path: 'catalog.json', isDirectory: false, isEncrypted: true },
    ])).toThrow('Encrypted');
  });

  it('requires a root catalog file', () => {
    expect(() => validateQuestionBankZipEntries([
      { path: 'questions/q/question.md', isDirectory: false },
    ])).toThrow('catalog.json');
    expect(() => validateQuestionBankZipPath('catalog.json', true)).toThrow('must be a file');
  });
});

describe('question-bank asset links', () => {
  it('normalizes safe asset paths and resolves them under the extracted directory', () => {
    expect(normalizeAssetRelativePath('./assets/diagrams/hash-map.png')).toBe('diagrams/hash-map.png');
    expect(resolveAssetUri('file:///documents/facee/assets/', './assets/diagrams/hash-map.png'))
      .toBe('file:///documents/facee/assets/diagrams/hash-map.png');
    expect(resolveAssetUri('file:///documents/facee/assets/', './assets/diagram%20one.png'))
      .toBe('file:///documents/facee/assets/diagram%20one.png');
    expect(() => normalizeAssetRelativePath('./assets/../secret.png')).toThrow('Unsafe');
  });

  it('rewrites relative Markdown asset links without touching external links', () => {
    const markdown = [
      '![HashMap](./assets/hash-map.png)',
      '[docs](https://example.com/docs)',
    ].join('\n');
    const resolved = resolveQuestionAssetMarkdown(markdown, 'file:///documents/facee/assets/');

    expect(resolved).toContain('![HashMap](file:///documents/facee/assets/hash-map.png)');
    expect(resolved).toContain('[docs](https://example.com/docs)');
  });
});

describe('FileSystemQuestionBankRepository installation safety', () => {
  it('does not let a progress listener interrupt activation', async () => {
    const repository = new FileSystemQuestionBankRepository({
      fileSystem: new MemoryFileSystem() as never,
    });

    await expect(
      repository.install(TEST_QUESTION_BANK, () => {
        throw new Error('presentation failure');
      }),
    ).resolves.toEqual({ questionCount: 6, tagCount: 4 });
    expect((await repository.getCatalog())?.title).toBe(TEST_QUESTION_BANK.catalog.title);
  });

  it('keeps the bank empty when first extraction fails', async () => {
    const fileSystem = new MemoryFileSystem();
    const repository = new FileSystemQuestionBankRepository({
      fileSystem: fileSystem as never,
      zipArchive: createZipArchive(fileSystem, { failAfterFirstFile: true }),
    });

    await expect(repository.installFromUrl('https://example.test/bank.zip')).rejects.toThrow(
      'Injected extraction failure',
    );
    expect(await repository.getCatalog()).toBeNull();
  });

  it('rejects a bank whose Markdown references a missing local asset', async () => {
    const fileSystem = new MemoryFileSystem();
    const repository = new FileSystemQuestionBankRepository({
      fileSystem: fileSystem as never,
      zipArchive: createZipArchive(fileSystem, { missingReferencedAsset: true }),
    });

    await expect(repository.installFromUrl('https://example.test/bank.zip')).rejects.toThrow(
      'Missing referenced asset',
    );
    expect(await repository.getCatalog()).toBeNull();
  });

  it('keeps the previous active bank when replacement extraction fails', async () => {
    const fileSystem = new MemoryFileSystem();
    const repository = new FileSystemQuestionBankRepository({
      fileSystem: fileSystem as never,
      zipArchive: createZipArchive(fileSystem),
    });

    await repository.install(TEST_QUESTION_BANK);
    const originalQuestion = await repository.getContent('fixture-java-001');

    const failingRepository = new FileSystemQuestionBankRepository({
      fileSystem: fileSystem as never,
      zipArchive: createZipArchive(fileSystem, { failAfterFirstFile: true }),
    });
    await expect(failingRepository.installFromUrl('https://example.test/replacement.zip')).rejects.toThrow(
      'Injected extraction failure',
    );

    expect((await repository.getCatalog())?.title).toBe(TEST_QUESTION_BANK.catalog.title);
    expect((await repository.getContent('fixture-java-001'))?.questionMd).toBe(originalQuestion?.questionMd);
  });

  it('installFromUrl 下载即本地化：id 重写为 local-，返回可落盘的题库源', async () => {
    const fileSystem = new MemoryFileSystem();
    const repository = new FileSystemQuestionBankRepository({
      fileSystem: fileSystem as never,
      zipArchive: createZipArchive(fileSystem),
    });

    const result = await repository.installFromUrl('https://example.test/bank.zip');
    const catalog = await repository.getCatalog();
    expect(catalog?.id).toMatch(/^local-[a-z0-9]+$/);
    expect(result.localSource?.sourceUrl).toBe('https://example.test/bank.zip');
    expect(result.localSource?.package.catalog.id).toBe(catalog?.id);
    expect(result.localSource?.package.contents).toHaveLength(TEST_QUESTION_BANK.contents.length);
    // 题库源是合法包，可直接落盘重装
    expect(() => validateDecodedPackage(result.localSource!.package)).not.toThrow();
  });

  it('installFromUrl 传 reuseCatalogId 时沿用原 id（同 URL 更新语义）', async () => {
    const fileSystem = new MemoryFileSystem();
    const repository = new FileSystemQuestionBankRepository({
      fileSystem: fileSystem as never,
      zipArchive: createZipArchive(fileSystem),
    });

    const first = await repository.installFromUrl('https://example.test/bank.zip');
    const reusedId = first.localSource!.bankId;
    const second = await repository.installFromUrl('https://example.test/bank.zip', undefined, {
      reuseCatalogId: reusedId,
    });
    expect(second.localSource?.bankId).toBe(reusedId);
    const banks = await repository.listBanks();
    expect(banks.filter((bank) => bank.catalogId === reusedId)).toHaveLength(1);
    expect(banks.find((bank) => bank.catalogId === reusedId)?.source).toBe('local');
  });
});

describe('FileSystemQuestionBankRepository catalog 内存缓存', () => {
  it('getCatalog / getQuestion / listQuestions 反复调用只整读一次 catalog.json', async () => {
    const fileSystem = new CountingFileSystem();
    const repository = new FileSystemQuestionBankRepository({
      fileSystem: fileSystem as never,
      zipArchive: createZipArchive(fileSystem),
    });

    await repository.install(TEST_QUESTION_BANK);
    // 安装只写不读；缓存为空，首次读取会把目录载入内存
    expect(fileSystem.catalogReads).toBe(0);

    expect(await repository.getCatalog()).not.toBeNull();
    expect(await repository.getQuestion('fixture-java-001')).not.toBeNull();
    expect(await repository.getQuestion('fixture-java-001')).not.toBeNull();
    expect(await repository.listQuestions()).not.toHaveLength(0);
    expect(await repository.getContent('fixture-java-001')).not.toBeNull();

    expect(fileSystem.catalogReads).toBe(1);
  });

  it('换库（指针切到新 namespace）后缓存自动失效并重新加载', async () => {
    const fileSystem = new CountingFileSystem();
    const repository = new FileSystemQuestionBankRepository({
      fileSystem: fileSystem as never,
      zipArchive: createZipArchive(fileSystem),
    });

    await repository.install(TEST_QUESTION_BANK);
    expect(await repository.getCatalog()).not.toBeNull();
    const readsBefore = fileSystem.catalogReads;

    await repository.install(TEST_QUESTION_BANK);
    expect((await repository.getCatalog())?.title).toBe(TEST_QUESTION_BANK.catalog.title);
    expect(fileSystem.catalogReads).toBeGreaterThan(readsBefore);
  });

  it('clear() 后缓存失效，题库回到空态', async () => {
    const fileSystem = new CountingFileSystem();
    const repository = new FileSystemQuestionBankRepository({
      fileSystem: fileSystem as never,
      zipArchive: createZipArchive(fileSystem),
    });

    await repository.install(TEST_QUESTION_BANK);
    expect(await repository.getCatalog()).not.toBeNull();

    await repository.clear();
    expect(await repository.getCatalog()).toBeNull();
    expect(await repository.getQuestion('fixture-java-001')).toBeNull();
  });
});

/** 换 catalogId 的克隆包：contents 不变（validateDecodedPackage 要求 id 对齐） */
function bankWithId(id: string) {
  return {
    catalog: { ...TEST_QUESTION_BANK.catalog, id },
    contents: TEST_QUESTION_BANK.contents,
  };
}

describe('FileSystemQuestionBankRepository 多题库共存', () => {
  it('不同 catalogId 的题库共存，listBanks 列出两者且 active 正确', async () => {
    const fileSystem = new MemoryFileSystem();
    const repository = new FileSystemQuestionBankRepository({ fileSystem: fileSystem as never });

    await repository.install(TEST_QUESTION_BANK);
    await repository.install(bankWithId('local-my-bank'));

    const banks = await repository.listBanks();
    expect(banks).toHaveLength(2);
    const ids = banks.map((bank) => bank.catalogId).sort();
    expect(ids).toEqual(['facee-fixture', 'local-my-bank']);
    // 后安装的题库是当前 active
    expect(banks.find((bank) => bank.catalogId === 'local-my-bank')?.active).toBe(true);
    expect(banks.find((bank) => bank.catalogId === 'facee-fixture')?.active).toBe(false);
    // 本地前缀识别
    expect(banks.find((bank) => bank.catalogId === 'local-my-bank')?.source).toBe('local');
    expect(banks.find((bank) => bank.catalogId === 'facee-fixture')?.source).toBe('online');
  });

  it('同 catalogId 重复安装只替换自己：旧 namespace 被删，别的题库保留', async () => {
    const fileSystem = new MemoryFileSystem();
    const repository = new FileSystemQuestionBankRepository({ fileSystem: fileSystem as never });

    await repository.install(TEST_QUESTION_BANK);
    await repository.install(bankWithId('local-my-bank'));
    await repository.install(bankWithId('local-my-bank')); // 本地题库第二次保存

    const banks = await repository.listBanks();
    expect(banks).toHaveLength(2);
    expect(banks.filter((bank) => bank.catalogId === 'local-my-bank')).toHaveLength(1);
    expect((await repository.listBanks()).find((bank) => bank.catalogId === 'facee-fixture')).toBeTruthy();
  });

  it('switchBank 切换当前题库，getCatalog 跟随', async () => {
    const fileSystem = new MemoryFileSystem();
    const repository = new FileSystemQuestionBankRepository({ fileSystem: fileSystem as never });

    await repository.install(TEST_QUESTION_BANK);
    await repository.install(bankWithId('local-my-bank'));

    await repository.switchBank('facee-fixture');
    expect((await repository.getCatalog())?.id).toBe('facee-fixture');
    expect((await repository.listBanks()).find((bank) => bank.active)?.catalogId).toBe('facee-fixture');

    await repository.switchBank('local-my-bank');
    expect((await repository.getCatalog())?.id).toBe('local-my-bank');
  });

  it('deleteBank 删除非 active 题库不影响当前题库；删除 active 自动切换', async () => {
    const fileSystem = new MemoryFileSystem();
    const repository = new FileSystemQuestionBankRepository({ fileSystem: fileSystem as never });

    await repository.install(TEST_QUESTION_BANK);
    await repository.install(bankWithId('local-my-bank'));

    // 删除非 active 的旧库
    await repository.deleteBank('facee-fixture');
    expect(await repository.listBanks()).toHaveLength(1);
    expect((await repository.getCatalog())?.id).toBe('local-my-bank');

    // 删除 active 且是最后一个 → 回到空态
    await repository.deleteBank('local-my-bank');
    expect(await repository.listBanks()).toHaveLength(0);
    expect(await repository.getCatalog()).toBeNull();
  });

  it('deleteBank 删除 active 但还有其他题库时，自动切到剩余题库', async () => {
    const fileSystem = new MemoryFileSystem();
    const repository = new FileSystemQuestionBankRepository({ fileSystem: fileSystem as never });

    await repository.install(TEST_QUESTION_BANK);
    await repository.install(bankWithId('local-my-bank'));

    await repository.deleteBank('local-my-bank');
    expect((await repository.getCatalog())?.id).toBe('facee-fixture');
  });

  it('install 不再丢弃 followupsMd，getContent 能读回追问', async () => {
    const fileSystem = new MemoryFileSystem();
    const repository = new FileSystemQuestionBankRepository({ fileSystem: fileSystem as never });
    const packageWithFollowups = {
      catalog: TEST_QUESTION_BANK.catalog,
      contents: TEST_QUESTION_BANK.contents.map((content, index) =>
        index === 0 ? { ...content, followupsMd: '## 追问：为什么？\n\n因为。' } : content,
      ),
    };

    await repository.install(packageWithFollowups);
    const content = await repository.getContent(TEST_QUESTION_BANK.contents[0].id);
    expect(content?.followupsMd).toBe('## 追问：为什么？\n\n因为。');
  });
});

class CopyableFileSystem extends MemoryFileSystem {
  copied: { from: string; to: string }[] = [];

  async copyAsync({ from, to }: { from: string; to: string }) {
    this.copied.push({ from, to });
    const fromPrefix = from.endsWith('/') ? from : `${from}/`;
    const toPrefix = to.endsWith('/') ? to : `${to}/`;
    for (const [key, value] of [...this.entries.entries()]) {
      if (key === from || key.startsWith(fromPrefix)) {
        this.entries.set(`${toPrefix}${key.slice(fromPrefix.length)}`, value);
      }
    }
  }
}

describe('FileSystemQuestionBankRepository exportPackage / copyBankAssets', () => {
  it('exportPackage 反向重建完整包（含 followupsMd），重建包可直接再安装', async () => {
    const fileSystem = new MemoryFileSystem();
    const repository = new FileSystemQuestionBankRepository({ fileSystem: fileSystem as never });
    const packageWithFollowups = {
      catalog: TEST_QUESTION_BANK.catalog,
      contents: TEST_QUESTION_BANK.contents.map((content, index) =>
        index === 0 ? { ...content, followupsMd: '## 追问：为什么？\n\n因为。' } : content,
      ),
    };
    await repository.install(packageWithFollowups);

    const exported = await repository.exportPackage('facee-fixture');
    expect(exported?.catalog.id).toBe('facee-fixture');
    expect(exported?.contents).toHaveLength(TEST_QUESTION_BANK.contents.length);
    expect(exported?.contents[0].followupsMd).toBe('## 追问：为什么？\n\n因为。');
    expect(exported?.contents[0].questionMd).toBe(TEST_QUESTION_BANK.contents[0].questionMd);
    expect(exported?.contents[0].answerMd).toBe(TEST_QUESTION_BANK.contents[0].answerMd);

    // 反向重建的包换 id 后可直接安装（合法、无资产路径残留）
    await expect(
      repository.install({ catalog: { ...exported!.catalog, id: 'local-roundtrip' }, contents: exported!.contents }),
    ).resolves.toMatchObject({ questionCount: TEST_QUESTION_BANK.contents.length });
  });

  it('install 重建时从同 catalogId 旧安装继承题目资产（本地题库编辑不丢图）', async () => {
    const fileSystem = new CopyableFileSystem();
    const repository = new FileSystemQuestionBankRepository({ fileSystem: fileSystem as never });

    // 首次安装后给 fixture 第一题放一个资产目录（模拟线上库自带的图片）
    await repository.install(TEST_QUESTION_BANK);
    const firstNamespace = (await repository.listBanks()).find((bank) => bank.active)?.namespace;
    const firstQuestionId = TEST_QUESTION_BANK.contents[0].id;
    const assetsRoot = `file:///documents/facee-question-bank/banks/${firstNamespace}/questions/${firstQuestionId}/assets/`;
    await fileSystem.makeDirectoryAsync(assetsRoot);
    await fileSystem.writeAsStringAsync(`${assetsRoot}diagram.png`, 'png-bytes');

    // 同 catalogId 重新安装（编辑保存路径）：新 namespace 里资产必须还在
    await repository.install(TEST_QUESTION_BANK);
    const reinstalledNamespace = (await repository.listBanks()).find((bank) => bank.active)?.namespace;
    expect(reinstalledNamespace).not.toBe(firstNamespace);
    await expect(
      fileSystem.readAsStringAsync(
        `file:///documents/facee-question-bank/banks/${reinstalledNamespace}/questions/${firstQuestionId}/assets/diagram.png`,
      ),
    ).resolves.toBe('png-bytes');

    // 其它 catalogId 的安装不继承（首次安装没有可继承对象）
    await repository.install(bankWithId('local-other'));
    const otherNamespace = (await repository.listBanks()).find((bank) => bank.catalogId === 'local-other')
      ?.namespace;
    const info = await fileSystem.getInfoAsync(
      `file:///documents/facee-question-bank/banks/${otherNamespace}/questions/${firstQuestionId}/assets/`,
    );
    expect(info.exists).toBe(false);
  });

  it('exportPackage 找不到题库返回 null', async () => {
    const repository = new FileSystemQuestionBankRepository({ fileSystem: new MemoryFileSystem() as never });
    expect(await repository.exportPackage('local-none')).toBeNull();
  });

  it('copyBankAssets 把源库资产目录复制进目标库，无资产的题跳过', async () => {
    const fileSystem = new CopyableFileSystem();
    const repository = new FileSystemQuestionBankRepository({ fileSystem: fileSystem as never });

    await repository.install(TEST_QUESTION_BANK);
    const sourceNamespace = (await repository.listBanks()).find((bank) => bank.active)?.namespace;
    expect(sourceNamespace).toBeTruthy();
    // 给源库第一题放一个 assets 目录
    const firstQuestionId = TEST_QUESTION_BANK.contents[0].id;
    const assetsRoot = `file:///documents/facee-question-bank/banks/${sourceNamespace}/questions/${firstQuestionId}/assets/`;
    await fileSystem.makeDirectoryAsync(assetsRoot);
    await fileSystem.writeAsStringAsync(`${assetsRoot}diagram.png`, 'png-bytes');

    await repository.install(bankWithId('local-copy'));
    const targetNamespace = (await repository.listBanks()).find((bank) => bank.catalogId === 'local-copy')
      ?.namespace;
    expect(targetNamespace).toBeTruthy();

    await repository.copyBankAssets('facee-fixture', 'local-copy');

    expect(fileSystem.copied).toHaveLength(1);
    expect(fileSystem.copied[0].to).toBe(
      `file:///documents/facee-question-bank/banks/${targetNamespace}/questions/${firstQuestionId}/assets/`,
    );
    await expect(
      fileSystem.readAsStringAsync(
        `file:///documents/facee-question-bank/banks/${targetNamespace}/questions/${firstQuestionId}/assets/diagram.png`,
      ),
    ).resolves.toBe('png-bytes');
  });

  it('restoreBankAssets 从备份暂存目录回填图片到已装命名空间', async () => {
    const freshFs = new CopyableFileSystem();
    const freshRepository = new FileSystemQuestionBankRepository({ fileSystem: freshFs as never });
    await freshRepository.install(bankWithId('local-my-bank'));
    const freshNamespace = (await freshRepository.listBanks()).find((bank) => bank.active)?.namespace;
    expect(freshNamespace).toBeTruthy();

    // 模拟解压后的备份暂存内容（新设备上没有任何资产）
    const stagedRoot = 'file:///cache/backup-assets/';
    const firstQuestionId = TEST_QUESTION_BANK.contents[0].id;
    await freshFs.makeDirectoryAsync(`${stagedRoot}local-my-bank/${firstQuestionId}/assets/`);
    await freshFs.writeAsStringAsync(`${stagedRoot}local-my-bank/${firstQuestionId}/assets/diagram.png`, 'png-bytes');

    await freshRepository.install(bankWithId('local-imported'));
    const importedNamespace = (await freshRepository.listBanks()).find((bank) => bank.catalogId === 'local-imported')?.namespace;
    await freshRepository.restoreBankAssets(stagedRoot, 'local-my-bank', 'local-imported');

    await expect(
      freshFs.readAsStringAsync(
        `file:///documents/facee-question-bank/banks/${importedNamespace}/questions/${firstQuestionId}/assets/diagram.png`,
      ),
    ).resolves.toBe('png-bytes');
    expect((await freshFs.getInfoAsync(`file:///documents/facee-question-bank/banks/${freshNamespace}/questions/${firstQuestionId}/assets/diagram.png`)).exists).toBe(false);
  });
});
