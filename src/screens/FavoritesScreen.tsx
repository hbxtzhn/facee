import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, type CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Bookmark, RotateCcw, Search } from 'lucide-react-native';
import { useBankStore, type QuestionListItem } from '../bank';
import type { MainTabParamList, RootStackParamList } from '../navigation/AppNavigator';
import { EmptyState } from '../components/ui';
import { SkeletonBlock } from '../components/skeleton';
import { colors, layout, radii, spacing, typography } from '../theme';
import { ReadingRow, TextAction, TextTabs, UnderlineSearchField } from './home/components/reading';
import { buildQuestionMeta, summaryPreview } from './home/components/question-meta';
import { BankGateEmpty, useBankGateState, useEnsureBankInitialized } from './home/components/bank-gate';

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Favorites'>,
  NativeStackNavigationProp<RootStackParamList>
>;

type Segment = 'favorites' | 'wrong';

/**
 * 收藏 | 错题（当前题库，换库自动跟随）：
 * 收藏 = 数据层 favoritesOnly；错题 = 标成「不会 / 模糊」的题（mastery 筛选，派生，不存第二份真相）。
 */
export function FavoritesScreen() {
  const nav = useNavigation<Nav>();
  useEnsureBankInitialized();
  const gate = useBankGateState();
  const bankName = useBankStore((state) => state.activeBank?.name ?? null);
  const activeBankId = useBankStore((state) => state.activeBankId);
  const contentVersion = useBankStore((state) => state.contentVersion);
  const learningVersion = useBankStore((state) => state.learningVersion);
  const [segment, setSegment] = useState<Segment>('favorites');
  const [favoriteItems, setFavoriteItems] = useState<QuestionListItem[]>([]);
  const [wrongItems, setWrongItems] = useState<QuestionListItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** 加载代次：较早发起、较晚完成的旧加载不得覆盖新结果 */
  const loadGeneration = useRef(0);

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    const store = useBankStore.getState();
    if (store.status !== 'ready' || !store.activeBankId) {
      setFavoriteItems([]);
      setWrongItems([]);
      setLoaded(true);
      return;
    }
    const [favorites, wrong] = await Promise.all([
      store.listQuestions({ favoritesOnly: true }),
      store.listQuestions({ mastery: ['unknown', 'fuzzy'] }),
    ]);
    if (generation !== loadGeneration.current) return;
    setFavoriteItems(favorites.ok ? favorites.value : []);
    setWrongItems(wrong.ok ? wrong.value : []);
    setError(!favorites.ok ? favorites.error.message : !wrong.ok ? wrong.error.message : null);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load, gate, activeBankId, contentVersion, learningVersion]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const items = segment === 'favorites' ? favoriteItems : wrongItems;

  // 列表内关键词过滤（纯内存；整库搜索在首页）
  const [query, setQuery] = useState('');
  const visibleItems = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return items;
    return items.filter((item) => item.title.toLocaleLowerCase().includes(needle));
  }, [items, query]);

  /** 以练习模式进入一组题，并记为当前题库的练习会话（首页「继续上次练习」据此恢复） */
  async function startQueue(list: QuestionListItem[], startIndex: number, title: string) {
    if (list.length === 0) return;
    const queue = list.map((item) => item.id);
    await useBankStore.getState().saveSession({ queue, index: startIndex, mode: 'practice', title });
    nav.navigate('Detail', { id: queue[startIndex], queue, queueIndex: startIndex, mode: 'practice' });
  }

  if (gate !== 'ready') {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>复习</Text>
          <Text style={styles.title} accessibilityRole="header">收藏</Text>
        </View>
        <View style={styles.listContent}>
          {gate === 'loading' ? null : (
            <BankGateEmpty
              state={gate}
              onOnlineBanks={() => nav.navigate('OnlineBanks')}
              onCreateLocal={() => nav.navigate('BankManager')}
            />
          )}
        </View>
      </SafeAreaView>
    );
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
        onPress={() => void startQueue(wrongItems, 0, '错题复习')}
      />
    ) : segment === 'favorites' && favoriteItems.length > 1 ? (
      <TextAction
        label="依次练习"
        accessibilityLabel={`依次练习 ${favoriteItems.length} 道收藏`}
        onPress={() => void startQueue(favoriteItems, 0, '收藏')}
      />
    ) : null;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>{bankName ? `复习 · ${bankName}` : '复习'}</Text>
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
              snippet={summaryPreview(item.summary)}
              snippetLines={1}
              badge={item.contentUpdated ? '内容已更新' : null}
              meta={buildQuestionMeta(item)}
              accessibilityLabel={`${item.title}，${buildQuestionMeta(item)}`}
              onPress={() =>
                void startQueue(visibleItems, index, segment === 'favorites' ? '收藏' : '错题复习')
              }
            />
          )}
          ListHeaderComponent={error ? <Text style={styles.errorHint} accessibilityRole="alert">{error}</Text> : null}
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
                description="刷题时遇到好题或难题，点「收藏」即可在这里复习。收藏按题库分别保存，换库自动切换。"
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
  errorHint: {
    ...typography.caption,
    color: colors.danger,
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
