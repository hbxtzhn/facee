import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { Search, X } from 'lucide-react-native';
import { colors, spacing, typography } from '../../../theme';

/**
 * 极简阅读风的页面原语（题库 / 列表 / 收藏三屏共用）：
 * 纸面底色、无阴影无卡片；层次只靠字号字重与留白，列表行之间用发丝线分隔。
 * 图标克制：18 号、细描边、次要文字色。
 */

export const ICON_SIZE = 18;
export const ICON_STROKE = 1.6;

/** 分区眉题：小号加字距的弱化文字，替代胶囊徽标与彩色标题块 */
export function SectionLabel({ children, trailing }: { children: string; trailing?: ReactNode }) {
  return (
    <View style={styles.sectionLabelRow}>
      <Text style={styles.sectionLabel} accessibilityRole="header">
        {children}
      </Text>
      {trailing}
    </View>
  );
}

/**
 * 纯文本列表行：标题（默认最多 2 行）+ 一行弱化元信息；右侧可放弱化的计数文字。
 * 行与行之间只有底部发丝线。
 */
export function ReadingRow({
  title,
  meta,
  snippet,
  trailing,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  titleLines = 2,
  emphasis = false,
  first = false,
}: {
  title: string;
  meta?: string | null;
  /** 正文命中片段等补充说明（弱化、最多 2 行） */
  snippet?: string | null;
  /** 右侧弱化文字（如题数） */
  trailing?: string | null;
  onPress: () => void;
  accessibilityLabel: string;
  accessibilityHint?: string;
  titleLines?: number;
  /** 强调行（如「继续上次练习」）：标题用主色 */
  emphasis?: boolean;
  /** 首行额外画一条顶部发丝线，与上方眉题拉开 */
  first?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => [styles.row, first && styles.rowFirst, pressed && styles.rowPressed]}
    >
      <View style={styles.rowBody}>
        <Text style={[styles.rowTitle, emphasis && styles.rowTitleEmphasis]} numberOfLines={titleLines}>
          {title}
        </Text>
        {snippet ? (
          <Text style={styles.rowSnippet} numberOfLines={2}>
            {snippet}
          </Text>
        ) : null}
        {meta ? (
          <Text style={styles.rowMeta} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </View>
      {trailing ? <Text style={styles.rowTrailing}>{trailing}</Text> : null}
    </Pressable>
  );
}

/** 文字分段页签：选中项主色加下划线，未选中弱化；整体底部一条发丝线 */
export function TextTabs<T extends string>({
  tabs,
  value,
  onChange,
  trailing,
}: {
  tabs: { key: T; label: string; count?: number }[];
  value: T;
  onChange: (key: T) => void;
  trailing?: ReactNode;
}) {
  return (
    <View style={styles.tabsRow}>
      <View style={styles.tabs} accessibilityRole="tablist">
        {tabs.map((tab) => {
          const active = tab.key === value;
          return (
            <Pressable
              key={tab.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${tab.label}（${tab.count ?? 0} 题）`}
              onPress={() => onChange(tab.key)}
              style={[styles.tab, active && styles.tabActive]}
            >
              <Text style={[styles.tabText, active && styles.tabTextActive]}>
                {tab.label}
                {tab.count ? <Text style={styles.tabCount}> {tab.count}</Text> : null}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {trailing}
    </View>
  );
}

/** 极简搜索框：只有一条底部发丝线，无填充底色 */
export function UnderlineSearchField({
  value,
  onChangeText,
  placeholder,
  accessibilityLabel,
  style,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.search, style]}>
      <Search size={ICON_SIZE} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
      <TextInput
        style={styles.searchInput}
        placeholder={placeholder}
        placeholderTextColor={colors.textSubtle}
        value={value}
        onChangeText={onChangeText}
        returnKeyType="search"
        autoCapitalize="none"
        accessibilityLabel={accessibilityLabel}
      />
      {value ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="清除搜索关键词"
          hitSlop={8}
          onPress={() => onChangeText('')}
          style={styles.searchClear}
        >
          <X size={ICON_SIZE} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** 行内文字按钮（主色），用于「开始复习」「筛选」等轻量操作 */
export function TextAction({
  label,
  onPress,
  accessibilityLabel,
  accessibilityState,
  muted = false,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  accessibilityState?: { selected?: boolean; expanded?: boolean };
  muted?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={accessibilityState}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.textAction, pressed && styles.rowPressed]}
    >
      <Text style={[styles.textActionLabel, muted && styles.textActionMuted]}>{label}</Text>
    </Pressable>
  );
}

const hairline = StyleSheet.hairlineWidth;

const styles = StyleSheet.create({
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xxl,
    marginBottom: spacing.xs,
  },
  sectionLabel: { ...typography.eyebrow, color: colors.textMuted },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.lg,
    borderBottomWidth: hairline,
    borderBottomColor: colors.border,
  },
  rowFirst: { borderTopWidth: hairline, borderTopColor: colors.border },
  rowPressed: { opacity: 0.6 },
  rowBody: { flex: 1 },
  rowTitle: { ...typography.body, color: colors.text, fontWeight: '500' },
  rowTitleEmphasis: { color: colors.primary, fontWeight: '600' },
  rowSnippet: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs, lineHeight: 18 },
  rowMeta: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs },
  rowTrailing: { ...typography.caption, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  tabsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: hairline,
    borderBottomColor: colors.border,
  },
  tabs: { flexDirection: 'row', gap: spacing.xl },
  tab: {
    paddingVertical: spacing.md,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    marginBottom: -hairline,
  },
  tabActive: { borderBottomColor: colors.primary },
  tabText: { ...typography.bodyStrong, color: colors.textMuted },
  tabTextActive: { color: colors.text },
  tabCount: { ...typography.caption, color: colors.textMuted, fontWeight: '400' },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    borderBottomWidth: hairline,
    borderBottomColor: colors.borderStrong,
  },
  searchInput: { ...typography.body, color: colors.text, flex: 1, paddingVertical: spacing.sm },
  searchClear: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  textAction: { paddingVertical: spacing.xs },
  textActionLabel: { ...typography.label, color: colors.primary },
  textActionMuted: { color: colors.textMuted, fontWeight: '400' },
});
