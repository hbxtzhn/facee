import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { FilePlus2, Pencil, TextSelect, Trash2 } from 'lucide-react-native';
import { useQuestionBankStore } from '../../question-bank/store';
import {
  loadLocalBankSource,
  removeQuestion,
  upsertQuestion,
  type LocalBankSource,
} from '../../question-bank/local-banks';
import type { GeneratedQuestionDraft } from '../../lib/llm';
import { AppButton, DifficultyBadge } from '../../components/ui';
import { colors, radii, spacing, typography } from '../../theme';
import { ModalSheet, SheetActions, SheetError } from './ModalSheet';
import {
  QuestionEditModal,
  type QuestionFormDraft,
} from './QuestionEditModal';
import { ImportTextModal } from './ImportTextModal';

/**
 * 本地题库编辑弹窗：题库改名、题目列表维护（增/改/删）、从文本导入。
 * 编辑只改内存中的源包，点「保存并启用」才写源文件并重建安装。
 */
export function BankEditorModal({
  visible,
  bankId,
  onClose,
  onOpenAiSettings,
  onOpenManager,
}: {
  visible: boolean;
  /** 本地题库 id（local- 前缀） */
  bankId: string | null;
  onClose: () => void;
  onOpenAiSettings: () => void;
  /** 从编辑器跳到题库管理弹窗（切换 / 新建其它题库） */
  onOpenManager?: () => void;
}) {
  const saveLocalBank = useQuestionBankStore((state) => state.saveLocalBank);
  const [source, setSource] = useState<LocalBankSource | null>(null);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** undefined = 关闭；null = 新建；对象 = 编辑既有题 */
  const [editingQuestion, setEditingQuestion] = useState<QuestionFormDraft | null | undefined>(undefined);
  const [importVisible, setImportVisible] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !bankId) return;
    let alive = true;
    setLoading(true);
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
  }, [visible, bankId]);

  function mutatePackage(mutate: (bank: LocalBankSource['package']) => LocalBankSource['package']) {
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
    if (!source || saving) return;
    setSaving(true);
    setError(null);
    try {
      const trimmedTitle = title.trim() || '我的题库';
      const nextPackage = {
        ...source.package,
        catalog: { ...source.package.catalog, title: trimmedTitle },
      };
      await saveLocalBank({ ...source, package: nextPackage });
      onClose();
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
      visible={visible && bankId !== null}
      title="编辑本地题库"
      hint="改动只在本地保存；「保存并启用」后立即生效，可完全离线刷题。"
      onClose={onClose}
      footer={
        <SheetActions
          confirmLabel={saving ? '正在保存' : '保存并启用'}
          confirmLoading={saving}
          onCancel={onClose}
          onConfirm={() => void handleSave()}
          cancelDisabled={saving}
        />
      }
    >
      <SheetError message={error} />
      {loading ? <Text style={styles.loadingText}>正在读取题库…</Text> : null}

      {!loading && source ? (
        <>
          <Text style={styles.fieldLabel}>题库名称</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="我的题库"
            placeholderTextColor={colors.textSubtle}
            style={styles.input}
            accessibilityLabel="题库名称"
          />

          <View style={styles.toolRow}>
            <AppButton
              label="新增题目"
              icon={FilePlus2}
              onPress={() => setEditingQuestion(null)}
              style={styles.toolButton}
            />
            <AppButton
              label="从文本导入"
              icon={TextSelect}
              variant="secondary"
              onPress={() => setImportVisible(true)}
              style={styles.toolButton}
            />
          </View>

          <View style={styles.listHeader}>
            <Text style={styles.listTitle}>题目列表</Text>
            <Text style={styles.listCount}>{questions.length} 题</Text>
          </View>

          {questions.length === 0 ? (
            <Text style={styles.emptyText}>
              还没有题目：手动「新增题目」，或把面经/笔记「从文本导入」让 AI 帮你出题。
            </Text>
          ) : null}

          {onOpenManager ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="管理其它题库"
              onPress={onOpenManager}
              style={({ pressed }) => [styles.managerLink, pressed && styles.pressed]}
            >
              <Text style={styles.managerLinkText}>管理其它题库（切换 / 新建）</Text>
            </Pressable>
          ) : null}

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
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`编辑题目 ${question.title}`}
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
                  style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
                >
                  <Pencil size={15} color={colors.textSecondary} strokeWidth={2} />
                </Pressable>
                {confirmingDelete ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`确认删除题目 ${question.title}`}
                    onPress={() => {
                      mutatePackage((bank) => removeQuestion(bank, question.id));
                      setConfirmingDeleteId(null);
                    }}
                    style={({ pressed }) => [styles.deleteConfirmButton, pressed && styles.pressed]}
                  >
                    <Text style={styles.deleteConfirmText}>确认</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`删除题目 ${question.title}`}
                    onPress={() => setConfirmingDeleteId(question.id)}
                    style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
                  >
                    <Trash2 size={15} color={colors.danger} strokeWidth={2} />
                  </Pressable>
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
  fieldLabel: { ...typography.caption, color: colors.textMuted, fontWeight: '600', marginBottom: spacing.xs },
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
  toolRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  toolButton: { flex: 1 },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  listTitle: { ...typography.bodyStrong, color: colors.text, fontSize: 13 },
  listCount: { ...typography.caption, color: colors.textMuted },
  emptyText: { ...typography.caption, color: colors.textMuted, lineHeight: 18, marginBottom: spacing.sm },
  managerLink: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
    marginBottom: spacing.xs,
  },
  managerLinkText: { ...typography.caption, color: colors.primary, fontWeight: '600' },
  questionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  questionMain: { flex: 1 },
  questionTitle: { ...typography.bodyStrong, color: colors.text, fontSize: 13, lineHeight: 18 },
  questionMetaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 3 },
  questionMeta: { ...typography.caption, color: colors.textMuted, fontSize: 11 },
  iconButton: {
    width: 30,
    height: 30,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteConfirmButton: {
    paddingHorizontal: 8,
    minHeight: 30,
    borderRadius: radii.sm,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.borderWarm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteConfirmText: { ...typography.caption, color: colors.danger, fontSize: 11, fontWeight: '700' },
  pressed: { opacity: 0.75 },
});
