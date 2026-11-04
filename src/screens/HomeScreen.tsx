import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AppState,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, type CompositeNavigationProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ChevronDown } from 'lucide-react-native';
import type { HomeStackParamList, RootStackParamList } from '../navigation/AppNavigator';
import {
  buildCategorySummaries,
  collectTagSubtreeIds,
  filterCatalogQuestions,
  questionBankRepository,
  type Question,
  type QuestionBankCatalog,
  type QuestionTag,
} from '../question-bank';
import { useUserStore } from '../store/userStore';
import { useMasteryStore } from '../store/masteryStore';
import {
  resolveSessionQueue,
  usePracticeSessionStore,
  type PracticeMode,
} from '../store/practiceSessionStore';
import { computeDueQuestionIds, mergeBankReviewRecords } from '../lib/spaced-review';
import { EmptyState } from '../components/ui';
import { SkeletonBlock } from '../components/skeleton';
import { colors, layout, radii, spacing, typography } from '../theme';
import { BankSwitcherSheet } from './home/BankSwitcherSheet';
import { ICON_STROKE, ReadingRow, SectionLabel, TextAction } from './home/components/reading';

/** 首页在 HomeStack 内；题库管理页挂在 RootStack，navigate 会冒泡到根栈 */
type Nav = CompositeNavigationProp<
  NativeStackNavigationProp<HomeStackParamList, 'Home'>,
  NativeStackNavigationProp<RootStackParamList>
>;

interface TagItem extends QuestionTag {
  questionCount: number;
}

interface CategoryItem {
  id: string;
  name: string;
  questionCount: number;
  kind: 'category';
}

interface DomainItem extends TagItem {
  kind: 'tag';
}

type HomeEntry = CategoryItem | DomainItem;

/** 「继续上次练习」解析出的目标：完整队列 + 下标 + 模式 */
interface ResumeTarget {
  queue: string[];
  index: number;
  mode: PracticeMode;
  title?: string;
  question: Question | undefined;
}

