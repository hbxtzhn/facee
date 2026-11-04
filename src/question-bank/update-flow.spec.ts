/**
 * 跨层测试：真实 store + 真实 FileSystemQuestionBankRepository + 真实 local-banks，
 * 只替换文件系统（内存）、ZIP 模块与 fetch。store.spec 整体 mock 了仓库，
 * 跨层的契约问题（版本短路、指纹、注册表、源文件解析次数）在这里验证。
 */
import { afterAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('expo-file-system/legacy', () =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('./__fixtures__/memory-file-system').createMemoryFileSystem());
jest.mock('react-native-zip-archive', () =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('./__fixtures__/memory-file-system').createMemoryZipArchive(require('expo-file-system/legacy')));

/* eslint-disable import/first */
import * as LegacyFileSystem from 'expo-file-system/legacy';
import type { MemoryFileSystem } from './__fixtures__/memory-file-system';
import { TEST_QUESTION_BANK } from './fixture';
import { questionBankRepository } from './client';
import { listLocalBankSources, loadLocalBankSource, upsertQuestion } from './local-banks';
import { ONLINE_BANK_NOT_EDITABLE_MESSAGE, useQuestionBankStore } from './store';
import type { QuestionBankPackage } from './types';
/* eslint-enable import/first */

const memoryFs = LegacyFileSystem as unknown as MemoryFileSystem;
const RELEASE_URL = 'https://github.com/HBxtzhn/facee-bank/releases/download/v1.0.0/question-bank.zip';
const LATEST_URL = 'https://github.com/HBxtzhn/facee-bank/releases/latest/download/question-bank.zip';
const ARCHIVE_URL = 'https://github.com/HBxtzhn/facee-bank/archive/refs/heads/main.zip';
const ROOT = 'file:///documents/facee-question-bank/';

const originalFetch = global.fetch;
const fetchMock = jest.fn<typeof fetch>();

function remotePackage(version: string | undefined, answerSuffix = ''): QuestionBankPackage {
  const { version: _ignored, ...catalog } = TEST_QUESTION_BANK.catalog;
  return {
    catalog: { ...catalog, ...(version ? { version } : {}) },
    contents: TEST_QUESTION_BANK.contents.map((content) => ({
      ...content,
      answerMd: content.answerMd === null ? null : `${content.answerMd}${answerSuffix}`,
    })),
  };
}

function setRemote(bank: QuestionBankPackage, assets: Record<string, Record<string, string>> = {}) {
  memoryFs.remote.package = bank;
  memoryFs.remote.assets = assets;
}

async function download(url: string): Promise<string> {
  useQuestionBankStore.getState().setSourceUrl(url);
  await expect(useQuestionBankStore.getState().installConfigured()).resolves.toBe(true);
  const match = await useQuestionBankStore.getState().findBankBySourceUrl(url);
  if (!match) throw new Error('download did not register a source');
  return match.bankId;
}

/** 旧模型下「编辑过」的下载库：重新关联地址（视为已修改）后改一道题 */
async function makeLegacyEdited(bankId: string, url: string): Promise<void> {
  await useQuestionBankStore.getState().setBankSourceUrl(bankId, url);
  const source = await loadLocalBankSource(bankId);
  if (!source) throw new Error('missing source');
  const first = source.package.catalog.questions[0];
  const content = source.package.contents.find((item) => item.id === first.id)!;
  await useQuestionBankStore.getState().saveLocalBank({
    ...source,
    package: upsertQuestion(source.package, {
      id: first.id, title: first.title, difficulty: first.difficulty, tags: [],
      questionMd: content.questionMd, answerMd: '本地改过的答案',
    }),
  });
}

beforeEach(() => {
  memoryFs.entries.clear();
  memoryFs.reads.length = 0;
  memoryFs.remote.downloads.length = 0;
  memoryFs.remote.downloadStatus = 200;
  setRemote(remotePackage('1.0.0'));
  fetchMock.mockReset();
  // 默认：版本接口不可达（限流/被墙）
  fetchMock.mockRejectedValue(new Error('network unreachable'));
  global.fetch = fetchMock;
  useQuestionBankStore.setState({
    catalog: null, status: 'idle', installing: false, installProgress: null, installError: null,
    sourceUrl: '', banks: [], banksLoading: false,
  });
});
afterAll(() => { global.fetch = originalFetch; });

describe('线上题库（下载后只读，只能在线更新）', () => {
  it('下载的题库显示为 online、不可编辑；保存被拒绝，复制后才可编辑', async () => {
    const bankId = await download(RELEASE_URL);
    const store = useQuestionBankStore.getState();
    const bank = useQuestionBankStore.getState().banks.find((item) => item.catalogId === bankId);
    expect(bank).toMatchObject({ source: 'online', editable: false, sourceUrl: RELEASE_URL });
    expect(store.isBankEditable(bankId)).toBe(false);
    expect((await loadLocalBankSource(bankId))?.remoteFingerprint).toMatch(/^fp1-/);

    const source = (await loadLocalBankSource(bankId))!;
    await expect(useQuestionBankStore.getState().saveLocalBank(source))
      .rejects.toThrow(ONLINE_BANK_NOT_EDITABLE_MESSAGE);
    // 即使调用方传入去掉 sourceUrl 的过期副本，也按磁盘上的源拒绝
    const { sourceUrl: _url, ...stripped } = source;
    await expect(useQuestionBankStore.getState().saveLocalBank(stripped))
      .rejects.toThrow(ONLINE_BANK_NOT_EDITABLE_MESSAGE);
    expect((await loadLocalBankSource(bankId))?.locallyModified).toBeUndefined();

    const copyId = await useQuestionBankStore.getState().copyBank(bankId);
    expect(useQuestionBankStore.getState().banks.find((item) => item.catalogId === copyId))
      .toMatchObject({ source: 'local', editable: true });
    expect(useQuestionBankStore.getState().isBankEditable(copyId)).toBe(true);
  });

  it('版本接口失败时降级到 latest/download，同版本包不替换、不询问', async () => {
    const bankId = await download(RELEASE_URL);
    const result = await useQuestionBankStore.getState().updateBank(bankId);
    expect(result).toEqual({ added: 0, removed: 0, updated: false });
    expect(memoryFs.remote.downloads.at(-1)).toBe(LATEST_URL);
    expect(useQuestionBankStore.getState().installError).toBeNull();
  });

  it('版本接口 403 时仍可凭包内版本完成更新，从不询问', async () => {
    const bankId = await download(RELEASE_URL);
    fetchMock.mockResolvedValue({ ok: false, status: 403 } as Response);
    setRemote(remotePackage('1.1.0', '（新版）'));
    const result = await useQuestionBankStore.getState().updateBank(bankId);
    expect(result).toMatchObject({ updated: true });
    expect(result.needsConfirmation).toBeUndefined();
    expect((await loadLocalBankSource(bankId))?.package.catalog.version).toBe('1.1.0');
  });

  it('只有下载本身失败才报错', async () => {
    const bankId = await download(RELEASE_URL);
    memoryFs.remote.downloadStatus = 404;
    await expect(useQuestionBankStore.getState().updateBank(bankId)).rejects.toThrow('HTTP 404');
    expect(useQuestionBankStore.getState().installError).toContain('HTTP 404');
  });

  it('重新添加同一地址：findBankBySourceUrl 找到它（忽略空白），再次下载原地更新', async () => {
    const bankId = await download(RELEASE_URL);
    await expect(useQuestionBankStore.getState().findBankBySourceUrl(`  ${RELEASE_URL} `))
      .resolves.toEqual({ bankId, title: TEST_QUESTION_BANK.catalog.title, locallyModified: false });
    await expect(useQuestionBankStore.getState().findBankBySourceUrl('https://example.com/other.zip'))
      .resolves.toBeNull();
    setRemote(remotePackage('1.1.0'));
    await download(RELEASE_URL);
    expect((await listLocalBankSources()).map((item) => item.bankId)).toEqual([bankId]);
  });
});

describe('旧模型下编辑过的库（显示为本地，更新前确认）', () => {
  it('版本未知且线上没变：不询问；keepCopy 也不留副本', async () => {
    setRemote(remotePackage(undefined));
    const bankId = await download(ARCHIVE_URL);
    await makeLegacyEdited(bankId, ARCHIVE_URL);
    expect(useQuestionBankStore.getState().banks.find((item) => item.catalogId === bankId))
      .toMatchObject({ source: 'local', editable: true, locallyModified: true });
    const bankCount = useQuestionBankStore.getState().banks.length;

    await expect(useQuestionBankStore.getState().updateBank(bankId))
      .resolves.toEqual({ added: 0, removed: 0, updated: false });
    await expect(useQuestionBankStore.getState().updateBank(bankId, { onLocalEdits: 'keepCopy' }))
      .resolves.toEqual({ added: 0, removed: 0, updated: false });
    expect(useQuestionBankStore.getState().banks).toHaveLength(bankCount);
    expect(await listLocalBankSources()).toHaveLength(1);
    // dry-run 不残留暂存/下载
    expect([...memoryFs.entries.keys()].filter((key) => key.includes('/staging/staging-'))).toEqual([]);
    expect([...memoryFs.entries.keys()].filter((key) => key.includes('.zip.part'))).toEqual([]);
    // 编辑仍在
    const source = await loadLocalBankSource(bankId);
    expect(source?.locallyModified).toBe(true);
    expect(source?.package.contents.some((item) => item.answerMd === '本地改过的答案')).toBe(true);
  });

  it('版本未知且线上内容变了：先询问，keepCopy 后保留副本并更新原库', async () => {
    setRemote(remotePackage(undefined));
    const bankId = await download(ARCHIVE_URL);
    await makeLegacyEdited(bankId, ARCHIVE_URL);
    setRemote(remotePackage(undefined, '（线上修订）'));

    await expect(useQuestionBankStore.getState().updateBank(bankId))
      .resolves.toMatchObject({ updated: false, needsConfirmation: true });
    const result = await useQuestionBankStore.getState().updateBank(bankId, { onLocalEdits: 'keepCopy' });
    expect(result).toMatchObject({ updated: true });
    expect(result.copiedBankId).toBeDefined();
    const copy = await loadLocalBankSource(result.copiedBankId!);
    expect(copy?.package.contents.some((item) => item.answerMd === '本地改过的答案')).toBe(true);
    const updated = await loadLocalBankSource(bankId);
    expect(updated?.locallyModified).toBeFalsy();
    expect(useQuestionBankStore.getState().banks.find((item) => item.catalogId === bankId))
      .toMatchObject({ source: 'online', editable: false });
  });

  it('「直接覆盖」同版本也强制重装：编辑与已修改标记被清除，回到线上题库', async () => {
    const bankId = await download(RELEASE_URL);
    await makeLegacyEdited(bankId, RELEASE_URL);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: '1.0.0', assets: [{ name: 'question-bank.zip', browser_download_url: LATEST_URL }] }),
    } as unknown as Response);
    // 同版本：不覆盖时视为无更新
    await expect(useQuestionBankStore.getState().updateBank(bankId))
      .resolves.toEqual({ added: 0, removed: 0, updated: false });
    const result = await useQuestionBankStore.getState().updateBank(bankId, { onLocalEdits: 'overwrite' });
    expect(result).toMatchObject({ updated: true });
    const source = await loadLocalBankSource(bankId);
    expect(source?.locallyModified).toBeFalsy();
    expect(source?.package.contents.some((item) => item.answerMd === '本地改过的答案')).toBe(false);
    expect(useQuestionBankStore.getState().isBankEditable(bankId)).toBe(false);
  });
});

