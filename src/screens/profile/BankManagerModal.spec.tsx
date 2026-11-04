import { act, fireEvent, render } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * 题库管理：线上 / 本地两组列表、每行「⋯」展开行内操作；
 * 线上题库无编辑入口，本地题库可编辑；删除与「已修改」库更新都在行内确认。
 */

const mockActions = {
  refreshBanks: jest.fn(),
  switchBank: jest.fn(),
  copyBank: jest.fn(),
  deleteLocalBank: jest.fn(),
  updateBank: jest.fn(),
  setBankSourceUrl: jest.fn(),
  setSourceUrl: jest.fn(),
  installConfigured: jest.fn(),
  findBankBySourceUrl: jest.fn(),
  clearInstallError: jest.fn(),
};

const mockState = {
  banks: [] as unknown[],
  banksLoading: false,
  catalog: null as null | { title: string },
  installing: false,
  installProgress: null as null | { label: string; completed: number; total: number },
  installError: null as string | null,
  sourceUrl: '',
};

jest.mock('../../question-bank/store', () => ({
  useQuestionBankStore: Object.assign(
    (selector: (state: unknown) => unknown) => selector({ ...mockState, ...mockActions }),
    { getState: () => mockState },
  ),
}));

// eslint-disable-next-line import/first
import { BankManagerModal } from './BankManagerModal';

const OFFICIAL = 'https://github.com/HBxtzhn/facee-bank/releases/latest/download/question-bank.zip';

function seedBanks() {
  mockState.banks = [
    { catalogId: 'local-my', namespace: 'ns-local', title: '我的错题集', questionCount: 2, source: 'local', active: true },
    { catalogId: 'facee-official', namespace: 'ns-online', title: 'Java 面试题库', questionCount: 200, source: 'online',
      active: false, sourceUrl: 'https://example.com/java.zip' },
  ];
}

function props() {
  return { visible: true, onClose: jest.fn(), onEditBank: jest.fn(), onBankCopied: jest.fn(),
    onCreateLocal: jest.fn(), onOpenOnlineBanks: jest.fn() };
}

type View = Awaited<ReturnType<typeof render>>;
async function openMenu(view: View, title: string) {
  await act(async () => { fireEvent.press(view.getByLabelText(`更多操作 ${title}`)); });
}

