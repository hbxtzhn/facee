import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronDown } from 'lucide-react-native';
import Markdown from 'react-native-markdown-display';
import markdownit from '../../lib/markdown';
import { colors, spacing, typography } from '../../theme';
import type { AnswerSection } from '../detail-content';
import { createFollowUpMarkdownStyles } from './markdown-styles';
import { renderImage, renderTableHeader } from './markdown-rules';

/** 单条「面试官追问」：安静的一行问题 + 细 chevron，默认折叠，点按展开；条目间只用发丝线分隔。 */
export function FollowUpItem({ section, scale = 1 }: { section: AnswerSection; scale?: number }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={styles.followUpItem}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={section.title}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        style={({ pressed }) => [styles.followUpToggle, pressed && styles.pressed]}
      >
        <Text style={styles.followUpTitle}>{section.title}</Text>
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
            {section.body}
          </Markdown>
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
  followUpBody: { paddingBottom: spacing.sm },
  chevronExpanded: { transform: [{ rotate: '180deg' }] },
  pressed: { opacity: 0.6 },
});
