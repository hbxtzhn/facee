import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { Bookmark, ChevronDown, Eye, FolderTree, HelpCircle, Info, RotateCcw, Sparkles } from 'lucide-react-native';
import type { Question } from '../../question-bank';
import { parseFollowups } from '../../question-bank/followups';
import { questionBankRepository, resolveQuestionAssetMarkdown } from '../../question-bank';
import { findCategoryName } from '../../question-bank/catalog';
import { useQuestionBankStore } from '../../question-bank/store';
import markdownit from '../../lib/markdown';
import { useUserStore } from '../../store/userStore';
import { useFavoritesStore } from '../../store/favoritesStore';
import { AppButton, DifficultyBadge, EmptyState } from '../../components/ui';
import { MasteryHeaderPill } from '../../components/mastery-control';
import { cardChrome, colors, radii, shadows, spacing, typography } from '../../theme';
import { partitionSourceMeta, splitAnswerSections, stripLeadingHeading } from '../detail-content';
import { FollowUpItem } from './FollowUpItem';
import { markdownStyles, sourceMetaMarkdownStyles } from './markdown-styles';
import { renderImage, renderLink, renderTableHeader } from './markdown-rules';
import { isQuestionBodyRedundantWithTitle } from './question-redundancy';

type LinkNavigation = Parameters<typeof renderLink>[0];

interface LoadedContent {
  meta: Question;
  question: string;
  answer: string | null;
  followupsMd: string | null;
}

/**
 * 单道题的完整阅读页：自己读取本地内容，渲染题干 / 来源 / 参考答案 / 追问。
 * 详情页的分页器只挂载「当前页 ±1」，离开窗口的页随卸载释放内容。
 *
 * - active：只有当前页记录浏览进度（recordView ⇒「继续上次练习」），预加载的相邻页不记；
 * - 答案显隐由父级按页持有（底栏开关作用于当前页）；
 * - onAnswerAvailabilityChange：把「有无答案」报给父级，底栏据此置灰开关。
 */