describe('BankManagerModal 题库管理', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
    mockState.installing = false;
    mockState.catalog = null;
    mockState.installError = null;
    mockActions.deleteLocalBank.mockReset();
    mockState.installProgress = null;
    seedBanks();
  });

  it('分为线上 / 本地两组，标出使用中', async () => {
    const view = await render(<BankManagerModal {...props()} />);
    expect(view.getByText('线上题库 · 1')).toBeTruthy();
    expect(view.getByText('本地题库 · 1')).toBeTruthy();
    expect(view.getByText('我的错题集')).toBeTruthy();
    expect(view.getByText('Java 面试题库')).toBeTruthy();
    expect(view.getByText('使用中')).toBeTruthy();
    expect(view.getByText('2 题')).toBeTruthy();
    expect(view.getByText('200 题')).toBeTruthy();
  });

  it('行内操作默认收起，「⋯」展开 / 再点收起，且一次只展开一行', async () => {
    const view = await render(<BankManagerModal {...props()} />);
    expect(view.queryByLabelText('删除题库 我的错题集')).toBeNull();
    await openMenu(view, '我的错题集');
    expect(view.getByLabelText('更多操作 我的错题集').props.accessibilityState.expanded).toBe(true);
    expect(view.getByLabelText('删除题库 我的错题集')).toBeTruthy();
    await openMenu(view, 'Java 面试题库');
    expect(view.queryByLabelText('删除题库 我的错题集')).toBeNull();
    expect(view.getByLabelText('删除题库 Java 面试题库')).toBeTruthy();
    await openMenu(view, 'Java 面试题库');
    expect(view.queryByLabelText('删除题库 Java 面试题库')).toBeNull();
  });

  it('线上题库：更新 / 复制为本地编辑 / 信息 / 删除，没有编辑', async () => {
    const view = await render(<BankManagerModal {...props()} />);
    await openMenu(view, 'Java 面试题库');
    expect(view.getByLabelText('在线更新题库 Java 面试题库')).toBeTruthy();
    expect(view.getByText('复制为本地编辑')).toBeTruthy();
    expect(view.getByLabelText('题库信息 Java 面试题库')).toBeTruthy();
    expect(view.getByLabelText('删除题库 Java 面试题库')).toBeTruthy();
    expect(view.queryByLabelText('编辑题库 Java 面试题库')).toBeNull();
  });

  it('本地题库：编辑带回 bankId；没有更新地址时不显示更新', async () => {
    const p = props();
    const view = await render(<BankManagerModal {...p} />);
    await openMenu(view, '我的错题集');
    expect(view.queryByLabelText('在线更新题库 我的错题集')).toBeNull();
    await act(async () => { fireEvent.press(view.getByLabelText('编辑题库 我的错题集')); });
    expect(p.onEditBank).toHaveBeenCalledWith('local-my');
  });

  it('editable 字段优先于 source 决定编辑入口', async () => {
    mockState.banks = [{ catalogId: 'local-ro', namespace: 'ns-ro', title: '只读本地', questionCount: 1,
      source: 'local', active: false, editable: false }];
    const view = await render(<BankManagerModal {...props()} />);
    await openMenu(view, '只读本地');
    expect(view.queryByLabelText('编辑题库 只读本地')).toBeNull();
  });

  it('更新进行中显示阶段，行内操作、新建与关闭均不可用', async () => {
    mockState.installing = true;
    mockState.installProgress = { label: '正在检查题库版本', completed: 0, total: 1 };
    mockState.banks = [{
      catalogId: 'local-my', namespace: 'ns-local', title: '我的题库', questionCount: 2,
      source: 'local', active: true, sourceUrl: 'https://example.com/bank.zip', locallyModified: true,
    }];
    const p = props();
    const view = await render(<BankManagerModal {...p} />);
    expect(view.getByText('正在检查题库版本')).toBeTruthy();
    await openMenu(view, '我的题库');
    for (const label of ['切换到题库 我的题库', '在线更新题库 我的题库', '复制题库 我的题库 为本地可编辑副本',
      '编辑题库 我的题库', '删除题库 我的题库', '新建本地题库', '线上题库']) {
      expect(view.getByLabelText(label)).toBeDisabled();
      expect(view.getByLabelText(label)).toHaveStyle({ opacity: 0.4 });
    }
    expect(view.getByLabelText('题库信息 我的题库')).toBeDisabled();
    await act(async () => { fireEvent.press(view.getByLabelText('编辑题库 我的题库')); });
    await act(async () => { fireEvent.press(view.getByLabelText('关闭弹窗')); });
    expect(p.onEditBank).not.toHaveBeenCalled();
    expect(p.onClose).not.toHaveBeenCalled();
  });

  it('点按题库行调用 switchBank，「⋯」不会切换', async () => {
    const view = await render(<BankManagerModal {...props()} />);
    await openMenu(view, 'Java 面试题库');
    expect(mockActions.switchBank).not.toHaveBeenCalled();
    await act(async () => { fireEvent.press(view.getByLabelText('切换到题库 Java 面试题库')); });
    expect(mockActions.switchBank).toHaveBeenCalledWith('facee-official');
  });

  it('复制为本地编辑：成功后带回副本 bankId', async () => {
    const p = props();
    mockActions.copyBank.mockResolvedValue('local-copy-1');
    const view = await render(<BankManagerModal {...p} />);
    await openMenu(view, 'Java 面试题库');
    await act(async () => { fireEvent.press(view.getByLabelText('复制题库 Java 面试题库 为本地可编辑副本')); });
    expect(mockActions.copyBank).toHaveBeenCalledWith('facee-official');
    expect(p.onBankCopied).toHaveBeenCalledWith('local-copy-1');
  });

  it('删除走行内二次确认，可取消', async () => {
    const view = await render(<BankManagerModal {...props()} />);
    await openMenu(view, '我的错题集');
    await act(async () => { fireEvent.press(view.getByLabelText('删除题库 我的错题集')); });
    await act(async () => { fireEvent.press(view.getByLabelText('取消删除')); });
    expect(mockActions.deleteLocalBank).not.toHaveBeenCalled();
    await act(async () => { fireEvent.press(view.getByLabelText('删除题库 我的错题集')); });
    await act(async () => { fireEvent.press(view.getByLabelText('确认删除题库 我的错题集')); });
    expect(mockActions.deleteLocalBank).toHaveBeenCalledWith('local-my');
  });

  it.each([
    [true, '实际切换到的题库', '已切换到「实际切换到的题库」。'],
    [true, null, '题库已删除，当前没有可用题库。'],
    [false, '仍在使用的题库', null],
  ])('删除后仅在原库为当前库时提示实际结果（active=%s, next=%s）', async (active, title, notice) => {
    mockState.banks = [{
      catalogId: 'local-my', namespace: 'ns-local', title: '待删除题库', questionCount: 2, source: 'local', active,
    }];
    mockActions.deleteLocalBank.mockImplementation(async () => {
      mockState.catalog = title ? { title } : null;
    });
    const view = await render(<BankManagerModal {...props()} />);
    await openMenu(view, '待删除题库');
    await act(async () => { fireEvent.press(view.getByLabelText('删除题库 待删除题库')); });
    await act(async () => { fireEvent.press(view.getByLabelText('确认删除题库 待删除题库')); });
    if (notice) expect(view.getByText(notice)).toBeTruthy();
    else expect(view.queryByText(/已切换到|当前没有可用题库/)).toBeNull();
  });

  it('删除失败时保留确认界面并显示原因', async () => {
    mockActions.deleteLocalBank.mockRejectedValue(new Error('删除失败'));
    const view = await render(<BankManagerModal {...props()} />);
    await openMenu(view, '我的错题集');
    await act(async () => { fireEvent.press(view.getByLabelText('删除题库 我的错题集')); });
    await act(async () => { fireEvent.press(view.getByLabelText('确认删除题库 我的错题集')); });
    expect(view.getByText('删除失败')).toBeTruthy();
    expect(view.getByLabelText('确认删除题库 我的错题集')).toBeTruthy();
  });

  it('信息展开不会切换题库，旧题库字段有缺省提示', async () => {
    const view = await render(<BankManagerModal {...props()} />);
    await openMenu(view, '我的错题集');
    await act(async () => { fireEvent.press(view.getByLabelText('题库信息 我的错题集')); });
    expect(mockActions.switchBank).not.toHaveBeenCalled();
    expect(view.getByText('题目数量：2 题')).toBeTruthy();
    expect(view.getByText('版本：未提供')).toBeTruthy();
    expect(view.getByText('来源：本地题库')).toBeTruthy();
    // 本地库信息里一条，线上库行上一条
    expect(view.getAllByText('最近检查：尚未检查更新')).toHaveLength(2);
    expect(view.getByLabelText('题库信息 我的错题集').props.accessibilityState.expanded).toBe(true);
    await act(async () => { fireEvent.press(view.getByLabelText('题库信息 我的错题集')); });
    expect(view.queryByText('题目数量：2 题')).toBeNull();
  });

  it('没有更新地址的本地题库可在信息里关联地址（预填上次输入的地址）', async () => {
    mockState.sourceUrl = 'https://github.com/o/r/releases/latest/download/question-bank.zip';
    mockActions.setBankSourceUrl.mockResolvedValue(undefined);
    const view = await render(<BankManagerModal {...props()} />);
    await openMenu(view, '我的错题集');
    await act(async () => { fireEvent.press(view.getByLabelText('题库信息 我的错题集')); });
    await act(async () => { fireEvent.press(view.getByLabelText('关联更新地址 我的错题集')); });
    expect(view.getByLabelText('题库 我的错题集 的更新地址').props.value).toBe(mockState.sourceUrl);
    await act(async () => { fireEvent.press(view.getByLabelText('保存题库 我的错题集 的更新地址')); });
    expect(mockActions.setBankSourceUrl).toHaveBeenCalledWith('local-my', mockState.sourceUrl);
    expect(view.getByText('「我的错题集」已关联更新地址，可以在线更新了。')).toBeTruthy();
    mockState.sourceUrl = '';
  });

  it('线上题库不显示关联更新地址入口', async () => {
    const view = await render(<BankManagerModal {...props()} />);
    await openMenu(view, 'Java 面试题库');
    await act(async () => { fireEvent.press(view.getByLabelText('题库信息 Java 面试题库')); });
    expect(view.queryByLabelText('关联更新地址 Java 面试题库')).toBeNull();
    expect(view.getByText('来源：线上题库，可在线更新')).toBeTruthy();
  });

  it('线上题库更新：直接调用 updateBank 并提示结果，行上显示最近检查', async () => {
    mockActions.updateBank.mockResolvedValue({ added: 3, removed: 1, updated: true });
    const view = await render(<BankManagerModal {...props()} />);
    expect(view.getByText('最近检查：尚未检查更新')).toBeTruthy();
    await openMenu(view, 'Java 面试题库');
    await act(async () => { fireEvent.press(view.getByLabelText('在线更新题库 Java 面试题库')); });
    expect(mockActions.updateBank).toHaveBeenCalledWith('facee-official', undefined);
    expect(view.getByText('「Java 面试题库」更新完成：新增 3 题，移除 1 题。')).toBeTruthy();
    expect(view.getByText(/最近检查：.*已更新/)).toBeTruthy();
  });

  it('重新挂载后可查看保存的更新结果，失败不写成成功', async () => {
    mockState.banks = [{ catalogId: 'facee-x', namespace: 'ns-x', title: '线上库',
      questionCount: 2, source: 'online', active: true, version: '1.0.0', sourceUrl: 'https://example.com/bank.zip' }];
    mockActions.updateBank.mockRejectedValueOnce(new Error('题库下载失败（HTTP 500）'));
    const first = await render(<BankManagerModal {...props()} />);
    await openMenu(first, '线上库');
    await act(async () => { fireEvent.press(first.getByLabelText('在线更新题库 线上库')); });
    expect(first.getByText('题库下载失败（HTTP 500）')).toBeTruthy();
    await first.unmount();
    const view = await render(<BankManagerModal {...props()} />);
    await openMenu(view, '线上库');
    await act(async () => { fireEvent.press(view.getByLabelText('题库信息 线上库')); });
    expect(view.getByText('最近结果：题库下载失败（HTTP 500）')).toBeTruthy();
    expect(view.getByText('来源地址：https://example.com/bank.zip')).toBeTruthy();
    expect(view.getByText('版本：1.0.0')).toBeTruthy();
    expect(view.queryByText(/已是最新版本/)).toBeNull();
  });

  it('记录写入失败不把成功更新误报为失败', async () => {
    jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk full'));
    mockActions.updateBank.mockResolvedValueOnce({ added: 1, removed: 0, updated: true });
    const view = await render(<BankManagerModal {...props()} />);
    await openMenu(view, 'Java 面试题库');
    await act(async () => { fireEvent.press(view.getByLabelText('在线更新题库 Java 面试题库')); });
    expect(view.getByText('「Java 面试题库」更新完成：新增 1 题。')).toBeTruthy();
    expect(view.queryByText('disk full')).toBeNull();
  });

  it('版本未变化时显示已是最新版本', async () => {
    mockActions.updateBank.mockResolvedValue({ added: 0, removed: 0, updated: false });
    const view = await render(<BankManagerModal {...props()} />);
    await openMenu(view, 'Java 面试题库');
    await act(async () => { fireEvent.press(view.getByLabelText('在线更新题库 Java 面试题库')); });
    expect(view.getByText('「Java 面试题库」已是最新版本。')).toBeTruthy();
  });

  describe('已修改（旧模型下改过的下载库）', () => {
    beforeEach(() => {
      mockState.banks = [{
        catalogId: 'local-my', namespace: 'ns-local', title: '我的题库', questionCount: 2,
        source: 'local', active: true, sourceUrl: 'https://example.com/bank.zip', locallyModified: true,
      }];
    });

    it('归入本地组、可编辑也可更新；需确认时行内三选一，取消不更新', async () => {
      mockActions.updateBank.mockResolvedValueOnce({ added: 0, removed: 0, updated: false, needsConfirmation: true });
      const view = await render(<BankManagerModal {...props()} />);
      expect(view.getByText('本地题库 · 1')).toBeTruthy();
      expect(view.getByLabelText('本地已修改')).toBeTruthy();
      await openMenu(view, '我的题库');
      expect(view.getByLabelText('编辑题库 我的题库')).toBeTruthy();
      await act(async () => { fireEvent.press(view.getByLabelText('在线更新题库 我的题库')); });
      expect(mockActions.updateBank).toHaveBeenCalledWith('local-my', undefined);
      expect(view.getByLabelText('另存副本后更新题库 我的题库')).toBeTruthy();
      expect(view.getByLabelText('直接覆盖更新题库 我的题库')).toBeTruthy();
      expect(view.queryByText(/已是最新版本/)).toBeNull();
      await act(async () => { fireEvent.press(view.getByLabelText('取消更新')); });
      expect(view.queryByLabelText('另存副本后更新题库 我的题库')).toBeNull();
      expect(view.getByLabelText('在线更新题库 我的题库')).toBeTruthy();
      expect(mockActions.updateBank).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['另存副本后更新题库 我的题库', 'keepCopy', '「我的题库」更新完成：新增 1 题。本地修改已另存为副本。'],
      ['直接覆盖更新题库 我的题库', 'overwrite', '「我的题库」更新完成：新增 1 题。'],
    ])('确认「%s」后带 onLocalEdits=%s 重试', async (label, decision, notice) => {
      mockActions.updateBank
        .mockResolvedValueOnce({ added: 0, removed: 0, updated: false, needsConfirmation: true })
        .mockResolvedValueOnce({ added: 1, removed: 0, updated: true,
          ...(decision === 'keepCopy' ? { copiedBankId: 'local-copy' } : {}) });
      const view = await render(<BankManagerModal {...props()} />);
      await openMenu(view, '我的题库');
      await act(async () => { fireEvent.press(view.getByLabelText('在线更新题库 我的题库')); });
      await act(async () => { fireEvent.press(view.getByLabelText(label)); });
      expect(mockActions.updateBank).toHaveBeenLastCalledWith('local-my', { onLocalEdits: decision });
      expect(view.getByText(notice)).toBeTruthy();
      expect(view.queryByLabelText(label)).toBeNull();
    });
  });

  describe('空状态与入口', () => {
    it('没有任何题库时一键安装官方题库', async () => {
      mockState.banks = [];
      mockActions.findBankBySourceUrl.mockResolvedValue(null);
      mockActions.installConfigured.mockResolvedValue(true);
      const view = await render(<BankManagerModal {...props()} />);
      expect(view.getByText('本机还没有题库')).toBeTruthy();
      await act(async () => { fireEvent.press(view.getByLabelText('安装官方题库')); });
      expect(mockActions.setSourceUrl).toHaveBeenCalledWith(OFFICIAL);
      expect(mockActions.installConfigured).toHaveBeenCalledTimes(1);
    });

    it('没有线上题库时线上组给出官方题库与浏览入口', async () => {
      mockState.banks = [mockState.banks[0]];
      const p = props();
      const view = await render(<BankManagerModal {...p} />);
      expect(view.getByText('线上题库 · 0')).toBeTruthy();
      await act(async () => { fireEvent.press(view.getByLabelText('浏览线上题库')); });
      expect(p.onOpenOnlineBanks).toHaveBeenCalledTimes(1);
    });

    it('底部「线上题库」与「新建本地题库」回调', async () => {
      const p = props();
      const view = await render(<BankManagerModal {...p} />);
      await act(async () => { fireEvent.press(view.getByLabelText('线上题库')); });
      await act(async () => { fireEvent.press(view.getByLabelText('新建本地题库')); });
      expect(p.onOpenOnlineBanks).toHaveBeenCalledTimes(1);
      expect(p.onCreateLocal).toHaveBeenCalledTimes(1);
    });
  });
});
