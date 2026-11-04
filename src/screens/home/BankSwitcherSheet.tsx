import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Check, ChevronRight } from 'lucide-react-native';
import { useQuestionBankStore } from '../../question-bank/store';
import type { InstalledBankSummary } from '../../question-bank/types';
import { colors, layout, radii, spacing, typography } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from './components/reading';

/**
 * 首页题库切换底部弹层（极简阅读风）：本机题库按「线上题库 / 本地题库」分两组
 * （打开时刷新），使用中的题库以主色对勾标出；点其它题库即切换（行内转圈 + 失败提示）。
 * 线上题库 = 官方下载、只能更新；本地题库 = 自建或复制，可编辑。
 * 末尾两个入口：「线上题库」进入官方题库目录，「管理题库」进入管理页；
 * 本机没有题库时第一个入口改为「安装官方题库」。
 */
export function BankSwitcherSheet({
  visible,
  onClose,
  onSwitched,
  onManage,
  onOnlineBanks,
  canManage = true,
}: {
  visible: boolean;
  onClose: () => void;
  /** 切换成功后回调（首页据此重新读取题库） */
  onSwitched: () => void;
  /** 进入题库管理页 */
  onManage: () => void;
  /** 进入线上（官方）题库目录 */
  onOnlineBanks: () => void;
  /** 平台是否支持题库管理（Web 只读，不给入口） */
  canManage?: boolean;
}) {
  const banks = useQuestionBankStore((state) => state.banks);
  const banksLoading = useQuestionBankStore((state) => state.banksLoading);
  const refreshBanks = useQuestionBankStore((state) => state.refreshBanks);
  const switchBank = useQuestionBankStore((state) => state.switchBank);
  const installing = useQuestionBankStore((state) => state.installing);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 自己发起的切换或其它页面正在处理题库时，都不允许再点
  const busy = switchingId !== null || installing;

  useEffect(() => {
    if (!visible) return;
    setError(null);
    void refreshBanks();
  }, [visible, refreshBanks]);

  function close() {
    if (switchingId) return;
    onClose();
  }

  async function handleSelect(catalogId: string, active: boolean) {
    if (busy) return;
    if (active) {
      onClose();
      return;
    }
    setSwitchingId(catalogId);
    setError(null);
    try {
      await switchBank(catalogId);
      onSwitched();
      onClose();
    } catch (switchError) {
      setError(switchError instanceof Error ? switchError.message : String(switchError));
    } finally {
      setSwitchingId(null);
    }
  }

  function leaveTo(target: () => void) {
    if (switchingId) return;
    onClose();
    target();
  }

  const onlineBanks = banks.filter((bank) => bank.source === 'online');
  const localBanks = banks.filter((bank) => bank.source !== 'online');
  const empty = !banksLoading && banks.length === 0;

  function renderBank(bank: InstalledBankSummary) {
    const switching = switchingId === bank.catalogId;
    const disabled = busy && !switching;
    return (
      <Pressable
        key={bank.namespace}
        accessibilityRole="button"
        accessibilityLabel={bank.active ? `当前题库 ${bank.title}` : `切换到题库 ${bank.title}`}
        accessibilityState={{ selected: bank.active, disabled: busy, busy: switching }}
        disabled={busy}
        onPress={() => void handleSelect(bank.catalogId, bank.active)}
        style={({ pressed }) => [styles.bankRow, disabled && styles.disabled, pressed && styles.pressed]}
      >
        <View style={styles.bankInfo}>
          <Text style={[styles.bankTitle, bank.active && styles.bankTitleActive]} numberOfLines={1}>
            {bank.title}
          </Text>
          <Text style={styles.bankMeta}>
            {bank.questionCount} 题{bank.version ? ` · v${bank.version}` : ''}
          </Text>
        </View>
        {switching ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : bank.active ? (
          <View style={styles.activeMark}>
            <Check size={16} color={colors.primary} strokeWidth={2} />
            <Text style={styles.activeMarkText}>使用中</Text>
          </View>
        ) : null}
      </Pressable>
    );
  }

  function renderGroup(label: string, list: InstalledBankSummary[]) {
    if (list.length === 0) return null;
    return (
      <View style={styles.group}>
        <Text style={styles.groupLabel} accessibilityRole="header">{label}</Text>
        {list.map(renderBank)}
      </View>
    );
  }

  function renderEntry(label: string, onPress: () => void, hint: string) {
    const blocked = switchingId !== null;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={hint}
        accessibilityState={{ disabled: blocked }}
        disabled={blocked}
        onPress={() => leaveTo(onPress)}
        style={({ pressed }) => [styles.entryRow, blocked && styles.disabled, pressed && styles.pressed]}
      >
        <Text style={styles.entryText}>{label}</Text>
        <ChevronRight size={ICON_SIZE} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
      </Pressable>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.scrim}>
        <Pressable style={styles.scrimTouchable} onPress={close} accessibilityLabel="关闭题库切换" />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.grabber} />
          <Text style={styles.title}>切换题库</Text>
          {error ? (
            <Text style={styles.errorText} accessibilityRole="alert">{error}</Text>
          ) : null}
          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {banksLoading && banks.length === 0 ? (
              <Text style={styles.mutedText}>正在读取题库列表…</Text>
            ) : null}
            {empty ? (
              <Text style={styles.mutedText}>
                本机还没有题库。安装一个官方线上题库，或新建本地题库后即可开始练习。
              </Text>
            ) : null}
            {renderGroup('线上题库', onlineBanks)}
            {renderGroup('本地题库', localBanks)}
          </ScrollView>
          {switchingId ? (
            <Text style={styles.mutedText} accessibilityLiveRegion="polite">正在切换题库…</Text>
          ) : null}
          {canManage ? (
            <View style={styles.entries}>
              {renderEntry(empty ? '安装官方题库' : '线上题库', onOnlineBanks, '浏览并安装官方线上题库')}
              {renderEntry('管理题库', onManage, '新建、复制、编辑或删除题库')}
            </View>
          ) : null}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const hairline = StyleSheet.hairlineWidth;

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  scrimTouchable: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheet: {
    maxHeight: '78%',
    backgroundColor: colors.background,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    paddingHorizontal: layout.pagePadding,
    paddingBottom: spacing.md,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.borderStrong,
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  title: { ...typography.heading, color: colors.text },
  list: { marginTop: spacing.sm, flexGrow: 0 },
  listContent: { paddingBottom: spacing.sm },
  mutedText: { ...typography.caption, color: colors.textMuted, lineHeight: 18, marginTop: spacing.md },
  errorText: { ...typography.caption, color: colors.danger, marginTop: spacing.sm, lineHeight: 18 },
  group: { marginTop: spacing.lg },
  groupLabel: { ...typography.eyebrow, color: colors.textMuted, marginBottom: spacing.xs },
  bankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 14,
    borderBottomWidth: hairline,
    borderBottomColor: colors.border,
  },
  bankInfo: { flex: 1 },
  bankTitle: { ...typography.body, color: colors.text, fontWeight: '500' },
  bankTitleActive: { fontWeight: '600' },
  bankMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  activeMark: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  activeMarkText: { ...typography.caption, color: colors.primary, fontWeight: '600' },
  entries: {
    marginTop: spacing.sm,
    borderTopWidth: hairline,
    borderTopColor: colors.borderStrong,
  },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    borderBottomWidth: hairline,
    borderBottomColor: colors.border,
  },
  entryText: { ...typography.bodyStrong, color: colors.primary, flex: 1 },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.6 },
});
