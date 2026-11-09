import { act, fireEvent, render } from '@testing-library/react-native';

/**
 * 「我的」页：统计来自 useBankStore.stats；当前题库行进管理页，
 * 只有当前题库 origin = local 时才出现「编辑当前题库」；Web（unsupported）显示不支持说明。
 */

const mockNav = { navigate: jest.fn(), push: jest.fn(), goBack: jest.fn() };
const mockUser = {
  load: jest.fn(async () => undefined),
  answerExpandedByDefault: false,
  setAnswerExpandedByDefault: jest.fn(),
};
jest.mock('../store/userStore', () => ({
  useUserStore: (selector: (state: typeof mockUser) => unknown) => selector(mockUser),
}));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNav }));
// 与题库入口无关的重组件替身：更新卡片会发网络请求，AI 设置 / 备份弹窗另有用例
jest.mock('../components/app-update-card', () => ({ AppUpdateCard: () => null }));
jest.mock('./profile/LlmSettingsModal', () => ({ LlmSettingsModal: () => null }));
const mockBackupVisible = jest.fn();
jest.mock('./profile/BackupModal', () => ({
  BackupModal: ({ visible }: { visible: boolean }) => { mockBackupVisible(visible); return null; },
}));
jest.mock('expo-file-system/legacy', () => ({}));

// eslint-disable-next-line import/first
import { ProfileScreen } from './ProfileScreen';
// eslint-disable-next-line import/first
import { useBankStore, type BankSummary } from '../bank';

function bank(id: string, name: string, origin: BankSummary['origin']): BankSummary {
  return {
    id, origin, name, version: '1.2.0', locale: 'zh-CN', description: null, homepage: null, license: null, feedbackUrl: null,
    manifestUrl: origin === 'remote' ? 'https://example.com/latest.json' : null,
    questionCount: 40, installedAt: 1, updatedAt: 1, checkedAt: null, lastCheck: null,
  };
}

const STATS = { questionCount: 40, markedCount: 12, knownCount: 5, fuzzyCount: 4, unknownCount: 3, dueCount: 2, favoriteCount: 7, updatedCount: 0 };

function setStore(active: BankSummary | null, banks: BankSummary[] = active ? [active] : []) {
  useBankStore.setState({
    status: 'ready',
    banks,
    activeBankId: active?.id ?? null,
    activeBank: active,
    stats: active ? STATS : null,
    categories: active ? [{ id: 'redis', name: 'Redis', description: null, order: 1, questionCount: 40, markedCount: 0, knownCount: 0 }] : [],
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ProfileScreen 我的', () => {
  it('统计来自题库学习数据；本地题库可直接编辑', async () => {
    const local = bank('local/device/01ABC', '我的本地库', 'local');
    setStore(local);
    const view = await render(<ProfileScreen />);
    expect(mockUser.load).toHaveBeenCalled();
    expect(view.getByText('已标 12/40 题 · 会了 5 · 今日待复习 2 · 收藏 7')).toBeTruthy();
    expect(view.getByText('本地题库 · 40 题 · 1 个分类 · v1.2.0')).toBeTruthy();
    await act(async () => { fireEvent.press(view.getByLabelText('管理题库 我的本地库')); });
    expect(mockNav.navigate).toHaveBeenLastCalledWith('BankManager');
    await act(async () => { fireEvent.press(view.getByLabelText('编辑当前题库 我的本地库')); });
    expect(mockNav.navigate).toHaveBeenLastCalledWith('BankEditor', { bankId: 'local/device/01ABC' });
  });

  it('线上 / 文件题库不提供编辑入口', async () => {
    setStore(bank('github.com/a/b', '官方题库', 'remote'));
    const view = await render(<ProfileScreen />);
    expect(view.queryByText('编辑当前题库')).toBeNull();
    setStore(bank('example.com/a/b', '分享题库', 'file'));
    await act(async () => { await view.rerender(<ProfileScreen />); });
    expect(view.queryByText('编辑当前题库')).toBeNull();
  });

  it('没有题库时入口进管理页，统计显示无记录', async () => {
    setStore(null);
    const view = await render(<ProfileScreen />);
    expect(view.getByText('还没有学习记录')).toBeTruthy();
    await act(async () => { fireEvent.press(view.getByLabelText('新建或管理题库')); });
    expect(mockNav.navigate).toHaveBeenCalledWith('BankManager');
  });

  it('线上题库、备份与恢复、默认展开答案设置', async () => {
    setStore(bank('github.com/a/b', '官方题库', 'remote'));
    const view = await render(<ProfileScreen />);
    await act(async () => { fireEvent.press(view.getByLabelText('线上题库')); });
    expect(mockNav.navigate).toHaveBeenCalledWith('OnlineBanks');
    expect(mockBackupVisible).toHaveBeenLastCalledWith(false);
    await act(async () => { fireEvent.press(view.getByLabelText('备份与恢复')); });
    expect(mockBackupVisible).toHaveBeenLastCalledWith(true);
    await act(async () => { fireEvent(view.getByLabelText('进入题目时默认展开答案'), 'valueChange', true); });
    expect(mockUser.setAnswerExpandedByDefault).toHaveBeenCalledWith(true);
    expect(view.getByText('AI 设置')).toBeTruthy();
  });

  it('Web（unsupported）只显示不支持说明，不提供题库 / AI / 备份入口', async () => {
    useBankStore.setState({ status: 'unsupported', banks: [], activeBank: null, activeBankId: null, stats: null });
    const view = await render(<ProfileScreen />);
    expect(view.getByText('Web 预览不支持本地题库，请在 Android App 中使用。')).toBeTruthy();
    expect(view.getByText('Web 预览不记录学习数据')).toBeTruthy();
    expect(view.queryByText('线上题库')).toBeNull();
    expect(view.queryByText('AI 设置')).toBeNull();
    expect(view.queryByText('备份与恢复')).toBeNull();
  });
});
