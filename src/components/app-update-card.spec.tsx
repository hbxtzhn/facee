import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

/**
 * 应用内更新卡片：只测「检查」这条纯前端路径（下载/安装涉及原生与网络，留设备验收）。
 * 真机验证过：点「检查更新」→ 发现新版本 → 点「下载并安装」→ 系统安装器弹出。
 */
jest.mock('../lib/app-update', () => {
  const actual = jest.requireActual('../lib/app-update');
  return { ...actual, UPDATE_RELEASES_API: 'https://example.test/latest', UPDATE_RELEASES_PAGE: 'https://example.test' };
});

// 固定「当前版本」，否则测试环境里 Constants.expoConfig 为空会回退成 0.0.0
jest.mock('expo-constants', () => ({ expoConfig: { version: '1.1.0' } }));
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  getInfoAsync: jest.fn(),
  deleteAsync: jest.fn(),
  downloadAsync: jest.fn(),
  getContentUriAsync: jest.fn(),
}));
jest.mock('expo-intent-launcher', () => ({ startActivityAsync: jest.fn() }));

// eslint-disable-next-line import/first
import { AppUpdateCard } from './app-update-card';

const release = (version: string, withApk = true, host = 'github.com') => ({
  tag_name: `v${version}`,
  body: '更新说明',
  published_at: '2026-09-17T00:00:00Z',
  assets: withApk
    ? [
        {
          name: `FaceE-arm64-${version}-release.apk`,
          size: 1024 * 1024,
          browser_download_url: `https://${host}/HBxtzhn/facee/releases/download/v${version}/FaceE-arm64-${version}-release.apk`,
        },
        {
          name: 'SHA256SUMS',
          size: 99,
          browser_download_url: `https://${host}/HBxtzhn/facee/releases/download/v${version}/SHA256SUMS`,
        },
      ]
    : [{ name: 'notes.txt', size: 10, browser_download_url: `https://${host}/n.txt` }],
});

describe('应用内更新卡片', () => {
  beforeEach(() => jest.clearAllMocks());

  it('发现更高版本时展示版本号与大小，并给出下载安装入口', async () => {
    (global as unknown as { fetch: jest.Mock }).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => release('99.0.0'),
    });

    await render(<AppUpdateCard />);
    await fireEvent.press(screen.getByText('检查更新'));

    await waitFor(() => expect(screen.getByText('发现新版本 99.0.0')).toBeTruthy());
    expect(screen.getByText(/1.0 MB/)).toBeTruthy();
    expect(screen.getByText('下载并安装')).toBeTruthy();
  });

  it('已是最新版本时不出现下载入口', async () => {
    (global as unknown as { fetch: jest.Mock }).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => release('0.0.1'),
    });

    await render(<AppUpdateCard />);
    await fireEvent.press(screen.getByText('检查更新'));

    await waitFor(() => expect(screen.getByText('已是最新版本。')).toBeTruthy());
    expect(screen.queryByText('下载并安装')).toBeNull();
  });

  it('GitHub 限流时给出可操作提示', async () => {
    (global as unknown as { fetch: jest.Mock }).fetch = jest.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });

    await render(<AppUpdateCard />);
    await fireEvent.press(screen.getByText('检查更新'));

    await waitFor(() => expect(screen.getByText(/限流/)).toBeTruthy());
  });

  it('最新版本没带 APK 时报错而不是假装可更新', async () => {
    (global as unknown as { fetch: jest.Mock }).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => release('99.0.0', false),
    });

    await render(<AppUpdateCard />);
    await fireEvent.press(screen.getByText('检查更新'));

    await waitFor(() => expect(screen.getByText(/没有提供安装包/)).toBeTruthy());
  });

  it('下载地址不在 GitHub 白名单时拒绝更新', async () => {
    (global as unknown as { fetch: jest.Mock }).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => release('99.0.0', true, 'evil-mirror.example'),
    });

    await render(<AppUpdateCard />);
    await fireEvent.press(screen.getByText('检查更新'));

    await waitFor(() => expect(screen.getByText(/不是 GitHub 官方域名/)).toBeTruthy());
    expect(screen.queryByText('下载并安装')).toBeNull();
  });

  it('没有附带 SHA256SUMS 时中止下载', async () => {
    (global as unknown as { fetch: jest.Mock }).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ...release('99.0.0'),
        assets: release('99.0.0').assets.slice(0, 1), // 去掉校验文件
      }),
    });

    await render(<AppUpdateCard />);
    await fireEvent.press(screen.getByText('检查更新'));

    await waitFor(() => expect(screen.getByText(/SHA256SUMS/)).toBeTruthy());
    expect(screen.queryByText('下载并安装')).toBeNull();
  });
});
