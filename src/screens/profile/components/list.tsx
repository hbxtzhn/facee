import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { ChevronRight, type LucideIcon } from 'lucide-react-native';
import { colors, spacing, typography } from '../../../theme';

/**
 * 「我的」与题库管理的极简阅读风基础件：纯列表 + 发丝分割线 + 文字按钮。
 * 不铺卡片底色、不加阴影；层次只靠字号字重与留白。
 */

/** 图标统一规格：小号、细线、次级灰 */
export const LIST_ICON = { size: 18, strokeWidth: 1.6, color: colors.textSecondary } as const;

/** 列表分区：眉题 + 上下发丝线包住的行；footnote 为分区下方的弱化说明 */
export function ListSection({
  title,
  footnote,
  children,
  style,
}: {
  title?: string;
  footnote?: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.section, style]}>
      {title ? (
        <Text style={styles.sectionTitle} accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      <View style={styles.sectionBody}>{children}</View>
      {footnote ? <Text style={styles.footnote}>{footnote}</Text> : null}
    </View>
  );
}

/**
 * 列表行：标题 + 可选副标题 + 右侧值 / 插槽。传 onPress 即可点按（默认带细箭头）。
 * 每行自带底部发丝线，ListSection 负责顶部那一条。
 */
export function ListRow({
  title,
  subtitle,
  value,
  icon: Icon,
  onPress,
  right,
  chevron,
  disabled = false,
  accessibilityLabel,
  accessibilityHint,
  testID,
  children,
}: {
  title: string;
  subtitle?: string;
  value?: string;
  icon?: LucideIcon;
  onPress?: () => void;
  right?: ReactNode;
  /** 默认：可点按时显示 */
  chevron?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  /** 行下方的展开内容（仍在同一条分割线之内） */
  children?: ReactNode;
}) {
  const showChevron = chevron ?? Boolean(onPress);
  const body = (
    <>
      {Icon ? <Icon {...LIST_ICON} /> : null}
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle} numberOfLines={2}>{title}</Text>
        {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      {value ? <Text style={styles.rowValue} numberOfLines={1}>{value}</Text> : null}
      {right}
      {showChevron ? <ChevronRight size={16} strokeWidth={1.6} color={colors.textSubtle} /> : null}
    </>
  );
  return (
    <View style={styles.rowWrap} testID={testID}>
      {onPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel ?? title}
          accessibilityHint={accessibilityHint}
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={onPress}
          style={({ pressed }) => [styles.row, disabled && styles.disabled, pressed && styles.pressed]}
        >
          {body}
        </Pressable>
      ) : (
        <View style={styles.row} accessibilityLabel={accessibilityLabel}>
          {body}
        </View>
      )}
      {children}
    </View>
  );
}

/** 文字按钮：无底色，触控高度 ≥44；danger 仅用于删除等破坏性操作 */
export function TextAction({
  label,
  onPress,
  tone = 'default',
  disabled = false,
  accessibilityLabel,
  accessibilityHint,
  style,
}: {
  label: string;
  onPress: () => void;
  tone?: 'default' | 'primary' | 'muted' | 'danger';
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.textAction, disabled && styles.disabled, pressed && styles.pressed, style]}
    >
      <Text style={[styles.textActionLabel, toneStyles[tone]]}>{label}</Text>
    </Pressable>
  );
}

/** 行内说明 / 确认文字（不加底色块）；tone=danger 只给破坏性确认 */
export function InlineNote({
  text,
  tone = 'muted',
  live = false,
}: {
  text: string;
  tone?: 'muted' | 'danger' | 'default';
  live?: boolean;
}) {
  return (
    <Text
      style={[styles.note, tone === 'danger' && styles.noteDanger, tone === 'default' && styles.noteDefault]}
      accessibilityLiveRegion={live ? 'polite' : undefined}
      accessibilityRole={tone === 'danger' ? 'alert' : undefined}
    >
      {text}
    </Text>
  );
}

const toneStyles = StyleSheet.create({
  default: { color: colors.text },
  primary: { color: colors.primary, fontWeight: '700' },
  muted: { color: colors.textMuted },
  danger: { color: colors.danger },
});

export const listStyles = StyleSheet.create({
  /** 发丝线输入框：纸面底 + 下划线感，不用灰底块 */
  input: {
    ...typography.body,
    color: colors.text,
    minHeight: 44,
    paddingHorizontal: 0,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderStrong,
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
});

const styles = StyleSheet.create({
  section: { marginTop: spacing.xxl },
  sectionTitle: {
    ...typography.eyebrow,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  sectionBody: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  footnote: { ...typography.caption, color: colors.textSubtle, marginTop: spacing.sm, lineHeight: 18 },
  rowWrap: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 52,
    paddingVertical: spacing.lg,
  },
  rowCopy: { flex: 1 },
  rowTitle: { ...typography.body, color: colors.text },
  rowSubtitle: { ...typography.caption, color: colors.textMuted, marginTop: 2, lineHeight: 18 },
  rowValue: { ...typography.body, color: colors.textMuted, maxWidth: '45%' },
  textAction: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textActionLabel: { ...typography.label, fontSize: 14 },
  note: { ...typography.caption, color: colors.textMuted, lineHeight: 18 },
  noteDanger: { color: colors.danger },
  noteDefault: { color: colors.textSecondary },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.6 },
});
