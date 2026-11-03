import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { TEST_QUESTION_BANK } from './fixture';
import type { LocalBankSource } from './local-banks';

jest.mock('./client', () => ({
  questionBankRepository: {
    getCatalog: jest.fn(),
    getQuestion: jest.fn(),
    getContent: jest.fn(),
    listQuestions: jest.fn(),
    searchBody: jest.fn(),
    install: jest.fn(),
    installFromUrl: jest.fn(),
    clear: jest.fn(),
    listBanks: jest.fn(),
    getQuestionIds: jest.fn(),
    switchBank: jest.fn(),
    deleteBank: jest.fn(),
    exportPackage: jest.fn(),
    copyBankAssets: jest.fn(),
  },
  asRemoteQuestionBankRepository: (repo: unknown) => repo,
}));

// saveLocalBankSource / loadLocalBankSource 走真文件系统，测试里只验证编排顺序
jest.mock('./local-banks', () => ({
  ...(jest.requireActual('./local-banks') as Record<string, unknown>),
  saveLocalBankSource: jest.fn(),
  loadLocalBankSource: jest.fn(),
  listLocalBankSources: jest.fn(),
}));

import { questionBankRepository } from './client';
import { listLocalBankSources, loadLocalBankSource, saveLocalBankSource } from './local-banks';
import { useQuestionBankStore } from './store';
import type { InstallResult, RemoteQuestionBankRepository } from './types';

const exportPackageMock =
  questionBankRepository.exportPackage as jest.MockedFunction<typeof questionBankRepository.exportPackage>;
const installMock = questionBankRepository.install as jest.MockedFunction<typeof questionBankRepository.install>;
const getCatalogMock = questionBankRepository.getCatalog as jest.MockedFunction<
  typeof questionBankRepository.getCatalog
>;
const copyBankAssetsMock = questionBankRepository.copyBankAssets as jest.MockedFunction<
  typeof questionBankRepository.copyBankAssets
>;
const saveLocalBankSourceMock = saveLocalBankSource as jest.MockedFunction<typeof saveLocalBankSource>;
const loadLocalBankSourceMock = loadLocalBankSource as jest.MockedFunction<typeof loadLocalBankSource>;
const listLocalBankSourcesMock = listLocalBankSources as jest.MockedFunction<typeof listLocalBankSources>;
const remoteRepository = questionBankRepository as unknown as RemoteQuestionBankRepository;
const installFromUrlMock = remoteRepository.installFromUrl as jest.MockedFunction<
  typeof remoteRepository.installFromUrl
>;
const getQuestionIdsMock = questionBankRepository.getQuestionIds as jest.MockedFunction<
  typeof questionBankRepository.getQuestionIds
>;
const listBanksMock = questionBankRepository.listBanks as jest.MockedFunction<
  typeof questionBankRepository.listBanks
>;
const switchBankMock = questionBankRepository.switchBank as jest.MockedFunction<
  typeof questionBankRepository.switchBank
>;

function mockRemoteResult(result: InstallResult) {
  installFromUrlMock.mockImplementation(async (_url, _progress, options) => {
    if (result.localSource) await options?.beforeCommit?.(result.localSource.package);
    return result;
  });
}

beforeEach(() => {
  listLocalBankSourcesMock.mockResolvedValue([]);
  installMock.mockImplementation(async (bank, _progress, options) => {
    await options?.beforeCommit?.(bank);
    return { questionCount: bank.catalog.questions.length, tagCount: bank.catalog.tags.length };
  });
});

