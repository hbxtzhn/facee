import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, type CompositeNavigationProp, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import type { Question, QuestionBankCatalog, QuestionFilter, QuestionTag } from '../question-bank';
import { collectTagSubtreeIds, filterCatalogQuestions, questionBankRepository } from '../question-bank';
import type { HomeStackParamList, RootStackParamList } from '../navigation/AppNavigator';
import { EmptyState } from '../components/ui';
import { SkeletonBlock } from '../components/skeleton';
import { shuffled } from '../lib/shuffle';
import { useMasteryStore } from '../store/masteryStore';
import { usePracticeSessionStore } from '../store/practiceSessionStore';
import { colors, difficultyStyles, layout, radii, spacing, typography } from '../theme';
import {
  ICON_SIZE,
  ICON_STROKE,
  ReadingRow,
  SectionLabel,
  TextAction,
  UnderlineSearchField,
} from './home/components/reading';
import { buildQuestionMeta } from './home/components/question-meta';

/** 列表在 HomeStack 内；详情页挂在 RootStack，push 会冒泡到根栈 */
type Nav = CompositeNavigationProp<
  NativeStackNavigationProp<HomeStackParamList, 'List'>,
  NativeStackNavigationProp<RootStackParamList>
>;
type ListRoute = RouteProp<HomeStackParamList, 'List'>;
type Level = 1 | 2 | 3;
const LEVELS: Level[] = [1, 2, 3];

type BodyHit = { question: Question; snippet: string | null };

/**
 * 正文命中只保留通过当前范围（分类 / 标签域）与筛选（难度 / 标签 chips）的题。
 * 与 listQuestions 用同一套判定（filterCatalogQuestions），只是不带关键词；
 * 保持正文命中原有的相关度顺序。
 */
export function filterBodyHits(hits: BodyHit[], tags: readonly QuestionTag[], filter: QuestionFilter): BodyHit[] {
  const passing = new Set(
    filterCatalogQuestions(
      { schemaVersion: 1, id: '', title: '', tags: [...tags], questions: hits.map((hit) => hit.question) },
      { ...filter, query: undefined },
    ).map((question) => question.id),
  );
  return hits.filter((hit) => passing.has(hit.question.id));
}

