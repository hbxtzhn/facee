import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { MoreHorizontal } from 'lucide-react-native';
import { useQuestionBankStore, type LocalEditsDecision } from '../../question-bank/store';
import type { InstalledBankSummary } from '../../question-bank/types';
import { AppButton } from '../../components/ui';
import { colors, spacing, typography } from '../../theme';
import { ModalSheet, SheetError, type SheetPresentation } from './ModalSheet';
import { InlineNote, LIST_ICON, ListSection, TextAction, listStyles } from './components/list';
import { isBankEditable, isOnlineBank } from './bank-contract';
import { errorMessage } from './bank-update-copy';
import { describeLastCheck, useBankUpdateRecords, useUpdateBank } from './bank-updates';
import type { BankUpdateRecord } from '../../question-bank/update-history';
import { useBankUrlInstall } from './useBankUrlInstall';
import { BankInstallFeedback } from './BankUrlDialog';
import { OFFICIAL_BANK_URL } from './official-bank';

/**
 * 题库管理（BankManagerScreen 的正文）：线上 / 本地两组纯列表。
 * 点按行切换当前题库；每行一个「⋯」展开行内操作（更新 / 复制 / 编辑 / 信息 / 删除），
 * 删除与「已修改」库的更新都在行内二次确认。线上题库只能更新，要改题先复制为本地。
 */
