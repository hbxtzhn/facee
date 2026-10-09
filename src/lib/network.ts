/** 覆盖请求和响应体读取的超时；同时支持调用方主动取消。 */
export async function withNetworkTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      reject(new Error('请求已取消'));
      controller.abort();
    };
    if (options.signal?.aborted) { onAbort(); return; }
    options.signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      reject(new Error('网络请求超时，请检查网络后重试'));
      controller.abort();
    }, options.timeoutMs ?? 30_000);
  });
  try {
    if (options.signal?.aborted) return await deadline;
    return await Promise.race([operation(controller.signal), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) options.signal?.removeEventListener('abort', onAbort);
  }
}
