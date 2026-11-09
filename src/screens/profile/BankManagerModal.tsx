import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { MoreHorizontal } from 'lucide-react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useBankStore, type BankOrigin, type BankSummary } from '../../bank';
import { colors, spacing, typography } from '../../theme';
import { ModalSheet, SheetError, type SheetPresentation } from './ModalSheet';
import { InlineNote, LIST_ICON, ListSection, TextAction } from './components/list';
import { BankBusyNote, UpdateCheckPanel } from './components/bank-status';
import {
  ORIGIN_HINT,
  ORIGIN_LABEL,
  UNSUPPORTED_TEXT,
  bankErrorText,
  copyBankAsLocal,
  describeBank,
  describeInstall,
  formatDate,
  shareFile,
} from './bank-helpers';
import { useBankUpdates } from './useBankUpdates';

const ORIGIN_ORDER: BankOrigin[] = ['remote', 'local', 'file'];
const SECTION_TITLE: Record<BankOrigin, string> = { remote: '线上题库', local: '本地题库', file: '文件导入' };
const SECTION_EMPTY: Record<BankOrigin, string> = {
  remote: '还没有线上题库。到「线上题库」安装官方题库或按网址添加。',
  local: '还没有本地题库。新建一个，或把其它题库「复制为本地编辑」。',
  file: '导入的题库文件（只读）会出现在这里。',
};

/**
 * 题库管理（BankManagerScreen 的正文）：按来源分为线上 / 本地 / 文件导入三组纯列表。
 * 点按行切换当前题库；「⋯」展开该来源可用的操作：
 * - 线上：检查更新 / 复制为本地编辑 / 信息 / 删除
 * - 本地：编辑 / 导出 / 复制 / 信息 / 删除
 * - 文件：复制为本地编辑 / 信息 / 删除
 * 删除时询问是否一并删除学习数据（默认保留）。
 */
