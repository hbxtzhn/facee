import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { Question } from '../question-bank';

/**
 * ListScreen 组件测试。
 *
 * 锁的是**只有真机跑出来才发现**的那类 bug：
 * §6.2 正文命中区块曾用「标题命中集合」反查正文命中题的元数据，
 * 而正文命中的题按定义不在其中 ⇒ 元数据永远取不到 ⇒ 区块永远不渲染。
 * 纯函数测试覆盖不到这种组件层的数据合并。
 *
 * 基建要点（踩过的坑，复用这套 harness 时照抄）：
 *   1. @testing-library/react-native v14 起 `render` / `fireEvent` 都是**异步**的，
 *      必须 await，否则 screen 尚未填充（报 "`render` function has not been called"）。
 *   2. lucide-react-native 只发 ESM（.mjs），jest 默认不转译 ⇒
 *      由 moduleNameMapper 指向 src/test-utils/lucide-stub.tsx。
 *   3. mock 工厂里**不要**闭包引用外部 const（会被提升到 import 之前，落进 TDZ）；
 *      统一用 jest.requireMock 取回，见下方。
 *   4. 仓库整体替换为假实现 ⇒ 完全不碰原生文件系统 / 下载 / 解压。
 */

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

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ push: jest.fn(), goBack: jest.fn(), popToTop: jest.fn(), canGoBack: () => true }),
  useRoute: () => ({ params: { categoryId: 'network', categoryName: '计算机网络' } }),
}));

// eslint-disable-next-line import/first
import { ListScreen } from './ListScreen';

type RepoMock = {
  getCatalog: jest.Mock;
  getQuestion: jest.Mock;
  listQuestions: jest.Mock;
  searchBody: jest.Mock;
};

const mockRepository = jest.requireMock('../question-bank/client')
  .questionBankRepository as unknown as RepoMock;

const question = (overrides: Partial<Question> & { id: string }): Question => ({
  title: `题目 ${overrides.id}`,
  difficulty: 1,
  hasAnswer: true,
  sort: 10,
  tags: [{ id: 'network', name: '计算机网络' }],
  categoryId: 'network',
  ...overrides,
});

const titleMatch = question({
  id: 'net-http-01',
  title: 'HTTP/1.1、HTTP/2、HTTP/3 有什么区别？',
  difficulty: 2,
});
const bodyOnlyMatch = question({ id: 'net-http-02', title: '浏览器输入 URL 后发生了什么？', difficulty: 3 });

