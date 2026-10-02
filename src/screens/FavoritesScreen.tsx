import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, type CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Bookmark, ChevronRight, Play, RotateCcw, Search, X } from 'lucide-react-native';
import { questionBankRepository, type Question } from '../question-bank';
import { useFavoritesStore } from '../store/favoritesStore';
import { useMasteryStore } from '../store/masteryStore';
import { useQuestionBankStore } from '../question-bank/store';
import type { MainTabParamList, RootStackParamList } from '../navigation/AppNavigator';
import { DifficultyBadge, EmptyState, TabHeader } from '../components/ui';
import { SkeletonBlock } from '../components/skeleton';
import { cardChrome, colors, pressedScale, radii, spacing, typography } from '../theme';

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Favorites'>,
  NativeStackNavigationProp<RootStackParamList>
>;

type Segment = 'favorites' | 'wrong';

const DIFFICULTY_LABEL: Record<number, string> = { 1: '简单', 2: '中等', 3: '困难' };

export function FavoritesScreen() {
  const loadFavorites = useFavoritesStore((state) => state.load);
  const loadMastery = useMasteryStore((state) => state.load);
  const nav = useNavigation<Nav>();
  const [segment, setSegment] = useState<Segment>('favorites');
  const [favoriteItems, setFavoriteItems] = useState<Question[]>([]);
  const [wrongItems, setWrongItems] = useState<Question[]>([]);
  const [orphanMarks, setOrphanMarks] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setLoaded(false);
    // 收藏与掌握度都先拉到最新，再一次性派生两个列表
    await Promise.all([loadFavorites(), loadMastery()]);
    const all = await questionBankRepository.listQuestions();
    const byId = new Map(all.map((question) => [question.id, question]));

    const favoriteIds = useFavoritesStore.getState().ids;
    setFavoriteItems(
      favoriteIds.map((id) => byId.get(id)).filter((question): question is Question => Boolean(question)),
    );

    // 错题本 = 当前题库里标成「不会 / 模糊」的题（派生，不存第二份真相）。
    // 旧题库遗留的标记（当前库不存在该题）静默过滤，但给一句提示。
    const bankId = useQuestionBankStore.getState().catalog?.id ?? null;
    const marks = bankId ? useMasteryStore.getState().marks[bankId] ?? {} : {};
    const wrongIds = Object.entries(marks)
      .filter(([, mastery]) => mastery === 'unknown' || mastery === 'fuzzy')
      .map(([id]) => id);
    const resolved = wrongIds
      .map((id) => byId.get(id))
      .filter((question): question is Question => Boolean(question));
    setWrongItems(resolved);
    setOrphanMarks(wrongIds.length - resolved.length);
    setLoaded(true);
  }, [loadFavorites, loadMastery]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void load().then(() => { if (!active) { setFavoriteItems([]); setWrongItems([]); } });
      return () => { active = false; };
    }, [load]),
  );

  const items = segment === 'favorites' ? favoriteItems : wrongItems;

  // 列表内关键词过滤（纯内存，§6.5 回显由输入框本身 + 一键清除承担）
  const [query, setQuery] = useState('');
  const visibleItems = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return items;
    return items.filter((item) => item.title.toLocaleLowerCase().includes(needle));
  }, [items, query]);

  function startWrongReview() {
    if (wrongItems.length === 0) return;
    const queue = wrongItems.map((question) => question.id);
    nav.navigate('Detail', {
      id: queue[0],
      queue,
      queueIndex: 0,
      mode: 'practice',
      meta: wrongItems[0],
    });
  }

  const renderRow = (item: Question) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.title}，${DIFFICULTY_LABEL[item.difficulty] ?? '未知难度'}`}
      onPress={() => nav.navigate('Detail', { id: item.id, meta: item })}
      style={({ pressed }) => [styles.rowCard, pressed && styles.cardPressed]}
    >
      <View style={styles.cardMain}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {item.title}
        </Text>
        <View style={styles.metaRow}>
          <DifficultyBadge difficulty={item.difficulty as 1 | 2 | 3} />
          <Text style={styles.tagText}>{item.tags?.[0]?.name ?? '通用'}</Text>
        </View>
      </View>
      <ChevronRight size={18} color={colors.textSubtle} strokeWidth={1.8} />
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <TabHeader
          eyebrow={segment === 'favorites' ? '稍后复习 · 收藏夹' : '攻克它们 · 错题本'}
          title={segment === 'favorites' ? '我的收藏' : '错题本'}
          subtitle={
            segment === 'favorites'
              ? '遇到好题先收着，随时全离线翻阅。'
              : '标了「不会 / 模糊」的题都在这里，攻克后改标即可移出。'
          }
          action={items.length > 0 ? (
            <View style={styles.headerMetaPill}>
              {segment === 'favorites' ? (
                <Bookmark size={12} color={colors.textSecondary} strokeWidth={2.2} />
              ) : (
                <RotateCcw size={12} color={colors.textSecondary} strokeWidth={2.2} />
              )}
              <Text style={styles.headerMetaPillText}>{items.length} 题</Text>
            </View>
          ) : null}
        />

        {/* 收藏 | 错题 分段切换 */}
        <View style={styles.segmentRow}>
          <View style={styles.segmentControl} accessibilityRole="tablist">
            <SegmentButton
              label="收藏"
              count={favoriteItems.length}
              active={segment === 'favorites'}
              onPress={() => setSegment('favorites')}
            />
            <SegmentButton
              label="错题"
              count={wrongItems.length}
              active={segment === 'wrong'}
              onPress={() => setSegment('wrong')}
            />
          </View>
          {segment === 'wrong' && wrongItems.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`开始复习 ${wrongItems.length} 道错题`}
              onPress={startWrongReview}
              style={({ pressed }) => [styles.reviewButton, pressed && styles.cardPressed]}
            >
              <Play size={13} color={colors.primary} strokeWidth={2.2} />
              <Text style={styles.reviewButtonText}>开始复习</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {!loaded ? (
        <View style={styles.skeletonList}>
          {[0, 1, 2].map((row) => (
            <SkeletonBlock
              key={row}
              width="100%"
              height={88}
              radius={radii.md}
              style={{ marginBottom: spacing.md }}
            />
          ))}
        </View>
      ) : (
        <>
          {items.length > 0 ? (
            <View style={styles.searchBox}>
              <Search size={16} color={colors.textMuted} strokeWidth={1.8} />
              <TextInput
                style={styles.searchInput}
                placeholder={segment === 'favorites' ? '在收藏中搜索' : '在错题本中搜索'}
                placeholderTextColor={colors.textSubtle}
                value={query}
                onChangeText={setQuery}
                returnKeyType="search"
                autoCapitalize="none"
                accessibilityLabel="搜索当前列表"
              />
              {query ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="清除搜索关键词"
                  hitSlop={8}
                  onPress={() => setQuery('')}
                  style={styles.searchClear}
                >
                  <X size={16} color={colors.textMuted} strokeWidth={2} />
                </Pressable>
              ) : null}
            </View>
          ) : null}
          <FlatList
            data={visibleItems}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => renderRow(item)}
            ListHeaderComponent={
              segment === 'wrong' && orphanMarks > 0 && !query ? (
                <Text style={styles.orphanHint}>
                  另有 {orphanMarks} 条标记来自已卸载的旧题库，未计入上方列表。
                </Text>
              ) : null
            }
            ListEmptyComponent={
              items.length > 0 && visibleItems.length === 0 ? (
                <EmptyState
                  title={`没有匹配「${query.trim()}」的题目`}
                  description="换个关键词，或清除搜索后再试。"
                  actionLabel="清除搜索"
                  onAction={() => setQuery('')}
                  icon={Search}
                />
              ) : segment === 'favorites' ? (
                <EmptyState
                  title="还没有收藏题目"
                  description="刷题过程中遇到好题或难题，点击右上角“收藏”即可随时在此复习。"
                  actionLabel="去题库逛逛"
                  onAction={() => nav.navigate('HomeTab')}
                  icon={Bookmark}
                />
              ) : (
                <EmptyState
                  title="错题本是空的"
                  description="练习中把题标成「不会 / 模糊」，它们会自动出现在这里等你攻克。"
                  actionLabel="去刷几道题"
                  onAction={() => nav.navigate('HomeTab')}
                  icon={RotateCcw}
                />
              )
            }
          />
        </>
      )}
    </SafeAreaView>
  );
}

function SegmentButton({
  label,
  count,
  active,
  onPress,
}: {
  label: string;
  count: number;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${label}（${count} 题）`}
      onPress={onPress}
      style={({ pressed }) => [styles.segmentButton, active && styles.segmentButtonActive, pressed && styles.cardPressed]}
    >
      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
      {count > 0 ? <Text style={[styles.segmentCount, active && styles.segmentTextActive]}>{count}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  headerMetaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surfaceWarm,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  headerMetaPillText: { ...typography.caption, color: colors.textMuted, fontWeight: '600', fontSize: 11 },
  segmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  segmentControl: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radii.pill,
    padding: 3,
    gap: 2,
  },
  segmentButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.pill,
  },
  segmentButtonActive: {
    backgroundColor: colors.surface,
    ...cardChrome,
  },
  segmentText: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },
  segmentTextActive: { color: colors.text },
  segmentCount: { ...typography.caption, color: colors.textSubtle, fontSize: 11 },
  reviewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radii.pill,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primaryMuted,
  },
  reviewButtonText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  orphanHint: {
    ...typography.caption,
    color: colors.textSubtle,
    marginBottom: spacing.sm,
  },
  searchBox: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radii.pill,
  },
  searchInput: { ...typography.body, color: colors.text, flex: 1, paddingVertical: spacing.xs, fontSize: 14 },
  searchClear: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  skeletonList: { paddingHorizontal: spacing.lg, flexGrow: 1 },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, flexGrow: 1, paddingTop: spacing.sm },
  rowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    ...cardChrome,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardPressed: { ...pressedScale },
  cardMain: { flex: 1, marginRight: spacing.sm },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
  tagText: { ...typography.caption, color: colors.textSubtle, fontSize: 11 },
  cardTitle: { ...typography.bodyStrong, color: colors.text, fontSize: 14, lineHeight: 20 },
});
