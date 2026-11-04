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

export interface ResolvedBankUpdate {
  url: string;
  /** 最新发布的 tag；未知（非 Release 链接或版本接口不可用）时缺省，由包内版本决定 */
  version?: string;
}

const RELEASE_ASSET_PATH = /^\/([^/]+)\/([^/]+)\/releases\/(?:download\/[^/]+|latest\/download)\/([^/]+\.zip)$/i;

/**
 * Release ZIP 地址每次更新时解析到最新正式发布，避免永久下载旧 tag 的包。
 *
 * 版本接口（未鉴权的 api.github.com）可能被限流（403）、超时或在部分网络下不可达：
 * 此时不报错，降级为 `releases/latest/download/<同名资产>` 且不给版本，
 * 交给 installFromUrl 的包内版本比较决定是否替换；只有下载本身失败才会报错。
 */
export async function resolveBankUpdate(url: string): Promise<ResolvedBankUpdate> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'github.com') return { url };
  const match = RELEASE_ASSET_PATH.exec(parsed.pathname);
  if (!match) return { url };
  const [, owner, repo, filename] = match;
  const fallback: ResolvedBankUpdate = {
    url: `https://github.com/${owner}/${repo}/releases/latest/download/${filename}`,
  };
  try {
    return await withNetworkTimeout(async (signal) => {
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
      return {
        url: asset.browser_download_url,
        ...(release.tag_name?.trim() ? { version: release.tag_name.trim() } : {}),
      };
    });
  } catch {
    // 版本未知：不能据此判断「已是最新」，降级下载同名资产后按包内版本比较
    return fallback;
  }
}

/**
 * 题库包内容指纹（catalog + 每题 Markdown 原文）。版本缺失（分支归档等）时
 * 用它判断线上包与上次下载的是否相同，避免被编辑过的库每次检查都弹确认。
 * 非加密用途：两个 32 位哈希 + 长度，足以区分内容变化。
 */
export function packageFingerprint(parts: readonly string[]): string {
  let fnv = 0x811c9dc5;
  let djb = 5381;
  let length = 0;
  for (const part of parts) {
    // 分隔符参与哈希，避免 ['ab','c'] 与 ['a','bc'] 相同
    const text = `${part}\u0000`;
    length += text.length;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      fnv = Math.imul(fnv ^ code, 0x01000193) >>> 0;
      djb = ((djb << 5) + djb + code) >>> 0;
    }
  }
  return `fp1-${fnv.toString(36)}-${djb.toString(36)}-${length.toString(36)}`;
}
