import { act, fireEvent, render } from '@testing-library/react-native';
import { TEST_QUESTION_BANK } from '../../question-bank/fixture';

/**
 * 题库编辑页正文（BankEditorContent）：未保存守卫走 usePreventRemove。
 * 导航用最小替身模拟 react-navigation 语义：goBack / popTo 触发移除时，
 * 只要有 usePreventRemove(true) 就交给回调拦截；dispatch(被拦下的 action) 视为放行重放。
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
  popTo: jest.fn((name: string) => mockRemove({ type: 'POP_TO', payload: { name } })),
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

const mockLoad = jest.fn();
const mockSave = jest.fn();
const mockCopy = jest.fn();
jest.mock('../../question-bank/local-banks', () => ({
  ...jest.requireActual('../../question-bank/local-banks'),
  loadLocalBankSource: (...args: unknown[]) => mockLoad(...args),
}));
jest.mock('../../question-bank/store', () => ({
  useQuestionBankStore: (selector: (state: unknown) => unknown) =>
    selector({ saveLocalBank: mockSave, copyBank: mockCopy }),
}));
jest.mock('./QuestionEditModal', () => ({ QuestionEditModal: () => null }));
jest.mock('./ImportTextModal', () => ({ ImportTextModal: () => null }));
// eslint-disable-next-line import/first
import { BankEditorContent } from './BankEditorModal';

beforeEach(() => {
  jest.clearAllMocks();
  mockGuards.length = 0;
  mockLeft.length = 0;
  mockLoad.mockReset();
  mockSave.mockReset().mockResolvedValue(undefined);
  mockCopy.mockReset();
});

function loadedBank() {
  return { bankId: 'local-a', updatedAt: '', package: {
    ...TEST_QUESTION_BANK, catalog: { ...TEST_QUESTION_BANK.catalog, id: 'local-a', title: 'A题库' },
  } };
}

/** 模拟系统返回键 / 返回手势：与 native-stack 一样走移除流程 */
async function pressHardwareBack() {
  await act(async () => { mockRemove({ type: 'GO_BACK', source: 'hardware' }); });
}

it('切换到读取失败的题库时不能继续保存上一个题库', async () => {
  mockLoad.mockResolvedValueOnce(loadedBank()).mockResolvedValueOnce(null);
  const view = await render(<BankEditorContent bankId="local-a" onOpenAiSettings={jest.fn()} />);
  await act(async () => { await view.rerender(<BankEditorContent bankId="local-b" onOpenAiSettings={jest.fn()} />); });
  expect(view.getByText('本地题库源不存在或已损坏')).toBeTruthy();
  await act(async () => { fireEvent.press(view.getByText('保存题库')); });
  expect(mockSave).not.toHaveBeenCalled();
});

it('没有修改时取消直接返回，不弹确认', async () => {
  mockLoad.mockResolvedValue(loadedBank());
  const view = await render(<BankEditorContent bankId="local-a" onOpenAiSettings={jest.fn()} />);
  await act(async () => { fireEvent.press(view.getByText('取消')); });
  expect(mockLeft).toEqual([{ type: 'GO_BACK' }]);
  expect(view.queryByText('有未保存的修改，离开后将丢失。')).toBeNull();
});

it('未保存修改时返回键也先询问，可继续编辑或明确放弃', async () => {
  mockLoad.mockResolvedValue(loadedBank());
  const view = await render(<BankEditorContent bankId="local-a" onOpenAiSettings={jest.fn()} />);
  await act(async () => { fireEvent.changeText(view.getByLabelText('题库名称'), '未保存草稿'); });

  await pressHardwareBack();
  expect(mockLeft).toEqual([]);
  expect(view.getByText('有未保存的修改，离开后将丢失。')).toBeTruthy();
  await act(async () => { fireEvent.press(view.getByText('继续编辑')); });
  expect(view.queryByText('有未保存的修改，离开后将丢失。')).toBeNull();
  expect(view.getByDisplayValue('未保存草稿')).toBeTruthy();

  // 页面内「取消」与返回键走同一拦截
  await act(async () => { fireEvent.press(view.getByText('取消')); });
  expect(mockLeft).toEqual([]);
  await act(async () => { fireEvent.press(view.getByText('放弃修改并离开')); });
  expect(mockNav.dispatch).toHaveBeenCalledWith({ type: 'GO_BACK' });
  expect(mockLeft).toEqual([{ type: 'GO_BACK' }]);
  expect(mockSave).not.toHaveBeenCalled();
});

it('未保存时跳到管理页同样拦截，放弃后重放 popTo', async () => {
  mockLoad.mockResolvedValue(loadedBank());
  const view = await render(<BankEditorContent bankId="local-a" onOpenAiSettings={jest.fn()} />);
  await act(async () => { fireEvent.changeText(view.getByLabelText('题库名称'), '改了名'); });
  await act(async () => { fireEvent.press(view.getByLabelText('管理其它题库')); });
  expect(mockNav.popTo).toHaveBeenCalledWith('BankManager');
  expect(mockLeft).toEqual([]);
  await act(async () => { fireEvent.press(view.getByText('放弃修改并离开')); });
  expect(mockLeft).toEqual([{ type: 'POP_TO', payload: { name: 'BankManager' } }]);
});

it('保存过程中阻止返回和编辑，完成后才离开', async () => {
  mockLoad.mockResolvedValue(loadedBank());
  let finish!: () => void;
  mockSave.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
  const view = await render(<BankEditorContent bankId="local-a" onOpenAiSettings={jest.fn()} />);
  await act(async () => { fireEvent.changeText(view.getByLabelText('题库名称'), '待保存'); });
  await act(async () => { fireEvent.press(view.getByText('保存题库')); });

  await pressHardwareBack();
  await act(async () => { fireEvent.press(view.getByText('取消')); });
  expect(mockLeft).toEqual([]);
  // 忙碌时被拦下也不弹放弃确认，避免保存中途丢弃
  expect(view.queryByText('放弃修改并离开')).toBeNull();
  expect(view.getByLabelText('题库名称').props.editable).toBe(false);
  expect(view.getByLabelText('新增题目').props.accessibilityState.disabled).toBe(true);

  await act(async () => { finish(); });
  expect(mockSave).toHaveBeenCalledTimes(1);
  expect(mockSave.mock.calls[0][0].package.catalog.title).toBe('待保存');
  expect(mockLeft).toEqual([{ type: 'GO_BACK' }]);
});

it('线上题库不提供编辑表单：只能复制为本地题库，复制后进入副本的编辑页', async () => {
  mockLoad.mockResolvedValueOnce({ ...loadedBank(), sourceUrl: 'https://example.com/bank.zip', locallyModified: false });
  mockCopy.mockResolvedValueOnce('local-copy');
  const view = await render(<BankEditorContent bankId="local-a" onOpenAiSettings={jest.fn()} />);

  expect(view.getByText(/这是线上题库，只能在线更新/)).toBeTruthy();
  expect(view.queryByLabelText('题库名称')).toBeNull();
  expect(view.getByLabelText('保存题库').props.accessibilityState.disabled).toBe(true);

  await act(async () => { fireEvent.press(view.getByText('复制为本地题库并编辑')); });
  expect(mockCopy).toHaveBeenCalledWith('local-a');
  expect(mockNav.replace).toHaveBeenCalledWith('BankEditor', { bankId: 'local-copy' });
  expect(mockSave).not.toHaveBeenCalled();
});
