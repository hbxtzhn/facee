import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

/**
 * 线上题库页（真实 useBankStore + Node SQLite 运行时）：
 * 官方题库 404 给出明确说明、按 latest.json 地址添加、检查更新先展示新增 / 修改 / 删除与说明，
 * 用户确认后才更新；独占操作进行中显示进度并拦截返回；Web 显示不支持。
 */

const mockPrevent = jest.fn();
jest.mock('@react-navigation/native', () => ({
  usePreventRemove: (prevent: boolean) => mockPrevent(prevent),
}));
jest.mock('expo-file-system/legacy', () => jest.requireActual('./profile/bank-test-utils').mockLegacyFs());

// eslint-disable-next-line import/first
import { OnlineBanksScreen } from './OnlineBanksScreen';
// eslint-disable-next-line import/first
import { useBankStore } from '../bank';
// eslint-disable-next-line import/first
import { finalize, QID } from '../bank/__fixtures__/sample-bank';
// eslint-disable-next-line import/first
import type { TestRuntime } from '../bank/__fixtures__/node-runtime';
// eslint-disable-next-line import/first
import {
  SAMPLE_ASSETS,
  SAMPLE_BANK_ID,
  installSampleRemote,
  publish,
  sampleBundle,
  setupBankStore,
  teardownBankStore,
} from './profile/bank-test-utils';

let t: TestRuntime;
beforeEach(async () => {
  mockPrevent.mockClear();
  t = await setupBankStore();
});
afterEach(async () => {
  await teardownBankStore(t);
});

describe('OnlineBanksScreen 线上题库页', () => {
  it('官方题库尚未发布（清单 404）时给出明确说明', async () => {
    const view = await render(<OnlineBanksScreen />);
    expect(view.getByText('FaceE 官方题库')).toBeTruthy();
    await act(async () => { fireEvent.press(view.getByLabelText('安装官方题库')); });
    expect(view.getByText(/官方题库还没有发布 v2 版本（清单地址返回 404）/)).toBeTruthy();
    expect(useBankStore.getState().banks).toHaveLength(0);
  });

  it('按 latest.json 地址添加：安装后出现在已安装列表并设为当前', async () => {
    const url = publish(t, sampleBundle(), { assets: SAMPLE_ASSETS });
    const view = await render(<OnlineBanksScreen />);
    expect(view.getByText('还没有线上题库。安装官方题库，或在上方粘贴地址。')).toBeTruthy();
    await act(async () => { fireEvent.changeText(view.getByLabelText('题库清单地址'), url); });
    await act(async () => { fireEvent.press(view.getByLabelText('按网址添加题库')); });
    expect(view.getByText('已添加「测试题库」（5 题，线上题库）。')).toBeTruthy();
    expect(view.getByText('测试题库')).toBeTruthy();
    expect(view.getByText(/^5 题 · v1\.0\.0 · 检查于 \d{4}-\d{2}-\d{2} · 使用中$/)).toBeTruthy();
    expect(useBankStore.getState().activeBankId).toBe(SAMPLE_BANK_ID);
  });

  it('地址无效时显示数据层的中文错误', async () => {
    const view = await render(<OnlineBanksScreen />);
    await act(async () => { fireEvent.changeText(view.getByLabelText('题库清单地址'), 'ftp://nope'); });
    await act(async () => { fireEvent.press(view.getByLabelText('按网址添加题库')); });
    expect(view.getByText('请输入以 http(s):// 开头的 latest.json 地址')).toBeTruthy();
  });

  it('检查更新：先展示新增 / 修改 / 删除与更新说明，确认后才安装新版本', async () => {
    await installSampleRemote(t);
    const next = sampleBundle('1.1.0');
    next.questions[0] = finalize({ ...next.questions[0], title: '改过的标题' });
    next.questions.push(finalize({ ...next.questions[1], id: QID.kafkaNew, title: 'Kafka 新题', related: [] }));
    publish(t, next, { assets: SAMPLE_ASSETS, changes: '新增 Kafka 题；修正 Redis 标题。' });

    const view = await render(<OnlineBanksScreen />);
    await act(async () => { fireEvent.press(view.getByLabelText('检查更新 测试题库')); });
    expect(view.getByText('发现新版本 v1.1.0（当前 v1.0.0）')).toBeTruthy();
    expect(view.getByText('新增 1 题 / 修改 1 题 / 删除 0 题')).toBeTruthy();
    expect(view.getByText('更新说明：新增 Kafka 题；修正 Redis 标题。')).toBeTruthy();
    // 只检查不安装
    expect(useBankStore.getState().banks[0].version).toBe('1.0.0');

    await act(async () => { fireEvent.press(view.getByLabelText('确认更新题库 测试题库')); });
    await waitFor(() => expect(view.getByText('「测试题库」已更新到 v1.1.0（6 题）。')).toBeTruthy());
    expect(useBankStore.getState().banks[0].version).toBe('1.1.0');
  });

  it('检查更新可以放弃：暂不更新只收起结果；已是最新时提示', async () => {
    await installSampleRemote(t);
    const view = await render(<OnlineBanksScreen />);
    await act(async () => { fireEvent.press(view.getByLabelText('检查更新 测试题库')); });
    expect(view.getByText('已是最新版本 v1.0.0。')).toBeTruthy();
    expect(view.queryByLabelText('确认更新题库 测试题库')).toBeNull();
    await act(async () => { fireEvent.press(view.getByLabelText('关闭检查结果')); });
    expect(view.queryByText('已是最新版本 v1.0.0。')).toBeNull();
  });

  it('独占操作进行中：显示 store 进度、禁用操作并拦截返回', async () => {
    await installSampleRemote(t);
    const view = await render(<OnlineBanksScreen />);
    await act(async () => {
      useBankStore.setState({ busy: { kind: 'update', bankId: SAMPLE_BANK_ID }, progress: { stage: 'bundle', message: '正在下载题库' } });
    });
    expect(view.getByText('正在下载题库')).toBeTruthy();
    expect(view.getByText('更新中')).toBeTruthy();
    expect(view.getByLabelText('检查更新 测试题库').props.accessibilityState.disabled).toBe(true);
    expect(mockPrevent).toHaveBeenLastCalledWith(true);
    await act(async () => { useBankStore.setState({ busy: null, progress: null }); });
    expect(mockPrevent).toHaveBeenLastCalledWith(false);
  });

  it('Web（unsupported）只显示不支持说明', async () => {
    await act(async () => { useBankStore.setState({ status: 'unsupported' }); });
    const view = await render(<OnlineBanksScreen />);
    expect(view.getByText('Web 预览不支持本地题库，请在 Android App 中使用。')).toBeTruthy();
    expect(view.queryByText('FaceE 官方题库')).toBeNull();
  });
});
