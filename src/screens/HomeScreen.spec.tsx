import { act, fireEvent, render } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * HomeScreen「今日复习」卡片冒烟：
 * 无到期题不渲染；到期（按 1/3/7 天口径）渲染数量并带练习队列进入 review 模式；
 * 已不在题库的到期题（孤儿数据）被过滤。
 *
 * 基建要点沿用 ListScreen.spec：v14 异步 render；mock 题库仓库（不碰文件系统）；
 * mock 导航取回 push 断言；AsyncStorage 功能性 mock 直接写入 v2 持久化格式。
 */

const DAY = 24 * 60 * 60 * 1000;

const mockNav = { push: jest.fn(), navigate: jest.fn(), goBack: jest.fn(), popToTop: jest.fn(), canGoBack: () => true };

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNav,
  useFocusEffect: () => undefined,
}));

jest.mock('../question-bank/client', () => ({
  questionBankRepository: {
    getCatalog: jest.fn(),
    getQuestion: jest.fn(),
    getContent: jest.fn(),
    listQuestions: jest.fn(),
    searchBody: jest.fn(),
    install: jest.fn(),
    clear: jest.fn(),
  },
  createQuestionBankRepository: jest.fn(),
  asRemoteQuestionBankRepository: jest.fn(() => null),
}));

// 题库切换器读写 store：用可控替身，避免碰真实安装器 / 文件系统
const mockBankActions = {
  refreshBanks: jest.fn(),
  switchBank: jest.fn(),
};
const mockBankState = {
  banks: [] as unknown[],
  banksLoading: false,
  installing: false,
};
jest.mock('../question-bank/store', () => ({
  useQuestionBankStore: (selector: (state: unknown) => unknown) =>
    selector({ ...mockBankState, ...mockBankActions }),
}));

// eslint-disable-next-line import/first
import { HomeScreen } from './HomeScreen';
// eslint-disable-next-line import/first
import { useMasteryStore } from '../store/masteryStore';

const mockRepository = jest.requireMock('../question-bank/client').questionBankRepository as {
  getCatalog: jest.Mock;
};

const catalog = {
  schemaVersion: 1 as const,
  id: 'bank-x',
  title: '测试题库',
  categories: [{ id: 'java', name: 'Java', sort: 1 }],
  tags: [],
  questions: [
    { id: 'q1', title: '题目一', difficulty: 1, hasAnswer: true, sort: 1, tags: [], categoryId: 'java' },
    { id: 'q2', title: '题目二', difficulty: 2, hasAnswer: true, sort: 2, tags: [], categoryId: 'java' },
  ],
};

function seedMastery(marks: Record<string, Record<string, string>>, markedAt: Record<string, Record<string, number>>) {
  return AsyncStorage.setItem(
    'facee-mastery-state.v2',
    JSON.stringify({ marks, markedAt }),
  );
}

describe('HomeScreen 今日复习卡片', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockNav.push.mockClear();
    await AsyncStorage.clear();
    useMasteryStore.setState({ marks: {}, markedAt: {} });
    mockRepository.getCatalog.mockResolvedValue(catalog);
  });

  it('没有到期题时不显示复习卡片', async () => {
    const view = await render(<HomeScreen />);

    expect(view.getByLabelText('Java，2 道题')).toBeTruthy();
    expect(view.queryByLabelText(/今日复习/)).toBeNull();
  });

  it('有到期题时显示数量，进入复习带 review 模式与到期队列', async () => {
    const now = Date.now();
    await seedMastery(
      { 'bank-x': { q1: 'known', q2: 'fuzzy' } },
      { 'bank-x': { q1: now - 8 * DAY, q2: now - 1 * DAY } }, // q1 到期（known 7 天），q2 未到期（fuzzy 3 天）
    );

    const view = await render(<HomeScreen />);
    await view.findByLabelText('今日复习，1 道题到期');

    fireEvent.press(view.getByLabelText('今日复习，1 道题到期'));
    expect(mockNav.push).toHaveBeenCalledWith(
      'Detail',
      expect.objectContaining({
        id: 'q1',
        queue: ['q1'],
        queueIndex: 0,
        mode: 'review',
      }),
    );
  });

  it('到期题已不在题库里时被过滤，卡片隐藏', async () => {
    const now = Date.now();
    await seedMastery(
      { 'bank-x': { 'q-gone': 'unknown' } },
      { 'bank-x': { 'q-gone': now - 3 * DAY } },
    );

    const view = await render(<HomeScreen />);
    // 等 load 完成后再断言（find* 会在超时后抛错，用轮询兜底确认卡片一直不出现）
    await view.findByLabelText('Java，2 道题');
    expect(view.queryByLabelText(/今日复习/)).toBeNull();
  });
});

