import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, FlatList, Platform, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, type CompositeNavigationProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ChevronDown, Search } from 'lucide-react-native';
import type { HomeStackParamList, RootStackParamList } from '../navigation/AppNavigator';
import { useBankStore, type CategoryInfo, type PracticeSession, type TagInfo } from '../bank';
import { SkeletonBlock } from '../components/skeleton';
import { colors, layout, radii, spacing, typography } from '../theme';
import { BankSwitcherSheet } from './home/BankSwitcherSheet';
import { BankGateEmpty, useBankGateState, useEnsureBankInitialized } from './home/components/bank-gate';
import { ICON_SIZE, ICON_STROKE, ReadingRow, SectionLabel, TextAction } from './home/components/reading';
import { EmptyState } from '../components/ui';
import { describeSection } from './sections/components';

/** 首页在 HomeStack 内；详情页与题库管理页挂在 RootStack，navigate 会冒泡到根栈 */
type Nav = CompositeNavigationProp<
  NativeStackNavigationProp<HomeStackParamList, 'Home'>,
  NativeStackNavigationProp<RootStackParamList>
>;

/** 首页底部列表项：分类；题库没有分类时回退为根标签 */
type HomeEntry = { kind: 'category'; category: CategoryInfo } | { kind: 'tag'; tag: TagInfo };

interface ResumeTarget {
  session: PracticeSession;
  questionId: string;
  questionTitle: string | null;
}

