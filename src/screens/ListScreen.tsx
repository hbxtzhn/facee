import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CheckCircle2, ChevronRight, FileText, Search, Shuffle, X } from 'lucide-react-native';
import type { Question, QuestionBankCatalog } from '../question-bank';
import { collectTagSubtreeIds, filterCatalogQuestions, questionBankRepository } from '../question-bank';
import type { HomeStackParamList } from '../navigation/AppNavigator';
import { DifficultyBadge, EmptyState } from '../components/ui';
import { SkeletonBlock } from '../components/skeleton';
import { useEdgeSwipeBack } from '../lib/use-edge-swipe-back';
import { shuffled } from '../lib/shuffle';
import { cardChrome, colors, difficultyStyles, pressedScale, radii, spacing, typography } from '../theme';

type Nav = NativeStackNavigationProp<HomeStackParamList, 'List'>;
type ListRoute = RouteProp<HomeStackParamList, 'List'>;
const DIFFICULTY = difficultyStyles;

export function ListScreen() {
  const route = useRoute<ListRoute>();
  const nav = useNavigation<Nav>();
  const tagId = route.params.tagId;
  const categoryId = route.params.categoryId;
  const tagName = route.params.categoryName ?? route.params.tagName ?? '题目';
  const [keyword, setKeyword] = useState('');
  // §6.3 难度多选（并集）；§6.4 标签 chips 多选（父含子孙）
  const [difficulties, setDifficulties] = useState<ReadonlySet<1 | 2 | 3>>(new Set());
  const [tagFilter, setTagFilter] = useState<ReadonlySet<string>>(new Set());
  // 「随机刷」：练习队列按当前筛选结果洗牌（点题时构建，保持筛选语义不变）
  const [shuffle, setShuffle] = useState(false);
  const [items, setItems] = useState<Question[]>([]);
  // §6.2 正文命中：标题/标签即时匹配之外，再用安装期语料搜正文。
  // 注意：正文命中的题**不在** titleMatches 里，元数据必须单独取，不能拿 items 反查。
  const [bodyOnlyItems, setBodyOnlyItems] = useState<
    { question: Question; snippet: string | null }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const titleMatches = await questionBankRepository.listQuestions({
        tagId,
        categoryId,
        difficulties: [...difficulties],
        tagIds: [...tagFilter],
        query: keyword,
      });
      setItems(titleMatches);

      const trimmed = keyword.trim();
      if (!trimmed) {
        setBodyOnlyItems([]);
        return;
      }
      // 正文命中：只保留「标题没命中」的题，避免同一题出现两次
      const titleIds = new Set(titleMatches.map((question) => question.id));
      const hits = await questionBankRepository.searchBody(trimmed);
      const resolved = await Promise.all(
        hits
          .filter((hit) => !titleIds.has(hit.id))
          .map(async (hit) => {
            const question = await questionBankRepository.getQuestion(hit.id);
            return question ? { question, snippet: hit.snippet } : null;
          }),
      );
      setBodyOnlyItems(
        resolved.filter((entry): entry is { question: Question; snippet: string | null } => entry !== null),
      );
    } catch (loadError) {
      setItems([]);
      setBodyOnlyItems([]);
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [categoryId, difficulties, keyword, tagFilter, tagId]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 160);
    return () => clearTimeout(timer);
  }, [load]);

  // §6.4 父标签 chips：当前范围（分类/标签域）内实际出现的根标签；标签树抽屉明确不做
  const [catalog, setCatalog] = useState<QuestionBankCatalog | null>(null);
  useEffect(() => {
    let active = true;
    questionBankRepository
      .getCatalog()
      .then((loaded) => {
        if (active) setCatalog(loaded);
      })
      .catch(() => {
        if (active) setCatalog(null);
      });
    return () => {
      active = false;
    };
  }, []);

  const tagChips = useMemo(() => {
    if (!catalog) return [];
    const inScopeIds = new Set(
      filterCatalogQuestions(catalog, { tagId, categoryId }).map((question) => question.id),
    );
    const presentIds = new Set<string>();
    for (const question of catalog.questions) {
      if (!inScopeIds.has(question.id)) continue;
      for (const tag of question.tags) presentIds.add(tag.id);
    }
    return catalog.tags
      .filter((tag) => tag.parentId === null)
      .map((tag) => {
        const subtree = collectTagSubtreeIds(catalog.tags, tag.id);
        let count = 0;
        for (const question of catalog.questions) {
          if (!inScopeIds.has(question.id)) continue;
          if (question.tags.some((item) => subtree.has(item.id))) count += 1;
        }
        return { id: tag.id, name: tag.name, count };
      })
      .filter((chip) => chip.count > 0);
  }, [catalog, categoryId, tagId]);

  function toggleDifficulty(level: 1 | 2 | 3) {
    setDifficulties((current) => {
      const next = new Set(current);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  }

  function toggleTag(id: string) {
    setTagFilter((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearFilters() {
    setKeyword('');
    setDifficulties(new Set());
    setTagFilter(new Set());
  }

  const hasFilters = Boolean(keyword || difficulties.size > 0 || tagFilter.size > 0);

  // 左缘右滑返回首页（与详情页同一套手势 hook）
  const { panHandlers: swipeHandlers, onTouchStart: recordSwipeStart } = useEdgeSwipeBack({
    onEdgeBack: () => {
      if (nav.canGoBack()) nav.goBack();
      else nav.popToTop();
    },
  });

  return (
    <View style={styles.container} {...swipeHandlers} onTouchStart={recordSwipeStart}>
      <View style={styles.toolbar}>
        <View style={styles.searchBox}>
          <Search size={20} color={colors.textMuted} strokeWidth={1.8} />
          <TextInput
            style={styles.input}
            placeholder={`搜索${tagName}题目`}
            placeholderTextColor={colors.textSubtle}
            value={keyword}
            onChangeText={setKeyword}
            returnKeyType="search"
            autoCapitalize="none"
            accessibilityLabel="搜索题目"
          />
          {keyword ? (
            <Pressable accessibilityRole="button" accessibilityLabel="清除搜索关键词" hitSlop={8} onPress={() => setKeyword('')} style={styles.clearButton}>
              <X size={18} color={colors.textMuted} strokeWidth={2} />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.filterHeader}>
          <Text style={styles.filterLabel}>难度</Text>
          <Text style={styles.resultCount}>{loading ? '正在查找' : `${items.length} 道题`}</Text>
        </View>
        <View style={styles.filtersRow}>
          <View style={styles.diffRow} accessibilityLabel="难度筛选">
            {[1, 2, 3].map((level) => {
              const selected = difficulties.has(level as 1 | 2 | 3);
              const config = DIFFICULTY[level as keyof typeof DIFFICULTY];
              return (
                <Pressable
                  key={level}
                  accessibilityRole="checkbox"
                  accessibilityLabel={`${config.label}难度`}
                  accessibilityState={{ selected }}
                  onPress={() => toggleDifficulty(level as 1 | 2 | 3)}
                  style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.pressed]}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{config.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="随机刷"
            accessibilityState={{ selected: shuffle }}
            onPress={() => setShuffle((value) => !value)}
            style={({ pressed }) => [styles.chip, shuffle && styles.chipSelected, pressed && styles.pressed]}
          >
            <Shuffle size={13} color={shuffle ? colors.primary : colors.textMuted} strokeWidth={2} />
            <Text style={[styles.chipText, shuffle && styles.chipTextSelected]}>随机刷</Text>
          </Pressable>
        </View>

        {tagChips.length > 0 ? (
          <View style={styles.tagChipsRow}>
            {tagChips.map((chip) => {
              const selected = tagFilter.has(chip.id);
              return (
                <Pressable
                  key={chip.id}
                  accessibilityRole="checkbox"
                  accessibilityLabel={`按标签 ${chip.name} 筛选`}
                  accessibilityState={{ selected }}
                  onPress={() => toggleTag(chip.id)}
                  style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.pressed]}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                    {chip.name} · {chip.count}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>

      {loading && items.length === 0 ? (
        <View style={styles.listContent}>
          {[0, 1, 2, 3].map((row) => (
            <SkeletonBlock
              key={row}
              width="100%"
              height={76}
              radius={radii.md}
              style={{ marginBottom: spacing.md }}
            />
          ))}
        </View>
      ) : (
        <FlatList
          data={items}
          ListFooterComponent={
            bodyOnlyItems.length > 0 ? (
              <View style={styles.bodySection}>
                <Text style={styles.bodySectionTitle}>正文命中 {bodyOnlyItems.length} 题</Text>
                {bodyOnlyItems.map(({ question, snippet }) => (
                  <Pressable
                    key={question.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${question.title}，正文命中`}
                    onPress={() => nav.push('Detail', { id: question.id, meta: question })}
                    style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                  >
                    <View style={styles.rowBody}>
                      <Text style={styles.rowTitle} numberOfLines={2}>{question.title}</Text>
                      {snippet ? <Text style={styles.snippet} numberOfLines={2}>…{snippet}…</Text> : null}
                      <View style={styles.badges}>
                        <View style={styles.bodyBadge}>
                          <FileText size={13} color={colors.textMuted} strokeWidth={2} />
                          <Text style={styles.bodyBadgeText}>正文命中</Text>
                        </View>
                      </View>
                    </View>
                    <ChevronRight size={20} color={colors.textSubtle} strokeWidth={1.8} />
                  </Pressable>
                ))}
              </View>
            ) : null
          }
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const config = DIFFICULTY[item.difficulty];
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${item.title}，${config.label}${item.hasAnswer ? '，有参考答案' : ''}`}
                onPress={() => {
                  const queue = shuffle
                    ? shuffled(items.map((question) => question.id))
                    : items.map((question) => question.id);
                  nav.push('Detail', {
                    id: item.id,
                    meta: item,
                    queue,
                    queueIndex: queue.indexOf(item.id),
                    mode: 'practice',
                  });
                }}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              >
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle} numberOfLines={2}>{item.title}</Text>
                  <View style={styles.badges}>
                    <DifficultyBadge difficulty={item.difficulty} />
                    {item.hasAnswer ? (
                      <View style={styles.answerBadge}>
                        <CheckCircle2 size={13} color={colors.textMuted} strokeWidth={2} />
                        <Text style={styles.answerBadgeText}>有答案</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
                <ChevronRight size={20} color={colors.textSubtle} strokeWidth={1.8} />
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <EmptyState
              title={error ? '题目加载失败' : '没有找到匹配题目'}
              description={error ?? (hasFilters ? '换一个关键词，或清除难度筛选后再试。' : '这个分类暂时还没有题目。')}
              actionLabel={error ? '重新加载' : hasFilters ? '清除筛选' : undefined}
              onAction={error ? () => void load() : hasFilters ? clearFilters : undefined}
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  toolbar: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, backgroundColor: colors.background },
  searchBox: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radii.pill,
  },
  input: { ...typography.body, color: colors.text, flex: 1, paddingVertical: spacing.sm, fontSize: 14 },
  clearButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  bodySection: { marginTop: spacing.lg, paddingTop: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border },
  bodySectionTitle: { ...typography.label, color: colors.textMuted, marginBottom: spacing.sm },
  snippet: { ...typography.caption, color: colors.textMuted, marginTop: 4, lineHeight: 18 },
  bodyBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  bodyBadgeText: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },
  filterHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.md },
  filterLabel: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },
  resultCount: { ...typography.caption, color: colors.textSubtle },
  filtersRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.xs },
  diffRow: { flexDirection: 'row', gap: spacing.sm },
  tagChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  chip: {
    minHeight: 32,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceSubtle,
  },
  chipSelected: { backgroundColor: colors.primarySoft },
  chipText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  chipTextSelected: { color: colors.primary },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, flexGrow: 1, paddingTop: spacing.xs },
  row: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    ...cardChrome,
    borderRadius: radii.md,
    marginBottom: spacing.md,
  },
  rowBody: { flex: 1 },
  rowTitle: { ...typography.bodyStrong, color: colors.text, fontSize: 15, lineHeight: 21 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 6 },
  answerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  answerBadgeText: { ...typography.caption, color: colors.textMuted, fontWeight: '600', fontSize: 11 },
  pressed: { ...pressedScale },
});
