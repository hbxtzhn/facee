import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import type { LlmConfig } from '../lib/llm';

/**
 * LLM 接入配置（OpenAI 兼容端点）。Key 只存本机 AsyncStorage，
 * 仅供「从文本导入题目」功能调用用户自己的模型服务。
 */

interface LlmConfigData {
  presetId: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 用户自定义的「抽取要求」提示词；'' = 用 App 内置默认（题目 JSON 格式段始终由 App 固定） */
  extractionPrompt: string;
}

interface LlmConfigState extends LlmConfigData {
  loaded: boolean;
  load: () => Promise<void>;
  save: (config: LlmConfig & { presetId: string }) => Promise<void>;
  /** 只更新抽取要求，不影响连接配置；AI 设置的 save 也不会覆盖它 */
  saveExtractionPrompt: (prompt: string) => Promise<void>;
}

const STORAGE_KEY = 'facee-llm-config-v1';

const INITIAL: LlmConfigData = { presetId: 'custom', baseUrl: '', apiKey: '', model: '', extractionPrompt: '' };

export const useLlmConfigStore = create<LlmConfigState>((set, get) => ({
  ...INITIAL,
  loaded: false,

  load: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) {
        set({ loaded: true });
        return;
      }
      const parsed = parsePersisted(raw);
      set({ ...parsed, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  save: async (config) => {
    const persisted: LlmConfigData = {
      presetId: config.presetId,
      baseUrl: config.baseUrl.trim(),
      apiKey: config.apiKey.trim(),
      model: config.model.trim(),
      extractionPrompt: get().extractionPrompt,
    };
    set(persisted);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
    } catch {
      // 存储失败只影响下次启动时的回填，本会话内存态仍可用
    }
  },

  saveExtractionPrompt: async (prompt) => {
    const trimmed = prompt.trim();
    const persisted: LlmConfigData = {
      presetId: get().presetId,
      baseUrl: get().baseUrl,
      apiKey: get().apiKey,
      model: get().model,
      extractionPrompt: trimmed,
    };
    set({ extractionPrompt: trimmed });
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
    } catch {
      // 存储失败只影响下次启动时的回填，本会话内存态仍可用
    }
  },
}));

function parsePersisted(raw: string): LlmConfigData {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return INITIAL;
  }
  if (typeof value !== 'object' || value === null) return INITIAL;
  const record = value as Record<string, unknown>;
  const asString = (input: unknown): string => (typeof input === 'string' ? input : '');
  return {
    presetId: asString(record.presetId) || 'custom',
    baseUrl: asString(record.baseUrl),
    apiKey: asString(record.apiKey),
    model: asString(record.model),
    extractionPrompt: asString(record.extractionPrompt),
  };
}

/** 当前配置是否足以发起 LLM 调用 */
export function hasUsableLlmConfig(config: LlmConfig): boolean {
  return (
    /^https?:\/\//.test(config.baseUrl.trim()) &&
    config.apiKey.trim().length > 0 &&
    config.model.trim().length > 0
  );
}