describe('question-bank store copyBank（复制为本地题库）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useQuestionBankStore.setState({
      catalog: null,
      status: 'idle',
      installing: false,
      installProgress: null,
      installError: null,
      banks: [],
      banksLoading: false,
    });
  });

  it('导出 → 落盘 → 安装激活 → 拷资产 → 刷新，返回 local- 副本 id', async () => {
    exportPackageMock.mockResolvedValue(TEST_QUESTION_BANK);
    getCatalogMock.mockResolvedValue(TEST_QUESTION_BANK.catalog);
    copyBankAssetsMock.mockResolvedValue(undefined);
    saveLocalBankSourceMock.mockResolvedValue(undefined);

    const bankId = await useQuestionBankStore.getState().copyBank('facee-fixture');

    expect(bankId).toMatch(/^local-[a-z0-9]+$/);
    expect(exportPackageMock).toHaveBeenCalledWith('facee-fixture');
    expect(saveLocalBankSourceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        bankId,
        package: expect.objectContaining({ catalog: expect.objectContaining({ id: bankId }) }),
      }),
    );
    expect(installMock).toHaveBeenCalledTimes(1);
    // 资产复制在 install 之后（目标命名空间登记依赖 install 完成注册表）
    expect(copyBankAssetsMock).toHaveBeenCalledWith('facee-fixture', bankId);
    expect(useQuestionBankStore.getState().status).toBe('ready');
  });

  it('副本标题追加（副本）且内容原样保留', async () => {
    exportPackageMock.mockResolvedValue(TEST_QUESTION_BANK);
    getCatalogMock.mockResolvedValue(TEST_QUESTION_BANK.catalog);

    await useQuestionBankStore.getState().copyBank('facee-fixture');

    const source = saveLocalBankSourceMock.mock.calls[0][0] as LocalBankSource;
    expect(source.package.catalog.title).toBe('FaceE 示例题库（副本）');
    // 内容原样保留（followupsMd 规范化为 null，与 QuestionContent 类型一致）
    expect(source.package.contents).toEqual(
      TEST_QUESTION_BANK.contents.map((content) => ({ ...content, followupsMd: content.followupsMd ?? null })),
    );
  });

  it('题库不存在（导出为 null）向上抛错且不落盘', async () => {
    exportPackageMock.mockResolvedValue(null);

    await expect(useQuestionBankStore.getState().copyBank('local-none')).rejects.toThrow('没有找到题库');
    expect(saveLocalBankSourceMock).not.toHaveBeenCalled();
    expect(installMock).not.toHaveBeenCalled();
  });
});

