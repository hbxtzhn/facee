import { Image } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

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
const mockRouteParams: { id: string; mode?: 'practice'; queue?: string[] } = { id: 'jvm-memory-01' };

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
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
import { useQuestionBankStore } from '../question-bank/store';
// eslint-disable-next-line import/first
import type { QuestionBankCatalog } from '../question-bank/types';

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
    useMasteryStore.setState({ marks: {} });
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

    await screen.findByLabelText('标记这道题为会了');
    expect(screen.getByText('这道题掌握了吗？')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('标记这道题为会了'));
    expect(useMasteryStore.getState().getMark('bank-a', 'jvm-memory-01')).toBe('known');
  });

  it('练习模式：揭答案后出现自评 chips', async () => {
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

    expect(screen.getByText('这道题掌握了吗？')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('标记这道题为模糊'));
    expect(useMasteryStore.getState().getMark('bank-a', 'jvm-memory-01')).toBe('fuzzy');
  });
});