describe('store 其他修复', () => {
  it('refreshBanks 每个源文件只解析一次', async () => {
    await download(RELEASE_URL);
    await useQuestionBankStore.getState().createLocalBank('我的库');
    memoryFs.reads.length = 0;
    await useQuestionBankStore.getState().refreshBanks();
    const sourceReads = memoryFs.reads.filter((uri) => uri.includes('/local-sources/'));
    expect(sourceReads).toHaveLength(2);
    expect(new Set(sourceReads).size).toBe(2);
  });

  it('installConfigured 在忙时返回 false 并设置 installError，不会 reject', async () => {
    useQuestionBankStore.setState({ installing: true, sourceUrl: RELEASE_URL });
    await expect(useQuestionBankStore.getState().installConfigured()).resolves.toBe(false);
    expect(useQuestionBankStore.getState().installError).toBe('正在处理题库，请稍后再试');
  });
});

describe('旧版本（v0.1.0 前）题库迁移', () => {
  async function seedLegacyBank() {
    const namespace = 'legacy-ns';
    const base = `${ROOT}banks/${namespace}/`;
    const catalog = { ...TEST_QUESTION_BANK.catalog, id: 'facee-java' };
    await memoryFs.writeAsStringAsync(`${base}catalog.json`, JSON.stringify(catalog));
    for (const content of TEST_QUESTION_BANK.contents) {
      await memoryFs.writeAsStringAsync(`${base}questions/${content.id}/question.md`, content.questionMd);
      if (content.answerMd !== null) {
        await memoryFs.writeAsStringAsync(`${base}questions/${content.id}/answer.md`, content.answerMd);
      }
    }
    const firstId = TEST_QUESTION_BANK.contents[0].id;
    await memoryFs.writeAsStringAsync(`${base}questions/${firstId}/assets/diagram.png`, 'PNG');
    await memoryFs.writeAsStringAsync(`${ROOT}active`, namespace);
    return { namespace, firstId };
  }

  it('启动时补登记（不改 id）、幂等；复制旧库带上图片；旧库显示为线上', async () => {
    const { namespace, firstId } = await seedLegacyBank();
    await useQuestionBankStore.getState().initialize();
    const registry = JSON.parse(await memoryFs.readAsStringAsync(`${ROOT}registry.json`));
    expect(registry).toEqual({ 'facee-java': namespace });
    expect(useQuestionBankStore.getState().catalog?.id).toBe('facee-java');
    expect(useQuestionBankStore.getState().banks[0]).toMatchObject({
      catalogId: 'facee-java', source: 'online', editable: false,
    });

    // 再次迁移：已完成，不再改动
    await expect(questionBankRepository.migrateLegacyBanks!()).resolves.toBe(0);
    await useQuestionBankStore.getState().initialize();
    expect(JSON.parse(await memoryFs.readAsStringAsync(`${ROOT}registry.json`))).toEqual(registry);

    const copyId = await useQuestionBankStore.getState().copyBank('facee-java');
    const copyNamespace = JSON.parse(await memoryFs.readAsStringAsync(`${ROOT}registry.json`))[copyId];
    await expect(memoryFs.readAsStringAsync(
      `${ROOT}banks/${copyNamespace}/questions/${firstId}/assets/diagram.png`,
    )).resolves.toBe('PNG');
  });

  it('未登记库的复制在迁移前也能带上图片（copyBankAssets 兜底扫描）', async () => {
    const { firstId } = await seedLegacyBank();
    const copyId = await useQuestionBankStore.getState().copyBank('facee-java');
    const registry = JSON.parse(await memoryFs.readAsStringAsync(`${ROOT}registry.json`));
    await expect(memoryFs.readAsStringAsync(
      `${ROOT}banks/${registry[copyId]}/questions/${firstId}/assets/diagram.png`,
    )).resolves.toBe('PNG');
  });

  it('迁移出错不阻塞启动', async () => {
    await seedLegacyBank();
    const repository = questionBankRepository as { migrateLegacyBanks?: () => Promise<number> };
    repository.migrateLegacyBanks = () => Promise.reject(new Error('boom'));
    try {
      await useQuestionBankStore.getState().initialize();
      expect(useQuestionBankStore.getState().status).toBe('ready');
      expect(useQuestionBankStore.getState().catalog?.id).toBe('facee-java');
    } finally {
      // 删除实例上的替身，恢复原型方法
      delete repository.migrateLegacyBanks;
    }
  });
});