describe('question-bank store updateBank（题库在线更新）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useQuestionBankStore.setState({
      catalog: null,
      status: 'idle',
      installing: false,
      installProgress: null,
      installError: null,
      banks: [],
      banksLoading: false,
    });
    listBanksMock.mockResolvedValue([]);
  });

  it('按记录的 sourceUrl 整包重下并复用 catalogId，报告新增/移除题数', async () => {
    const sourceUrl = 'https://example.com/bank.zip';
    loadLocalBankSourceMock.mockResolvedValue({
      bankId: 'local-a',
      updatedAt: '',
      package: TEST_QUESTION_BANK,
      sourceUrl,
    });
    getQuestionIdsMock
      .mockResolvedValueOnce(new Set(['q1', 'q2']))
      .mockResolvedValueOnce(new Set(['q2', 'q3']));
    mockRemoteResult({
      questionCount: 6,
      tagCount: 4,
      localSource: { bankId: 'local-a', updatedAt: '', package: TEST_QUESTION_BANK, sourceUrl },
    });
    saveLocalBankSourceMock.mockResolvedValue(undefined);
    getCatalogMock.mockResolvedValue(TEST_QUESTION_BANK.catalog);

    // 当前激活的是另一题库：更新完成后应切回去
    useQuestionBankStore.setState({ catalog: { ...TEST_QUESTION_BANK.catalog, id: 'local-other' } });

    const diff = await useQuestionBankStore.getState().updateBank('local-a');

    expect(installFromUrlMock).toHaveBeenCalledWith(
      sourceUrl,
      expect.any(Function),
      { reuseCatalogId: 'local-a', currentVersion: undefined, beforeCommit: expect.any(Function) },
    );
    expect(saveLocalBankSourceMock).toHaveBeenCalledWith(
      expect.objectContaining({ bankId: 'local-a', sourceUrl }),
    );
    expect(switchBankMock).toHaveBeenCalledWith('local-other');
    expect(diff).toEqual({ added: 1, removed: 1, updated: true });
    expect(useQuestionBankStore.getState().installing).toBe(false);
  });

  it.each(['1.2.0', '1.1.0'])('Release 版本 %s 不高于本地时不下载ZIP', async (version) => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: `v${version}`, assets: [{
        name: 'bank.zip', browser_download_url: 'https://github.com/o/r/releases/download/new/bank.zip',
      }] }),
    } as Response);
    try {
      loadLocalBankSourceMock.mockResolvedValue({
        bankId: 'local-a', updatedAt: '',
        sourceUrl: 'https://github.com/o/r/releases/download/v1.0.0/bank.zip',
        package: { ...TEST_QUESTION_BANK, catalog: { ...TEST_QUESTION_BANK.catalog, version: '1.2.0' } },
      });
      getQuestionIdsMock.mockResolvedValue(new Set(['q1']));
      await expect(useQuestionBankStore.getState().updateBank('local-a'))
        .resolves.toEqual({ added: 0, removed: 0, updated: false });
      expect(installFromUrlMock).not.toHaveBeenCalled();
      expect(saveLocalBankSourceMock).not.toHaveBeenCalled();
      expect(switchBankMock).not.toHaveBeenCalled();
    } finally { fetchMock.mockRestore(); }
  });

  it('新版Release下载新地址，保存原来源供下次更新继续使用', async () => {
    const originalUrl = 'https://github.com/o/r/releases/download/v1.0.0/bank-old.zip';
    const newUrl = 'https://github.com/o/r/releases/download/v1.3.0/bank-new.zip';
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: 'v1.3.0', assets: [{ name: 'bank-new.zip', browser_download_url: newUrl }] }),
    } as Response);
    try {
      loadLocalBankSourceMock.mockResolvedValue({
        bankId: 'local-a', updatedAt: '', sourceUrl: originalUrl,
        package: { ...TEST_QUESTION_BANK, catalog: { ...TEST_QUESTION_BANK.catalog, version: '1.2.0' } },
      });
      getQuestionIdsMock.mockResolvedValue(new Set(['q1']));
      getCatalogMock.mockResolvedValue(TEST_QUESTION_BANK.catalog);
      mockRemoteResult({ questionCount: 6, tagCount: 4, localSource: {
        bankId: 'local-a', updatedAt: '', package: TEST_QUESTION_BANK, sourceUrl: newUrl,
      } });
      await expect(useQuestionBankStore.getState().updateBank('local-a'))
        .resolves.toEqual({ added: 0, removed: 0, updated: true });
      expect(installFromUrlMock).toHaveBeenCalledWith(
        newUrl, expect.any(Function), { reuseCatalogId: 'local-a', currentVersion: '1.2.0', beforeCommit: expect.any(Function) },
      );
      expect(saveLocalBankSourceMock).toHaveBeenCalledWith(expect.objectContaining({ sourceUrl: originalUrl }));
    } finally { fetchMock.mockRestore(); }
  });

  it('包内版本未变化时不保存、不切换题库，返回未更新', async () => {
    loadLocalBankSourceMock.mockResolvedValue({
      bankId: 'local-a', updatedAt: '', sourceUrl: 'https://example.com/bank.zip',
      package: { ...TEST_QUESTION_BANK, catalog: { ...TEST_QUESTION_BANK.catalog, version: '1.2.0' } },
    });
    getQuestionIdsMock.mockResolvedValue(new Set(['q1']));
    installFromUrlMock.mockResolvedValue({ questionCount: 1, tagCount: 1, unchanged: true });

    await expect(useQuestionBankStore.getState().updateBank('local-a'))
      .resolves.toEqual({ added: 0, removed: 0, updated: false });
    expect(installFromUrlMock).toHaveBeenCalledWith(
      'https://example.com/bank.zip', expect.any(Function),
      { reuseCatalogId: 'local-a', currentVersion: '1.2.0', beforeCommit: expect.any(Function) },
    );
    expect(saveLocalBankSourceMock).not.toHaveBeenCalled();
    expect(switchBankMock).not.toHaveBeenCalled();
    expect(useQuestionBankStore.getState().installProgress).toBeNull();
  });

  it('没有记录下载地址时直接报错，不发起下载', async () => {
    loadLocalBankSourceMock.mockResolvedValue({
      bankId: 'local-a',
      updatedAt: '',
      package: TEST_QUESTION_BANK,
    });

    await expect(useQuestionBankStore.getState().updateBank('local-a')).rejects.toThrow('没有记录下载地址');
    expect(installFromUrlMock).not.toHaveBeenCalled();
  });
});

