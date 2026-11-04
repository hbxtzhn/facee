import { Image } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

/**
 * DetailScreen 组件测试。
 *
 * 锁的是「本地图片显示不出来」那个真机 bug —— 它有两层原因，缺一不可：
 *   1. markdown-it 默认拒绝 file: 协议 ⇒ `![图](file://…)` 根本不是图片 token（会被当正文文本渲染）
 *   2. 库默认 image 规则只白名单 data:image/*，file:// 直接 return null（渲染空白）
 * 第 1 层由 lib/markdown.spec.ts 覆盖；**第 2 层只有渲染测试能覆盖**，就是本文件。
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

// 可变路由参数：默认浏览模式；练习模式用例改成 { mode: 'practice' } 等。
// jest.mock 工厂只允许引用 mock* 前缀的变量。
const mockRouteParams: {
  id: string;
  mode?: 'practice' | 'review';
  queue?: string[];
  queueIndex?: number;
} = { id: 'jvm-memory-01' };

// 头部「Aa」经 navigation.setOptions({ headerRight }) 注入：记录调用以便渲染断言
const mockSetOptions = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    setOptions: mockSetOptions,
    push: jest.fn(),
    replace: jest.fn(),
    goBack: jest.fn(),
    popToTop: jest.fn(),
    canGoBack: () => true,
    getParent: () => null,
  }),
  useRoute: () => ({ params: mockRouteParams }),
  useFocusEffect: () => undefined,
}));

// 练习会话同步：另一位同事的 store 尚未合入，这里只断言调用口径
jest.mock('./detail/session-sync', () => ({ syncPracticeIndex: jest.fn() }));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// eslint-disable-next-line import/first
import { DetailScreen } from './DetailScreen';
// eslint-disable-next-line import/first
import { useUserStore } from '../store/userStore';
// eslint-disable-next-line import/first
import { useMasteryStore } from '../store/masteryStore';
// eslint-disable-next-line import/first
import { useFavoritesStore } from '../store/favoritesStore';
// eslint-disable-next-line import/first
import { useQuestionBankStore } from '../question-bank/store';
// eslint-disable-next-line import/first
import type { QuestionBankCatalog } from '../question-bank/types';
// eslint-disable-next-line import/first
import { syncPracticeIndex } from './detail/session-sync';
// eslint-disable-next-line import/first
import { StyleSheet } from 'react-native';
// eslint-disable-next-line import/first
import type { ReactElement } from 'react';

const mockSyncPracticeIndex = syncPracticeIndex as jest.MockedFunction<typeof syncPracticeIndex>;
const DAY = 24 * 60 * 60 * 1000;

function fontOf(text: string): { fontSize?: number; lineHeight?: number; fontWeight?: string } {
  return StyleSheet.flatten(screen.getByText(text).props.style) ?? {};
}

/** 取最近一次 setOptions 注入的 headerRight 元素 */
function latestHeaderRight(): ReactElement {
  const calls = mockSetOptions.mock.calls.filter(([options]) => options?.headerRight);
  const options = calls[calls.length - 1][0] as { headerRight: () => ReactElement };
  return options.headerRight();
}

type RepoMock = { getQuestion: jest.Mock; getContent: jest.Mock };
const mockRepository = jest.requireMock('../question-bank/client')
  .questionBankRepository as unknown as RepoMock;

// jest-expo 环境下 Image.getSize 的实现会调用未定义的 success 回调（报 "success is not a function"），
// 组件用它按真实宽高比限高 ⇒ 测试里打桩返回固定尺寸即可，不影响要断言的渲染结果。
beforeAll(() => {
  (Image as unknown as { getSize: unknown }).getSize = jest.fn(
    (_uri: string, success?: (w: number, h: number) => void) => success?.(640, 360),
  );
});

/**
 * RTL v14 去掉了 UNSAFE_getByType，且 root 上的 type 是 host 名（字符串）。
 * 因此从 toJSON() 的 host 树里按类型收集。
 */
interface HostNode {
  type: string;
  props: Record<string, unknown>;
  children?: HostNode[];
}

