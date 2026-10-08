import { describe, it, expect } from '@jest/globals';
import {
  compareVersions,
  findExpectedChecksum,
  formatBytes,
  isUpdateAvailable,
  isTrustedDownloadUrl,
  parseRelease,
  parseSha256Sums,
  parseVersion,
  pickApkAsset,
  pickChecksumAsset,
} from './app-update';

describe('版本比较', () => {
  it('解析 v 前缀与多位版本', () => {
    expect(parseVersion('v1.1.0')).toEqual([1, 1, 0]);
    expect(parseVersion('1.0.1')).toEqual([1, 0, 1]);
    expect(parseVersion('2')).toEqual([2]);
    expect(parseVersion('abc')).toBeNull();
    expect(parseVersion('1.0.0-beta')).toBeNull();
  });

  it('按段比较，缺位补 0', () => {
    expect(compareVersions('1.1.0', '1.0.1')).toBe(1);
    expect(compareVersions('1.0.1', '1.1.0')).toBe(-1);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1);
  });

  it('只有更高版本才算可更新（相同/更低不算）', () => {
    expect(isUpdateAvailable('1.0.1', '1.1.0')).toBe(true);
    expect(isUpdateAvailable('1.1.0', '1.1.0')).toBe(false);
    expect(isUpdateAvailable('1.1.0', '1.0.1')).toBe(false);
    // 版本号解析失败时保守处理：不提示更新
    expect(isUpdateAvailable('1.0.1', 'nightly')).toBe(false);
  });
});

describe('挑选 APK 资产', () => {
  const assets = [
    { name: 'notes.txt', size: 10, browser_download_url: 'https://x/notes.txt' },
    { name: 'FaceE-arm64-1.1.0-release.apk', size: 32_694_530, browser_download_url: 'https://x/a.apk' },
  ];

  it('只挑 .apk，优先 arm64', () => {
    expect(pickApkAsset(assets)?.name).toBe('FaceE-arm64-1.1.0-release.apk');
    expect(pickApkAsset(assets)?.sizeBytes).toBe(32_694_530);
  });

  it('没有 apk 时返回 null', () => {
    expect(pickApkAsset([{ name: 'a.txt', browser_download_url: 'https://x/a.txt' }])).toBeNull();
    expect(pickApkAsset(null)).toBeNull();
  });
});

describe('解析 GitHub Releases 响应', () => {
  const payload = {
    tag_name: 'v1.1.0',
    body: '## 更新内容\n- 应用内更新',
    published_at: '2026-09-17T00:00:00Z',
    assets: [{ name: 'FaceE-arm64-1.1.0-release.apk', size: 123, browser_download_url: 'https://x/a.apk' }],
  };

  it('正常解析出版本/说明/APK', () => {
    const release = parseRelease(payload);
    expect(release?.version).toBe('1.1.0');
    expect(release?.notes).toContain('应用内更新');
    expect(release?.apk?.downloadUrl).toBe('https://x/a.apk');
    // 没有 SHA256SUMS 资产时 checksums 为 null（卡片据此拒绝下载）
    expect(release?.checksums).toBeNull();
  });

  it('带上 SHA256SUMS 时一起解析', () => {
    const release = parseRelease({
      ...payload,
      assets: [
        ...payload.assets,
        { name: 'SHA256SUMS', size: 99, browser_download_url: 'https://x/SHA256SUMS' },
      ],
    });
    expect(release?.checksums?.name).toBe('SHA256SUMS');
  });

  it('异常输入返回 null，不抛错', () => {
    expect(parseRelease(null)).toBeNull();
    expect(parseRelease({ tag_name: 'nightly' })).toBeNull();
    expect(parseRelease({})).toBeNull();
  });
});

describe('下载地址白名单', () => {
  it('只允许 GitHub 官方域名的 https 地址', () => {
    expect(isTrustedDownloadUrl('https://github.com/HBxtzhn/facee/releases/download/v1.4.0/a.apk')).toBe(true);
    expect(isTrustedDownloadUrl('https://objects.githubusercontent.com/abc?X-Amz-Signature=1')).toBe(true);
    expect(isTrustedDownloadUrl('https://GITHUB.COM/a.apk')).toBe(true);
  });

  it('拒绝 http、其它域名与仿冒域名', () => {
    expect(isTrustedDownloadUrl('http://github.com/a.apk')).toBe(false);
    expect(isTrustedDownloadUrl('https://evil.com/a.apk')).toBe(false);
    expect(isTrustedDownloadUrl('https://github.com.evil.com/a.apk')).toBe(false);
    expect(isTrustedDownloadUrl('https://evil-github.com/a.apk')).toBe(false);
    expect(isTrustedDownloadUrl('ftp://github.com/a.apk')).toBe(false);
    expect(isTrustedDownloadUrl('not a url')).toBe(false);
  });
});

describe('SHA256SUMS 资产', () => {
  it('从 assets 里挑出校验文件', () => {
    const assets = [
      { name: 'FaceE-arm64-1.4.0-release.apk', size: 100, browser_download_url: 'https://x/a.apk' },
      { name: 'SHA256SUMS', size: 99, browser_download_url: 'https://x/SHA256SUMS' },
    ];
    expect(pickChecksumAsset(assets)?.downloadUrl).toBe('https://x/SHA256SUMS');
    expect(pickChecksumAsset(assets.slice(0, 1))).toBeNull();
    expect(pickChecksumAsset(null)).toBeNull();
  });

  it('解析两种行格式，容错 CRLF/注释/坏行，带路径按文件名匹配', () => {
    const sums = parseSha256Sums(
      [
        '# 注释',
        '',
        'a'.repeat(64) + '  FaceE-arm64-1.4.0-release.apk',
        'b'.repeat(64) + ' *dir/SHA256SUMS-extra.txt',
        '坏行',
        'c'.repeat(10) + '  short.apk',
      ].join('\n'),
    );
    expect(sums.get('FaceE-arm64-1.4.0-release.apk')).toBe('a'.repeat(64));
    expect(sums.get('SHA256SUMS-extra.txt')).toBe('b'.repeat(64));
    expect(sums.size).toBe(2);
  });

  it('大写十六进制归一化为小写，兼容 CRLF', () => {
    const sums = parseSha256Sums(`${'A'.repeat(64)}  a.apk\r\n`);
    expect(findExpectedChecksum(sums, 'a.apk')).toBe('a'.repeat(64));
  });

  it('按 APK 名取期望值，缺失返回 null', () => {
    const sums = parseSha256Sums(`${'d'.repeat(64)}  FaceE-arm64-1.4.0-release.apk`);
    expect(findExpectedChecksum(sums, 'FaceE-arm64-1.4.0-release.apk')).toBe('d'.repeat(64));
    expect(findExpectedChecksum(sums, '别的包.apk')).toBeNull();
  });
});

describe('体积展示', () => {
  it('按量级给出可读文本', () => {
    expect(formatBytes(32_694_530)).toBe('31.2 MB');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(0)).toBe('未知大小');
  });
});
