import { act, fireEvent, render } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** Web 端地址弹窗：地址为空时可一键安装官方题库；成功关闭；失败不抛未处理拒绝。 */

const mockActions = {
  updateBank: jest.fn(),
  setSourceUrl: jest.fn(),
  installConfigured: jest.fn(),
  findBankBySourceUrl: jest.fn(),
  clearInstallError: jest.fn(),
};
const mockState = {
  banks: [] as unknown[],
  catalog: null,
  installing: false,
  installProgress: null,
  installError: null as string | null,
  sourceUrl: '',
};
jest.mock('../../question-bank/store', () => ({
  useQuestionBankStore: Object.assign(
    (selector: (state: unknown) => unknown) => selector({ ...mockState, ...mockActions }),
    { getState: () => ({ ...mockState, ...mockActions }) },
  ),
}));

// eslint-disable-next-line import/first
import { BankUrlDialog } from './BankUrlDialog';

const OFFICIAL = 'https://github.com/HBxtzhn/facee-bank/releases/latest/download/question-bank.zip';

describe('BankUrlDialog', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
    mockState.installError = null;
    mockActions.findBankBySourceUrl.mockResolvedValue(null);
  });

  it('地址为空时「安装官方题库」填入官方地址并安装，成功后关闭', async () => {
    mockActions.installConfigured.mockResolvedValue(true);
    const onClose = jest.fn();
    const view = await render(<BankUrlDialog visible onClose={onClose} />);
    expect(mockActions.clearInstallError).toHaveBeenCalled();
    await act(async () => { fireEvent.press(view.getByLabelText('安装官方题库')); });
    expect(mockActions.setSourceUrl).toHaveBeenCalledWith(OFFICIAL);
    expect(mockActions.installConfigured).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('填了地址后不再显示官方题库入口；安装抛错时显示原因且不关闭', async () => {
    mockActions.installConfigured.mockRejectedValue(new Error('正在处理题库，请稍后再试'));
    const onClose = jest.fn();
    const view = await render(<BankUrlDialog visible onClose={onClose} />);
    await act(async () => { fireEvent.changeText(view.getByLabelText('题库 ZIP 地址'), 'https://example.com/a.zip'); });
    expect(view.queryByLabelText('安装官方题库')).toBeNull();
    await act(async () => { fireEvent.press(view.getByLabelText('确认下载')); });
    expect(view.getByText('正在处理题库，请稍后再试')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});
