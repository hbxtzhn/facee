import { Image, Linking, StyleSheet } from 'react-native';
import type { ReactElement } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { createTestRuntime, publish, type TestRuntime } from '../bank/__fixtures__/node-runtime';
import {
  QID,
  SAMPLE_ASSET_CONTENT,
  SAMPLE_ASSET_NAME,
  finalize,
  sampleBundle,
} from '../bank/__fixtures__/sample-bank';
import { resetBankStoreForTests, useBankStore } from '../bank/store';
import type { Bundle } from '../bank';

/**
 * DetailScreen 组件测试：跑真实的题库 v2 数据层（node:sqlite + 临时目录文件系统 + 内存网络），
 * 断言 UI 经 useBankStore 读写的学习数据（打标 / 自评 / 追问 / 收藏 / 浏览 / 会话）。
 */

// 默认运行时按 Web 处理（返回 null）；用例显式注入 Node 运行时
jest.mock('../bank/runtime', () => ({ createDefaultRuntime: async () => null }));

// 可变路由参数：默认浏览模式；练习模式用例改成 { mode: 'practice' } 等。
const mockRouteParams: {
  id: string;
  mode?: 'browse' | 'practice' | 'review';
  queue?: string[];
  queueIndex?: number;
} = { id: QID.redisExpire };

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

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// eslint-disable-next-line import/first
import { DetailScreen } from './DetailScreen';
// eslint-disable-next-line import/first
import { useUserStore } from '../store/userStore';

const ASSETS = { [SAMPLE_ASSET_NAME]: SAMPLE_ASSET_CONTENT };
const SUMMARY = '惰性删除与定期删除组合清理过期 key。';

let t: TestRuntime;
const store = () => useBankStore.getState();

/** 安装题库（可修改 bundle）并初始化 store */
async function installBank(tweak?: (bundle: Bundle) => void): Promise<void> {
  const bundle = sampleBundle();
  tweak?.(bundle);
  bundle.questions = bundle.questions.map(finalize);
  await store().initialize({ runtime: t.rt });
  const result = await store().addOnlineBank(publish(t, bundle, { assets: ASSETS }));
  if (!result.ok) throw new Error(result.error.message);
}

async function learningOf(id: string) {
  const result = await store().getQuestion(id);
  if (!result.ok) throw new Error(result.error.message);
  return result.value.learning;
}

function setRoute(params: typeof mockRouteParams) {
  for (const key of Object.keys(mockRouteParams) as Array<keyof typeof mockRouteParams>) delete mockRouteParams[key];
  Object.assign(mockRouteParams, params);
}

function fontOf(text: string | RegExp): { fontSize?: number; lineHeight?: number; fontWeight?: string } {
  return StyleSheet.flatten(screen.getByText(text).props.style) ?? {};
}

function latestHeaderRight(): ReactElement {
  const calls = mockSetOptions.mock.calls.filter(([options]) => options?.headerRight);
  const options = calls[calls.length - 1][0] as { headerRight: () => ReactElement };
  return options.headerRight();
}

interface HostNode {
  type: string;
  props: Record<string, unknown>;
  children?: HostNode[];
}

function collectHostNodes(node: unknown, out: HostNode[] = []): HostNode[] {
  if (Array.isArray(node)) {
    for (const child of node) collectHostNodes(child, out);
    return out;
  }
  const host = node as HostNode | null;
  if (!host || typeof host !== 'object' || typeof host.type !== 'string') return out;
  out.push(host);
  for (const child of host.children ?? []) collectHostNodes(child, out);
  return out;
}

beforeAll(() => {
  // jest-expo 下 Image.getSize 会调用未定义的回调；组件用它按宽高比限高，打桩返回固定尺寸
  (Image as unknown as { getSize: unknown }).getSize = jest.fn(
    (_uri: string, success?: (w: number, h: number) => void) => success?.(640, 360),
  );
});

