import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import {
  useBankStore,
  type BankActionError,
  type BankOrigin,
  type BankResult,
  type BankSummary,
  type BusyState,
  type Bundle,
  type InstallProgress,
  type InstallResult,
  type UpdateCheck,
} from '../../bank';

/**
 * 「我的」/ 题库管理 / 线上题库 / 编辑器共用的 v2 题库 UI 助手。
 * 只从 src/bank 公开入口取数据；store 暂缺的能力（读取任一题库的 bundle、复制题库）在这里用
 * 「exportBankFile → 读文件」「改写 bundle → importBankFile」组合实现。
 */

/** 官方题库 latest.json（v2 发布前会 404，界面需给出明确提示） */
export const OFFICIAL_MANIFEST_URL = 'https://github.com/hbxtzhn/facee-bank/releases/latest/download/latest.json';

/**
 * 是否官方题库的清单地址。GitHub 的 owner / repo 不区分大小写：0.2.0 之前的测试版用混写 HBxtzhn 安装过，
 * 地址按安装时原样保存，因此比较时忽略大小写。
 */
export function isOfficialManifestUrl(url: string | null | undefined): boolean {
  return !!url && url.trim().toLowerCase() === OFFICIAL_MANIFEST_URL.toLowerCase();
}

export const ORIGIN_LABEL: Record<BankOrigin, string> = {
  remote: '线上题库',
  local: '本地题库',
  file: '文件导入',
};

export const ORIGIN_HINT: Record<BankOrigin, string> = {
  remote: '在线题库，只能更新；想改题请「复制为本地编辑」',
  local: '本机自建，可自由编辑',
  file: '从文件导入，只读；想改题请「复制为本地编辑」',
};

export const UNSUPPORTED_TEXT = 'Web 预览不支持本地题库，请在 Android App 中使用。';

/** 统一的字数口径（规范 §2.1），实现在 lib/import-text */
export { countSpecChars, clipSpecChars } from '../../lib/import-text';

/** 错误转成可展示的中文；官方题库清单 404 时给出「尚未发布」的明确说明 */
export function bankErrorText(error: BankActionError | null | undefined, options: { official?: boolean } = {}): string {
  if (!error) return '';
  if (options.official && /HTTP 404/.test(error.message)) {
    return '官方题库还没有发布 v2 版本（清单地址返回 404）。请稍后再试，或在下方按网址添加其它题库。';
  }
  if (error.code === 'unsupported') return UNSUPPORTED_TEXT;
  return error.message;
}

/** 安装 / 更新 / 删除等独占操作的进度说明 */
export function describeBusy(busy: BusyState | null, progress: InstallProgress | null): string | null {
  if (!busy) return null;
  if (progress?.message) return progress.message;
  switch (busy.kind) {
    case 'install': return '正在安装题库…';
    case 'update': return '正在更新题库…';
    case 'delete': return '正在删除题库…';
    case 'local-edit': return '正在保存…';
    case 'backup-import': return '正在恢复备份…';
    default: return '正在处理题库…';
  }
}

/** 检查更新结果的摘要：标题、题目变化计数、更新说明 */
export function describeUpdateCheck(check: UpdateCheck): { headline: string; counts: string | null; changes: string | null; canUpdate: boolean } {
  if (check.appTooOld) {
    return {
      headline: `新版本 v${check.version} 需要 FaceE ${check.minAppVersion ?? ''} 或更高版本，请先升级 App。`,
      counts: null,
      changes: check.changes,
      canUpdate: false,
    };
  }
  if (!check.hasUpdate) {
    return { headline: `已是最新版本 v${check.currentVersion}。`, counts: null, changes: null, canUpdate: false };
  }
  return {
    headline: `发现新版本 v${check.version}（当前 v${check.currentVersion}）`,
    counts: `新增 ${check.added.length} 题 / 修改 ${check.changed.length} 题 / 删除 ${check.removed.length} 题`,
    changes: check.changes,
    canUpdate: true,
  };
}

