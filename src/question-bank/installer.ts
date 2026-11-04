import { asRemoteQuestionBankRepository } from './client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  listLocalBankSources,
  saveLocalBankSource,
  type LocalBankSourceSummary,
} from './local-banks';
import type {
  InstallationProgressListener,
  InstallResult,
  QuestionBankRepository,
} from './types';

export type QuestionBankInstallMode = 'unconfigured' | 'remote';
export const QUESTION_BANK_SOURCE_URL_KEY = 'facee-question-bank-source-url-v1';

/** Expo inlines EXPO_PUBLIC_* values at bundle time. Empty values are ignored. */
export function getConfiguredQuestionBankUrl(): string | null {
  const configured = process.env.EXPO_PUBLIC_QUESTION_BANK_URL?.trim();
  return configured ? configured : null;
}

/** User-entered URL overrides the build-time default and survives restarts. */
export async function getSavedQuestionBankUrl(): Promise<string | null> {
  try {
    const value = (await AsyncStorage.getItem(QUESTION_BANK_SOURCE_URL_KEY))?.trim();
    return value || null;
  } catch {
    return null;
  }
}

export async function saveQuestionBankUrl(value: string): Promise<string | null> {
  const normalized = value.trim();
  if (normalized) await AsyncStorage.setItem(QUESTION_BANK_SOURCE_URL_KEY, normalized);
  else await AsyncStorage.removeItem(QUESTION_BANK_SOURCE_URL_KEY);
  return normalized || null;
}

export function getQuestionBankInstallMode(
  repository: QuestionBankRepository,
  url = getConfiguredQuestionBankUrl(),
): QuestionBankInstallMode {
  return url && asRemoteQuestionBankRepository(repository)
    ? 'remote'
    : 'unconfigured';
}

export async function installConfiguredQuestionBank(
  repository: QuestionBankRepository,
  onProgress?: InstallationProgressListener,
  url = getConfiguredQuestionBankUrl(),
): Promise<InstallResult> {
  const remote = asRemoteQuestionBankRepository(repository);
  if (!url) {
    throw new Error('未配置线上题库地址（EXPO_PUBLIC_QUESTION_BANK_URL）');
  }
  if (!remote) {
    throw new Error('当前平台暂不支持安装线上 ZIP 题库');
  }
  // 下载的是线上题库（只能在线更新，编辑须先复制）。同 URL 已装过的线上题库 → 视为更新：
  // 沿用原 catalog.id，install 原子替换旧库；首次下载生成新 local- 存储 id。
  const reuseCatalogId = await findLocalBankIdBySourceUrl(url);
  return remote.installFromUrl(url, onProgress, {
    ...(reuseCatalogId ? { reuseCatalogId } : {}),
    beforeCommit: (bank, meta) => saveLocalBankSource({
      bankId: bank.catalog.id, updatedAt: '', package: bank, sourceUrl: url,
      ...(meta?.fingerprint ? { remoteFingerprint: meta.fingerprint } : {}),
    }),
  });
}

/**
 * 找出由同一 URL 下载、且未在本机修改过的题库 id（更新语义）；没有则 null。
 * 旧模型下改过的库不复用：否则整包替换会静默丢掉修改——此时按新题库安装，旧库原样保留。
 * 摘要已带 sourceUrl/locallyModified，不再逐个整读源文件。
 */
async function findLocalBankIdBySourceUrl(url: string): Promise<string | null> {
  const match = findSourceSummaryByUrl(await listLocalBankSources(), url);
  return match && !match.locallyModified ? match.bankId : null;
}

/**
 * 在本地源摘要中按下载地址查找（地址两端空白忽略）；同地址多个时优先未修改的那个
 * ——它就是重新添加该地址时会被原地更新的题库。
 */
export function findSourceSummaryByUrl(
  summaries: readonly LocalBankSourceSummary[],
  url: string,
): LocalBankSourceSummary | null {
  const target = url.trim();
  if (!target) return null;
  const matches = summaries.filter((summary) => summary.sourceUrl?.trim() === target);
  return matches.find((summary) => !summary.locallyModified) ?? matches[0] ?? null;
}
