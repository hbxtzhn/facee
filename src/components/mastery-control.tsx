import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Mastery } from '../bank';
import { colors, spacing, typography } from '../theme';

/**
 * 掌握度打标控件（极简阅读风：纯文字三态，选中态只靠字重 + 下划线强调，不铺彩色胶囊）。
 * 纯展示组件：状态来自题库 v2 的 QuestionDetail.learning，写入由调用方经 useBankStore.setMastery 完成。
 *
 * - 任何时候可评可改；再点当前态即清除（onSelect(null)）；
 * - 复习到期的题：上次的标记只作为「上次」提示（不算选中），点任一档都是重新打标——
 *   复习时再点「会了」会确认一次复习（连续次数 +1、间隔扩张，见 src/bank/spaced-review.ts），而不是误清除标记；
 * - suggested：要点自评 / 选择题给出的建议档位，只做虚线下划线提示，不自动打标。
 */

export const MASTERY_LABELS: Record<Mastery, string> = {
  unknown: '不会',
  fuzzy: '模糊',
  known: '会了',
};

/** 从左到右：不会 · 模糊 · 会了（由弱到强） */
const MASTERY_ORDER: Mastery[] = ['unknown', 'fuzzy', 'known'];

export interface MasteryState {
  mastery: Mastery | null;
  /** 下次复习时间；null = 未排期 */
  dueAt: number | null;
}

/** 已有标记且已到复习时间 */
export function isMasteryDue(state: MasteryState | null | undefined, now = Date.now()): boolean {
  return Boolean(state?.mastery && typeof state.dueAt === 'number' && state.dueAt <= now);
}

/** 点按某档后应写入的值：已选中（且未到期）再点 = 清除；其余一律（重新）打标 */
export function nextMasteryValue(state: MasteryState | null | undefined, value: Mastery, now = Date.now()): Mastery | null {
  return state?.mastery === value && !isMasteryDue(state, now) ? null : value;
}

/**
 * 三个纯文字开关。compact：底栏用，三枚紧凑并排。
 */
export function MasteryToggles({
  state,
  suggested = null,
  onSelect,
  compact = false,
}: {
  state: MasteryState | null;
  suggested?: Mastery | null;
  onSelect: (value: Mastery | null) => void;
  compact?: boolean;
}) {
  const due = isMasteryDue(state);
  const mark = state?.mastery ?? null;

  return (
    <View style={[styles.toggleRow, compact && styles.toggleRowCompact]} accessibilityRole="radiogroup">
      {MASTERY_ORDER.map((value) => {
        const active = mark === value && !due;
        const previous = due && mark === value;
        const isSuggested = suggested === value && !active;
        const hints = [previous ? '上次标记，到期复习后可重新确认' : null, isSuggested ? '根据自评建议的档位' : null].filter(Boolean);
        return (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityLabel={`标记这道题为${MASTERY_LABELS[value]}`}
            accessibilityHint={hints.length > 0 ? hints.join('；') : undefined}
            accessibilityState={{ selected: active }}
            hitSlop={4}
            onPress={() => onSelect(nextMasteryValue(state, value))}
            style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
          >
            <Text
              style={[
                styles.toggleText,
                active && styles.toggleTextActive,
                previous && styles.toggleTextPrevious,
                isSuggested && styles.toggleTextSuggested,
              ]}
            >
              {MASTERY_LABELS[value]}
            </Text>
            <View
              testID={isSuggested ? `mastery-suggested-${value}` : undefined}
              style={[styles.underline, active && styles.underlineActive, isSuggested && styles.underlineSuggested]}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * 浏览模式头部的安静入口：一行小字「掌握度 · 会了」，点按展开 / 收起三态开关。
 * 有建议档位时自动展开，方便确认。
 */
export function MasteryHeaderPill({
  state,
  suggested = null,
  onSelect,
}: {
  state: MasteryState | null;
  suggested?: Mastery | null;
  onSelect: (value: Mastery | null) => void;
}) {
  const [expandedByUser, setExpanded] = useState<boolean | null>(null);
  const expanded = expandedByUser ?? suggested !== null;
  const mark = state?.mastery ?? null;

  return (
    <View style={styles.headerControl}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="标记掌握程度"
        accessibilityState={{ expanded }}
        hitSlop={6}
        onPress={() => setExpanded(!expanded)}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <Text style={styles.headerText}>
          掌握度 · <Text style={mark ? styles.headerValue : null}>{mark ? MASTERY_LABELS[mark] : '未标记'}</Text>
        </Text>
      </Pressable>
      {expanded ? <MasteryToggles state={state} suggested={suggested} onSelect={onSelect} /> : null}
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
  toggleTextSuggested: { color: colors.text },
  underline: { marginTop: 2, height: 1.5, alignSelf: 'stretch', backgroundColor: 'transparent' },
  underlineActive: { backgroundColor: colors.primary },
  underlineSuggested: {
    height: 0,
    borderBottomWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.textMuted,
  },
  pressed: { opacity: 0.6 },
});
