import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { CheckCircle2, Sparkles } from 'lucide-react-native';
import { useBankStore, type KeyPointWeight, type Question } from '../../bank';
import { useLlmConfigStore, hasUsableLlmConfig } from '../../store/llm-config-store';
import { rewriteQuestion, type GeneratedQuestionDraft } from '../../lib/llm';
import { AppButton } from '../../components/ui';
import { colors, radii, spacing, typography } from '../../theme';
import { FieldLabel, ModalSheet, SheetActions, SheetError } from './ModalSheet';
import { TextAction } from './components/list';
import { countSpecChars } from './bank-helpers';
import {
  DIFFICULTY_LABEL,
  IMPORTANCE_LABEL,
  KEY_POINT_LIMIT,
  MAX_KEY_POINTS,
  QUESTION_TYPES,
  QUESTION_TYPE_LABEL,
  SUMMARY_LIMIT,
  WEIGHT_LABEL,
  emptyForm,
  formFromQuestion,
  formKey,
  formToInput,
  mapStoreDetails,
  moveItem,
  optionId,
  validateForm,
  type FormErrors,
  type QuestionForm,
} from './question-form';

type AiPhase = 'idle' | 'input' | 'comparing';

const WEIGHTS: KeyPointWeight[] = [1, 2, 3];

/**
 * 新建 / 编辑本地题库的一道题（v2 结构）：标题、题型（含选择题选项）、难度、重要度、分类、标签、
 * 题目补充、一句话（≤ 80 字）、3–5 条带权重的要点（可增删、排序；id 由数据层分配，不展示）、
 * 详解、示例、易错点、追问、参考资料、适用版本。
 * 保存直接写入数据层；客户端规则与 store 整库校验的结果都就近显示在字段下方。
 */
