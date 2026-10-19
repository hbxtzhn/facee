import { act, fireEvent, render } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * 题库管理弹窗冒烟：列表渲染（本地/线上徽标、使用中标记）、
 * 编辑入口只给本地题库、切换与删除走 store 动作。
 */

const mockActions = {
  refreshBanks: jest.fn(),
  switchBank: jest.fn(),
  copyBank: jest.fn(),
  deleteLocalBank: jest.fn(),
  updateBank: jest.fn(),
};

const mockState = {
  banks: [] as unknown[],
  banksLoading: false,
  catalog: null as null | { title: string },
  installing: false,
  installProgress: null as null | { label: string; completed: number; total: number },
};

jest.mock('../../question-bank/store', () => ({
  useQuestionBankStore: Object.assign(
    (selector: (state: unknown) => unknown) => selector({ ...mockState, ...mockActions }),
    { getState: () => mockState },
  ),
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
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
    mockState.installing = false;
    mockState.catalog = null;
    mockActions.deleteLocalBank.mockReset();
    mockState.installProgress = null;
    seedBanks();
  });

  it('更新进行中显示当前阶段并禁用编辑、新建和关闭', async () => {
    mockState.installing = true;
    mockState.installProgress = { label: '正在检查题库版本', completed: 0, total: 1 };
    const props = { visible: true, onClose: jest.fn(), onEditBank: jest.fn(), onBankCopied: jest.fn(),
      onCreateLocal: jest.fn(), onAddOnline: jest.fn() };
    const view = await render(<BankManagerModal {...props} />);
    expect(view.getByText('正在检查题库版本')).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByLabelText('编辑题库 我的错题集'));
      fireEvent.press(view.getByLabelText('新建本地题库'));
      fireEvent.press(view.getByLabelText('关闭弹窗'));
    });
    expect(props.onEditBank).not.toHaveBeenCalled();
    expect(props.onCreateLocal).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('忙时所有行内操作具有禁用语义和置灰样式', async () => {
    mockState.banks = [{
      catalogId: 'local-my', namespace: 'ns-local', title: '我的题库', questionCount: 2,
      source: 'local', active: true, sourceUrl: 'https://example.com/bank.zip',
    }];
    mockState.installing = true;
    const view = await render(<BankManagerModal visible onClose={jest.fn()} onEditBank={jest.fn()}
      onBankCopied={jest.fn()} onCreateLocal={jest.fn()} onAddOnline={jest.fn()} />);
    for (const label of ['切换到题库 我的题库', '在线更新题库 我的题库', '复制题库 我的题库 为本地可编辑副本',
      '编辑题库 我的题库', '删除题库 我的题库', '新建本地题库', '添加线上题库']) {
      expect(view.getByLabelText(label).props.accessibilityState).toEqual({ disabled: true });
      expect(view.getByLabelText(label)).toBeDisabled();
      expect(view.getByLabelText(label)).toHaveStyle({ opacity: 0.4 });
    }
    expect(view.getByLabelText('题库信息 我的题库')).toBeDisabled();
    expect(view.getByLabelText('题库信息 我的题库')).toHaveStyle({ opacity: 0.4 });
  });

  it.each([
    [true, '实际切换到的题库', '已切换到「实际切换到的题库」。'],
    [true, null, '题库已删除，当前没有可用题库。'],
    [false, '仍在使用的题库', null],
  ])('删除后仅在原库为当前库时提示实际结果（active=%s, next=%s）', async (active, title, notice) => {
    mockState.banks = [{
      catalogId: 'local-my', namespace: 'ns-local', title: '待删除题库', questionCount: 2,
      source: 'local', active,
    }];
    mockActions.deleteLocalBank.mockImplementation(async () => {
      mockState.catalog = title ? { title } : null;
    });
    const view = await render(<BankManagerModal visible onClose={jest.fn()} onEditBank={jest.fn()}
      onBankCopied={jest.fn()} onCreateLocal={jest.fn()} onAddOnline={jest.fn()} />);
    await act(async () => { fireEvent.press(view.getByLabelText('删除题库 待删除题库')); });
    await act(async () => { fireEvent.press(view.getByLabelText('确认删除题库 待删除题库')); });
    if (notice) expect(view.getByText(notice)).toBeTruthy();
    else expect(view.queryByText(/已切换到|当前没有可用题库/)).toBeNull();
  });

  it('删除失败时保留确认界面，且不显示切换成功提示', async () => {
    mockActions.deleteLocalBank.mockRejectedValue(new Error('删除失败'));
    const view = await render(<BankManagerModal visible onClose={jest.fn()} onEditBank={jest.fn()}
      onBankCopied={jest.fn()} onCreateLocal={jest.fn()} onAddOnline={jest.fn()} />);
    await act(async () => { fireEvent.press(view.getByLabelText('删除题库 我的错题集')); });
    await act(async () => { fireEvent.press(view.getByLabelText('确认删除题库 我的错题集')); });
    expect(view.getByText('删除失败')).toBeTruthy();
    expect(view.getByLabelText('确认删除题库 我的错题集')).toBeTruthy();
    expect(view.queryByText(/已切换到|当前没有可用题库/)).toBeNull();
  });

  it('展开信息不会切换题库，来源可读且旧题库字段有缺省提示', async () => {
    const props = { visible: true, onClose: jest.fn(), onEditBank: jest.fn(), onBankCopied: jest.fn(),
      onCreateLocal: jest.fn(), onAddOnline: jest.fn() };
    const view = await render(<BankManagerModal {...props} />);
    await act(async () => { fireEvent.press(view.getByLabelText('题库信息 我的错题集')); });
    expect(mockActions.switchBank).not.toHaveBeenCalled();
    expect(view.getByText('题目数量：2 题')).toBeTruthy();
    expect(view.getByText('版本：未提供')).toBeTruthy();
    expect(view.getByText('来源：本地题库')).toBeTruthy();
    expect(view.getByText('最近检查：尚未检查更新')).toBeTruthy();
    expect(view.getByLabelText('题库信息 我的错题集').props.accessibilityState.expanded).toBe(true);
    await act(async () => { fireEvent.press(view.getByLabelText('题库信息 我的错题集')); });
    expect(view.queryByText('题目数量：2 题')).toBeNull();
  });

  it('重新挂载后可查看每个库保存的更新结果，失败不写成成功', async () => {
    mockState.banks = [{ catalogId: 'local-my', namespace: 'ns-local', title: '我的题库',
      questionCount: 2, source: 'local', active: true, version: '1.0.0',
      sourceUrl: 'https://example.com/bank.zip' }];
    mockActions.updateBank.mockRejectedValueOnce(new Error('题库下载失败（HTTP 500）'));
    const props = { visible: true, onClose: jest.fn(), onEditBank: jest.fn(), onBankCopied: jest.fn(),
      onCreateLocal: jest.fn(), onAddOnline: jest.fn() };
    const first = await render(<BankManagerModal {...props} />);
    await act(async () => { fireEvent.press(first.getByLabelText('在线更新题库 我的题库')); });
    await first.unmount();
    const view = await render(<BankManagerModal {...props} />);
    await act(async () => { fireEvent.press(view.getByLabelText('题库信息 我的题库')); });
    expect(view.getByText('最近结果：题库下载失败（HTTP 500）')).toBeTruthy();
    expect(view.getByText('来源地址：https://example.com/bank.zip')).toBeTruthy();
    expect(view.getByText('版本：1.0.0')).toBeTruthy();
    expect(view.queryByText(/已是最新版本/)).toBeNull();
  });

  it('记录写入失败不把成功更新误报为更新失败', async () => {
    mockState.banks = [{ catalogId: 'local-my', namespace: 'ns-local', title: '我的题库',
      questionCount: 2, source: 'local', active: true, sourceUrl: 'https://example.com/bank.zip' }];
    jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk full'));
    mockActions.updateBank.mockResolvedValueOnce({ added: 1, removed: 0, updated: true });
    const view = await render(<BankManagerModal visible onClose={jest.fn()} onEditBank={jest.fn()}
      onBankCopied={jest.fn()} onCreateLocal={jest.fn()} onAddOnline={jest.fn()} />);
    await act(async () => { fireEvent.press(view.getByLabelText('在线更新题库 我的题库')); });
    expect(view.getByText('「我的题库」更新完成：新增 1 题。')).toBeTruthy();
    expect(view.queryByText('disk full')).toBeNull();
  });

  it('版本未变化时显示已是最新版本，不显示新增0题', async () => {
    mockState.banks = [{
      catalogId: 'local-my', namespace: 'ns-local', title: '我的题库', questionCount: 2,
      source: 'local', active: true, sourceUrl: 'https://example.com/bank.zip',
    }];
    mockActions.updateBank.mockResolvedValue({ added: 0, removed: 0, updated: false });
    const view = await render(
      <BankManagerModal visible onClose={() => undefined} onEditBank={() => undefined}
        onBankCopied={() => undefined} onCreateLocal={() => undefined} onAddOnline={() => undefined} />,
    );
    await act(async () => {
      fireEvent.press(view.getByLabelText('在线更新题库 我的题库'));
    });
    expect(view.getByText('「我的题库」已是最新版本。')).toBeTruthy();
    expect(view.queryByText(/更新完成/)).toBeNull();
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
