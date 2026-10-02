import {
  getQuestionBankInstallMode,
  installConfiguredQuestionBank,
} from './installer';
import type {
  QuestionBankRepository,
  RemoteQuestionBankRepository,
} from './types';
import { TEST_QUESTION_BANK } from './fixture';

jest.mock('./local-banks', () => ({
  listLocalBankSources: jest.fn(async () => []),
  loadLocalBankSource: jest.fn(async () => null),
  saveLocalBankSource: jest.fn(async () => undefined),
}));

// eslint-disable-next-line import/first
import {
  listLocalBankSources,
  loadLocalBankSource,
  saveLocalBankSource,
} from './local-banks';

const repository: QuestionBankRepository = {
  getCatalog: async () => null,
  getQuestion: async () => null,
  getContent: async () => null,
  listQuestions: async () => [],
  searchBody: async () => [],
  install: async () => ({ questionCount: 0, tagCount: 0 }),
  clear: async () => undefined,
  listBanks: async () => [],
  getQuestionIds: async () => null,
  switchBank: async () => undefined,
  deleteBank: async () => undefined,
  exportPackage: async () => null,
  copyBankAssets: async () => undefined,
  stageLocalBankAssets: async () => 0,
  restoreBankAssets: async () => undefined,
};

describe('configured question-bank installer', () => {
  const originalUrl = process.env.EXPO_PUBLIC_QUESTION_BANK_URL;

  afterEach(() => {
    if (originalUrl === undefined) {
      delete process.env.EXPO_PUBLIC_QUESTION_BANK_URL;
    } else {
      process.env.EXPO_PUBLIC_QUESTION_BANK_URL = originalUrl;
    }
  });

  it('does not fall back to bundled fixture data when the URL is absent', async () => {
    delete process.env.EXPO_PUBLIC_QUESTION_BANK_URL;

    expect(getQuestionBankInstallMode(repository)).toBe('unconfigured');
    await expect(installConfiguredQuestionBank(repository)).rejects.toThrow(
      '未配置线上题库地址',
    );
  });

  it('uses the configured full-package URL for a remote repository', async () => {
    process.env.EXPO_PUBLIC_QUESTION_BANK_URL = 'https://example.com/question-bank.zip';
    const installFromUrl = jest.fn(async () => ({ questionCount: 2, tagCount: 1 }));
    const remoteRepository: RemoteQuestionBankRepository = {
      ...repository,
      installFromUrl,
    };

    await expect(installConfiguredQuestionBank(remoteRepository)).resolves.toEqual({
      questionCount: 2,
      tagCount: 1,
    });
    expect(installFromUrl).toHaveBeenCalledWith(
      'https://example.com/question-bank.zip',
      undefined,
      undefined,
    );
    expect(saveLocalBankSource).not.toHaveBeenCalled();
  });

  it('下载即本地化：installFromUrl 返回的题库源会被落盘', async () => {
    process.env.EXPO_PUBLIC_QUESTION_BANK_URL = 'https://example.com/question-bank.zip';
    const localSource = {
      bankId: 'local-new',
      updatedAt: '',
      package: TEST_QUESTION_BANK,
      sourceUrl: 'https://example.com/question-bank.zip',
    };
    const installFromUrl = jest.fn(async () => ({ questionCount: 6, tagCount: 4, localSource }));
    const remoteRepository: RemoteQuestionBankRepository = {
      ...repository,
      installFromUrl,
    };

    await installConfiguredQuestionBank(remoteRepository);
    expect(saveLocalBankSource).toHaveBeenCalledWith(localSource);
  });

  it('同 URL 重复下载视为更新：沿用原 catalog.id', async () => {
    const url = 'https://example.com/question-bank.zip';
    process.env.EXPO_PUBLIC_QUESTION_BANK_URL = url;
    (listLocalBankSources as jest.Mock).mockResolvedValue([
      { bankId: 'local-old', title: '旧库', questionCount: 6, updatedAt: '' },
    ]);
    (loadLocalBankSource as jest.Mock).mockResolvedValue({
      bankId: 'local-old',
      updatedAt: '',
      package: TEST_QUESTION_BANK,
      sourceUrl: url,
    });
    const installFromUrl = jest.fn(async () => ({
      questionCount: 6,
      tagCount: 4,
      localSource: { bankId: 'local-old', updatedAt: '', package: TEST_QUESTION_BANK, sourceUrl: url },
    }));
    const remoteRepository: RemoteQuestionBankRepository = {
      ...repository,
      installFromUrl,
    };

    await installConfiguredQuestionBank(remoteRepository);
    expect(installFromUrl).toHaveBeenCalledWith(url, undefined, { reuseCatalogId: 'local-old' });
    expect(saveLocalBankSource).toHaveBeenCalled();
  });
});
