import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { TestRuntime } from '../bank/__fixtures__/node-runtime';

/**
 * 首页（题库 v2）：真实 useBankStore + Node SQLite 运行时。
 * 覆盖 Web 不支持 / 无题库空态、统计行、分类 / 专题 / 分区、今日复习、继续上次练习、
 * 「内容已更新」入口、全局搜索入口与按来源分组的题库切换器。
 */

jest.mock('../bank/runtime', () => ({ createDefaultRuntime: async () => null }));

const mockNav = { push: jest.fn(), navigate: jest.fn(), goBack: jest.fn(), setOptions: jest.fn() };

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNav,
  useFocusEffect: () => undefined,
}));

// eslint-disable-next-line import/first
import { HomeScreen } from './HomeScreen';
// eslint-disable-next-line import/first
import {
  QID,
  SAMPLE_BANK_ID,
  bankStore,
  sampleBundle,
  startEmptyBank,
  startSampleBank,
  stopBank,
  unwrap,
  updateSampleBank,
} from './home/__fixtures__/bank-screen';
// eslint-disable-next-line import/first
import { resetBankStoreForTests } from '../bank/store';
// eslint-disable-next-line import/first
import { finalize } from '../bank/__fixtures__/sample-bank';

const DAY = 24 * 60 * 60 * 1000;

