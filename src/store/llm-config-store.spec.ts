import { describe, it, expect, beforeEach } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLlmConfigStore } from './llm-config-store';

const STORAGE_KEY = 'facee-llm-config-v1';

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

describe('useLlmConfigStore - 抽取要求持久化', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    resetStore();
  });

  it('saveExtractionPrompt 只更新抽取要求，不碰连接配置', async () => {
    useLlmConfigStore.setState({
      presetId: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-1',
      model: 'deepseek-chat',
    });

    await useLlmConfigStore.getState().saveExtractionPrompt('多抽基础题');

    const state = useLlmConfigStore.getState();
    expect(state.extractionPrompt).toBe('多抽基础题');
    expect(state.baseUrl).toBe('https://api.deepseek.com/v1');
    expect(state.apiKey).toBe('sk-1');

    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw ?? '{}') as Record<string, unknown>;
    expect(parsed.extractionPrompt).toBe('多抽基础题');
    expect(parsed.model).toBe('deepseek-chat');
  });

  it('load 回填已保存的抽取要求；旧版本数据没有该字段时为空串', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ presetId: 'zhipu', baseUrl: 'https://x', apiKey: 'k', model: 'm', extractionPrompt: '自定义要求' }),
    );
    await useLlmConfigStore.getState().load();
    expect(useLlmConfigStore.getState().extractionPrompt).toBe('自定义要求');

    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ presetId: 'zhipu', baseUrl: 'https://x', apiKey: 'k', model: 'm' }),
    );
    resetStore();
    await useLlmConfigStore.getState().load();
    expect(useLlmConfigStore.getState().extractionPrompt).toBe('');
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
});
