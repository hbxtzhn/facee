import { act, fireEvent, render } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * 线上题库页：官方题库安装 / 更新、按网址添加（重复地址 = 更新；已修改旧库先问）、
 * 已装线上题库逐个检查更新；安装失败不留未处理的拒绝。
 */

const mockPrevent = jest.fn();
jest.mock('@react-navigation/native', () => ({
  usePreventRemove: (prevent: boolean) => mockPrevent(prevent),
}));

const mockActions = {
  refreshBanks: jest.fn(),
  updateBank: jest.fn(),
  setSourceUrl: jest.fn(),
  installConfigured: jest.fn(),
  findBankBySourceUrl: jest.fn(),
  clearInstallError: jest.fn(),
};
const mockState = {
  banks: [] as unknown[],
  installing: false,
  installProgress: null as null | { label: string; completed: number; total: number },
  installError: null as string | null,
  sourceUrl: '',
};
jest.mock('../question-bank/store', () => ({
  useQuestionBankStore: Object.assign(
    (selector: (state: unknown) => unknown) => selector({ ...mockState, ...mockActions }),
    { getState: () => ({ ...mockState, ...mockActions }) },
  ),
}));

// eslint-disable-next-line import/first
import { OnlineBanksScreen } from './OnlineBanksScreen';

const OFFICIAL = 'https://github.com/HBxtzhn/facee-bank/releases/latest/download/question-bank.zip';
const URL = 'https://example.com/bank.zip';

type View = Awaited<ReturnType<typeof render>>;
async function submitUrl(view: View, url: string) {
  await act(async () => { fireEvent.changeText(view.getByLabelText('题库 ZIP 地址'), url); });
  await act(async () => { fireEvent.press(view.getByLabelText('按网址下载题库')); });
}

