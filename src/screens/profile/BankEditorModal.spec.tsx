import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

/**
 * 本地题库编辑页正文（真实 useBankStore + Node SQLite 运行时）：
 * 题库信息草稿的未保存守卫（usePreventRemove）、分类 / 标签管理、题目删除与排序、AI 导入写入数据层、
 * 线上题库只读并可「复制为本地编辑」。导航用最小替身：goBack 触发移除时交给 usePreventRemove 拦截。
 */

type Guard = { prevent: boolean; callback: (event: { data: { action: unknown } }) => void };
const mockGuards: Guard[] = [];
const mockLeft: unknown[] = [];

function mockRemove(action: unknown) {
  const blocking = mockGuards.filter((guard) => guard.prevent);
  if (blocking.length === 0) mockLeft.push(action);
  else blocking.forEach((guard) => guard.callback({ data: { action } }));
}

const mockNav = {
  goBack: jest.fn(() => mockRemove({ type: 'GO_BACK' })),
  dispatch: jest.fn((action: unknown) => mockLeft.push(action)),
  replace: jest.fn(),
};

jest.mock('@react-navigation/native', () => {
  const { useRef } = jest.requireActual('react');
  return {
    useNavigation: () => mockNav,
    usePreventRemove: (prevent: boolean, callback: Guard['callback']) => {
      const slot = useRef(null as Guard | null);
      if (!slot.current) {
        slot.current = { prevent, callback };
        mockGuards.push(slot.current);
      }
      slot.current.prevent = prevent;
      slot.current.callback = callback;
    },
  };
});
jest.mock('expo-file-system/legacy', () => jest.requireActual('./bank-test-utils').mockLegacyFs());

const mockDrafts = [
  {
    title: 'AI 抽取的题', type: 'concept', difficulty: 'easy', prompt: null, summary: '结论。', detail: '详解', pitfalls: ['坑'],
    followups: [{ q: '追问', a: '答' }], notes: [],
    keyPoints: [{ text: '一', weight: 2 }, { text: '二', weight: 1 }, { text: '三', weight: 3 }],
  },
  {
    // 数据层整库校验会拒绝（要点不足），用来验证部分失败的提示
    title: '坏草稿', type: 'concept', difficulty: 'easy', prompt: null, summary: '结论', detail: null, pitfalls: [], followups: [], notes: [],
    keyPoints: [{ text: '只有一条', weight: 1 }],
  },
];
jest.mock('./ImportTextModal', () => {
  const { Pressable, Text } = jest.requireActual('react-native');
  return {
    ImportTextModal: ({ visible, onConfirm }: { visible: boolean; onConfirm: (drafts: unknown[]) => void }) =>
      visible ? (
        <Pressable accessibilityLabel="模拟确认导入" onPress={() => onConfirm(mockDrafts)}>
          <Text>导入</Text>
        </Pressable>
      ) : null,
  };
});

// eslint-disable-next-line import/first
import { BankEditorContent, draftToInput } from './BankEditorModal';
// eslint-disable-next-line import/first
import { useBankStore, type LocalQuestionInput } from '../../bank';
// eslint-disable-next-line import/first
import type { TestRuntime } from '../../bank/__fixtures__/node-runtime';
// eslint-disable-next-line import/first
import { SAMPLE_BANK_ID, installSampleRemote, setupBankStore, teardownBankStore } from './bank-test-utils';

let t: TestRuntime;
let bankId: string;
const store = () => useBankStore.getState();

function questionInput(title: string): LocalQuestionInput {
  return {
    title,
    type: 'concept',
    difficulty: 'medium',
    importance: 2,
    categoryId: 'default',
    answer: { summary: `${title}的结论`, keyPoints: [{ text: 'a' }, { text: 'b' }, { text: 'c' }] },
  };
}

async function listedTitles(): Promise<string[]> {
  const result = await store().listQuestions(undefined, bankId);
  if (!result.ok) throw new Error(result.error.message);
  return result.value.map((q) => q.title);
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockGuards.length = 0;
  mockLeft.length = 0;
  t = await setupBankStore();
  const created = await store().createLocalBank({ name: '我的题库' });
  if (!created.ok) throw new Error(created.error.message);
  bankId = created.value;
});
afterEach(async () => {
  await teardownBankStore(t);
});

type View = Awaited<ReturnType<typeof render>>;
async function renderEditor(id = bankId): Promise<View> {
  const view = await render(<BankEditorContent bankId={id} onOpenAiSettings={() => undefined} />);
  await waitFor(() => expect(view.queryByText('正在读取题库…')).toBeNull());
  return view;
}
const press = async (view: View, label: string) => {
  await act(async () => { fireEvent.press(view.getByLabelText(label)); });
};

