import { act, fireEvent, render } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * 「我的」页题库入口一致性：题库行永远进管理页；
 * 只有当前题库是本地题库时才出现「编辑当前题库」，直达编辑页；没有题库时入口同样进管理页。
 */

const mockNav = { navigate: jest.fn(), push: jest.fn(), goBack: jest.fn() };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNav,
}));

const mockState = {
  catalog: null as null | { id: string; title: string; questions: unknown[]; tags: unknown[]; version?: string },
  status: 'ready',
  installing: false,
  installProgress: null,
  installError: null,
  sourceUrl: '',
  initialize: jest.fn(),
  setSourceUrl: jest.fn(),
  clearInstallError: jest.fn(),
  installConfigured: jest.fn(),
};
jest.mock('../question-bank/store', () => ({
  useQuestionBankStore: Object.assign(
    (selector: (state: unknown) => unknown) => selector(mockState),
    { getState: () => mockState },
  ),
}));
// 与题库入口无关的重组件替身：更新卡片会发网络请求，AI 设置 / 备份弹窗不在本用例范围
jest.mock('../components/app-update-card', () => ({ AppUpdateCard: () => null }));
jest.mock('./profile/LlmSettingsModal', () => ({ LlmSettingsModal: () => null }));
jest.mock('./profile/BackupModal', () => ({ BackupModal: () => null }));

// eslint-disable-next-line import/first
import { ProfileScreen } from './ProfileScreen';

function bank(id: string, title: string) {
  return { id, title, questions: [], tags: [] };
}

describe('ProfileScreen 题库入口', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  it('本地题库：题库行进管理页，「编辑当前题库」进编辑页', async () => {
    mockState.catalog = bank('local-my', '我的错题集');
    const view = await render(<ProfileScreen />);

    await act(async () => { fireEvent.press(view.getByLabelText('管理题库 我的错题集')); });
    expect(mockNav.navigate).toHaveBeenLastCalledWith('BankManager');

    await act(async () => { fireEvent.press(view.getByLabelText('编辑当前题库 我的错题集')); });
    expect(mockNav.navigate).toHaveBeenLastCalledWith('BankEditor', { bankId: 'local-my' });
  });

  it('线上题库：题库行同样进管理页，不提供编辑入口', async () => {
    mockState.catalog = bank('facee-official', 'Java 面试题库');
    const view = await render(<ProfileScreen />);

    expect(view.queryByLabelText(/编辑当前题库/)).toBeNull();
    await act(async () => { fireEvent.press(view.getByLabelText('管理题库 Java 面试题库')); });
    expect(mockNav.navigate).toHaveBeenCalledTimes(1);
    expect(mockNav.navigate).toHaveBeenCalledWith('BankManager');
  });

  it('没有题库时「新建或管理题库」进管理页', async () => {
    mockState.catalog = null;
    const view = await render(<ProfileScreen />);
    await act(async () => { fireEvent.press(view.getByLabelText('新建或管理题库')); });
    expect(mockNav.navigate).toHaveBeenCalledWith('BankManager');
  });
});