export function QuestionEditModal({
  visible,
  bankId,
  initial,
  categories,
  tags,
  onSaved,
  onClose,
}: {
  visible: boolean;
  bankId: string;
  /** null 表示新建 */
  initial: Question | null;
  categories: Array<{ id: string; name: string }>;
  tags: Array<{ id: string; name: string }>;
  onSaved: (question: Question) => void;
  onClose: () => void;
}) {
  const baseline = useMemo(
    () => (initial ? formFromQuestion(initial) : emptyForm(categories[0]?.id ?? '')),
    // 只在打开 / 切换题目时重建基线；categories 变化不应重置正在编辑的表单
    [initial, visible],
  );
  const [form, setForm] = useState<QuestionForm>(baseline);
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // AI 改写：idle（入口按钮）→ input（填改写要求+生成）→ comparing（原版/AI 版二选一）
  const [aiPhase, setAiPhase] = useState<AiPhase>('idle');
  const [aiInstruction, setAiInstruction] = useState('');
  const [aiDraft, setAiDraft] = useState<GeneratedQuestionDraft | null>(null);
  const [aiChoice, setAiChoice] = useState<'current' | 'ai'>('ai');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setForm(baseline);
    setErrors({});
    setSaving(false);
    setConfirmDiscard(false);
    setAiPhase('idle');
    setAiDraft(null);
    setAiInstruction('');
    setAiError(null);
  }, [visible, baseline]);

  const dirty = JSON.stringify(stripKeys(form)) !== JSON.stringify(stripKeys(baseline)) || aiDraft !== null;
  const locked = saving || aiLoading;

  function update(patch: Partial<QuestionForm>) {
    setForm((current) => ({ ...current, ...patch }));
  }

  function requestClose() {
    if (locked) return;
    if (dirty) setConfirmDiscard(true);
    else onClose();
  }

  async function handleSave() {
    if (locked) return;
    const clientErrors = validateForm(form);
    if (Object.keys(clientErrors).length > 0) {
      setErrors({ ...clientErrors, general: '请先修正标出的问题' });
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const input = formToInput(form, initial);
      const store = useBankStore.getState();
      const result = initial
        ? await store.updateLocalQuestion(bankId, initial.id, input)
        : await store.addLocalQuestion(bankId, input);
      if (result.ok) {
        onSaved(result.value);
        return;
      }
      setErrors(result.error.code === 'invalid'
        ? mapStoreDetails(result.error.details, result.error.message)
        : { general: result.error.message });
    } finally {
      setSaving(false);
    }
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
    setAiError(null);
    setAiLoading(true);
    try {
      const draft = await rewriteQuestion(
        { baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model },
        {
          title: form.title.trim(),
          prompt: form.prompt.trim() || null,
          summary: form.summary.trim(),
          keyPoints: form.keyPoints.filter((kp) => kp.text.trim()).map((kp) => ({ text: kp.text.trim(), weight: kp.weight })),
          detail: form.detail.trim() || null,
          pitfalls: form.pitfalls.split('\n').map((p) => p.trim()).filter(Boolean),
          followups: form.followups.filter((f) => f.q.trim() && f.a.trim()).map((f) => ({ q: f.q.trim(), a: f.a.trim() })),
        },
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
      // AI 版要点 / 追问视为新条目（不沿用旧 id，避免把旧自评挂到含义不同的要点上）
      update({
        title: aiDraft.title,
        type: form.type === 'choice' ? 'choice' : aiDraft.type,
        difficulty: aiDraft.difficulty,
        prompt: aiDraft.prompt ?? '',
        summary: aiDraft.summary,
        keyPoints: aiDraft.keyPoints.map((kp) => ({ key: formKey(), text: kp.text, weight: kp.weight })),
        detail: aiDraft.detail ?? '',
        pitfalls: aiDraft.pitfalls.join('\n'),
        followups: aiDraft.followups.map((f) => ({ key: formKey(), q: f.q, a: f.a })),
      });
    }
    setAiPhase('idle');
    setAiDraft(null);
    setAiInstruction('');
    setAiError(null);
  }

  const summaryCount = countSpecChars(form.summary.trim());
  const filledKeyPoints = form.keyPoints.filter((kp) => kp.text.trim()).length;

  return (
    <ModalSheet
      visible={visible}
      title={initial ? '编辑题目' : '新增题目'}
      hint="一句话 ≤ 80 字、要点 3–5 条（每条 ≤ 40 字）为必填；补充、详解、示例、追问答案支持 Markdown。"
      onClose={requestClose}
      dismissDisabled={locked}
      footer={
        <SheetActions
          confirmLabel={saving ? '正在保存' : '保存题目'}
          confirmLoading={saving}
          onCancel={requestClose}
          cancelDisabled={locked}
          onConfirm={() => void handleSave()}
          confirmDisabled={locked || !form.title.trim()}
        />
      }
    >
      <SheetError message={errors.general ?? null} />
      {confirmDiscard ? (
        <View style={styles.discard} accessibilityRole="alert">
          <Text style={styles.discardText}>有未保存的修改，离开后将丢失。</Text>
          <AppButton label="继续编辑" onPress={() => setConfirmDiscard(false)} />
          <AppButton label="放弃修改并离开" variant="ghost" onPress={() => { if (!locked) onClose(); }} />
        </View>
      ) : null}

      <FieldLabel text="标题" />
      <TextInput
        value={form.title}
        onChangeText={(title) => update({ title })}
        placeholder="例如：Redis 过期 key 的删除策略有哪些？"
        placeholderTextColor={colors.textSubtle}
        style={styles.input}
        accessibilityLabel="题目标题"
      />
      <FieldError message={errors.title} />

      {/* AI 改写：对本题生成一份新版本，与当前版本对比二选一 */}
      <View style={styles.aiSection}>
        {aiPhase === 'idle' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="AI 改写此题"
            disabled={!form.title.trim() || locked}
            onPress={() => { setAiPhase('input'); setAiError(null); }}
            style={({ pressed }) => [styles.aiEntryButton, !form.title.trim() && styles.disabled, pressed && styles.pressed]}
          >
            <Sparkles size={18} color={colors.textSecondary} strokeWidth={1.6} />
            <Text style={styles.aiEntryText}>AI 改写此题</Text>
          </Pressable>
        ) : null}
        {aiPhase === 'input' ? (
          <View style={styles.aiBox}>
            <SheetError message={aiError} />
            <Text style={styles.hintText}>想怎么改？可留空，AI 会按规范优化一句话、要点与详解。</Text>
            <TextInput
              value={aiInstruction}
              onChangeText={setAiInstruction}
              placeholder="例如：更贴近真实面试、要点更有区分度"
              placeholderTextColor={colors.textSubtle}
              multiline
              maxLength={2000}
              style={[styles.input, styles.shortMultiline]}
              accessibilityLabel="AI 改写要求"
            />
            <View style={styles.row}>
              <AppButton label="生成 AI 版本" icon={Sparkles} loading={aiLoading} disabled={aiLoading}
                onPress={() => void handleGenerateAiVersion()} style={styles.flex} />
              <AppButton label="收起" variant="ghost" disabled={aiLoading}
                onPress={() => { setAiPhase('idle'); setAiError(null); }} />
            </View>
          </View>
        ) : null}
        {aiPhase === 'comparing' && aiDraft ? (
          <View style={styles.aiBox}>
            <Text style={styles.hintText}>选择要保留的版本，确定后还能继续手改再保存。</Text>
            <VersionCard
              label="AI 版本"
              selected={aiChoice === 'ai'}
              title={aiDraft.title}
              body={`${aiDraft.summary}\n${aiDraft.keyPoints.map((kp) => `· ${kp.text}`).join('\n')}${aiDraft.notes.length ? `\n（${aiDraft.notes.join('；')}）` : ''}`}
              onPress={() => setAiChoice('ai')}
            />
            <VersionCard
              label="当前版本"
              selected={aiChoice === 'current'}
              title={form.title}
              body={`${form.summary}\n${form.keyPoints.filter((kp) => kp.text.trim()).map((kp) => `· ${kp.text}`).join('\n')}`}
              onPress={() => setAiChoice('current')}
            />
            <SheetActions confirmLabel="用所选版本" onCancel={() => { setAiPhase('idle'); setAiDraft(null); }} onConfirm={applyAiChoice} />
          </View>
        ) : null}
      </View>

      <FieldLabel text="题型" />
      <ChoiceRow
        options={QUESTION_TYPES.map((type) => ({ value: type, label: QUESTION_TYPE_LABEL[type] }))}
        value={form.type}
        onChange={(type) => update({ type })}
        labelSuffix="题型"
      />
      <FieldLabel text="难度" />
      <ChoiceRow
        options={(['easy', 'medium', 'hard'] as const).map((d) => ({ value: d, label: DIFFICULTY_LABEL[d] }))}
        value={form.difficulty}
        onChange={(difficulty) => update({ difficulty })}
        labelSuffix="难度"
      />
      <FieldLabel text="重要度" />
      <ChoiceRow
        options={([1, 2, 3] as const).map((i) => ({ value: i, label: IMPORTANCE_LABEL[i] }))}
        value={form.importance}
        onChange={(importance) => update({ importance })}
        labelSuffix="重要度"
      />
      <FieldLabel text="分类" />
      <ChoiceRow
        options={categories.map((c) => ({ value: c.id, label: c.name }))}
        value={form.categoryId}
        onChange={(categoryId) => update({ categoryId })}
        labelSuffix="分类"
      />
      <FieldError message={errors.categoryId} />
      <FieldLabel text="标签（可多选）" />
      {tags.length === 0 ? <Text style={styles.hintText}>这个题库还没有标签，可在编辑页「标签」里添加。</Text> : (
        <View style={styles.wrapRow}>
          {tags.map((tag) => {
            const selected = form.tags.includes(tag.id);
            return (
              <Chip key={tag.id} label={tag.name} selected={selected} accessibilityLabel={`标签 ${tag.name}`}
                onPress={() => update({ tags: selected ? form.tags.filter((t) => t !== tag.id) : [...form.tags, tag.id] })} />
            );
          })}
        </View>
      )}
      <FieldError message={errors.tags} />

      {form.type === 'choice' ? (
        <>
          <FieldLabel text="选项（点「正确」标记答案，可多选）" />
          {form.options.map((option, index) => (
            <View key={option.key} style={styles.listItem}>
              <Text style={styles.optionId}>{optionId(index).toUpperCase()}</Text>
              <TextInput
                value={option.text}
                onChangeText={(value) => update({ options: form.options.map((o) => (o.key === option.key ? { ...o, text: value } : o)) })}
                placeholder="选项内容"
                placeholderTextColor={colors.textSubtle}
                style={[styles.input, styles.flex]}
                accessibilityLabel={`选项 ${optionId(index).toUpperCase()}`}
              />
              <TextAction label={option.correct ? '✓ 正确' : '正确'} tone={option.correct ? 'primary' : 'muted'}
                accessibilityLabel={`标记选项 ${optionId(index).toUpperCase()} 为正确`}
                onPress={() => update({ options: form.options.map((o) => (o.key === option.key ? { ...o, correct: !o.correct } : o)) })} />
              <TextAction label="删除" tone="muted" accessibilityLabel={`删除选项 ${optionId(index).toUpperCase()}`}
                onPress={() => update({ options: form.options.filter((o) => o.key !== option.key) })} />
            </View>
          ))}
          <TextAction label="添加选项" tone="primary" style={styles.leading} disabled={form.options.length >= 8}
            onPress={() => update({ options: [...form.options, { key: formKey(), text: '', correct: false }] })} />
          <FieldError message={errors.choice} />
        </>
      ) : null}

      <FieldLabel text="题目补充（Markdown，可留空）" />
      <TextInput
        value={form.prompt}
        onChangeText={(prompt) => update({ prompt })}
        placeholder="标题之外的场景、约束、给定代码…"
        placeholderTextColor={colors.textSubtle}
        multiline
        style={[styles.input, styles.multiline]}
        accessibilityLabel="题目补充"
      />

      <FieldLabel text={`一句话结论（${summaryCount}/${SUMMARY_LIMIT} 字）`} />
      <TextInput
        value={form.summary}
        onChangeText={(summary) => update({ summary })}
        placeholder="1–2 句话说清答案核心"
        placeholderTextColor={colors.textSubtle}
        multiline
        style={[styles.input, styles.shortMultiline]}
        accessibilityLabel="一句话结论"
      />
      <FieldError message={errors.summary} />

      <FieldLabel text={`要点（${filledKeyPoints} 条，需 3–5 条，每条 ≤ ${KEY_POINT_LIMIT} 字）`} />
      {form.keyPoints.map((kp, index) => (
        <View key={kp.key}>
          <View style={styles.listItem}>
            <TextInput
              value={kp.text}
              onChangeText={(value) => update({ keyPoints: form.keyPoints.map((k) => (k.key === kp.key ? { ...k, text: value } : k)) })}
              placeholder={`要点 ${index + 1}`}
              placeholderTextColor={colors.textSubtle}
              style={[styles.input, styles.flex]}
              accessibilityLabel={`要点 ${index + 1}`}
            />
            <TextAction
              label={WEIGHT_LABEL[kp.weight]}
              accessibilityLabel={`要点 ${index + 1} 权重 ${WEIGHT_LABEL[kp.weight]}`}
              tone={kp.weight > 1 ? 'primary' : 'muted'}
              onPress={() => update({
                keyPoints: form.keyPoints.map((k) => (k.key === kp.key ? { ...k, weight: WEIGHTS[(WEIGHTS.indexOf(k.weight) + 1) % 3] } : k)),
              })}
            />
          </View>
          <View style={styles.subActions}>
            <TextAction label="上移" tone="muted" disabled={index === 0} accessibilityLabel={`上移要点 ${index + 1}`}
              onPress={() => update({ keyPoints: moveItem(form.keyPoints, index, -1) })} style={styles.leading} />
            <TextAction label="下移" tone="muted" disabled={index === form.keyPoints.length - 1} accessibilityLabel={`下移要点 ${index + 1}`}
              onPress={() => update({ keyPoints: moveItem(form.keyPoints, index, 1) })} />
            <TextAction label="删除" tone="muted" accessibilityLabel={`删除要点 ${index + 1}`}
              onPress={() => update({ keyPoints: form.keyPoints.filter((k) => k.key !== kp.key) })} />
          </View>
          <FieldError message={errors[`keyPoints.${index}`]} />
        </View>
      ))}
      <TextAction label="添加要点" tone="primary" style={styles.leading} disabled={form.keyPoints.length >= MAX_KEY_POINTS}
        onPress={() => update({ keyPoints: [...form.keyPoints, { key: formKey(), text: '', weight: 1 }] })} />
      <FieldError message={errors.keyPoints} />

      <FieldLabel text={form.type === 'choice' ? '解析（Markdown，可留空）' : '详解（Markdown，可留空）'} />
      <TextInput
        value={form.detail}
        onChangeText={(detail) => update({ detail })}
        placeholder="展开讲解，小标题从 ### 起"
        placeholderTextColor={colors.textSubtle}
        multiline
        style={[styles.input, styles.multiline, styles.tall]}
        accessibilityLabel="详解"
      />
      <FieldLabel text="示例（Markdown，代码块请标注语言）" />
      <TextInput
        value={form.examples}
        onChangeText={(examples) => update({ examples })}
        placeholder={'```bash\nredis-cli CONFIG GET hz\n```'}
        placeholderTextColor={colors.textSubtle}
        multiline
        style={[styles.input, styles.multiline]}
        accessibilityLabel="示例"
      />
      <FieldLabel text="易错点（每行一条）" />
      <TextInput
        value={form.pitfalls}
        onChangeText={(pitfalls) => update({ pitfalls })}
        placeholder="把过期删除与内存淘汰混为一谈"
        placeholderTextColor={colors.textSubtle}
        multiline
        style={[styles.input, styles.shortMultiline]}
        accessibilityLabel="易错点"
      />

      <FieldLabel text="追问" />
      {form.followups.map((f, index) => (
        <View key={f.key} style={styles.block}>
          <TextInput
            value={f.q}
            onChangeText={(value) => update({ followups: form.followups.map((x) => (x.key === f.key ? { ...x, q: value } : x)) })}
            placeholder="追问问题"
            placeholderTextColor={colors.textSubtle}
            style={styles.input}
            accessibilityLabel={`追问 ${index + 1} 问题`}
          />
          <TextInput
            value={f.a}
            onChangeText={(value) => update({ followups: form.followups.map((x) => (x.key === f.key ? { ...x, a: value } : x)) })}
            placeholder="追问答案（Markdown，建议 ≤ 150 字）"
            placeholderTextColor={colors.textSubtle}
            multiline
            style={[styles.input, styles.shortMultiline]}
            accessibilityLabel={`追问 ${index + 1} 答案`}
          />
          <TextAction label="删除追问" tone="muted" style={styles.leading} accessibilityLabel={`删除追问 ${index + 1}`}
            onPress={() => update({ followups: form.followups.filter((x) => x.key !== f.key) })} />
          <FieldError message={errors[`followups.${index}`]} />
        </View>
      ))}
      <TextAction label="添加追问" tone="primary" style={styles.leading}
        onPress={() => update({ followups: [...form.followups, { key: formKey(), q: '', a: '' }] })} />

      <FieldLabel text="参考资料" />
      {form.references.map((r, index) => (
        <View key={r.key} style={styles.block}>
          <TextInput
            value={r.title}
            onChangeText={(value) => update({ references: form.references.map((x) => (x.key === r.key ? { ...x, title: value } : x)) })}
            placeholder="标题"
            placeholderTextColor={colors.textSubtle}
            style={styles.input}
            accessibilityLabel={`参考资料 ${index + 1} 标题`}
          />
          <TextInput
            value={r.url}
            onChangeText={(value) => update({ references: form.references.map((x) => (x.key === r.key ? { ...x, url: value } : x)) })}
            placeholder="https://…"
            placeholderTextColor={colors.textSubtle}
            autoCapitalize="none"
            keyboardType="url"
            style={styles.input}
            accessibilityLabel={`参考资料 ${index + 1} 链接`}
          />
          <TextAction label="删除资料" tone="muted" style={styles.leading} accessibilityLabel={`删除参考资料 ${index + 1}`}
            onPress={() => update({ references: form.references.filter((x) => x.key !== r.key) })} />
          <FieldError message={errors[`references.${index}`]} />
        </View>
      ))}
      <TextAction label="添加参考资料" tone="primary" style={styles.leading}
        onPress={() => update({ references: [...form.references, { key: formKey(), title: '', url: '' }] })} />

      <FieldLabel text="适用版本（逗号分隔，可留空）" />
      <TextInput
        value={form.appliesTo}
        onChangeText={(appliesTo) => update({ appliesTo })}
        placeholder="Redis >= 6，MySQL 8"
        placeholderTextColor={colors.textSubtle}
        style={styles.input}
        accessibilityLabel="适用版本"
      />
    </ModalSheet>
  );
}