describe('BankEditorContent 本地题库编辑', () => {
  it('题库名称草稿：未保存时返回被拦下，可继续编辑或放弃离开', async () => {
    const view = await renderEditor();
    expect(view.getByLabelText('题库名称').props.value).toBe('我的题库');
    await act(async () => { fireEvent.changeText(view.getByLabelText('题库名称'), '新名字'); });
    await act(async () => { mockNav.goBack(); });
    expect(mockLeft).toHaveLength(0);
    expect(view.getByText('题库名称 / 简介有未保存的修改，离开后将丢失。')).toBeTruthy();
    await act(async () => { fireEvent.press(view.getByText('继续编辑')); });
    expect(view.getByLabelText('题库名称').props.value).toBe('新名字');

    await act(async () => { mockNav.goBack(); });
    await act(async () => { fireEvent.press(view.getByText('放弃修改并离开')); });
    expect(mockLeft).toEqual([{ type: 'GO_BACK' }]);
    expect(store().banks[0].name).toBe('我的题库');
  });

  it('保存信息后写入数据层，不再拦截离开', async () => {
    const view = await renderEditor();
    await act(async () => { fireEvent.changeText(view.getByLabelText('题库名称'), '后端八股'); });
    await act(async () => { fireEvent.changeText(view.getByLabelText('题库简介'), '自用'); });
    await act(async () => { fireEvent.press(view.getByText('保存信息')); });
    await waitFor(() => expect(store().banks[0]).toMatchObject({ name: '后端八股', description: '自用' }));
    expect(view.getByText('题库信息已保存。')).toBeTruthy();
    await act(async () => { mockNav.goBack(); });
    expect(mockLeft).toEqual([{ type: 'GO_BACK' }]);
  });

  it('分类：添加、改名；有题的分类删除时移入其它分类', async () => {
    const view = await renderEditor();
    await act(async () => { fireEvent.changeText(view.getByLabelText('新分类名称'), 'Redis'); });
    await press(view, '添加分类');
    await waitFor(() => expect(view.getByLabelText('重命名分类 Redis')).toBeTruthy());
    await press(view, '重命名分类 Redis');
    await act(async () => { fireEvent.changeText(view.getByLabelText('分类 Redis 新名称'), '缓存'); });
    await press(view, '保存分类 Redis 名称');
    await waitFor(() => expect(view.getByLabelText('重命名分类 缓存')).toBeTruthy());

    expect((await store().addLocalQuestion(bankId, questionInput('默认分类下的题'))).ok).toBe(true);
    await waitFor(() => expect(view.getByText('默认分类下的题')).toBeTruthy());
    await press(view, '删除分类 默认分类');
    expect(view.getByText('删除并移入「缓存」')).toBeTruthy();
    await press(view, '确认删除分类 默认分类');
    await waitFor(() => expect(view.queryByLabelText('删除分类 默认分类')).toBeNull());
    const list = await store().listQuestions(undefined, bankId);
    expect(list.ok && list.value[0].categoryId).not.toBe('default');
  });

  it('标签：添加与删除', async () => {
    const view = await renderEditor();
    await act(async () => { fireEvent.changeText(view.getByLabelText('新标签名称'), '高频'); });
    await press(view, '添加标签');
    await waitFor(() => expect(view.getByText('高频')).toBeTruthy());
    await press(view, '删除标签 高频');
    await press(view, '确认删除标签 高频');
    await waitFor(() => expect(view.queryByText('高频')).toBeNull());
  });

  it('题目：上移排序与删除（二次确认）', async () => {
    await store().addLocalQuestion(bankId, questionInput('第一题'));
    await store().addLocalQuestion(bankId, questionInput('第二题'));
    const view = await renderEditor();
    await press(view, '上移题目 第二题');
    await waitFor(async () => expect(await listedTitles()).toEqual(['第二题', '第一题']));
    await press(view, '删除题目 第一题');
    await press(view, '确认删除题目 第一题');
    await waitFor(async () => expect(await listedTitles()).toEqual(['第二题']));
    expect(view.getByText('已删除「第一题」。')).toBeTruthy();
  });

  it('新增题目：填写一句话与 3 条要点后保存，要点 id 由数据层分配', async () => {
    const view = await renderEditor();
    await act(async () => { fireEvent.press(view.getByText('新增题目')); });
    await act(async () => { fireEvent.changeText(view.getByLabelText('题目标题'), 'TCP 为什么三次握手'); });
    await act(async () => { fireEvent.changeText(view.getByLabelText('一句话结论'), '确认双方收发能力并同步初始序列号。'); });
    for (const [index, text] of ['同步序列号', '防止历史连接', '确认双向可达'].entries()) {
      await act(async () => { fireEvent.changeText(view.getByLabelText(`要点 ${index + 1}`), text); });
    }
    await press(view, '要点 1 权重 加分');
    await act(async () => { fireEvent.press(view.getByText('保存题目')); });
    await waitFor(() => expect(view.getByText('已保存「TCP 为什么三次握手」。')).toBeTruthy());
    const list = await store().listQuestions(undefined, bankId);
    const id = list.ok ? list.value[0].id : '';
    const detail = await store().getQuestion(id, bankId);
    expect(detail.ok && detail.value.raw.answer.keyPoints).toEqual([
      { id: 'kp1', text: '同步序列号', weight: 2 },
      { id: 'kp2', text: '防止历史连接', weight: 1 },
      { id: 'kp3', text: '确认双向可达', weight: 1 },
    ]);
  });

  it('题目校验：一句话超长与要点不足时就地提示，不写入数据层', async () => {
    const view = await renderEditor();
    await act(async () => { fireEvent.press(view.getByText('新增题目')); });
    await act(async () => { fireEvent.changeText(view.getByLabelText('题目标题'), '超长题'); });
    await act(async () => { fireEvent.changeText(view.getByLabelText('一句话结论'), '长'.repeat(81)); });
    await act(async () => { fireEvent.changeText(view.getByLabelText('要点 1'), '只有一条'); });
    await act(async () => { fireEvent.press(view.getByText('保存题目')); });
    expect(view.getByText('一句话结论不超过 80 字（当前 81 字）')).toBeTruthy();
    expect(view.getByText('要点需要 3–5 条（当前 1 条）')).toBeTruthy();
    expect(view.getByText('请先修正标出的问题')).toBeTruthy();
    expect(await listedTitles()).toEqual([]);
  });

  it('编辑既有题：保留要点 id，删除要点后新增的不复用旧 id', async () => {
    const added = await store().addLocalQuestion(bankId, questionInput('原题'));
    if (!added.ok) throw new Error(added.error.message);
    const view = await renderEditor();
    await press(view, '编辑题目 原题');
    expect(view.getByLabelText('要点 1').props.value).toBe('a');
    await press(view, '删除要点 3');
    await act(async () => { fireEvent.press(view.getByText('添加要点')); });
    await act(async () => { fireEvent.changeText(view.getByLabelText('要点 3'), 'd'); });
    await press(view, '下移要点 1');
    await act(async () => { fireEvent.press(view.getByText('保存题目')); });
    await waitFor(() => expect(view.getByText('已保存「原题」。')).toBeTruthy());
    const detail = await store().getQuestion(added.value.id, bankId);
    expect(detail.ok && detail.value.raw.answer.keyPoints.map((kp) => `${kp.id}:${kp.text}`)).toEqual(['kp2:b', 'kp1:a', 'kp4:d']);
  });

  it('题目弹窗有未保存修改时取消先确认', async () => {
    await store().addLocalQuestion(bankId, questionInput('原题'));
    const view = await renderEditor();
    await press(view, '编辑题目 原题');
    await act(async () => { fireEvent.changeText(view.getByLabelText('题目标题'), '改了'); });
    await act(async () => { fireEvent.press(view.getByText('取消')); });
    expect(view.getByText('有未保存的修改，离开后将丢失。')).toBeTruthy();
    await act(async () => { fireEvent.press(view.getAllByText('放弃修改并离开')[0]); });
    expect(view.queryByLabelText('题目标题')).toBeNull();
    expect(await listedTitles()).toEqual(['原题']);
  });

  it('AI 导入：逐题写入数据层，失败的草稿给出说明', async () => {
    const view = await renderEditor();
    await act(async () => { fireEvent.press(view.getByText('AI 导入')); });
    await press(view, '模拟确认导入');
    await waitFor(() => expect(view.getByText('已导入 1 道题。')).toBeTruthy());
    expect(view.getByText(/1 道题未能导入：「坏草稿」/)).toBeTruthy();
    expect(await listedTitles()).toEqual(['AI 抽取的题']);
  });

  it('draftToInput 把 v2 草稿映射为数据层输入', () => {
    expect(draftToInput(mockDrafts[0] as never, 'default')).toMatchObject({
      title: 'AI 抽取的题', importance: 2, categoryId: 'default', tags: [], choice: null,
      answer: { summary: '结论。', detail: '详解', pitfalls: ['坑'], keyPoints: mockDrafts[0].keyPoints },
      followups: [{ q: '追问', a: '答' }],
    });
  });

  it('线上题库只读：复制为本地题库后跳到副本的编辑页', async () => {
    await installSampleRemote(t);
    const view = await renderEditor(SAMPLE_BANK_ID);
    expect(view.getByText(/在线题库，只能更新/)).toBeTruthy();
    expect(view.queryByLabelText('题库名称')).toBeNull();
    await act(async () => { fireEvent.press(view.getByText('复制为本地题库并编辑')); });
    const copy = store().banks.find((bank) => bank.name === '测试题库（副本）');
    expect(copy?.origin).toBe('local');
    expect(mockNav.replace).toHaveBeenCalledWith('BankEditor', { bankId: copy?.id });
  });

  it('Web（unsupported）显示不支持说明', async () => {
    await act(async () => { useBankStore.setState({ status: 'unsupported' }); });
    const view = await render(<BankEditorContent bankId={bankId} onOpenAiSettings={() => undefined} />);
    expect(view.getByText('Web 预览不支持本地题库，请在 Android App 中使用。')).toBeTruthy();
  });
});
