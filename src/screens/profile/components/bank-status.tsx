import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useBankStore, type UpdateCheck } from '../../../bank';
import { colors, spacing, typography } from '../../../theme';
import { describeBusy, describeUpdateCheck } from '../bank-helpers';
import { InlineNote, TextAction } from './list';

/** 独占操作进度：store.busy + store.progress；空闲时不渲染 */
export function BankBusyNote() {
  const busy = useBankStore((state) => state.busy);
  const progress = useBankStore((state) => state.progress);
  const text = describeBusy(busy, progress);
  if (!text) return null;
  return (
    <View style={styles.busyRow} testID="bank-busy">
      <ActivityIndicator size="small" color={colors.textSecondary} />
      <Text style={styles.busyText} accessibilityLiveRegion="polite">{text}</Text>
    </View>
  );
}

/**
 * 检查更新的结果：版本、新增 / 修改 / 删除计数与更新说明；有更新时由用户确认「更新」。
 */
export function UpdateCheckPanel({
  bankName,
  check,
  disabled,
  onConfirm,
  onDismiss,
}: {
  bankName: string;
  check: UpdateCheck;
  disabled: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const summary = describeUpdateCheck(check);
  return (
    <View style={styles.panel} accessibilityLabel={`${bankName} 检查更新结果`}>
      <InlineNote text={summary.headline} tone={summary.canUpdate ? 'default' : 'muted'} live />
      {summary.counts ? <Text style={styles.counts}>{summary.counts}</Text> : null}
      {summary.changes ? <Text style={styles.changes}>更新说明：{summary.changes}</Text> : null}
      <View style={styles.actions}>
        {summary.canUpdate ? (
          <TextAction
            label="更新"
            accessibilityLabel={`确认更新题库 ${bankName}`}
            tone="primary"
            disabled={disabled}
            onPress={onConfirm}
            style={styles.leading}
          />
        ) : null}
        <TextAction
          label={summary.canUpdate ? '暂不更新' : '知道了'}
          accessibilityLabel={summary.canUpdate ? `暂不更新题库 ${bankName}` : '关闭检查结果'}
          tone="muted"
          disabled={disabled}
          onPress={onDismiss}
          style={summary.canUpdate ? undefined : styles.leading}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginVertical: spacing.sm },
  busyText: { ...typography.caption, color: colors.textMuted },
  panel: { paddingBottom: spacing.md, gap: spacing.xs },
  counts: { ...typography.caption, color: colors.text, fontWeight: '600' },
  changes: { ...typography.caption, color: colors.textSecondary, lineHeight: 18 },
  actions: { flexDirection: 'row', alignItems: 'center', columnGap: spacing.xs },
  leading: { paddingLeft: 0 },
});
