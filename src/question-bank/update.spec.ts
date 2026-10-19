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

it('查询失败时报告错误，不能误报已是最新版本', async () => {
  fetchMock.mockResolvedValue({ ok: false, status: 403 });
  await expect(resolveBankUpdate(sourceUrl)).rejects.toThrow('检查题库版本失败（HTTP 403）');
});

it('有多个ZIP且无原文件名时不随意替换为其他题库', async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({
    tag_name: 'v1.3.0', assets: [
      { name: 'a.zip', browser_download_url: 'https://github.com/a.zip' },
      { name: 'b.zip', browser_download_url: 'https://github.com/b.zip' },
    ],
  }) });
  await expect(resolveBankUpdate(sourceUrl)).rejects.toThrow('没有找到对应的 ZIP 文件');
});
