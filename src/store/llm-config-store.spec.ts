import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { useLlmConfigStore } from './llm-config-store';

const STORAGE_KEY = 'facee-llm-config-v1';

// 原生路径用 SecureStore（jest 里用内存 map 模拟）
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    setItemAsync: jest.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    deleteItemAsync: jest.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
    __clear: () => store.clear(),
  };
});

// eslint-disable-next-line import/first
import * as SecureStore from 'expo-secure-store';

const secureStore = SecureStore as unknown as {
  getItemAsync: jest.MockedFunction<(key: string) => Promise<string | null>>;
  setItemAsync: jest.MockedFunction<(key: string, value: string) => Promise<void>>;
  deleteItemAsync: jest.MockedFunction<(key: string) => Promise<void>>;
  __clear: () => void;
};

function resetStore() {
  useLlmConfigStore.setState({
    presetId: 'custom',
    baseUrl: '',
    apiKey: '',
    model: '',
    extractionPrompt: '',
    loaded: false,
  });
}

describe('useLlmConfigStore - Key 存安全存储', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    secureStore.__clear();
    secureStore.getItemAsync.mockClear();
    secureStore.setItemAsync.mockClear();
    secureStore.deleteItemAsync.mockClear();
    resetStore();
  });

  it('save() 把 Key 写进 SecureStore，AsyncStorage 整包不含 Key', async () => {
    await useLlmConfigStore.getState().save({
      presetId: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-secret',
      model: 'deepseek-chat',
    });

    expect(secureStore.setItemAsync).toHaveBeenCalledWith('facee-llm-api-key-v1', 'sk-secret');
    expect(useLlmConfigStore.getState().apiKey).toBe('sk-secret');

    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw ?? '{}') as Record<string, unknown>;
    expect(parsed.apiKey).toBeUndefined();
    expect(parsed.baseUrl).toBe('https://api.deepseek.com/v1');
  });

  it('清空 Key 保存时删除 SecureStore 里的条目', async () => {
    await useLlmConfigStore.getState().save({
      presetId: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-secret',
      model: 'deepseek-chat',
    });
    secureStore.deleteItemAsync.mockClear();

    await useLlmConfigStore.getState().save({
      presetId: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: '',
      model: 'deepseek-chat',
    });

    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith('facee-llm-api-key-v1');
    expect(useLlmConfigStore.getState().apiKey).toBe('');
  });

  it('load() 从安全存储回填 Key', async () => {
    await secureStore.setItemAsync('facee-llm-api-key-v1', 'sk-stored');
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ presetId: 'zhipu', baseUrl: 'https://x', model: 'm' }),
    );

    await useLlmConfigStore.getState().load();

    const state = useLlmConfigStore.getState();
    expect(state.apiKey).toBe('sk-stored');
    expect(state.baseUrl).toBe('https://x');
    expect(state.loaded).toBe(true);
  });

  it('v1 旧数据迁移：整包里的明文 Key 搬进 SecureStore，旧包改写为不含 Key', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ presetId: 'zhipu', baseUrl: 'https://x', apiKey: 'k-legacy', model: 'm' }),
    );

    await useLlmConfigStore.getState().load();

    expect(useLlmConfigStore.getState().apiKey).toBe('k-legacy');
    expect(secureStore.setItemAsync).toHaveBeenCalledWith('facee-llm-api-key-v1', 'k-legacy');
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw ?? '{}') as Record<string, unknown>;
    expect(parsed.apiKey).toBeUndefined();
    expect(parsed.presetId).toBe('zhipu');
  });

  it('已迁过一次后再次 load 不会重复搬运', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ presetId: 'zhipu', baseUrl: 'https://x', apiKey: 'k-legacy', model: 'm' }),
    );
    await useLlmConfigStore.getState().load();
    secureStore.setItemAsync.mockClear();

    await useLlmConfigStore.getState().load();

    expect(secureStore.setItemAsync).not.toHaveBeenCalled();
    expect(useLlmConfigStore.getState().apiKey).toBe('k-legacy');
  });

  it('saveExtractionPrompt 只更新抽取要求，不碰连接配置与 Key', async () => {
    useLlmConfigStore.setState({
      presetId: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-1',
      model: 'deepseek-chat',
    });
    secureStore.setItemAsync.mockClear();

    await useLlmConfigStore.getState().saveExtractionPrompt('多抽基础题');

    const state = useLlmConfigStore.getState();
    expect(state.extractionPrompt).toBe('多抽基础题');
    expect(state.baseUrl).toBe('https://api.deepseek.com/v1');
    expect(state.apiKey).toBe('sk-1');
    expect(secureStore.setItemAsync).not.toHaveBeenCalled();

    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw ?? '{}') as Record<string, unknown>;
    expect(parsed.extractionPrompt).toBe('多抽基础题');
    expect(parsed.model).toBe('deepseek-chat');
  });

  it('AI 设置的 save() 不丢已存的抽取要求', async () => {
    useLlmConfigStore.setState({ extractionPrompt: '已有要求' });

    await useLlmConfigStore.getState().save({
      presetId: 'moonshot',
      baseUrl: 'https://api.moonshot.cn/v1',
      apiKey: 'sk-2',
      model: 'moonshot-v1-8k',
    });

    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw ?? '{}') as Record<string, unknown>;
    expect(parsed.extractionPrompt).toBe('已有要求');
    expect(parsed.model).toBe('moonshot-v1-8k');
  });

  it('安全存储不可用时降级为空串，不阻塞加载', async () => {
    secureStore.getItemAsync.mockRejectedValueOnce(new Error('keystore 坏了'));
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ presetId: 'zhipu', baseUrl: 'https://x', model: 'm' }),
    );

    await useLlmConfigStore.getState().load();

    expect(useLlmConfigStore.getState().apiKey).toBe('');
    expect(useLlmConfigStore.getState().loaded).toBe(true);
  });
});

describe('useLlmConfigStore - Web 预览回退', () => {
  const original = Platform.OS;

  beforeEach(async () => {
    await AsyncStorage.clear();
    resetStore();
    secureStore.getItemAsync.mockClear();
    secureStore.setItemAsync.mockClear();
  });

  afterEach(() => {
    (Platform as unknown as { OS: string }).OS = original;
  });

  it('Web 上没有 SecureStore，Key 退化存 AsyncStorage', async () => {
    (Platform as unknown as { OS: string }).OS = 'web';

    await useLlmConfigStore.getState().save({
      presetId: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-web',
      model: 'deepseek-chat',
    });
    expect(secureStore.setItemAsync).not.toHaveBeenCalled();

    resetStore();
    await useLlmConfigStore.getState().load();
    expect(useLlmConfigStore.getState().apiKey).toBe('sk-web');
  });
});