export function BankManagerModal({
  visible,
  onClose,
  onEditBank,
  onBankCopied,
  onCreateLocal,
  onOpenOnlineBanks,
  presentation,
}: {
  visible: boolean;
  onClose: () => void;
  onEditBank: (bankId: string) => void;
  onBankCopied: (bankId: string) => void;
  onCreateLocal: () => void;
  /** 打开「线上题库」页（官方题库 / 按网址添加） */
  onOpenOnlineBanks: () => void;
  /** 默认弹窗；BankManagerScreen 传 screen 作为栈页面正文 */
  presentation?: SheetPresentation;
}) {
  const banks = useQuestionBankStore((state) => state.banks);
  const banksLoading = useQuestionBankStore((state) => state.banksLoading);
  const refreshBanks = useQuestionBankStore((state) => state.refreshBanks);
  const switchBank = useQuestionBankStore((state) => state.switchBank);
  const copyBank = useQuestionBankStore((state) => state.copyBank);
  const deleteLocalBank = useQuestionBankStore((state) => state.deleteLocalBank);
  const setBankSourceUrl = useQuestionBankStore((state) => state.setBankSourceUrl);
  /** 上次在「按网址添加」里填过的地址：关联更新地址时作为预填 */
  const lastEnteredUrl = useQuestionBankStore((state) => state.sourceUrl);
  const installing = useQuestionBankStore((state) => state.installing);
  const installProgress = useQuestionBankStore((state) => state.installProgress);
  const { records, remember, forget } = useBankUpdateRecords(banks, visible);
  const updateBank = useUpdateBank(remember);
  const officialFlow = useBankUrlInstall({ updateBank });

  const [activeBusyId, setBusyId] = useState<string | null>(null);
  const busyId = activeBusyId ?? (installing || officialFlow.busy ? '__operation__' : null);
  const busy = busyId !== null;
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [informationId, setInformationId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [confirmingUpdateId, setConfirmingUpdateId] = useState<string | null>(null);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [linkDraft, setLinkDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setError(null);
    setNotice(null);
    setExpandedId(null);
    setConfirmingDeleteId(null);
    setConfirmingUpdateId(null);
    setInformationId(null);
    void refreshBanks();
  }, [visible, refreshBanks]);

  /** 统一的忙碌 / 错误 / 提示包装 */
  async function run(bankId: string, operation: () => Promise<void>) {
    if (busyId) return;
    setBusyId(bankId);
    setError(null);
    setNotice(null);
    try {
      await operation();
    } catch (operationError) {
      setError(errorMessage(operationError));
    } finally {
      setBusyId(null);
    }
  }

  const handleSwitch = (catalogId: string) => run(catalogId, () => switchBank(catalogId));

  const handleCopy = (catalogId: string) => run(catalogId, async () => {
    const bankId = await copyBank(catalogId);
    onBankCopied(bankId);
  });

  function toggleExpanded(catalogId: string) {
    setExpandedId((current) => (current === catalogId ? null : catalogId));
    setConfirmingDeleteId(null);
    setConfirmingUpdateId(null);
    setLinkingId(null);
  }

  function startLinking(catalogId: string) {
    setLinkingId(catalogId);
    setLinkDraft(lastEnteredUrl.trim());
    setError(null);
  }

  const handleLink = (catalogId: string, title: string) => run(catalogId, async () => {
    await setBankSourceUrl(catalogId, linkDraft);
    setLinkingId(null);
    setNotice(`「${title}」已关联更新地址，可以在线更新了。`);
  });

  const handleUpdate = (catalogId: string, title: string, decision?: LocalEditsDecision) => run(catalogId, async () => {
    setConfirmingUpdateId(null);
    const outcome = await updateBank(catalogId, title, decision);
    // 需确认：尚未下载也未改动任何内容，等用户选择后带选项重试
    if (outcome.kind === 'needsConfirmation') setConfirmingUpdateId(catalogId);
    else if (outcome.kind === 'done') setNotice(outcome.message);
    else setError(outcome.message);
  });

  const handleDelete = (bankId: string) => run(bankId, async () => {
    const wasActive = banks.some((bank) => bank.catalogId === bankId && bank.active);
    await deleteLocalBank(bankId);
    setConfirmingDeleteId(null);
    setExpandedId((current) => (current === bankId ? null : current));
    setInformationId((current) => (current === bankId ? null : current));
    await forget(bankId);
    if (wasActive) {
      const current = useQuestionBankStore.getState().catalog;
      setNotice(current ? `已切换到「${current.title}」。` : '题库已删除，当前没有可用题库。');
    }
  });

  const onlineBanks = banks.filter(isOnlineBank);
  const localBanks = banks.filter((bank) => !isOnlineBank(bank));
  const empty = !banksLoading && banks.length === 0;

  const renderRow = (bank: InstalledBankSummary) => (
    <BankRow
      key={bank.namespace}
      bank={bank}
      busy={busy}
      updating={busyId === bank.catalogId}
      record={records[bank.catalogId]}
      expanded={expandedId === bank.catalogId}
      showInformation={informationId === bank.catalogId}
      confirmingDelete={confirmingDeleteId === bank.catalogId}
      confirmingUpdate={confirmingUpdateId === bank.catalogId}
      linking={linkingId === bank.catalogId}
      linkDraft={linkDraft}
      onSwitch={() => void handleSwitch(bank.catalogId)}
      onToggleExpanded={() => toggleExpanded(bank.catalogId)}
      onUpdate={(decision) => void handleUpdate(bank.catalogId, bank.title, decision)}
      onCancelUpdate={() => setConfirmingUpdateId(null)}
      onCopy={() => void handleCopy(bank.catalogId)}
      onEdit={() => onEditBank(bank.catalogId)}
      onToggleInformation={() => setInformationId((current) => (current === bank.catalogId ? null : bank.catalogId))}
      onAskDelete={() => setConfirmingDeleteId(bank.catalogId)}
      onCancelDelete={() => setConfirmingDeleteId(null)}
      onDelete={() => void handleDelete(bank.catalogId)}
      onStartLinking={() => startLinking(bank.catalogId)}
      onChangeLinkDraft={setLinkDraft}
      onSaveLink={() => void handleLink(bank.catalogId, bank.title)}
      onCancelLinking={() => setLinkingId(null)}
    />
  );

  return (
    <ModalSheet
      visible={visible}
      title="管理题库"
      hint="点按题库切换当前使用；「⋯」里有更新、复制、信息与删除。线上题库只能更新，想改题先复制为本地。"
      onClose={() => { if (!busy) onClose(); }}
      dismissDisabled={busy}
      presentation={presentation}
      footer={
        <View style={styles.footer}>
          <TextAction label="新建本地题库" tone="primary" onPress={onCreateLocal} disabled={busy} />
          <TextAction label="线上题库" onPress={onOpenOnlineBanks} disabled={busy} />
          {presentation !== 'screen' ? (
            <TextAction label="完成" onPress={onClose} disabled={busy} style={styles.footerEnd} />
          ) : null}
        </View>
      }
    >
      <SheetError message={error} />
      {busy ? (
        <View style={styles.busyRow}>
          <ActivityIndicator size="small" color={colors.textSecondary} />
          <Text style={styles.busyText} accessibilityLiveRegion="polite">
            {installProgress?.label ?? '正在处理题库…'}
          </Text>
        </View>
      ) : null}
      {notice ? <View style={styles.notice}><InlineNote text={notice} tone="default" live /></View> : null}
      {/* 仅首次加载（列表为空）显示；切换题库时不显示，避免该行反复插入/移除导致抖动 */}
      {banksLoading && banks.length === 0 ? <InlineNote text="正在读取题库列表…" /> : null}

      {empty ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>本机还没有题库</Text>
          <Text style={styles.emptyBody}>装上 FaceE 官方题库就能开始刷题，也可以新建一个空的本地题库自己出题。</Text>
          <AppButton
            label="安装官方题库"
            onPress={() => void officialFlow.submit(OFFICIAL_BANK_URL)}
            loading={officialFlow.busy}
            disabled={busy && !officialFlow.busy}
            style={styles.emptyButton}
          />
          <BankInstallFeedback flow={officialFlow} />
        </View>
      ) : null}

      {!empty && banks.length > 0 ? (
        <>
          <ListSection title={`线上题库 · ${onlineBanks.length}`} style={styles.firstSection}>
            {onlineBanks.length === 0 ? (
              <View style={styles.sectionEmpty}>
                <InlineNote text="还没有线上题库。线上题库可随时更新到最新版本。" />
                <View style={styles.inlineActions}>
                  <TextAction
                    label="安装官方题库"
                    tone="primary"
                    disabled={busy}
                    onPress={() => void officialFlow.submit(OFFICIAL_BANK_URL)}
                    style={styles.leadingAction}
                  />
                  <TextAction label="浏览线上题库" disabled={busy} onPress={onOpenOnlineBanks} />
                </View>
                <BankInstallFeedback flow={officialFlow} />
              </View>
            ) : onlineBanks.map(renderRow)}
          </ListSection>
          <ListSection title={`本地题库 · ${localBanks.length}`}>
            {localBanks.length === 0 ? (
              <View style={styles.sectionEmpty}>
                <InlineNote text="还没有本地题库。新建一个，或把线上题库「复制为本地编辑」。" />
              </View>
            ) : localBanks.map(renderRow)}
          </ListSection>
          {localBanks.some((bank) => bank.questionCount === 0) ? (
            <Text style={styles.tip}>空题库也可以直接保存，稍后在编辑里加题。</Text>
          ) : null}
        </>
      ) : null}
    </ModalSheet>
  );
}