export function HomeScreen() {
  const nav = useNavigation<Nav>();
  const lastViewedId = useUserStore((state) => state.lastViewedQuestionId);
  const totalCount = useUserStore((state) => state.totalCount);
  const masteryMarks = useMasteryStore((state) => state.marks);
  const masteryMarkedAt = useMasteryStore((state) => state.markedAt);
  const sessions = usePracticeSessionStore((state) => state.sessions);
  const [roots, setRoots] = useState<TagItem[]>([]);
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [catalog, setCatalog] = useState<QuestionBankCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 本机没有任何已启用题库（区别于读取失败）：空态给「安装官方题库」入口 */
  const [noBank, setNoBank] = useState(false);
  const [switcherVisible, setSwitcherVisible] = useState(false);
  const canManageBanks = Platform.OS !== 'web';

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    setNoBank(false);
    try {
      // 练习会话 store 由首页懒加载（App.tsx 不在本模块维护范围）；重复调用按 updatedAt 合并，安全
      await Promise.all([useMasteryStore.getState().load(), usePracticeSessionStore.getState().load()]);
      const loadedCatalog = await questionBankRepository.getCatalog();
      if (!loadedCatalog) {
        setNoBank(true);
        throw new Error('本机还没有安装题库');
      }
      setCatalog(loadedCatalog);
      setCategories(buildCategorySummaries(loadedCatalog).map((item) => ({ ...item, kind: 'category' as const })));
      setRoots(buildRootTags(loadedCatalog));
    } catch (loadError) {
      setCatalog(null);
      setRoots([]);
      setCategories([]);
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load(true);
    }, [load]),
  );

  const questionById = useMemo(
    () => new Map((catalog?.questions ?? []).map((question) => [question.id, question])),
    [catalog],
  );

  // 「继续上次练习」：优先按题库记住的练习会话原样恢复（队列 / 下标 / 模式），
  // 剔除题库更新后已不存在的题；没有会话（旧版本数据）时回退到 lastViewedQuestionId，
  // 队列 = 它所在分类的整份题目（无分类则全库），顺序与列表页一致。
  // lastViewed 可能是换库前的遗留，只有当前题库里真有这道题才展示入口。
  const resumeTarget = useMemo<ResumeTarget | null>(() => {
    if (!catalog) return null;
    const session = sessions[catalog.id];
    if (session) {
      const resolved = resolveSessionQueue(session, new Set(questionById.keys()));
      if (resolved) {
        return {
          ...resolved,
          mode: session.mode,
          title: session.title,
          question: questionById.get(resolved.queue[resolved.index]),
        };
      }
    }
    if (!lastViewedId) return null;
    const meta = questionById.get(lastViewedId);
    if (!meta) return null;
    const queue = filterCatalogQuestions(catalog, meta.categoryId ? { categoryId: meta.categoryId } : {}).map(
      (question) => question.id,
    );
    const categoryName = catalog.categories?.find((category) => category.id === meta.categoryId)?.name;
    return { queue, index: Math.max(0, queue.indexOf(lastViewedId)), mode: 'practice', title: categoryName, question: meta };
  }, [catalog, lastViewedId, questionById, sessions]);

  function resumePractice() {
    if (!catalog || !resumeTarget) return;
    const id = resumeTarget.queue[resumeTarget.index];
    usePracticeSessionStore.getState().saveSession(catalog.id, {
      queue: resumeTarget.queue,
      index: resumeTarget.index,
      mode: resumeTarget.mode,
      title: resumeTarget.title,
    });
    nav.push('Detail', {
      id,
      meta: resumeTarget.question,
      queue: resumeTarget.queue,
      queueIndex: resumeTarget.index,
      mode: resumeTarget.mode,
    });
  }

  // 今日复习：当前题库里按间隔口径到期的题（1/3/7 天，见 lib/spaced-review.ts）。
  // 只保留仍存在于题库的题，防孤儿数据；复用练习队列链路，不开新页面。
  // 到期判定只由墙上时钟驱动，而下方数据依赖都不随时间变化——
  // 停在首页跨过到期边界时必须靠粗粒度心跳与回前台刷新推进（评审 2026-10-02）。
  const [dueTick, setDueTick] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setDueTick(Date.now()), 60_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setDueTick(Date.now());
        void load(true);
      }
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [load]);

  const dueQuestionIds = useMemo(() => {
    if (!catalog) return [];
    const records = mergeBankReviewRecords(catalog.id, masteryMarks, masteryMarkedAt);
    return computeDueQuestionIds(records, dueTick).filter((questionId) => questionById.has(questionId));
  }, [catalog, masteryMarks, masteryMarkedAt, dueTick, questionById]);

  function startReview() {
    if (!catalog || dueQuestionIds.length === 0) return;
    const firstId = dueQuestionIds[0];
    usePracticeSessionStore.getState().saveSession(catalog.id, {
      queue: dueQuestionIds,
      index: 0,
      mode: 'review',
      title: '今日复习',
    });
    nav.push('Detail', {
      id: firstId,
      meta: questionById.get(firstId),
      queue: dueQuestionIds,
      queueIndex: 0,
      mode: 'review',
    });
  }

  // 每个分类 / 领域里已标「会了」的题数：行内弱化显示学习进度
  const knownCountByEntry = useMemo(() => {
    const counts = new Map<string, number>();
    if (!catalog) return counts;
    const marks = masteryMarks[catalog.id] ?? {};
    for (const question of catalog.questions) {
      if (marks[question.id] !== 'known') continue;
      if (question.categoryId) counts.set(question.categoryId, (counts.get(question.categoryId) ?? 0) + 1);
    }
    return counts;
  }, [catalog, masteryMarks]);

  function openOnlineBanks() {
    // TODO(merge): OnlineBanks 路由由另一位同事加入 RootStack，合并后去掉 as never
    nav.navigate('OnlineBanks' as never);
  }

  // 有分类就用分类（§5.1）；旧格式题库没有分类，回退到标签领域，行为不回归。
  const hasCategories = categories.length > 0;
  const entries: HomeEntry[] = hasCategories
    ? categories
    : roots.map((tag) => ({ ...tag, kind: 'tag' as const }));

  if (loading) {
    // 骨架：轮廓与真实排版一致（眉题 / 大标题 / 一组细行），避免居中转圈的突跳
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.skeletonContent}>
          <SkeletonBlock width={64} height={12} radius={radii.xs} />
          <SkeletonBlock width={196} height={30} radius={radii.xs} style={{ marginTop: spacing.sm }} />
          <SkeletonBlock width={148} height={14} radius={radii.xs} style={{ marginTop: spacing.sm }} />
          <SkeletonBlock width={48} height={12} radius={radii.xs} style={{ marginTop: spacing.xxxl }} />
          {[0, 1, 2, 3, 4, 5].map((row) => (
            <View key={row} style={styles.skeletonRow}>
              <SkeletonBlock width={row % 2 ? '46%' : '58%'} height={16} radius={radii.xs} />
              <SkeletonBlock width={24} height={12} radius={radii.xs} />
            </View>
          ))}
        </View>
      </SafeAreaView>
    );
  }

  const questionTotal = catalog?.questions.length ?? 0;
  const summaryParts = [
    catalog ? `共 ${questionTotal} 题` : null,
    totalCount > 0 ? `已刷 ${totalCount} 题` : null,
  ].filter((part): part is string => part !== null);
  const showToday = dueQuestionIds.length > 0 || resumeTarget !== null;

  const resumeMeta = resumeTarget
    ? [
        resumeTarget.title,
        `第 ${resumeTarget.index + 1} / ${resumeTarget.queue.length} 题`,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <FlatList
        data={entries}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load(true)}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.eyebrow}>FACEE · 题库</Text>
            {/* 当前题库切换器：标题即入口，点按弹出底部题库列表 */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={catalog ? `当前题库 ${catalog.title}，点按切换` : '还没有题库，点按添加'}
              accessibilityHint="打开题库列表，切换或管理题库"
              hitSlop={6}
              onPress={() => setSwitcherVisible(true)}
              style={({ pressed }) => [styles.bankSwitcher, pressed && styles.pressed]}
            >
              <Text style={styles.bankTitle} numberOfLines={2}>
                {catalog ? catalog.title : '选择题库'}
              </Text>
              <ChevronDown size={18} color={colors.textSecondary} strokeWidth={ICON_STROKE} style={styles.chevron} />
            </Pressable>
            {summaryParts.length > 0 ? <Text style={styles.summary}>{summaryParts.join(' · ')}</Text> : null}

            {showToday ? (
              <>
                <SectionLabel>今天</SectionLabel>
                {/* 今日复习：有到期题才出现，到齐即消失 */}
                {dueQuestionIds.length > 0 ? (
                  <ReadingRow
                    first
                    title={`今日复习 ${dueQuestionIds.length} 题`}
                    meta="按掌握度间隔安排的到期题，复习时重新打标顺延"
                    trailing="开始"
                    accessibilityLabel={`今日复习，${dueQuestionIds.length} 道题到期`}
                    accessibilityHint="按掌握度间隔安排的到期题队列，复习时重新打标顺延"
                    onPress={startReview}
                  />
                ) : null}
                {resumeTarget ? (
                  <ReadingRow
                    first={dueQuestionIds.length === 0}
                    emphasis
                    title="继续上次练习"
                    snippet={resumeTarget.question?.title ?? null}
                    meta={resumeMeta}
                    trailing="继续"
                    accessibilityLabel={`继续上次练习，${resumeTarget.question?.title ?? resumeTarget.queue[resumeTarget.index]}`}
                    accessibilityHint="回到上次的练习队列与位置，左右滑动切换题目"
                    onPress={resumePractice}
                  />
                ) : null}
              </>
            ) : null}

            {entries.length > 0 ? (
              <SectionLabel trailing={<Text style={styles.sectionCount}>{entries.length}</Text>}>
                {hasCategories ? '分类' : '知识领域'}
              </SectionLabel>
            ) : null}
          </View>
        }
        renderItem={({ item, index }) => {
          const count = item.questionCount;
          const known = item.kind === 'category' ? knownCountByEntry.get(item.id) ?? 0 : 0;
          return (
            <ReadingRow
              first={index === 0}
              title={item.name}
              titleLines={1}
              meta={known > 0 ? `已掌握 ${known} 题` : null}
              trailing={String(count)}
              accessibilityLabel={`${item.name}，${count} 道题`}
              onPress={() =>
                item.kind === 'category'
                  ? nav.push('List', { categoryId: item.id, categoryName: item.name })
                  : nav.push('List', { tagId: item.id, tagName: item.name })
              }
            />
          );
        }}
        ListEmptyComponent={
          noBank && canManageBanks ? (
            <View>
              <EmptyState
                title="还没有题库"
                description="安装一个官方线上题库，或新建本地题库后即可开始练习。"
                actionLabel="安装官方题库"
                onAction={openOnlineBanks}
              />
              <View style={styles.emptySecondary}>
                <TextAction label="新建本地题库" muted onPress={() => nav.navigate('BankManager')} />
              </View>
            </View>
          ) : (
            <EmptyState
              title={error ? '无法读取本地题库' : '题库里还没有分类'}
              description={error ?? '重新安装一个有效的题库包后即可开始学习。'}
              actionLabel="重新读取"
              onAction={() => void load()}
            />
          )
        }
        contentContainerStyle={styles.content}
      />
      <BankSwitcherSheet
        visible={switcherVisible}
        onClose={() => setSwitcherVisible(false)}
        onSwitched={() => void load(true)}
        onManage={() => nav.navigate('BankManager')}
        onOnlineBanks={openOnlineBanks}
        canManage={canManageBanks}
      />
    </SafeAreaView>
  );
}

