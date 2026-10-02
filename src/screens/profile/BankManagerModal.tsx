import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Database, FolderPlus, Download, Pencil, Trash2, Copy, RefreshCw } from 'lucide-react-native';
import { useQuestionBankStore } from '../../question-bank/store';
import { colors, radii, spacing, typography } from '../../theme';
import { ModalSheet, SheetActions, SheetError } from './ModalSheet';

/**
 * 题库管理弹窗：列出本机全部题库（本地 + 线上），点按切换当前使用；
 * 任意题库可一键复制成本地可编辑副本；本地题库可进入编辑，所有题库可删除（行内二次确认）。
 */
export function BankManagerModal({
  visible,
  onClose,
  onEditBank,
  onBankCopied,
  onCreateLocal,
  onAddOnline,
}: {
  visible: boolean;
  onClose: () => void;
  onEditBank: (bankId: string) => void;
  onBankCopied: (bankId: string) => void;
  onCreateLocal: () => void;
  onAddOnline: () => void;
}) {
  const banks = useQuestionBankStore((state) => state.banks);
  const banksLoading = useQuestionBankStore((state) => state.banksLoading);
  const refreshBanks = useQuestionBankStore((state) => state.refreshBanks);
  const switchBank = useQuestionBankStore((state) => state.switchBank);
  const copyBank = useQuestionBankStore((state) => state.copyBank);
  const deleteLocalBank = useQuestionBankStore((state) => state.deleteLocalBank);
  const updateBank = useQuestionBankStore((state) => state.updateBank);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setError(null);
    setNotice(null);
    setConfirmingDeleteId(null);
    void refreshBanks();
  }, [visible, refreshBanks]);

  async function handleSwitch(catalogId: string) {
    if (busyId) return;
    setBusyId(catalogId);
    setError(null);
    try {
      await switchBank(catalogId);
    } catch (switchError) {
      setError(switchError instanceof Error ? switchError.message : String(switchError));
    } finally {
      setBusyId(null);
    }
  }

  async function handleCopy(catalogId: string) {
    if (busyId) return;
    setBusyId(catalogId);
    setError(null);
    try {
      const bankId = await copyBank(catalogId);
      onBankCopied(bankId);
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : String(copyError));
    } finally {
      setBusyId(null);
    }
  }

  async function handleUpdate(catalogId: string, title: string) {
    if (busyId) return;
    setBusyId(catalogId);
    setError(null);
    setNotice(null);
    try {
      const { added, removed } = await updateBank(catalogId);
      setNotice(
        removed > 0
          ? `「${title}」更新完成：新增 ${added} 题，移除 ${removed} 题。`
          : `「${title}」更新完成：新增 ${added} 题。`,
      );
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : String(updateError));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(bankId: string) {
    if (busyId) return;
    setBusyId(bankId);
    setError(null);
    try {
      await deleteLocalBank(bankId);
      setConfirmingDeleteId(null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <ModalSheet
      visible={visible}
      title="管理题库"
      hint="点按题库切换当前使用；「复制」把任意题库（含线上）复制成本地可编辑副本，编辑不影响原题库。"
      onClose={onClose}
      footer={
        <View style={styles.footerActions}>
          <View style={styles.actionPair}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="新建本地题库"
              onPress={onCreateLocal}
              style={({ pressed }) => [styles.createButton, pressed && styles.pressed]}
            >
              <FolderPlus size={15} color={colors.primary} strokeWidth={2} />
              <Text style={styles.createButtonText}>新建本地题库</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="添加线上题库"
              onPress={onAddOnline}
              style={({ pressed }) => [styles.onlineButton, pressed && styles.pressed]}
            >
              <Download size={15} color={colors.textSecondary} strokeWidth={2} />
              <Text style={styles.onlineButtonText}>添加线上题库</Text>
            </Pressable>
          </View>
          <SheetActions confirmLabel="完成" onCancel={onClose} onConfirm={onClose} cancelLabel="" />
        </View>
      }
    >
      <SheetError message={error} />
      {notice ? (
        <Text style={styles.noticeText} accessibilityLiveRegion="polite">
          {notice}
        </Text>
      ) : null}
      {/* 仅首次加载（列表为空）显示；切换题库时不显示，避免该行反复插入/移除导致弹窗抖动 */}
      {banksLoading && banks.length === 0 ? (
        <Text style={styles.loadingText}>正在读取题库列表…</Text>
      ) : null}
      {!banksLoading && banks.length === 0 ? (
        <Text style={styles.emptyText}>本机还没有题库，从下方新建或添加。</Text>
      ) : null}
      {banks.map((bank) => {
        const confirmingDelete = confirmingDeleteId === bank.catalogId;
        return (
          <View key={bank.namespace} style={[styles.bankRow, bank.active && styles.bankRowActive]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`切换到题库 ${bank.title}`}
              onPress={() => void handleSwitch(bank.catalogId)}
              style={styles.bankMain}
              disabled={busyId !== null}
            >
              <View style={styles.bankIconBox}>
                <Database size={16} color={bank.active ? colors.primary : colors.textMuted} strokeWidth={2} />
              </View>
              <View style={styles.bankInfo}>
                <View style={styles.bankTitleRow}>
                  <Text style={styles.bankTitle} numberOfLines={1}>{bank.title}</Text>
                  {bank.active ? (
                    <View style={styles.activeBadge}>
                      <Text style={styles.activeBadgeText}>使用中</Text>
                    </View>
                  ) : null}
                </View>
                <View style={styles.bankMetaRow}>
                  <Text style={styles.bankMeta}>{bank.questionCount} 题</Text>
                  {bank.version ? <Text style={styles.bankMeta}>v{bank.version}</Text> : null}
                  {bank.updatedAt ? (
                    <Text style={styles.bankMeta}>更新于 {bank.updatedAt.slice(0, 10)}</Text>
                  ) : null}
                  <View style={[styles.sourceBadge, bank.source === 'local' && styles.sourceBadgeLocal]}>
                    <Text style={[styles.sourceBadgeText, bank.source === 'local' && styles.sourceBadgeTextLocal]}>
                      {bank.source === 'local' ? '本地' : '线上'}
                    </Text>
                  </View>
                </View>
              </View>
            </Pressable>
            <View style={styles.bankActions}>
              {bank.sourceUrl ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={busyId === bank.catalogId ? `正在更新题库 ${bank.title}` : `在线更新题库 ${bank.title}`}
                  onPress={() => void handleUpdate(bank.catalogId, bank.title)}
                  style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
                  disabled={busyId !== null}
                >
                  <RefreshCw
                    size={15}
                    color={busyId === bank.catalogId ? colors.primary : colors.textSecondary}
                    strokeWidth={2}
                  />
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`复制题库 ${bank.title} 为本地可编辑副本`}
                onPress={() => void handleCopy(bank.catalogId)}
                style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
                disabled={busyId !== null}
              >
                <Copy size={15} color={colors.textSecondary} strokeWidth={2} />
              </Pressable>
              {bank.source === 'local' ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`编辑题库 ${bank.title}`}
                  onPress={() => onEditBank(bank.catalogId)}
                  style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
                >
                  <Pencil size={15} color={colors.textSecondary} strokeWidth={2} />
                </Pressable>
              ) : null}
              {confirmingDelete ? (
                <View style={styles.confirmRow}>
                  <Text style={styles.confirmText}>确认删除？</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`确认删除题库 ${bank.title}`}
                    onPress={() => void handleDelete(bank.catalogId)}
                    style={({ pressed }) => [styles.confirmYes, pressed && styles.pressed]}
                  >
                    <Text style={styles.confirmYesText}>删</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="取消删除"
                    onPress={() => setConfirmingDeleteId(null)}
                    style={({ pressed }) => [styles.confirmNo, pressed && styles.pressed]}
                  >
                    <Text style={styles.confirmNoText}>取消</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`删除题库 ${bank.title}`}
                  onPress={() => setConfirmingDeleteId(bank.catalogId)}
                  style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
                >
                  <Trash2 size={15} color={colors.danger} strokeWidth={2} />
                </Pressable>
              )}
            </View>
          </View>
        );
      })}
      {banks.some((bank) => bank.source === 'local' && bank.questionCount === 0) ? (
        <Text style={styles.tipText}>空题库也可以直接保存，稍后在编辑里加题。</Text>
      ) : null}
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  footerActions: { gap: spacing.sm },
  actionPair: { flexDirection: 'row', gap: spacing.sm },
  createButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 42,
    borderRadius: radii.sm,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primaryMuted,
  },
  createButtonText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  onlineButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 42,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
  },
  onlineButtonText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  loadingText: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm },
  emptyText: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm, lineHeight: 18 },
  bankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  bankRowActive: { borderColor: colors.primaryMuted, backgroundColor: colors.primarySoft },
  bankMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  bankIconBox: {
    width: 30,
    height: 30,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bankInfo: { flex: 1 },
  bankTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  bankTitle: { ...typography.bodyStrong, color: colors.text, fontSize: 13, flexShrink: 1 },
  activeBadge: {
    backgroundColor: colors.primary,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radii.pill,
  },
  activeBadgeText: { ...typography.caption, color: colors.surface, fontSize: 10, fontWeight: '700' },
  bankMetaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 2 },
  bankMeta: { ...typography.caption, color: colors.textMuted, fontSize: 11 },
  sourceBadge: {
    backgroundColor: colors.surfaceSubtle,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radii.pill,
  },
  sourceBadgeLocal: { backgroundColor: colors.surfaceWarm },
  sourceBadgeText: { ...typography.caption, color: colors.textMuted, fontSize: 10, fontWeight: '600' },
  sourceBadgeTextLocal: { color: colors.primary },
  bankActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  iconButton: {
    width: 32,
    height: 32,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  confirmText: { ...typography.caption, color: colors.danger, fontSize: 11, fontWeight: '600' },
  confirmYes: {
    paddingHorizontal: 8,
    minHeight: 26,
    borderRadius: radii.sm,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.borderWarm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmYesText: { ...typography.caption, color: colors.danger, fontSize: 11, fontWeight: '700' },
  confirmNo: { paddingHorizontal: 6, minHeight: 26, alignItems: 'center', justifyContent: 'center' },
  confirmNoText: { ...typography.caption, color: colors.textMuted, fontSize: 11 },
  noticeText: {
    ...typography.caption,
    color: colors.success,
    fontSize: 11,
    marginBottom: spacing.sm,
    lineHeight: 16,
  },
  tipText: { ...typography.caption, color: colors.textSubtle, fontSize: 11, marginTop: spacing.xs },
  pressed: { opacity: 0.75 },
});