beforeEach(async () => {
  jest.clearAllMocks();
  await resetBankStoreForTests();
  t = await createTestRuntime({ migrate: false });
  // 掌握度控件用 Date.now() 判断是否到期：让数据层时钟与真实时间一致
  t.clock.value = Date.now();
  setRoute({ id: QID.redisExpire });
  useUserStore.setState({ answerExpandedByDefault: false, readingScale: 1 });
});

afterEach(async () => {
  await resetBankStoreForTests();
  await t.cleanup();
});

describe('DetailScreen 结构化答案', () => {
  it('浏览模式：元信息行 + 标题；答案默认隐藏，「查看参考答案」后显示一句话与要点（含权重）', async () => {
    await installBank();
    await render(<DetailScreen />);

    expect(await screen.findByText('Redis 过期 key 的删除策略有哪些？')).toBeTruthy();
    expect(screen.getByText('Redis · 中等 · 概念 · Redis >= 6')).toBeTruthy();
    expect(screen.queryByText(SUMMARY)).toBeNull();
    expect(screen.queryByLabelText(/我答到了/)).toBeNull();

    await fireEvent.press(screen.getByText('查看参考答案'));
    expect(screen.getByText(SUMMARY)).toBeTruthy();
    expect(screen.getByLabelText('我答到了：访问 key 时检查是否过期（惰性删除）')).toBeTruthy();
    expect(screen.getAllByText('重要')).toHaveLength(2);
    // 浏览模式：详解 / 示例 / 易错点默认展开
    expect(screen.getByText('访问时检查。')).toBeTruthy();
    expect(screen.getByText('· 把过期删除与内存淘汰混为一谈')).toBeTruthy();
  });

  it('浏览模式开启「默认展开答案」时直接显示', async () => {
    useUserStore.setState({ answerExpandedByDefault: true });
    await installBank();
    await render(<DetailScreen />);
    expect(await screen.findByText(SUMMARY)).toBeTruthy();
    expect(screen.queryByText('查看参考答案')).toBeNull();
  });

  it('练习模式：即使设置为默认展开，答案也要点「显示答案」才出现；详解默认折叠', async () => {
    useUserStore.setState({ answerExpandedByDefault: true });
    setRoute({ id: QID.redisExpire, mode: 'practice' });
    await installBank();
    await render(<DetailScreen />);

    await screen.findByText('Redis 过期 key 的删除策略有哪些？');
    expect(screen.queryByText(SUMMARY)).toBeNull();
    expect(fontOf('显示答案')).toMatchObject({ fontWeight: '600' });

    await fireEvent.press(await screen.findByLabelText('显示答案'));
    expect(screen.getByText(SUMMARY)).toBeTruthy();
    expect(screen.queryByText('访问时检查。')).toBeNull();
    await fireEvent.press(screen.getByLabelText('详解'));
    expect(screen.getByText('访问时检查。')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('收起答案'));
    expect(screen.queryByText(SUMMARY)).toBeNull();
  });

  it('补充题干（prompt）按 Markdown 渲染', async () => {
    setRoute({ id: QID.mysqlTx });
    await installBank();
    await render(<DetailScreen />);
    expect(await screen.findByText('结合 InnoDB 说明。')).toBeTruthy();
  });
});

