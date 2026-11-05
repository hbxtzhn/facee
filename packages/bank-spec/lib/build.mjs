// build：compile 通过后写出 dist/bundle-<version>.json、assets-<version>.zip、latest.json。

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileBank } from './compile.mjs';
import { sha256Hex } from './canonical.mjs';
import { writeZip } from './zip.mjs';

/**
 * @param {string} bankDir
 * @param {{ out: string, previous?: object|null, previousFile?: string, baseUrl?: string, publishedAt?: string, pretty?: boolean }} opts
 */
export function buildBank(bankDir, opts) {
  const result = compileBank(bankDir, { previous: opts.previous, previousFile: opts.previousFile });
  if (!result.bundle) return { ...result, manifest: null, files: [] };
  const { bundle, assets, release } = result;
  const version = bundle.bank.version;

  const baseUrl = resolveBaseUrl(opts.baseUrl, bundle.bank.update?.manifest);
  const urlOf = (name) => (baseUrl ? `${baseUrl}/${name}` : name);

  mkdirSync(opts.out, { recursive: true });
  const files = [];

  const bundleName = `bundle-${version}.json`;
  const bundleBytes = Buffer.from(`${opts.pretty ? JSON.stringify(bundle, null, 2) : JSON.stringify(bundle)}\n`, 'utf8');
  writeFileSync(join(opts.out, bundleName), bundleBytes);
  files.push(bundleName);

  let assetsRef;
  if (assets.size > 0) {
    const assetsName = `assets-${version}.zip`;
    // 扁平条目，按文件名排序；图片本身已压缩，writeZip 只在 deflate 更小时才压缩
    const zip = writeZip([...assets].map(([name, data]) => ({ name, data })));
    writeFileSync(join(opts.out, assetsName), zip);
    files.push(assetsName);
    assetsRef = { url: urlOf(assetsName), sha256: sha256Hex(zip), size: zip.length };
  }

  const manifest = {
    bankId: bundle.bank.id,
    schemaVersion: bundle.schemaVersion,
    version,
    publishedAt: normalizePublishedAt(opts.publishedAt),
    ...(release.minAppVersion ? { minAppVersion: release.minAppVersion } : {}),
    bundle: { url: urlOf(bundleName), sha256: sha256Hex(bundleBytes), size: bundleBytes.length },
    ...(assetsRef ? { assets: assetsRef } : {}),
    questions: Object.fromEntries(bundle.questions.map((q) => [q.id, q.contentHash])),
    ...(release.changes ? { changes: release.changes } : {}),
  };
  writeFileSync(join(opts.out, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  files.push('latest.json');

  return { ...result, manifest, files };
}

/** --base-url 优先；否则取 bank.update.manifest 所在目录；都没有时用相对文件名 */
export function resolveBaseUrl(explicit, manifestUrl) {
  if (explicit) return explicit.replace(/\/+$/, '');
  if (manifestUrl) return manifestUrl.slice(0, manifestUrl.lastIndexOf('/'));
  return '';
}

export function normalizePublishedAt(v) {
  const d = v === undefined ? new Date() : new Date(v);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid --published-at: ${v}`);
  // ISO-8601 UTC，精确到秒
  return `${d.toISOString().slice(0, 19)}Z`;
}
