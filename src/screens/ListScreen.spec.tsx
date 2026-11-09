import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { TestRuntime } from '../bank/__fixtures__/node-runtime';
import type { ListParams } from '../navigation/AppNavigator';

/**
 * 列表页（题库 v2）：真实 useBankStore + Node SQLite。
 * 覆盖分类 / 标签（含子孙）/ 专题 / 分区 / 「内容已更新」入口，难度 / 类型 / 频度 / 掌握度筛选，
 * 搜索（FTS 与 1–2 字 LIKE 由数据层处理）与全局搜索，行内一句话预览，练习会话保存与 Web 空态。
 */

jest.mock('../bank/runtime', () => ({ createDefaultRuntime: async () => null }));

const mockNav = { push: jest.fn(), navigate: jest.fn(), goBack: jest.fn(), setOptions: jest.fn() };
let mockParams: ListParams = {};

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNav,
  useRoute: () => ({ params: mockParams }),
  useFocusEffect: () => undefined,
}));

// eslint-disable-next-line import/first
import { ListScreen, combineFilters, scopeDescriptionOf, scopeFilter, EMPTY_FILTERS } from './ListScreen';
// eslint-disable-next-line import/first
import { QID, bankStore, sampleBundle, startSampleBank, stopBank, unwrap, updateSampleBank } from './home/__fixtures__/bank-screen';
// eslint-disable-next-line import/first
import { finalize } from '../bank/__fixtures__/sample-bank';
// eslint-disable-next-line import/first
import { resetBankStoreForTests } from '../bank/store';

const TITLES = {
  redisExpire: 'Redis 过期 key 的删除策略有哪些？',
  redisPersist: 'Redis 持久化 RDB 与 AOF 的区别',
  mysqlTx: 'MySQL 的隔离级别有哪些？',
  mysqlIndex: 'MySQL 索引为什么用 B+ 树？',
  tcp: 'TCP 为什么是三次握手？',
};

