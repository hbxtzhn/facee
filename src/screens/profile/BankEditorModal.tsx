import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { usePreventRemove, useNavigation, type NavigationAction } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { useQuestionBankStore } from '../../question-bank/store';
import {
  loadLocalBankSource,
  removeQuestion,
  upsertQuestion,
  type LocalBankSource,
} from '../../question-bank/local-banks';
import type { GeneratedQuestionDraft } from '../../lib/llm';
import { AppButton, DifficultyBadge } from '../../components/ui';
import { colors, spacing, typography } from '../../theme';
import { ModalSheet, SheetActions, SheetError } from './ModalSheet';
import {
  QuestionEditModal,
  type QuestionFormDraft,
} from './QuestionEditModal';
import { ImportTextModal } from './ImportTextModal';
import { InlineNote, TextAction, listStyles } from './components/list';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * 本地题库编辑内容（BankEditorScreen 的正文）：题库改名、题目列表维护（增/改/删）、从文本或图片 AI 导入。
 * 编辑只改内存中的源包，点「保存题库」才写源文件并重建安装，保留当前使用的题库。
 * 离开统一走导航移除：取消 / 返回键 / 返回手势 / 跳管理页都经 usePreventRemove，有未保存修改先询问。
 */
export function BankEditorContent({
  bankId,
  onOpenAiSettings,
}: {
  /** 本地题库 id（local- 前缀） */
  bankId: string;
  onOpenAiSettings: () => void;
}) {
  const navigation = useNavigation<Nav>();
  const saveLocalBank = useQuestionBankStore((state) => state.saveLocalBank);
  const installing = useQuestionBankStore((state) => state.installing);
  const [source, setSource] = useState<LocalBankSource | null>(null);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  /** 被拦下的离开动作：确认放弃后原样重放（返回 / 跳管理页） */
  const [leaveIntent, setLeaveIntent] = useState<NavigationAction | null>(null);
  /** 保存成功后待离开：等 dirty / busy 状态提交、拦截解除后再返回 */
  const [leaveAfterSave, setLeaveAfterSave] = useState(false);
  const busy = saving || installing;
  const [error, setError] = useState<string | null>(null);
  /** undefined = 关闭；null = 新建；对象 = 编辑既有题 */
  const [editingQuestion, setEditingQuestion] = useState<QuestionFormDraft | null | undefined>(undefined);
  const [importVisible, setImportVisible] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setSource(null);
    setTitle('');
    setDirty(false);
    setLeaveIntent(null);
    setLeaveAfterSave(false);
    setEditingQuestion(undefined);
    setImportVisible(false);
    setError(null);
    setConfirmingDeleteId(null);
    void loadLocalBankSource(bankId).then((loaded) => {
      if (!alive) return;
      if (!loaded) {
        setError('本地题库源不存在或已损坏');
      } else {
        setSource(loaded);
        setTitle(loaded.package.catalog.title);
      }
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [bankId]);

  // 忙碌时一律拦截（保存中途离开会丢失写入）；有未保存修改时拦下并询问
  usePreventRemove(dirty || Boolean(busy), ({ data }) => {
    if (busy) return;
    setLeaveIntent(data.action);
  });

  useEffect(() => {
    if (leaveAfterSave && !dirty && !busy) {
      setLeaveAfterSave(false);
      navigation.goBack();
    }
  }, [leaveAfterSave, dirty, busy, navigation]);

  function requestLeave(intent: 'close' | 'manager') {
    if (busy) return;
    // 真正的拦截在 usePreventRemove：这里只发起导航，未保存时会被拦下并弹出确认
    if (intent === 'manager') navigation.popTo('BankManager');
    else navigation.goBack();
  }

  function discardAndLeave() {
    if (busy || !leaveIntent) return;
    const action = leaveIntent;
    setLeaveIntent(null);
    setDirty(false);
    // 重放被拦下的动作：导航库会跳过本页的 beforeRemove，不会再次拦截
    navigation.dispatch(action);
  }

  function mutatePackage(mutate: (bank: LocalBankSource['package']) => LocalBankSource['package']) {
    if (busy) return;
    setDirty(true);
    setSource((current) => (current ? { ...current, package: mutate(current.package) } : current));
  }

  function handleSaveQuestion(draft: QuestionFormDraft) {
    mutatePackage((bank) => upsertQuestion(bank, draft));
    setEditingQuestion(undefined);
  }

  function handleImport(drafts: GeneratedQuestionDraft[]) {
    mutatePackage((bank) =>
      drafts.reduce(
        (current, draft) =>
          upsertQuestion(current, {
            title: draft.title,
            difficulty: draft.difficulty,
            tags: draft.tags,
            questionMd: draft.questionMd,
            answerMd: draft.answerMd,
          }),
        bank,
      ),
    );
    setImportVisible(false);
  }

  async function handleSave() {
    if (!source || source.bankId !== bankId || loading || busy) return;
    setSaving(true);
    setError(null);
    try {
      const trimmedTitle = title.trim() || '我的题库';
      const nextPackage = {
        ...source.package,
        catalog: { ...source.package.catalog, title: trimmedTitle },
      };
      await saveLocalBank({ ...source, package: nextPackage });
      setDirty(false);
      setLeaveAfterSave(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  }

  const questions = source?.package.catalog.questions ?? [];
  const contentsById = new Map((source?.package.contents ?? []).map((content) => [content.id, content]));

  return (
    <ModalSheet
      visible
      presentation="screen"
      title="编辑本地题库"
      hint="点击「保存题库」后修改生效，可离线刷题；保存不会切换当前使用的题库。"
      onClose={() => requestLeave('close')}
      dismissDisabled={Boolean(busy)}
      footer={
        // 离开确认放在固定底栏：返回键触发时无论正文滚到哪里都能看到
        leaveIntent ? (
          <View accessibilityRole="alert" style={{ gap: spacing.sm }}>
            <Text style={styles.leaveText}>有未保存的修改，离开后将丢失。</Text>
            <AppButton label="继续编辑" disabled={Boolean(busy)} onPress={() => setLeaveIntent(null)} />
            <AppButton label="放弃修改并离开" disabled={Boolean(busy)} variant="ghost" onPress={discardAndLeave} />
          </View>
        ) : (
          <SheetActions
            confirmLabel={saving ? '正在保存' : '保存题库'}
            confirmLoading={saving}
            onCancel={() => requestLeave('close')}
            onConfirm={() => void handleSave()}
            cancelDisabled={Boolean(busy)}
            confirmDisabled={Boolean(loading || busy || !source || source.bankId !== bankId)}
          />
        )
      }
    >
      <SheetError message={error} />
      {loading ? <Text style={styles.loadingText}>正在读取题库…</Text> : null}

      {!loading && source ? (
        <>
          <Text style={styles.fieldLabel}>题库名称</Text>
          <TextInput
            value={title}
            onChangeText={(value) => { setTitle(value); setDirty(true); }}
            editable={!busy}
            placeholder="我的题库"
            placeholderTextColor={colors.textSubtle}
            style={listStyles.input}
            accessibilityLabel="题库名称"
          />

          <View style={styles.toolRow}>
            <TextAction
              label="新增题目"
              tone="primary"
              disabled={Boolean(busy)}
              onPress={() => setEditingQuestion(null)}
              style={styles.leadingAction}
            />
            <TextAction label="AI 导入" disabled={Boolean(busy)} onPress={() => setImportVisible(true)} />
          </View>

          <View style={styles.listHeader}>
            <Text style={styles.listTitle}>题目列表</Text>
            <Text style={styles.listCount}>{questions.length} 题</Text>
          </View>

          {questions.length === 0 ? (
            <View style={styles.emptyBlock}>
              <InlineNote text="还没有题目：手动「新增题目」，或通过「AI 导入」从文本/图片抽取题目。" />
            </View>
          ) : null}

          {/* 回到（或打开）题库管理页：栈内 popTo，同样经过未保存守卫 */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="管理其它题库"
            onPress={() => requestLeave('manager')}
            disabled={Boolean(busy)}
            style={({ pressed }) => [styles.managerLink, pressed && styles.pressed]}
          >
            <Text style={styles.managerLinkText}>管理其它题库（切换 / 新建）</Text>
          </Pressable>

          {questions.map((question) => {
            const confirmingDelete = confirmingDeleteId === question.id;
            return (
              <View key={question.id} style={styles.questionRow}>
                <View style={styles.questionMain}>
                  <Text style={styles.questionTitle} numberOfLines={2}>{question.title}</Text>
                  <View style={styles.questionMetaRow}>
                    <DifficultyBadge difficulty={question.difficulty as 1 | 2 | 3} />
                    <Text style={styles.questionMeta}>
                      {question.hasAnswer ? '有答案' : '无答案'}
                      {question.tags[0] ? ` · ${question.tags[0].name}` : ''}
                    </Text>
                  </View>
                </View>
                <TextAction
                  label="编辑"
                  accessibilityLabel={`编辑题目 ${question.title}`}
                  disabled={Boolean(busy)}
                  onPress={() => {
                    const content = contentsById.get(question.id);
                    setEditingQuestion({
                      id: question.id,
                      title: question.title,
                      difficulty: question.difficulty as 1 | 2 | 3,
                      tags: question.tags.map((tag) => tag.name),
                      questionMd: content?.questionMd ?? '',
                      answerMd: content?.answerMd ?? null,
                    });
                  }}
                />
                {confirmingDelete ? (
                  <TextAction
                    label="确认删除"
                    accessibilityLabel={`确认删除题目 ${question.title}`}
                    tone="danger"
                    disabled={Boolean(busy)}
                    onPress={() => {
                      mutatePackage((bank) => removeQuestion(bank, question.id));
                      setConfirmingDeleteId(null);
                    }}
                  />
                ) : (
                  <TextAction
                    label="删除"
                    accessibilityLabel={`删除题目 ${question.title}`}
                    tone="muted"
                    disabled={Boolean(busy)}
                    onPress={() => setConfirmingDeleteId(question.id)}
                  />
                )}
              </View>
            );
          })}
        </>
      ) : null}

      <QuestionEditModal
        visible={editingQuestion !== undefined}
        initial={editingQuestion ?? null}
        onSave={handleSaveQuestion}
        onClose={() => setEditingQuestion(undefined)}
      />

      <ImportTextModal
        visible={importVisible}
        onClose={() => setImportVisible(false)}
        onConfirm={handleImport}
        onOpenAiSettings={onOpenAiSettings}
      />
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  loadingText: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm },
  leaveText: { ...typography.body, color: colors.text },
  fieldLabel: { ...typography.eyebrow, color: colors.textMuted, marginBottom: spacing.xs },
  toolRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md },
  leadingAction: { paddingLeft: 0 },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  listTitle: { ...typography.eyebrow, color: colors.textMuted },
  listCount: { ...typography.caption, color: colors.textMuted },
  emptyBlock: { paddingVertical: spacing.lg },
  managerLink: {
    minHeight: 44,
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  managerLinkText: { ...typography.body, color: colors.textSecondary },
  questionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  questionMain: { flex: 1 },
  questionTitle: { ...typography.body, color: colors.text, lineHeight: 22 },
  questionMetaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 2 },
  questionMeta: { ...typography.caption, color: colors.textMuted },
  pressed: { opacity: 0.6 },
});
