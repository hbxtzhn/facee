import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { CheckCircle2, Sparkles } from 'lucide-react-native';
import { useLlmConfigStore, hasUsableLlmConfig } from '../../store/llm-config-store';
import { rewriteQuestion, type GeneratedQuestionDraft } from '../../lib/llm';
import { AppButton } from '../../components/ui';
import { colors, radii, spacing, typography } from '../../theme';
import { FieldLabel, ModalSheet, SheetActions, SheetError } from './ModalSheet';

/** 编辑题目弹窗的表单数据（与 local-banks 的 QuestionDraft 字段一致） */
export interface QuestionFormDraft {
  /** 编辑既有题目时存在 */
  id?: string;
  title: string;
  difficulty: 1 | 2 | 3;
  tags: string[];
  questionMd: string;
  answerMd: string | null;
}

type AiPhase = 'idle' | 'input' | 'comparing';

/** AI 改写用的当前表单快照（生成期间表单不再变化，保证「当前版本」卡稳定） */
interface AiOriginal {
  title: string;
  questionMd: string;
  answerMd: string | null;
}

const DIFFICULTY_OPTIONS: { value: 1 | 2 | 3; label: string }[] = [
  { value: 1, label: '简单' },
  { value: 2, label: '中等' },
  { value: 3, label: '困难' },
];

