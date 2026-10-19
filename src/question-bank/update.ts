import { compareVersions, parseVersion } from '../lib/app-update';
import { withNetworkTimeout } from '../lib/network';

/** 老题库未提供版本时仍允许更新；数字版本相同或更低时保留本地内容。 */
export function shouldUpdateBank(current?: string, incoming?: string): boolean {
  if (!current?.trim() || !incoming?.trim()) return true;
  if (parseVersion(current) && parseVersion(incoming)) {
    return compareVersions(incoming, current) > 0;
  }
  return incoming.trim() !== current.trim();
}

/** Release ZIP 地址每次更新时解析到最新正式发布，避免永久下载旧 tag 的包。 */
export async function resolveBankUpdate(url: string): Promise<{ url: string; version?: string }> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'github.com') return { url };
  const match = /^\/([^/]+)\/([^/]+)\/releases\/(?:download\/[^/]+|latest\/download)\/([^/]+\.zip)$/i.exec(parsed.pathname);
  if (!match) return { url };
  const [, owner, repo, filename] = match;
  return withNetworkTimeout(async (signal) => {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal,
    });
    if (!response.ok) throw new Error(`检查题库版本失败（HTTP ${response.status}）`);
    const release = await response.json() as {
      tag_name?: string;
      assets?: { name: string; browser_download_url: string }[];
    };
    const zips = (release.assets ?? []).filter((asset) => /\.zip$/i.test(asset.name));
    // 优先沿用资产名；版本号写进文件名时，兼容最新发布中的唯一 ZIP。
    const asset = zips.find((item) => item.name === decodeURIComponent(filename))
      ?? (zips.length === 1 ? zips[0] : undefined);
    if (!asset) throw new Error('最新题库发布中没有找到对应的 ZIP 文件');
    return { url: asset.browser_download_url, version: release.tag_name };
  });
}
