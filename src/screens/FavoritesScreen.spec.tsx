import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

/**
 * FavoritesScreen 双段（收藏 | 错题）测试。
 * 锁两件事：错题本必须从 masteryStore 派生（不存第二份真相）；
 * 「开始复习」必须带完整练习队列进入详情页。
 */

const mockNavigate = jest.fn();
/** 聚焦控制：失焦（执行清理）与重新聚焦，用于模拟「离开再回来」 */
const mockFocus: { blur?: () => void; refocus?: () => void } = {};

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  // 挂载时触发一次「聚焦」即可；若每次渲染都调用，load() 的新数组会引发无限循环
  useFocusEffect: (callback: () => (() => void) | void) => {
    const { useEffect } = require('react') as typeof import('react');
    useEffect(() => {
      let cleanup = callback();
      mockFocus.blur = () => { cleanup?.(); cleanup = undefined; };
      mockFocus.refocus = () => { cleanup = callback(); };
      return () => cleanup?.();
    }, []);
  },
}));

jest.mock('../question-bank', () => ({
  questionBankRepository: {
    listQuestions: jest.fn(),
  },
}));

// eslint-disable-next-line import/first
import { FavoritesScreen } from './FavoritesScreen';
// eslint-disable-next-line import/first
import { useMasteryStore } from '../store/masteryStore';
// eslint-disable-next-line import/first
import { useQuestionBankStore } from '../question-bank/store';
// eslint-disable-next-line import/first
import AsyncStorage from '@react-native-async-storage/async-storage';
// eslint-disable-next-line import/first
import { resetFavoritesForTests } from '../store/favoritesStore';
// eslint-disable-next-line import/first
import { usePracticeSessionStore } from '../store/practiceSessionStore';

const mockRepository = jest.requireMock('../question-bank').questionBankRepository as {
  listQuestions: jest.Mock;
};

const BANK_ID = 'bank-a';

function question(id: string, title: string) {
  return { id, title, difficulty: 2 as const, hasAnswer: true, sort: 1, tags: [] };
}

function seedStores() {
  useQuestionBankStore.setState({
    catalog: { schemaVersion: 1, id: BANK_ID, title: '测试题库', tags: [], questions: [] },
  });
  // favoritesStore.load() 会用存储覆盖内存态，所以收藏要通过 AsyncStorage 预置
  void AsyncStorage.setItem('facee-favorites', JSON.stringify(['fav-1']));
  // q1 不会、q2 模糊 → 错题；q3 会了 → 不进错题本；ghost 只存在于标记里（孤儿）
  useMasteryStore.setState({
    marks: {
      [BANK_ID]: { 'wrong-1': 'unknown', 'wrong-2': 'fuzzy', 'known-1': 'known', ghost: 'unknown' },
    },
  });
  mockRepository.listQuestions.mockResolvedValue([
    question('fav-1', '收藏题：HashMap 的底层实现'),
    question('wrong-1', '错题一：JVM 内存区域'),
    question('wrong-2', '错题二：G1 收集器'),
    question('known-1', '已掌握题：不进错题本'),
  ]);
}

describe('FavoritesScreen 收藏 | 错题 双段', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    seedStores();
  });

  it('默认显示收藏段，题目来自收藏 ids', async () => {
    await render(<FavoritesScreen />);

    await waitFor(() => expect(screen.getByText('收藏题：HashMap 的底层实现')).toBeTruthy());
    expect(screen.getByLabelText('收藏（1 题）')).toBeTruthy();
    expect(screen.queryByText('错题一：JVM 内存区域')).toBeNull();
  });

  it('错题段由 masteryStore 派生：不会+模糊进列表，已掌握不进', async () => {
    await render(<FavoritesScreen />);

    await waitFor(() => expect(screen.getByLabelText('错题（2 题）')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('错题（2 题）'));

    await waitFor(() => expect(screen.getByText('错题一：JVM 内存区域')).toBeTruthy());
    expect(screen.getByText('错题二：G1 收集器')).toBeTruthy();
    expect(screen.queryByText('已掌握题：不进错题本')).toBeNull();
    expect(screen.queryByText('收藏题：HashMap 的底层实现')).toBeNull();
  });

  it('孤儿标记（题库中不存在的题）被过滤并提示条数', async () => {
    await render(<FavoritesScreen />);

    await fireEvent.press(await screen.findByLabelText('错题（2 题）'));
    await waitFor(() => expect(screen.getByText(/另有 1 条标记来自已卸载的旧题库/)).toBeTruthy());
  });

  it('开始复习带完整错题队列以练习模式进入详情页', async () => {
    await render(<FavoritesScreen />);

    await fireEvent.press(await screen.findByLabelText('错题（2 题）'));
    await fireEvent.press(await screen.findByLabelText('开始复习 2 道错题'));

    expect(mockNavigate).toHaveBeenCalledWith('Detail', expect.objectContaining({
      id: 'wrong-1',
      mode: 'practice',
      queueIndex: 0,
    }));
    const params = mockNavigate.mock.calls[0][1] as { queue: string[] };
    expect(params.queue).toEqual(['wrong-1', 'wrong-2']);
  });
});

