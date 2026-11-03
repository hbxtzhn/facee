import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, ChevronRight, Eye, EyeOff } from 'lucide-react-native';
import { MasteryChips } from '../../components/mastery-control';
import { colors, radii, spacing, typography } from '../../theme';

export interface PracticeBarQueue {
  /** 1 起的当前题序号 */
  current: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}

/**
 * 练习模式固定底部操作栏（替代原悬浮可拖动进度按钮）。
 * - 第一行（仅队列模式）：上一题 · 「3 / 20」进度 · 下一题，首/末题对应按钮置灰；
 * - 第二行：掌握度三态（不会/模糊/会了，无题库时隐藏）+ 显示/收起答案；
 * - 底部留出安全区（手势导航条），始终在内容之下、不遮挡正文。
 */
export function PracticeBar({
  bankId,
  questionId,
  answerVisible,
  answerAvailable,
  onToggleAnswer,
  queue,
}: {
  bankId: string | null;
  questionId: string;
  answerVisible: boolean;
  answerAvailable: boolean;
  onToggleAnswer: () => void;
  queue?: PracticeBarQueue;
}) {
  const insets = useSafeAreaInsets();
  const atFirst = queue ? queue.current <= 1 : true;
  const atLast = queue ? queue.current >= queue.total : true;
  const AnswerIcon = answerVisible ? EyeOff : Eye;
  const answerLabel = answerVisible ? '收起答案' : '显示答案';

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
      {queue ? (
        <View style={styles.queueRow}>
          <NavButton label="上一题" direction="prev" disabled={atFirst} onPress={queue.onPrev} />
          <Text
            style={styles.progressText}
            accessibilityLabel={`第 ${queue.current} 题，共 ${queue.total} 题`}
          >
            {queue.current} / {queue.total}
          </Text>
          <NavButton label="下一题" direction="next" disabled={atLast} onPress={queue.onNext} />
        </View>
      ) : null}

      <View style={styles.actionRow}>
        {bankId ? <MasteryChips bankId={bankId} questionId={questionId} compact /> : <View style={styles.spacer} />}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={answerAvailable ? answerLabel : '这道题暂无参考答案'}
          accessibilityState={{ disabled: !answerAvailable, expanded: answerAvailable ? answerVisible : undefined }}
          disabled={!answerAvailable}
          onPress={onToggleAnswer}
          style={({ pressed }) => [
            styles.answerButton,
            answerVisible && styles.answerButtonActive,
            !answerAvailable && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <AnswerIcon size={16} color={answerVisible ? colors.primary : colors.white} strokeWidth={2} />
          <Text style={[styles.answerText, answerVisible && styles.answerTextActive]}>
            {answerAvailable ? answerLabel : '暂无答案'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function NavButton({
  label,
  direction,
  disabled,
  onPress,
}: {
  label: string;
  direction: 'prev' | 'next';
  disabled: boolean;
  onPress: () => void;
}) {
  const Icon = direction === 'prev' ? ChevronLeft : ChevronRight;
  const icon = <Icon size={16} color={disabled ? colors.textSubtle : colors.textSecondary} strokeWidth={2} />;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.navButton, disabled && styles.disabled, pressed && styles.pressed]}
    >
      {direction === 'prev' ? icon : null}
      <Text style={[styles.navText, disabled && styles.navTextDisabled]}>{label}</Text>
      {direction === 'next' ? icon : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  queueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  navButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minHeight: 36,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceSubtle,
  },
  navText: { ...typography.label, color: colors.textSecondary },
  navTextDisabled: { color: colors.textSubtle },
  progressText: {
    ...typography.label,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  spacer: { flex: 1 },
  answerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  answerButtonActive: { backgroundColor: colors.surface },
  answerText: { ...typography.label, color: colors.white },
  answerTextActive: { color: colors.primary },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.75 },
});