describe('DetailScreen 要点自评 → 建议打标', () => {
  it('勾选要点并记录：经 store 写入自评，按权重覆盖率给出建议，由用户在底栏确认（不自动打标）', async () => {
    setRoute({ id: QID.redisExpire, mode: 'practice' });
    await installBank();
    await render(<DetailScreen />);
    await fireEvent.press(await screen.findByLabelText('显示答案'));

    // kp1、kp2 权重 2，kp3 权重 1 ⇒ 4 / 5 = 80 % ⇒ 建议「会了」
    await fireEvent.press(screen.getByLabelText('我答到了：访问 key 时检查是否过期（惰性删除）'));
    await fireEvent.press(screen.getByLabelText('我答到了：后台周期性抽样清理（定期删除）'));
    expect(screen.getByLabelText('我答到了：访问 key 时检查是否过期（惰性删除）').props.accessibilityState).toMatchObject({ checked: true });
    await fireEvent.press(screen.getByLabelText('记录要点自评'));

    expect(await screen.findByText(/要点覆盖 80%（按权重）· 建议标记「会了」/)).toBeTruthy();
    const attempts = await store().listKeypointAttempts(QID.redisExpire);
    expect(attempts.ok && attempts.value).toHaveLength(1);
    expect(attempts.ok && attempts.value[0].covered).toEqual({ kp1: true, kp2: true, kp3: false });

    // 只是建议：底栏「会了」有虚线提示，但尚未打标
    expect(screen.getByTestId('mastery-suggested-known')).toBeTruthy();
    expect((await learningOf(QID.redisExpire)).mastery).toBeNull();

    await fireEvent.press(screen.getByLabelText('标记这道题为会了'));
    await waitFor(async () => expect((await learningOf(QID.redisExpire)).mastery).toBe('known'));
    await waitFor(() =>
      expect(screen.getByLabelText('标记这道题为会了').props.accessibilityState).toMatchObject({ selected: true }),
    );
    expect(screen.queryByTestId('mastery-suggested-known')).toBeNull();
  });

  it('浏览模式：覆盖率低时建议「不会」，自评结果下方直接确认', async () => {
    useUserStore.setState({ answerExpandedByDefault: true });
    await installBank();
    await render(<DetailScreen />);
    await fireEvent.press(await screen.findByLabelText('记录要点自评'));
    expect(await screen.findByText(/要点覆盖 0%（按权重）· 建议标记「不会」/)).toBeTruthy();
    expect(screen.getAllByTestId('mastery-suggested-unknown').length).toBeGreaterThan(0);

    await fireEvent.press(screen.getAllByLabelText('标记这道题为不会')[0]);
    await waitFor(async () => expect((await learningOf(QID.redisExpire)).mastery).toBe('unknown'));
    // 打标后排期：不会 1 天
    expect((await learningOf(QID.redisExpire)).dueAt).toBe(t.clock.value + 24 * 60 * 60 * 1000);
  });

  it('有历史自评时显示上次覆盖率', async () => {
    useUserStore.setState({ answerExpandedByDefault: true });
    await installBank();
    await store().recordKeypointCheck(QID.redisExpire, { kp1: true, kp2: false, kp3: true });
    await render(<DetailScreen />);
    expect(await screen.findByText('上次覆盖 60%')).toBeTruthy();
  });
});

describe('DetailScreen 追问', () => {
  it('默认折叠，展开后可标记「会了 / 还不会」，经 store 保存，再点清除', async () => {
    useUserStore.setState({ answerExpandedByDefault: true });
    setRoute({ id: QID.mysqlTx });
    await installBank();
    await render(<DetailScreen />);

    expect(await screen.findByText('2 条')).toBeTruthy();
    expect(screen.queryByText('间隙锁 + MVCC。')).toBeNull();
    await fireEvent.press(screen.getByLabelText('幻读如何解决？'));
    expect(screen.getByText('间隙锁 + MVCC。')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('追问「幻读如何解决？」：会了'));
    await waitFor(async () => expect((await learningOf(QID.mysqlTx)).followups).toEqual({ f1: 'known' }));
    await waitFor(() =>
      expect(screen.getByLabelText('追问「幻读如何解决？」：会了').props.accessibilityState).toMatchObject({ selected: true }),
    );

    await fireEvent.press(screen.getByLabelText('追问「幻读如何解决？」：还不会'));
    await waitFor(async () => expect((await learningOf(QID.mysqlTx)).followups).toEqual({ f1: 'unknown' }));

    await fireEvent.press(screen.getByLabelText('追问「幻读如何解决？」：还不会'));
    await waitFor(async () => expect((await learningOf(QID.mysqlTx)).followups).toEqual({}));
  });
});