describe('FavoritesScreen 收藏按题库隔离 / 练习会话', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    resetFavoritesForTests();
    usePracticeSessionStore.setState({ sessions: {} });
    useMasteryStore.setState({ marks: {} });
    mockRepository.listQuestions.mockResolvedValue([
      question('fav-1', '收藏题：HashMap 的底层实现'),
      question('fav-2', '收藏题：ConcurrentHashMap'),
      question('b-only', '另一题库的收藏'),
    ]);
    await AsyncStorage.setItem(
      'facee-favorites.v2',
      JSON.stringify({ byBank: { [BANK_ID]: ['fav-1', 'fav-2'], 'bank-b': ['b-only'] } }),
    );
  });

  it('只显示当前题库的收藏', async () => {
    useQuestionBankStore.setState({
      catalog: { schemaVersion: 1, id: 'bank-b', title: '题库 B', tags: [], questions: [] },
    });
    await render(<FavoritesScreen />);

    await waitFor(() => expect(screen.getByText('另一题库的收藏')).toBeTruthy());
    expect(screen.queryByText('收藏题：HashMap 的底层实现')).toBeNull();
    expect(screen.getByLabelText('收藏（1 题）')).toBeTruthy();
  });

  it('点收藏题以练习模式进入整组收藏，并记为当前题库的会话', async () => {
    useQuestionBankStore.setState({
      catalog: { schemaVersion: 1, id: BANK_ID, title: '测试题库', tags: [], questions: [] },
    });
    await render(<FavoritesScreen />);

    await fireEvent.press(await screen.findByText('收藏题：ConcurrentHashMap'));

    expect(mockNavigate).toHaveBeenCalledWith('Detail', expect.objectContaining({
      id: 'fav-2',
      queue: ['fav-1', 'fav-2'],
      queueIndex: 1,
      mode: 'practice',
    }));
    expect(usePracticeSessionStore.getState().getSession(BANK_ID)).toEqual(
      expect.objectContaining({ queue: ['fav-1', 'fav-2'], index: 1, title: '收藏' }),
    );
  });

  it('错题「开始复习」同样记录会话', async () => {
    useQuestionBankStore.setState({
      catalog: { schemaVersion: 1, id: BANK_ID, title: '测试题库', tags: [], questions: [] },
    });
    await AsyncStorage.setItem(
      'facee-mastery-state.v2',
      JSON.stringify({ marks: { [BANK_ID]: { 'fav-2': 'unknown' } }, markedAt: { [BANK_ID]: { 'fav-2': 1 } } }),
    );
    await render(<FavoritesScreen />);

    await fireEvent.press(await screen.findByLabelText('错题（1 题）'));
    await fireEvent.press(await screen.findByLabelText('开始复习 1 道错题'));
    expect(usePracticeSessionStore.getState().getSession(BANK_ID)).toEqual(
      expect.objectContaining({ queue: ['fav-2'], index: 0, mode: 'practice', title: '错题复习' }),
    );
  });
});

describe('FavoritesScreen 聚焦加载竞态', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    resetFavoritesForTests();
    jest.clearAllMocks();
    seedStores();
  });

  it('离开前发起的慢加载晚于新加载完成时，不会清空当前结果', async () => {
    let resolveSlow: (value: unknown[]) => void = () => undefined;
    mockRepository.listQuestions
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSlow = resolve; }))
      .mockResolvedValue([question('fav-1', '收藏题 1'), question('wrong-1', '错题 1'), question('wrong-2', '错题 2')]);

    render(<FavoritesScreen />);
    // 离开再回来：新一次加载很快完成
    mockFocus.blur?.();
    mockFocus.refocus?.();
    await waitFor(() => expect(screen.getByText('收藏题 1')).toBeTruthy());

    // 旧的慢加载此时才返回（且结果为空）：不得覆盖或清空新结果
    await act(async () => {
      resolveSlow([]);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(screen.getByText('收藏题 1')).toBeTruthy();
  });
});
