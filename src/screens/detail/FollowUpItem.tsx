import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronDown } from 'lucide-react-native';
import Markdown from 'react-native-markdown-display';
import markdownit from '../../lib/markdown';
import { colors, spacing, typography } from '../../theme';
import type { AnswerSection } from '../detail-content';
import { markdownStyles } from './markdown-styles';
import { renderImage, renderTableHeader } from './markdown-rules';

/** 答案卡内的单条「面试官追问」：默认折叠，点按展开。 */
export function FollowUpItem({ section }: { section: AnswerSection }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={styles.followUpItem}>
      <Pressable accessibilityRole="button" accessibilityLabel={section.title} accessibilityState={{ expanded }} onPress={() => setExpanded((value) => !value)} style={({ pressed }) => [styles.followUpToggle, pressed && styles.pressed]}>
        <Text style={styles.followUpTitle}>{section.title}</Text>
        <ChevronDown size={18} color={colors.textMuted} style={expanded ? styles.chevronExpanded : undefined} />
      </Pressable>
      {expanded ? (
        <View style={styles.followUpBody}>
          <Markdown markdownit={markdownit} style={markdownStyles} rules={{ image: renderImage, th: renderTableHeader }}>{section.body}</Markdown>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  followUpItem: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingLeft: spacing.sm,
    marginBottom: spacing.xs,
  },
  followUpToggle: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  followUpTitle: { ...typography.bodyStrong, color: colors.text, flex: 1, fontSize: 14 },
  followUpBody: {
    paddingBottom: spacing.md,
  },
  chevronExpanded: { transform: [{ rotate: '180deg' }] },
  pressed: { opacity: 0.75 },
});
