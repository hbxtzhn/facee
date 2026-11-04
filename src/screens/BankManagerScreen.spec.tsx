import { act, fireEvent, render } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * 题库管理页（栈页面）：正文复用 BankManagerModal 的 screen 形态，
 * 编辑 / 复制 / 新建后 push 到 BankEditor，「线上题库」进 OnlineBanks，处理中拦截返回。
 */

const mockNav = { push: jest.fn(), goBack: jest.fn(), navigate: jest.fn() };
const mockPrevent = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNav,
  usePreventRemove: (prevent: boolean) => mockPrevent(prevent),
}));

const mockActions = {
  refreshBanks: jest.fn(),
  switchBank: jest.fn(),
  copyBank: jest.fn(),
  deleteLocalBank: jest.fn(),
  updateBank: jest.fn(),
  createLocalBank: jest.fn(),
  setSourceUrl: jest.fn(),
  clearInstallError: jest.fn(),
  installConfigured: jest.fn(),
  setBankSourceUrl: jest.fn(),
  findBankBySourceUrl: jest.fn(),
};
const mockState = {
  banks: [] as unknown[],
  banksLoading: false,
  catalog: null,
  installing: false,
  installProgress: null,
  installError: null,
  sourceUrl: '',
};
jest.mock('../question-bank/store', () => ({
  useQuestionBankStore: Object.assign(
    (selector: (state: unknown) => unknown) => selector({ ...mockState, ...mockActions }),
    { getState: () => ({ ...mockState, ...mockActions }) },
  ),
}));

// eslint-disable-next-line import/first
import { BankManagerScreen } from './BankManagerScreen';

describe('BankManagerScreen 题库管理页', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
    mockState.installing = false;
    mockState.banks = [
      { catalogId: 'local-my', namespace: 'ns-local', title: '我的错题集', questionCount: 2, source: 'local', active: true },
      { catalogId: 'facee-official', namespace: 'ns-online', title: 'Java 面试题库', questionCount: 200, source: 'online', active: false },
    ];
    mockActions.refreshBanks.mockResolvedValue(undefined);
  });

  it('以页面形态渲染（无弹窗蒙层与「完成」），进入即刷新题库列表', async () => {
    const view = await render(<BankManagerScreen />);
    expect(view.getByTestId('profile-screen-管理题库')).toBeTruthy();
    expect(view.queryByLabelText('关闭弹窗')).toBeNull();
    expect(view.queryByText('完成')).toBeNull();
    expect(mockActions.refreshBanks).toHaveBeenCalled();
    expect(mockPrevent).toHaveBeenLastCalledWith(false);
  });

  it('编辑与复制都 push 到编辑页', async () => {
    mockActions.copyBank.mockResolvedValue('local-copy');
    const view = await render(<BankManagerScreen />);

    await act(async () => { fireEvent.press(view.getByLabelText('更多操作 我的错题集')); });
    await act(async () => { fireEvent.press(view.getByLabelText('编辑题库 我的错题集')); });
    expect(mockNav.push).toHaveBeenLastCalledWith('BankEditor', { bankId: 'local-my' });

    await act(async () => { fireEvent.press(view.getByLabelText('更多操作 Java 面试题库')); });
    await act(async () => { fireEvent.press(view.getByLabelText('复制题库 Java 面试题库 为本地可编辑副本')); });
    expect(mockNav.push).toHaveBeenLastCalledWith('BankEditor', { bankId: 'local-copy' });
  });

  it('新建本地题库后直接进入它的编辑页', async () => {
    mockActions.createLocalBank.mockResolvedValue('local-new');
    const view = await render(<BankManagerScreen />);
    await act(async () => { fireEvent.press(view.getByLabelText('新建本地题库')); });
    expect(mockActions.createLocalBank).toHaveBeenCalledWith('我的题库');
    expect(mockNav.push).toHaveBeenCalledWith('BankEditor', { bankId: 'local-new' });
  });

  it('「线上题库」进入 OnlineBanks 页', async () => {
    const view = await render(<BankManagerScreen />);
    await act(async () => { fireEvent.press(view.getByLabelText('线上题库')); });
    expect(mockNav.navigate).toHaveBeenCalledWith('OnlineBanks');
  });

  it('处理题库期间拦截返回键 / 手势', async () => {
    mockState.installing = true;
    await render(<BankManagerScreen />);
    expect(mockPrevent).toHaveBeenLastCalledWith(true);
  });
});
