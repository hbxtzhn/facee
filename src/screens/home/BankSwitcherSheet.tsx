import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Check, ChevronRight, Database, FolderCog, Plus } from 'lucide-react-native';
import { useQuestionBankStore } from '../../question-bank/store';
import { colors, radii, spacing, typography } from '../../theme';

/**
 * 首页题库切换底部弹层：列出本机已装题库（打开时刷新），标出使用中的题库；
 * 点其它题库即切换（行内转圈 + 失败提示），末尾「管理题库」进入管理页。
 * 本机没有题库时只给「新建或添加题库」入口。
 */
export function BankSwitcherSheet({
  visible,
  onClose,
  onSwitched,
  onManage,
  canManage = true,
}: {
  visible: boolean;
  onClose: () => void;
  /** 切换成功后回调（首页据此重新读取题库） */
  onSwitched: () => void;
  /** 进入题库管理页 */
  onManage: () => void;
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

  function manage() {
    if (switchingId) return;
    onClose();
    onManage();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.scrim}>
        <Pressable style={styles.scrimTouchable} onPress={close} accessibilityLabel="关闭题库切换" />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.grabber} />
          <Text style={styles.title}>切换题库</Text>
          {error ? (
            <View style={styles.errorBox} accessibilityRole="alert">
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {banksLoading && banks.length === 0 ? (
              <Text style={styles.mutedText}>正在读取题库列表…</Text>
            ) : null}
            {!banksLoading && banks.length === 0 ? (
              <Text style={styles.mutedText}>本机还没有题库，新建一个本地题库或添加线上题库后即可开始练习。</Text>
            ) : null}
            {banks.map((bank) => {
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
                  style={({ pressed }) => [
                    styles.bankRow,
                    bank.active && styles.bankRowActive,
                    disabled && styles.disabled,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.bankIconBox}>
                    <Database size={16} color={bank.active ? colors.primary : colors.textMuted} strokeWidth={2} />
                  </View>
                  <View style={styles.bankInfo}>
                    <Text style={styles.bankTitle} numberOfLines={1}>{bank.title}</Text>
                    <Text style={styles.bankMeta}>
                      {bank.questionCount} 题 · {bank.source === 'local' ? '本地' : '线上'}
                      {bank.version ? ` · v${bank.version}` : ''}
                    </Text>
                  </View>
                  {switching ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : bank.active ? (
                    <View style={styles.activeMark}>
                      <Check size={14} color={colors.primary} strokeWidth={2.4} />
                      <Text style={styles.activeMarkText}>使用中</Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
          {switchingId ? (
            <Text style={styles.mutedText} accessibilityLiveRegion="polite">正在切换题库…</Text>
          ) : null}
          {canManage ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={banks.length === 0 && !banksLoading ? '新建或添加题库' : '管理题库'}
              accessibilityState={{ disabled: switchingId !== null }}
              disabled={switchingId !== null}
              onPress={manage}
              style={({ pressed }) => [styles.manageRow, switchingId !== null && styles.disabled, pressed && styles.pressed]}
            >
              {banks.length === 0 && !banksLoading ? (
                <Plus size={16} color={colors.primary} strokeWidth={2.2} />
              ) : (
                <FolderCog size={16} color={colors.primary} strokeWidth={2} />
              )}
              <Text style={styles.manageText}>
                {banks.length === 0 && !banksLoading ? '新建或添加题库' : '管理题库'}
              </Text>
              <ChevronRight size={16} color={colors.textMuted} strokeWidth={2} />
            </Pressable>
          ) : null}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(20, 20, 16, 0.45)', justifyContent: 'flex-end' },
  scrimTouchable: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheet: {
    maxHeight: '75%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.border,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  title: { ...typography.title, color: colors.text, fontSize: 18 },
  list: { marginTop: spacing.md, flexGrow: 0 },
  listContent: { paddingBottom: spacing.xs },
  mutedText: { ...typography.caption, color: colors.textMuted, lineHeight: 18, marginBottom: spacing.sm },
  errorBox: {
    marginTop: spacing.md,
    padding: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.borderWarm,
  },
  errorText: { ...typography.caption, color: colors.danger, fontSize: 11 },
  bankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    minHeight: 52,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  bankRowActive: { borderColor: colors.primaryMuted, backgroundColor: colors.primarySoft },
  bankIconBox: {
    width: 30,
    height: 30,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bankInfo: { flex: 1 },
  bankTitle: { ...typography.bodyStrong, color: colors.text, fontSize: 14 },
  bankMeta: { ...typography.caption, color: colors.textMuted, fontSize: 11, marginTop: 2 },
  activeMark: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  activeMarkText: { ...typography.caption, color: colors.primary, fontWeight: '700', fontSize: 11 },
  manageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    marginTop: spacing.xs,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  manageText: { ...typography.bodyStrong, color: colors.primary, fontSize: 14, flex: 1 },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.75 },
});
