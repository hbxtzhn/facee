import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Markdown from 'react-native-markdown-display';
import {
  Bookmark,
  ChevronDown,
  ChevronRight,
  Eye,
  FolderTree,
  HelpCircle,
  Info,
  RotateCcw,
  Sparkles,
} from 'lucide-react-native';
import type { Question } from '../question-bank';
import { parseFollowups } from '../question-bank/followups';
import { questionBankRepository, resolveQuestionAssetMarkdown } from '../question-bank';
import markdownit from '../lib/markdown';
import { useEdgeSwipeBack } from '../lib/use-edge-swipe-back';
import { findCategoryName } from '../question-bank/catalog';
import { useQuestionBankStore } from '../question-bank/store';
import {
  FullscreenImageModal,
  ImageViewerProvider,
} from '../components/image-viewer';
import type { HomeStackParamList } from '../navigation/AppNavigator';
import { useUserStore } from '../store/userStore';
import { useFavoritesStore } from '../store/favoritesStore';
import { AppButton, DifficultyBadge, EmptyState } from '../components/ui';
import { MasteryChips, MasteryHeaderPill } from '../components/mastery-control';
import { cardChrome, colors, radii, shadows, spacing, typography } from '../theme';
import { partitionSourceMeta, splitAnswerSections, stripLeadingHeading } from './detail-content';
import { FollowUpItem } from './detail/FollowUpItem';
import { PracticeDock } from './detail/PracticeDock';
import { markdownStyles, sourceMetaMarkdownStyles } from './detail/markdown-styles';
import { renderImage, renderLink, renderTableHeader } from './detail/markdown-rules';
import { isQuestionBodyRedundantWithTitle } from './detail/question-redundancy';

type Nav = NativeStackNavigationProp<HomeStackParamList, 'Detail'>;
type DetailRoute = RouteProp<HomeStackParamList, 'Detail'>;