describe('question-bank store 下载库本地修改保护', () => {
  const sourceUrl = 'https://example.com/bank.zip';
  const editedPackage = {
    ...TEST_QUESTION_BANK,
    catalog: { ...TEST_QUESTION_BANK.catalog, id: 'local-a', title: '下载库' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    useQuestionBankStore.setState({
      catalog: null,
      status: 'idle',
      installing: false,
      installProgress: null,
      installError: null,
      banks: [],
      banksLoading: false,
    });
    listBanksMock.mockResolvedValue([]);
    listLocalBankSourcesMock.mockResolvedValue([]);
    saveLocalBankSourceMock.mockResolvedValue(undefined);
    getCatalogMock.mockResolvedValue(TEST_QUESTION_BANK.catalog);
    getQuestionIdsMock.mockResolvedValue(new Set(['q1']));
    copyBankAssetsMock.mockResolvedValue(undefined);
  });

  function seedModifiedSource() {
    loadLocalBankSourceMock.mockResolvedValue({
      bankId: 'local-a', updatedAt: '', package: editedPackage, sourceUrl, locallyModified: true,
    });
  }

  it('编辑保存带下载地址的库会标记 locallyModified；纯本地库不加标记', async () => {
    await useQuestionBankStore.getState().saveLocalBank({
      bankId: 'local-a', updatedAt: '', package: editedPackage, sourceUrl,
    });
    expect(saveLocalBankSourceMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ bankId: 'local-a', sourceUrl, locallyModified: true }),
    );

    await useQuestionBankStore.getState().saveLocalBank({
      bankId: 'local-a', updatedAt: '', package: editedPackage,
    });
    const plain = saveLocalBankSourceMock.mock.calls.at(-1)?.[0] as LocalBankSource;
    expect(plain.locallyModified).toBeUndefined();
  });

  it('refreshBanks 把源文件里的已修改标记带到题库摘要', async () => {
    listBanksMock.mockResolvedValue([
      { catalogId: 'local-a', namespace: 'ns-a', title: '下载库', questionCount: 1, source: 'local', active: true },
      { catalogId: 'local-b', namespace: 'ns-b', title: '另一下载库', questionCount: 1, source: 'local', active: false },
    ]);
    listLocalBankSourcesMock.mockResolvedValue([
      { bankId: 'local-a', title: '下载库', questionCount: 1, updatedAt: '' },
      { bankId: 'local-b', title: '另一下载库', questionCount: 1, updatedAt: '' },
    ]);
    loadLocalBankSourceMock.mockImplementation(async (bankId) => ({
      bankId, updatedAt: '', package: editedPackage, sourceUrl,
      ...(bankId === 'local-a' ? { locallyModified: true } : {}),
    }));

    await useQuestionBankStore.getState().refreshBanks();

    const [a, b] = useQuestionBankStore.getState().banks;
    expect(a).toEqual(expect.objectContaining({ catalogId: 'local-a', sourceUrl, locallyModified: true }));
    expect(b.sourceUrl).toBe(sourceUrl);
    expect(b.locallyModified).toBeUndefined();
  });

  it('已修改且未决定时返回 needsConfirmation，不下载、不保存、不报错', async () => {
    seedModifiedSource();

    await expect(useQuestionBankStore.getState().updateBank('local-a'))
      .resolves.toEqual({ added: 0, removed: 0, updated: false, needsConfirmation: true });
    expect(installFromUrlMock).not.toHaveBeenCalled();
    expect(exportPackageMock).not.toHaveBeenCalled();
    expect(saveLocalBankSourceMock).not.toHaveBeenCalled();
    expect(switchBankMock).not.toHaveBeenCalled();
    expect(useQuestionBankStore.getState().installError).toBeNull();
    expect(useQuestionBankStore.getState().installing).toBe(false);
  });

  it('已修改但线上版本不高于本地时直接返回已是最新，不询问', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: 'v1.0.0', assets: [{
        name: 'bank.zip', browser_download_url: 'https://github.com/o/r/releases/download/v1.0.0/bank.zip',
      }] }),
    } as Response);
    try {
      loadLocalBankSourceMock.mockResolvedValue({
        bankId: 'local-a', updatedAt: '', locallyModified: true,
        sourceUrl: 'https://github.com/o/r/releases/download/v1.0.0/bank.zip',
        package: { ...editedPackage, catalog: { ...editedPackage.catalog, version: '1.0.0' } },
      });
      await expect(useQuestionBankStore.getState().updateBank('local-a'))
        .resolves.toEqual({ added: 0, removed: 0, updated: false });
      expect(installFromUrlMock).not.toHaveBeenCalled();
    } finally { fetchMock.mockRestore(); }
  });

  it('overwrite：直接整包更新，提交时复位 locallyModified，不另存副本', async () => {
    seedModifiedSource();
    mockRemoteResult({ questionCount: 6, tagCount: 4, localSource: {
      bankId: 'local-a', updatedAt: '', package: TEST_QUESTION_BANK, sourceUrl,
    } });

    const result = await useQuestionBankStore.getState().updateBank('local-a', { onLocalEdits: 'overwrite' });

    expect(result).toEqual({ added: 0, removed: 0, updated: true });
    expect(exportPackageMock).not.toHaveBeenCalled();
    expect(installFromUrlMock).toHaveBeenCalledTimes(1);
    expect(saveLocalBankSourceMock).toHaveBeenCalledTimes(1);
    expect(saveLocalBankSourceMock).toHaveBeenCalledWith(
      expect.objectContaining({ bankId: 'local-a', sourceUrl, locallyModified: false }),
    );
  });

  it.each([
    ['local-a', '更新的就是当前库'],
    ['local-other', '更新的是非当前库'],
  ])('keepCopy：先另存含本地修改的副本再更新，最后恢复原激活库（%s，%s）', async (activeId) => {
    seedModifiedSource();
    exportPackageMock.mockResolvedValue(editedPackage);
    mockRemoteResult({ questionCount: 6, tagCount: 4, localSource: {
      bankId: 'local-a', updatedAt: '', package: TEST_QUESTION_BANK, sourceUrl,
    } });
    useQuestionBankStore.setState({ catalog: { ...TEST_QUESTION_BANK.catalog, id: activeId } });

    const result = await useQuestionBankStore.getState().updateBank('local-a', { onLocalEdits: 'keepCopy' });

    expect(result.updated).toBe(true);
    expect(result.copiedBankId).toMatch(/^local-[a-z0-9]+$/);
    expect(result.copiedBankId).not.toBe('local-a');
    expect(exportPackageMock).toHaveBeenCalledWith('local-a');
    // 副本：新 id、保留编辑内容、无下载地址（纯本地库）
    const copy = saveLocalBankSourceMock.mock.calls[0][0] as LocalBankSource;
    expect(copy.bankId).toBe(result.copiedBankId);
    expect(copy.package.catalog.title).toBe('下载库（副本）');
    expect(copy.package.catalog.questions).toEqual(editedPackage.catalog.questions);
    expect(copy.sourceUrl).toBeUndefined();
    expect(copyBankAssetsMock).toHaveBeenCalledWith('local-a', copy.bankId);
    // 副本先装好，才覆盖原库
    expect(installMock.mock.invocationCallOrder[0]).toBeLessThan(installFromUrlMock.mock.invocationCallOrder[0]);
    expect(saveLocalBankSourceMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ bankId: 'local-a', locallyModified: false }),
    );
    // 副本安装会激活副本：结束时切回操作前的激活库
    expect(switchBankMock).toHaveBeenLastCalledWith(activeId);
  });

  it('keepCopy 但包内版本未变化：原库不动，保留副本并恢复激活库', async () => {
    seedModifiedSource();
    exportPackageMock.mockResolvedValue(editedPackage);
    installFromUrlMock.mockResolvedValue({ questionCount: 1, tagCount: 1, unchanged: true });
    useQuestionBankStore.setState({ catalog: { ...TEST_QUESTION_BANK.catalog, id: 'local-a' } });

    const result = await useQuestionBankStore.getState().updateBank('local-a', { onLocalEdits: 'keepCopy' });

    expect(result).toEqual({ added: 0, removed: 0, updated: false, copiedBankId: expect.any(String) });
    expect(saveLocalBankSourceMock).toHaveBeenCalledTimes(1);
    expect(switchBankMock).toHaveBeenLastCalledWith('local-a');
  });
});

