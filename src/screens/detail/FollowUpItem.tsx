import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronDown } from 'lucide-react-native';
import Markdown from 'react-native-markdown-display';
import type { Followup, Mastery } from '../../bank';
import markdownit from '../../lib/markdown';
import { colors, spacing, typography } from '../../theme';
import { createFollowUpMarkdownStyles } from './markdown-styles';
import { renderImage, renderTableHeader } from './markdown-rules';

/** 追问只区分两档：会了 / 还不会（存为 known / unknown） */
const FOLLOWUP_OPTIONS: Array<{ value: Mastery; label: string }> = [
  { value: 'known', label: '会了' },
  { value: 'unknown', label: '还不会' },
];

/**
 * 单条「追问」：安静的一行问题 + 细 chevron，默认折叠，点按展开；条目间只用发丝线分隔。
 * 展开后答案下方是本条追问的「会了 / 还不会」文字开关（再点当前档清除），已标记时折叠行也显示一个小字状态。
 */
export function FollowUpItem({
  followup,
  mastery,
  onMasteryChange,
  scale = 1,
}: {
  followup: Followup;
  mastery: Mastery | null;
  onMasteryChange: (value: Mastery | null) => void;
  scale?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const statusLabel = mastery === 'known' ? '会了' : mastery ? '还不会' : null;
  return (
    <View style={styles.followUpItem}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={followup.q}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        style={({ pressed }) => [styles.followUpToggle, pressed && styles.pressed]}
      >
        <Text style={styles.followUpTitle}>{followup.q}</Text>
        {statusLabel ? <Text style={styles.status}>{statusLabel}</Text> : null}
        <ChevronDown
          size={18}
          color={colors.textSubtle}
          strokeWidth={1.6}
          style={expanded ? styles.chevronExpanded : undefined}
        />
      </Pressable>
      {expanded ? (
        <View style={styles.followUpBody}>
          <Markdown
            markdownit={markdownit}
            style={createFollowUpMarkdownStyles(scale)}
            rules={{ image: renderImage, th: renderTableHeader }}
          >
            {followup.a}
          </Markdown>
          <View style={styles.masteryRow}>
            {FOLLOWUP_OPTIONS.map((option) => {
              const selected = mastery === option.value || (option.value === 'unknown' && mastery === 'fuzzy');
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="button"
                  accessibilityLabel={`追问「${followup.q}」：${option.label}`}
                  accessibilityState={{ selected }}
                  hitSlop={6}
                  onPress={() => onMasteryChange(selected ? null : option.value)}
                  style={({ pressed }) => [styles.masteryButton, pressed && styles.pressed]}
                >
                  <Text style={[styles.masteryText, selected && styles.masteryTextActive]}>{option.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  followUpItem: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  followUpToggle: {
    minHeight: 48,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  followUpTitle: { ...typography.body, color: colors.textSecondary, flex: 1 },
  status: { ...typography.caption, color: colors.textSubtle },
  followUpBody: { paddingBottom: spacing.sm },
  masteryRow: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.xs },
  masteryButton: { minHeight: 36, justifyContent: 'center' },
  masteryText: { ...typography.caption, color: colors.textMuted },
  masteryTextActive: { color: colors.primary, fontWeight: '600', textDecorationLine: 'underline' },
  chevronExpanded: { transform: [{ rotate: '180deg' }] },
  pressed: { opacity: 0.6 },
});
