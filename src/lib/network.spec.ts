import { withNetworkTimeout } from './network';

describe('网络超时与取消（功能回归，非性能基准）', () => {
  afterEach(() => jest.useRealTimers());

  it('响应体长时间不返回时超时并取消底层请求', async () => {
    jest.useFakeTimers();
    let signal: AbortSignal | undefined;
    const request = withNetworkTimeout((value) => { signal = value; return new Promise(() => {}); }, { timeoutMs: 100 });
    const assertion = expect(request).rejects.toThrow('超时');
    await jest.advanceTimersByTimeAsync(100);
    await assertion;
    expect(signal?.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('主动取消立即结束，即使底层忽略 signal', async () => {
    const controller = new AbortController();
    const request = withNetworkTimeout(() => new Promise(() => {}), { signal: controller.signal });
    controller.abort();
    await expect(request).rejects.toThrow('取消');
  });

  it('已取消的请求不启动网络，成功时清理超时定时器', async () => {
    jest.useFakeTimers();
    const controller = new AbortController();
    controller.abort();
    const operation = jest.fn(async () => 'ok');
    await expect(withNetworkTimeout(operation, { signal: controller.signal })).rejects.toThrow('取消');
    expect(operation).not.toHaveBeenCalled();
    await expect(withNetworkTimeout(operation)).resolves.toBe('ok');
    expect(jest.getTimerCount()).toBe(0);
  });
});