/** 编辑 / 新建一道本地题目：标题、难度、标签、题干 Markdown、参考答案 Markdown（可选） */
export function QuestionEditModal({
  visible,
  initial,
  onSave,
  onClose,
}: {
  visible: boolean;
  /** null 表示新建 */
  initial: QuestionFormDraft | null;
  onSave: (draft: QuestionFormDraft) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [difficulty, setDifficulty] = useState<1 | 2 | 3>(2);
  const [tagsText, setTagsText] = useState('');
  const [questionMd, setQuestionMd] = useState('');
  const [answerMd, setAnswerMd] = useState('');
  const [error, setError] = useState<string | null>(null);

  // AI 改写：idle（入口按钮）→ input（填改写要求+生成）→ comparing（原版/AI 版二选一）
  const [aiPhase, setAiPhase] = useState<AiPhase>('idle');
  const [aiInstruction, setAiInstruction] = useState('');
  const [aiOriginal, setAiOriginal] = useState<AiOriginal | null>(null);
  const [aiDraft, setAiDraft] = useState<GeneratedQuestionDraft | null>(null);
  const [aiChoice, setAiChoice] = useState<'current' | 'ai'>('ai');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setTitle(initial?.title ?? '');
    setDifficulty(initial?.difficulty ?? 2);
    setTagsText(initial?.tags.join('，') ?? '');
    setQuestionMd(initial?.questionMd ?? '');
    setAnswerMd(initial?.answerMd ?? '');
    setError(null);
    setAiPhase('idle');
    setAiDraft(null);
    setAiOriginal(null);
    setAiInstruction('');
    setAiError(null);
  }, [visible, initial]);

  function handleSave() {
    const trimmedTitle = title.trim();
    const trimmedQuestion = questionMd.trim();
    if (!trimmedTitle) {
      setError('请填写题目标题');
      return;
    }
    if (!trimmedQuestion) {
      setError('请填写题干内容');
      return;
    }
    const tags = tagsText
      .split(/[，,]/)
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
    onSave({
      id: initial?.id,
      title: trimmedTitle,
      difficulty,
      tags,
      questionMd: trimmedQuestion,
      answerMd: answerMd.trim().length > 0 ? answerMd.trim() : null,
    });
  }

  async function handleGenerateAiVersion() {
    if (aiLoading) return;
    const llmConfig = useLlmConfigStore.getState();
    if (!llmConfig.loaded) await llmConfig.load();
    const config = useLlmConfigStore.getState();
    if (!hasUsableLlmConfig(config)) {
      setAiError('还没有配置 AI 服务：请先在「我的 → AI 设置」里填写服务地址、Key 与模型名。');
      return;
    }
    const original: AiOriginal = {
      title: title.trim(),
      questionMd: questionMd.trim(),
      answerMd: answerMd.trim().length > 0 ? answerMd.trim() : null,
    };
    setAiOriginal(original);
    setAiError(null);
    setAiLoading(true);
    try {
      const draft = await rewriteQuestion(
        { baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model },
        { title: original.title, questionMd: original.questionMd, answerMd: original.answerMd },
        { instruction: aiInstruction },
      );
      setAiDraft(draft);
      setAiChoice('ai');
      setAiPhase('comparing');
    } catch (rewriteError) {
      setAiError(rewriteError instanceof Error ? rewriteError.message : String(rewriteError));
    } finally {
      setAiLoading(false);
    }
  }

  function applyAiChoice() {
    if (aiChoice === 'ai' && aiDraft) {
      setTitle(aiDraft.title);
      setQuestionMd(aiDraft.questionMd);
      setAnswerMd(aiDraft.answerMd ?? '');
      setTagsText(aiDraft.tags.join('，'));
      setDifficulty(aiDraft.difficulty);
    }
    // 选「当前版本」= 保持表单不动，仅退出对比
    setAiPhase('idle');
    setAiDraft(null);
    setAiOriginal(null);
    setAiInstruction('');
    setAiError(null);
  }

  return (
    <ModalSheet
      visible={visible}
      title={initial ? '编辑题目' : '新增题目'}
      hint="题干与答案都支持 Markdown（列表、代码块、表格）。参考答案留空则视为无答案题。"
      onClose={onClose}
      footer={
        <SheetActions
          confirmLabel="确定"
          onCancel={onClose}
          onConfirm={handleSave}
          confirmDisabled={!title.trim() || !questionMd.trim()}
        />
      }
    >
      <SheetError message={error} />
      <FieldLabel text="标题" />
      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder="例如：HashMap 的底层实现？"
        placeholderTextColor={colors.textSubtle}
        style={styles.input}
        accessibilityLabel="题目标题"
      />

      {/* AI 改写：对本题生成一份新版本，与原版对比二选一 */}
      <View style={styles.aiSection}>
        {aiPhase === 'idle' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="AI 改写此题"
            disabled={!title.trim() || !questionMd.trim()}
            onPress={() => { setAiPhase('input'); setAiError(null); }}
            style={({ pressed }) => [
              styles.aiEntryButton,
              (!title.trim() || !questionMd.trim()) && styles.aiEntryDisabled,
              pressed && styles.pressed,
            ]}
          >
            <Sparkles size={14} color={colors.primary} strokeWidth={2} />
            <Text style={styles.aiEntryText}>AI 改写此题</Text>
          </Pressable>
        ) : null}

        {aiPhase === 'input' ? (
          <View style={styles.aiBox}>
            <SheetError message={aiError} />
            <Text style={styles.aiBoxLabel}>想怎么改？可留空，AI 会自动优化表述与答案。</Text>
            <TextInput
              value={aiInstruction}
              onChangeText={setAiInstruction}
              placeholder="例如：更贴近真实面试、答案分点、增加追问"
              placeholderTextColor={colors.textSubtle}
              multiline
              maxLength={2000}
              style={[styles.input, styles.aiInstructionInput]}
              accessibilityLabel="AI 改写要求"
            />
            <View style={styles.aiButtonRow}>
              <AppButton
                label="生成 AI 版本"
                icon={Sparkles}
                loading={aiLoading}
                disabled={aiLoading}
                onPress={() => void handleGenerateAiVersion()}
                style={styles.aiGenerateButton}
              />
              <AppButton
                label="收起"
                variant="ghost"
                disabled={aiLoading}
                onPress={() => { setAiPhase('idle'); setAiError(null); }}
                style={styles.aiCancelButton}
              />
            </View>
          </View>
        ) : null}

        {aiPhase === 'comparing' && aiDraft && aiOriginal ? (
          <View style={styles.aiBox}>
            <SheetError message={aiError} />
            <Text style={styles.aiBoxLabel}>选择要保留的版本，确定后还能继续手改再保存。</Text>
            <VersionCard
              label="AI 版本"
              accent
              selected={aiChoice === 'ai'}
              title={aiDraft.title}
              body={`${aiDraft.questionMd}\n\n—— 参考答案 ——\n${aiDraft.answerMd ?? '（无答案）'}`}
              onPress={() => setAiChoice('ai')}
            />
            <VersionCard
              label="当前版本"
              selected={aiChoice === 'current'}
              title={aiOriginal.title}
              body={`${aiOriginal.questionMd}\n\n—— 参考答案 ——\n${aiOriginal.answerMd ?? '（无答案）'}`}
              onPress={() => setAiChoice('current')}
            />
            <SheetActions
              confirmLabel="用所选版本"
              onCancel={() => setAiPhase('idle')}
              onConfirm={applyAiChoice}
            />
          </View>
        ) : null}
      </View>

      <FieldLabel text="难度" />
      <View style={styles.difficultyRow} accessibilityRole="radiogroup">
        {DIFFICULTY_OPTIONS.map((option) => {
          const selected = difficulty === option.value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityLabel={`${option.label}难度`}
              accessibilityState={{ selected }}
              onPress={() => setDifficulty(option.value)}
              style={({ pressed }) => [
                styles.difficultyChip,
                selected && styles.difficultyChipSelected,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.difficultyText, selected && styles.difficultyTextSelected]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <FieldLabel text="标签（用逗号分隔，可留空）" />
      <TextInput
        value={tagsText}
        onChangeText={setTagsText}
        placeholder="Java，集合"
        placeholderTextColor={colors.textSubtle}
        style={styles.input}
        accessibilityLabel="题目标签"
      />
      <FieldLabel text="题干（Markdown）" />
      <TextInput
        value={questionMd}
        onChangeText={setQuestionMd}
        placeholder="题目描述、要求与背景…"
        placeholderTextColor={colors.textSubtle}
        multiline
        style={[styles.input, styles.multiline]}
        accessibilityLabel="题干内容"
      />
      <FieldLabel text="参考答案（Markdown，可留空）" />
      <TextInput
        value={answerMd}
        onChangeText={setAnswerMd}
        placeholder="参考答案、思路与要点…"
        placeholderTextColor={colors.textSubtle}
        multiline
        style={[styles.input, styles.multiline, styles.answerArea]}
        accessibilityLabel="参考答案内容"
      />
    </ModalSheet>
  );
}

/** 对比用的单版本卡片：勾选态 + 标题 + 内容预览（限行数，防长文撑爆弹窗） */
function VersionCard({
  label,
  title,
  body,
  selected,
  accent = false,
  onPress,
}: {
  label: string;
  title: string;
  body: string;
  selected: boolean;
  accent?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={`${label}：${title}`}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.versionCard,
        selected && styles.versionCardSelected,
        accent && selected && styles.versionCardAccent,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.versionHeading}>
        {selected ? (
          <CheckCircle2 size={15} color={colors.primary} strokeWidth={2.2} />
        ) : (
          <View style={styles.versionCircle} />
        )}
        <Text style={[styles.versionLabel, selected && styles.versionLabelSelected]}>{label}</Text>
      </View>
      <Text style={styles.versionTitle} numberOfLines={2}>{title}</Text>
      <Text style={styles.versionBody} numberOfLines={10}>{body}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  aiSection: { marginTop: spacing.sm },
  aiEntryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 40,
    borderRadius: radii.sm,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primaryMuted,
  },
  aiEntryDisabled: { opacity: 0.4 },
  aiEntryText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  aiBox: {
    padding: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  aiBoxLabel: { ...typography.caption, color: colors.textMuted, fontSize: 11, lineHeight: 16, marginBottom: spacing.xs },
  aiInstructionInput: {
    minHeight: 56,
    backgroundColor: colors.surface,
    textAlignVertical: 'top',
    paddingTop: spacing.xs,
  },
  aiButtonRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  aiGenerateButton: { flex: 1 },
  aiCancelButton: { minWidth: 72 },
  versionCard: {
    padding: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  versionCardSelected: { borderColor: colors.primaryMuted },
  versionCardAccent: { backgroundColor: colors.primarySoft },
  versionHeading: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 },
  versionCircle: {
    width: 15,
    height: 15,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
  },
  versionLabel: { ...typography.caption, color: colors.textMuted, fontWeight: '700' },
  versionLabelSelected: { color: colors.primary },
  versionTitle: { ...typography.bodyStrong, color: colors.text, fontSize: 13, lineHeight: 18 },
  versionBody: { ...typography.caption, color: colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 3 },
  input: {    ...typography.body,
    color: colors.text,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
  },
  multiline: {
    minHeight: 96,
    textAlignVertical: 'top',
    paddingTop: spacing.sm,
    lineHeight: 20,
  },
  answerArea: { minHeight: 128 },
  difficultyRow: { flexDirection: 'row', gap: spacing.sm },
  difficultyChip: {
    flex: 1,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  difficultyChipSelected: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primaryMuted,
  },
  difficultyText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  difficultyTextSelected: { color: colors.primary, fontWeight: '700' },
  pressed: { opacity: 0.75 },
});