export function ListScreen() {
  const route = useRoute<ListRoute>();
  const nav = useNavigation<Nav>();
  const tagId = route.params.tagId;
  const categoryId = route.params.categoryId;
  const tagName = route.params.categoryName ?? route.params.tagName ?? '题目';
  const [keyword, setKeyword] = useState('');
  // §6.3 难度多选（并集）；§6.4 标签多选（父含子孙）
  const [difficulties, setDifficulties] = useState<ReadonlySet<Level>>(new Set());
  const [tagFilter, setTagFilter] = useState<ReadonlySet<string>>(new Set());
  // 「随机刷」：练习队列按当前筛选结果洗牌（点题时构建，保持筛选语义不变）
  const [shuffle, setShuffle] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [items, setItems] = useState<Question[]>([]);
  // §6.2 正文命中：标题/标签即时匹配之外，再用安装期语料搜正文。
  // 注意：正文命中的题**不在** titleMatches 里，元数据必须单独取，不能拿 items 反查。
  const [bodyOnlyItems, setBodyOnlyItems] = useState<BodyHit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 原生栈标题：导航层只读 tagName，分类入口会显示成「题目」，这里按实际入口名修正
  useLayoutEffect(() => {
    if (typeof nav.setOptions === 'function') nav.setOptions({ title: tagName });
  }, [nav, tagName]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const filter: QuestionFilter = {
      tagId,
      categoryId,
      difficulties: [...difficulties],
      tagIds: [...tagFilter],
    };
    try {
      const titleMatches = await questionBankRepository.listQuestions({ ...filter, query: keyword });
      setItems(titleMatches);

      const trimmed = keyword.trim();
      if (!trimmed) {
        setBodyOnlyItems([]);
        return;
      }
      // 正文命中：只保留「标题没命中」的题，避免同一题出现两次
      const titleIds = new Set(titleMatches.map((question) => question.id));
      const [hits, loadedCatalog] = await Promise.all([
        questionBankRepository.searchBody(trimmed),
        questionBankRepository.getCatalog().catch(() => null),
      ]);
      const resolved = await Promise.all(
        hits
          .filter((hit) => !titleIds.has(hit.id))
          .map(async (hit) => {
            const question = await questionBankRepository.getQuestion(hit.id);
            return question ? { question, snippet: hit.snippet } : null;
          }),
      );
      const bodyHits = resolved.filter((entry): entry is BodyHit => entry !== null);
      // 修复：正文命中此前只排除标题命中，完全忽略分类 / 标签 / 难度筛选
      setBodyOnlyItems(filterBodyHits(bodyHits, loadedCatalog?.tags ?? [], filter));
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

  // §6.4 父标签：当前范围（分类/标签域）内实际出现的根标签；标签树抽屉明确不做
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

  const bankMarks = useMasteryStore((state) => (catalog ? state.marks[catalog.id] : undefined));

  const tagChips = useMemo(() => {
    if (!catalog) return [];
    const inScopeIds = new Set(
      filterCatalogQuestions(catalog, { tagId, categoryId }).map((question) => question.id),
    );
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

  function toggleDifficulty(level: Level) {
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

  function openQuestion(item: Question) {
    const ordered = items.map((question) => question.id);
    const queue = shuffle ? shuffled(ordered) : ordered;
    const queueIndex = queue.indexOf(item.id);
    if (catalog) {
      usePracticeSessionStore.getState().saveSession(catalog.id, {
        queue,
        index: queueIndex,
        mode: 'practice',
        title: shuffle ? `${tagName} · 随机` : tagName,
      });
    }
    nav.push('Detail', { id: item.id, meta: item, queue, queueIndex, mode: 'practice' });
  }

  const hasFilters = Boolean(keyword || difficulties.size > 0 || tagFilter.size > 0);
  const hasPanelFilters = difficulties.size > 0 || tagFilter.size > 0 || shuffle;

  // 单行筛选摘要：「难度 · 标签 · 顺序」，点按展开原有筛选项
  const filterSummary = [
    difficulties.size > 0
      ? LEVELS.filter((level) => difficulties.has(level)).map((level) => difficultyStyles[level].label).join('、')
      : '全部难度',
    tagFilter.size > 0
      ? tagChips.filter((chip) => tagFilter.has(chip.id)).map((chip) => chip.name).join('、') || `${tagFilter.size} 个标签`
      : '全部标签',
    shuffle ? '随机' : '顺序',
  ].join(' · ');

  const resultLabel = loading ? '正在查找' : `${items.length} 题`;

  const header = (
    <View style={styles.toolbar}>
      <UnderlineSearchField
        value={keyword}
        onChangeText={setKeyword}
        placeholder={`搜索${tagName}题目`}
        accessibilityLabel="搜索题目"
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="筛选条件"
        accessibilityHint={`当前：${filterSummary}，点按${filtersOpen ? '收起' : '展开'}筛选`}
        accessibilityState={{ expanded: filtersOpen }}
        onPress={() => setFiltersOpen((open) => !open)}
        style={({ pressed }) => [styles.summaryRow, pressed && styles.pressed]}
      >
        <Text style={[styles.summaryText, hasPanelFilters && styles.summaryTextActive]} numberOfLines={1}>
          {filterSummary}
        </Text>
        {filtersOpen ? (
          <ChevronUp size={ICON_SIZE - 2} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
        ) : (
          <ChevronDown size={ICON_SIZE - 2} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
        )}
        <Text style={styles.resultCount}>{resultLabel}</Text>
      </Pressable>

      {filtersOpen ? (
        <View style={styles.panel}>
          <FilterGroup label="难度">
            {LEVELS.map((level) => (
              <FilterOption
                key={level}
                label={difficultyStyles[level].label}
                accessibilityLabel={`${difficultyStyles[level].label}难度`}
                selected={difficulties.has(level)}
                onPress={() => toggleDifficulty(level)}
              />
            ))}
          </FilterGroup>
          {tagChips.length > 0 ? (
            <FilterGroup label="标签">
              {tagChips.map((chip) => (
                <FilterOption
                  key={chip.id}
                  label={`${chip.name} · ${chip.count}`}
                  accessibilityLabel={`按标签 ${chip.name} 筛选`}
                  selected={tagFilter.has(chip.id)}
                  onPress={() => toggleTag(chip.id)}
                />
              ))}
            </FilterGroup>
          ) : null}
          <FilterGroup label="顺序">
            <FilterOption label="顺序" selected={!shuffle} onPress={() => setShuffle(false)} />
            <FilterOption label="随机刷" accessibilityLabel="随机刷" selected={shuffle} onPress={() => setShuffle(true)} />
          </FilterGroup>
          {hasPanelFilters ? (
            <View style={styles.panelFooter}>
              <TextAction
                label="重置筛选"
                muted
                onPress={() => {
                  setDifficulties(new Set());
                  setTagFilter(new Set());
                  setShuffle(false);
                }}
              />
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={styles.container}>
      {/* 列表始终挂载：输入关键词触发加载时搜索框不能被卸载（会丢焦点） */}
      <FlatList
        data={items}
        ListHeaderComponent={header}
        ListFooterComponent={
          bodyOnlyItems.length > 0 ? (
            <View>
              <SectionLabel>{`正文命中 ${bodyOnlyItems.length} 题`}</SectionLabel>
              {bodyOnlyItems.map(({ question, snippet }, index) => (
                <ReadingRow
                  key={question.id}
                  first={index === 0}
                  title={question.title}
                  snippet={snippet ? `…${snippet}…` : null}
                  meta={buildQuestionMeta(question, bankMarks?.[question.id])}
                  accessibilityLabel={`${question.title}，正文命中`}
                  onPress={() => nav.push('Detail', { id: question.id, meta: question })}
                />
              ))}
            </View>
          ) : null
        }
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.listContent}
        renderItem={({ item, index }) => {
          const config = difficultyStyles[item.difficulty];
          const meta = buildQuestionMeta(item, bankMarks?.[item.id]);
          return (
            <ReadingRow
              first={index === 0}
              title={item.title}
              meta={item.hasAnswer ? meta : `${meta} · 暂无答案`}
              accessibilityLabel={`${item.title}，${config.label}${item.hasAnswer ? '，有参考答案' : ''}`}
              onPress={() => openQuestion(item)}
            />
          );
        }}
        ListEmptyComponent={
          loading ? (
            <View>
              {[0, 1, 2, 3, 4].map((row) => (
                <View key={row} style={styles.skeletonRow}>
                  <SkeletonBlock width={row % 2 ? '72%' : '88%'} height={16} radius={radii.xs} />
                  <SkeletonBlock width={120} height={12} radius={radii.xs} style={{ marginTop: spacing.sm }} />
                </View>
              ))}
            </View>
          ) : bodyOnlyItems.length > 0 ? null : (
            <EmptyState
              title={error ? '题目加载失败' : '没有找到匹配题目'}
              description={error ?? (hasFilters ? '换一个关键词，或清除筛选后再试。' : '这个分类暂时还没有题目。')}
              actionLabel={error ? '重新加载' : hasFilters ? '清除筛选' : undefined}
              onAction={error ? () => void load() : hasFilters ? clearFilters : undefined}
            />
          )
        }
      />
    </View>
  );
}

function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.group}>
      <Text style={styles.groupLabel}>{label}</Text>
      <View style={styles.groupOptions}>{children}</View>
    </View>
  );
}

/** 文字型筛选项：选中 = 主色加粗 + 细下划线；不铺底色块 */
function FilterOption({
  label,
  selected,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected, checked: selected }}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.option, selected && styles.optionSelected, pressed && styles.pressed]}
    >
      <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{label}</Text>
    </Pressable>
  );
}

const hairline = StyleSheet.hairlineWidth;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  toolbar: { paddingTop: spacing.sm, paddingBottom: spacing.md },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
  },
  summaryText: { ...typography.caption, color: colors.textMuted, flexShrink: 1 },
  summaryTextActive: { color: colors.text, fontWeight: '600' },
  resultCount: { ...typography.caption, color: colors.textSubtle, marginLeft: 'auto', paddingLeft: spacing.md },
  panel: {
    paddingBottom: spacing.sm,
    borderBottomWidth: hairline,
    borderBottomColor: colors.border,
  },
  group: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: spacing.sm },
  groupLabel: { ...typography.eyebrow, color: colors.textMuted, width: 44, paddingTop: 2 },
  groupOptions: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.lg, rowGap: spacing.sm },
  option: { paddingBottom: 2, borderBottomWidth: 1, borderBottomColor: 'transparent' },
  optionSelected: { borderBottomColor: colors.primary },
  optionText: { ...typography.label, color: colors.textMuted, fontWeight: '400' },
  optionTextSelected: { color: colors.primary, fontWeight: '600' },
  panelFooter: { alignItems: 'flex-end', paddingTop: spacing.xs },
  listContent: {
    paddingHorizontal: layout.pagePadding,
    paddingBottom: spacing.xxxl,
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
  pressed: { opacity: 0.6 },
});
