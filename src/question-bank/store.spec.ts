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
}));

import { questionBankRepository } from './client';
import { loadLocalBankSource, saveLocalBankSource } from './local-banks';
import { useQuestionBankStore } from './store';
import type { RemoteQuestionBankRepository } from './types';

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
    installMock.mockResolvedValue({ questionCount: 6, tagCount: 4 });
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
    installMock.mockResolvedValue({ questionCount: 6, tagCount: 4 });
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
    installFromUrlMock.mockResolvedValue({
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
      { reuseCatalogId: 'local-a' },
    );
    expect(saveLocalBankSourceMock).toHaveBeenCalledWith(
      expect.objectContaining({ bankId: 'local-a', sourceUrl }),
    );
    expect(switchBankMock).toHaveBeenCalledWith('local-other');
    expect(diff).toEqual({ added: 1, removed: 1 });
    expect(useQuestionBankStore.getState().installing).toBe(false);
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