describe('OnlineBanksScreen 线上题库页', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
    mockState.banks = [];
    mockState.installing = false;
    mockState.installError = null;
    mockActions.refreshBanks.mockResolvedValue(undefined);
    mockActions.findBankBySourceUrl.mockResolvedValue(null);
    mockActions.installConfigured.mockResolvedValue(true);
  });

  it('未安装官方题库：一键安装走 setSourceUrl + installConfigured', async () => {
    const view = await render(<OnlineBanksScreen />);
    expect(mockActions.refreshBanks).toHaveBeenCalled();
    expect(view.getByText('FaceE 官方题库')).toBeTruthy();
    await act(async () => { fireEvent.press(view.getByLabelText('安装官方题库')); });
    expect(mockActions.findBankBySourceUrl).toHaveBeenCalledWith(OFFICIAL);
    expect(mockActions.setSourceUrl).toHaveBeenCalledWith(OFFICIAL);
    expect(mockActions.installConfigured).toHaveBeenCalledTimes(1);
    expect(view.getByText('题库已下载并启用，可以离线刷题了。')).toBeTruthy();
  });

  it('已安装官方题库：显示已安装状态，按钮变为检查更新且走 updateBank', async () => {
    mockState.banks = [{ catalogId: 'facee-official', namespace: 'ns', title: 'FaceE 官方', questionCount: 120,
      source: 'online', active: true, version: '2.0.0', sourceUrl: OFFICIAL }];
    mockActions.findBankBySourceUrl.mockResolvedValue({ bankId: 'facee-official', title: 'FaceE 官方', locallyModified: false });
    mockActions.updateBank.mockResolvedValue({ added: 0, removed: 0, updated: false });
    const view = await render(<OnlineBanksScreen />);
    expect(view.getByText(/已安装 · 120 题 · v2.0.0/)).toBeTruthy();
    await act(async () => { fireEvent.press(view.getByLabelText('检查官方题库更新')); });
    expect(mockActions.updateBank).toHaveBeenCalledWith('facee-official', undefined);
    expect(mockActions.installConfigured).not.toHaveBeenCalled();
    expect(view.getAllByText('「FaceE 官方」已是最新版本。').length).toBeGreaterThan(0);
  });

  it('按网址添加：新地址直接安装', async () => {
    const view = await render(<OnlineBanksScreen />);
    await submitUrl(view, `  ${URL}  `);
    expect(mockActions.findBankBySourceUrl).toHaveBeenCalledWith(URL);
    expect(mockActions.setSourceUrl).toHaveBeenCalledWith(URL);
    expect(mockActions.installConfigured).toHaveBeenCalledTimes(1);
  });

  it('按网址添加：已装线上题库的地址 = 更新它，不再询问', async () => {
    mockActions.findBankBySourceUrl.mockResolvedValue({ bankId: 'facee-x', title: '某题库', locallyModified: false });
    mockActions.updateBank.mockResolvedValue({ added: 2, removed: 0, updated: true });
    const view = await render(<OnlineBanksScreen />);
    await submitUrl(view, URL);
    expect(mockActions.updateBank).toHaveBeenCalledWith('facee-x', undefined);
    expect(mockActions.installConfigured).not.toHaveBeenCalled();
    expect(view.getByText('「某题库」更新完成：新增 2 题。')).toBeTruthy();
  });

  describe('地址对应「已修改」旧库', () => {
    beforeEach(() => {
      mockActions.findBankBySourceUrl.mockResolvedValue({ bankId: 'local-old', title: '旧库', locallyModified: true });
    });

    it('先问：另装一份 → installConfigured', async () => {
      const view = await render(<OnlineBanksScreen />);
      await submitUrl(view, URL);
      expect(view.getByText('这个地址对应已装的「旧库」')).toBeTruthy();
      expect(mockActions.installConfigured).not.toHaveBeenCalled();
      await act(async () => { fireEvent.press(view.getByLabelText('另装一份')); });
      expect(mockActions.setSourceUrl).toHaveBeenCalledWith(URL);
      expect(mockActions.installConfigured).toHaveBeenCalledTimes(1);
    });

    it('取消：什么都不做', async () => {
      const view = await render(<OnlineBanksScreen />);
      await submitUrl(view, URL);
      await act(async () => { fireEvent.press(view.getByLabelText('取消')); });
      expect(view.queryByText('这个地址对应已装的「旧库」')).toBeNull();
      expect(mockActions.updateBank).not.toHaveBeenCalled();
      expect(mockActions.installConfigured).not.toHaveBeenCalled();
    });

    it('更新原题库：需确认时再三选一，选择后带 onLocalEdits 重试', async () => {
      mockActions.updateBank
        .mockResolvedValueOnce({ added: 0, removed: 0, updated: false, needsConfirmation: true })
        .mockResolvedValueOnce({ added: 1, removed: 0, updated: true, copiedBankId: 'local-copy' });
      const view = await render(<OnlineBanksScreen />);
      await submitUrl(view, URL);
      await act(async () => { fireEvent.press(view.getByLabelText('更新原题库（会先询问如何处理本地修改）')); });
      expect(mockActions.updateBank).toHaveBeenCalledWith('local-old', undefined);
      expect(view.getByLabelText('直接覆盖更新题库 旧库')).toBeTruthy();
      expect(view.getByLabelText('取消更新')).toBeTruthy();
      await act(async () => { fireEvent.press(view.getByLabelText('另存副本后更新题库 旧库')); });
      expect(mockActions.updateBank).toHaveBeenLastCalledWith('local-old', { onLocalEdits: 'keepCopy' });
      expect(view.getByText('「旧库」更新完成：新增 1 题。本地修改已另存为副本。')).toBeTruthy();
    });
  });

  it('安装失败：显示原因（returned false 与抛错两种），不抛出未处理拒绝', async () => {
    mockActions.installConfigured.mockImplementationOnce(async () => {
      mockState.installError = '题库下载失败（HTTP 404）';
      return false;
    });
    const view = await render(<OnlineBanksScreen />);
    await submitUrl(view, URL);
    expect(view.getByText('题库下载失败（HTTP 404）')).toBeTruthy();

    mockState.installError = null;
    mockActions.installConfigured.mockRejectedValueOnce(new Error('正在处理题库，请稍后再试'));
    await submitUrl(view, 'https://example.com/other.zip');
    expect(view.getByText('正在处理题库，请稍后再试')).toBeTruthy();
  });

  it('查重失败时按新地址安装', async () => {
    mockActions.findBankBySourceUrl.mockRejectedValue(new Error('boom'));
    const view = await render(<OnlineBanksScreen />);
    await submitUrl(view, URL);
    expect(mockActions.installConfigured).toHaveBeenCalledTimes(1);
  });

  it('已装线上题库逐个检查更新，只列线上题库', async () => {
    mockState.banks = [
      { catalogId: 'facee-x', namespace: 'ns-x', title: '线上库', questionCount: 10, source: 'online', active: false,
        version: '1.0.0', sourceUrl: URL },
      { catalogId: 'local-y', namespace: 'ns-y', title: '本地库', questionCount: 3, source: 'local', active: true },
    ];
    mockActions.updateBank.mockResolvedValue({ added: 0, removed: 0, updated: false });
    const view = await render(<OnlineBanksScreen />);
    expect(view.queryByText('本地库')).toBeNull();
    await act(async () => { fireEvent.press(view.getByLabelText('在线更新题库 线上库')); });
    expect(mockActions.updateBank).toHaveBeenCalledWith('facee-x', undefined);
    expect(view.getByText('「线上库」已是最新版本。')).toBeTruthy();
  });

  it('处理中拦截返回', async () => {
    mockState.installing = true;
    await render(<OnlineBanksScreen />);
    expect(mockPrevent).toHaveBeenLastCalledWith(true);
  });
});
