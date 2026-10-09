import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import { Platform } from 'react-native';
import type { LlmConfig } from '../lib/llm';

/**
 * LLM 接入配置（OpenAI 兼容端点）。
 *
 * Key 的存储策略（Key 是用户在第三方服务上的凭证，按敏感信息对待）：
 *   - 原生：expo-secure-store（Android Keystore 加密 / iOS Keychain）。
 *     系统自动备份不会带走 Key（Keystore 密钥不可导出，换机后需重新填写），
 *     题库备份 ZIP 也永远不含 Key。
 *   - Web 预览：SecureStore 没有 Web 实现，退化为 AsyncStorage
 *     （仅供浏览器里预览功能，正式使用在 Android）。
 *   - v1 旧数据：整包 JSON 里含明文 Key。首次加载时一次性搬进安全存储，
 *     并把旧包里的 Key 字段删掉。
 */

/** 落 AsyncStorage 的连接配置（不含 Key） */
interface LlmConfigData {
  presetId: string;
  baseUrl: string;
  model: string;
  /** 用户自定义的「抽取要求」提示词；'' = 用 App 内置默认（题目 JSON 格式段始终由 App 固定） */
  extractionPrompt: string;
}

/** v1 旧包结构：整包 JSON 里带明文 apiKey，迁移时读出来搬进安全存储 */
interface LegacyPersisted extends Partial<LlmConfigData> {
  apiKey?: unknown;
}

interface LlmConfigState extends LlmConfigData {
  /** Key 只留内存态 + 安全存储，不落普通 AsyncStorage */
  apiKey: string;
  loaded: boolean;
  load: () => Promise<void>;
  save: (config: LlmConfig & { presetId: string }) => Promise<void>;
  /** 只更新抽取要求，不影响连接配置；AI 设置的 save 也不会覆盖它 */
  saveExtractionPrompt: (prompt: string) => Promise<void>;
}

const STORAGE_KEY = 'facee-llm-config-v1';
const SECURE_API_KEY = 'facee-llm-api-key-v1';
const WEB_API_KEY_KEY = 'facee-llm-api-key-web-v1';

const INITIAL: LlmConfigData = { presetId: 'custom', baseUrl: '', model: '', extractionPrompt: '' };

async function readApiKey(): Promise<string> {
  try {
    if (Platform.OS === 'web') return (await AsyncStorage.getItem(WEB_API_KEY_KEY)) ?? '';
    return (await SecureStore.getItemAsync(SECURE_API_KEY)) ?? '';
  } catch {
    // 安全存储不可用（部分定制 ROM / Expo Go 边界）时按未填写处理
    return '';
  }
}

async function writeApiKey(apiKey: string): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      if (apiKey) await AsyncStorage.setItem(WEB_API_KEY_KEY, apiKey);
      else await AsyncStorage.removeItem(WEB_API_KEY_KEY);
      return;
    }
    if (apiKey) await SecureStore.setItemAsync(SECURE_API_KEY, apiKey);
    else await SecureStore.deleteItemAsync(SECURE_API_KEY);
  } catch {
    throw new Error('API Key 安全存储失败，配置未保存，请检查设备后重试');
  }
}

export const useLlmConfigStore = create<LlmConfigState>((set, get) => ({
  ...INITIAL,
  apiKey: '',
  loaded: false,

  load: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const { config, legacyApiKey } = parsePersisted(raw);
      if (legacyApiKey) {
        // 一次性迁移：v1 明文 Key 搬进安全存储，旧包改写为不含 Key 的版本
        try {
          if (!(await readApiKey())) await writeApiKey(legacyApiKey);
          await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(config));
        } catch {
          // 安全写入失败时保留旧数据，下次启动重试，不能先删除唯一凭据副本。
          set({ ...config, apiKey: legacyApiKey, loaded: true });
          return;
        }
      }
      const apiKey = (await readApiKey()) || legacyApiKey || '';
      set({ ...config, apiKey, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  save: async (config) => {
    const persisted: LlmConfigData = {
      presetId: config.presetId,
      baseUrl: config.baseUrl.trim(),
      model: config.model.trim(),
      extractionPrompt: get().extractionPrompt,
    };
    const apiKey = config.apiKey.trim();
    await writeApiKey(apiKey);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
    set({ ...persisted, apiKey });
  },

  saveExtractionPrompt: async (prompt) => {
    const trimmed = prompt.trim();
    const persisted: LlmConfigData = {
      presetId: get().presetId,
      baseUrl: get().baseUrl,
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

function parsePersisted(raw: string | null): { config: LlmConfigData; legacyApiKey: string | null } {
  if (!raw) return { config: INITIAL, legacyApiKey: null };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { config: INITIAL, legacyApiKey: null };
  }
  if (typeof value !== 'object' || value === null) return { config: INITIAL, legacyApiKey: null };
  const record = value as LegacyPersisted;
  const asString = (input: unknown): string => (typeof input === 'string' ? input : '');
  const legacyKey = asString(record.apiKey).trim();
  return {
    config: {
      presetId: asString(record.presetId) || 'custom',
      baseUrl: asString(record.baseUrl),
      model: asString(record.model),
      extractionPrompt: asString(record.extractionPrompt),
    },
    legacyApiKey: legacyKey || null,
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