/** 单个题库行：主体点按切换，「⋯」展开行内操作与信息 */
function BankRow({
  bank, busy, updating, record, expanded, showInformation, confirmingDelete, confirmingUpdate,
  linking, linkDraft,
  onSwitch, onToggleExpanded, onUpdate, onCancelUpdate, onCopy, onEdit, onToggleInformation,
  onAskDelete, onCancelDelete, onDelete, onStartLinking, onChangeLinkDraft, onSaveLink, onCancelLinking,
}: {
  bank: InstalledBankSummary;
  busy: boolean;
  updating: boolean;
  record: BankUpdateRecord | undefined;
  expanded: boolean;
  showInformation: boolean;
  confirmingDelete: boolean;
  confirmingUpdate: boolean;
  linking: boolean;
  linkDraft: string;
  onSwitch: () => void;
  onToggleExpanded: () => void;
  onUpdate: (decision?: LocalEditsDecision) => void;
  onCancelUpdate: () => void;
  onCopy: () => void;
  onEdit: () => void;
  onToggleInformation: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
  onStartLinking: () => void;
  onChangeLinkDraft: (value: string) => void;
  onSaveLink: () => void;
  onCancelLinking: () => void;
}) {
  const online = isOnlineBank(bank);
  const editable = isBankEditable(bank);
  const meta = [
    `${bank.questionCount} 题`,
    bank.version ? `v${bank.version}` : null,
    bank.updatedAt ? `更新于 ${bank.updatedAt.slice(0, 10)}` : null,
  ].filter(Boolean).join(' · ');
  const sourceText = online
    ? '线上题库，可在线更新'
    : bank.sourceUrl
      ? '线上下载（本机改过），可在线更新'
      : '本地题库';

  return (
    <View style={styles.row}>
      <View style={styles.rowMain}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`切换到题库 ${bank.title}`}
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={onSwitch}
          style={({ pressed }) => [styles.rowBody, busy && styles.disabled, pressed && styles.pressed]}
        >
          <View style={styles.titleLine}>
            <Text style={[styles.title, bank.active && styles.titleActive]} numberOfLines={1}>{bank.title}</Text>
            {bank.active ? <Text style={styles.activeMark}>使用中</Text> : null}
            {bank.locallyModified ? (
              <Text style={styles.modifiedMark} accessibilityLabel="本地已修改">已修改</Text>
            ) : null}
          </View>
          <Text style={styles.meta}>{meta}</Text>
          {bank.sourceUrl ? <Text style={styles.meta}>最近检查：{describeLastCheck(record)}</Text> : null}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`更多操作 ${bank.title}`}
          accessibilityState={{ expanded }}
          onPress={onToggleExpanded}
          hitSlop={6}
          style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}
        >
          <MoreHorizontal {...LIST_ICON} />
        </Pressable>
      </View>

      {expanded ? (
        <View style={styles.actions}>
          {confirmingUpdate ? (
            <View style={styles.confirm} accessibilityRole="alert">
              <InlineNote text="本地有修改，更新会覆盖它们。" tone="danger" />
              <View style={styles.inlineActions}>
                <TextAction
                  label="另存副本后更新"
                  accessibilityLabel={`另存副本后更新题库 ${bank.title}`}
                  tone="primary"
                  disabled={busy}
                  onPress={() => onUpdate('keepCopy')}
                  style={styles.leadingAction}
                />
                <TextAction
                  label="直接覆盖"
                  accessibilityLabel={`直接覆盖更新题库 ${bank.title}`}
                  tone="danger"
                  disabled={busy}
                  onPress={() => onUpdate('overwrite')}
                />
                <TextAction label="取消" accessibilityLabel="取消更新" tone="muted" disabled={busy} onPress={onCancelUpdate} />
              </View>
            </View>
          ) : null}
          {confirmingDelete ? (
            <View style={styles.confirm} accessibilityRole="alert">
              <InlineNote text={`删除「${bank.title}」后无法恢复。`} tone="danger" />
              <View style={styles.inlineActions}>
                <TextAction
                  label="确认删除"
                  accessibilityLabel={`确认删除题库 ${bank.title}`}
                  tone="danger"
                  disabled={busy}
                  onPress={onDelete}
                  style={styles.leadingAction}
                />
                <TextAction label="取消" accessibilityLabel="取消删除" tone="muted" disabled={busy} onPress={onCancelDelete} />
              </View>
            </View>
          ) : null}
          {!confirmingUpdate && !confirmingDelete ? (
            <View style={styles.inlineActions}>
              {editable ? (
                <TextAction label="编辑" accessibilityLabel={`编辑题库 ${bank.title}`} tone="primary" disabled={busy}
                  onPress={onEdit} style={styles.leadingAction} />
              ) : null}
              {bank.sourceUrl ? (
                <TextAction
                  label={updating ? '更新中' : '更新'}
                  accessibilityLabel={updating ? `正在更新题库 ${bank.title}` : `在线更新题库 ${bank.title}`}
                  tone={editable ? 'default' : 'primary'}
                  disabled={busy}
                  onPress={() => onUpdate()}
                  style={editable ? undefined : styles.leadingAction}
                />
              ) : null}
              <TextAction
                label={online ? '复制为本地编辑' : '复制'}
                accessibilityLabel={`复制题库 ${bank.title} 为本地可编辑副本`}
                disabled={busy}
                onPress={onCopy}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`题库信息 ${bank.title}`}
                accessibilityState={{ disabled: busy, expanded: showInformation }}
                disabled={busy}
                onPress={onToggleInformation}
                style={({ pressed }) => [styles.infoAction, busy && styles.disabled, pressed && styles.pressed]}
              >
                <Text style={styles.infoActionText}>{showInformation ? '收起信息' : '信息'}</Text>
              </Pressable>
              <TextAction label="删除" accessibilityLabel={`删除题库 ${bank.title}`} tone="danger" disabled={busy}
                onPress={onAskDelete} />
            </View>
          ) : null}

          {showInformation ? (
            <View style={styles.information}>
              <Text style={styles.infoText}>题目数量：{bank.questionCount} 题</Text>
              <Text style={styles.infoText}>版本：{bank.version ?? '未提供'}</Text>
              <Text style={styles.infoText}>题库更新日期：{bank.updatedAt?.slice(0, 10) ?? '未提供'}</Text>
              <Text style={styles.infoText}>来源：{sourceText}</Text>
              {bank.sourceUrl ? <Text selectable style={styles.infoText}>来源地址：{bank.sourceUrl}</Text> : null}
              {!bank.sourceUrl && !online ? (
                linking ? (
                  <View style={styles.linkBox}>
                    <TextInput
                      value={linkDraft}
                      onChangeText={onChangeLinkDraft}
                      placeholder="https://github.com/.../releases/latest/download/question-bank.zip"
                      placeholderTextColor={colors.textSubtle}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="url"
                      editable={!busy}
                      accessibilityLabel={`题库 ${bank.title} 的更新地址`}
                      style={listStyles.input}
                    />
                    <View style={styles.inlineActions}>
                      <TextAction
                        label="保存"
                        accessibilityLabel={`保存题库 ${bank.title} 的更新地址`}
                        tone="primary"
                        disabled={busy || !linkDraft.trim()}
                        onPress={onSaveLink}
                        style={styles.leadingAction}
                      />
                      <TextAction label="取消" accessibilityLabel="取消关联更新地址" tone="muted" disabled={busy} onPress={onCancelLinking} />
                    </View>
                  </View>
                ) : (
                  <TextAction
                    label="关联更新地址（从线上下载过、但没有更新按钮时使用）"
                    accessibilityLabel={`关联更新地址 ${bank.title}`}
                    tone="primary"
                    disabled={busy}
                    onPress={onStartLinking}
                    style={styles.linkAction}
                  />
                )
              ) : null}
              <Text style={styles.infoText}>最近检查：{record
                ? new Date(record.checkedAt).toLocaleString() : '尚未检查更新'}</Text>
              {record ? (
                <Text style={[styles.infoText, record.status === 'failed' && styles.failed]}>
                  最近结果：{record.message}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  footerEnd: { marginLeft: 'auto' },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  busyText: { ...typography.caption, color: colors.textMuted },
  notice: { marginBottom: spacing.sm },
  firstSection: { marginTop: spacing.md },
  emptyState: { paddingVertical: spacing.xxl },
  emptyTitle: { ...typography.heading, color: colors.text },
  emptyBody: { ...typography.body, color: colors.textMuted, marginTop: spacing.sm },
  emptyButton: { marginTop: spacing.lg, alignSelf: 'flex-start', minWidth: 160 },
  sectionEmpty: {
    paddingVertical: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  tip: { ...typography.caption, color: colors.textSubtle, marginTop: spacing.sm },
  row: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowBody: { flex: 1, paddingVertical: spacing.lg, minHeight: 52 },
  titleLine: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  title: { ...typography.body, color: colors.text, flexShrink: 1 },
  titleActive: { fontWeight: '600' },
  activeMark: { ...typography.caption, color: colors.primary, fontWeight: '600' },
  modifiedMark: { ...typography.caption, color: colors.textMuted },
  meta: { ...typography.caption, color: colors.textMuted, marginTop: 2, lineHeight: 18 },
  moreButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  actions: { paddingBottom: spacing.md },
  inlineActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing.xs },
  leadingAction: { paddingLeft: 0 },
  confirm: { gap: spacing.xs },
  infoAction: { minHeight: 44, minWidth: 44, paddingHorizontal: spacing.sm, alignItems: 'center', justifyContent: 'center' },
  infoActionText: { ...typography.label, fontSize: 14, color: colors.text },
  information: {
    marginTop: spacing.xs,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: spacing.xs,
  },
  infoText: { ...typography.caption, color: colors.textSecondary, lineHeight: 18 },
  failed: { color: colors.danger },
  linkBox: { gap: spacing.xs },
  linkAction: { alignItems: 'flex-start', paddingHorizontal: 0 },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.6 },
});
