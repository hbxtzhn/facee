import { act, fireEvent, render } from '@testing-library/react-native';

/**
 * 题库管理页（真实 useBankStore + Node SQLite 运行时）：
 * 按来源分组；「⋯」按来源给出操作（线上：检查更新 / 复制为本地编辑 / 信息 / 删除；
 * 本地：编辑 / 导出 / 复制 / 信息 / 删除；文件：复制为本地编辑 / 信息 / 删除）；
 * 删除默认保留学习数据，可选一并删除；导入题库文件；新建本地题库进入编辑页。
 */

const mockNav = { push: jest.fn(), goBack: jest.fn(), navigate: jest.fn() };
const mockPrevent = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNav,
  usePreventRemove: (prevent: boolean) => mockPrevent(prevent),
}));
const mockPick = jest.fn();
jest.mock('expo-document-picker', () => ({ getDocumentAsync: (...args: unknown[]) => mockPick(...args) }));
const mockShare = jest.fn();
jest.mock('expo-sharing', () => ({
  isAvailableAsync: async () => true,
  shareAsync: (...args: unknown[]) => mockShare(...args),
}));
jest.mock('expo-file-system/legacy', () => jest.requireActual('./profile/bank-test-utils').mockLegacyFs());

// eslint-disable-next-line import/first
import { BankManagerScreen } from './BankManagerScreen';
// eslint-disable-next-line import/first
import { useBankStore } from '../bank';
// eslint-disable-next-line import/first
import type { TestRuntime } from '../bank/__fixtures__/node-runtime';
// eslint-disable-next-line import/first
import {
  QID,
  SAMPLE_BANK_ID,
  installSampleRemote,
  setupBankStore,
  teardownBankStore,
  writeFileBundle,
} from './profile/bank-test-utils';

let t: TestRuntime;
beforeEach(async () => {
  jest.clearAllMocks();
  t = await setupBankStore();
});
afterEach(async () => {
  await teardownBankStore(t);
});

type View = Awaited<ReturnType<typeof render>>;
const store = () => useBankStore.getState();
const press = async (view: View, label: string) => {
  await act(async () => { fireEvent.press(view.getByLabelText(label)); });
};

async function seedAllOrigins() {
  // 当前题库在首次安装时不落库（回退为最早安装的题库），时钟推进保证安装顺序真实
  await installSampleRemote(t);
  t.clock.value += 1000;
  const local = await store().createLocalBank({ name: '我的本地库' });
  if (!local.ok) throw new Error(local.error.message);
  t.clock.value += 1000;
  const file = await store().importBankFile(writeFileBundle(t));
  if (!file.ok) throw new Error(file.error.message);
  return { localId: local.value, fileId: file.value.bankId };
}

async function progressCount(bankId: string): Promise<number> {
  const row = await t.db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM progress WHERE bank_id = ?', [bankId]);
  return row?.n ?? 0;
}

