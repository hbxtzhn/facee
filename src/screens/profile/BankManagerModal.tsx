import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Database, FolderPlus, Download, Pencil, Trash2, Copy, RefreshCw, Info } from 'lucide-react-native';
import {
  loadBankUpdateRecord, saveBankUpdateRecord, removeBankUpdateRecord, type BankUpdateRecord,
} from '../../question-bank/update-history';
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
  const installing = useQuestionBankStore((state) => state.installing);
  const installProgress = useQuestionBankStore((state) => state.installProgress);
  const [activeBusyId, setBusyId] = useState<string | null>(null);
  const busyId = activeBusyId ?? (installing ? '__operation__' : null);
  const busy = busyId !== null;
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [informationId, setInformationId] = useState<string | null>(null);
  const [updateRecords, setUpdateRecords] = useState<Record<string, BankUpdateRecord>>({});

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    void Promise.all(banks.map(async (bank) => [bank.catalogId, await loadBankUpdateRecord(bank.catalogId)] as const))
      .then((records) => {
        if (!alive) return;
        const loaded: Record<string, BankUpdateRecord> = {};
        for (const [id, record] of records) if (record) loaded[id] = record;
        setUpdateRecords((current) => ({ ...loaded, ...current }));
      });
    return () => { alive = false; };
  }, [visible, banks]);

  async function rememberUpdate(bankId: string, status: BankUpdateRecord['status'], message: string) {
    const record: BankUpdateRecord = { checkedAt: new Date().toISOString(), status, message };
    setUpdateRecords((current) => ({ ...current, [bankId]: record }));
    // 诊断信息落盘失败不能把已成功的更新误报为题库更新失败。
    try { await saveBankUpdateRecord(bankId, record); } catch { /* 本次结果仍可查看 */ }
  }

  useEffect(() => {
    if (!visible) return;
    setError(null);
    setNotice(null);
    setConfirmingDeleteId(null);
    setInformationId(null);
    void refreshBanks();
  }, [visible, refreshBanks]);

  async function handleSwitch(catalogId: string) {
    if (busyId) return;
    setBusyId(catalogId);
    setError(null);
    setNotice(null);
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
    setNotice(null);
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
      const { added, removed, updated } = await updateBank(catalogId);
      const message = !updated
        ? `「${title}」已是最新版本。`
        : removed > 0
          ? `「${title}」更新完成：新增 ${added} 题，移除 ${removed} 题。`
          : `「${title}」更新完成：新增 ${added} 题。`;
      setNotice(message);
      await rememberUpdate(catalogId, updated ? 'updated' : 'unchanged', message);
    } catch (updateError) {
      const message = updateError instanceof Error ? updateError.message : String(updateError);
      setError(message);
      await rememberUpdate(catalogId, 'failed', message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(bankId: string) {
    if (busyId) return;
    const wasActive = banks.some((bank) => bank.catalogId === bankId && bank.active);
    setBusyId(bankId);
    setError(null);
    setNotice(null);
    try {
      await deleteLocalBank(bankId);
      setConfirmingDeleteId(null);
      setInformationId((current) => current === bankId ? null : current);
      setUpdateRecords((current) => {
        const next = { ...current };
        delete next[bankId];
        return next;
      });
      try { await removeBankUpdateRecord(bankId); } catch { /* 不影响删除结果 */ }
      if (wasActive) {
        const current = useQuestionBankStore.getState().catalog;
        setNotice(current ? `已切换到「${current.title}」。` : '题库已删除，当前没有可用题库。');
      }
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
      onClose={() => { if (!busy) onClose(); }}
      dismissDisabled={busy}
      footer={
        <View style={styles.footerActions}>
          <View style={styles.actionPair}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="新建本地题库"
              onPress={onCreateLocal}
              disabled={busy}
              accessibilityState={{ disabled: busy }}
              style={({ pressed }) => [styles.createButton, busy && styles.disabled, pressed && styles.pressed]}
            >
              <FolderPlus size={15} color={colors.primary} strokeWidth={2} />
              <Text style={styles.createButtonText}>新建本地题库</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="添加线上题库"
              onPress={onAddOnline}
              disabled={busy}
              accessibilityState={{ disabled: busy }}
              style={({ pressed }) => [styles.onlineButton, busy && styles.disabled, pressed && styles.pressed]}
            >
              <Download size={15} color={colors.textSecondary} strokeWidth={2} />
              <Text style={styles.onlineButtonText}>添加线上题库</Text>
            </Pressable>
          </View>
          <SheetActions confirmLabel="完成" onCancel={onClose} onConfirm={onClose} confirmDisabled={busy} cancelLabel="" />
        </View>
      }
    >
      <SheetError message={error} />
      {busy ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm }}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.loadingText} accessibilityLiveRegion="polite">
            {installProgress?.label ?? '正在处理题库…'}
          </Text>
        </View>
      ) : null}
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
          <View key={bank.namespace} style={[styles.bankCard, bank.active && styles.bankRowActive]}>
            <View style={styles.bankRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`切换到题库 ${bank.title}`}
              onPress={() => void handleSwitch(bank.catalogId)}
              style={[styles.bankMain, busy && styles.disabled]}
              disabled={busy}
              accessibilityState={{ disabled: busy }}
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
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`题库信息 ${bank.title}`}
                accessibilityState={{ disabled: busy, expanded: informationId === bank.catalogId }}
                disabled={busy}
                onPress={() => setInformationId((current) => current === bank.catalogId ? null : bank.catalogId)}
                style={({ pressed }) => [styles.iconButton, busy && styles.disabled, pressed && styles.pressed]}
              >
                <Info size={15} color={colors.textSecondary} strokeWidth={2} />
              </Pressable>
              {bank.sourceUrl ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={busyId === bank.catalogId ? `正在更新题库 ${bank.title}` : `在线更新题库 ${bank.title}`}
                  onPress={() => void handleUpdate(bank.catalogId, bank.title)}
                  style={({ pressed }) => [styles.iconButton, busy && styles.disabled, pressed && styles.pressed]}
                  disabled={busy}
                  accessibilityState={{ disabled: busy }}
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
                style={({ pressed }) => [styles.iconButton, busy && styles.disabled, pressed && styles.pressed]}
                disabled={busy}
                accessibilityState={{ disabled: busy }}
              >
                <Copy size={15} color={colors.textSecondary} strokeWidth={2} />
              </Pressable>
              {bank.source === 'local' ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`编辑题库 ${bank.title}`}
                  onPress={() => onEditBank(bank.catalogId)}
                  disabled={busy}
                  accessibilityState={{ disabled: busy }}
                  style={({ pressed }) => [styles.iconButton, busy && styles.disabled, pressed && styles.pressed]}
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
                    disabled={busy}
                    accessibilityState={{ disabled: busy }}
                    onPress={() => void handleDelete(bank.catalogId)}
                    style={({ pressed }) => [styles.confirmYes, busy && styles.disabled, pressed && styles.pressed]}
                  >
                    <Text style={styles.confirmYesText}>删</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="取消删除"
                    disabled={busy}
                    accessibilityState={{ disabled: busy }}
                    onPress={() => setConfirmingDeleteId(null)}
                    style={({ pressed }) => [styles.confirmNo, busy && styles.disabled, pressed && styles.pressed]}
                  >
                    <Text style={styles.confirmNoText}>取消</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`删除题库 ${bank.title}`}
                  disabled={busy}
                  accessibilityState={{ disabled: busy }}
                  onPress={() => setConfirmingDeleteId(bank.catalogId)}
                  style={({ pressed }) => [styles.iconButton, busy && styles.disabled, pressed && styles.pressed]}
                >
                  <Trash2 size={15} color={colors.danger} strokeWidth={2} />
                </Pressable>
              )}
            </View>
            </View>
            {informationId === bank.catalogId ? (
              <View style={styles.information}>
                <Text style={styles.informationTitle}>题库信息</Text>
                <Text style={styles.informationText}>题目数量：{bank.questionCount} 题</Text>
                <Text style={styles.informationText}>版本：{bank.version ?? '未提供'}</Text>
                <Text style={styles.informationText}>题库更新日期：{bank.updatedAt?.slice(0, 10) ?? '未提供'}</Text>
                <Text style={styles.informationText}>来源：{bank.sourceUrl ? '线上下载，可在线更新' : bank.source === 'local' ? '本地题库' : '线上题库'}</Text>
                {bank.sourceUrl ? <Text selectable style={styles.informationText}>来源地址：{bank.sourceUrl}</Text> : null}
                <Text style={styles.informationText}>最近检查：{updateRecords[bank.catalogId]
                  ? new Date(updateRecords[bank.catalogId].checkedAt).toLocaleString() : '尚未检查更新'}</Text>
                {updateRecords[bank.catalogId] ? (
                  <Text style={[styles.informationText, updateRecords[bank.catalogId].status === 'failed' && styles.failedResult]}>
                    最近结果：{updateRecords[bank.catalogId].message}
                  </Text>
                ) : null}
              </View>
            ) : null}
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
  bankCard: {
    padding: spacing.sm,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  bankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  bankRowActive: { borderColor: colors.primaryMuted, backgroundColor: colors.primarySoft },
  bankMain: { flexGrow: 1, flexShrink: 1, flexBasis: 150, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
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
  bankMetaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, marginTop: 2 },
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
  bankActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.xs },
  information: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, gap: spacing.xs },
  informationTitle: { ...typography.caption, color: colors.text, fontWeight: '700' },
  informationText: { ...typography.caption, color: colors.textSecondary, lineHeight: 18 },
  failedResult: { color: colors.danger },
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
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.75 },
});