describe('DetailScreen 选择题', () => {
  it('选项可选，提交后判分并显示解析；答错建议「不会」，由用户确认', async () => {
    setRoute({ id: QID.mysqlIndex });
    await installBank();
    await render(<DetailScreen />);

    const submit = await screen.findByLabelText('提交答案');
    expect(submit).toBeDisabled();
    expect(screen.queryByText('B+ 树更适合磁盘。')).toBeNull();

    await fireEvent.press(screen.getByLabelText('选项 A：因为哈希表不支持等值查询'));
    expect(screen.getByLabelText('选项 A：因为哈希表不支持等值查询').props.accessibilityState).toMatchObject({ checked: true });
    await fireEvent.press(screen.getByLabelText('提交答案'));

    expect(screen.getByText('回答错误，正确答案：B')).toBeTruthy();
    expect(screen.getByText('B+ 树更适合磁盘。')).toBeTruthy();
    // 提交即展开答案区（选择题要点只读，不再自评）
    expect(screen.getByText('B+ 树矮胖、范围查询友好。')).toBeTruthy();
    expect(screen.queryByLabelText(/我答到了/)).toBeNull();

    // 浏览模式：头部掌握度入口带着建议自动展开
    expect(screen.getByTestId('mastery-suggested-unknown')).toBeTruthy();
    expect((await learningOf(QID.mysqlIndex)).mastery).toBeNull();
    await fireEvent.press(screen.getByLabelText('标记这道题为不会'));
    await waitFor(async () => expect((await learningOf(QID.mysqlIndex)).mastery).toBe('unknown'));
  });

  it('答对建议「会了」；可重做', async () => {
    setRoute({ id: QID.mysqlIndex, mode: 'practice' });
    await installBank();
    await render(<DetailScreen />);

    await fireEvent.press(await screen.findByLabelText('选项 B：因为 B+ 树矮胖且支持范围查询'));
    await fireEvent.press(screen.getByLabelText('提交答案'));
    expect(screen.getByText('回答正确')).toBeTruthy();
    expect(screen.getByTestId('mastery-suggested-known')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('重新作答'));
    expect(screen.queryByText('回答正确')).toBeNull();
    expect(screen.getByLabelText('提交答案')).toBeDisabled();
  });
});

describe('DetailScreen 内容已更新 / 纠错 / 来源', () => {
  it('学过之后题目内容变化：显示「内容已更新」，本次浏览后清除', async () => {
    await installBank();
    await store().markViewed(QID.redisExpire);

    const v2 = sampleBundle('1.1.0');
    const target = v2.questions.find((q) => q.id === QID.redisExpire)!;
    target.answer.summary = '惰性删除 + 定期删除，内存淘汰兜底。';
    v2.questions = v2.questions.map(finalize);
    publish(t, v2, { assets: ASSETS });
    const updated = await store().updateBank(v2.bank.id);
    expect(updated.ok).toBe(true);
    expect((await learningOf(QID.redisExpire)).contentUpdated).toBe(true);

    await render(<DetailScreen />);
    expect(await screen.findByText('内容已更新')).toBeTruthy();
    await waitFor(async () => expect((await learningOf(QID.redisExpire)).contentUpdated).toBe(false));
    // 本次阅读仍保留提示
    expect(screen.getByText('内容已更新')).toBeTruthy();
  });

  it('未更新的题不显示提示', async () => {
    await installBank();
    await render(<DetailScreen />);
    await screen.findByText('Redis 过期 key 的删除策略有哪些？');
    expect(screen.queryByText('内容已更新')).toBeNull();
  });

  it('题库有 feedbackUrl 时显示「内容有误？」，打开时替换 {questionId}', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await installBank();
    await render(<DetailScreen />);

    await fireEvent.press(await screen.findByLabelText('内容有误？反馈这道题'));
    expect(openURL).toHaveBeenCalledWith(`https://example.com/issues?q=${QID.redisExpire}`);
    openURL.mockRestore();
  });

  it('没有 feedbackUrl 时不显示纠错入口', async () => {
    await installBank((bundle) => {
      delete bundle.bank.feedbackUrl;
    });
    await render(<DetailScreen />);
    await screen.findByText('Redis 过期 key 的删除策略有哪些？');
    expect(screen.queryByText('内容有误？')).toBeNull();
  });

  it('参考资料链接、来源 + 许可、复核日期', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await installBank((bundle) => {
      bundle.questions[0].references = [{ title: 'Redis 官方文档', url: 'https://redis.io/docs/' }];
    });
    await render(<DetailScreen />);

    expect(await screen.findByText('参考资料')).toBeTruthy();
    expect(screen.getByText(/来源：自整理 · CC-BY-4.0/)).toBeTruthy();
    expect(screen.getByText('复核于 2026-11-05')).toBeTruthy();
    await fireEvent.press(screen.getByText('Redis 官方文档'));
    expect(openURL).toHaveBeenCalledWith('https://redis.io/docs/');
    openURL.mockRestore();
  });
});

