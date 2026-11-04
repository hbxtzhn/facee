import { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, type CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Bookmark, RotateCcw, Search } from 'lucide-react-native';
import { questionBankRepository, type Question } from '../question-bank';
import { useFavoritesStore } from '../store/favoritesStore';
import { useMasteryStore } from '../store/masteryStore';
import { usePracticeSessionStore } from '../store/practiceSessionStore';
import { useQuestionBankStore } from '../question-bank/store';
import type { MainTabParamList, RootStackParamList } from '../navigation/AppNavigator';
import { EmptyState } from '../components/ui';
import { SkeletonBlock } from '../components/skeleton';
import { colors, layout, radii, spacing, typography } from '../theme';
import { ReadingRow, TextAction, TextTabs, UnderlineSearchField } from './home/components/reading';
import { buildQuestionMeta } from './home/components/question-meta';

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
  const bankId = useQuestionBankStore((state) => state.catalog?.id ?? null);
  const bankTitle = useQuestionBankStore((state) => state.catalog?.title ?? null);
  const bankMarks = useMasteryStore((state) => (bankId ? state.marks[bankId] : undefined));

  const load = useCallback(async () => {
    setLoaded(false);
    // 收藏与掌握度都先拉到最新，再一次性派生两个列表
    await Promise.all([loadFavorites(), loadMastery()]);
    const all = await questionBankRepository.listQuestions();
    const byId = new Map(all.map((question) => [question.id, question]));

    // 收藏按题库隔离：ids 只含当前激活题库的收藏
    const favoriteIds = useFavoritesStore.getState().ids;
    setFavoriteItems(
      favoriteIds.map((id) => byId.get(id)).filter((question): question is Question => Boolean(question)),
    );

    // 错题本 = 当前题库里标成「不会 / 模糊」的题（派生，不存第二份真相）。
    // 旧题库遗留的标记（当前库不存在该题）静默过滤，但给一句提示。
    const activeBankId = useQuestionBankStore.getState().catalog?.id ?? null;
    const marks = activeBankId ? useMasteryStore.getState().marks[activeBankId] ?? {} : {};
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

  /** 以练习模式进入一组题，并记为当前题库的练习会话（首页「继续上次练习」据此恢复） */
  function startQueue(list: Question[], startIndex: number, title: string) {
    if (list.length === 0) return;
    const queue = list.map((question) => question.id);
    const activeBankId = useQuestionBankStore.getState().catalog?.id;
    if (activeBankId) {
      usePracticeSessionStore.getState().saveSession(activeBankId, {
        queue,
        index: startIndex,
        mode: 'practice',
        title,
      });
    }
    nav.navigate('Detail', {
      id: queue[startIndex],
      queue,
      queueIndex: startIndex,
      mode: 'practice',
      meta: list[startIndex],
    });
  }

  function startWrongReview() {
    startQueue(wrongItems, 0, '错题复习');
  }

  const segmentTitle = segment === 'favorites' ? '收藏' : '错题本';
  const subtitle =
    segment === 'favorites'
      ? '遇到好题先收着，随时离线翻阅。'
      : '标了「不会 / 模糊」的题都在这里，攻克后改标即可移出。';

  const tabAction =
    segment === 'wrong' && wrongItems.length > 0 ? (
      <TextAction
        label="开始复习"
        accessibilityLabel={`开始复习 ${wrongItems.length} 道错题`}
        onPress={startWrongReview}
      />
    ) : segment === 'favorites' && favoriteItems.length > 1 ? (
      <TextAction
        label="依次练习"
        accessibilityLabel={`依次练习 ${favoriteItems.length} 道收藏`}
        onPress={() => startQueue(favoriteItems, 0, '收藏')}
      />
    ) : null;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>{bankTitle ? `复习 · ${bankTitle}` : '复习'}</Text>
        <Text style={styles.title} accessibilityRole="header">{segmentTitle}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>

        <View style={styles.tabs}>
          <TextTabs
            tabs={[
              { key: 'favorites', label: '收藏', count: favoriteItems.length },
              { key: 'wrong', label: '错题', count: wrongItems.length },
            ]}
            value={segment}
            onChange={(next) => {
              setSegment(next);
              setQuery('');
            }}
            trailing={tabAction}
          />
        </View>

        {loaded && items.length > 0 ? (
          <UnderlineSearchField
            value={query}
            onChangeText={setQuery}
            placeholder={segment === 'favorites' ? '在收藏中搜索' : '在错题本中搜索'}
            accessibilityLabel="搜索当前列表"
            style={styles.search}
          />
        ) : null}
      </View>

      {!loaded ? (
        <View style={styles.listContent}>
          {[0, 1, 2, 3].map((row) => (
            <View key={row} style={styles.skeletonRow}>
              <SkeletonBlock width={row % 2 ? '70%' : '86%'} height={16} radius={radii.xs} />
              <SkeletonBlock width={110} height={12} radius={radii.xs} style={{ marginTop: spacing.sm }} />
            </View>
          ))}
        </View>
      ) : (
        <FlatList
          data={visibleItems}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.listContent}
          renderItem={({ item, index }) => (
            <ReadingRow
              first={index === 0}
              title={item.title}
              meta={buildQuestionMeta(item, bankMarks?.[item.id])}
              accessibilityLabel={`${item.title}，${DIFFICULTY_LABEL[item.difficulty] ?? '未知难度'}`}
              onPress={() =>
                startQueue(visibleItems, index, segment === 'favorites' ? '收藏' : '错题复习')
              }
            />
          )}
          ListHeaderComponent={
            segment === 'wrong' && orphanMarks > 0 && !query ? (
              <Text style={styles.orphanHint}>
                另有 {orphanMarks} 条标记来自已卸载的旧题库，未计入下方列表。
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
                description="刷题时遇到好题或难题，点右上角「收藏」即可在这里复习。收藏按题库分别保存。"
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
      )}
    </SafeAreaView>
  );
}

const hairline = StyleSheet.hairlineWidth;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingHorizontal: layout.pagePadding,
    paddingTop: spacing.xl,
    width: '100%',
    maxWidth: layout.readingMaxWidth,
    alignSelf: 'center',
  },
  eyebrow: { ...typography.eyebrow, color: colors.textMuted },
  title: { ...typography.display, color: colors.text, marginTop: spacing.sm },
  subtitle: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs, lineHeight: 18 },
  tabs: { marginTop: spacing.xl },
  search: { marginTop: spacing.sm },
  orphanHint: {
    ...typography.caption,
    color: colors.textSubtle,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  listContent: {
    paddingHorizontal: layout.pagePadding,
    paddingBottom: spacing.xxxl,
    paddingTop: spacing.sm,
    flexGrow: 1,
    width: '100%',
    maxWidth: layout.readingMaxWidth,
    alignSelf: 'center',
  },
  skeletonRow: {
    paddingVertical: spacing.lg,
    borderBottomWidth: hairline,
    borderBottomColor: colors.border,
  },
});
