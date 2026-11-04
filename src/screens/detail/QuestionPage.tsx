import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { Bookmark, ChevronDown, RotateCcw } from 'lucide-react-native';
import type { Question } from '../../question-bank';
import { parseFollowups } from '../../question-bank/followups';
import { questionBankRepository, resolveQuestionAssetMarkdown } from '../../question-bank';
import { findCategoryName } from '../../question-bank/catalog';
import { useQuestionBankStore } from '../../question-bank/store';
import markdownit from '../../lib/markdown';
import { useUserStore } from '../../store/userStore';
import { useFavoritesStore } from '../../store/favoritesStore';
import { EmptyState } from '../../components/ui';
import { MasteryHeaderPill } from '../../components/mastery-control';
import { colors, difficultyStyles, layout, spacing, typography } from '../../theme';
import { partitionSourceMeta, splitAnswerSections, stripLeadingHeading } from '../detail-content';
import { FollowUpItem } from './FollowUpItem';
import { createMarkdownStyles, sourceMetaMarkdownStyles } from './markdown-styles';
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
 * 单道题的完整阅读页（极简阅读风：纸面、居中版心、无卡片无阴影，层次只靠字号与留白）：自己读取本地内容，渲染题干 / 来源 / 参考答案 / 追问。
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
  const readingScale = useUserStore((state) => state.readingScale);
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
  // 隐藏正文，避免同屏把同一句话读两遍
  const isQuestionRedundantWithTitle = isQuestionBodyRedundantWithTitle(meta?.title ?? id, questionBody);
  const readingStyles = createMarkdownStyles(readingScale);
  // 一行弱化元信息：分类 · 难度 · 标签
  const metaParts = [
    categoryName,
    meta ? difficultyStyles[meta.difficulty]?.label : null,
    ...(meta?.tags ?? []).map((tag) => tag.name),
  ].filter((part): part is string => Boolean(part));

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, practiceMode && styles.practiceContent]}
      contentInsetAdjustmentBehavior="automatic"
    >
      <View style={styles.column} testID="reading-column">
        <View style={styles.metaRow}>
          <Text style={styles.metaLine} numberOfLines={2}>
            {metaParts.join(' · ')}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={favorited ? '取消收藏这道题' : '收藏这道题'}
            accessibilityState={{ selected: favorited }}
            hitSlop={10}
            onPress={() => void toggleFavorite(id)}
            style={({ pressed }) => [styles.favoriteButton, pressed && styles.pressed]}
          >
            <Bookmark
              size={18}
              color={favorited ? colors.primary : colors.textSubtle}
              fill={favorited ? colors.primary : 'none'}
              strokeWidth={1.6}
            />
          </Pressable>
        </View>

        <Text style={styles.title} accessibilityRole="header">
          {meta?.title ?? id}
        </Text>

        {/* 掌握度标记（浏览模式）：标题下一行小字入口；练习模式改由底部操作栏承载 */}
        {!practiceMode ? <MasteryHeaderPill bankId={bankId} questionId={id} /> : null}

        {!isQuestionRedundantWithTitle && questionBody.length > 0 ? (
          <View style={styles.questionBody}>
            <Markdown markdownit={markdownit} style={readingStyles} rules={markdownRules}>
              {questionBody}
            </Markdown>
          </View>
        ) : null}

        {/* 来源元数据：折叠成一行小字，既遵守开源协议又不抢视线 */}
        {sourceMeta ? (
          <View style={styles.sourceMetaContainer}>
            <Pressable
              onPress={() => setShowSourceMeta((v) => !v)}
              style={styles.sourceMetaToggle}
              accessibilityRole="button"
              accessibilityLabel="题库来源信息"
              accessibilityState={{ expanded: showSourceMeta }}
            >
              <Text style={styles.sourceMetaToggleText}>题库来源与说明</Text>
              <ChevronDown
                size={14}
                color={colors.textSubtle}
                strokeWidth={1.6}
                style={showSourceMeta ? styles.chevronExpanded : undefined}
              />
            </Pressable>
            {showSourceMeta ? (
              <Markdown markdownit={markdownit} style={sourceMetaMarkdownStyles}>
                {sourceMeta}
              </Markdown>
            ) : null}
          </View>
        ) : null}

        {/* 浏览模式的展开答案入口（页内唯一主操作）；练习模式由底栏开关负责 */}
        {!practiceMode && answerAvailable && !showAnswer ? (
          <Pressable
            accessibilityRole="button"
            accessibilityHint="显示已经安装在本机的参考答案"
            onPress={onShowAnswer}
            hitSlop={8}
            style={({ pressed }) => [styles.revealButton, pressed && styles.pressed]}
          >
            <Text style={styles.revealText}>查看参考答案</Text>
          </Pressable>
        ) : null}

        {/* 参考答案：留白 + 发丝线 + 眉题分区，不再套卡片 */}
        {showAnswer && answer !== null ? (
          <View style={styles.answerSection} testID="answer-section">
            <View style={styles.rule} />
            <Text style={styles.eyebrow}>参考答案</Text>
            <Markdown markdownit={markdownit} style={readingStyles} rules={markdownRules}>
              {answerSections.main}
            </Markdown>

            {followUpItems.length > 0 ? (
              <View style={styles.followUpSection}>
                <View style={styles.followUpHeadingRow}>
                  <Text style={styles.eyebrow}>面试官追问</Text>
                  <Text style={styles.followUpCount}>{followUpItems.length} 条</Text>
                </View>
                {followUpItems.map((followUp, index) => (
                  <FollowUpItem key={`${followUp.title}-${index}`} section={followUp} scale={readingScale} />
                ))}
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingTop: spacing.xl, paddingBottom: 64 },
  // 底栏是固定布局（不再悬浮遮挡），正文只需常规留白
  practiceContent: { paddingBottom: spacing.xxxl },
  // 版心：手机上贴满（左右 20），平板/横屏居中限宽
  column: {
    width: '100%',
    maxWidth: layout.readingMaxWidth,
    alignSelf: 'center',
    paddingHorizontal: layout.pagePadding,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  metaLine: { ...typography.caption, color: colors.textMuted, flex: 1 },
  favoriteButton: { padding: 2 },
  title: {
    ...typography.readingTitle,
    color: colors.text,
    marginTop: spacing.sm,
  },
  questionBody: { marginTop: spacing.xl },
  sourceMetaContainer: { marginTop: spacing.xs, marginBottom: spacing.sm, gap: spacing.xs },
  sourceMetaToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
  },
  sourceMetaToggleText: { ...typography.caption, color: colors.textSubtle },
  revealButton: {
    alignSelf: 'flex-start',
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.primary,
  },
  revealText: { ...typography.bodyStrong, color: colors.primary },
  answerSection: { marginTop: spacing.xxl },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: colors.borderStrong, marginBottom: spacing.xl },
  eyebrow: { ...typography.eyebrow, color: colors.textMuted, marginBottom: spacing.md },
  followUpSection: { marginTop: spacing.xl },
  followUpHeadingRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  followUpCount: { ...typography.caption, color: colors.textSubtle, marginBottom: spacing.md },
  chevronExpanded: { transform: [{ rotate: '180deg' }] },
  loadingState: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, padding: spacing.xl },
  loadingTitle: { ...typography.heading, color: colors.text, marginTop: spacing.lg },
  loadingCopy: { ...typography.body, color: colors.textMuted, marginTop: spacing.xs },
  errorState: { flex: 1, justifyContent: 'center', backgroundColor: colors.background },
  pressed: { opacity: 0.6 },
});
