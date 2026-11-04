import { resolveBankUpdate, shouldUpdateBank } from './update';

const sourceUrl = 'https://github.com/hbxtzhn/facee-bank/releases/download/v1.1.0/bank-300.zip';
const latestUrl = 'https://github.com/hbxtzhn/facee-bank/releases/download/v1.3.0/bank-505.zip';
const originalFetch = global.fetch;
const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock;
});
afterAll(() => { global.fetch = originalFetch; });

it.each([
  ['1.2.0', '1.2.0', false],
  ['1.2.0', 'v1.2', false],
  ['1.2.0', '1.1.9', false],
  ['1.2.0', '1.10.0', true],
  [undefined, '1.2.0', true],
  ['1.2.0', undefined, true],
  ['release-a', 'release-a', false],
])('仅比较版本 %s → %s，是否更新=%s', (current, incoming, expected) => {
  expect(shouldUpdateBank(current, incoming)).toBe(expected);
});

it('旧 Release 链接解析到最新发布的唯一 ZIP，兼容文件名随版本变化', async () => {
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ tag_name: 'v1.3.0', assets: [{ name: 'bank-505.zip', browser_download_url: latestUrl }] }),
  });
  await expect(resolveBankUpdate(sourceUrl)).resolves.toEqual({ url: latestUrl, version: 'v1.3.0' });
  expect(fetchMock).toHaveBeenCalledWith(
    'https://api.github.com/repos/hbxtzhn/facee-bank/releases/latest',
    expect.objectContaining({ signal: expect.anything() }),
  );
});

it('最新发布有多个 ZIP 时沿用原来的文件名', async () => {
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ tag_name: 'v1.3.0', assets: [
      { name: 'other.zip', browser_download_url: 'https://github.com/other.zip' },
      { name: 'bank-300.zip', browser_download_url: latestUrl },
    ] }),
  });
  await expect(resolveBankUpdate(sourceUrl)).resolves.toEqual({ url: latestUrl, version: 'v1.3.0' });
});

it.each([
  'https://example.com/bank.zip',
  'https://github.com/hbxtzhn/facee-bank/archive/refs/heads/main.zip',
])('普通ZIP/分支归档保持下载方式，不增加版本接口请求：%s', async (url) => {
  await expect(resolveBankUpdate(url)).resolves.toEqual({ url });
  expect(fetchMock).not.toHaveBeenCalled();
});

const fallbackUrl = 'https://github.com/hbxtzhn/facee-bank/releases/latest/download/bank-300.zip';

it.each([
  ['403 限流', () => fetchMock.mockResolvedValue({ ok: false, status: 403 })],
  ['网络不可达', () => fetchMock.mockRejectedValue(new TypeError('Network request failed'))],
  ['响应不是 JSON', () => fetchMock.mockResolvedValue({ ok: true, json: async () => { throw new SyntaxError('bad'); } })],
])('版本接口失败（%s）时降级到 latest/download 同名资产，不给版本、不报错', async (_name, arrange) => {
  arrange();
  await expect(resolveBankUpdate(sourceUrl)).resolves.toEqual({ url: fallbackUrl });
});

it('版本接口超时时同样降级', async () => {
  jest.useFakeTimers();
  try {
    fetchMock.mockImplementation(() => new Promise(() => undefined));
    const pending = resolveBankUpdate(sourceUrl);
    await jest.advanceTimersByTimeAsync(30_000);
    await expect(pending).resolves.toEqual({ url: fallbackUrl });
  } finally {
    jest.useRealTimers();
  }
});

it('latest/download 链接降级后保持原地址', async () => {
  fetchMock.mockResolvedValue({ ok: false, status: 403 });
  await expect(resolveBankUpdate(fallbackUrl)).resolves.toEqual({ url: fallbackUrl });
});

it('有多个ZIP且无原文件名时不随意替换为其他题库：降级为同名资产，由下载结果决定', async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({
    tag_name: 'v1.3.0', assets: [
      { name: 'a.zip', browser_download_url: 'https://github.com/a.zip' },
      { name: 'b.zip', browser_download_url: 'https://github.com/b.zip' },
    ],
  }) });
  await expect(resolveBankUpdate(sourceUrl)).resolves.toEqual({ url: fallbackUrl });
});
