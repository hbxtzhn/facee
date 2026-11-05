import { BankError, toBankError } from './errors';
import { applyLifecycle } from './lifecycle';
import {
  deleteBankContent,
  insertQuestionRows,
  upsertBankRow,
  writeTaxonomyRows,
  type BankOrigin,
} from './bank-rows';
import { bankDirKey } from './hash';
import { asDir, joinUri } from './platform';
import type { BankRuntime } from './runtime-types';
import { ASSET_REF_PATTERN, type ArtifactRef, type Bundle, type Manifest, type QuestionId } from './types';
import { assertValidBundle, assertValidManifest, compareSemver } from './validate';

/**
 * 安装器 / 更新器（§3、§4、§6.1）。
 *
 * 原子性约定（任何一步失败，上一次安装完整保留）：
 * 1. 清单、bundle、资源 ZIP 全部下载到缓存暂存目录，校验 size + sha256；
 * 2. bundle 解析 + 规范校验；资源解压到**新的**资源目录，逐个校验文件 sha256 与文件名一致；
 * 3. 单个独占事务内：删除该库全部题库行 → 插入新行与 FTS → 按 lifecycle 迁移学习数据 → 更新 banks 行；
 * 4. 事务提交后才删除旧资源目录；事务失败则删除新资源目录。暂存目录总是清理。
 *
 * 学习数据表除 lifecycle 迁移外不被触碰。不使用任何 GitHub API。
 */

export const MANIFEST_TIMEOUT_MS = 15_000;
export const DOWNLOAD_TIMEOUT_MS = 180_000;
export const ASSET_ROOT = 'bank-assets/';
const STAGING_ROOT = 'bank-staging/';
const ASSET_FILE_PATTERN = /^[0-9a-f]{64}\.(png|jpe?g|webp)$/;
const MARKDOWN_ASSET_REF = /asset:([0-9a-f]{64}\.(?:png|jpe?g|webp))/g;

export type InstallStage = 'manifest' | 'bundle' | 'assets' | 'import' | 'cleanup';

export interface InstallProgress {
  stage: InstallStage;
  /** 可直接展示的中文说明 */
  message: string;
}

export interface InstallOptions {
  onProgress?: (progress: InstallProgress) => void;
}

export interface InstallResult {
  bankId: string;
  name: string;
  version: string;
  /** 覆盖安装前的版本；首次安装为 null */
  previousVersion: string | null;
  questionCount: number;
  origin: BankOrigin;
}

export interface UpdateCheck {
  bankId: string;
  currentVersion: string;
  /** 清单里的最新版本 */
  version: string;
  /** 最新版本高于已安装版本 */
  hasUpdate: boolean;
  /** 本版更新说明（latest.json.changes） */
  changes: string | null;
  publishedAt: string;
  /** 新增 / 内容变化 / 删除的题目 id（按 contentHash 比较） */
  added: QuestionId[];
  changed: QuestionId[];
  removed: QuestionId[];
  minAppVersion: string | null;
  /** App 版本低于 minAppVersion，需先升级 App */
  appTooOld: boolean;
  checkedAt: number;
}

interface InstalledBankRow {
  id: string;
  origin: BankOrigin;
  version: string;
  manifest_url: string | null;
  asset_dir: string | null;
  assets_sha256: string | null;
  meta: string;
}

function now(rt: BankRuntime): number {
  return rt.now ? rt.now() : Date.now();
}

function report(options: InstallOptions | undefined, stage: InstallStage, message: string): void {
  try {
    options?.onProgress?.({ stage, message });
  } catch {
    // 进度回调异常不影响安装
  }
}

async function getInstalledRow(rt: BankRuntime, bankId: string): Promise<InstalledBankRow | null> {
  return rt.db.getFirstAsync<InstalledBankRow>(
    'SELECT id, origin, version, manifest_url, asset_dir, assets_sha256, meta FROM banks WHERE id = ?',
    [bankId],
  );
}

