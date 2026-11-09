import { useState } from 'react';
import { useRoute, type RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { BankEditorContent } from './profile/BankEditorModal';
import { LlmSettingsModal } from './profile/LlmSettingsModal';

/**
 * 本地题库编辑页（RootStack 栈页面，参数 bankId）：
 * 正文与未保存守卫在 BankEditorContent；AI 设置仍是单层弹窗，题目编辑 / AI 导入在正文内单层弹出。
 */
export function BankEditorScreen() {
  const { params } = useRoute<RouteProp<RootStackParamList, 'BankEditor'>>();
  const [llmSettingsVisible, setLlmSettingsVisible] = useState(false);
  return (
    <>
      <BankEditorContent bankId={params.bankId} onOpenAiSettings={() => setLlmSettingsVisible(true)} />
      <LlmSettingsModal visible={llmSettingsVisible} onClose={() => setLlmSettingsVisible(false)} />
    </>
  );
}
