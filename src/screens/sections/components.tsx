import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, spacing, typography } from '../../theme';
import type { SectionInfo } from '../../bank';
import { TextAction } from '../home/components/reading';

/**
 * 分区管理页的小原语（沿用极简阅读风：发丝线、文字按钮、无卡片）。
 */

/** 分区行的弱化说明：「3 个分类 · 42 题 · 1 个已不在题库中」 */
export function describeSection(section: SectionInfo): string {
  if (section.categories.length === 0) return '还没有分类';
  const existing = section.categories.filter((category) => category.exists);
  const dangling = section.categories.length - existing.length;
  const total = existing.reduce((sum, category) => sum + category.questionCount, 0);
  return [
    `${existing.length} 个分类`,
    `${total} 题`,
    dangling > 0 ? `${dangling} 个已不在题库中` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** 向前 / 向后移动一项，返回新数组；越界返回 null */
export function moveItem<T>(list: readonly T[], index: number, delta: -1 | 1): T[] | null {
  const target = index + delta;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return null;
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export interface RowAction {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}

/** 管理行：左侧标题（可点）+ 弱化说明，下方一排文字操作 */
export function ManageRow({
  title,
  meta,
  badge,
  onPress,
  accessibilityLabel,
  actions,
  first = false,
  muted = false,
}: {
  title: string;
  meta?: string | null;
  badge?: string | null;
  onPress?: () => void;
  accessibilityLabel: string;
  actions: RowAction[];
  first?: boolean;
  /** 标题弱化（「已不在题库中」的分类） */
  muted?: boolean;
}) {
  const body = (
    <>
      <Text style={[styles.title, muted && styles.titleMuted]} numberOfLines={1}>
        {title}
      </Text>
      {meta || badge ? (
        <Text style={styles.meta} numberOfLines={1}>
          {badge ? <Text style={styles.badge}>{meta ? `${badge} · ` : badge}</Text> : null}
          {meta ?? null}
        </Text>
      ) : null}
    </>
  );
  return (
    <View style={[styles.row, first && styles.rowFirst]}>
      {onPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          onPress={onPress}
          style={({ pressed }) => [styles.body, pressed && styles.pressed]}
        >
          {body}
        </Pressable>
      ) : (
        <View style={styles.body} accessibilityLabel={accessibilityLabel}>
          {body}
        </View>
      )}
      {actions.length > 0 ? (
        <View style={styles.actions}>
          {actions.map((action) => (
            <Pressable
              key={action.label}
              accessibilityRole="button"
              accessibilityLabel={action.accessibilityLabel}
              accessibilityState={{ disabled: Boolean(action.disabled) }}
              disabled={action.disabled}
              hitSlop={6}
              onPress={action.onPress}
              style={({ pressed }) => [pressed && styles.pressed, action.disabled && styles.disabled]}
            >
              <Text style={[styles.action, action.danger && styles.actionDanger]}>{action.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** 名称输入行：底部发丝线输入框 + 右侧主色文字按钮（新建 / 保存），可选「取消」 */
export function NameInput({
  initialValue = '',
  placeholder,
  submitLabel,
  accessibilityLabel,
  onSubmit,
  onCancel,
  autoFocus = false,
}: {
  initialValue?: string;
  placeholder: string;
  submitLabel: string;
  accessibilityLabel: string;
  /** 返回 true 表示成功（清空输入） */
  onSubmit: (name: string) => Promise<boolean>;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState(initialValue);
  const [submitting, setSubmitting] = useState(false);
  const canSubmit = value.trim().length > 0 && !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    const ok = await onSubmit(value.trim());
    setSubmitting(false);
    if (ok) setValue('');
  }

  return (
    <View style={styles.inputRow}>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={setValue}
        placeholder={placeholder}
        placeholderTextColor={colors.textSubtle}
        accessibilityLabel={accessibilityLabel}
        maxLength={30}
        autoFocus={autoFocus}
        returnKeyType="done"
        onSubmitEditing={() => void submit()}
      />
      {onCancel ? <TextAction label="取消" muted onPress={onCancel} /> : null}
      <TextAction
        label={submitLabel}
        accessibilityLabel={`${submitLabel}${value.trim() ? `「${value.trim()}」` : ''}`}
        onPress={() => void submit()}
      />
    </View>
  );
}

const hairline = StyleSheet.hairlineWidth;

const styles = StyleSheet.create({
  row: {
    paddingVertical: spacing.md,
    borderBottomWidth: hairline,
    borderBottomColor: colors.border,
  },
  rowFirst: { borderTopWidth: hairline, borderTopColor: colors.border },
  body: { paddingVertical: spacing.xs },
  title: { ...typography.body, color: colors.text, fontWeight: '500' },
  titleMuted: { color: colors.textMuted, textDecorationLine: 'line-through' },
  meta: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs },
  badge: { color: colors.primary, fontWeight: '600' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.lg, rowGap: spacing.xs, marginTop: spacing.xs },
  action: { ...typography.caption, color: colors.textSecondary },
  actionDanger: { color: colors.danger },
  disabled: { opacity: 0.35 },
  pressed: { opacity: 0.6 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 44,
    borderBottomWidth: hairline,
    borderBottomColor: colors.borderStrong,
  },
  input: { ...typography.body, color: colors.text, flex: 1, paddingVertical: spacing.sm },
});