function stagingToken(rt: BankRuntime): string {
  return `${now(rt).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    throw new BankError('invalid', `${label}不是合法的 JSON`);
  }
}

export function checkAppVersion(appVersion: string, minAppVersion: string | undefined | null): void {
  if (minAppVersion && compareSemver(appVersion, minAppVersion) < 0) {
    throw new BankError('app-too-old', `该题库需要 FaceE ${minAppVersion} 或更高版本（当前 ${appVersion}），请先升级 App`);
  }
}

export async function fetchManifest(rt: BankRuntime, url: string): Promise<Manifest> {
  let text: string;
  try {
    text = await rt.platform.fetchText(url, MANIFEST_TIMEOUT_MS);
  } catch (error) {
    const bankError = toBankError(error);
    throw bankError.code === 'unknown' ? new BankError('network', `获取更新清单失败：${bankError.message}`) : bankError;
  }
  return assertValidManifest(parseJson(text, '更新清单'));
}

/** 按 url → mirrors 顺序下载并校验 size + sha256；全部失败抛最后一个错误 */
async function downloadVerified(rt: BankRuntime, artifact: ArtifactRef, destination: string, label: string): Promise<void> {
  const urls = [artifact.url, ...(artifact.mirrors ?? [])];
  let lastError: BankError | null = null;
  for (const url of urls) {
    try {
      await rt.platform.deletePath(destination);
      await rt.platform.downloadFile(url, destination, DOWNLOAD_TIMEOUT_MS);
      const size = await rt.platform.fileSize(destination);
      if (size !== artifact.size) {
        throw new BankError('integrity', `${label}大小不符（期望 ${artifact.size} 字节，实际 ${size ?? 0} 字节）`);
      }
      const sha = await rt.platform.sha256File(destination);
      if (sha !== artifact.sha256) throw new BankError('integrity', `${label}校验失败（sha256 不符），文件可能被篡改或下载不完整`);
      return;
    } catch (error) {
      const bankError = toBankError(error);
      lastError = bankError.code === 'unknown' ? new BankError('network', `${label}下载失败：${bankError.message}`) : bankError;
    }
  }
  throw lastError ?? new BankError('network', `${label}下载失败`);
}

/** bundle 中所有 Markdown 字段引用的资源文件名 */
export function collectAssetRefs(bundle: Pick<Bundle, 'questions'>): Set<string> {
  const refs = new Set<string>();
  const scan = (markdown: string | null | undefined) => {
    if (!markdown) return;
    for (const match of markdown.matchAll(MARKDOWN_ASSET_REF)) refs.add(match[1]);
  };
  for (const q of bundle.questions) {
    scan(q.prompt);
    scan(q.answer.detail);
    scan(q.answer.examples);
    scan(q.choice?.explanation);
    for (const f of q.followups) scan(f.a);
  }
  return refs;
}

interface PreparedAssets {
  /** 相对 documentDirectory 的资源目录（以 / 结尾）；null = 无资源 */
  assetDir: string | null;
  assetsSha256: string | null;
  /** 本次新建的目录（失败时需要删除）；复用旧目录时为 null */
  createdDir: string | null;
}

/** 解压并逐个校验资源：ZIP 只允许扁平的 `<sha256>.<ext>` 文件 */
async function extractAssets(rt: BankRuntime, bankId: string, zipUri: string, token: string, required: Set<string>): Promise<string> {
  const { platform } = rt;
  const entries = await platform.listZipEntries(zipUri);
  for (const entry of entries) {
    if (entry.endsWith('/')) continue;
    if (!ASSET_FILE_PATTERN.test(entry)) throw new BankError('integrity', `资源包含不允许的条目：${entry}`);
  }
  const relativeDir = `${ASSET_ROOT}${bankDirKey(bankId)}-${token}/`;
  const absoluteDir = joinUri(platform.documentDirectory, relativeDir);
  try {
    await platform.makeDirectory(absoluteDir);
    await platform.unzip(zipUri, absoluteDir);
    const files = new Set(await platform.listFiles(absoluteDir));
    for (const file of files) {
      if (!ASSET_FILE_PATTERN.test(file)) throw new BankError('integrity', `资源包含不允许的文件：${file}`);
      const sha = await platform.sha256File(joinUri(absoluteDir, file));
      if (sha !== file.slice(0, 64)) throw new BankError('integrity', `资源文件 ${file} 内容与文件名哈希不符`);
    }
    const missing = [...required].filter((name) => !files.has(name));
    if (missing.length > 0) throw new BankError('integrity', `资源包缺少 ${missing.length} 个被引用的文件，如 ${missing[0]}`);
    return relativeDir;
  } catch (error) {
    await platform.deletePath(absoluteDir).catch(() => undefined);
    throw error;
  }
}

interface CommitInput {
  bundle: Bundle;
  origin: BankOrigin;
  manifestUrl: string | null;
  publishedAt: string | null;
  assets: PreparedAssets;
  previous: InstalledBankRow | null;
}

/** 单事务导入；提交后清理旧资源目录 */
async function commitBundle(rt: BankRuntime, input: CommitInput, options?: InstallOptions): Promise<InstallResult> {
  const { bundle } = input;
  const bankId = bundle.bank.id;
  const timestamp = now(rt);
  report(options, 'import', `正在导入 ${bundle.questions.length} 道题`);
  try {
    await rt.db.withExclusiveTransactionAsync(async (tx) => {
      await deleteBankContent(tx, bankId);
      await upsertBankRow(tx, {
        meta: bundle.bank,
        origin: input.origin,
        manifestUrl: input.manifestUrl,
        assetDir: input.assets.assetDir,
        assetsSha256: input.assets.assetsSha256,
        publishedAt: input.publishedAt,
        now: timestamp,
      });
      await writeTaxonomyRows(tx, bundle);
      await insertQuestionRows(tx, bankId, bundle.questions);
      await applyLifecycle(tx, bankId, timestamp);
    });
  } catch (error) {
    if (input.assets.createdDir) await rt.platform.deletePath(input.assets.createdDir).catch(() => undefined);
    const bankError = toBankError(error);
    throw bankError.code === 'unknown' ? new BankError('unknown', `写入题库失败，已保留原有数据：${bankError.message}`) : bankError;
  }
  report(options, 'cleanup', '正在清理旧文件');
  const oldDir = input.previous?.asset_dir;
  if (oldDir && oldDir !== input.assets.assetDir) {
    await rt.platform.deletePath(joinUri(rt.platform.documentDirectory, oldDir)).catch(() => undefined);
  }
  return {
    bankId,
    name: bundle.bank.name,
    version: bundle.bank.version,
    previousVersion: input.previous?.version ?? null,
    questionCount: bundle.questions.length,
    origin: input.origin,
  };
}

/**
 * 从 latest.json 地址添加（或更新）在线题库。
 * @param expectedBankId 更新时传入：清单的 bankId 必须与之相同
 */
export async function addBankFromManifestUrl(
  rt: BankRuntime,
  url: string,
  options?: InstallOptions & { expectedBankId?: string },
): Promise<InstallResult> {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) throw new BankError('invalid', '请输入以 http(s):// 开头的 latest.json 地址');
  report(options, 'manifest', '正在获取更新清单');
  const manifest = await fetchManifest(rt, trimmed);
  if (options?.expectedBankId && manifest.bankId !== options.expectedBankId) {
    throw new BankError('invalid', `清单属于题库 ${manifest.bankId}，与要更新的 ${options.expectedBankId} 不一致`);
  }
  checkAppVersion(rt.platform.appVersion, manifest.minAppVersion);
  const previous = await getInstalledRow(rt, manifest.bankId);
  if (previous && previous.origin === 'local') {
    throw new BankError('forbidden', '同 id 的本地自建题库已存在，不能用在线题库覆盖');
  }

  const token = stagingToken(rt);
  const staging = joinUri(rt.platform.cacheDirectory, `${STAGING_ROOT}${token}/`);
  let createdDir: string | null = null;
  try {
    await rt.platform.makeDirectory(staging);
    report(options, 'bundle', '正在下载题库');
    const bundleUri = joinUri(staging, 'bundle.json');
    await downloadVerified(rt, manifest.bundle, bundleUri, '题库数据');
    const bundle = assertValidBundle(parseJson(await rt.platform.readText(bundleUri), '题库数据'));
    if (bundle.bank.id !== manifest.bankId) {
      throw new BankError('integrity', `题库数据的 id（${bundle.bank.id}）与清单（${manifest.bankId}）不一致`);
    }
    if (bundle.bank.version !== manifest.version) {
      throw new BankError('integrity', `题库数据的版本（${bundle.bank.version}）与清单（${manifest.version}）不一致`);
    }
    const required = collectAssetRefs(bundle);
    let assets: PreparedAssets = { assetDir: null, assetsSha256: null, createdDir: null };
    if (manifest.assets) {
      if (previous?.asset_dir && previous.assets_sha256 === manifest.assets.sha256) {
        // 资源包未变：复用现有目录，不重复下载
        assets = { assetDir: previous.asset_dir, assetsSha256: previous.assets_sha256, createdDir: null };
      } else {
        report(options, 'assets', '正在下载图片资源');
        const zipUri = joinUri(staging, 'assets.zip');
        await downloadVerified(rt, manifest.assets, zipUri, '资源包');
        const assetDir = await extractAssets(rt, bundle.bank.id, zipUri, token, required);
        createdDir = joinUri(rt.platform.documentDirectory, assetDir);
        assets = { assetDir, assetsSha256: manifest.assets.sha256, createdDir };
      }
    } else if (required.size > 0) {
      throw new BankError('integrity', `题库引用了 ${required.size} 个图片资源，但清单没有提供资源包`);
    }
    const result = await commitBundle(
      rt,
      { bundle, origin: 'remote', manifestUrl: trimmed, publishedAt: manifest.publishedAt, assets, previous },
      options,
    );
    createdDir = null;
    await rt.db.runAsync('UPDATE banks SET checked_at = ?, check_result = NULL WHERE id = ?', [now(rt), bundle.bank.id]);
    return result;
  } catch (error) {
    if (createdDir) await rt.platform.deletePath(createdDir).catch(() => undefined);
    throw toBankError(error);
  } finally {
    await rt.platform.deletePath(staging).catch(() => undefined);
  }
}

/**
 * 从本地 bundle.json 文件导入（分享的题库、本地题库导出文件）。
 * - `local/` 开头的题库 id 作为本地自建题库导入（可编辑）；
 * - 带 bank.update.manifest 的作为在线题库（之后可检查更新）；
 * - 其它为只读的文件题库。
 * @param assetsZipUri 可选的资源 ZIP（扁平 `<sha256>.<ext>`），缺省时引用的图片无法显示
 */
export async function addBankFromBundleFile(
  rt: BankRuntime,
  uri: string,
  options?: InstallOptions & { assetsZipUri?: string },
): Promise<InstallResult> {
  report(options, 'bundle', '正在读取题库文件');
  let text: string;
  try {
    text = await rt.platform.readText(uri);
  } catch (error) {
    throw new BankError('not-found', `无法读取题库文件：${toBankError(error).message}`);
  }
  const bundle = assertValidBundle(parseJson(text, '题库文件'));
  return installBundle(rt, bundle, options);
}

/** 安装一个已校验的 Bundle 对象（本地题库导入、备份恢复共用） */
export async function installBundle(
  rt: BankRuntime,
  bundle: Bundle,
  options?: InstallOptions & { assetsZipUri?: string },
): Promise<InstallResult> {
  const previous = await getInstalledRow(rt, bundle.bank.id);
  const isLocal = bundle.bank.id.startsWith('local/');
  const manifestUrl = isLocal ? null : (previous?.manifest_url ?? bundle.bank.update?.manifest ?? null);
  const origin: BankOrigin = isLocal ? 'local' : manifestUrl ? 'remote' : 'file';
  const token = stagingToken(rt);
  let assets: PreparedAssets = {
    // 没有新资源包时保留旧资源目录（文件题库再导入时图片仍可用）
    assetDir: previous?.asset_dir ?? null,
    assetsSha256: previous?.assets_sha256 ?? null,
    createdDir: null,
  };
  if (options?.assetsZipUri) {
    report(options, 'assets', '正在解压图片资源');
    const sha = await rt.platform.sha256File(options.assetsZipUri);
    const assetDir = await extractAssets(rt, bundle.bank.id, options.assetsZipUri, token, new Set());
    assets = { assetDir, assetsSha256: sha, createdDir: joinUri(rt.platform.documentDirectory, assetDir) };
  }
  return commitBundle(rt, { bundle, origin, manifestUrl, publishedAt: null, assets, previous }, options);
}

/** 只拉 latest.json，对比 contentHash 得出新增 / 修改 / 删除，不下载 bundle */
export async function checkForUpdate(rt: BankRuntime, bankId: string): Promise<UpdateCheck> {
  const row = await getInstalledRow(rt, bankId);
  if (!row) throw new BankError('not-found', '题库不存在');
  const manifestUrl = row.manifest_url;
  if (!manifestUrl) throw new BankError('forbidden', '该题库没有更新地址，不支持在线更新');
  const manifest = await fetchManifest(rt, manifestUrl);
  if (manifest.bankId !== bankId) {
    throw new BankError('invalid', `清单属于题库 ${manifest.bankId}，与当前题库 ${bankId} 不一致`);
  }
  const installed = new Map(
    (await rt.db.getAllAsync<{ id: string; content_hash: string }>('SELECT id, content_hash FROM questions WHERE bank_id = ?', [bankId]))
      .map((q) => [q.id, q.content_hash] as const),
  );
  const added: string[] = [];
  const changed: string[] = [];
  for (const [id, hash] of Object.entries(manifest.questions)) {
    const current = installed.get(id);
    if (current === undefined) added.push(id);
    else if (current !== hash) changed.push(id);
  }
  const removed = [...installed.keys()].filter((id) => !(id in manifest.questions));
  const checkedAt = now(rt);
  const result: UpdateCheck = {
    bankId,
    currentVersion: row.version,
    version: manifest.version,
    hasUpdate: compareSemver(manifest.version, row.version) > 0,
    changes: manifest.changes ?? null,
    publishedAt: manifest.publishedAt,
    added: added.sort(),
    changed: changed.sort(),
    removed: removed.sort(),
    minAppVersion: manifest.minAppVersion ?? null,
    appTooOld: !!manifest.minAppVersion && compareSemver(rt.platform.appVersion, manifest.minAppVersion) < 0,
    checkedAt,
  };
  await rt.db.runAsync('UPDATE banks SET checked_at = ?, check_result = ? WHERE id = ?', [checkedAt, JSON.stringify(result), bankId]);
  return result;
}

/** 安装该题库清单里的最新版本 */
export async function updateBank(rt: BankRuntime, bankId: string, options?: InstallOptions): Promise<InstallResult> {
  const row = await getInstalledRow(rt, bankId);
  if (!row) throw new BankError('not-found', '题库不存在');
  if (!row.manifest_url) throw new BankError('forbidden', '该题库没有更新地址，不支持在线更新');
  return addBankFromManifestUrl(rt, row.manifest_url, { ...options, expectedBankId: bankId });
}

// ---------- 资源解析 ----------

/** 题库资源目录的绝对 URI（以 / 结尾）；无资源返回 null */
export async function getAssetBaseUri(rt: BankRuntime, bankId: string): Promise<string | null> {
  const row = await rt.db.getFirstAsync<{ asset_dir: string | null }>('SELECT asset_dir FROM banks WHERE id = ?', [bankId]);
  return row?.asset_dir ? asDir(joinUri(rt.platform.documentDirectory, row.asset_dir)) : null;
}

/** `asset:<sha256>.<ext>` → 文件 URI；格式不对或无资源目录返回 null */
export function resolveAssetRef(assetBaseUri: string | null, ref: string): string | null {
  if (!assetBaseUri || !ASSET_REF_PATTERN.test(ref)) return null;
  return joinUri(assetBaseUri, ref.slice('asset:'.length));
}

export async function resolveAssetUri(rt: BankRuntime, bankId: string, ref: string): Promise<string | null> {
  return resolveAssetRef(await getAssetBaseUri(rt, bankId), ref);
}

/** 把 Markdown 里的 `asset:` 引用改写成文件 URI（图片与链接写法都处理）；无资源目录时原样返回 */
export function rewriteMarkdownAssets(markdown: string, assetBaseUri: string | null): string;
export function rewriteMarkdownAssets(markdown: string | null | undefined, assetBaseUri: string | null): string | null;
export function rewriteMarkdownAssets(markdown: string | null | undefined, assetBaseUri: string | null): string | null {
  if (markdown === null || markdown === undefined) return null;
  if (!assetBaseUri) return markdown;
  return markdown.replace(/\]\(\s*asset:([0-9a-f]{64}\.(?:png|jpe?g|webp))/g, (_match, file: string) => `](${joinUri(assetBaseUri, file)}`);
}
