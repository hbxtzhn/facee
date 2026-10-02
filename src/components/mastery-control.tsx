import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CircleAlert, CircleCheck, CircleX, HelpCircle } from 'lucide-react-native';
import { useMasteryStore, type Mastery } from '../store/masteryStore';
import { colors, radii, spacing, typography } from '../theme';

/**
 * 掌握度打标控件。口径见 masteryStore 注释：
 *任何时候可评可改；再点当前态即清除；无答案题同样可打标。
 */

interface MasteryMeta {
  label: string;
  icon: typeof CircleCheck;
  fg: string;
  bg: string;
}

const MASTERY_META: Record<Mastery, MasteryMeta> = {
  known: { label: '会了', icon: CircleCheck, fg: colors.success, bg: colors.successSoft },
  fuzzy: { label: '模糊', icon: CircleAlert, fg: colors.warning, bg: colors.warningSoft },
  unknown: { label: '不会', icon: CircleX, fg: colors.danger, bg: colors.dangerSoft },
};

const MASTERY_ORDER: Mastery[] = ['known', 'fuzzy', 'unknown'];

/** 三态 chips 行。再点当前态 = 清除标记。 */
export function MasteryChips({
  bankId,
  questionId,
  showPrompt = false,
}: {
  bankId: string;
  questionId: string;
  showPrompt?: boolean;
}) {
  const mark = useMasteryStore((s) => s.marks[bankId]?.[questionId]);
  const setMark = useMasteryStore((s) => s.setMark);

  return (
    <View>
      {showPrompt ? <Text style={styles.prompt}>这道题掌握了吗？</Text> : null}
      <View style={styles.chipsRow}>
        {MASTERY_ORDER.map((value) => {
          const meta = MASTERY_META[value];
          const active = mark === value;
          const Icon = meta.icon;
          return (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityLabel={`标记这道题为${meta.label}`}
              accessibilityState={{ selected: active }}
              onPress={() => setMark(bankId, questionId, active ? null : value)}
              style={({ pressed }) => [
                styles.chip,
                { backgroundColor: active ? meta.bg : colors.surfaceSubtle },
                active && { borderColor: meta.fg },
                pressed && styles.pressed,
              ]}
            >
              <Icon size={14} color={active ? meta.fg : colors.textMuted} strokeWidth={2} />
              <Text style={[styles.chipText, active && { color: meta.fg }]}>{meta.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * 浏览模式头部紧凑入口：未打标显示「标记」，已打标显示当前态（带色）。
 * 点按展开/收起 chips 行；无题库命名空间时不渲染。
 */
export function MasteryHeaderPill({ bankId, questionId }: { bankId: string | null; questionId: string }) {
  const [expanded, setExpanded] = useState(false);
  const mark = useMasteryStore((s) => (bankId ? s.marks[bankId]?.[questionId] : undefined));
  if (!bankId) return null;

  const meta = mark ? MASTERY_META[mark] : null;
  const Icon = meta?.icon ?? HelpCircle;

  return (
    <View style={styles.headerControl}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="标记掌握程度"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        style={({ pressed }) => [
          styles.pill,
          meta ? { backgroundColor: meta.bg, borderColor: meta.fg } : null,
          pressed && styles.pressed,
        ]}
      >
        <Icon size={13} color={meta ? meta.fg : colors.textMuted} strokeWidth={2} />
        <Text style={[styles.pillText, meta ? { color: meta.fg } : null]}>{meta ? meta.label : '标记'}</Text>
      </Pressable>
      {expanded ? <View style={styles.expandedChips}><MasteryChips bankId={bankId} questionId={questionId} /></View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  headerControl: {
    // 位于头部徽章行与标题之间；展开时 chips 在同一容器内换行
    marginTop: spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  pillText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  expandedChips: { paddingTop: spacing.xs },
  prompt: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  pressed: { opacity: 0.75 },
});
