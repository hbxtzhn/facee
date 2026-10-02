import { type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { ArrowRight, Inbox } from 'lucide-react-native';
import {
  cardChrome,
  colors,
  difficultyStyles,
  radii,
  spacing,
  typography,
} from '../theme';
import type { Difficulty } from '../question-bank/types';

interface AppButtonProps {
  label: string;
  onPress: () => void;
  icon?: LucideIcon;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}

export function AppButton({
  label,
  onPress,
  icon: Icon,
  variant = 'primary',
  disabled = false,
  loading = false,
  accessibilityHint,
  style,
}: AppButtonProps) {
  const blocked = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: blocked, busy: loading }}
      disabled={blocked}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        styles[`${variant}Button`],
        pressed && !blocked && styles.pressed,
        blocked && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'primary' ? colors.white : colors.primary}
        />
      ) : (
        Icon && (
          <Icon
            size={18}
            strokeWidth={2}
            color={variant === 'primary' ? colors.white : colors.primary}
          />
        )
      )}
      <Text
        style={[
          styles.buttonLabel,
          variant === 'primary' ? styles.primaryLabel : styles.secondaryLabel,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * 三个 tab 页共用的页头：徽标 pill + 标题 + 副标题 + 右侧元信息插槽。
 * 收敛前三屏各写一套样式（纯文本眉题/无描边计数胶囊等），导致风格漂移。
 */
export function TabHeader({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  /** 右上角元信息插槽（如「已刷 N 题」「N 题」计数胶囊） */
  action?: ReactNode;
}) {
  return (
    <View style={styles.tabHeader}>
      <View style={styles.tabHeaderTop}>
        <View style={styles.tabHeaderBadge}>
          <Text style={styles.tabHeaderBadgeText}>{eyebrow}</Text>
        </View>
        {action}
      </View>
      <Text style={styles.tabHeaderTitle}>{title}</Text>
      {subtitle ? <Text style={styles.tabHeaderSubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

interface EmptyStateProps {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: LucideIcon;
}

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
  icon: Icon = Inbox,
}: EmptyStateProps) {
  return (
    <View style={styles.emptyState} accessibilityRole="summary">
      <View style={styles.emptyIcon}>
        <Icon size={28} color={colors.primary} strokeWidth={1.8} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyDescription}>{description}</Text>
      {actionLabel && onAction ? (
        <AppButton
          label={actionLabel}
          onPress={onAction}
          icon={ArrowRight}
          variant="secondary"
          style={styles.emptyAction}
        />
      ) : null}
    </View>
  );
}

interface ProgressBarProps {
  value: number;
  accessibilityLabel: string;
}

export function ProgressBar({ value, accessibilityLabel }: ProgressBarProps) {
  const normalized = Math.min(1, Math.max(0, value));
  return (
    <View
      style={styles.progressTrack}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(normalized * 100) }}
    >
      <View style={[styles.progressFill, { width: `${normalized * 100}%` }]} />
    </View>
  );
}

export function Surface({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.surface, style]}>{children}</View>;
}

/**
 * 难度标签（唯一实现）：11px/600、软底色、无描边。
 * List/Favorites/Detail 三处此前各写一份且样式漂移，统一从这里引用。
 */
export function DifficultyBadge({ difficulty }: { difficulty: Difficulty }) {
  const config = difficultyStyles[difficulty];
  return (
    <View style={[styles.difficultyBadge, { backgroundColor: config.background }]}>
      <Text style={[styles.difficultyBadgeText, { color: config.text }]}>{config.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderWidth: 0,
  },
  primaryButton: {
    backgroundColor: colors.primary,
  },
  secondaryButton: {
    backgroundColor: 'transparent',
  },
  ghostButton: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
  },
  pressed: { opacity: 0.78 },
  disabled: { opacity: 0.5 },
  buttonLabel: { ...typography.label, letterSpacing: 0.1 },
  primaryLabel: { color: colors.white },
  secondaryLabel: { color: colors.text },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
  },
  emptyIcon: {
    width: 40,
    height: 40,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  emptyTitle: { ...typography.heading, color: colors.text, textAlign: 'center' },
  emptyDescription: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
    maxWidth: 320,
  },
  emptyAction: { marginTop: spacing.lg },
  progressTrack: {
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
  surface: {
    ...cardChrome,
    borderRadius: radii.md,
  },
  tabHeader: {
    marginBottom: spacing.lg,
  },
  tabHeaderTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  tabHeaderBadge: {
    backgroundColor: colors.surfaceSubtle,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.pill,
  },
  tabHeaderBadgeText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
    fontSize: 11,
    letterSpacing: 0.4,
  },
  tabHeaderTitle: {
    ...typography.display,
    color: colors.text,
    fontSize: 26,
    lineHeight: 34,
  },
  tabHeaderSubtitle: {
    ...typography.body,
    color: colors.textMuted,
    marginTop: 4,
    fontSize: 14,
    lineHeight: 20,
  },
  difficultyBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  difficultyBadgeText: {
    ...typography.caption,
    fontWeight: '600',
    fontSize: 11,
  },
});