/** 题库行副标题：题数 · 版本 · 最近检查 */
export function describeBank(bank: BankSummary): string {
  const parts = [`${bank.questionCount} 题`, `v${bank.version}`];
  if (bank.origin === 'remote') {
    if (bank.lastCheck) {
      parts.push(bank.lastCheck.hasUpdate ? `可更新到 v${bank.lastCheck.version}` : '已是最新');
    } else if (bank.checkedAt) {
      parts.push(`检查于 ${formatDate(bank.checkedAt)}`);
    }
  }
  return parts.join(' · ');
}

export function formatDate(timestamp: number | null | undefined): string {
  if (!timestamp) return '—';
  const date = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function describeInstall(result: InstallResult): string {
  if (result.previousVersion && result.previousVersion !== result.version) {
    return `「${result.name}」已更新到 v${result.version}（${result.questionCount} 题）。`;
  }
  if (result.previousVersion) return `「${result.name}」已重新安装（${result.questionCount} 题）。`;
  return `已添加「${result.name}」（${result.questionCount} 题，${ORIGIN_LABEL[result.origin]}）。`;
}

// ---------- 文件 ----------

/** 交给系统分享；分享不可用时返回 false（调用方提示文件位置） */
export async function shareFile(uri: string, dialogTitle: string): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(uri, { mimeType: 'application/json', dialogTitle, UTI: 'public.json' });
  return true;
}

/** 读取任一题库的完整 bundle（store 只缓存当前题库的分类 / 标签，编辑非当前题库时用它） */
export async function loadBankBundle(bankId: string): Promise<BankResult<Bundle>> {
  const exported = await useBankStore.getState().exportBankFile(bankId);
  if (!exported.ok) return exported;
  try {
    const text = await FileSystem.readAsStringAsync(exported.value, { encoding: 'utf8' });
    return { ok: true, value: JSON.parse(text) as Bundle };
  } catch (error) {
    return { ok: false, error: { code: 'unknown', message: `读取题库失败：${error instanceof Error ? error.message : String(error)}` } };
  }
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 本地题库 id：`local/device/<ULID 形式>`（与数据层的本地题库 id 规则一致） */
export function newLocalBankId(now = Date.now(), random: () => number = Math.random): string {
  let time = '';
  let value = now;
  for (let i = 0; i < 10; i += 1) {
    time = CROCKFORD[value % 32] + time;
    value = Math.floor(value / 32);
  }
  let tail = '';
  for (let i = 0; i < 16; i += 1) tail += CROCKFORD[Math.floor(random() * 32)];
  return `local/device/${time}${tail}`;
}

/** 把任一题库的 bundle 改写为新的本地题库（新 id、去掉更新地址、生命周期清空） */
export function toLocalCopy(bundle: Bundle, bankId: string): Bundle {
  const { update: _update, feedbackUrl: _feedback, ...meta } = bundle.bank;
  return {
    ...bundle,
    bank: { ...meta, id: bankId, name: `${bundle.bank.name}（副本）`, version: '1.0.0' },
    lifecycle: { removed: [], merged: {} },
  };
}

/**
 * 复制为本地可编辑题库。store 没有 copyBank：导出 bundle → 改写 id → 作为 local/ 题库导入。
 * 图片资源不随副本复制（本地题库暂不支持图片），副本里的图片引用将无法显示。
 */
export async function copyBankAsLocal(bankId: string): Promise<BankResult<InstallResult>> {
  const store = useBankStore.getState();
  const exported = await store.exportBankFile(bankId);
  if (!exported.ok) return exported;
  let copyUri: string;
  try {
    const bundle = JSON.parse(await FileSystem.readAsStringAsync(exported.value, { encoding: 'utf8' })) as Bundle;
    const copy = toLocalCopy(bundle, newLocalBankId());
    copyUri = exported.value.replace(/[^/]+$/, `local-copy-${Date.now()}.json`);
    await FileSystem.writeAsStringAsync(copyUri, JSON.stringify(copy), { encoding: 'utf8' });
  } catch (error) {
    const failure: BankActionError = { code: 'unknown', message: `复制题库失败：${error instanceof Error ? error.message : String(error)}` };
    useBankStore.setState({ lastError: failure });
    return { ok: false, error: failure };
  }
  const result = await useBankStore.getState().importBankFile(copyUri);
  await FileSystem.deleteAsync(copyUri, { idempotent: true }).catch(() => undefined);
  return result;
}