describe('BankManagerScreen 题库管理', () => {
  it('没有题库时给出空状态，可去线上题库；新建本地题库后进入编辑页', async () => {
    const view = await render(<BankManagerScreen />);
    expect(view.getByText('本机还没有题库')).toBeTruthy();
    await press(view, '浏览线上题库');
    expect(mockNav.navigate).toHaveBeenCalledWith('OnlineBanks');
    await act(async () => { fireEvent.press(view.getByText('新建本地题库')); });
    const created = store().banks.find((bank) => bank.origin === 'local');
    expect(created?.name).toBe('我的题库');
    expect(mockNav.push).toHaveBeenCalledWith('BankEditor', { bankId: created?.id });
  });

  it('按来源分组，点按行切换当前题库', async () => {
    const { localId } = await seedAllOrigins();
    const view = await render(<BankManagerScreen />);
    expect(view.getByText('线上题库 · 1')).toBeTruthy();
    expect(view.getByText('本地题库 · 1')).toBeTruthy();
    expect(view.getByText('文件导入 · 1')).toBeTruthy();
    expect(store().activeBankId).toBe(SAMPLE_BANK_ID);
    await press(view, '切换到题库 我的本地库');
    expect(store().activeBankId).toBe(localId);
    expect(view.getByText('已切换到「我的本地库」。')).toBeTruthy();
  });

  it('各来源的「⋯」操作集合不同', async () => {
    await seedAllOrigins();
    const view = await render(<BankManagerScreen />);

    await press(view, '更多操作 测试题库');
    expect(view.getByLabelText('检查更新 测试题库')).toBeTruthy();
    expect(view.getByText('复制为本地编辑')).toBeTruthy();
    expect(view.getByLabelText('题库信息 测试题库')).toBeTruthy();
    expect(view.getByLabelText('删除题库 测试题库')).toBeTruthy();
    expect(view.queryByLabelText('编辑题库 测试题库')).toBeNull();
    expect(view.queryByLabelText('导出题库 测试题库')).toBeNull();

    await press(view, '更多操作 我的本地库');
    expect(view.queryByLabelText('检查更新 测试题库')).toBeNull();
    expect(view.getByLabelText('编辑题库 我的本地库')).toBeTruthy();
    expect(view.getByLabelText('导出题库 我的本地库')).toBeTruthy();
    expect(view.getByText('复制')).toBeTruthy();
    expect(view.queryByLabelText('检查更新 我的本地库')).toBeNull();

    await press(view, '更多操作 朋友分享的题库');
    expect(view.getByText('复制为本地编辑')).toBeTruthy();
    expect(view.getByLabelText('删除题库 朋友分享的题库')).toBeTruthy();
    expect(view.queryByLabelText('检查更新 朋友分享的题库')).toBeNull();
    expect(view.queryByLabelText('编辑题库 朋友分享的题库')).toBeNull();
    expect(view.queryByLabelText('导出题库 朋友分享的题库')).toBeNull();

    await press(view, '题库信息 朋友分享的题库');
    expect(view.getByText(/来源：文件导入/)).toBeTruthy();
    expect(view.getByText('题库 id：example.com/friend/shared-bank')).toBeTruthy();
  });

  it('本地题库：编辑进入编辑页，导出把 bundle JSON 交给系统分享', async () => {
    const { localId } = await seedAllOrigins();
    const view = await render(<BankManagerScreen />);
    await press(view, '更多操作 我的本地库');
    await press(view, '编辑题库 我的本地库');
    expect(mockNav.push).toHaveBeenCalledWith('BankEditor', { bankId: localId });
    await press(view, '导出题库 我的本地库');
    expect(mockShare).toHaveBeenCalledWith(expect.stringMatching(/\.json$/), expect.objectContaining({ mimeType: 'application/json' }));
    expect(view.getByText('已导出「我的本地库」，可发送给他人或保存备用。')).toBeTruthy();
  });

  it('线上题库复制为本地编辑：生成可编辑副本并进入编辑页，原题库不变', async () => {
    await installSampleRemote(t);
    const view = await render(<BankManagerScreen />);
    await press(view, '更多操作 测试题库');
    await press(view, '复制题库 测试题库 为本地可编辑副本');
    const copy = store().banks.find((bank) => bank.origin === 'local');
    expect(copy).toMatchObject({ name: '测试题库（副本）', questionCount: 5, manifestUrl: null, version: '1.0.0' });
    expect(copy?.id).toMatch(/^local\/device\/[0-9A-Z]{26}$/);
    expect(mockNav.push).toHaveBeenCalledWith('BankEditor', { bankId: copy?.id });
    expect(store().banks.find((bank) => bank.id === SAMPLE_BANK_ID)?.origin).toBe('remote');
    // 副本可编辑：本地编辑接口接受它
    const renamed = await store().updateLocalBankInfo(copy!.id, { name: '改名后的副本' });
    expect(renamed.ok).toBe(true);
  });

  it('线上题库检查更新：在行内展示差异摘要', async () => {
    await installSampleRemote(t);
    const view = await render(<BankManagerScreen />);
    await press(view, '更多操作 测试题库');
    await press(view, '检查更新 测试题库');
    expect(view.getByText('已是最新版本 v1.0.0。')).toBeTruthy();
  });

  it('删除默认保留学习数据', async () => {
    await installSampleRemote(t);
    await store().setMastery(QID.redisExpire, 'known');
    expect(await progressCount(SAMPLE_BANK_ID)).toBe(1);
    const view = await render(<BankManagerScreen />);
    await press(view, '更多操作 测试题库');
    await press(view, '删除题库 测试题库');
    expect(view.getByLabelText('同时删除学习数据').props.value).toBe(false);
    await press(view, '确认删除题库 测试题库');
    expect(store().banks).toHaveLength(0);
    expect(await progressCount(SAMPLE_BANK_ID)).toBe(1);
    expect(view.getByText(/已删除「测试题库」，学习数据已保留/)).toBeTruthy();
  });

  it('删除时勾选「同时删除学习数据」会一并清除', async () => {
    await installSampleRemote(t);
    await store().setMastery(QID.redisExpire, 'known');
    const view = await render(<BankManagerScreen />);
    await press(view, '更多操作 测试题库');
    await press(view, '删除题库 测试题库');
    await act(async () => { fireEvent(view.getByLabelText('同时删除学习数据'), 'valueChange', true); });
    await press(view, '确认删除题库 测试题库');
    expect(store().banks).toHaveLength(0);
    expect(await progressCount(SAMPLE_BANK_ID)).toBe(0);
    expect(view.getByText(/学习数据已一并删除/)).toBeTruthy();
  });

  it('导入题库文件：选择 bundle JSON 后作为只读文件题库加入；取消选择不做任何事', async () => {
    const uri = writeFileBundle(t);
    const view = await render(<BankManagerScreen />);
    mockPick.mockResolvedValueOnce({ canceled: true, assets: null });
    await act(async () => { fireEvent.press(view.getByText('导入题库文件')); });
    expect(store().banks).toHaveLength(0);

    mockPick.mockResolvedValueOnce({ canceled: false, assets: [{ uri, name: 'shared.json' }] });
    await act(async () => { fireEvent.press(view.getByText('导入题库文件')); });
    expect(view.getByText('已添加「朋友分享的题库」（5 题，文件导入）。')).toBeTruthy();
    expect(store().banks[0].origin).toBe('file');
  });

  it('导入不合规的文件显示数据层的校验说明', async () => {
    const uri = t.writeLocalFile('bad.json', JSON.stringify({ schemaVersion: 1 }));
    mockPick.mockResolvedValueOnce({ canceled: false, assets: [{ uri, name: 'bad.json' }] });
    const view = await render(<BankManagerScreen />);
    await act(async () => { fireEvent.press(view.getByText('导入题库文件')); });
    expect(view.getByText(/不支持的题库格式版本 1/)).toBeTruthy();
  });

  it('处理中禁用操作并拦截返回', async () => {
    await installSampleRemote(t);
    const view = await render(<BankManagerScreen />);
    await act(async () => { useBankStore.setState({ busy: { kind: 'delete', bankId: SAMPLE_BANK_ID }, progress: null }); });
    expect(view.getByText('正在删除题库…')).toBeTruthy();
    expect(view.getByLabelText('切换到题库 测试题库').props.accessibilityState.disabled).toBe(true);
    expect(mockPrevent).toHaveBeenLastCalledWith(true);
    await act(async () => { useBankStore.setState({ busy: null }); });
  });

  it('Web（unsupported）显示不支持说明', async () => {
    await act(async () => { useBankStore.setState({ status: 'unsupported' }); });
    const view = await render(<BankManagerScreen />);
    expect(view.getByText('Web 预览不支持本地题库，请在 Android App 中使用。')).toBeTruthy();
  });
});