/** 统计行：「共 120 题 · 已标 30 · 会了 12」 */
export function describeStats(stats: { questionCount: number; markedCount: number; knownCount: number } | null): string | null {
  if (!stats) return null;
  return [
    `共 ${stats.questionCount} 题`,
    stats.markedCount > 0 ? `已标 ${stats.markedCount}` : null,
    stats.knownCount > 0 ? `会了 ${stats.knownCount}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function HomeScreen() {
  const nav = useNavigation<Nav>();
  useEnsureBankInitialized();
  const gate = useBankGateState();
  const activeBank = useBankStore((state) => state.activeBank);
  const categories = useBankStore((state) => state.categories);
  const tags = useBankStore((state) => state.tags);
  const collections = useBankStore((state) => state.collections);
  const sections = useBankStore((state) => state.sections);
  const stats = useBankStore((state) => state.stats);
  const contentVersion = useBankStore((state) => state.contentVersion);
  const learningVersion = useBankStore((state) => state.learningVersion);
  const [dueIds, setDueIds] = useState<string[]>([]);
  const [resume, setResume] = useState<ResumeTarget | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [switcherVisible, setSwitcherVisible] = useState(false);
  const canManageBanks = Platform.OS !== 'web';
  const ready = gate === 'ready';

  /** 加载代次：较早发起、较晚完成的查询不得覆盖新结果（切换题库时尤其重要） */
  const generation = useRef(0);

  // 今日复习与「继续上次练习」都是查询结果（store 不缓存），按刷新信号重新取
  const loadToday = useCallback(async () => {
    const current = ++generation.current;
    const store = useBankStore.getState();
    if (store.status !== 'ready' || !store.activeBankId) {
      setDueIds([]);
      setResume(null);
      return;
    }
    const [due, session] = await Promise.all([store.listDueQuestionIds(), store.getSession()]);
    let target: ResumeTarget | null = null;
    if (session.ok && session.value) {
      const questionId = session.value.queue[session.value.index];
      const lookup = await store.listQuestions({ questionIds: [questionId] });
      const questionTitle = lookup.ok ? lookup.value[0]?.title ?? null : null;
      target = { session: session.value, questionId, questionTitle };
    }
    if (current !== generation.current) return;
    setDueIds(due.ok ? due.value : []);
    setResume(target);
  }, []);

  useEffect(() => {
    void loadToday();
  }, [loadToday, gate, contentVersion, learningVersion]);

  useFocusEffect(
    useCallback(() => {
      void loadToday();
    }, [loadToday]),
  );

  // 到期只由墙上时钟驱动：停在首页跨过到期边界时靠粗粒度心跳与回前台刷新推进
  useEffect(() => {
    const timer = setInterval(() => void loadToday(), 60_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void loadToday();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [loadToday]);

  async function onRefresh() {
    setRefreshing(true);
    await useBankStore.getState().refresh();
    await loadToday();
    setRefreshing(false);
  }

  async function startQueue(queue: string[], index: number, mode: PracticeSession['mode'], title: string) {
    if (queue.length === 0) return;
    await useBankStore.getState().saveSession({ queue, index, mode, title });
    nav.push('Detail', { id: queue[index], queue, queueIndex: index, mode });
  }

  function resumePractice() {
    if (!resume) return;
    const { session } = resume;
    nav.push('Detail', { id: resume.questionId, queue: session.queue, queueIndex: session.index, mode: session.mode });
  }

  const openOnlineBanks = () => nav.navigate('OnlineBanks');
  const openBankManager = () => nav.navigate('BankManager');

  const entries: HomeEntry[] =
    categories.length > 0
      ? categories.map((category) => ({ kind: 'category' as const, category }))
      : tags.filter((tag) => tag.parentId === null).map((tag) => ({ kind: 'tag' as const, tag }));

  if (gate === 'loading') {
    // 骨架：轮廓与真实排版一致（眉题 / 大标题 / 一组细行），避免居中转圈的突跳
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.skeletonContent} accessibilityLabel="正在打开题库">
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

  const statsLine = ready ? describeStats(stats) : null;
  const resumeMeta = resume
    ? [resume.session.title, `第 ${resume.session.index + 1} / ${resume.session.queue.length} 题`].filter(Boolean).join(' · ')
    : null;
  const updatedCount = stats?.updatedCount ?? 0;
  const showToday = ready && (dueIds.length > 0 || resume !== null || updatedCount > 0);

  const header = (
    <View style={styles.header}>
      <Text style={styles.eyebrow}>FACEE · 题库</Text>
      {/* 当前题库切换器：标题即入口，点按弹出底部题库列表 */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={activeBank ? `当前题库 ${activeBank.name}，点按切换` : '还没有题库，点按添加'}
        accessibilityHint="打开题库列表，切换或管理题库"
        hitSlop={6}
        disabled={gate === 'unsupported'}
        onPress={() => setSwitcherVisible(true)}
        style={({ pressed }) => [styles.bankSwitcher, pressed && styles.pressed]}
      >
        <Text style={styles.bankTitle} numberOfLines={2}>
          {activeBank ? activeBank.name : '选择题库'}
        </Text>
        {gate !== 'unsupported' ? (
          <ChevronDown size={18} color={colors.textSecondary} strokeWidth={ICON_STROKE} style={styles.chevron} />
        ) : null}
      </Pressable>
      {statsLine ? <Text style={styles.summary}>{statsLine}</Text> : null}

      {ready ? (
        // 全局搜索：整库搜索（FTS ≥ 3 字，1–2 字走 LIKE，由数据层处理）
        <Pressable
          accessibilityRole="search"
          accessibilityLabel="搜索全部题目"
          onPress={() => nav.push('List', { search: true })}
          style={({ pressed }) => [styles.searchEntry, pressed && styles.pressed]}
        >
          <Search size={ICON_SIZE} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
          <Text style={styles.searchPlaceholder}>搜索全部题目</Text>
        </Pressable>
      ) : null}

      {showToday ? (
        <>
          <SectionLabel>今天</SectionLabel>
          {/* 今日复习：有到期题才出现，到齐即消失 */}
          {dueIds.length > 0 ? (
            <ReadingRow
              first
              title={`今日复习 ${dueIds.length} 题`}
              meta="按掌握度间隔安排的到期题，复习时重新打标顺延"
              trailing="开始"
              accessibilityLabel={`今日复习，${dueIds.length} 道题到期`}
              accessibilityHint="按掌握度间隔安排的到期题队列，复习时重新打标顺延"
              onPress={() => void startQueue(dueIds, 0, 'review', '今日复习')}
            />
          ) : null}
          {resume ? (
            <ReadingRow
              first={dueIds.length === 0}
              emphasis
              title="继续上次练习"
              snippet={resume.questionTitle}
              meta={resumeMeta}
              trailing="继续"
              accessibilityLabel={`继续上次练习，${resume.questionTitle ?? resume.questionId}`}
              accessibilityHint="回到上次的练习队列与位置，左右滑动切换题目"
              onPress={resumePractice}
            />
          ) : null}
          {updatedCount > 0 ? (
            <ReadingRow
              first={dueIds.length === 0 && !resume}
              title={`内容已更新 ${updatedCount} 题`}
              meta="学过的题在题库更新后有改动，重新看一遍即可清除"
              accessibilityLabel={`内容已更新，${updatedCount} 道题`}
              onPress={() => nav.push('List', { updatedOnly: true })}
            />
          ) : null}
        </>
      ) : null}

      {ready && categories.length > 0 ? (
        <>
          <SectionLabel trailing={<TextAction label="管理" muted accessibilityLabel="管理我的分区" onPress={() => nav.push('Sections')} />}>
            我的分区
          </SectionLabel>
          {sections.length === 0 ? (
            <ReadingRow
              first
              title="新建分区"
              meta="把常练的分类归到一起，只是你自己的目录，不改动题库"
              accessibilityLabel="新建分区"
              onPress={() => nav.push('Sections')}
            />
          ) : (
            sections.map((section, index) => (
              <ReadingRow
                key={section.id}
                first={index === 0}
                title={section.name}
                titleLines={1}
                meta={describeSection(section)}
                accessibilityLabel={`分区 ${section.name}，${describeSection(section)}`}
                onPress={() => nav.push('Section', { sectionId: section.id, sectionName: section.name })}
              />
            ))
          )}
        </>
      ) : null}

      {ready && collections.length > 0 ? (
        <>
          <SectionLabel trailing={<Text style={styles.sectionCount}>{collections.length}</Text>}>专题</SectionLabel>
          {collections.map((collection, index) => (
            <ReadingRow
              key={collection.id}
              first={index === 0}
              title={collection.name}
              titleLines={1}
              meta={collection.description}
              trailing={String(collection.questionIds.length)}
              accessibilityLabel={`专题 ${collection.name}，${collection.questionIds.length} 道题`}
              onPress={() => nav.push('List', { collectionId: collection.id, collectionName: collection.name })}
            />
          ))}
        </>
      ) : null}

      {ready && entries.length > 0 ? (
        <SectionLabel trailing={<Text style={styles.sectionCount}>{entries.length}</Text>}>
          {categories.length > 0 ? '分类' : '标签'}
        </SectionLabel>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <FlatList
        data={ready ? entries : []}
        keyExtractor={(item) => (item.kind === 'category' ? `c:${item.category.id}` : `t:${item.tag.id}`)}
        refreshControl={
          ready ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void onRefresh()}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          ) : undefined
        }
        ListHeaderComponent={header}
        renderItem={({ item, index }) => {
          if (item.kind === 'tag') {
            const { tag } = item;
            return (
              <ReadingRow
                first={index === 0}
                title={tag.name}
                titleLines={1}
                trailing={String(tag.questionCount)}
                accessibilityLabel={`${tag.name}，${tag.questionCount} 道题`}
                onPress={() => nav.push('List', { tagId: tag.id, tagName: tag.name })}
              />
            );
          }
          const { category } = item;
          return (
            <ReadingRow
              first={index === 0}
              title={category.name}
              titleLines={1}
              meta={category.knownCount > 0 ? `已掌握 ${category.knownCount} 题` : null}
              trailing={String(category.questionCount)}
              accessibilityLabel={`${category.name}，${category.questionCount} 道题`}
              onPress={() => nav.push('List', { categoryId: category.id, categoryName: category.name })}
            />
          );
        }}
        ListEmptyComponent={
          ready ? (
            <EmptyState title="题库里还没有分类" description="这个题库暂时没有可浏览的分类。" />
          ) : (
            <BankGateEmpty state={gate} onOnlineBanks={openOnlineBanks} onCreateLocal={openBankManager} />
          )
        }
        contentContainerStyle={styles.content}
      />
      <BankSwitcherSheet
        visible={switcherVisible}
        onClose={() => setSwitcherVisible(false)}
        onManage={openBankManager}
        onOnlineBanks={openOnlineBanks}
        canManage={canManageBanks}
      />
    </SafeAreaView>
  );
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
  searchEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    marginTop: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderStrong,
  },
  searchPlaceholder: { ...typography.body, color: colors.textSubtle },
  sectionCount: { ...typography.caption, color: colors.textSubtle },
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