export function BankManagerModal({
  visible,
  onClose,
  onEditBank,
  onBankCopied,
  onOpenOnlineBanks,
  presentation,
}: {
  visible: boolean;
  onClose: () => void;
  onEditBank: (bankId: string) => void;
  /** 复制完成（新本地题库 id）：通常直接进入编辑 */
  onBankCopied: (bankId: string) => void;
  onOpenOnlineBanks: () => void;
  presentation?: SheetPresentation;
}) {
  const status = useBankStore((state) => state.status);
  const banks = useBankStore((state) => state.banks);
  const activeBankId = useBankStore((state) => state.activeBankId);
  const storeBusy = useBankStore((state) => state.busy);
  const updates = useBankUpdates();
  const [localBusy, setLocalBusy] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [infoId, setInfoId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [purgeLearning, setPurgeLearning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const busy = storeBusy !== null || localBusy !== null || updates.checkingId !== null;

  useEffect(() => {
    if (!visible) return;
    setError(null);
    setNotice(null);
    setExpandedId(null);
    setInfoId(null);
    setConfirmingDeleteId(null);
  }, [visible]);

  /** 统一的忙碌 / 错误包装；operation 返回提示文案或 null */
  async function run(key: string, operation: () => Promise<string | null>) {
    if (busy) return;
    setLocalBusy(key);
    setError(null);
    setNotice(null);
    try {
      const message = await operation();
      if (message) setNotice(message);
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : String(operationError));
    } finally {
      setLocalBusy(null);
    }
  }

  const fail = (message: string) => { setError(message); return null; };

  const handleSwitch = (bank: BankSummary) => run(bank.id, async () => {
    if (bank.id === activeBankId) return null;
    const result = await useBankStore.getState().switchBank(bank.id);
    return result.ok ? `已切换到「${bank.name}」。` : fail(bankErrorText(result.error));
  });

  const handleCreateLocal = () => run('create', async () => {
    const result = await useBankStore.getState().createLocalBank({ name: '我的题库' });
    if (!result.ok) return fail(bankErrorText(result.error));
    onEditBank(result.value);
    return null;
  });

  const handleImportFile = () => run('import', async () => {
    const picked = await DocumentPicker.getDocumentAsync({ type: ['application/json', '*/*'], copyToCacheDirectory: true, multiple: false });
    if (picked.canceled || !picked.assets?.[0]?.uri) return null;
    const result = await useBankStore.getState().importBankFile(picked.assets[0].uri);
    return result.ok ? describeInstall(result.value) : fail(bankErrorText(result.error));
  });

  const handleCopy = (bank: BankSummary) => run(bank.id, async () => {
    const result = await copyBankAsLocal(bank.id);
    if (!result.ok) return fail(bankErrorText(result.error));
    setExpandedId(null);
    onBankCopied(result.value.bankId);
    return `已复制为本地题库「${result.value.name}」。`;
  });

  const handleExport = (bank: BankSummary) => run(bank.id, async () => {
    const result = await useBankStore.getState().exportBankFile(bank.id);
    if (!result.ok) return fail(bankErrorText(result.error));
    const shared = await shareFile(result.value, `导出题库：${bank.name}`);
    return shared ? `已导出「${bank.name}」，可发送给他人或保存备用。` : `已导出到：${result.value}`;
  });

  const handleDelete = (bank: BankSummary) => run(bank.id, async () => {
    const result = await useBankStore.getState().deleteBank(bank.id, { purgeLearningData: purgeLearning });
    if (!result.ok) return fail(bankErrorText(result.error));
    setConfirmingDeleteId(null);
    setExpandedId(null);
    setInfoId(null);
    const current = useBankStore.getState().activeBank;
    const learningText = purgeLearning ? '，学习数据已一并删除' : '，学习数据已保留（重新安装后可恢复）';
    return `已删除「${bank.name}」${learningText}。${bank.id === activeBankId ? (current ? `当前题库：「${current.name}」。` : '当前没有可用题库。') : ''}`;
  });

  function toggleExpanded(bankId: string) {
    setExpandedId((current) => (current === bankId ? null : bankId));
    setConfirmingDeleteId(null);
    setPurgeLearning(false);
  }

  if (status === 'unsupported') {
    return (
      <ModalSheet visible={visible} title="管理题库" onClose={onClose} presentation={presentation}>
        <InlineNote text={UNSUPPORTED_TEXT} />
      </ModalSheet>
    );
  }

  const renderRow = (bank: BankSummary) => {
    const expanded = expandedId === bank.id;
    const active = bank.id === activeBankId;
    const check = updates.checks[bank.id];
    const rowNotice = updates.notices[bank.id];
    const confirmingDelete = confirmingDeleteId === bank.id;
    return (
      <View key={bank.id} style={styles.row}>
        <View style={styles.rowMain}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`切换到题库 ${bank.name}`}
            accessibilityState={{ disabled: busy, selected: active }}
            disabled={busy}
            onPress={() => void handleSwitch(bank)}
            style={({ pressed }) => [styles.rowBody, busy && styles.disabled, pressed && styles.pressed]}
          >
            <View style={styles.titleLine}>
              <Text style={[styles.title, active && styles.titleActive]} numberOfLines={1}>{bank.name}</Text>
              {active ? <Text style={styles.activeMark}>使用中</Text> : null}
            </View>
            <Text style={styles.meta}>{describeBank(bank)}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`更多操作 ${bank.name}`}
            accessibilityState={{ expanded }}
            onPress={() => toggleExpanded(bank.id)}
            hitSlop={6}
            style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}
          >
            <MoreHorizontal {...LIST_ICON} />
          </Pressable>
        </View>

        {expanded ? (
          <View style={styles.actions}>
            {confirmingDelete ? (
              <View style={styles.confirm} accessibilityRole="alert">
                <InlineNote text={`删除「${bank.name}」？${bank.origin === 'local' ? '本地题库删除后无法恢复（除非有导出 / 备份）。' : '之后可重新添加。'}`} tone="danger" />
                <View style={styles.switchRow}>
                  <Text style={styles.switchLabel}>同时删除学习数据（掌握度、收藏、自评）</Text>
                  <Switch
                    value={purgeLearning}
                    onValueChange={setPurgeLearning}
                    disabled={busy}
                    trackColor={{ false: colors.borderStrong, true: colors.danger }}
                    thumbColor={colors.white}
                    accessibilityLabel="同时删除学习数据"
                  />
                </View>
                <View style={styles.inlineActions}>
                  <TextAction
                    label="确认删除"
                    accessibilityLabel={`确认删除题库 ${bank.name}`}
                    tone="danger"
                    disabled={busy}
                    onPress={() => void handleDelete(bank)}
                    style={styles.leadingAction}
                  />
                  <TextAction label="取消" accessibilityLabel="取消删除" tone="muted" disabled={busy}
                    onPress={() => { setConfirmingDeleteId(null); setPurgeLearning(false); }} />
                </View>
              </View>
            ) : (
              <View style={styles.inlineActions}>
                {bank.origin === 'remote' ? (
                  <TextAction
                    label={updates.checkingId === bank.id ? '检查中' : '检查更新'}
                    accessibilityLabel={`检查更新 ${bank.name}`}
                    tone="primary"
                    disabled={busy}
                    onPress={() => void updates.check(bank.id)}
                    style={styles.leadingAction}
                  />
                ) : null}
                {bank.origin === 'local' ? (
                  <>
                    <TextAction label="编辑" accessibilityLabel={`编辑题库 ${bank.name}`} tone="primary" disabled={busy}
                      onPress={() => onEditBank(bank.id)} style={styles.leadingAction} />
                    <TextAction label="导出" accessibilityLabel={`导出题库 ${bank.name}`} disabled={busy}
                      onPress={() => void handleExport(bank)} />
                  </>
                ) : null}
                <TextAction
                  label={bank.origin === 'local' ? '复制' : '复制为本地编辑'}
                  accessibilityLabel={`复制题库 ${bank.name} 为本地可编辑副本`}
                  disabled={busy}
                  onPress={() => void handleCopy(bank)}
                  style={bank.origin === 'file' ? styles.leadingAction : undefined}
                />
                <TextAction
                  label={infoId === bank.id ? '收起信息' : '信息'}
                  accessibilityLabel={`题库信息 ${bank.name}`}
                  disabled={busy}
                  onPress={() => setInfoId((current) => (current === bank.id ? null : bank.id))}
                />
                <TextAction label="删除" accessibilityLabel={`删除题库 ${bank.name}`} tone="danger" disabled={busy}
                  onPress={() => { setConfirmingDeleteId(bank.id); setPurgeLearning(false); }} />
              </View>
            )}

            {check ? (
              <UpdateCheckPanel
                bankName={bank.name}
                check={check}
                disabled={busy}
                onConfirm={() => void updates.update(bank.id)}
                onDismiss={() => updates.dismiss(bank.id)}
              />
            ) : null}
            {rowNotice ? <InlineNote text={rowNotice.message} tone={rowNotice.failed ? 'danger' : 'default'} live /> : null}

            {infoId === bank.id ? <BankInformation bank={bank} /> : null}
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <ModalSheet
      visible={visible}
      title="管理题库"
      hint="点按题库切换当前使用；「⋯」里有更新、复制、导出、信息与删除。线上 / 文件题库只读，想改题先复制为本地。"
      onClose={() => { if (!busy) onClose(); }}
      dismissDisabled={busy}
      presentation={presentation}
      footer={
        <View style={styles.footer}>
          <TextAction label="新建本地题库" tone="primary" onPress={() => void handleCreateLocal()} disabled={busy} />
          <TextAction label="导入题库文件" onPress={() => void handleImportFile()} disabled={busy} />
          <TextAction label="线上题库" onPress={onOpenOnlineBanks} disabled={busy} />
          {presentation !== 'screen' ? (
            <TextAction label="完成" onPress={onClose} disabled={busy} style={styles.footerEnd} />
          ) : null}
        </View>
      }
    >
      <SheetError message={error} />
      <BankBusyNote />
      {notice ? <View style={styles.notice}><InlineNote text={notice} tone="default" live /></View> : null}

      {banks.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>本机还没有题库</Text>
          <Text style={styles.emptyBody}>到「线上题库」添加官方题库，或新建一个本地题库自己出题，也可以导入别人分享的题库文件。</Text>
          <View style={styles.inlineActions}>
            <TextAction label="浏览线上题库" tone="primary" disabled={busy} onPress={onOpenOnlineBanks} style={styles.leadingAction} />
          </View>
        </View>
      ) : (
        ORIGIN_ORDER.map((origin, index) => {
          const group = banks.filter((bank) => bank.origin === origin);
          if (origin === 'file' && group.length === 0) return null;
          return (
            <ListSection key={origin} title={`${SECTION_TITLE[origin]} · ${group.length}`} style={index === 0 ? styles.firstSection : undefined}>
              {group.length === 0 ? (
                <View style={styles.sectionEmpty}><InlineNote text={SECTION_EMPTY[origin]} /></View>
              ) : group.map(renderRow)}
            </ListSection>
          );
        })
      )}
    </ModalSheet>
  );
}

