import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { usePreventRemove, useNavigation, type NavigationAction } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { useBankStore, type Bundle, type LocalQuestionInput, type Question } from '../../bank';
import type { GeneratedQuestionDraft } from '../../lib/llm';
import { AppButton } from '../../components/ui';
import { colors, spacing, typography } from '../../theme';
import { FieldLabel, ModalSheet, SheetError } from './ModalSheet';
import { QuestionEditModal } from './QuestionEditModal';
import { ImportTextModal } from './ImportTextModal';
import { InlineNote, TextAction, listStyles } from './components/list';
import { BankBusyNote } from './components/bank-status';
import { ORIGIN_HINT, UNSUPPORTED_TEXT, bankErrorText, copyBankAsLocal, loadBankBundle } from './bank-helpers';
import { DIFFICULTY_LABEL, QUESTION_TYPE_LABEL } from './question-form';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** AI 草稿 → 数据层输入（要点 / 追问 id 由数据层分配） */
export function draftToInput(draft: GeneratedQuestionDraft, categoryId: string): LocalQuestionInput {
  return {
    title: draft.title,
    type: draft.type,
    difficulty: draft.difficulty,
    importance: 2,
    categoryId,
    tags: [],
    prompt: draft.prompt,
    answer: { summary: draft.summary, keyPoints: draft.keyPoints, detail: draft.detail, pitfalls: draft.pitfalls },
    choice: null,
    followups: draft.followups,
  };
}

/**
 * 本地题库编辑（BankEditorScreen 的正文）：题库名称 / 简介、分类与标签管理、题目列表（增 / 改 / 删 / 排序）、
 * 从文本或图片 AI 导入。每次题目 / 分类 / 标签修改都立即经数据层整库校验后写入；
 * 只有题库名称 / 简介是草稿，离开前未保存会被 usePreventRemove 拦下询问。
 * 线上 / 文件题库只读：提供「复制为本地编辑」。
 */
