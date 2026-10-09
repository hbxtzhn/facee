import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ListRestart } from 'lucide-react-native';
import { useLlmConfigStore } from '../../store/llm-config-store';
import { fetchModelIds, LLM_PRESETS } from '../../lib/llm';
import { colors, radii, spacing, typography } from '../../theme';
import { FieldLabel, ModalSheet, SheetActions, SheetError } from './ModalSheet';

/** 模型候选列表最多展示的个数（超出时提示可直接手填） */
const MAX_MODEL_CHIPS = 24;

/**
 * AI 设置弹窗：配置 OpenAI 兼容的服务地址 / Key / 模型名。
 * 预设一键填充（DeepSeek / 智谱 / Kimi）；可用 Key 拉取 /models 模型列表点选；
 * Key 只存本机。
 */
export function LlmSettingsModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const load = useLlmConfigStore((state) => state.load);
  const save = useLlmConfigStore((state) => state.save);
  const [presetId, setPresetId] = useState('custom');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    void load().then(() => {
      const state = useLlmConfigStore.getState();
      setPresetId(state.presetId);
      setBaseUrl(state.baseUrl);
      setApiKey(state.apiKey);
      setModel(state.model);
    });
  }, [visible, load]);

  function applyPreset(id: string) {
    setPresetId(id);
    setModelOptions([]);
    const preset = LLM_PRESETS.find((candidate) => candidate.id === id);
    if (preset && preset.baseUrl) {
      setBaseUrl(preset.baseUrl);
      setModel(preset.model);
    }
  }

  async function handleFetchModels() {
    if (fetchingModels) return;
    setError(null);
    setFetchingModels(true);
    try {
      const ids = await fetchModelIds({ baseUrl, apiKey, model });
      setModelOptions(ids);
      if (ids.length > MAX_MODEL_CHIPS) {
        setError(null);
      }
    } catch (fetchError) {
      setModelOptions([]);
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      setFetchingModels(false);
    }
  }

  async function handleSave() {
    const trimmedBaseUrl = baseUrl.trim();
    if (trimmedBaseUrl && !/^https?:\/\//.test(trimmedBaseUrl)) {
      setError('服务地址必须以 http(s):// 开头');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await save({ presetId, baseUrl: trimmedBaseUrl, apiKey, model });
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalSheet
      visible={visible}
      title="AI 设置"
      hint="用于 AI 导入与改写，调用你自己的模型服务（OpenAI 兼容协议）。图片导入需选择支持视觉输入的模型；默认文本模型不一定支持。Key 保存在本机系统加密存储（Android Keystore）中，不会进入系统备份与题库备份。"
      onClose={onClose}
      footer={
        <SheetActions
          confirmLabel={saving ? '正在保存' : '保存'}
          confirmLoading={saving}
          onCancel={onClose}
          onConfirm={() => void handleSave()}
        />
      }
    >
      <SheetError message={error} />
      <FieldLabel text="服务商预设" />
      <View style={styles.presetRow}>
        {LLM_PRESETS.map((preset) => {
          const selected = presetId === preset.id;
          return (
            <Pressable
              key={preset.id}
              accessibilityRole="radio"
              accessibilityLabel={preset.label}
              accessibilityState={{ selected }}
              onPress={() => applyPreset(preset.id)}
              style={({ pressed }) => [
                styles.presetChip,
                selected && styles.presetChipSelected,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.presetText, selected && styles.presetTextSelected]}>{preset.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <FieldLabel text="服务地址（不含 /chat/completions）" />
      <TextInput
        value={baseUrl}
        onChangeText={(value) => {
          setBaseUrl(value);
          setModelOptions([]);
        }}
        placeholder="https://api.deepseek.com/v1"
        placeholderTextColor={colors.textSubtle}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        style={styles.input}
        accessibilityLabel="AI 服务地址"
      />
      {/^http:\/\//i.test(baseUrl.trim()) ? (
        <Text style={styles.insecureWarning}>
          当前是 http:// 明文地址：API Key 和待抽取文本会以未加密方式发送，能被同网络设备看到。请尽量使用 https://。
        </Text>
      ) : null}
      <FieldLabel text="API Key" />
      <TextInput
        value={apiKey}
        onChangeText={(value) => {
          setApiKey(value);
          setModelOptions([]);
        }}
        placeholder="sk-…"
        placeholderTextColor={colors.textSubtle}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        style={styles.input}
        accessibilityLabel="AI API Key"
      />
      <FieldLabel text="模型名" />
      <View style={styles.modelRow}>
        <TextInput
          value={model}
          onChangeText={setModel}
          placeholder="deepseek-chat"
          placeholderTextColor={colors.textSubtle}
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.input, styles.modelInput]}
          accessibilityLabel="AI 模型名"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="获取模型列表"
          accessibilityHint="用当前 Key 拉取该服务可用的模型"
          disabled={fetchingModels || !baseUrl.trim() || !apiKey.trim()}
          onPress={() => void handleFetchModels()}
          style={({ pressed }) => [
            styles.fetchModelsButton,
            (!baseUrl.trim() || !apiKey.trim()) && styles.fetchModelsButtonDisabled,
            pressed && styles.pressed,
          ]}
        >
          <ListRestart size={14} color={colors.primary} strokeWidth={2} />
          <Text style={styles.fetchModelsText}>{fetchingModels ? '获取中' : '拉列表'}</Text>
        </Pressable>
      </View>
      {modelOptions.length > 0 ? (
        <View style={styles.modelOptionsBox}>
          <Text style={styles.modelOptionsHint}>
            可用模型 {modelOptions.length} 个{modelOptions.length > MAX_MODEL_CHIPS ? '，仅展示前 24 个，也可直接手填' : '，点选即用'}
          </Text>
          <View style={styles.presetRow}>
            {modelOptions.slice(0, MAX_MODEL_CHIPS).map((id) => {
              const selected = model.trim() === id;
              return (
                <Pressable
                  key={id}
                  accessibilityRole="radio"
                  accessibilityLabel={`模型 ${id}`}
                  accessibilityState={{ selected }}
                  onPress={() => setModel(id)}
                  style={({ pressed }) => [
                    styles.presetChip,
                    selected && styles.presetChipSelected,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.presetText, selected && styles.presetTextSelected]} numberOfLines={1}>
                    {id}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  presetChip: {
    minHeight: 34,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  presetChipSelected: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primaryMuted,
  },
  presetText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  presetTextSelected: { color: colors.primary, fontWeight: '700' },
  modelRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  modelInput: { flex: 1 },
  fetchModelsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primaryMuted,
  },
  fetchModelsButtonDisabled: { opacity: 0.4 },
  fetchModelsText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  modelOptionsBox: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  modelOptionsHint: { ...typography.caption, color: colors.textMuted, fontSize: 11, marginBottom: spacing.xs },
  insecureWarning: {
    ...typography.caption,
    color: colors.danger,
    marginTop: spacing.xs,
  },
  input: {
    ...typography.body,
    color: colors.text,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pressed: { opacity: 0.75 },
});