describe('DetailScreen 图片资源', () => {
  it('Markdown 中的 asset: 引用解析为题库资源目录的文件 URI，并可点开全屏查看', async () => {
    useUserStore.setState({ answerExpandedByDefault: true });
    await installBank();
    const view = await render(<DetailScreen />);
    await screen.findByText('访问时检查。');

    const uris = collectHostNodes(view.toJSON())
      .filter((node) => node.type === 'Image')
      .map((node) => (node.props.source as { uri?: string } | undefined)?.uri ?? '');
    const assetUri = uris.find((uri) => uri.endsWith(SAMPLE_ASSET_NAME));
    expect(assetUri).toBeDefined();
    expect(assetUri).toContain(`${t.root}/documents/`);
    expect(assetUri!.startsWith('asset:')).toBe(false);
    expect(screen.queryByText(/!\[过期流程\]/)).toBeNull();

    await fireEvent.press(screen.getByLabelText('过期流程，点击全屏查看'));
    await waitFor(() => expect(screen.getByText(/双指缩放/)).toBeTruthy());
  });
});

describe('DetailScreen 队列分页 + 会话同步', () => {
  const QUEUE = [QID.mysqlTx, QID.mysqlIndex, QID.redisExpire, QID.redisPersist, QID.tcpHandshake];

  beforeEach(() => {
    setRoute({ id: QUEUE[0], mode: 'practice', queue: QUEUE, queueIndex: 0 });
  });

  async function startSession() {
    await installBank();
    await store().saveSession({ queue: QUEUE, index: 0, mode: 'practice' });
  }

  async function sessionIndex() {
    const result = await store().getSession();
    return result.ok ? result.value?.index : undefined;
  }

  it('只渲染当前页 ±1；只有当前页记录浏览；翻页经 store 同步会话下标', async () => {
    await startSession();
    await render(<DetailScreen />);

    expect(await screen.findByText('MySQL 的隔离级别有哪些？')).toBeTruthy();
    expect(screen.getByText('1 / 5')).toBeTruthy();
    expect(await screen.findByText('MySQL 索引为什么用 B+ 树？')).toBeTruthy();
    expect(screen.queryByText('Redis 过期 key 的删除策略有哪些？')).toBeNull();

    await waitFor(async () => expect((await learningOf(QID.mysqlTx)).viewedAt).not.toBeNull());
    // 预加载的相邻页不记浏览
    expect((await learningOf(QID.mysqlIndex)).viewedAt).toBeNull();

    await fireEvent.press(screen.getByLabelText('下一题'));
    expect(screen.getByText('2 / 5')).toBeTruthy();
    expect(await screen.findByText('Redis 过期 key 的删除策略有哪些？')).toBeTruthy();
    await waitFor(async () => expect(await sessionIndex()).toBe(1));
    await waitFor(async () => expect((await learningOf(QID.mysqlIndex)).viewedAt).not.toBeNull());

    await fireEvent(screen.getByTestId('question-pager'), 'pageSelected', { nativeEvent: { position: 2 } });
    expect(screen.getByText('3 / 5')).toBeTruthy();
    await waitFor(async () => expect(await sessionIndex()).toBe(2));

    await fireEvent.press(screen.getByLabelText('上一题'));
    expect(screen.getByText('2 / 5')).toBeTruthy();
    await waitFor(async () => expect(await sessionIndex()).toBe(1));
    // 窗口外的页被卸载
    await waitFor(() => expect(screen.queryByText('Redis 持久化 RDB 与 AOF 的区别')).toBeNull());
  });

  it('从队列中间进入时起始页即 queueIndex，且同步一次下标', async () => {
    setRoute({ id: QUEUE[3], mode: 'practice', queue: QUEUE, queueIndex: 3 });
    await startSession();
    await render(<DetailScreen />);
    expect(await screen.findByText('Redis 持久化 RDB 与 AOF 的区别')).toBeTruthy();
    expect(screen.getByText('4 / 5')).toBeTruthy();
    expect(screen.queryByText('MySQL 的隔离级别有哪些？')).toBeNull();
    await waitFor(async () => expect(await sessionIndex()).toBe(3));
  });

  it('首题禁用上一题，末题禁用下一题', async () => {
    await startSession();
    await render(<DetailScreen />);
    await screen.findByText('MySQL 的隔离级别有哪些？');
    expect(screen.getByLabelText('上一题')).toBeDisabled();
    await fireEvent(screen.getByTestId('question-pager'), 'pageSelected', { nativeEvent: { position: 4 } });
    expect(screen.getByText('5 / 5')).toBeTruthy();
    expect(screen.getByLabelText('下一题')).toBeDisabled();
  });

  it('底栏打标写入当前题（经 store 排期），再点清除；答案开关只作用于当前题', async () => {
    await startSession();
    await render(<DetailScreen />);
    await screen.findByText('MySQL 的隔离级别有哪些？');

    await fireEvent.press(await screen.findByLabelText('标记这道题为模糊'));
    await waitFor(async () => expect((await learningOf(QID.mysqlTx)).mastery).toBe('fuzzy'));
    await waitFor(() =>
      expect(screen.getByLabelText('标记这道题为模糊').props.accessibilityState).toMatchObject({ selected: true }),
    );
    expect(fontOf('模糊')).toMatchObject({ fontWeight: '600' });
    await fireEvent.press(screen.getByLabelText('标记这道题为模糊'));
    await waitFor(async () => expect((await learningOf(QID.mysqlTx)).mastery).toBeNull());

    await fireEvent.press(screen.getByLabelText('显示答案'));
    expect(screen.getByText('读未提交、读已提交、可重复读、串行化四种事务隔离级别。')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('下一题'));
    expect(await screen.findByLabelText('显示答案')).toBeTruthy();
    expect(screen.queryByText('B+ 树矮胖、范围查询友好。')).toBeNull();
    await fireEvent.press(await screen.findByLabelText('标记这道题为会了'));
    await waitFor(async () => expect((await learningOf(QID.mysqlIndex)).mastery).toBe('known'));
    expect((await learningOf(QID.mysqlTx)).mastery).toBeNull();
  });

  it('复习到期的题：上次标记不算选中，再点「会了」= 确认复习（连续次数 +1）', async () => {
    await startSession();
    await store().setMastery(QID.mysqlTx, 'known');
    t.clock.value += 8 * 24 * 60 * 60 * 1000;
    jest.spyOn(Date, 'now').mockReturnValue(t.clock.value);
    try {
      await render(<DetailScreen />);
      await screen.findByText('MySQL 的隔离级别有哪些？');
      const known = await screen.findByLabelText('标记这道题为会了');
      expect(known.props.accessibilityState).toMatchObject({ selected: false });
      await fireEvent.press(known);
      await waitFor(async () => expect((await learningOf(QID.mysqlTx)).streak).toBe(2));
      expect((await learningOf(QID.mysqlTx)).mastery).toBe('known');
    } finally {
      jest.restoreAllMocks();
    }
  });

  it('收藏按当前页的题目写入 store', async () => {
    await startSession();
    await render(<DetailScreen />);
    await screen.findByText('MySQL 索引为什么用 B+ 树？');

    // 当前页与预加载页各有一个收藏按钮；第一个属于当前题
    const buttons = await screen.findAllByLabelText('收藏这道题');
    await fireEvent.press(buttons[0]);
    await waitFor(async () => expect((await learningOf(QID.mysqlTx)).favorite).toBe(true));
    expect((await learningOf(QID.mysqlIndex)).favorite).toBe(false);
    expect(await screen.findByLabelText('取消收藏这道题')).toBeTruthy();
  });
});