/** 当前渲染出的题目标题（按渲染顺序） */
function visibleTitles(): string[] {
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^(${Object.values(TITLES).map(escape).join('|')})$`);
  return screen.queryAllByText(pattern).map((node) => String(node.props.children));
}

describe('ListScreen 纯函数', () => {
  it('scopeDescriptionOf：标签 / 专题入口展示作者写的范围说明，没有说明返回 null', () => {
    const tags = [{ id: 'db', description: '存储与事务' }, { id: 'cache', description: null }];
    const collections = [{ id: 'sprint', description: '高频题' }];
    expect(scopeDescriptionOf({ tagId: 'db' }, tags, collections)).toBe('存储与事务');
    expect(scopeDescriptionOf({ tagId: 'cache' }, tags, collections)).toBeNull();
    expect(scopeDescriptionOf({ tagId: 'gone' }, tags, collections)).toBeNull();
    expect(scopeDescriptionOf({ collectionId: 'sprint' }, tags, collections)).toBe('高频题');
    expect(scopeDescriptionOf({}, tags, collections)).toBeNull();
    expect(scopeDescriptionOf(undefined, tags, collections)).toBeNull();
  });

  it('scopeFilter：入口互斥；分区只取仍在题库中的分类，空分区返回 null', () => {
    const sections = [
      {
        id: 's1',
        name: 'A',
        order: 0,
        categories: [
          { id: 'redis', name: 'Redis', exists: true, questionCount: 2 },
          { id: 'gone', name: null, exists: false, questionCount: 0 },
        ],
      },
      { id: 's2', name: 'B', order: 1, categories: [{ id: 'gone', name: null, exists: false, questionCount: 0 }] },
    ];
    expect(scopeFilter({ categoryId: 'redis' }, sections)).toEqual({ categoryIds: ['redis'] });
    expect(scopeFilter({ tagId: 'db' }, sections)).toEqual({ tagIds: ['db'] });
    expect(scopeFilter({ collectionId: 'sprint' }, sections)).toEqual({ collectionId: 'sprint' });
    expect(scopeFilter({ sectionId: 's1' }, sections)).toEqual({ categoryIds: ['redis'] });
    expect(scopeFilter({ sectionId: 's2' }, sections)).toBeNull();
    expect(scopeFilter({ updatedOnly: true }, sections)).toEqual({ updatedSinceSeen: true });
    expect(scopeFilter({ search: true }, sections)).toEqual({});
  });

  it('combineFilters：只带非空的面板筛选；入口是标签时不叠加面板标签', () => {
    expect(combineFilters({ categoryIds: ['a'] }, EMPTY_FILTERS)).toEqual({ categoryIds: ['a'] });
    expect(combineFilters({}, { ...EMPTY_FILTERS, difficulties: ['hard'], mastery: ['unmarked'], tagIds: ['x'] })).toEqual({
      difficulties: ['hard'],
      mastery: ['unmarked'],
      tagIds: ['x'],
    });
    expect(combineFilters({ tagIds: ['db'] }, { ...EMPTY_FILTERS, tagIds: ['x'] })).toEqual({ tagIds: ['db'] });
  });
});

describe('ListScreen（题库 v2）', () => {
  let t: TestRuntime | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = {};
  });
  afterEach(async () => {
    await cleanup();
    await stopBank(t);
    t = null;
  });

  it('分类入口：行显示标题、一句话预览与「难度 · 类型 · 掌握度」', async () => {
    t = await startSampleBank();
    await unwrap(bankStore().setMastery(QID.mysqlTx, 'fuzzy'));
    mockParams = { categoryId: 'mysql', categoryName: 'MySQL' };
    await render(<ListScreen />);

    expect(await screen.findByLabelText(`${TITLES.mysqlTx}，中等 · 概念 · 模糊`)).toBeTruthy();
    expect(screen.getByLabelText(`${TITLES.mysqlIndex}，困难 · 选择`)).toBeTruthy();
    expect(screen.getByText('读未提交、读已提交、可重复读、串行化四种事务隔离级别。')).toBeTruthy();
    expect(screen.queryByText(TITLES.redisExpire)).toBeNull();
    expect(mockNav.setOptions).toHaveBeenCalledWith({ title: 'MySQL' });
  });

  it('标签入口包含子孙标签', async () => {
    t = await startSampleBank();
    mockParams = { tagId: 'db', tagName: '数据库' };
    await render(<ListScreen />);
    await screen.findByText(TITLES.mysqlTx);
    // db → cache → redis；db → tx
    expect(screen.getByText(TITLES.mysqlIndex)).toBeTruthy();
    expect(screen.getByText(TITLES.redisPersist)).toBeTruthy();
    expect(screen.getByText(TITLES.redisExpire)).toBeTruthy();
    expect(screen.queryByText(TITLES.tcp)).toBeNull();
  });

  it('专题入口按专题顺序列题', async () => {
    t = await startSampleBank();
    mockParams = { collectionId: 'sprint', collectionName: '冲刺' };
    await render(<ListScreen />);
    await screen.findByText(TITLES.mysqlTx);
    expect(visibleTitles()).toEqual([TITLES.mysqlTx, TITLES.redisExpire]);
    expect(screen.getByText('2 题')).toBeTruthy();
  });

  it('分区入口：分区内各分类的题；分区里只剩已不在题库中的分类时给出说明', async () => {
    t = await startSampleBank();
    const id = await unwrap(bankStore().createSection('混合'));
    await unwrap(bankStore().addCategoryToSection(id, 'network'));
    await unwrap(bankStore().addCategoryToSection(id, 'redis'));
    mockParams = { sectionId: id, sectionName: '混合' };
    await render(<ListScreen />);
    await screen.findByText(TITLES.tcp);
    expect(screen.getByText(TITLES.redisExpire)).toBeTruthy();
    expect(screen.queryByText(TITLES.mysqlTx)).toBeNull();
    await cleanup();

    const empty = await unwrap(bankStore().createSection('空的'));
    mockParams = { sectionId: empty, sectionName: '空的' };
    await render(<ListScreen />);
    expect(await screen.findByText(/这个分区里还没有题库中的分类/)).toBeTruthy();
  });

  it('筛选：难度 / 类型 / 频度 / 掌握度（含未标）收窄结果，重置恢复', async () => {
    t = await startSampleBank();
    await unwrap(bankStore().setMastery(QID.redisPersist, 'known'));
    await render(<ListScreen />);
    await screen.findByText('5 题');

    await fireEvent.press(screen.getByLabelText('筛选条件'));
    await fireEvent.press(screen.getByLabelText('简单难度'));
    await waitFor(() => expect(screen.getByText('2 题')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('掌握度未标'));
    await waitFor(() => expect(screen.getByText('1 题')).toBeTruthy());
    expect(screen.getByText(TITLES.tcp)).toBeTruthy();
    expect(screen.getByText('简单 · 未标 · 顺序')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('重置筛选'));
    await waitFor(() => expect(screen.getByText('5 题')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('选择题'));
    await waitFor(() => expect(screen.getByText('1 题')).toBeTruthy());
    expect(screen.getByText(TITLES.mysqlIndex)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('选择题'));

    await fireEvent.press(screen.getByLabelText('重要度高频'));
    await waitFor(() => expect(screen.getByText('2 题')).toBeTruthy());
    expect(screen.getByText(TITLES.mysqlTx)).toBeTruthy();
    expect(screen.getByText(TITLES.redisExpire)).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('按标签 内存 筛选'));
    await waitFor(() => expect(screen.getByText('1 题')).toBeTruthy());
    expect(screen.getByText(TITLES.redisExpire)).toBeTruthy();
  });

  it('搜索：≥ 3 字走 FTS、1–2 字走 LIKE；正文命中显示片段（数据层截取）；无结果给清除入口', async () => {
    t = await startSampleBank();
    mockParams = { categoryId: 'mysql', categoryName: 'MySQL' };
    await render(<ListScreen />);
    await screen.findByText('2 题');

    await fireEvent.changeText(screen.getByLabelText('搜索题目'), '隔离级别');
    await waitFor(() => expect(screen.getByText('1 题')).toBeTruthy());
    expect(screen.getByText(TITLES.mysqlTx)).toBeTruthy();

    // 2 字：「事务」只在 MySQL 隔离级别题的一句话里
    await fireEvent.changeText(screen.getByLabelText('搜索题目'), '事务');
    await waitFor(() => expect(screen.getByText('1 题')).toBeTruthy());
    expect(screen.getByText(TITLES.mysqlTx)).toBeTruthy();
    expect(screen.getByText(/四种事务隔离级别/)).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('搜索题目'), '不存在的关键词');
    expect(await screen.findByText('没有找到匹配题目')).toBeTruthy();
    await fireEvent.press(screen.getByText('清除筛选'));
    await waitFor(() => expect(screen.getByText('2 题')).toBeTruthy());
  });

  it('全局搜索：未输入时只给提示，输入后搜索整个题库', async () => {
    t = await startSampleBank();
    mockParams = { search: true };
    await render(<ListScreen />);
    expect(await screen.findByText(/输入关键词搜索整个题库/)).toBeTruthy();
    expect(screen.queryByText(TITLES.tcp)).toBeNull();
    expect(mockNav.setOptions).toHaveBeenCalledWith({ title: '搜索' });

    await fireEvent.changeText(screen.getByLabelText('搜索题目'), '三次握手');
    expect(await screen.findByText(TITLES.tcp)).toBeTruthy();
  });

  it('「内容已更新」：入口只列改过的题，行内带标记', async () => {
    t = await startSampleBank();
    await unwrap(bankStore().markViewed(QID.redisExpire));
    await unwrap(bankStore().markViewed(QID.redisPersist));
    const v2 = sampleBundle('1.1.0');
    v2.questions = v2.questions.map((q) =>
      q.id === QID.redisExpire ? finalize({ ...q, answer: { ...q.answer, summary: '改过的一句话。' } }) : q,
    );
    await updateSampleBank(t, v2);

    mockParams = { updatedOnly: true };
    await render(<ListScreen />);
    expect(await screen.findByLabelText(`${TITLES.redisExpire}，中等 · 概念，内容已更新`)).toBeTruthy();
    expect(screen.getByText('改过的一句话。')).toBeTruthy();
    expect(screen.queryByText(TITLES.redisPersist)).toBeNull();
  });

  it('点题：以当前结果为练习队列保存会话并进入详情', async () => {
    t = await startSampleBank();
    mockParams = { categoryId: 'redis', categoryName: 'Redis' };
    await render(<ListScreen />);
    await fireEvent.press(await screen.findByText(TITLES.redisPersist));

    const queue = [QID.redisExpire, QID.redisPersist];
    await waitFor(() =>
      expect(mockNav.push).toHaveBeenCalledWith('Detail', { id: QID.redisPersist, queue, queueIndex: 1, mode: 'practice' }),
    );
    expect(await unwrap(bankStore().getSession())).toMatchObject({ queue, index: 1, mode: 'practice', title: 'Redis' });
  });

  it('Web（unsupported）显示不支持说明', async () => {
    await resetBankStoreForTests();
    await render(<ListScreen />);
    expect(await screen.findByText('Web 预览不支持本地题库')).toBeTruthy();
  });
});
