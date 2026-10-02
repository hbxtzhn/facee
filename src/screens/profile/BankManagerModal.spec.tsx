import { act, fireEvent, render } from '@testing-library/react-native';

/**
 * 题库管理弹窗冒烟：列表渲染（本地/线上徽标、使用中标记）、
 * 编辑入口只给本地题库、切换与删除走 store 动作。
 */

const mockActions = {
  refreshBanks: jest.fn(),
  switchBank: jest.fn(),
  copyBank: jest.fn(),
  deleteLocalBank: jest.fn(),
};

const mockState = {
  banks: [] as unknown[],
  banksLoading: false,
};

jest.mock('../../question-bank/store', () => ({
  useQuestionBankStore: (selector: (state: unknown) => unknown) =>
    selector({ ...mockState, ...mockActions }),
}));

// eslint-disable-next-line import/first
import { BankManagerModal } from './BankManagerModal';

function seedBanks() {
  mockState.banks = [
    { catalogId: 'local-my', namespace: 'ns-local', title: '我的错题集', questionCount: 2, source: 'local', active: true },
    { catalogId: 'facee-official', namespace: 'ns-online', title: 'Java 面试题库', questionCount: 200, source: 'online', active: false },
  ];
}

describe('BankManagerModal 题库管理弹窗', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    seedBanks();
  });

  it('列出全部题库：来源徽标、题数与使用中标记', async () => {
    const view = await render(
      <BankManagerModal
        visible
        onClose={() => undefined}
        onEditBank={() => undefined}
        onBankCopied={() => undefined}
        onCreateLocal={() => undefined}
        onAddOnline={() => undefined}
      />,
    );

    expect(view.getByText('我的错题集')).toBeTruthy();
    expect(view.getByText('Java 面试题库')).toBeTruthy();
    expect(view.getByText('使用中')).toBeTruthy();
    expect(view.getAllByText('本地')).toHaveLength(1);
    expect(view.getAllByText('线上')).toHaveLength(1);
    expect(view.getByText('2 题')).toBeTruthy();
    expect(view.getByText('200 题')).toBeTruthy();
  });

  it('编辑入口只出现在本地题库上，点击带回 bankId', async () => {
    const onEditBank = jest.fn();
    const view = await render(
      <BankManagerModal
        visible
        onClose={() => undefined}
        onEditBank={onEditBank}
        onBankCopied={() => undefined}
        onCreateLocal={() => undefined}
        onAddOnline={() => undefined}
      />,
    );

    expect(view.queryByLabelText('编辑题库 Java 面试题库')).toBeNull();
    fireEvent.press(view.getByLabelText('编辑题库 我的错题集'));
    expect(onEditBank).toHaveBeenCalledWith('local-my');
  });

  it('点按题库行调用 switchBank', async () => {
    const view = await render(
      <BankManagerModal
        visible
        onClose={() => undefined}
        onEditBank={() => undefined}
        onBankCopied={() => undefined}
        onCreateLocal={() => undefined}
        onAddOnline={() => undefined}
      />,
    );

    fireEvent.press(view.getByLabelText('切换到题库 Java 面试题库'));
    expect(mockActions.switchBank).toHaveBeenCalledWith('facee-official');
  });

  it('删除走行内二次确认', async () => {
    const view = await render(
      <BankManagerModal
        visible
        onClose={() => undefined}
        onEditBank={() => undefined}
        onBankCopied={() => undefined}
        onCreateLocal={() => undefined}
        onAddOnline={() => undefined}
      />,
    );

    await act(async () => {
      fireEvent.press(view.getByLabelText('删除题库 我的错题集'));
    });
    fireEvent.press(view.getByLabelText('确认删除题库 我的错题集'));
    expect(mockActions.deleteLocalBank).toHaveBeenCalledWith('local-my');
  });
  it('复制按钮对任意题库可见，成功后带回副本 bankId', async () => {
    const onBankCopied = jest.fn();
    mockActions.copyBank.mockResolvedValue('local-copy-1');
    const view = await render(
      <BankManagerModal
        visible
        onClose={() => undefined}
        onEditBank={() => undefined}
        onBankCopied={onBankCopied}
        onCreateLocal={() => undefined}
        onAddOnline={() => undefined}
      />,
    );

    await act(async () => {
      fireEvent.press(view.getByLabelText('复制题库 Java 面试题库 为本地可编辑副本'));
    });
    expect(mockActions.copyBank).toHaveBeenCalledWith('facee-official');
    expect(onBankCopied).toHaveBeenCalledWith('local-copy-1');
  });
});
