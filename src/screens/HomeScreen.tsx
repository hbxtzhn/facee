import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  Boxes,
  BriefcaseBusiness,
  ChevronRight,
  Code2,
  Cpu,
  Database,
  GitBranch,
  Globe,
  HardDrive,
  Layers3,
  Leaf,
  MessagesSquare,
  Network,
  Play,
  RotateCcw,
  Server,
  Sparkles,
  Zap,
  type LucideIcon,
} from 'lucide-react-native';
import type { HomeStackParamList } from '../navigation/AppNavigator';
import {
  buildCategorySummaries,
  collectTagSubtreeIds,
  filterCatalogQuestions,
  questionBankRepository,
  type QuestionBankCatalog,
  type QuestionTag,
} from '../question-bank';
import { useUserStore } from '../store/userStore';
import { useMasteryStore } from '../store/masteryStore';
import { computeDueQuestionIds, mergeBankReviewRecords } from '../lib/spaced-review';
import { EmptyState, TabHeader } from '../components/ui';
import { SkeletonBlock } from '../components/skeleton';
import { cardChrome, colors, pressedScale, radii, spacing, tints, typography } from '../theme';

type Nav = NativeStackNavigationProp<HomeStackParamList, 'Home'>;

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

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  java: Code2,
  'java-basic': Code2,
  jvm: Cpu,
  spring: Leaf,
  database: Database,
  mysql: Database,
  redis: Boxes,
  cache: Zap,
  concurrent: Server,
  middleware: Layers3,
  mq: MessagesSquare,
  network: Globe,
  'cs-basic': Globe,
  os: HardDrive,
  distributed: GitBranch,
  architecture: Network,
  ai: Sparkles,
  projects: BriefcaseBusiness,
};

/** 未知分类的兜底图标：按 id 哈希轮换，避免整列同一个图形 */
const FALLBACK_ICONS: LucideIcon[] = [Layers3, Code2, Database, Network, Boxes, Cpu];

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

/**
 * 分类视觉：图标 + 软底色 + 前景色成组返回。
 * 分类集合由题库数据决定（规范 §5.1），无法写死品牌图标；
 * 已知领域给专属图形，其余按 id 确定性轮换兜底图标与色板。
 */
export function resolveCategoryVisual(id: string): { Icon: LucideIcon; bg: string; fg: string } {
  const hash = hashString(id);
  const Icon = CATEGORY_ICONS[id] ?? FALLBACK_ICONS[hash % FALLBACK_ICONS.length];
  const tint = tints[hash % tints.length];
  return { Icon, bg: tint.bg, fg: tint.fg };
}