/** 比较表单是否改动时忽略 React key */
function stripKeys(form: QuestionForm) {
  const strip = <T extends { key: string }>(rows: T[]) => rows.map(({ key: _key, ...rest }) => rest);
  return {
    ...form,
    keyPoints: strip(form.keyPoints),
    followups: strip(form.followups),
    references: strip(form.references),
    options: strip(form.options),
  };
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <Text style={styles.fieldError} accessibilityRole="alert">{message}</Text>;
}

function Chip({ label, selected, onPress, accessibilityLabel }: {
  label: string; selected: boolean; onPress: () => void; accessibilityLabel: string;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.pressed]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function ChoiceRow<T extends string | number>({ options, value, onChange, labelSuffix }: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  labelSuffix: string;
}) {
  return (
    <View style={styles.wrapRow} accessibilityRole="radiogroup">
      {options.map((option) => (
        <Chip key={String(option.value)} label={option.label} selected={option.value === value}
          accessibilityLabel={`${option.label}${labelSuffix}`} onPress={() => onChange(option.value)} />
      ))}
    </View>
  );
}

function VersionCard({ label, title, body, selected, onPress }: {
  label: string; title: string; body: string; selected: boolean; onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={`${label}：${title}`}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.versionCard, pressed && styles.pressed]}
    >
      <View style={styles.versionHeading}>
        {selected ? <CheckCircle2 size={16} color={colors.primary} strokeWidth={1.8} /> : <View style={styles.versionCircle} />}
        <Text style={[styles.versionLabel, selected && styles.versionLabelSelected]}>{label}</Text>
      </View>
      <Text style={styles.versionTitle} numberOfLines={2}>{title}</Text>
      <Text style={styles.versionBody} numberOfLines={10}>{body}</Text>
    </Pressable>
  );
}

