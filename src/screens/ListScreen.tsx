import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, type CompositeNavigationProp, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import {
  useBankStore,
  type Difficulty,
  type Importance,
  type Mastery,
  type QuestionFilter,
  type QuestionListItem,
  type QuestionType,
  type SectionInfo,
} from '../bank';
import type { HomeStackParamList, ListParams, RootStackParamList } from '../navigation/AppNavigator';
import { listTitle } from './home/components/list-title';
import { EmptyState } from '../components/ui';
import { SkeletonBlock } from '../components/skeleton';
import { shuffled } from '../lib/shuffle';
import { colors, layout, radii, spacing, typography } from '../theme';
import { ICON_SIZE, ICON_STROKE, ReadingRow, TextAction, UnderlineSearchField } from './home/components/reading';
import {
  DIFFICULTIES,
  DIFFICULTY_LABEL,
  IMPORTANCES,
  IMPORTANCE_LABEL,
  MASTERY_FILTERS,
  MASTERY_FILTER_LABEL,
  QUESTION_TYPES,
  TYPE_LABEL,
  buildQuestionMeta,
  summaryPreview,
} from './home/components/question-meta';
import { BankGateEmpty, useBankGateState, useEnsureBankInitialized } from './home/components/bank-gate';

/** 列表在 HomeStack 内；详情页挂在 RootStack，push 会冒泡到根栈 */
type Nav = CompositeNavigationProp<
  NativeStackNavigationProp<HomeStackParamList, 'List'>,
  NativeStackNavigationProp<RootStackParamList>
>;
type ListRoute = RouteProp<HomeStackParamList, 'List'>;

/** 列表行：题目 + 搜索命中片段（正文命中时） */
export interface ListRow {
  item: QuestionListItem;
  snippet: string | null;
}

export interface PanelFilters {
  difficulties: Difficulty[];
  types: QuestionType[];
  importance: Importance[];
  mastery: Array<Mastery | 'unmarked'>;
  tagIds: string[];
}

export const EMPTY_FILTERS: PanelFilters = { difficulties: [], types: [], importance: [], mastery: [], tagIds: [] };

/**
 * 入口范围 → 数据层筛选。分区取其中仍在题库中的分类；分区为空（或全部已不在题库中）时
 * 返回 null，表示范围内没有题（不能退化成整库）。
 */
export function scopeFilter(params: ListParams | undefined, sections: readonly SectionInfo[]): QuestionFilter | null {
  if (!params) return {};
  if (params.categoryId) return { categoryIds: [params.categoryId] };
  if (params.tagId) return { tagIds: [params.tagId] };
  if (params.collectionId) return { collectionId: params.collectionId };
  if (params.sectionId) {
    const section = sections.find((item) => item.id === params.sectionId);
    const categoryIds = (section?.categories ?? []).filter((category) => category.exists).map((category) => category.id);
    return categoryIds.length > 0 ? { categoryIds } : null;
  }
  if (params.updatedOnly) return { updatedSinceSeen: true };
  return {};
}

