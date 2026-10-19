import { act, fireEvent, render } from '@testing-library/react-native';
import { TEST_QUESTION_BANK } from '../../question-bank/fixture';

const mockLoad = jest.fn();
const mockSave = jest.fn();
jest.mock('../../question-bank/local-banks', () => ({
  ...jest.requireActual('../../question-bank/local-banks'),
  loadLocalBankSource: (...args: unknown[]) => mockLoad(...args),
}));
jest.mock('../../question-bank/store', () => ({
  useQuestionBankStore: (selector: (state: unknown) => unknown) => selector({ saveLocalBank: mockSave }),
}));
jest.mock('./QuestionEditModal', () => ({ QuestionEditModal: () => null }));
jest.mock('./ImportTextModal', () => ({ ImportTextModal: () => null }));
import { BankEditorModal } from './BankEditorModal';

beforeEach(() => {
  jest.clearAllMocks();
  mockLoad.mockReset();
  mockSave.mockReset().mockResolvedValue(undefined);
});

it('切换到读取失败的题库时不能继续保存上一个题库', async () => {
  mockLoad.mockResolvedValueOnce({
    bankId: 'local-a', updatedAt: '',
    package: { ...TEST_QUESTION_BANK, catalog: { ...TEST_QUESTION_BANK.catalog, id: 'local-a', title: 'A题库' } },
  }).mockResolvedValueOnce(null);
  mockSave.mockResolvedValue(undefined);
  const props = { visible: true, onClose: jest.fn(), onOpenAiSettings: jest.fn() };
  const view = await render(<BankEditorModal {...props} bankId="local-a" />);
  await act(async () => { await view.rerender(<BankEditorModal {...props} bankId="local-b" />); });
  expect(view.getByText('本地题库源不存在或已损坏')).toBeTruthy();
  await act(async () => { fireEvent.press(view.getByText('保存题库')); });
  expect(mockSave).not.toHaveBeenCalled();
});

function loadedBank() {
  return { bankId: 'local-a', updatedAt: '', package: {
    ...TEST_QUESTION_BANK, catalog: { ...TEST_QUESTION_BANK.catalog, id: 'local-a', title: 'A题库' },
  } };
}

it('未保存修改关闭时提示，可继续编辑或明确放弃', async () => {
  mockLoad.mockResolvedValue(loadedBank());
  const props = { visible: true, bankId: 'local-a', onClose: jest.fn(), onOpenAiSettings: jest.fn() };
  const view = await render(<BankEditorModal {...props} />);
  await act(async () => { fireEvent.changeText(view.getByLabelText('题库名称'), '未保存草稿'); });
  await act(async () => { fireEvent.press(view.getByLabelText('关闭弹窗')); });
  expect(props.onClose).not.toHaveBeenCalled();
  expect(view.getByText('有未保存的修改，离开后将丢失。')).toBeTruthy();
  await act(async () => { fireEvent.press(view.getByText('继续编辑')); });
  expect(view.getByDisplayValue('未保存草稿')).toBeTruthy();
  await act(async () => { fireEvent.press(view.getByText('取消')); });
  await act(async () => { fireEvent.press(view.getByText('放弃修改并离开')); });
  expect(props.onClose).toHaveBeenCalledTimes(1);
  expect(mockSave).not.toHaveBeenCalled();
});

it('保存过程中阻止返回、遮罩关闭和编辑，完成后才关闭', async () => {
  mockLoad.mockResolvedValue(loadedBank());
  let finish!: () => void;
  mockSave.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
  const props = { visible: true, bankId: 'local-a', onClose: jest.fn(), onOpenAiSettings: jest.fn() };
  const view = await render(<BankEditorModal {...props} />);
  await act(async () => { fireEvent.changeText(view.getByLabelText('题库名称'), '待保存'); });
  await act(async () => { fireEvent.press(view.getByLabelText('关闭弹窗')); });
  await act(async () => { fireEvent.press(view.getByText('保存题库')); });
  await act(async () => {
    fireEvent.press(view.getByText('放弃修改并离开'));
    fireEvent.press(view.getByLabelText('关闭弹窗'));
    fireEvent(view.getByTestId('profile-sheet-编辑本地题库'), 'requestClose');
  });
  expect(props.onClose).not.toHaveBeenCalled();
  expect(view.getByLabelText('题库名称').props.editable).toBe(false);
  expect(view.getByLabelText('新增题目').props.accessibilityState.disabled).toBe(true);
  await act(async () => { finish(); });
  expect(props.onClose).toHaveBeenCalledTimes(1);
  expect(mockSave).toHaveBeenCalledTimes(1);
});
