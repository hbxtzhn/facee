import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useMasteryStore, type Mastery } from '../store/masteryStore';
import { isReviewDue } from '../lib/spaced-review';
import { colors, spacing, typography } from '../theme';

/**
 * 掌握度打标控件（极简阅读风：纯文字三态，选中态只靠字重 + 下划线强调，不铺彩色胶囊）。
 * 口径见 masteryStore 注释：任何时候可评可改；再点当前态即清除；无答案题同样可打标。
 *
 * 复习到期的题：上次的标记只作为「上次」提示（不算选中），点任一档都是重新打标——
 * 这样复习时再点「会了」会确认一次复习（连续次数 +1、间隔扩张），而不是误清除标记。
 */

export const MASTERY_LABELS: Record<Mastery, string> = {
  unknown: '不会',
  fuzzy: '模糊',
  known: '会了',
};

/** 底栏从左到右：不会 · 模糊 · 会了（由弱到强） */
const MASTERY_ORDER: Mastery[] = ['unknown', 'fuzzy', 'known'];

/** 单题打标状态 + 动作；due = 已有标记且已到复习时间 */
export function useMasteryToggle(bankId: string, questionId: string) {
  const mark = useMasteryStore((s) => s.marks[bankId]?.[questionId]) ?? null;
  const markedAt = useMasteryStore((s) => s.markedAt[bankId]?.[questionId]);
  const knownStreak = useMasteryStore((s) => s.knownStreaks[bankId]?.[questionId]);
  const setMark = useMasteryStore((s) => s.setMark);

  const due = mark !== null && typeof markedAt === 'number' && isReviewDue({ mastery: mark, markedAt, knownStreak }, Date.now());
  const isSelected = (value: Mastery) => mark === value && !due;

  const select = useCallback(
    (value: Mastery) => {
      const current = useMasteryStore.getState().marks[bankId]?.[questionId] ?? null;
      // 已选中（且未到期）再点 = 清除；其余情况一律（重新）打标
      setMark(bankId, questionId, current === value && !due ? null : value);
    },
    [bankId, questionId, due, setMark],
  );

  return { mark, due, isSelected, select };
}

/**
 * 三个纯文字开关。compact：底栏用，三枚紧凑并排。
 */
export function MasteryToggles({
  bankId,
  questionId,
  compact = false,
}: {
  bankId: string;
  questionId: string;
  compact?: boolean;
}) {
  const { mark, due, isSelected, select } = useMasteryToggle(bankId, questionId);

  return (
    <View style={[styles.toggleRow, compact && styles.toggleRowCompact]} accessibilityRole="radiogroup">
      {MASTERY_ORDER.map((value) => {
        const active = isSelected(value);
        const previous = due && mark === value;
        return (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityLabel={`标记这道题为${MASTERY_LABELS[value]}`}
            accessibilityHint={previous ? '上次标记，到期复习后可重新确认' : undefined}
            accessibilityState={{ selected: active }}
            hitSlop={4}
            onPress={() => select(value)}
            style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
          >
            <Text
              style={[
                styles.toggleText,
                active && styles.toggleTextActive,
                previous && styles.toggleTextPrevious,
              ]}
            >
              {MASTERY_LABELS[value]}
            </Text>
            <View style={[styles.underline, active && styles.underlineActive]} />
          </Pressable>
        );
      })}
    </View>
  );
}

/** 兼容旧名：其他页面若仍引用 MasteryChips，得到的是同一套文字开关 */
export const MasteryChips = MasteryToggles;

/**
 * 浏览模式头部的安静入口：一行小字「掌握度 · 会了」，点按展开 / 收起三态开关。
 * 无题库命名空间时不渲染。
 */
export function MasteryHeaderPill({ bankId, questionId }: { bankId: string | null; questionId: string }) {
  const [expanded, setExpanded] = useState(false);
  const mark = useMasteryStore((s) => (bankId ? s.marks[bankId]?.[questionId] : undefined));
  if (!bankId) return null;

  return (
    <View style={styles.headerControl}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="标记掌握程度"
        accessibilityState={{ expanded }}
        hitSlop={6}
        onPress={() => setExpanded((value) => !value)}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <Text style={styles.headerText}>
          掌握度 · <Text style={mark ? styles.headerValue : null}>{mark ? MASTERY_LABELS[mark] : '未标记'}</Text>
        </Text>
      </Pressable>
      {expanded ? <MasteryToggles bankId={bankId} questionId={questionId} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  headerControl: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.lg,
  },
  headerText: { ...typography.caption, color: colors.textMuted },
  headerValue: { color: colors.text, fontWeight: '600' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  toggleRowCompact: { gap: spacing.md },
  toggle: { minHeight: 40, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 2 },
  toggleText: { ...typography.body, color: colors.textMuted },
  toggleTextActive: { color: colors.primary, fontWeight: '600' },
  toggleTextPrevious: { color: colors.textSecondary },
  underline: { marginTop: 2, height: 1.5, alignSelf: 'stretch', backgroundColor: 'transparent' },
  underlineActive: { backgroundColor: colors.primary },
  pressed: { opacity: 0.6 },
});