export function QuestionPage({
  id,
  metaHint,
  active,
  practiceMode,
  showAnswer,
  onShowAnswer,
  onAnswerAvailabilityChange,
  nav,
}: {
  id: string;
  metaHint?: Question;
  active: boolean;
  practiceMode: boolean;
  showAnswer: boolean;
  onShowAnswer: () => void;
  onAnswerAvailabilityChange?: (id: string, available: boolean) => void;
  nav: LinkNavigation;
}) {
  const recordView = useUserStore((state) => state.recordView);
  const favorited = useFavoritesStore((state) => state.ids.includes(id));
  const toggleFavorite = useFavoritesStore((state) => state.toggle);
  const catalog = useQuestionBankStore((state) => state.catalog);
  const [content, setContent] = useState<LoadedContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSourceMeta, setShowSourceMeta] = useState(false);

  // metaHint 只是首屏的现成元数据，不作为重新加载的依赖（对象引用可能每次渲染都变）
  const metaHintRef = useRef(metaHint);
  metaHintRef.current = metaHint;

  const loadQuestion = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const hint = metaHintRef.current;
      const questionMeta = hint?.id === id ? hint : await questionBankRepository.getQuestion(id);
      if (!questionMeta) throw new Error('没有找到这道题目的元数据');
      const loaded = await questionBankRepository.getContent(id);
      if (!loaded) throw new Error('这道题目的本地内容不完整，请重新安装题库');
      setContent({
        meta: questionMeta,
        question: resolveQuestionAssetMarkdown(loaded.questionMd, loaded.assetBaseUri),
        answer: loaded.answerMd === null ? null : resolveQuestionAssetMarkdown(loaded.answerMd, loaded.assetBaseUri),
        followupsMd: loaded.followupsMd ? resolveQuestionAssetMarkdown(loaded.followupsMd, loaded.assetBaseUri) : null,
      });
    } catch (loadError) {
      setContent(null);
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadQuestion();
  }, [loadQuestion]);

  const loaded = content !== null;
  // 进度只记当前页且加载成功的题（与旧实现「加载成功才 recordView」一致）
  useEffect(() => {
    if (active && loaded) recordView(id);
  }, [active, loaded, id, recordView]);

  const meta = content?.meta ?? null;
  const answer = content?.answer ?? null;
  const answerAvailable = answer !== null && meta?.hasAnswer === true;

  useEffect(() => {
    onAnswerAvailabilityChange?.(id, answerAvailable);
  }, [answerAvailable, id, onAnswerAvailabilityChange]);

  const rawQuestionBody = stripLeadingHeading(content?.question ?? '', meta?.title);
  // 提取题干中可能存在的版权来源说明，沉浸阅读时不让来源打扰思考
  const { body: questionBody, sourceMeta } = useMemo(
    () => partitionSourceMeta(rawQuestionBody),
    [rawQuestionBody],
  );
  const answerSections = useMemo(() => splitAnswerSections(stripLeadingHeading(answer ?? '', '参考答案')), [answer]);
  // 所属分类（§7.1）：题库规范 v1 提供 categories 时才有值。
  const categoryName = meta ? findCategoryName(catalog, meta.categoryId) : null;
  // 掌握度打标的命名空间：题库 catalog.id；无题库（Web 预览前的空态）时打标入口隐藏
  const bankId = catalog?.id ?? null;
  const followUpItems = useMemo(() => {
    // 面试官追问来自 followups.md（题库规范 §9）；答案内嵌的「面试官追问」分节仍兼容。
    const fromFile = parseFollowups(content?.followupsMd ?? '').map((item) => ({ title: item.question, body: item.answer }));
    return [...answerSections.followUps, ...fromFile];
  }, [content?.followupsMd, answerSections.followUps]);
  const markdownRules = useMemo(
    () => ({ link: renderLink(nav), image: renderImage, th: renderTableHeader }),
    [nav],
  );

  if (loading) {
    return (
      <View style={styles.loadingState}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingTitle}>正在打开题目</Text>
        <Text style={styles.loadingCopy}>正在读取本地内容</Text>
      </View>
    );
  }

  if (error || !content) {
    return (
      <View style={styles.errorState}>
        <EmptyState
          title="题目加载失败"
          description={error ?? '未知错误'}
          actionLabel="重新加载"
          onAction={() => void loadQuestion()}
          icon={RotateCcw}
        />
      </View>
    );
  }

  // 题干只是标题的复述/礼貌化扩写（如「请说明…的区别，并解释为什么…」）时
  // 隐藏正文卡片，避免同屏把同一句话读两遍
  const isQuestionRedundantWithTitle = isQuestionBodyRedundantWithTitle(meta?.title ?? id, questionBody);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, practiceMode && styles.practiceContent]}
      contentInsetAdjustmentBehavior="automatic"
    >
      {/* 精致且去臃肿的题目头部 */}
      <View style={styles.header}>
        <View style={styles.topMetaBar}>
          <View style={styles.metaBadges}>
            {meta ? <DifficultyBadge difficulty={meta.difficulty} /> : null}
            {categoryName ? (
              <View style={styles.categoryBadge}>
                <FolderTree size={12} color={colors.textMuted} strokeWidth={2} />
                <Text style={styles.categoryText}>{categoryName}</Text>
              </View>
            ) : null}
            <Text style={styles.questionId}>{id}</Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={favorited ? '取消收藏这道题' : '收藏这道题'}
            accessibilityState={{ selected: favorited }}
            onPress={() => void toggleFavorite(id)}
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

        {/* 掌握度标记（浏览模式）：头部紧凑入口；练习模式改由底部操作栏承载 */}
        {!practiceMode ? <MasteryHeaderPill bankId={bankId} questionId={id} /> : null}

        <Text style={styles.title}>{meta?.title ?? id}</Text>

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
          <Markdown markdownit={markdownit} style={markdownStyles} rules={markdownRules}>
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

      {/* 浏览模式的展开答案按钮；练习模式由底栏开关负责 */}
      {!practiceMode && answerAvailable && !showAnswer ? (
        <View style={styles.revealButtonContainer}>
          <AppButton
            label="查看参考答案"
            icon={Eye}
            onPress={onShowAnswer}
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
            <Markdown markdownit={markdownit} style={markdownStyles} rules={markdownRules}>
              {answerSections.main}
            </Markdown>
          </View>

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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: 64 },
  // 底栏是固定布局（不再悬浮遮挡），正文只需常规留白
  practiceContent: { paddingBottom: spacing.xxl },
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
  loadingState: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, padding: spacing.xl },
  loadingTitle: { ...typography.heading, color: colors.text, marginTop: spacing.lg },
  loadingCopy: { ...typography.body, color: colors.textMuted, marginTop: spacing.xs },
  errorState: { flex: 1, justifyContent: 'center', backgroundColor: colors.background },
  pressed: { opacity: 0.75 },
});
