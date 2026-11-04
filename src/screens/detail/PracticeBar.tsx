import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { MasteryToggles } from '../../components/mastery-control';
import { colors, spacing, typography } from '../../theme';

export interface PracticeBarQueue {
  /** 1 起的当前题序号 */
  current: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}

/**
 * 练习模式固定底栏（极简阅读风）：纸面同色 + 顶部发丝线，无阴影无色块。
 * 单行布局：掌握度三态文字开关 ·（弹性留白）· 答案开关 · ‹ 3 / 20 ›
 * - 「显示答案」是全栏唯一的主操作（主色加粗文字）；展开后降级为普通文字「收起答案」；
 * - 上一题/下一题只是图标 chevron，首/末题置灰；非队列模式不显示翻页组；
 * - 底部留出安全区（手势导航条）。
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
  const answerLabel = answerVisible ? '收起答案' : '显示答案';
  const primaryAnswer = answerAvailable && !answerVisible;

  return (
    <View testID="practice-bar" style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
      <View style={styles.row}>
        {bankId ? <MasteryToggles bankId={bankId} questionId={questionId} compact /> : null}
        <View style={styles.spacer} />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={answerAvailable ? answerLabel : '这道题暂无参考答案'}
          accessibilityState={{ disabled: !answerAvailable, expanded: answerAvailable ? answerVisible : undefined }}
          disabled={!answerAvailable}
          hitSlop={6}
          onPress={onToggleAnswer}
          style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}
        >
          <Text
            style={[
              styles.answerText,
              primaryAnswer && styles.answerTextPrimary,
              !answerAvailable && styles.textDisabled,
            ]}
          >
            {answerAvailable ? answerLabel : '暂无答案'}
          </Text>
        </Pressable>

        {queue ? (
          <View style={styles.queueGroup}>
            <ChevronButton label="上一题" direction="prev" disabled={atFirst} onPress={queue.onPrev} />
            <Text style={styles.progressText} accessibilityLabel={`第 ${queue.current} 题，共 ${queue.total} 题`}>
              {queue.current} / {queue.total}
            </Text>
            <ChevronButton label="下一题" direction="next" disabled={atLast} onPress={queue.onNext} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

function ChevronButton({
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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.chevron, pressed && styles.pressed]}
    >
      <Icon size={18} color={disabled ? colors.textSubtle : colors.textSecondary} strokeWidth={1.6} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderStrong,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
  },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 48 },
  spacer: { flex: 1, minWidth: spacing.sm },
  textButton: { minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.xs },
  answerText: { ...typography.body, color: colors.textSecondary },
  answerTextPrimary: { color: colors.primary, fontWeight: '600' },
  textDisabled: { color: colors.textSubtle },
  queueGroup: { flexDirection: 'row', alignItems: 'center', marginLeft: spacing.md },
  chevron: { width: 32, height: 40, alignItems: 'center', justifyContent: 'center' },
  progressText: {
    ...typography.caption,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
    minWidth: 40,
    textAlign: 'center',
  },
  pressed: { opacity: 0.6 },
});
