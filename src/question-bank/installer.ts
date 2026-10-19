import { asRemoteQuestionBankRepository } from './client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  listLocalBankSources,
  loadLocalBankSource,
  saveLocalBankSource,
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
  // 下载即本地化。同 URL 已装过本地库 → 视为更新：沿用原 catalog.id，
  // install 原子替换旧库；首次下载生成新 local- id。
  const reuseCatalogId = await findLocalBankIdBySourceUrl(url);
  return remote.installFromUrl(url, onProgress, {
    ...(reuseCatalogId ? { reuseCatalogId } : {}),
    beforeCommit: (bank) => saveLocalBankSource({
      bankId: bank.catalog.id, updatedAt: '', package: bank, sourceUrl: url,
    }),
  });
}

/** 找出由同一 URL 下载过的本地题库 id（更新语义）；没有则 null */
async function findLocalBankIdBySourceUrl(url: string): Promise<string | null> {
  const summaries = await listLocalBankSources();
  for (const summary of summaries) {
    try {
      const source = await loadLocalBankSource(summary.bankId);
      if (source?.sourceUrl === url) return source.bankId;
    } catch {
      // 单个源读取失败不影响查找
    }
  }
  return null;
}