export function BankEditorContent({
  bankId,
  onOpenAiSettings,
}: {
  bankId: string;
  onOpenAiSettings: () => void;
}) {
  const navigation = useNavigation<Nav>();
  const status = useBankStore((state) => state.status);
  const bank = useBankStore((state) => state.banks.find((b) => b.id === bankId) ?? null);
  const contentVersion = useBankStore((state) => state.contentVersion);
  const storeBusy = useBankStore((state) => state.busy);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const busy = working || storeBusy !== null;

  // 题库信息草稿：null = 未修改（输入框显示已保存的值）
  const [infoDraft, setInfoDraft] = useState<{ name: string; description: string } | null>(null);
  const savedName = bundle?.bank.name ?? '';
  const savedDescription = bundle?.bank.description ?? '';
  const name = infoDraft?.name ?? savedName;
  const description = infoDraft?.description ?? savedDescription;
  const dirty = infoDraft !== null && (infoDraft.name !== savedName || infoDraft.description !== savedDescription);
  const setName = (value: string) => setInfoDraft({ name: value, description });
  const setDescription = (value: string) => setInfoDraft({ name, description: value });
  const [leaveIntent, setLeaveIntent] = useState<NavigationAction | null>(null);

  // 分类 / 标签
  const [newCategory, setNewCategory] = useState('');
  const [newTag, setNewTag] = useState('');
  const [renaming, setRenaming] = useState<{ kind: 'category' | 'tag'; id: string; value: string } | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<{ kind: 'category' | 'tag' | 'question'; id: string } | null>(null);
  const [importCategoryId, setImportCategoryId] = useState<string | null>(null);

  /** undefined = 关闭；null = 新建；对象 = 编辑既有题 */
  const [editingQuestion, setEditingQuestion] = useState<Question | null | undefined>(undefined);
  const [importVisible, setImportVisible] = useState(false);

  const reload = useCallback(async () => {
    const result = await loadBankBundle(bankId);
    if (result.ok) {
      setBundle(result.value);
      setError(null);
    } else {
      setError(bankErrorText(result.error));
    }
    setLoading(false);
    return result;
  }, [bankId]);

  // 打开 / 切换题库时重置草稿；内容变化（contentVersion）时重新读取
  useEffect(() => {
    if (status !== 'ready') return;
    void reload();
  }, [reload, status, contentVersion]);

  // 忙碌时一律拦截（写入中途离开会打断操作）；有未保存修改时拦下并询问
  usePreventRemove(dirty || busy, ({ data }) => {
    if (busy) return;
    setLeaveIntent(data.action);
  });

  function discardAndLeave() {
    if (busy || !leaveIntent) return;
    const action = leaveIntent;
    setLeaveIntent(null);
    setInfoDraft(null);
    navigation.dispatch(action);
  }

  /** 统一的忙碌 / 错误包装：store 返回失败时显示其中文说明 */
  async function run(operation: () => Promise<string | null>) {
    if (busy) return;
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      const message = await operation();
      if (message) setNotice(message);
    } finally {
      setWorking(false);
    }
  }
  const fail = (message: string) => { setError(message); return null; };

  const saveInfo = () => run(async () => {
    const result = await useBankStore.getState().updateLocalBankInfo(bankId, { name: name.trim(), description });
    if (!result.ok) return fail(bankErrorText(result.error));
    setInfoDraft(null);
    return '题库信息已保存。';
  });

  const addCategory = () => run(async () => {
    if (!newCategory.trim()) return null;
    const result = await useBankStore.getState().addLocalCategory(bankId, { name: newCategory.trim() });
    if (!result.ok) return fail(bankErrorText(result.error));
    setNewCategory('');
    return null;
  });

  const addTag = () => run(async () => {
    if (!newTag.trim()) return null;
    const result = await useBankStore.getState().addLocalTag(bankId, { name: newTag.trim() });
    if (!result.ok) return fail(bankErrorText(result.error));
    setNewTag('');
    return null;
  });

  const saveRename = () => run(async () => {
    if (!renaming || !renaming.value.trim()) return null;
    const store = useBankStore.getState();
    const result = renaming.kind === 'category'
      ? await store.updateLocalCategory(bankId, renaming.id, { name: renaming.value.trim() })
      : await store.updateLocalTag(bankId, renaming.id, { name: renaming.value.trim() });
    if (!result.ok) return fail(bankErrorText(result.error));
    setRenaming(null);
    return null;
  });

  const deleteCategory = (categoryId: string, moveTo: string | undefined) => run(async () => {
    const result = await useBankStore.getState().deleteLocalCategory(bankId, categoryId, moveTo ? { moveQuestionsTo: moveTo } : undefined);
    setConfirmingDelete(null);
    return result.ok ? null : fail(bankErrorText(result.error));
  });

  const deleteTag = (tagId: string) => run(async () => {
    const result = await useBankStore.getState().deleteLocalTag(bankId, tagId);
    setConfirmingDelete(null);
    return result.ok ? null : fail(bankErrorText(result.error));
  });

  const deleteQuestion = (question: Question) => run(async () => {
    const result = await useBankStore.getState().deleteLocalQuestion(bankId, question.id);
    setConfirmingDelete(null);
    return result.ok ? `已删除「${question.title}」。` : fail(bankErrorText(result.error));
  });

  const moveQuestion = (index: number, delta: -1 | 1) => run(async () => {
    if (!bundle) return null;
    const ids = bundle.questions.map((q) => q.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return null;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    const result = await useBankStore.getState().reorderLocalQuestions(bankId, ids);
    return result.ok ? null : fail(bankErrorText(result.error));
  });

  const copyAndEdit = () => run(async () => {
    const result = await copyBankAsLocal(bankId);
    if (!result.ok) return fail(bankErrorText(result.error));
    navigation.replace('BankEditor', { bankId: result.value.bankId });
    return null;
  });

  const importDrafts = (drafts: GeneratedQuestionDraft[]) => {
    setImportVisible(false);
    const categoryId = importCategoryId ?? bundle?.categories[0]?.id;
    if (!categoryId) {
      setError('请先添加一个分类再导入');
      return;
    }
    void run(async () => {
      let added = 0;
      const failures: string[] = [];
      for (const draft of drafts) {
        const result = await useBankStore.getState().addLocalQuestion(bankId, draftToInput(draft, categoryId));
        if (result.ok) added += 1;
        else failures.push(`「${draft.title}」：${result.error.message}`);
      }
      if (failures.length > 0) setError(`${failures.length} 道题未能导入：${failures.join('；')}`);
      return added > 0 ? `已导入 ${added} 道题。` : null;
    });
  };

  if (status === 'unsupported') {
    return (
      <ModalSheet visible presentation="screen" title="编辑本地题库" onClose={() => navigation.goBack()}>
        <InlineNote text={UNSUPPORTED_TEXT} />
      </ModalSheet>
    );
  }

  const categoryNames = new Map((bundle?.categories ?? []).map((c) => [c.id, c.name]));
  const questionCountByCategory = new Map<string, number>();
  for (const q of bundle?.questions ?? []) questionCountByCategory.set(q.categoryId, (questionCountByCategory.get(q.categoryId) ?? 0) + 1);
  const questions = bundle?.questions ?? [];
  const categories = bundle?.categories ?? [];
  const tags = bundle?.tags ?? [];
  const importTarget = categories.find((c) => c.id === importCategoryId) ?? categories[0];
  const readOnly = bank !== null && bank.origin !== 'local';

  return (
    <ModalSheet
      visible
      presentation="screen"
      title="编辑本地题库"
      hint="题目、分类、标签的修改保存后立即生效；题库名称与简介需点「保存信息」。"
      onClose={() => navigation.goBack()}
      dismissDisabled={busy}
      footer={leaveIntent ? (
        <View accessibilityRole="alert" style={styles.leaveBox}>
          <Text style={styles.leaveText}>题库名称 / 简介有未保存的修改，离开后将丢失。</Text>
          <AppButton label="继续编辑" disabled={busy} onPress={() => setLeaveIntent(null)} />
          <AppButton label="放弃修改并离开" disabled={busy} variant="ghost" onPress={discardAndLeave} />
        </View>
      ) : undefined}
    >
      <SheetError message={error} />
      <BankBusyNote />
      {notice ? <View style={styles.notice}><InlineNote text={notice} tone="default" live /></View> : null}
      {loading ? <Text style={styles.muted}>正在读取题库…</Text> : null}
      {!loading && !bank ? <InlineNote text="题库不存在或已被删除。" tone="danger" /> : null}

      {!loading && bank && readOnly ? (
        <View style={styles.block}>
          <InlineNote text={`「${bank.name}」：${ORIGIN_HINT[bank.origin]}。复制为本地题库后即可自由编辑，原题库保持不变。`} />
          <AppButton label={working ? '正在复制' : '复制为本地题库并编辑'} loading={working} disabled={busy}
            onPress={() => void copyAndEdit()} style={styles.copyButton} />
        </View>
      ) : null}

      {!loading && bank && !readOnly && bundle ? (
        <>
          <FieldLabel text="题库名称" />
          <TextInput value={name} onChangeText={setName} editable={!busy} placeholder="我的题库"
            placeholderTextColor={colors.textSubtle} style={listStyles.input} accessibilityLabel="题库名称" />
          <FieldLabel text="简介（可留空）" />
          <TextInput value={description} onChangeText={setDescription} editable={!busy} placeholder="这个题库收录什么"
            placeholderTextColor={colors.textSubtle} style={listStyles.input} accessibilityLabel="题库简介" />
          {dirty ? (
            <TextAction label="保存信息" tone="primary" disabled={busy || !name.trim()} onPress={() => void saveInfo()} style={styles.leading} />
          ) : null}

          <SectionHeader title="分类" count={categories.length} />
          {categories.map((category) => {
            const count = questionCountByCategory.get(category.id) ?? 0;
            const moveTo = categories.find((c) => c.id !== category.id);
            const isRenaming = renaming?.kind === 'category' && renaming.id === category.id;
            const isConfirming = confirmingDelete?.kind === 'category' && confirmingDelete.id === category.id;
            return (
              <View key={category.id} style={styles.itemRow}>
                {isRenaming ? (
                  <TextInput value={renaming.value} onChangeText={(value) => setRenaming({ ...renaming, value })} autoFocus
                    style={[listStyles.input, styles.flex]} accessibilityLabel={`分类 ${category.name} 新名称`} />
                ) : (
                  <Text style={styles.itemTitle}>{category.name}<Text style={styles.muted}>  {count} 题</Text></Text>
                )}
                {isRenaming ? (
                  <>
                    <TextAction label="保存" tone="primary" disabled={busy} onPress={() => void saveRename()} accessibilityLabel={`保存分类 ${category.name} 名称`} />
                    <TextAction label="取消" tone="muted" onPress={() => setRenaming(null)} />
                  </>
                ) : isConfirming ? (
                  <>
                    <TextAction label={count > 0 && moveTo ? `删除并移入「${moveTo.name}」` : '确认删除'} tone="danger" disabled={busy}
                      accessibilityLabel={`确认删除分类 ${category.name}`} onPress={() => void deleteCategory(category.id, count > 0 ? moveTo?.id : undefined)} />
                    <TextAction label="取消" tone="muted" onPress={() => setConfirmingDelete(null)} />
                  </>
                ) : (
                  <>
                    <TextAction label="改名" tone="muted" disabled={busy} accessibilityLabel={`重命名分类 ${category.name}`}
                      onPress={() => setRenaming({ kind: 'category', id: category.id, value: category.name })} />
                    <TextAction label="删除" tone="muted" disabled={busy || (count > 0 && !moveTo)} accessibilityLabel={`删除分类 ${category.name}`}
                      onPress={() => setConfirmingDelete({ kind: 'category', id: category.id })} />
                  </>
                )}
              </View>
            );
          })}
          <AddRow value={newCategory} onChange={setNewCategory} placeholder="新分类名称" label="添加分类" disabled={busy} onAdd={() => void addCategory()} />

          <SectionHeader title="标签" count={tags.length} />
          {tags.map((tag) => {
            const isRenaming = renaming?.kind === 'tag' && renaming.id === tag.id;
            const isConfirming = confirmingDelete?.kind === 'tag' && confirmingDelete.id === tag.id;
            return (
              <View key={tag.id} style={styles.itemRow}>
                {isRenaming ? (
                  <TextInput value={renaming.value} onChangeText={(value) => setRenaming({ ...renaming, value })} autoFocus
                    style={[listStyles.input, styles.flex]} accessibilityLabel={`标签 ${tag.name} 新名称`} />
                ) : <Text style={styles.itemTitle}>{tag.name}</Text>}
                {isRenaming ? (
                  <>
                    <TextAction label="保存" tone="primary" disabled={busy} onPress={() => void saveRename()} accessibilityLabel={`保存标签 ${tag.name} 名称`} />
                    <TextAction label="取消" tone="muted" onPress={() => setRenaming(null)} />
                  </>
                ) : isConfirming ? (
                  <>
                    <TextAction label="确认删除" tone="danger" disabled={busy} accessibilityLabel={`确认删除标签 ${tag.name}`} onPress={() => void deleteTag(tag.id)} />
                    <TextAction label="取消" tone="muted" onPress={() => setConfirmingDelete(null)} />
                  </>
                ) : (
                  <>
                    <TextAction label="改名" tone="muted" disabled={busy} accessibilityLabel={`重命名标签 ${tag.name}`}
                      onPress={() => setRenaming({ kind: 'tag', id: tag.id, value: tag.name })} />
                    <TextAction label="删除" tone="muted" disabled={busy} accessibilityLabel={`删除标签 ${tag.name}`}
                      onPress={() => setConfirmingDelete({ kind: 'tag', id: tag.id })} />
                  </>
                )}
              </View>
            );
          })}
          <AddRow value={newTag} onChange={setNewTag} placeholder="新标签名称" label="添加标签" disabled={busy} onAdd={() => void addTag()} />

          <SectionHeader title="题目" count={questions.length} />
          <View style={styles.toolRow}>
            <TextAction label="新增题目" tone="primary" disabled={busy || categories.length === 0} onPress={() => setEditingQuestion(null)} style={styles.leading} />
            <TextAction label="AI 导入" disabled={busy || categories.length === 0} onPress={() => setImportVisible(true)} />
            {categories.length > 1 && importTarget ? (
              <TextAction
                label={`导入到：${importTarget.name}`}
                tone="muted"
                accessibilityLabel="切换 AI 导入的目标分类"
                disabled={busy}
                onPress={() => {
                  const index = categories.findIndex((c) => c.id === importTarget.id);
                  setImportCategoryId(categories[(index + 1) % categories.length].id);
                }}
              />
            ) : null}
          </View>
          {questions.length === 0 ? (
            <View style={styles.block}>
              <InlineNote text="还没有题目：手动「新增题目」，或通过「AI 导入」从文本 / 图片抽取题目。" />
            </View>
          ) : null}
          {questions.map((question, index) => {
            const isConfirming = confirmingDelete?.kind === 'question' && confirmingDelete.id === question.id;
            return (
              <View key={question.id} style={styles.questionRow}>
                <Text style={styles.questionTitle} numberOfLines={2}>{question.title}</Text>
                <Text style={styles.muted}>
                  {QUESTION_TYPE_LABEL[question.type]} · {DIFFICULTY_LABEL[question.difficulty]} · {categoryNames.get(question.categoryId) ?? question.categoryId} · 要点 {question.answer.keyPoints.length} 条
                </Text>
                <View style={styles.inlineActions}>
                  {isConfirming ? (
                    <>
                      <TextAction label="确认删除" tone="danger" disabled={busy} accessibilityLabel={`确认删除题目 ${question.title}`}
                        onPress={() => void deleteQuestion(question)} style={styles.leading} />
                      <TextAction label="取消" tone="muted" onPress={() => setConfirmingDelete(null)} />
                    </>
                  ) : (
                    <>
                      <TextAction label="编辑" disabled={busy} accessibilityLabel={`编辑题目 ${question.title}`}
                        onPress={() => setEditingQuestion(question)} style={styles.leading} />
                      <TextAction label="上移" tone="muted" disabled={busy || index === 0} accessibilityLabel={`上移题目 ${question.title}`}
                        onPress={() => void moveQuestion(index, -1)} />
                      <TextAction label="下移" tone="muted" disabled={busy || index === questions.length - 1} accessibilityLabel={`下移题目 ${question.title}`}
                        onPress={() => void moveQuestion(index, 1)} />
                      <TextAction label="删除" tone="muted" disabled={busy} accessibilityLabel={`删除题目 ${question.title}`}
                        onPress={() => setConfirmingDelete({ kind: 'question', id: question.id })} />
                    </>
                  )}
                </View>
              </View>
            );
          })}
        </>
      ) : null}

      <QuestionEditModal
        visible={editingQuestion !== undefined}
        bankId={bankId}
        initial={editingQuestion ?? null}
        categories={categories}
        tags={tags}
        onSaved={(saved) => {
          setEditingQuestion(undefined);
          setNotice(`已保存「${saved.title}」。`);
        }}
        onClose={() => setEditingQuestion(undefined)}
      />

      <ImportTextModal
        visible={importVisible}
        onClose={() => setImportVisible(false)}
        onConfirm={importDrafts}
        onOpenAiSettings={onOpenAiSettings}
      />
    </ModalSheet>
  );
}

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle} accessibilityRole="header">{title}</Text>
      <Text style={styles.muted}>{count}</Text>
    </View>
  );
}