// 极简阅读风：选项是带下划线的文字，输入为发丝下划线，列表行无底色
const styles = StyleSheet.create({
  discard: { gap: spacing.sm },
  discardText: { ...typography.caption, color: colors.textSecondary },
  input: {
    ...typography.body,
    color: colors.text,
    minHeight: 44,
    paddingHorizontal: 0,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderStrong,
  },
  multiline: { minHeight: 88, textAlignVertical: 'top', lineHeight: 22 },
  shortMultiline: { minHeight: 56, textAlignVertical: 'top', lineHeight: 22 },
  tall: { minHeight: 128 },
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.lg },
  listItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  subActions: { flexDirection: 'row', alignItems: 'center' },
  block: { paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  leading: { paddingLeft: 0, alignItems: 'flex-start' },
  optionId: { ...typography.label, color: colors.textMuted, width: 18 },
  chip: { minHeight: 44, justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  chipSelected: { borderBottomColor: colors.primary },
  chipText: { ...typography.body, color: colors.textMuted },
  chipTextSelected: { color: colors.text, fontWeight: '600' },
  fieldError: { ...typography.caption, color: colors.danger, marginTop: spacing.xs, lineHeight: 18 },
  hintText: { ...typography.caption, color: colors.textMuted, lineHeight: 18, marginBottom: spacing.xs },
  aiSection: { marginTop: spacing.sm },
  aiEntryButton: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  aiEntryText: { ...typography.label, fontSize: 14, color: colors.primary },
  aiBox: {
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  versionCard: { paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  versionHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 4 },
  versionCircle: { width: 16, height: 16, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.borderStrong },
  versionLabel: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },
  versionLabelSelected: { color: colors.primary },
  versionTitle: { ...typography.body, color: colors.text, lineHeight: 22 },
  versionBody: { ...typography.caption, color: colors.textSecondary, lineHeight: 18, marginTop: 3 },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.6 },
});
