import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * 从文本导入弹窗冒烟：抽取要求输入框预填默认值、可编辑并出现「恢复默认」、
 * 上次保存的自定义要求在再次打开时回填。
 */

const mockPick = jest.fn();
jest.mock('expo-document-picker', () => ({ getDocumentAsync: (...args: unknown[]) => mockPick(...args) }));

// eslint-disable-next-line import/first
import { ImportTextModal } from './ImportTextModal';
// eslint-disable-next-line import/first
import { useLlmConfigStore } from '../../store/llm-config-store';
// eslint-disable-next-line import/first
import { DEFAULT_EXTRACTION_REQUIREMENTS } from '../../lib/llm';

const STORAGE_KEY = 'facee-llm-config-v1';

function renderModal() {
  return render(
    <ImportTextModal visible onClose={() => undefined} onConfirm={() => undefined} onOpenAiSettings={() => undefined} />,
  );
}

describe('ImportTextModal 抽取要求（prompt 开放、格式写死）', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    useLlmConfigStore.setState({
      presetId: 'custom',
      baseUrl: '',
      apiKey: '',
      model: '',
      extractionPrompt: '',
      loaded: false,
    });
  });

  it('默认预填内置抽取要求，未修改时不显示恢复默认', async () => {
    const view = await renderModal();
    await waitFor(() => expect(useLlmConfigStore.getState().loaded).toBe(true));

    const input = view.getByLabelText('抽取要求提示词');
    expect(input.props.value).toBe(DEFAULT_EXTRACTION_REQUIREMENTS);
    expect(view.queryByLabelText('恢复默认抽取要求')).toBeNull();
  });

  it('修改后出现「恢复默认」，点击还原为默认文案', async () => {
    const view = await renderModal();
    // 清空挂起的微任务，确保打开时的回填 effect 已跑完，不会把下面输入的内容冲回默认值
    await act(async () => {});

    // 本环境下 changeText / press 后的重渲染需要 act 包裹才会提交
    await act(async () => {
      fireEvent.changeText(view.getByLabelText('抽取要求提示词'), '只要网络相关的题，答案分点');
    });
    expect(view.getByLabelText('恢复默认抽取要求')).toBeTruthy();

    await act(async () => {
      fireEvent.press(view.getByLabelText('恢复默认抽取要求'));
    });
    expect(view.getByLabelText('抽取要求提示词').props.value).toBe(DEFAULT_EXTRACTION_REQUIREMENTS);
    expect(view.queryByLabelText('恢复默认抽取要求')).toBeNull();
  });

  it('已保存的自定义要求在弹窗打开时回填', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ presetId: 'custom', baseUrl: '', apiKey: '', model: '', extractionPrompt: '上次的自定义要求' }),
    );

    const view = await renderModal();
    await waitFor(() => expect(view.getByLabelText('抽取要求提示词').props.value).toBe('上次的自定义要求'));
    expect(view.getByLabelText('恢复默认抽取要求')).toBeTruthy();
  });
});