describe('HomeScreen 题库切换器', () => {
  const otherCatalog = { ...catalog, id: 'bank-y', title: '另一个题库' };

  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    useMasteryStore.setState({ marks: {}, markedAt: {} });
    mockRepository.getCatalog.mockResolvedValue(catalog);
    mockBankState.banks = [
      { catalogId: 'bank-x', namespace: 'ns-x', title: '测试题库', questionCount: 2, source: 'online', active: true },
      { catalogId: 'bank-y', namespace: 'ns-y', title: '另一个题库', questionCount: 5, source: 'local', active: false },
    ];
    mockBankState.banksLoading = false;
    mockBankState.installing = false;
    mockBankActions.refreshBanks.mockResolvedValue(undefined);
    mockBankActions.switchBank.mockResolvedValue(undefined);
  });

  it('标题显示当前题库，打开后刷新并列出全部题库、标记使用中', async () => {
    const view = await render(<HomeScreen />);
    await act(async () => { fireEvent.press(await view.findByLabelText('当前题库 测试题库，点按切换')); });

    expect(mockBankActions.refreshBanks).toHaveBeenCalledTimes(1);
    expect(view.getByLabelText('当前题库 测试题库').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
    expect(view.getByText('使用中')).toBeTruthy();
    expect(view.getByLabelText('切换到题库 另一个题库')).toBeTruthy();
  });

  it('点其它题库调用 switchBank 并重新读取首页', async () => {
    const view = await render(<HomeScreen />);
    await act(async () => { fireEvent.press(await view.findByLabelText('当前题库 测试题库，点按切换')); });
    mockRepository.getCatalog.mockResolvedValue(otherCatalog);

    await act(async () => { fireEvent.press(view.getByLabelText('切换到题库 另一个题库')); });

    expect(mockBankActions.switchBank).toHaveBeenCalledWith('bank-y');
    expect(await view.findByLabelText('当前题库 另一个题库，点按切换')).toBeTruthy();
  });

  it('切换中禁用其它行，失败时在弹层内提示错误', async () => {
    let fail!: (error: Error) => void;
    mockBankActions.switchBank.mockImplementation(() => new Promise<void>((_, reject) => { fail = reject; }));
    const view = await render(<HomeScreen />);
    await act(async () => { fireEvent.press(await view.findByLabelText('当前题库 测试题库，点按切换')); });

    await act(async () => { fireEvent.press(view.getByLabelText('切换到题库 另一个题库')); });
    expect(view.getByText('正在切换题库…')).toBeTruthy();
    expect(view.getByLabelText('当前题库 测试题库')).toBeDisabled();
    expect(view.getByLabelText('管理题库')).toBeDisabled();

    await act(async () => { fail(new Error('正在处理题库，请稍后再试')); });
    expect(view.getByText('正在处理题库，请稍后再试')).toBeTruthy();
    expect(view.getByLabelText('切换到题库 另一个题库')).not.toBeDisabled();
  });

  it('「管理题库」进入题库管理页', async () => {
    const view = await render(<HomeScreen />);
    await act(async () => { fireEvent.press(await view.findByLabelText('当前题库 测试题库，点按切换')); });
    await act(async () => { fireEvent.press(view.getByLabelText('管理题库')); });
    expect(mockNav.navigate).toHaveBeenCalledWith('BankManager');
  });

  it('本机没有题库时空态与切换器都给新建 / 添加入口', async () => {
    mockRepository.getCatalog.mockResolvedValue(null);
    mockBankState.banks = [];
    const view = await render(<HomeScreen />);

    expect(await view.findByText('还没有题库')).toBeTruthy();
    await act(async () => { fireEvent.press(view.getByText('新建或添加题库')); });
    expect(mockNav.navigate).toHaveBeenCalledWith('BankManager');

    mockNav.navigate.mockClear();
    await act(async () => { fireEvent.press(view.getByLabelText('还没有题库，点按添加')); });
    expect(view.getByText(/本机还没有题库/)).toBeTruthy();
    // 空态按钮与弹层末尾入口同名：弹层后渲染，取最后一个
    const sheetEntries = view.getAllByLabelText('新建或添加题库');
    await act(async () => { fireEvent.press(sheetEntries[sheetEntries.length - 1]); });
    expect(mockNav.navigate).toHaveBeenCalledWith('BankManager');
  });
});