function AddRow({ value, onChange, placeholder, label, disabled, onAdd }: {
  value: string; onChange: (value: string) => void; placeholder: string; label: string; disabled: boolean; onAdd: () => void;
}) {
  return (
    <View style={styles.itemRow}>
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={colors.textSubtle}
        editable={!disabled} onSubmitEditing={onAdd} style={[listStyles.input, styles.flex]} accessibilityLabel={placeholder} />
      <TextAction label="添加" tone="primary" accessibilityLabel={label} disabled={disabled || !value.trim()} onPress={onAdd} />
    </View>
  );
}

const styles = StyleSheet.create({
  notice: { marginBottom: spacing.sm },
  muted: { ...typography.caption, color: colors.textMuted },
  block: { paddingVertical: spacing.lg },
  copyButton: { marginTop: spacing.md },
  leaveBox: { gap: spacing.sm },
  leaveText: { ...typography.body, color: colors.text },
  leading: { paddingLeft: 0 },
  flex: { flex: 1 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  sectionTitle: { ...typography.eyebrow, color: colors.textMuted },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  itemTitle: { ...typography.body, color: colors.text, flex: 1 },
  toolRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: spacing.md, marginTop: spacing.sm },
  questionRow: {
    paddingTop: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  questionTitle: { ...typography.body, color: colors.text, lineHeight: 22 },
  inlineActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing.xs },
});
