import { extractQuestionsFromImage } from './llm';
const CONFIG = { baseUrl: 'https://example.com/v1/', apiKey: 'test-dummy-key', model: 'vision-test' };
const IMAGE = { mimeType: 'image/png' as const, base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' };
const RAW = JSON.stringify([{ title: '图中题目', question: '完整题干', answer: null, difficulty: 'easy', tags: ['测试'] }]);
const response = (content = RAW) => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content } }] }) });

afterEach(() => jest.useRealTimers());

it('发送带 data URL 的多模态消息，复用固定格式与用户要求，输出标准草稿', async () => {
  const fetchImpl = jest.fn(async () => response());
  const onProgress = jest.fn();
  const drafts = await extractQuestionsFromImage(CONFIG, IMAGE, { fetchImpl, requirements: '保留选择题选项', onProgress });
  const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { body: string; headers: Record<string, string> }];
  expect(url).toBe('https://example.com/v1/chat/completions');
  expect(init.headers.Authorization).toBe('Bearer test-dummy-key');
  const body = JSON.parse(init.body);
  expect(body.model).toBe('vision-test');
  expect(body.stream).toBe(false);
  expect(body.messages[1].content[0].text).toContain('保留选择题选项');
  expect(body.messages[1].content[0].text).toContain('输出格式（固定要求');
  expect(body.messages[1].content[0].text).toContain('看不清的内容不要猜测');
  expect(body.messages[1].content[1]).toEqual({ type: 'image_url', image_url: { url: `data:image/png;base64,${IMAGE.base64}`, detail: 'auto' } });
  expect(drafts).toEqual([{ title: '图中题目', questionMd: '完整题干', answerMd: null, difficulty: 1, tags: ['测试'] }]);
  expect(onProgress).toHaveBeenCalledWith(1, 1);
});

it('错误类型和缺失配置在网络调用前拒绝', async () => {
  const fetchImpl = jest.fn(async () => response());
  await expect(extractQuestionsFromImage(CONFIG, { ...IMAGE, mimeType: 'image/jpeg' }, { fetchImpl })).rejects.toThrow('类型不一致');
  await expect(extractQuestionsFromImage({ ...CONFIG, apiKey: '' }, IMAGE, { fetchImpl })).rejects.toThrow('API Key');
  expect(fetchImpl).not.toHaveBeenCalled();
});

it('不自动重试、不展示可能回显图片数据的错误响应', async () => {
  const fetchImpl = jest.fn(async () => ({ ok: false, status: 400, text: async () => `secret echo ${IMAGE.base64}` }));
  await expect(extractQuestionsFromImage(CONFIG, IMAGE, { fetchImpl })).rejects.toThrow('HTTP 400：图片请求失败');
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it('无法识别题目时返回空草稿，不伪造内容', async () => {
  await expect(extractQuestionsFromImage(CONFIG, IMAGE, { fetchImpl: async () => response('看不清') })).resolves.toEqual([]);
});

it('取消正在等待的响应体会中止请求，不推进完成进度', async () => {
  const controller = new AbortController();
  const onProgress = jest.fn();
  let signal: AbortSignal | undefined;
  const pending = extractQuestionsFromImage(CONFIG, IMAGE, {
    signal: controller.signal, onProgress,
    fetchImpl: async (_url, init) => { signal = init?.signal; return { ok: true, status: 200, text: () => new Promise<string>(() => {}) }; },
  });
  controller.abort();
  await expect(pending).rejects.toThrow('请求已取消');
  expect(signal?.aborted).toBe(true);
  expect(onProgress).not.toHaveBeenCalled();
});

it('60秒超时覆盖响应体读取，不自动再次上传', async () => {
  jest.useFakeTimers();
  const fetchImpl = jest.fn(async () => ({ ok: true, status: 200, text: () => new Promise<string>(() => {}) }));
  const pending = extractQuestionsFromImage(CONFIG, IMAGE, { fetchImpl });
  const rejection = expect(pending).rejects.toThrow('网络请求超时');
  await jest.advanceTimersByTimeAsync(60_000);
  await rejection;
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
