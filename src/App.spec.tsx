import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

/**
 * 应用根：初始化 v2 题库数据层（useBankStore.initialize）与用户设置；
 * 初始化中显示启动页，ready / unsupported（Web）进入导航，error 显示错误与「重试」。
 */

const mockCreateRuntime = jest.fn();
jest.mock('./bank/runtime', () => ({ createDefaultRuntime: () => mockCreateRuntime() }));
jest.mock('./navigation/AppNavigator', () => {
  const { Text } = jest.requireActual('react-native');
  return { AppNavigator: () => <Text>导航已加载</Text> };
});
jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));
const mockUserLoad = jest.fn(async () => undefined);
jest.mock('./store/userStore', () => ({
  useUserStore: (selector: (state: { load: () => Promise<void> }) => unknown) => selector({ load: mockUserLoad }),
}));

// eslint-disable-next-line import/first
import App from '../App';
// eslint-disable-next-line import/first
import { useBankStore } from './bank';
// eslint-disable-next-line import/first
import { resetBankStoreForTests } from './bank/store';
// eslint-disable-next-line import/first
import { createTestRuntime, type TestRuntime } from './bank/__fixtures__/node-runtime';

let t: TestRuntime;
beforeEach(async () => {
  jest.clearAllMocks();
  await resetBankStoreForTests();
  t = await createTestRuntime({ migrate: false });
});
afterEach(async () => {
  await resetBankStoreForTests();
  await t.cleanup();
});

describe('App 启动', () => {
  it('初始化期间显示启动页，ready 后进入导航', async () => {
    let resolve!: (value: unknown) => void;
    mockCreateRuntime.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const view = await render(<App />);
    expect(view.getByText('正在准备你的面试题库')).toBeTruthy();
    expect(useBankStore.getState().status).toBe('initializing');
    expect(mockUserLoad).toHaveBeenCalled();
    await act(async () => { resolve(t.rt); });
    await waitFor(() => expect(view.getByText('导航已加载')).toBeTruthy());
    expect(useBankStore.getState().status).toBe('ready');
  });

  it('Web（运行时为 null → unsupported）照常进入导航，由各页显示不支持说明', async () => {
    mockCreateRuntime.mockResolvedValue(null);
    const view = await render(<App />);
    await waitFor(() => expect(view.getByText('导航已加载')).toBeTruthy());
    expect(useBankStore.getState().status).toBe('unsupported');
  });

  it('数据库打开失败显示错误，可重试', async () => {
    mockCreateRuntime.mockRejectedValueOnce(new Error('磁盘已满'));
    const view = await render(<App />);
    await waitFor(() => expect(view.getByText('题库数据库打开失败')).toBeTruthy());
    expect(view.getByText(/磁盘已满/)).toBeTruthy();
    mockCreateRuntime.mockResolvedValueOnce(t.rt);
    await act(async () => { fireEvent.press(view.getByLabelText('重试')); });
    await waitFor(() => expect(view.getByText('导航已加载')).toBeTruthy());
  });
});
