import { isLocalBankId } from '../question-bank/local-banks';
import type { ZipEntryLike } from '../question-bank/file-repository';

/** 安全上限，不是性能基准；超过限制的备份需分批导出/导入。 */
export const BACKUP_LIMITS = {
  archiveBytes: 128 * 1024 * 1024,
  expandedBytes: 256 * 1024 * 1024,
  entryBytes: 32 * 1024 * 1024,
  entries: 20_000,
  banks: 500,
} as const;

export function assertBackupArchiveSize(size: unknown): void {
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0 || size > BACKUP_LIMITS.archiveBytes) {
    throw new Error('备份 ZIP 大小无效或超过 128 MB 限制');
  }
}

/** 解压前验证全部条目，拒绝未知内容；返回通过验证的文件白名单。 */
export function inspectBackupEntries(entries: readonly ZipEntryLike[]): { root: string; files: string[] } {
  if (!entries.length || entries.length > BACKUP_LIMITS.entries) throw new Error('备份 ZIP 文件数量超限或为空');
  const seen = new Set<string>();
  const paths = entries.map((entry) => {
    const path = entry.path.replace(/\/$/, '');
    if (!path || path.startsWith('/') || /[\\\x00-\x1f:]/.test(path)) throw new Error('备份包含不安全路径');
    for (const segment of path.split('/')) {
      let decoded: string;
      try { decoded = decodeURIComponent(segment); } catch { throw new Error('备份路径编码无效'); }
      if (!segment || decoded === '.' || decoded === '..' || /[\\/\x00-\x1f:]/.test(decoded)) {
        throw new Error('备份包含不安全路径');
      }
    }
    const key = path.toLowerCase();
    if (seen.has(key)) throw new Error('备份包含重复条目');
    seen.add(key);
    return path;
  });
  const roots = entries.flatMap((entry, i) => {
    if (entry.isDirectory) return [];
    const path = paths[i];
    return path === 'manifest.json' ? [''] : /^[^/]+\/manifest\.json$/.test(path) ? [path.slice(0, -13)] : [];
  });
  if (roots.length !== 1) throw new Error('备份必须包含唯一 manifest.json');
  const root = roots[0];
  let total = 0;
  const files: string[] = [];
  entries.forEach((entry, i) => {
    if (entry.isEncrypted) throw new Error('不支持加密备份');
    const path = paths[i];
    if (entry.isDirectory && root && `${path}/` === root) return;
    if (!path.startsWith(root)) throw new Error('备份包含根目录外的内容');
    const relative = path.slice(root.length);
    const parts = relative.split('/');
    const allowedDirectory = entry.isDirectory && (
      relative === 'sources' || relative === 'assets' ||
      (parts[0] === 'assets' && parts.length >= 2 && isLocalBankId(parts[1]) &&
        (parts.length === 2 || (/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(parts[2]) &&
          (parts.length === 3 || parts[3] === 'assets'))))
    );
    const allowedFile = !entry.isDirectory && (
      relative === 'manifest.json' ||
      (parts[0] === 'sources' && parts.length === 2 && parts[1].endsWith('.json') && isLocalBankId(parts[1].slice(0, -5))) ||
      (parts[0] === 'assets' && parts.length >= 5 && isLocalBankId(parts[1]) &&
        /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(parts[2]) && parts[3] === 'assets')
    );
    if (!allowedDirectory && !allowedFile) throw new Error(`备份包含未知条目：${entry.path}`);
    if (!entry.isDirectory) {
      if (typeof entry.size !== 'number' || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > BACKUP_LIMITS.entryBytes) {
        throw new Error('备份条目大小无效或超过 32 MB 限制');
      }
      total += entry.size;
      if (total > BACKUP_LIMITS.expandedBytes) throw new Error('备份解压体积超过 256 MB 限制');
      files.push(entry.path);
    }
  });
  return { root, files };
}
