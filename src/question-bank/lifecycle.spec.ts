import { TEST_QUESTION_BANK } from './fixture';
import type { BankInstallOptions, LocalBankSource, QuestionBankPackage, RemoteBankInstallOptions } from './types';

jest.mock('./client', () => ({
  questionBankRepository: {
    getCatalog: jest.fn(), install: jest.fn(), installFromUrl: jest.fn(),
    listBanks: jest.fn(), getQuestionIds: jest.fn(), switchBank: jest.fn(),
  },
  asRemoteQuestionBankRepository: (repo: unknown) => repo,
}));
jest.mock('./local-banks', () => ({
  ...jest.requireActual('./local-banks'),
  saveLocalBankSource: jest.fn(), loadLocalBankSource: jest.fn(), listLocalBankSources: jest.fn(),
}));

import { questionBankRepository } from './client';
import { saveLocalBankSource, loadLocalBankSource, listLocalBankSources } from './local-banks';
import { useQuestionBankStore } from './store';

const actualSources = jest.requireActual<typeof import('./local-banks')>('./local-banks');
const currentCatalog = { ...TEST_QUESTION_BANK.catalog, id: 'local-a', title: '当前A' };
const editedSource: LocalBankSource = {
  bankId: 'local-b', updatedAt: '', sourceUrl: 'https://example.com/b.zip',
  package: { ...TEST_QUESTION_BANK, catalog: { ...TEST_QUESTION_BANK.catalog, id: 'local-b', version: '1.2.0' } },
};

beforeEach(() => {
  jest.resetAllMocks();
  useQuestionBankStore.setState({ catalog: currentCatalog, status: 'ready', installing: false, banks: [] });
  (listLocalBankSources as jest.Mock).mockResolvedValue([]);
  (questionBankRepository.listBanks as jest.Mock).mockResolvedValue([]);
});

it('源文件保存并读取后应保留在线更新地址', async () => {
  const files = new Map<string, string>();
  const fs = {
    documentDirectory: 'file:///audit/', makeDirectoryAsync: async () => {},
    writeAsStringAsync: async (path: string, text: string) => { files.set(path, text); },
    readAsStringAsync: async (path: string) => { if (!files.has(path)) throw new Error('Missing'); return files.get(path)!; },
    getInfoAsync: async (path: string) => ({ exists: files.has(path) }),
    moveAsync: async ({ from, to }: { from: string; to: string }) => { files.set(to, files.get(from)!); files.delete(from); },
    deleteAsync: async (path: string) => { files.delete(path); },
  };
  await actualSources.saveLocalBankSource(editedSource, fs as never);
  const loaded = await actualSources.loadLocalBankSource(editedSource.bankId, fs as never);
  expect(loaded?.sourceUrl).toBe(editedSource.sourceUrl);
});

it('保存非当前题库后，界面当前题库应与底层保持一致', async () => {
  let diskCatalog = currentCatalog;
  (saveLocalBankSource as jest.Mock).mockResolvedValue(undefined);
  (questionBankRepository.install as jest.Mock).mockImplementation(async (bank: QuestionBankPackage, _progress: unknown, options?: BankInstallOptions) => {
    await options?.beforeCommit?.(bank);
    diskCatalog = { ...editedSource.package.catalog, title: '编辑B' };
    return { questionCount: 6, tagCount: 4 };
  });
  (questionBankRepository.getCatalog as jest.Mock).mockImplementation(async () => diskCatalog);
  (questionBankRepository.switchBank as jest.Mock).mockImplementation(async () => { diskCatalog = currentCatalog; });
  await useQuestionBankStore.getState().saveLocalBank(editedSource);
  expect(useQuestionBankStore.getState().catalog?.id).toBe(diskCatalog.id);
});

it('更新非当前题库，源文件写失败后也应恢复原选中题库', async () => {
  let diskCatalog = currentCatalog;
  (loadLocalBankSource as jest.Mock).mockResolvedValue(editedSource);
  (questionBankRepository.getQuestionIds as jest.Mock).mockResolvedValue(new Set(['q1']));
  (questionBankRepository as unknown as { installFromUrl: jest.Mock }).installFromUrl.mockImplementation(async (_url: string, _progress: unknown, options?: RemoteBankInstallOptions) => {
    diskCatalog = { ...editedSource.package.catalog, title: '新B' };
    await options?.beforeCommit?.(editedSource.package);
    return { questionCount: 6, tagCount: 4, localSource: editedSource };
  });
  (questionBankRepository.getCatalog as jest.Mock).mockImplementation(async () => diskCatalog);
  (saveLocalBankSource as jest.Mock).mockRejectedValue(new Error('ENOSPC: no space left on device'));
  (questionBankRepository.switchBank as jest.Mock).mockImplementation(async () => { diskCatalog = currentCatalog; });
  await expect(useQuestionBankStore.getState().updateBank('local-b')).rejects.toThrow('ENOSPC');
  expect(diskCatalog.id).toBe('local-a');
});

it('检查更新期间不允许另一项切换写操作，结束后释放锁', async () => {
  let finish!: (source: LocalBankSource) => void;
  (loadLocalBankSource as jest.Mock).mockImplementation(() => new Promise<LocalBankSource>((resolve) => { finish = resolve; }));
  (questionBankRepository.getQuestionIds as jest.Mock).mockResolvedValue(new Set(['q1']));
  (questionBankRepository as unknown as { installFromUrl: jest.Mock }).installFromUrl.mockResolvedValue({ unchanged: true });
  const updating = useQuestionBankStore.getState().updateBank('local-b');
  expect(useQuestionBankStore.getState().installing).toBe(true);
  await expect(useQuestionBankStore.getState().switchBank('local-a')).rejects.toThrow('正在处理题库');
  expect(questionBankRepository.switchBank).not.toHaveBeenCalled();
  expect(useQuestionBankStore.getState().installing).toBe(true);
  finish(editedSource);
  await updating;
  expect(useQuestionBankStore.getState().installing).toBe(false);
});