function BankInformation({ bank }: { bank: BankSummary }) {
  return (
    <View style={styles.information}>
      <Text style={styles.infoText}>来源：{ORIGIN_LABEL[bank.origin]}（{ORIGIN_HINT[bank.origin]}）</Text>
      <Text style={styles.infoText}>题目数量：{bank.questionCount} 题</Text>
      <Text style={styles.infoText}>版本：v{bank.version}</Text>
      {bank.description ? <Text style={styles.infoText}>简介：{bank.description}</Text> : null}
      {bank.license ? <Text style={styles.infoText}>许可：{bank.license}</Text> : null}
      {bank.homepage ? <Text selectable style={styles.infoText}>主页：{bank.homepage}</Text> : null}
      {bank.manifestUrl ? <Text selectable style={styles.infoText}>更新地址：{bank.manifestUrl}</Text> : null}
      <Text selectable style={styles.infoText}>题库 id：{bank.id}</Text>
      <Text style={styles.infoText}>安装于：{formatDate(bank.installedAt)} · 最近写入：{formatDate(bank.updatedAt)}</Text>
      {bank.origin === 'remote' ? (
        <Text style={styles.infoText}>最近检查：{bank.checkedAt ? formatDate(bank.checkedAt) : '尚未检查更新'}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: spacing.md },
  footerEnd: { marginLeft: 'auto' },
  notice: { marginBottom: spacing.sm },
  firstSection: { marginTop: spacing.md },
  emptyState: { paddingVertical: spacing.xxl, gap: spacing.sm },
  emptyTitle: { ...typography.heading, color: colors.text },
  emptyBody: { ...typography.body, color: colors.textMuted },
  sectionEmpty: {
    paddingVertical: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  row: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowBody: { flex: 1, paddingVertical: spacing.lg, minHeight: 52 },
  titleLine: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  title: { ...typography.body, color: colors.text, flexShrink: 1 },
  titleActive: { fontWeight: '600' },
  activeMark: { ...typography.caption, color: colors.primary, fontWeight: '600' },
  meta: { ...typography.caption, color: colors.textMuted, marginTop: 2, lineHeight: 18 },
  moreButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  actions: { paddingBottom: spacing.md, gap: spacing.xs },
  inlineActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing.xs },
  leadingAction: { paddingLeft: 0 },
  confirm: { gap: spacing.xs },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, minHeight: 44 },
  switchLabel: { ...typography.caption, color: colors.textSecondary, flex: 1 },
  information: {
    marginTop: spacing.xs,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: spacing.xs,
  },
  infoText: { ...typography.caption, color: colors.textSecondary, lineHeight: 18 },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.6 },
});