function collectHostNodes(
  node: { type?: string; props?: Record<string, unknown>; children?: unknown[] } | null,
  out: HostNode[] = [],
): HostNode[] {
  if (!node || typeof node !== 'object' || typeof node.type !== 'string') return out;
  out.push(node as HostNode);
  for (const child of node.children ?? []) {
    collectHostNodes(child as HostNode, out);
  }
  return out;
}

const IMAGE_URI = 'file:///data/user/0/com.facee.app/files/facee-question-bank/banks/ns/questions/jvm-memory-01/assets/memory-layout.png';

const meta = {
  id: 'jvm-memory-01',
  title: 'JVM 运行时数据区包含哪些部分？',
  difficulty: 2 as const,
  hasAnswer: true,
  sort: 10,
  categoryId: 'jvm',
  tags: [{ id: 'jvm', name: 'JVM' }],
};

describe('DetailScreen 本地图片渲染（§21 / §7.2）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useUserStore.setState({ answerExpandedByDefault: false });
    mockRepository.getQuestion.mockResolvedValue(meta);
    mockRepository.getContent.mockResolvedValue({
      id: meta.id,
      questionMd: `# 标题\n\n正文一段。\n\n![JVM 内存结构](${IMAGE_URI})\n\n后续段落。`,
      answerMd: null,
      followupsMd: null,
      assetBaseUri: 'file:///data/user/0/com.facee.app/files/facee-question-bank/banks/ns/questions/jvm-memory-01/assets/',
    });
  });

  it('file:// 图片被渲染成 Image（而不是被丢弃或当文本）', async () => {
    // RTL v14 移除了 UNSAFE_getByType，只能从 root 树里按元素类型收集
    const view = await render(<DetailScreen />);

    await waitFor(() => expect(screen.getByText('正文一段。')).toBeTruthy());

    const uris = collectHostNodes(view.toJSON() as HostNode | null)
      .filter((node) => node.type === 'Image')
      .map((node) => (node.props.source as { uri?: string } | undefined)?.uri);
    expect(uris).toContain(IMAGE_URI);

    // 原始 Markdown 不该以文本形式出现（修复前它就是这样被当成正文渲染的）
    expect(screen.queryByText(/!\[JVM 内存结构\]/)).toBeNull();
  });

  it('图片可点击进入全屏查看（无障碍标签即为接口）', async () => {
    await render(<DetailScreen />);

    const pressable = await screen.findByLabelText('JVM 内存结构，点击全屏查看');
    await fireEvent.press(pressable);

    await waitFor(() => expect(screen.getByText(/双指缩放/)).toBeTruthy());
  });
});

describe('DetailScreen 面试官追问（§9）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRepository.getQuestion.mockResolvedValue(meta);
  });

  it('followups.md 的追问与答案内嵌分节合并渲染，默认折叠、点击展开', async () => {
    useUserStore.setState({ answerExpandedByDefault: true });
    mockRepository.getContent.mockResolvedValue({
      id: meta.id,
      questionMd: '# 标题\n\n题干。',
      answerMd: '参考答案正文。\n\n### 面试官追问\n\n**追问 1：答案里的追问？**\n\n答案里的追问解答。',
      followupsMd: '## 追问 1：为什么这样设计？\n\n因为要隔离变化。\n\n## 追问 2：数据量增大怎么办？\n\n分片 + 冷热分离。',
      assetBaseUri: undefined,
    });

    await render(<DetailScreen />);

    // 设置项为「默认展开」⇒ 答案区直接出现
    await waitFor(() => expect(screen.getByText('参考答案正文。')).toBeTruthy());
    expect(screen.getByText('面试官追问')).toBeTruthy();
    // 答案内嵌 1 条 + followups.md 2 条 = 3 条
    expect(screen.getByText('3 条')).toBeTruthy();
    // 默认折叠：只看得到问题，看不到答案
    expect(screen.getByText('为什么这样设计？')).toBeTruthy();
    expect(screen.queryByText('因为要隔离变化。')).toBeNull();

    await fireEvent.press(screen.getByText('为什么这样设计？'));
    await waitFor(() => expect(screen.getByText('因为要隔离变化。')).toBeTruthy());
  });

  it('没有 followups.md 时不渲染追问区块', async () => {
    useUserStore.setState({ answerExpandedByDefault: true });
    mockRepository.getContent.mockResolvedValue({
      id: meta.id,
      questionMd: '# 标题\n\n题干。',
      answerMd: '只有主答案。',
      followupsMd: null,
      assetBaseUri: undefined,
    });

    await render(<DetailScreen />);

    await waitFor(() => expect(screen.getByText('只有主答案。')).toBeTruthy());
    expect(screen.queryByText('面试官追问')).toBeNull();
  });
});