/** 合并范围与面板筛选；面板里的标签与入口标签同时存在时，数据层按「任一命中」处理，这里取面板值收窄 */
export function combineFilters(scope: QuestionFilter, panel: PanelFilters): QuestionFilter {
  const filter: QuestionFilter = { ...scope };
  if (panel.difficulties.length > 0) filter.difficulties = panel.difficulties;
  if (panel.types.length > 0) filter.types = panel.types;
  if (panel.importance.length > 0) filter.importance = panel.importance;
  if (panel.mastery.length > 0) filter.mastery = panel.mastery;
  if (panel.tagIds.length > 0 && !scope.tagIds) filter.tagIds = panel.tagIds;
  return filter;
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export function ListScreen() {
  const route = useRoute<ListRoute>();
  const nav = useNavigation<Nav>();
  useEnsureBankInitialized();
  const gate = useBankGateState();
  const params = route.params;
  const isGlobalSearch = params?.search === true;
  const title = listTitle(params);
  const sections = useBankStore((state) => state.sections);
  const tags = useBankStore((state) => state.tags);
  const contentVersion = useBankStore((state) => state.contentVersion);
  const learningVersion = useBankStore((state) => state.learningVersion);
  const [keyword, setKeyword] = useState('');
  const [panel, setPanel] = useState<PanelFilters>(EMPTY_FILTERS);
  // 「随机刷」：练习队列按当前结果洗牌（点题时构建，保持筛选语义不变）
  const [shuffle, setShuffle] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [rows, setRows] = useState<ListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (typeof nav.setOptions === 'function') nav.setOptions({ title });
  }, [nav, title]);

  // 分区数组在每次学习数据变化后都会换新引用：按内容（JSON）稳定范围，避免重复查询
  const scopeJson = JSON.stringify(scopeFilter(params, sections));
  const scope = useMemo(() => JSON.parse(scopeJson) as QuestionFilter | null, [scopeJson]);
  const filter = useMemo(() => (scope ? combineFilters(scope, panel) : null), [scope, panel]);
  const trimmed = keyword.trim();
  /** 全局搜索未输入关键词时不列整库，只给提示 */
  const idle = isGlobalSearch && !trimmed;

  const generation = useRef(0);
  const load = useCallback(async () => {
    const current = ++generation.current;
    const store = useBankStore.getState();
    if (store.status !== 'ready' || !store.activeBankId) {
      setRows([]);
      setLoading(false);
      return;
    }
    if (!filter || idle) {
      setRows([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    let next: ListRow[] = [];
    let failure: string | null = null;
    if (trimmed) {
      // 搜索：数据层负责 FTS（≥ 3 字）/ LIKE（1–2 字）与筛选；再取列表项补齐难度 / 掌握度等元信息
      const hits = await store.search(trimmed, { filter });
      if (!hits.ok) failure = hits.error.message;
      else if (hits.value.length > 0) {
        const items = await store.listQuestions({ ...filter, questionIds: hits.value.map((hit) => hit.id) });
        if (!items.ok) failure = items.error.message;
        else {
          const byId = new Map(items.value.map((item) => [item.id, item]));
          next = hits.value.flatMap((hit) => {
            const item = byId.get(hit.id);
            if (!item) return [];
            return [{ item, snippet: hit.matchedIn === 'body' && hit.snippet ? hit.snippet : null }];
          });
        }
      }
    } else {
      const items = await store.listQuestions(filter);
      if (!items.ok) failure = items.error.message;
      else next = items.value.map((item) => ({ item, snippet: null }));
    }
    if (current !== generation.current) return;
    setRows(next);
    setError(failure);
    setLoading(false);
  }, [filter, idle, trimmed]);

  // 关键词输入防抖；内容 / 学习数据变化（打标、收藏、题库更新）后重新查询
  useEffect(() => {
    const timer = setTimeout(() => void load(), trimmed ? 160 : 0);
    return () => clearTimeout(timer);
  }, [load, trimmed, gate, contentVersion, learningVersion]);

  // 标签筛选：根标签 + 其直接子标签（数据层自动含子孙）；入口本身是标签时不再显示
  const tagOptions = useMemo(() => {
    if (params?.tagId) return [];
    return tags.filter((tag) => tag.questionCount > 0 && (tag.parentId === null || tags.some((root) => root.id === tag.parentId && root.parentId === null)));
  }, [params?.tagId, tags]);

  async function openQuestion(id: string) {
    const ordered = rows.map((row) => row.item.id);
    const queue = shuffle ? shuffled(ordered) : ordered;
    const queueIndex = Math.max(0, queue.indexOf(id));
    await useBankStore.getState().saveSession({
      queue,
      index: queueIndex,
      mode: 'practice',
      title: shuffle ? `${title} · 随机` : title,
    });
    nav.push('Detail', { id, queue, queueIndex, mode: 'practice' });
  }

  const panelCount =
    panel.difficulties.length + panel.types.length + panel.importance.length + panel.mastery.length + panel.tagIds.length;
  const hasPanelFilters = panelCount > 0 || shuffle;
  const hasFilters = Boolean(trimmed) || panelCount > 0;

  function clearFilters() {
    setKeyword('');
    setPanel(EMPTY_FILTERS);
  }

  // 单行筛选摘要：「全部难度 · 全部类型 · …· 顺序」，点按展开筛选
  const filterSummary = [
    panel.difficulties.length > 0 ? panel.difficulties.map((d) => DIFFICULTY_LABEL[d]).join('、') : '全部难度',
    panel.types.length > 0 ? panel.types.map((t) => TYPE_LABEL[t]).join('、') : null,
    panel.importance.length > 0 ? panel.importance.map((i) => IMPORTANCE_LABEL[i]).join('、') : null,
    panel.mastery.length > 0 ? panel.mastery.map((m) => MASTERY_FILTER_LABEL[m]).join('、') : '全部掌握度',
    panel.tagIds.length > 0
      ? tags.filter((tag) => panel.tagIds.includes(tag.id)).map((tag) => tag.name).join('、')
      : null,
    shuffle ? '随机' : '顺序',
  ]
    .filter(Boolean)
    .join(' · ');

  const resultLabel = idle ? '' : loading ? '正在查找' : `${rows.length} 题`;

  if (gate !== 'ready') {
    return (
      <View style={[styles.container, styles.listContent]}>
        {gate === 'loading' ? null : (
          <BankGateEmpty
            state={gate}
            onOnlineBanks={() => nav.navigate('OnlineBanks')}
            onCreateLocal={() => nav.navigate('BankManager')}
          />
        )}
      </View>
    );
  }

  const header = (
    <View style={styles.toolbar}>
      <UnderlineSearchField
        value={keyword}
        onChangeText={setKeyword}
        placeholder={isGlobalSearch ? '搜索全部题目' : `在「${title}」中搜索`}
        accessibilityLabel="搜索题目"
        autoFocus={isGlobalSearch}
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
            {DIFFICULTIES.map((value) => (
              <FilterOption
                key={value}
                label={DIFFICULTY_LABEL[value]}
                accessibilityLabel={`${DIFFICULTY_LABEL[value]}难度`}
                selected={panel.difficulties.includes(value)}
                onPress={() => setPanel((p) => ({ ...p, difficulties: toggle(p.difficulties, value) }))}
              />
            ))}
          </FilterGroup>
          <FilterGroup label="类型">
            {QUESTION_TYPES.map((value) => (
              <FilterOption
                key={value}
                label={TYPE_LABEL[value]}
                accessibilityLabel={`${TYPE_LABEL[value]}题`}
                selected={panel.types.includes(value)}
                onPress={() => setPanel((p) => ({ ...p, types: toggle(p.types, value) }))}
              />
            ))}
          </FilterGroup>
          <FilterGroup label="频度">
            {IMPORTANCES.map((value) => (
              <FilterOption
                key={value}
                label={IMPORTANCE_LABEL[value]}
                accessibilityLabel={`重要度${IMPORTANCE_LABEL[value]}`}
                selected={panel.importance.includes(value)}
                onPress={() => setPanel((p) => ({ ...p, importance: toggle(p.importance, value) }))}
              />
            ))}
          </FilterGroup>
          <FilterGroup label="掌握">
            {MASTERY_FILTERS.map((value) => (
              <FilterOption
                key={value}
                label={MASTERY_FILTER_LABEL[value]}
                accessibilityLabel={`掌握度${MASTERY_FILTER_LABEL[value]}`}
                selected={panel.mastery.includes(value)}
                onPress={() => setPanel((p) => ({ ...p, mastery: toggle(p.mastery, value) }))}
              />
            ))}
          </FilterGroup>
          {tagOptions.length > 0 ? (
            <FilterGroup label="标签">
              {tagOptions.map((tag) => (
                <FilterOption
                  key={tag.id}
                  label={`${tag.name} · ${tag.questionCount}`}
                  accessibilityLabel={`按标签 ${tag.name} 筛选`}
                  selected={panel.tagIds.includes(tag.id)}
                  onPress={() => setPanel((p) => ({ ...p, tagIds: toggle(p.tagIds, tag.id) }))}
                />
              ))}
            </FilterGroup>
          ) : null}
          <FilterGroup label="顺序">
            <FilterOption label="顺序" selected={!shuffle} onPress={() => setShuffle(false)} />
            <FilterOption label="随机刷" selected={shuffle} onPress={() => setShuffle(true)} />
          </FilterGroup>
          {hasPanelFilters ? (
            <View style={styles.panelFooter}>
              <TextAction
                label="重置筛选"
                muted
                onPress={() => {
                  setPanel(EMPTY_FILTERS);
                  setShuffle(false);
                }}
              />
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );

  const emptyDescription = scope === null
    ? '这个分区里还没有题库中的分类，先去分区里添加分类。'
    : hasFilters
      ? '换一个关键词，或清除筛选后再试。'
      : params?.updatedOnly
        ? '学过的题都已是最新内容。'
        : '这里暂时还没有题目。';

  return (
    <View style={styles.container}>
      {/* 列表始终挂载：输入关键词触发加载时搜索框不能被卸载（会丢焦点） */}
      <FlatList
        data={rows}
        ListHeaderComponent={header}
        keyExtractor={(row) => row.item.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.listContent}
        renderItem={({ item: row, index }) => {
          const { item } = row;
          return (
            <ReadingRow
              first={index === 0}
              title={item.title}
              snippet={row.snippet ?? summaryPreview(item.summary)}
              snippetLines={1}
              badge={item.contentUpdated ? '内容已更新' : null}
              meta={buildQuestionMeta(item)}
              accessibilityLabel={`${item.title}，${buildQuestionMeta(item)}${item.contentUpdated ? '，内容已更新' : ''}`}
              onPress={() => void openQuestion(item.id)}
            />
          );
        }}
        ListEmptyComponent={
          idle ? (
            <Text style={styles.hint}>输入关键词搜索整个题库：标题、一句话、要点与详解都会命中。</Text>
          ) : loading ? (
            <View>
              {[0, 1, 2, 3, 4].map((row) => (
                <View key={row} style={styles.skeletonRow}>
                  <SkeletonBlock width={row % 2 ? '72%' : '88%'} height={16} radius={radii.xs} />
                  <SkeletonBlock width={120} height={12} radius={radii.xs} style={{ marginTop: spacing.sm }} />
                </View>
              ))}
            </View>
          ) : (
            <EmptyState
              title={error ? '题目加载失败' : '没有找到匹配题目'}
              description={error ?? emptyDescription}
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
  hint: { ...typography.caption, color: colors.textMuted, lineHeight: 18, paddingTop: spacing.lg },
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