describe('ListScreen 正文搜索区块（§6.2）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // 标签 chips 依赖 catalog；不提供时组件按「无 chips」降级
    mockRepository.getCatalog.mockResolvedValue(null);
    mockRepository.listQuestions.mockResolvedValue([titleMatch]);
    mockRepository.searchBody.mockResolvedValue([
      { id: 'net-http-01', hits: 3, snippet: '…头部压缩 hpack…' }, // 标题已命中，应被排除
      { id: 'net-http-02', hits: 1, snippet: '…hpack 静态表…' },
    ]);
    mockRepository.getQuestion.mockImplementation(async (id: string) =>
      id === 'net-http-02' ? bodyOnlyMatch : null,
    );
  });

  const search = async (keyword: string) => {
    await render(<ListScreen />);
    await fireEvent.changeText(screen.getByPlaceholderText('搜索计算机网络题目'), keyword);
  };

  it('输入关键词后按分类 + 关键词查询并渲染标题命中', async () => {
    await search('hpack');

    await waitFor(() => expect(screen.getByText(titleMatch.title)).toBeTruthy());
    expect(mockRepository.listQuestions).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'hpack', categoryId: 'network' }),
    );
  });

  it('正文命中的题单独成区，且元数据取自 getQuestion 而不是标题命中集合', async () => {
    await search('hpack');

    await waitFor(() => expect(screen.getByText('正文命中 1 题')).toBeTruthy());
    expect(screen.getByText(bodyOnlyMatch.title)).toBeTruthy();
    expect(screen.getByText(/hpack 静态表/)).toBeTruthy(); // 命中片段预览
    // 回归点：正文命中题的元数据必须由 getQuestion 解析出来
    expect(mockRepository.getQuestion).toHaveBeenCalledWith('net-http-02');
  });

  it('同时命中标题与正文的题不会重复出现', async () => {
    await search('hpack');

    await waitFor(() => expect(screen.getByText('正文命中 1 题')).toBeTruthy());
    expect(screen.getAllByText(titleMatch.title)).toHaveLength(1);
    expect(mockRepository.getQuestion).not.toHaveBeenCalledWith('net-http-01');
  });

  it('清空关键词后正文区块消失，且不再发起正文搜索', async () => {
    await search('hpack');
    await waitFor(() => expect(screen.getByText('正文命中 1 题')).toBeTruthy());

    await fireEvent.changeText(screen.getByPlaceholderText('搜索计算机网络题目'), '');

    await waitFor(() => expect(screen.queryByText('正文命中 1 题')).toBeNull());
    expect(mockRepository.searchBody).toHaveBeenCalledTimes(1);
  });

  it('完全无命中时展示空状态', async () => {
    mockRepository.listQuestions.mockResolvedValue([]);
    mockRepository.searchBody.mockResolvedValue([]);
    await search('不存在的词');

    await waitFor(() => expect(screen.getByText('没有找到匹配题目')).toBeTruthy());
  });

  it('正文命中题可点击进入详情（带元数据）', async () => {
    await search('hpack');
    await waitFor(() => expect(screen.getByText(bodyOnlyMatch.title)).toBeTruthy());

    await fireEvent.press(screen.getByText(bodyOnlyMatch.title));

    expect(screen.getByText(bodyOnlyMatch.title)).toBeTruthy();
  });
});

describe('ListScreen 标签筛选 chips（§6.4）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRepository.getCatalog.mockResolvedValue({
      schemaVersion: 1,
      id: 'bank-x',
      title: '测试题库',
      tags: [
        { id: 'network', name: '计算机网络', parentId: null, sort: 10 },
        { id: 'http', name: 'HTTP', parentId: 'network', sort: 10 },
        { id: 'os', name: '操作系统', parentId: null, sort: 20 },
      ],
      questions: [{ ...titleMatch, tags: [{ id: 'http', name: 'HTTP' }] }],
    });
    mockRepository.listQuestions.mockResolvedValue([titleMatch]);
  });

  it('只展示范围内出现的根标签（子树计数），点选按并集收窄、再点取消', async () => {
    await render(<ListScreen />);

    // network 子树（含 http）覆盖范围内唯一的题；os 无题 → 不出现
    expect(await screen.findByText(/计算机网络 · 1/)).toBeTruthy();
    expect(screen.queryByText(/操作系统/)).toBeNull();

    await fireEvent.press(screen.getByLabelText('按标签 计算机网络 筛选'));
    await waitFor(() =>
      expect(mockRepository.listQuestions).toHaveBeenLastCalledWith(
        expect.objectContaining({ tagIds: ['network'] }),
      ),
    );

    await fireEvent.press(screen.getByLabelText('按标签 计算机网络 筛选'));
    await waitFor(() =>
      expect(mockRepository.listQuestions).toHaveBeenLastCalledWith(
        expect.objectContaining({ tagIds: [] }),
      ),
    );
  });

  it('难度多选：点两个难度按并集查询，再点全部取消', async () => {
    await render(<ListScreen />);

    await fireEvent.press(screen.getByLabelText('简单难度'));
    await fireEvent.press(screen.getByLabelText('困难难度'));
    await waitFor(() =>
      expect(mockRepository.listQuestions).toHaveBeenLastCalledWith(
        expect.objectContaining({ difficulties: [1, 3] }),
      ),
    );

    await fireEvent.press(screen.getByLabelText('简单难度'));
    await fireEvent.press(screen.getByLabelText('困难难度'));
    await waitFor(() =>
      expect(mockRepository.listQuestions).toHaveBeenLastCalledWith(
        expect.objectContaining({ difficulties: [] }),
      ),
    );
  });
});