describe('DetailScreen 答案默认展开设置（设置项 → 屏幕生效）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRepository.getQuestion.mockResolvedValue(meta);
    mockRepository.getContent.mockResolvedValue({
      id: meta.id,
      questionMd: '# 标题\n\n题干。',
      answerMd: '参考答案正文。',
      followupsMd: null,
      assetBaseUri: undefined,
    });
  });

  it('设置关闭时先只显示题目，并给出「查看参考答案」入口', async () => {
    useUserStore.setState({ answerExpandedByDefault: false });
    await render(<DetailScreen />);

    await waitFor(() => expect(screen.getByText('题干。')).toBeTruthy());
    expect(screen.queryByText('参考答案正文。')).toBeNull();
    expect(screen.getByText('查看参考答案')).toBeTruthy();
  });

  it('设置开启时新题直接显示答案', async () => {
    useUserStore.setState({ answerExpandedByDefault: true });
    await render(<DetailScreen />);

    await waitFor(() => expect(screen.getByText('参考答案正文。')).toBeTruthy());
    expect(screen.queryByText('查看参考答案')).toBeNull();
  });
});

function catalogFor(id: string): QuestionBankCatalog {
  return { schemaVersion: 1, id, title: '测试题库', tags: [], questions: [] };
}

describe('DetailScreen 掌握度打标', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useMasteryStore.setState({ marks: {}, markedAt: {}, knownStreaks: {} });
    useQuestionBankStore.setState({ catalog: null });
    useUserStore.setState({ answerExpandedByDefault: false });
    mockRouteParams.id = 'jvm-memory-01';
    delete mockRouteParams.mode;
    delete mockRouteParams.queue;
    mockRepository.getQuestion.mockResolvedValue(meta);
  });

  it('浏览模式：头部「标记」入口展开三态 chips，打标按题库命名空间写入', async () => {
    useQuestionBankStore.setState({ catalog: catalogFor('bank-a') });
    mockRepository.getContent.mockResolvedValue({
      id: meta.id,
      questionMd: '# 标题\n\n题干。',
      answerMd: '参考答案正文。',
      followupsMd: null,
      assetBaseUri: undefined,
    });

    await render(<DetailScreen />);
    await waitFor(() => expect(screen.getByText('题干。')).toBeTruthy());

    // 未展开时看不到 chips
    expect(screen.queryByLabelText('标记这道题为不会')).toBeNull();

    fireEvent.press(screen.getByLabelText('标记掌握程度'));
    fireEvent.press(await screen.findByLabelText('标记这道题为不会'));

    expect(useMasteryStore.getState().getMark('bank-a', 'jvm-memory-01')).toBe('unknown');
    // 另一个题库的同一题不受影响（命名空间隔离）
    expect(useMasteryStore.getState().getMark('bank-b', 'jvm-memory-01')).toBeNull();
  });

  it('无题库时打标入口整体隐藏', async () => {
    mockRepository.getContent.mockResolvedValue({
      id: meta.id,
      questionMd: '# 标题\n\n题干。',
      answerMd: '参考答案正文。',
      followupsMd: null,
      assetBaseUri: undefined,
    });

    await render(<DetailScreen />);
    await waitFor(() => expect(screen.getByText('题干。')).toBeTruthy());
    expect(screen.queryByLabelText('标记掌握程度')).toBeNull();
  });

  it('练习模式：无答案题（hasAnswer=false）不用揭答案也能打标', async () => {
    useQuestionBankStore.setState({ catalog: catalogFor('bank-a') });
    mockRouteParams.mode = 'practice';
    mockRepository.getQuestion.mockResolvedValue({ ...meta, hasAnswer: false });
    mockRepository.getContent.mockResolvedValue({
      id: meta.id,
      questionMd: '# 标题\n\n题干。',
      answerMd: null,
      followupsMd: null,
      assetBaseUri: undefined,
    });

    await render(<DetailScreen />);

    // 打标在底部操作栏；无答案时答案开关置灰
    await screen.findByLabelText('标记这道题为会了');
    expect(screen.getByLabelText('这道题暂无参考答案')).toBeDisabled();

    fireEvent.press(screen.getByLabelText('标记这道题为会了'));
    expect(useMasteryStore.getState().getMark('bank-a', 'jvm-memory-01')).toBe('known');
  });

  it('练习模式：底栏常驻自评 chips（揭答案前后都可打标）', async () => {
    useQuestionBankStore.setState({ catalog: catalogFor('bank-a') });
    mockRouteParams.mode = 'practice';
    useUserStore.setState({ answerExpandedByDefault: true });
    mockRepository.getContent.mockResolvedValue({
      id: meta.id,
      questionMd: '# 标题\n\n题干。',
      answerMd: '参考答案正文。',
      followupsMd: null,
      assetBaseUri: undefined,
    });

    await render(<DetailScreen />);
    await waitFor(() => expect(screen.getByText('参考答案正文。')).toBeTruthy());

    // 练习模式下浏览态的头部打标入口不出现，打标只在底栏
    expect(screen.queryByLabelText('标记掌握程度')).toBeNull();
    fireEvent.press(screen.getByLabelText('标记这道题为模糊'));
    expect(useMasteryStore.getState().getMark('bank-a', 'jvm-memory-01')).toBe('fuzzy');
  });
});