describe('DetailScreen 阅读字号（Aa）与版式', () => {
  it('头部注入 Aa 开关，点按循环 标准 → 大 → 特大 → 标准', async () => {
    await installBank();
    await render(<DetailScreen />);
    await screen.findByText('Redis 过期 key 的删除策略有哪些？');
    expect(mockSetOptions).toHaveBeenCalledWith(expect.objectContaining({ headerRight: expect.any(Function) }));

    await render(latestHeaderRight());
    expect(screen.getByLabelText('阅读字号：标准')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('reading-scale-button'));
    expect(useUserStore.getState().readingScale).toBe(1.15);
    await fireEvent.press(screen.getByTestId('reading-scale-button'));
    expect(useUserStore.getState().readingScale).toBe(1.3);
    await fireEvent.press(screen.getByTestId('reading-scale-button'));
    expect(useUserStore.getState().readingScale).toBe(1);
  });

  it('题干、一句话与详解的字号行高随档位放大；限宽版心', async () => {
    useUserStore.setState({ answerExpandedByDefault: true });
    setRoute({ id: QID.mysqlTx });
    await installBank();
    await render(<DetailScreen />);

    await screen.findByText('结合 InnoDB 说明。');
    const summary = '读未提交、读已提交、可重复读、串行化四种事务隔离级别。';
    expect(fontOf('结合 InnoDB 说明。')).toMatchObject({ fontSize: 17, lineHeight: 30 });
    expect(fontOf(summary)).toMatchObject({ fontSize: 17, lineHeight: 30 });

    await act(() => useUserStore.getState().setReadingScale(1.3));
    await waitFor(() => expect(fontOf('结合 InnoDB 说明。')).toMatchObject({ fontSize: 22, lineHeight: 39 }));
    expect(fontOf(summary)).toMatchObject({ fontSize: 22, lineHeight: 39 });
    expect(StyleSheet.flatten(screen.getByTestId('reading-column').props.style)).toMatchObject({
      maxWidth: 680,
      paddingHorizontal: 20,
    });
  });
});

describe('DetailScreen 状态', () => {
  it('Web 预览（unsupported）显示不支持提示', async () => {
    await store().initialize();
    expect(store().status).toBe('unsupported');
    await render(<DetailScreen />);
    expect(screen.getByText('Web 预览不支持本地题库')).toBeTruthy();
  });

  it('题目不存在时显示加载失败', async () => {
    setRoute({ id: 'q_01JC8ZQ4N3V6W8X0Y2Z4A6B8ZZ' });
    await installBank();
    await render(<DetailScreen />);
    expect(await screen.findByText('题目加载失败')).toBeTruthy();
    expect(screen.getByText('题目不存在或已从题库移除')).toBeTruthy();
  });
});