export function DetailScreen() {
  const route = useRoute<DetailRoute>();
  const nav = useNavigation<Nav>();
  const id = route.params.id;
  const queue = route.params.queue;
  const queueIndex = route.params.queueIndex ?? queue?.indexOf(id) ?? -1;
  const practiceMode =
    route.params.mode === 'practice' || route.params.mode === 'review' || (queue?.length ?? 0) > 1;
  const recordView = useUserStore((state) => state.recordView);
  const answerExpandedByDefault = useUserStore((state) => state.answerExpandedByDefault);
  const loadFavorites = useFavoritesStore((state) => state.load);
  const toggleFavoriteStore = useFavoritesStore((state) => state.toggle);
  const [meta, setMeta] = useState<Question | null>(null);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  // 面试官追问来自 followups.md（题库规范 §9）；答案内嵌的「面试官追问」分节仍兼容。
  const [followupsMd, setFollowupsMd] = useState<string | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [loadingQuestion, setLoadingQuestion] = useState(true);
  const [favorited, setFavorited] = useState(false);
  const [showSourceMeta, setShowSourceMeta] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ src: string; alt?: string } | null>(null);
  const openImageViewer = useCallback((src: string, alt?: string) => setPreviewImage({ src, alt }), []);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!practiceMode) return undefined;
      const parent = nav.getParent();
      const tabNavigator = parent?.getParent?.() ?? parent;
      tabNavigator?.setOptions({ tabBarStyle: { display: 'none' } });
      return () => tabNavigator?.setOptions({ tabBarStyle: undefined });
    }, [nav, practiceMode]),
  );

  useEffect(() => {
    void loadFavorites().then(() => setFavorited(useFavoritesStore.getState().has(id)));
  }, [id, loadFavorites]);

  const loadQuestion = useCallback(async () => {
    setLoadingQuestion(true);
    setError(null);
    // 设置项决定新题的默认展开态；用户在单题上的手动切换不会被写回设置。
    setShowAnswer(answerExpandedByDefault);
    try {
      const questionMeta = route.params.meta ?? await questionBankRepository.getQuestion(id);
      if (!questionMeta) throw new Error('没有找到这道题目的元数据');
      const content = await questionBankRepository.getContent(id);
      if (!content) throw new Error('这道题目的本地内容不完整，请重新安装题库');
      setMeta(questionMeta);
      setQuestion(resolveQuestionAssetMarkdown(content.questionMd, content.assetBaseUri));
      setAnswer(content.answerMd === null ? null : resolveQuestionAssetMarkdown(content.answerMd, content.assetBaseUri));
      setFollowupsMd(content.followupsMd ? resolveQuestionAssetMarkdown(content.followupsMd, content.assetBaseUri) : null);
      recordView(id);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoadingQuestion(false);
    }
  }, [id, recordView, route.params.meta, answerExpandedByDefault]);

  useEffect(() => {
    void loadQuestion();
  }, [loadQuestion]);

  async function toggleFavorite() {
    await toggleFavoriteStore(id);
    setFavorited(useFavoritesStore.getState().has(id));
  }

  function moveInQueue(offset: number) {
    if (!queue || queueIndex < 0) return;
    const nextIndex = queueIndex + offset;
    const nextId = queue[nextIndex];
    if (!nextId) return;
    nav.replace('Detail', { id: nextId, queue, queueIndex: nextIndex, mode: route.params.mode ?? 'practice' });
  }

  const rawQuestionBody = stripLeadingHeading(question, meta?.title);
  // 提取题干中可能存在的版权来源说明，沉浸阅读时不让来源打扰思考
  const { body: questionBody, sourceMeta } = useMemo(
    () => partitionSourceMeta(rawQuestionBody),
    [rawQuestionBody],
  );
  const answerSections = useMemo(() => splitAnswerSections(stripLeadingHeading(answer ?? '', '参考答案')), [answer]);
  // 所属分类（§7.1）：题库规范 v1 提供 categories 时才有值。
  const catalog = useQuestionBankStore((state) => state.catalog);
  const categoryName = meta ? findCategoryName(catalog, meta.categoryId) : null;
  // 掌握度打标的命名空间：题库 catalog.id；无题库（Web 预览前的空态）时打标入口隐藏
  const bankId = catalog?.id ?? null;
  const answerAvailable = answer !== null && meta?.hasAnswer === true;
  const followUpItems = useMemo(() => {
    const fromFile = parseFollowups(followupsMd ?? '').map((item) => ({ title: item.question, body: item.answer }));
    return [...answerSections.followUps, ...fromFile];
  }, [followupsMd, answerSections.followUps]);

  // 手势：中部左右滑切题（仅练习模式）+ 左缘右滑返回（浏览/练习都可用）。
  // 判定、防抖与桌面鼠标双路径都在 useEdgeSwipeBack 内。
  const { panHandlers: swipeHandlers, onTouchStart: recordSwipeStart } = useEdgeSwipeBack({
    onEdgeBack: () => {
      if (nav.canGoBack()) nav.goBack();
      else nav.popToTop();
    },
    onSwipeLeft: practiceMode ? () => moveInQueue(1) : undefined,
    onSwipeRight: practiceMode ? () => moveInQueue(-1) : undefined,
  });

  if (loadingQuestion) {
    return (
      <View style={styles.loadingState}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingTitle}>正在打开题目</Text>
        <Text style={styles.loadingCopy}>正在读取本地内容</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.errorState}>
        <EmptyState title="题目加载失败" description={error} actionLabel="重新加载" onAction={() => void loadQuestion()} icon={RotateCcw} />
      </View>
    );
  }

  // 题干只是标题的复述/礼貌化扩写（如「请说明…的区别，并解释为什么…」）时
  // 隐藏正文卡片，避免同屏把同一句话读两遍
  const isQuestionRedundantWithTitle = isQuestionBodyRedundantWithTitle(
    meta?.title ?? id,
    questionBody,
  );

  return (
    <ImageViewerProvider value={openImageViewer}>
    <View
      style={[styles.screen, practiceMode && Platform.OS === 'web' ? ({ userSelect: 'none' } as any) : null]}
      {...swipeHandlers}
      onTouchStart={recordSwipeStart}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, practiceMode && styles.practiceContent]}
        contentInsetAdjustmentBehavior="automatic"
      >
        {/* 精致且去臃肿的题目头部 */}
        <View style={styles.header}>
          <View style={styles.topMetaBar}>
            <View style={styles.metaBadges}>
              {meta ? (
                <DifficultyBadge difficulty={meta.difficulty} />
              ) : null}
              {categoryName ? (
                <View style={styles.categoryBadge}>
                  <FolderTree size={12} color={colors.textMuted} strokeWidth={2} />
                  <Text style={styles.categoryText}>{categoryName}</Text>
                </View>
              ) : null}
              <Text style={styles.questionId}>{id}</Text>
            </View>

            {/* 顶部收藏按钮，精致右上角浮动 */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={favorited ? '取消收藏这道题' : '收藏这道题'}
              accessibilityState={{ selected: favorited }}
              onPress={() => void toggleFavorite()}
              style={({ pressed }) => [styles.favoriteButton, favorited && styles.favoriteButtonActive, pressed && styles.pressed]}
            >
              <Bookmark
                size={17}
                color={favorited ? colors.primary : colors.textMuted}
                fill={favorited ? colors.primary : 'none'}
                strokeWidth={2}
              />
              <Text style={[styles.favoriteText, favorited && styles.favoriteTextActive]}>
                {favorited ? '已收藏' : '收藏'}
              </Text>
            </Pressable>
          </View>

          {/* 掌握度标记（浏览模式）：头部紧凑入口，展开三态 chips */}
          {!practiceMode ? <MasteryHeaderPill bankId={bankId} questionId={id} /> : null}

          {/* 题目大标题：清晰、沉浸、字体行距舒适 */}
          <Text style={styles.title}>{meta?.title ?? id}</Text>

          {/* 标签栏：轻量化微标签，减少大面积黑线 */}
          {meta?.tags && meta.tags.length > 0 ? (
            <View style={styles.tags}>
              {meta.tags.map((tag) => (
                <View key={tag.id} style={styles.tag}>
                  <Text style={styles.tagText}>{tag.name}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        {/* 题目正文：如果和大标题不一致，才在卡片内展示展开题干，避免视觉疲劳 */}
        {!isQuestionRedundantWithTitle && questionBody.length > 0 ? (
          <View style={styles.questionCard}>
            <Markdown markdownit={markdownit} style={markdownStyles} rules={{ link: renderLink(nav), image: renderImage, th: renderTableHeader }}>
              {questionBody}
            </Markdown>
          </View>
        ) : null}

        {/* 来源元数据：折叠在题干下方的小徽记，既遵守开源协议又避免抢占核心视线 */}
        {sourceMeta ? (
          <View style={styles.sourceMetaContainer}>
            <Pressable
              onPress={() => setShowSourceMeta((v) => !v)}
              style={styles.sourceMetaToggle}
              accessibilityRole="button"
              accessibilityLabel="题库来源信息"
            >
              <Info size={14} color={colors.textSubtle} />
              <Text style={styles.sourceMetaToggleText}>题库来源与说明</Text>
              <ChevronDown
                size={14}
                color={colors.textSubtle}
                style={[styles.sourceChevron, showSourceMeta && styles.chevronExpanded]}
              />
            </Pressable>
            {showSourceMeta ? (
              <View style={styles.sourceMetaBody}>
                <Markdown markdownit={markdownit} style={sourceMetaMarkdownStyles}>
                  {sourceMeta}
                </Markdown>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* 练习模式 · 无答案题的打标（口径：无答案题同样可评，闭环不静默失效） */}
        {practiceMode && bankId && !answerAvailable ? (
          <View style={styles.masteryStandalone}>
            <MasteryChips bankId={bankId} questionId={id} showPrompt />
          </View>
        ) : null}

        {/* 展开参考答案按钮 */}
        {!practiceMode && meta?.hasAnswer && answer !== null && !showAnswer ? (
          <View style={styles.revealButtonContainer}>
            <AppButton
              label="查看参考答案"
              icon={Eye}
              onPress={() => setShowAnswer(true)}
              accessibilityHint="显示已经安装在本机的参考答案"
              style={styles.answerButton}
            />
          </View>
        ) : null}

        {/* 答案卡片区域：温暖背景衬底，保护视力 */}
        {showAnswer && answer !== null ? (
          <View style={styles.answerCard}>
            <View style={styles.answerHeading}>
              <View style={styles.answerIcon}>
                <Sparkles size={18} color={colors.primary} strokeWidth={2} />
              </View>
              <Text style={styles.answerTitle}>参考答案</Text>
            </View>

            <View style={styles.answerContent}>
              <Markdown markdownit={markdownit} style={markdownStyles} rules={{ link: renderLink(nav), image: renderImage, th: renderTableHeader }}>
                {answerSections.main}
              </Markdown>
            </View>

            {/* 练习模式 · 揭答案后的自评时刻 */}
            {practiceMode && bankId ? (
              <View style={styles.masteryBlock}>
                <MasteryChips bankId={bankId} questionId={id} showPrompt />
              </View>
            ) : null}

            {followUpItems.length > 0 ? (
              <View style={styles.followUpSection}>
                <View style={styles.followUpHeadingRow}>
                  <View style={styles.followUpHeadingIcon}>
                    <HelpCircle size={16} color={colors.primary} strokeWidth={2} />
                  </View>
                  <Text style={styles.followUpHeading}>面试官追问</Text>
                  <View style={styles.followUpCountBadge}>
                    <Text style={styles.followUpCountText}>{followUpItems.length} 条</Text>
                  </View>
                </View>
                {followUpItems.map((followUp, index) => (
                  <FollowUpItem key={`${followUp.title}-${index}`} section={followUp} />
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        {!practiceMode && queue && queue.length > 1 && queueIndex >= 0 ? (
          <View style={styles.queueNavigation}>
            <Text style={styles.queueProgress}>连续刷题 · {queueIndex + 1} / {queue.length}</Text>
            <View style={styles.queueButtons}>
              <AppButton label="上一题" variant="secondary" disabled={queueIndex === 0} onPress={() => moveInQueue(-1)} style={styles.queueButton} />
              <AppButton label={queueIndex === queue.length - 1 ? '已到末题' : '下一题'} icon={queueIndex === queue.length - 1 ? undefined : ChevronRight} disabled={queueIndex === queue.length - 1} onPress={() => moveInQueue(1)} style={styles.queueButton} />
            </View>
          </View>
        ) : null}
      </ScrollView>

      {practiceMode ? (
        <PracticeDock
          currentPage={queue && queue.length > 1 && queueIndex >= 0 ? queueIndex + 1 : undefined}
          totalPages={queue && queue.length > 1 ? queue.length : undefined}
          answerVisible={showAnswer}
          answerAvailable={answerAvailable}
          onToggleAnswer={() => setShowAnswer((visible) => !visible)}
        />
      ) : null}

      <FullscreenImageModal preview={previewImage} onClose={() => setPreviewImage(null)} />
    </View>
    </ImageViewerProvider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: 64 },
  practiceContent: { paddingBottom: 120 },
  header: {
    ...cardChrome,
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  topMetaBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  metaBadges: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surfaceSubtle,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.sm,
  },
  categoryText: { ...typography.caption, color: colors.textSecondary, fontWeight: '500' },
  questionId: { ...typography.caption, color: colors.textSubtle, fontSize: 11 },
  title: {
    ...typography.title,
    color: colors.text,
    marginTop: spacing.md,
    lineHeight: 32,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  tag: {
    backgroundColor: colors.surfaceSubtle,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radii.sm,
  },
  tagText: { ...typography.caption, color: colors.textMuted, fontWeight: '500' },
  favoriteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceSubtle,
  },
  favoriteButtonActive: {
    backgroundColor: colors.primaryMuted,
  },
  favoriteText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  favoriteTextActive: { color: colors.text },
  questionCard: {
    ...cardChrome,
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  sourceMetaContainer: {
    marginBottom: spacing.md,
  },
  sourceMetaToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  sourceMetaToggleText: {
    ...typography.caption,
    color: colors.textSubtle,
  },
  sourceChevron: {
    marginLeft: 2,
  },
  sourceMetaBody: {
    backgroundColor: colors.surfaceSubtle,
    padding: spacing.md,
    borderRadius: radii.md,
    marginTop: spacing.xs,
  },
  revealButtonContainer: {
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  answerButton: {
    borderRadius: radii.md,
  },
  answerCard: {
    ...cardChrome,
    ...shadows.lifted,
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  answerHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingBottom: spacing.md,
    marginBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  answerIcon: {
    width: 28,
    height: 28,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceWarm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  answerTitle: { ...typography.heading, color: colors.text },
  answerContent: {
    paddingVertical: spacing.xs,
  },
  masteryBlock: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  masteryStandalone: {
    ...cardChrome,
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  followUpSection: {
    marginTop: spacing.xl,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  followUpHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  followUpHeadingIcon: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  followUpHeading: { ...typography.heading, fontSize: 16, color: colors.text, flex: 1 },
  followUpCountBadge: {
    backgroundColor: colors.surfaceSubtle,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radii.pill,
  },
  followUpCountText: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },
  chevronExpanded: { transform: [{ rotate: '180deg' }] },
  queueNavigation: {
    marginTop: spacing.xl,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  queueProgress: { ...typography.caption, color: colors.textMuted, textAlign: 'center', marginBottom: spacing.sm },
  queueButtons: { flexDirection: 'row', gap: spacing.sm },
  queueButton: { flex: 1 },
  loadingState: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, padding: spacing.xl },
  loadingTitle: { ...typography.heading, color: colors.text, marginTop: spacing.lg },
  loadingCopy: { ...typography.body, color: colors.textMuted, marginTop: spacing.xs },
  errorState: { flex: 1, justifyContent: 'center', backgroundColor: colors.background },
  pressed: { opacity: 0.75 },
});