describe('DetailScreen 队列分页 + 底部操作栏', () => {
  const QUEUE = ['q1', 'q2', 'q3', 'q4', 'q5'];

  beforeEach(() => {
    jest.clearAllMocks();
    useMasteryStore.setState({ marks: {}, markedAt: {}, knownStreaks: {} });
    useQuestionBankStore.setState({ catalog: catalogFor('bank-a') });
    useUserStore.setState({ answerExpandedByDefault: false, lastViewedQuestionId: null });
    mockRouteParams.id = 'q1';
    mockRouteParams.mode = 'practice';
    mockRouteParams.queue = QUEUE;
    mockRouteParams.queueIndex = 0;
    mockRepository.getQuestion.mockImplementation(async (id: string) => ({ ...meta, id, title: `标题 ${id}` }));
    mockRepository.getContent.mockImplementation(async (id: string) => ({
      id,
      questionMd: `# 标题 ${id}\n\n题干 ${id}。`,
      answerMd: `答案 ${id}。`,
      followupsMd: null,
      assetBaseUri: undefined,
    }));
  });

  afterAll(() => {
    mockRouteParams.id = 'jvm-memory-01';
    delete mockRouteParams.mode;
    delete mockRouteParams.queue;
    delete mockRouteParams.queueIndex;
  });

  it('只渲染当前页 ±1，下一题/上一题更新进度与当前题（继续练习数据）', async () => {
    await render(<DetailScreen />);
    await waitFor(() => expect(screen.getByText('题干 q1。')).toBeTruthy());

    expect(screen.getByText('1 / 5')).toBeTruthy();
    expect(screen.getByLabelText('第 1 题，共 5 题')).toBeTruthy();
    // 窗口：q1 当前、q2 预加载，q3 之后不挂载
    await waitFor(() => expect(screen.getByText('题干 q2。')).toBeTruthy());
    expect(screen.queryByText('题干 q3。')).toBeNull();
    // 预加载页不记进度
    await waitFor(() => expect(useUserStore.getState().lastViewedQuestionId).toBe('q1'));

    await fireEvent.press(screen.getByLabelText('下一题'));
    expect(screen.getByText('2 / 5')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('题干 q3。')).toBeTruthy());
    await waitFor(() => expect(useUserStore.getState().lastViewedQuestionId).toBe('q2'));

    await fireEvent.press(screen.getByLabelText('上一题'));
    expect(screen.getByText('1 / 5')).toBeTruthy();
    await waitFor(() => expect(useUserStore.getState().lastViewedQuestionId).toBe('q1'));
    // 回到首页后 q3 移出窗口被卸载
    await waitFor(() => expect(screen.queryByText('题干 q3。')).toBeNull());
  });

  it('原生滑动选中新页（onPageSelected）同步进度', async () => {
    await render(<DetailScreen />);
    await waitFor(() => expect(screen.getByText('题干 q1。')).toBeTruthy());

    await fireEvent(screen.getByTestId('question-pager'), 'pageSelected', { nativeEvent: { position: 1 } });
    expect(screen.getByText('2 / 5')).toBeTruthy();
    await waitFor(() => expect(useUserStore.getState().lastViewedQuestionId).toBe('q2'));
  });

  it('首题禁用上一题，末题禁用下一题', async () => {
    await render(<DetailScreen />);
    await waitFor(() => expect(screen.getByText('题干 q1。')).toBeTruthy());

    expect(screen.getByLabelText('上一题')).toBeDisabled();
    expect(screen.getByLabelText('下一题')).toBeEnabled();

    await fireEvent(screen.getByTestId('question-pager'), 'pageSelected', { nativeEvent: { position: 4 } });
    expect(screen.getByText('5 / 5')).toBeTruthy();
    expect(screen.getByLabelText('下一题')).toBeDisabled();
    expect(screen.getByLabelText('上一题')).toBeEnabled();

    // 末题再点下一题无效（按钮置灰，越界保护）
    await fireEvent.press(screen.getByLabelText('下一题'));
    expect(screen.getByText('5 / 5')).toBeTruthy();
  });

  it('从队列中间进入（继续上次练习）时起始页即 queueIndex', async () => {
    mockRouteParams.id = 'q4';
    mockRouteParams.queueIndex = 3;
    await render(<DetailScreen />);

    await waitFor(() => expect(screen.getByText('题干 q4。')).toBeTruthy());
    expect(screen.getByText('4 / 5')).toBeTruthy();
    expect(screen.queryByText('题干 q1。')).toBeNull();
    await waitFor(() => expect(useUserStore.getState().lastViewedQuestionId).toBe('q4'));
  });

  it('答案开关只作用于当前题，新题仍按默认设置', async () => {
    await render(<DetailScreen />);
    await waitFor(() => expect(screen.getByText('题干 q1。')).toBeTruthy());
    expect(screen.queryByText('答案 q1。')).toBeNull();

    await fireEvent.press(await screen.findByLabelText('显示答案'));
    await waitFor(() => expect(screen.getByText('答案 q1。')).toBeTruthy());
    expect(screen.queryByText('答案 q2。')).toBeNull();

    await fireEvent.press(screen.getByLabelText('收起答案'));
    expect(screen.queryByText('答案 q1。')).toBeNull();

    await fireEvent.press(screen.getByLabelText('显示答案'));
    await fireEvent.press(screen.getByLabelText('下一题'));
    // q2 跟随默认（收起）；底栏开关回到「显示答案」
    expect(screen.queryByText('答案 q2。')).toBeNull();
    expect(await screen.findByLabelText('显示答案')).toBeTruthy();
    // 回到 q1 时保留刚才的手动展开
    await fireEvent.press(screen.getByLabelText('上一题'));
    expect(screen.getByText('答案 q1。')).toBeTruthy();
  });

  it('默认展开设置开启时，底栏开关初始为「收起答案」', async () => {
    useUserStore.setState({ answerExpandedByDefault: true });
    await render(<DetailScreen />);
    await waitFor(() => expect(screen.getByText('答案 q1。')).toBeTruthy());
    expect(await screen.findByLabelText('收起答案')).toBeTruthy();
  });

  it('底栏打标写入当前题', async () => {
    await render(<DetailScreen />);
    await waitFor(() => expect(screen.getByText('题干 q1。')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('标记这道题为不会'));
    expect(useMasteryStore.getState().getMark('bank-a', 'q1')).toBe('unknown');

    await fireEvent.press(screen.getByLabelText('下一题'));
    await fireEvent.press(screen.getByLabelText('标记这道题为会了'));
    expect(useMasteryStore.getState().getMark('bank-a', 'q2')).toBe('known');
    expect(useMasteryStore.getState().getMark('bank-a', 'q1')).toBe('unknown');
  });

  it('收藏按当前页的题目写入', async () => {
    useFavoritesStore.setState({ ids: [] });
    await render(<DetailScreen />);
    await waitFor(() => expect(screen.getByText('题干 q1。')).toBeTruthy());

    // 当前页与预加载页各有一个收藏按钮；第一个属于 q1
    const buttons = await screen.findAllByLabelText('收藏这道题');
    await fireEvent.press(buttons[0]);
    await waitFor(() => expect(useFavoritesStore.getState().ids).toEqual(['q1']));
  });
});