describe('HomeScreen（题库 v2）', () => {
  let t: TestRuntime | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(async () => {
    await cleanup();
    await stopBank(t);
    t = null;
  });

  it('Web（unsupported）：自动初始化后显示不支持说明，不给切换入口', async () => {
    await resetBankStoreForTests();
    await render(<HomeScreen />);
    expect(await screen.findByText('Web 预览不支持本地题库')).toBeTruthy();
    expect(bankStore().status).toBe('unsupported');
    expect(screen.queryByLabelText('搜索全部题目')).toBeNull();
  });

  it('没有题库：空态给线上题库与新建本地题库入口', async () => {
    t = await startEmptyBank();
    await render(<HomeScreen />);
    expect(await screen.findByText('还没有题库')).toBeTruthy();

    await fireEvent.press(screen.getByText('浏览线上题库'));
    expect(mockNav.navigate).toHaveBeenCalledWith('OnlineBanks');
    await fireEvent.press(screen.getByLabelText('新建本地题库'));
    expect(mockNav.navigate).toHaveBeenCalledWith('BankManager');
  });

  it('当前题库：标题、统计行、专题、分类（题数 + 已掌握数）与新建分区入口', async () => {
    t = await startSampleBank();
    await unwrap(bankStore().setMastery(QID.redisExpire, 'known'));
    await render(<HomeScreen />);

    expect(await screen.findByLabelText('当前题库 测试题库，点按切换')).toBeTruthy();
    expect(screen.getByText('共 5 题 · 已标 1 · 会了 1')).toBeTruthy();
    // 专题
    expect(screen.getByLabelText('专题 冲刺，2 道题')).toBeTruthy();
    // 分类按 order → id
    expect(screen.getByLabelText('MySQL，2 道题')).toBeTruthy();
    expect(screen.getByLabelText('Redis，2 道题')).toBeTruthy();
    expect(screen.getByLabelText('网络，1 道题')).toBeTruthy();
    expect(screen.getByText('已掌握 1 题')).toBeTruthy();
    // 还没有分区：给新建入口
    expect(screen.getByLabelText('新建分区')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('MySQL，2 道题'));
    expect(mockNav.push).toHaveBeenLastCalledWith('List', { categoryId: 'mysql', categoryName: 'MySQL' });
    await fireEvent.press(screen.getByLabelText('专题 冲刺，2 道题'));
    expect(mockNav.push).toHaveBeenLastCalledWith('List', { collectionId: 'sprint', collectionName: '冲刺' });
    await fireEvent.press(screen.getByLabelText('新建分区'));
    expect(mockNav.push).toHaveBeenLastCalledWith('Sections');
  });

  it('全局搜索入口进入整库搜索', async () => {
    t = await startSampleBank();
    await render(<HomeScreen />);
    await fireEvent.press(await screen.findByLabelText('搜索全部题目'));
    expect(mockNav.push).toHaveBeenCalledWith('List', { search: true });
  });

  it('自定义分区显示在分类之上，含「已不在题库中」计数；点按进入分区', async () => {
    t = await startSampleBank();
    const id = await unwrap(bankStore().createSection('一面必刷'));
    await unwrap(bankStore().addCategoryToSection(id, 'redis'));
    await unwrap(bankStore().addCategoryToSection(id, 'network'));
    const v2 = sampleBundle('1.1.0');
    v2.categories = v2.categories.filter((c) => c.id !== 'network');
    v2.questions = v2.questions.filter((q) => q.id !== QID.tcpHandshake);
    v2.lifecycle.removed.push(QID.tcpHandshake);
    await updateSampleBank(t, v2);

    await render(<HomeScreen />);
    const row = await screen.findByLabelText('分区 一面必刷，1 个分类 · 2 题 · 1 个已不在题库中');
    // 分类全集照常列出（含已在分区里的 Redis）
    expect(screen.getByLabelText('Redis，2 道题')).toBeTruthy();
    expect(screen.queryByLabelText('网络，1 道题')).toBeNull();

    await fireEvent.press(row);
    expect(mockNav.push).toHaveBeenCalledWith('Section', { sectionId: id, sectionName: '一面必刷' });
  });

  it('今日复习：到期题进入 review 队列并保存会话', async () => {
    t = await startSampleBank();
    await unwrap(bankStore().setMastery(QID.mysqlTx, 'unknown')); // 1 天后到期
    await unwrap(bankStore().setMastery(QID.redisPersist, 'known')); // 7 天后到期
    t.clock.value += 2 * DAY;

    await render(<HomeScreen />);
    const row = await screen.findByLabelText('今日复习，1 道题到期');
    await fireEvent.press(row);

    await waitFor(() =>
      expect(mockNav.push).toHaveBeenCalledWith('Detail', { id: QID.mysqlTx, queue: [QID.mysqlTx], queueIndex: 0, mode: 'review' }),
    );
    const session = await unwrap(bankStore().getSession());
    expect(session).toMatchObject({ queue: [QID.mysqlTx], index: 0, mode: 'review', title: '今日复习' });
  });

  it('没有到期题、没有会话时不显示「今天」', async () => {
    t = await startSampleBank();
    await render(<HomeScreen />);
    await screen.findByLabelText('MySQL，2 道题');
    expect(screen.queryByText('今天')).toBeNull();
    expect(screen.queryByLabelText(/今日复习/)).toBeNull();
  });

  it('继续上次练习：按会话的队列 / 下标 / 模式恢复', async () => {
    t = await startSampleBank();
    await unwrap(
      bankStore().saveSession({ queue: [QID.redisExpire, QID.redisPersist], index: 1, mode: 'practice', title: 'Redis' }),
    );
    await render(<HomeScreen />);

    const row = await screen.findByLabelText('继续上次练习，Redis 持久化 RDB 与 AOF 的区别');
    expect(screen.getByText('Redis · 第 2 / 2 题')).toBeTruthy();
    await fireEvent.press(row);
    expect(mockNav.push).toHaveBeenCalledWith('Detail', {
      id: QID.redisPersist,
      queue: [QID.redisExpire, QID.redisPersist],
      queueIndex: 1,
      mode: 'practice',
    });
  });

  it('学过的题内容更新后显示「内容已更新」入口', async () => {
    t = await startSampleBank();
    await unwrap(bankStore().markViewed(QID.redisExpire));
    const v2 = sampleBundle('1.1.0');
    v2.questions = v2.questions.map((q) =>
      q.id === QID.redisExpire ? finalize({ ...q, answer: { ...q.answer, summary: '改过的一句话。' } }) : q,
    );
    await updateSampleBank(t, v2);

    await render(<HomeScreen />);
    await fireEvent.press(await screen.findByLabelText('内容已更新，1 道题'));
    expect(mockNav.push).toHaveBeenCalledWith('List', { updatedOnly: true });
  });

  it('题库切换器按来源分组（线上 / 本地 / 导入），点按切换当前题库', async () => {
    t = await startSampleBank();
    // 自动选中的当前题库没有持久化，回退为「最早安装」：同一时钟下按 id 排序，这里错开安装时间
    t.clock.value += 1000;
    const localId = await unwrap(bankStore().createLocalBank({ name: '我的本地库' }));
    const other = sampleBundle();
    // 没有更新地址的文件导入 → origin 'file'
    other.bank = { ...other.bank, id: 'github.com/facee-test/other-bank', name: '导入的题库', update: undefined };
    t.clock.value += 1000;
    await unwrap(bankStore().importBankFile(t.writeLocalFile('other.json', JSON.stringify(other))));
    expect(bankStore().activeBankId).toBe(SAMPLE_BANK_ID);

    await render(<HomeScreen />);
    await fireEvent.press(await screen.findByLabelText('当前题库 测试题库，点按切换'));

    expect(screen.getByText('线上')).toBeTruthy();
    expect(screen.getByText('本地')).toBeTruthy();
    expect(screen.getByText('导入')).toBeTruthy();
    expect(screen.getByLabelText('当前题库 测试题库')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('切换到题库 我的本地库'));
    await waitFor(() => expect(bankStore().activeBankId).toBe(localId));
    expect(await screen.findByLabelText('当前题库 我的本地库，点按切换')).toBeTruthy();
    await act(async () => undefined);
  });
});