export function buildRootTags(catalog: QuestionBankCatalog): TagItem[] {
  return catalog.tags
    .filter((tag) => tag.parentId === null)
    .sort((left, right) => left.sort - right.sort || left.id.localeCompare(right.id))
    .map((tag) => {
      const ids = collectTagSubtreeIds(catalog.tags, tag.id);
      return {
        ...tag,
        questionCount: catalog.questions.filter((question) =>
          question.tags.some((questionTag) => ids.has(questionTag.id)),
        ).length,
      };
    });
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: {
    paddingHorizontal: layout.pagePadding,
    paddingBottom: spacing.xxxl,
    flexGrow: 1,
    width: '100%',
    maxWidth: layout.readingMaxWidth,
    alignSelf: 'center',
  },
  header: { paddingTop: spacing.xl },
  eyebrow: { ...typography.eyebrow, color: colors.textMuted },
  bankSwitcher: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    maxWidth: '100%',
    marginTop: spacing.sm,
  },
  bankTitle: { ...typography.display, color: colors.text, flexShrink: 1 },
  chevron: { marginLeft: spacing.xs, marginTop: 4 },
  summary: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs },
  sectionCount: { ...typography.caption, color: colors.textSubtle },
  emptySecondary: { alignItems: 'center', marginTop: spacing.sm },
  pressed: { opacity: 0.6 },
  skeletonContent: { flex: 1, paddingHorizontal: layout.pagePadding, paddingTop: spacing.xl },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
});