describe('DetailScreen 阅读字号（Aa）与阅读版式', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete mockRouteParams.mode;
    delete mockRouteParams.queue;
    delete mockRouteParams.queueIndex;
    mockRouteParams.id = 'jvm-memory-01';
    useUserStore.setState({ answerExpandedByDefault: true, readingScale: 1 });
    useQuestionBankStore.setState({ catalog: null });
    mockRepository.getQuestion.mockResolvedValue(meta);
    mockRepository.getContent.mockResolvedValue({
      id: meta.id,
      questionMd: '# 标题\n\n题干。',
      answerMd: '参考答案正文。',
      followupsMd: null,
      assetBaseUri: undefined,
    });
  });

  it('头部注入 Aa 开关，点按循环 标准 → 大 → 特大 → 标准', async () => {
    await render(<DetailScreen />);
    await waitFor(() => expect(screen.getByText('题干。')).toBeTruthy());
    expect(mockSetOptions).toHaveBeenCalledWith(expect.objectContaining({ headerRight: expect.any(Function) }));

    await render(latestHeaderRight());
    const button = () => screen.getByTestId('reading-scale-button');
    expect(screen.getByLabelText('阅读字号：标准')).toBeTruthy();

    await fireEvent.press(button());
    expect(useUserStore.getState().readingScale).toBe(1.15);
    expect(screen.getByLabelText('阅读字号：大')).toBeTruthy();

    await fireEvent.press(button());
    expect(useUserStore.getState().readingScale).toBe(1.3);
    expect(screen.getByLabelText('阅读字号：特大')).toBeTruthy();

    await fireEvent.press(button());
    expect(useUserStore.getState().readingScale).toBe(1);
  });

  it('题干与答案 Markdown 的字号、行高随档位放大', async () => {
    await render(<DetailScreen />);
    await waitFor(() => expect(screen.getByText('参考答案正文。')).toBeTruthy());
    expect(fontOf('题干。')).toMatchObject({ fontSize: 17, lineHeight: 30 });
    expect(fontOf('参考答案正文。')).toMatchObject({ fontSize: 17, lineHeight: 30 });

    await act(() => useUserStore.getState().setReadingScale(1.3));
    await waitFor(() => expect(fontOf('题干。')).toMatchObject({ fontSize: 22, lineHeight: 39 }));
    expect(fontOf('参考答案正文。')).toMatchObject({ fontSize: 22, lineHeight: 39 });
  });

  it('一行弱化元信息（难度 · 标签）+ 参考答案眉题 + 限宽版心', async () => {
    await render(<DetailScreen />);
    await waitFor(() => expect(screen.getByText('参考答案正文。')).toBeTruthy());
    expect(screen.getByText('中等 · JVM')).toBeTruthy();
    expect(screen.getByText('参考答案')).toBeTruthy();
    expect(StyleSheet.flatten(screen.getByTestId('reading-column').props.style)).toMatchObject({
      maxWidth: 680,
      paddingHorizontal: 20,
    });
  });
});