export function HomeScreen() {
  const nav = useNavigation<Nav>();
  const lastViewedId = useUserStore((state) => state.lastViewedQuestionId);
  const totalCount = useUserStore((state) => state.totalCount);
  const masteryMarks = useMasteryStore((state) => state.marks);
  const masteryMarkedAt = useMasteryStore((state) => state.markedAt);
  const [roots, setRoots] = useState<TagItem[]>([]);
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [catalog, setCatalog] = useState<QuestionBankCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      await useMasteryStore.getState().load();
      const loadedCatalog = await questionBankRepository.getCatalog();
      if (!loadedCatalog) throw new Error('本机还没有安装题库');
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

  // 「继续上次练习」：以练习模式回到上次那道题，队列 = 它所在分类的整份题目
  // （无分类则回退全库），顺序与列表页一致（sort → id）。找不到元数据时退回浏览模式。
  function resumePractice() {
    if (!lastViewedId) return;
    const meta = catalog?.questions.find((question) => question.id === lastViewedId);
    if (!meta) {
      nav.push('Detail', { id: lastViewedId });
      return;
    }
    const siblings = filterCatalogQuestions(catalog!, meta.categoryId ? { categoryId: meta.categoryId } : {});
    const queue = siblings.map((question) => question.id);
    nav.push('Detail', {
      id: lastViewedId,
      meta,
      queue,
      queueIndex: queue.indexOf(lastViewedId),
      mode: 'practice',
    });
  }

  // 「继续上次练习」只在当前题库里真的有这道题时展示：
  // 换题库后 lastViewed 可能是旧库遗留，避免点进去报「没有找到元数据」
  const lastViewedExists =
    lastViewedId !== null &&
    (catalog === null || catalog.questions.some((question) => question.id === lastViewedId));

  // 今日复习：当前题库里按间隔口径到期的题（1/3/7 天，见 lib/spaced-review.ts）。
  // 只保留仍存在于题库的题，防孤儿数据；复用练习队列链路，不开新页面。
  const dueQuestionIds = React.useMemo(() => {
    if (!catalog) return [];
    const records = mergeBankReviewRecords(catalog.id, masteryMarks, masteryMarkedAt);
    const existing = new Set(catalog.questions.map((question) => question.id));
    return computeDueQuestionIds(records, Date.now()).filter((questionId) => existing.has(questionId));
  }, [catalog, masteryMarks, masteryMarkedAt]);

  function startReview() {
    if (!catalog || dueQuestionIds.length === 0) return;
    const firstId = dueQuestionIds[0];
    const meta = catalog.questions.find((question) => question.id === firstId);
    nav.push('Detail', {
      id: firstId,
      meta,
      queue: dueQuestionIds,
      queueIndex: 0,
      mode: 'review',
    });
  }

  // 有分类就用分类（§5.1）；旧格式题库没有分类，回退到标签领域，行为不回归。
  const hasCategories = categories.length > 0;
  const entries: HomeEntry[] = hasCategories
    ? categories
    : roots.map((tag) => ({ ...tag, kind: 'tag' as const }));

  if (loading) {
    // 骨架屏：轮廓直接复用真实布局，避免居中转圈的「空白突跳」
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.skeletonContent}>
          <View style={styles.skeletonHeaderRow}>
            <SkeletonBlock width={84} height={26} radius={radii.pill} />
            <SkeletonBlock width={72} height={24} radius={radii.pill} />
          </View>
          <SkeletonBlock width={212} height={30} radius={radii.sm} style={{ marginTop: spacing.md }} />
          <SkeletonBlock width={256} height={18} radius={radii.xs} style={{ marginTop: spacing.sm }} />
          <SkeletonBlock width="100%" height={74} radius={radii.lg} style={{ marginTop: spacing.lg }} />
          <SkeletonBlock width={128} height={16} radius={radii.xs} style={{ marginTop: spacing.xxl }} />
          {[0, 1, 2, 3, 4].map((row) => (
            <SkeletonBlock
              key={row}
              width="100%"
              height={70}
              radius={radii.md}
              style={{ marginTop: spacing.md }}
            />
          ))}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <FlatList
        data={entries}
        keyExtractor={(item) => item.id}
        numColumns={1}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load(true)}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
        ListHeaderComponent={
          <View style={styles.headerWrapper}>
            <TabHeader
              eyebrow="FACEE"
              title="今天想练什么？"
              subtitle="精选题库沉浸练习，随时查看思路并继续追问。"
              action={totalCount > 0 ? (
                <View style={styles.headerMetaPill}>
                  <Text style={styles.headerMetaPillText}>已刷 {totalCount} 题</Text>
                </View>
              ) : null}
            />

            {/* 强化但不过度臃肿的“继续上次”快捷卡片 */}
            {lastViewedExists ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`继续上次练习，题目 ${lastViewedId}`}
                accessibilityHint="以练习模式进入，左右滑动切换同类题目"
                onPress={resumePractice}
                style={({ pressed }) => [styles.resumeCard, pressed && styles.pressed]}
              >
                <View style={styles.resumeIconWrap}>
                  <Play size={16} color={colors.primary} fill={colors.primary} />
                </View>
                <View style={styles.resumeCopy}>
                  <Text style={styles.resumeLabel}>继续上次练习</Text>
                  <Text style={styles.resumeTitle} numberOfLines={1}>
                    {lastViewedId}
                  </Text>
                </View>
                <View style={styles.resumeAction}>
                  <Text style={styles.resumeActionText}>进入</Text>
                  <ChevronRight size={16} color={colors.textSecondary} strokeWidth={2} />
                </View>
              </Pressable>
            ) : null}

            {/* 今日复习：有到期题才出现，到齐即消失 */}
            {dueQuestionIds.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`今日复习，${dueQuestionIds.length} 道题到期`}
                accessibilityHint="按掌握度间隔安排的到期题队列，复习时重新打标顺延"
                onPress={startReview}
                style={({ pressed }) => [styles.resumeCard, pressed && styles.pressed]}
              >
                <View style={styles.reviewIconWrap}>
                  <RotateCcw size={16} color={colors.warning} strokeWidth={2} />
                </View>
                <View style={styles.resumeCopy}>
                  <Text style={styles.resumeLabel}>今日复习</Text>
                  <Text style={styles.resumeTitle} numberOfLines={1}>
                    {dueQuestionIds.length} 道题到期，趁热再过一遍
                  </Text>
                </View>
                <View style={styles.resumeAction}>
                  <Text style={styles.resumeActionText}>复习</Text>
                  <ChevronRight size={16} color={colors.textSecondary} strokeWidth={2} />
                </View>
              </Pressable>
            ) : null}

            {/* 分类标题与数量摘要 */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>
                {hasCategories ? '知识体系分类' : '知识领域'}
              </Text>
              <Text style={styles.sectionSubtitle}>
                {hasCategories ? `共 ${categories.length} 个大类` : `共 ${roots.length} 个领域`}
              </Text>
            </View>
          </View>
        }
        renderItem={({ item }) => {
          const { Icon, bg, fg } = resolveCategoryVisual(item.id);
          const count = item.questionCount;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.name}，${count} 道题`}
              onPress={() =>
                item.kind === 'category'
                  ? nav.push('List', { categoryId: item.id, categoryName: item.name })
                  : nav.push('List', { tagId: item.id, tagName: item.name })
              }
              style={({ pressed }) => [styles.categoryCard, pressed && styles.pressed]}
            >
              <View style={[styles.categoryIconBox, { backgroundColor: bg }]}>
                <Icon size={20} color={fg} strokeWidth={1.9} />
              </View>
              <View style={styles.categoryInfo}>
                <Text style={styles.categoryName}>{item.name}</Text>
                <Text style={styles.categoryCount}>{count} 道核心题</Text>
              </View>
              <ChevronRight size={18} color={colors.textSubtle} strokeWidth={1.8} />
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <EmptyState
            title={error ? '无法读取本地题库' : '题库里还没有分类'}
            description={error ?? '重新安装一个有效的题库包后即可开始学习。'}
            actionLabel="重新读取"
            onAction={() => void load()}
          />
        }
        contentContainerStyle={styles.content}
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
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, flexGrow: 1 },
  headerWrapper: { paddingTop: spacing.md, paddingBottom: spacing.md },
  headerMetaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceWarm,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  headerMetaPillText: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '600',
    fontSize: 11,
  },
  resumeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    ...cardChrome,
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginBottom: spacing.xxl,
  },
  resumeIconWrap: {
    width: 38,
    height: 38,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceWarm,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  reviewIconWrap: {
    width: 38,
    height: 38,
    borderRadius: radii.pill,
    backgroundColor: colors.warningSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  resumeCopy: { flex: 1 },
  resumeLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
    fontSize: 11,
  },
  resumeTitle: {
    ...typography.bodyStrong,
    color: colors.text,
    marginTop: 2,
    fontSize: 14,
  },
  resumeAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    height: 28,
    backgroundColor: colors.surfaceSubtle,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
  },
  resumeActionText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
    fontSize: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingBottom: spacing.sm,
    marginBottom: spacing.xs,
  },
  sectionTitle: {
    ...typography.heading,
    color: colors.text,
    fontSize: 16,
  },
  sectionSubtitle: {
    ...typography.caption,
    color: colors.textSubtle,
  },
  categoryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    ...cardChrome,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  categoryIconBox: {
    width: 40,
    height: 40,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  categoryInfo: {
    flex: 1,
  },
  categoryName: {
    ...typography.bodyStrong,
    color: colors.text,
    fontSize: 15,
  },
  categoryCount: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  pressed: { ...pressedScale },
  skeletonContent: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  skeletonHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
});