describe('question-bank store setBankSourceUrl（找回丢失的更新地址）', () => {
  const localBank = {
    ...TEST_QUESTION_BANK,
    catalog: { ...TEST_QUESTION_BANK.catalog, id: 'local-lost-url' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    listLocalBankSourcesMock.mockResolvedValue([]);
    listBanksMock.mockResolvedValue([]);
    useQuestionBankStore.setState({ installing: false, installError: null, banks: [] });
  });

  it('写回源文件：保留题目内容，补上地址并保守标记为已修改', async () => {
    loadLocalBankSourceMock.mockResolvedValue({ bankId: 'local-lost-url', updatedAt: '', package: localBank });
    saveLocalBankSourceMock.mockResolvedValue(undefined);

    await useQuestionBankStore.getState().setBankSourceUrl(
      'local-lost-url', '  https://github.com/o/r/releases/latest/download/question-bank.zip ',
    );

    expect(saveLocalBankSourceMock).toHaveBeenCalledWith({
      bankId: 'local-lost-url',
      updatedAt: '',
      package: localBank,
      sourceUrl: 'https://github.com/o/r/releases/latest/download/question-bank.zip',
      locallyModified: true,
    });
    expect(listBanksMock).toHaveBeenCalled();
  });

  it('拒绝非 https 地址，不写源文件', async () => {
    await expect(useQuestionBankStore.getState().setBankSourceUrl('local-lost-url', 'ftp://x/bank.zip'))
      .rejects.toThrow('https://');
    expect(saveLocalBankSourceMock).not.toHaveBeenCalled();
  });

  it('源文件不存在时报错', async () => {
    loadLocalBankSourceMock.mockResolvedValue(null);
    await expect(useQuestionBankStore.getState().setBankSourceUrl('local-lost-url', 'https://e.com/b.zip'))
      .rejects.toThrow('没有找到本地题库');
    expect(saveLocalBankSourceMock).not.toHaveBeenCalled();
  });
});