describe('DetailScreen 练习底栏状态 + 会话同步', () => {
  const QUEUE = ['q1', 'q2', 'q3'];

  beforeEach(() => {
    jest.clearAllMocks();
    useMasteryStore.setState({ marks: {}, markedAt: {}, knownStreaks: {} });
    useQuestionBankStore.setState({ catalog: catalogFor('bank-a') });
    useUserStore.setState({ answerExpandedByDefault: false, readingScale: 1 });
    mockRouteParams.id = 'q1';
    mockRouteParams.mode = 'practice';
    mockRouteParams.queue = QUEUE;
    mockRouteParams.queueIndex = 0;
    mockRepository.getQuestion.mockImplementation(async (id: string) => ({ ...meta, id, title: `标题 ${id}` }));
    mockRepository.getContent.mockImplementation(async (id: string) => ({
      id,
      questionMd: `# 标题 ${id}\n\n题干 ${id}。`,
      answerMd: `答案 ${id}。`,
      followupsMd: null,
      assetBaseUri: undefined,
    }));
  });

  afterAll(() => {
    mockRouteParams.id = 'jvm-memory-01';
    delete mockRouteParams.mode;
    delete mockRouteParams.queue;
    delete mockRouteParams.queueIndex;
  });

  it('翻页（按钮与原生滑动）都以当前题库 id 同步会话下标', async () => {
    await render(<DetailScreen />);
    await waitFor(() => expect(screen.getByText('题干 q1。')).toBeTruthy());
    expect(mockSyncPracticeIndex).toHaveBeenLastCalledWith('bank-a', 0);

    await fireEvent.press(screen.getByLabelText('下一题'));
    expect(mockSyncPracticeIndex).toHaveBeenLastCalledWith('bank-a', 1);

    await fireEvent(screen.getByTestId('question-pager'), 'pageSelected', { nativeEvent: { position: 2 } });
    expect(mockSyncPracticeIndex).toHaveBeenLastCalledWith('bank-a', 2);
  });

  it('单题练习（无队列）不同步会话下标，也不显示翻页组', async () => {
    delete mockRouteParams.queue;
    delete mockRouteParams.queueIndex;
    await render(<DetailScreen />);
    await waitFor(() => expect(screen.getByText('题干 q1。')).toBeTruthy());
    expect(mockSyncPracticeIndex).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('下一题')).toBeNull();
  });

  it('「显示答案」是唯一主操作（加粗主色），展开后降级为普通「收起答案」', async () => {
    await render(<DetailScreen />);
    await waitFor(() => expect(screen.getByText('题干 q1。')).toBeTruthy());
    expect(fontOf('显示答案')).toMatchObject({ fontWeight: '600' });

    await fireEvent.press(screen.getByLabelText('显示答案'));
    expect(fontOf('收起答案').fontWeight).not.toBe('600');
  });

  it('掌握度三态文字开关：选中态加粗强调，再点清除', async () => {
    await render(<DetailScreen />);
    await waitFor(() => expect(screen.getByText('题干 q1。')).toBeTruthy());

    expect(screen.getByLabelText('标记这道题为会了').props.accessibilityState).toMatchObject({ selected: false });
    await fireEvent.press(screen.getByLabelText('标记这道题为会了'));
    expect(screen.getByLabelText('标记这道题为会了').props.accessibilityState).toMatchObject({ selected: true });
    expect(fontOf('会了')).toMatchObject({ fontWeight: '600' });
    expect(fontOf('模糊').fontWeight).not.toBe('600');

    await fireEvent.press(screen.getByLabelText('标记这道题为会了'));
    expect(useMasteryStore.getState().getMark('bank-a', 'q1')).toBeNull();
  });

  it('复习到期的题：上次标记不算选中，再点「会了」= 确认复习（连续次数 +1），不误清除', async () => {
    useMasteryStore.setState({
      marks: { 'bank-a': { q1: 'known' } },
      markedAt: { 'bank-a': { q1: Date.now() - 8 * DAY } },
      knownStreaks: { 'bank-a': { q1: 1 } },
    });
    await render(<DetailScreen />);
    await waitFor(() => expect(screen.getByText('题干 q1。')).toBeTruthy());

    expect(screen.getByLabelText('标记这道题为会了').props.accessibilityState).toMatchObject({ selected: false });
    await fireEvent.press(screen.getByLabelText('标记这道题为会了'));
    expect(useMasteryStore.getState().getMark('bank-a', 'q1')).toBe('known');
    expect(useMasteryStore.getState().knownStreaks['bank-a']?.q1).toBe(2);
    expect(screen.getByLabelText('标记这道题为会了').props.accessibilityState).toMatchObject({ selected: true });
  });
});
