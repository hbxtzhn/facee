import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { TestRuntime } from '../bank/__fixtures__/node-runtime';

/**
 * 收藏 | 错题（题库 v2）：真实 useBankStore + Node SQLite。
 * 收藏 = favoritesOnly；错题 = 标成「不会 / 模糊」的题；按当前题库自动隔离；
 * 「开始复习」/「依次练习」/ 点题都以完整队列保存会话并进入详情。
 */

jest.mock('../bank/runtime', () => ({ createDefaultRuntime: async () => null }));

const mockNav = { push: jest.fn(), navigate: jest.fn(), goBack: jest.fn(), setOptions: jest.fn() };

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNav,
  useFocusEffect: () => undefined,
}));

// eslint-disable-next-line import/first
import { FavoritesScreen } from './FavoritesScreen';
// eslint-disable-next-line import/first
import { QID, bankStore, sampleBundle, startEmptyBank, startSampleBank, stopBank, unwrap } from './home/__fixtures__/bank-screen';
// eslint-disable-next-line import/first
import { resetBankStoreForTests } from '../bank/store';

const TX = 'MySQL 的隔离级别有哪些？';
const EXPIRE = 'Redis 过期 key 的删除策略有哪些？';
const PERSIST = 'Redis 持久化 RDB 与 AOF 的区别';
const TCP = 'TCP 为什么是三次握手？';

describe('FavoritesScreen（题库 v2）', () => {
  let t: TestRuntime | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(async () => {
    await cleanup();
    await stopBank(t);
    t = null;
  });

  it('收藏段列出当前题库的收藏，点题以收藏队列练习并保存会话', async () => {
    t = await startSampleBank();
    await unwrap(bankStore().toggleFavorite(QID.redisExpire));
    await unwrap(bankStore().toggleFavorite(QID.mysqlTx));
    await render(<FavoritesScreen />);

    expect(await screen.findByText(TX)).toBeTruthy();
    expect(screen.getByText(EXPIRE)).toBeTruthy();
    expect(screen.queryByText(TCP)).toBeNull();
    expect(screen.getByText('复习 · 测试题库')).toBeTruthy();

    // 默认排序：分类 order（MySQL 10 → Redis 50）
    await fireEvent.press(screen.getByText(EXPIRE));
    const queue = [QID.mysqlTx, QID.redisExpire];
    await waitFor(() =>
      expect(mockNav.navigate).toHaveBeenCalledWith('Detail', { id: QID.redisExpire, queue, queueIndex: 1, mode: 'practice' }),
    );
    expect(await unwrap(bankStore().getSession())).toMatchObject({ queue, index: 1, title: '收藏' });

    await fireEvent.press(screen.getByLabelText('依次练习 2 道收藏'));
    await waitFor(() =>
      expect(mockNav.navigate).toHaveBeenLastCalledWith('Detail', { id: QID.mysqlTx, queue, queueIndex: 0, mode: 'practice' }),
    );
  });

  it('错题段 = 不会 / 模糊（不含会了与未标），开始复习带完整队列', async () => {
    t = await startSampleBank();
    await unwrap(bankStore().setMastery(QID.mysqlTx, 'unknown'));
    await unwrap(bankStore().setMastery(QID.redisPersist, 'fuzzy'));
    await unwrap(bankStore().setMastery(QID.tcpHandshake, 'known'));
    await render(<FavoritesScreen />);

    await fireEvent.press(await screen.findByLabelText('错题（2 题）'));
    expect(screen.getByText(TX)).toBeTruthy();
    expect(screen.getByText(PERSIST)).toBeTruthy();
    expect(screen.queryByText(TCP)).toBeNull();
    expect(screen.getByLabelText(`${TX}，中等 · 概念 · 不会`)).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('开始复习 2 道错题'));
    await waitFor(() =>
      expect(mockNav.navigate).toHaveBeenCalledWith('Detail', {
        id: QID.mysqlTx,
        queue: [QID.mysqlTx, QID.redisPersist],
        queueIndex: 0,
        mode: 'practice',
      }),
    );
    expect(await unwrap(bankStore().getSession())).toMatchObject({ title: '错题复习' });
  });

  it('打标变化后（learningVersion）自动刷新：改标「会了」即移出错题', async () => {
    t = await startSampleBank();
    await unwrap(bankStore().setMastery(QID.mysqlTx, 'fuzzy'));
    await render(<FavoritesScreen />);
    await fireEvent.press(await screen.findByLabelText('错题（1 题）'));
    expect(screen.getByText(TX)).toBeTruthy();

    await unwrap(bankStore().setMastery(QID.mysqlTx, 'known'));
    expect(await screen.findByText('错题本是空的')).toBeTruthy();
  });

  it('收藏按题库隔离：切换题库后列表跟随', async () => {
    t = await startSampleBank();
    await unwrap(bankStore().toggleFavorite(QID.mysqlTx));
    const other = sampleBundle();
    other.bank = { ...other.bank, id: 'github.com/facee-test/other-bank', name: '另一个题库', update: undefined };
    t.clock.value += 1000;
    const imported = await unwrap(bankStore().importBankFile(t.writeLocalFile('other.json', JSON.stringify(other))));
    await render(<FavoritesScreen />);
    expect(await screen.findByText(TX)).toBeTruthy();

    await unwrap(bankStore().switchBank(imported.bankId));
    expect(await screen.findByText('还没有收藏题目')).toBeTruthy();
    expect(screen.getByText('复习 · 另一个题库')).toBeTruthy();
  });

  it('列表内搜索：无匹配给清除入口', async () => {
    t = await startSampleBank();
    await unwrap(bankStore().toggleFavorite(QID.mysqlTx));
    await unwrap(bankStore().toggleFavorite(QID.tcpHandshake));
    await render(<FavoritesScreen />);
    await screen.findByText(TX);

    await fireEvent.changeText(screen.getByLabelText('搜索当前列表'), 'tcp');
    expect(screen.queryByText(TX)).toBeNull();
    expect(screen.getByText(TCP)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('搜索当前列表'), '没有的词');
    expect(screen.getByText('没有匹配「没有的词」的题目')).toBeTruthy();
  });

  it('没有题库：空态给线上题库 / 新建本地题库入口', async () => {
    t = await startEmptyBank();
    await render(<FavoritesScreen />);
    await fireEvent.press(await screen.findByText('浏览线上题库'));
    expect(mockNav.navigate).toHaveBeenCalledWith('OnlineBanks');
  });

  it('Web（unsupported）显示不支持说明', async () => {
    await resetBankStoreForTests();
    await render(<FavoritesScreen />);
    expect(await screen.findByText('Web 预览不支持本地题库')).toBeTruthy();
  });
});
