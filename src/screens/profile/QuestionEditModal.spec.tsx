import { act, fireEvent, render } from '@testing-library/react-native';
import { QuestionEditModal, type QuestionFormDraft } from './QuestionEditModal';

const initial: QuestionFormDraft = {
  title: '原题', difficulty: 2, tags: ['Java'], questionMd: '题干', answerMd: '答案',
};

it('未修改题目可直接关闭，修改后返回会保留表单并提示', async () => {
  const props = { visible: true, initial, onClose: jest.fn(), onSave: jest.fn() };
  const view = await render(<QuestionEditModal {...props} />);
  await act(async () => { fireEvent.press(view.getByText('取消')); });
  expect(props.onClose).toHaveBeenCalledTimes(1);
  props.onClose.mockClear();
  await act(async () => { fireEvent.changeText(view.getByLabelText('题目标题'), '修改后的题目'); });
  await act(async () => { fireEvent.press(view.getByLabelText('关闭弹窗')); });
  expect(props.onClose).not.toHaveBeenCalled();
  await act(async () => { fireEvent.press(view.getByText('继续编辑')); });
  expect(view.getByDisplayValue('修改后的题目')).toBeTruthy();
  await act(async () => { fireEvent.press(view.getByText('取消')); });
  await act(async () => { fireEvent.press(view.getByText('放弃修改并离开')); });
  expect(props.onClose).toHaveBeenCalledTimes(1);
  expect(props.onSave).not.toHaveBeenCalled();
});
