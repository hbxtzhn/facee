import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Markdown, { type RenderRules } from 'react-native-markdown-display';
import { Bookmark, Check, ChevronDown, RotateCcw, X } from 'lucide-react-native';
import { useBankStore, type KeypointAttempt, type LinkedQuestion, type Mastery, type Question, type QuestionDetail } from '../../bank';
import markdownit from '../../lib/markdown';
import { useUserStore } from '../../store/userStore';
import { EmptyState } from '../../components/ui';
import { MASTERY_LABELS, MasteryHeaderPill, MasteryToggles } from '../../components/mastery-control';
import { colors, layout, spacing, typography } from '../../theme';
import {
  buildFeedbackUrl,
  buildMetaLine,
  formatPercent,
  isChoiceCorrect,
  keyPointWeightLabel,
  suggestFromChoice,
  suggestFromCoverage,
} from '../detail-content';
import { FollowUpItem } from './FollowUpItem';
import { createMarkdownStyles } from './markdown-styles';
import { renderImage, renderLink, renderTableHeader } from './markdown-rules';

type LinkNavigation = Parameters<typeof renderLink>[0];

export interface QuestionPageProps {
  id: string;
  /** 只有当前页记录浏览（markViewed ⇒ 清除「内容已更新」），预加载的相邻页不记 */
  active: boolean;
  practiceMode: boolean;
  /** 答案区（一句话 / 要点 / 详解…）是否展开：父级按页持有，底栏开关作用于当前页 */
  showAnswer: boolean;
  onShowAnswer: () => void;
  /** 加载 / 刷新后把详情报给父级（底栏据此显示掌握度） */
  onDetailChange?: (id: string, detail: QuestionDetail | null) => void;
  /** 自评 / 选择题给出的建议档位（未确认前） */
  suggestion: Mastery | null;
  onSuggest: (id: string, suggestion: Mastery) => void;
  /** 打标（经 useBankStore.setMastery），由父级统一处理以便清除建议 */
  onSelectMastery: (id: string, value: Mastery | null) => void;
  nav: LinkNavigation;
}

/**
 * 单道题的完整阅读页（极简阅读风：纸面、居中版心、无卡片无阴影，层次只靠字号与留白）。
 * 数据来自题库 v2：useBankStore.getQuestion（Markdown 中的 `asset:` 已改写为文件 URI），
 * 学习数据变化（learningVersion）/ 题库内容变化（contentVersion）后静默重新读取。
 *
 * 结构：元信息行 · 标题 · 补充题干（prompt）· [选择题选项] · 答案区（一句话 / 要点自评 / 详解 / 示例 / 易错点 / 追问）
 * · 前置题 / 相关题 · 参考资料 / 来源 / 复核日期 / 内容有误？
 */
export function QuestionPage({
  id,
  active,
  practiceMode,
  showAnswer,
  onShowAnswer,
  onDetailChange,
  suggestion,
  onSuggest,
  onSelectMastery,
  nav,
}: QuestionPageProps) {
  const readingScale = useUserStore((state) => state.readingScale);
  const status = useBankStore((state) => state.status);
  const contentVersion = useBankStore((state) => state.contentVersion);
  const learningVersion = useBankStore((state) => state.learningVersion);
  const feedbackTemplate = useBankStore((state) => state.activeBank?.feedbackUrl ?? null);

  const [detail, setDetail] = useState<QuestionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  // 「内容已更新」以打开时的状态为准：本页 markViewed 之后数据层会清掉它，但这次阅读仍要看到提示
  const [updatedSinceSeen, setUpdatedSinceSeen] = useState<boolean | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    if (status !== 'ready') return;
    const request = ++requestRef.current;
    void useBankStore
      .getState()
      .getQuestion(id)
      .then((result) => {
        if (request !== requestRef.current) return;
        if (result.ok) {
          setDetail(result.value);
          setError(null);
          setUpdatedSinceSeen((current) => current ?? result.value.learning.contentUpdated);
        } else {
          setDetail(null);
          setError(result.error.message);
        }
      });
  }, [id, status, contentVersion, learningVersion, retryToken]);

  useEffect(() => {
    onDetailChange?.(id, detail);
  }, [detail, id, onDetailChange]);

  const loaded = detail !== null;
  // 只记当前页且加载成功的题；markViewed 同时记下 seen_hash（清除「内容已更新」）
  useEffect(() => {
    if (active && loaded) void useBankStore.getState().markViewed(id);
  }, [active, loaded, id]);

  const markdownRules = useMemo<RenderRules>(
    () => ({ link: renderLink(nav), image: renderImage, th: renderTableHeader }),
    [nav],
  );

  const toggleFavorite = useCallback(async () => {
    const result = await useBankStore.getState().toggleFavorite(id);
    if (result.ok) {
      setDetail((current) => (current ? { ...current, learning: { ...current.learning, favorite: result.value } } : current));
    }
  }, [id]);

  const setFollowupMastery = useCallback(
    async (followupId: string, value: Mastery | null) => {
      const result = await useBankStore.getState().setFollowupMastery(id, followupId, value);
      if (!result.ok) return;
      setDetail((current) => {
        if (!current) return current;
        const followups = { ...current.learning.followups };
        if (value) followups[followupId] = value;
        else delete followups[followupId];
        return { ...current, learning: { ...current.learning, followups } };
      });
    },
    [id],
  );

  if (!detail) {
    if (error) {
      return (
        <View style={styles.errorState}>
          <EmptyState
            title="题目加载失败"
            description={error}
            actionLabel="重新加载"
            onAction={() => {
              setError(null);
              setRetryToken((value) => value + 1);
            }}
            icon={RotateCcw}
          />
        </View>
      );
    }
    return (
      <View style={styles.loadingState}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingTitle}>正在打开题目</Text>
        <Text style={styles.loadingCopy}>正在读取本地题库</Text>
      </View>
    );
  }

  const question = detail.question;
  const learning = detail.learning;
  const readingStyles = createMarkdownStyles(readingScale);
  const metaLine = buildMetaLine(question, detail.categoryName);
  const feedbackUrl = buildFeedbackUrl(feedbackTemplate, question.id);
  const masteryState = { mastery: learning.mastery, dueAt: learning.dueAt };
  const isChoice = question.type === 'choice' && question.choice !== null;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, practiceMode && styles.practiceContent]}
      contentInsetAdjustmentBehavior="automatic"
    >
      <View style={styles.column} testID="reading-column">
        <View style={styles.metaRow}>
          <Text style={styles.metaLine} numberOfLines={2}>
            {metaLine}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={learning.favorite ? '取消收藏这道题' : '收藏这道题'}
            accessibilityState={{ selected: learning.favorite }}
            hitSlop={10}
            onPress={() => void toggleFavorite()}
            style={({ pressed }) => [styles.favoriteButton, pressed && styles.pressed]}
          >
            <Bookmark
              size={18}
              color={learning.favorite ? colors.primary : colors.textSubtle}
              fill={learning.favorite ? colors.primary : 'none'}
              strokeWidth={1.6}
            />
          </Pressable>
        </View>

        {updatedSinceSeen ? (
          <Text style={styles.updatedNote} accessibilityLabel="这道题在你上次学习后内容有更新">
            内容已更新
          </Text>
        ) : null}

        <Text style={styles.title} accessibilityRole="header">
          {question.title}
        </Text>

        {/* 掌握度标记（浏览模式）：标题下一行小字入口；练习模式改由底部操作栏承载 */}
        {!practiceMode ? (
          <MasteryHeaderPill
            state={masteryState}
            suggested={suggestion}
            onSelect={(value) => onSelectMastery(id, value)}
          />
        ) : null}

        {question.prompt ? (
          <View style={styles.questionBody}>
            <Markdown markdownit={markdownit} style={readingStyles} rules={markdownRules}>
              {question.prompt}
            </Markdown>
          </View>
        ) : null}

        {isChoice ? (
          <ChoiceSection
            key={question.contentHash}
            question={question}
            scale={readingScale}
            markdownRules={markdownRules}
            onSubmitted={(correct) => {
              onSuggest(id, suggestFromChoice(correct));
              onShowAnswer();
            }}
            showExplanation={showAnswer}
          />
        ) : null}

        {/* 浏览模式的展开答案入口（页内唯一主操作）；练习模式由底栏开关负责 */}
        {!practiceMode && !showAnswer ? (
          <Pressable
            accessibilityRole="button"
            accessibilityHint="显示一句话结论与要点"
            onPress={onShowAnswer}
            hitSlop={8}
            style={({ pressed }) => [styles.revealButton, pressed && styles.pressed]}
          >
            <Text style={styles.revealText}>查看参考答案</Text>
          </Pressable>
        ) : null}

        {showAnswer ? (
          <View style={styles.answerSection} testID="answer-section">
            <View style={styles.rule} />
            <Text style={styles.eyebrow}>一句话</Text>
            <Text style={[readingStyles.body, styles.summary]}>{question.answer.summary}</Text>

            {isChoice ? (
              <KeyPointList question={question} scale={readingScale} />
            ) : (
              <KeyPointSelfCheck
                key={question.contentHash}
                question={question}
                scale={readingScale}
                lastCheck={learning.lastKeypointCheck}
                practiceMode={practiceMode}
                masteryState={masteryState}
                suggestion={suggestion}
                onSuggest={(value) => onSuggest(id, value)}
                onSelectMastery={(value) => onSelectMastery(id, value)}
              />
            )}

            {question.answer.detail ? (
              <Collapsible title="详解" defaultOpen={!practiceMode}>
                <Markdown markdownit={markdownit} style={readingStyles} rules={markdownRules}>
                  {question.answer.detail}
                </Markdown>
              </Collapsible>
            ) : null}

            {question.answer.examples ? (
              <Collapsible title="示例" defaultOpen={!practiceMode}>
                <Markdown markdownit={markdownit} style={readingStyles} rules={markdownRules}>
                  {question.answer.examples}
                </Markdown>
              </Collapsible>
            ) : null}

            {question.answer.pitfalls && question.answer.pitfalls.length > 0 ? (
              <Collapsible title="易错点" defaultOpen={!practiceMode}>
                {question.answer.pitfalls.map((pitfall, index) => (
                  <Text key={`${index}-${pitfall}`} style={[readingStyles.body, styles.pitfall]}>
                    · {pitfall}
                  </Text>
                ))}
              </Collapsible>
            ) : null}

            {question.followups.length > 0 ? (
              <View style={styles.followUpSection}>
                <View style={styles.followUpHeadingRow}>
                  <Text style={styles.eyebrow}>追问</Text>
                  <Text style={styles.followUpCount}>{question.followups.length} 条</Text>
                </View>
                {question.followups.map((followup) => (
                  <FollowUpItem
                    key={followup.id}
                    followup={followup}
                    mastery={learning.followups[followup.id] ?? null}
                    onMasteryChange={(value) => void setFollowupMastery(followup.id, value)}
                    scale={readingScale}
                  />
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        <QuestionLinks links={detail.links} nav={nav} />
        <SourceFooter question={question} feedbackUrl={feedbackUrl} />
      </View>
    </ScrollView>
  );
}

/** 可折叠分节：眉题 + 细 chevron，点按展开 / 收起 */
function Collapsible({ title, defaultOpen, children }: { title: string; defaultOpen: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View style={styles.collapsible}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={({ pressed }) => [styles.collapsibleToggle, pressed && styles.pressed]}
      >
        <Text style={[styles.eyebrow, styles.collapsibleTitle]}>{title}</Text>
        <ChevronDown
          size={16}
          color={colors.textSubtle}
          strokeWidth={1.6}
          style={open ? styles.chevronExpanded : undefined}
        />
      </Pressable>
      {open ? <View style={styles.collapsibleBody}>{children}</View> : null}
    </View>
  );
}

function keyPointTextStyle(scale: number) {
  return { fontSize: Math.round(16 * scale), lineHeight: Math.round(26 * scale) };
}

/** 选择题的要点：只读列表（判分已由选项给出，不再重复自评） */
function KeyPointList({ question, scale }: { question: Question; scale: number }) {
  return (
    <View style={styles.keyPointSection}>
      <Text style={styles.eyebrow}>要点</Text>
      {question.answer.keyPoints.map((kp) => (
        <View key={kp.id} style={styles.keyPointRow}>
          <Text style={[styles.keyPointText, keyPointTextStyle(scale)]}>· {kp.text}</Text>
          <WeightTag weight={kp.weight} />
        </View>
      ))}
    </View>
  );
}

function WeightTag({ weight }: { weight: Question['answer']['keyPoints'][number]['weight'] }) {
  const label = keyPointWeightLabel(weight);
  return label ? <Text style={styles.weightTag}>{label}</Text> : null;
}

/**
 * 要点自评：每条要点一行可勾选「我答到了」，点「记录自评」整组写入（useBankStore.recordKeypointCheck），
 * 随后按加权覆盖率给出建议档位（≥ 80 % 会了 / 40–80 % 模糊 / < 40 % 不会），由用户在三态开关上确认——不自动打标。
 */
function KeyPointSelfCheck({
  question,
  scale,
  lastCheck,
  practiceMode,
  masteryState,
  suggestion,
  onSuggest,
  onSelectMastery,
}: {
  question: Question;
  scale: number;
  lastCheck: KeypointAttempt | null;
  practiceMode: boolean;
  masteryState: { mastery: Mastery | null; dueAt: number | null };
  suggestion: Mastery | null;
  onSuggest: (value: Mastery) => void;
  onSelectMastery: (value: Mastery | null) => void;
}) {
  const keyPoints = question.answer.keyPoints;
  const [covered, setCovered] = useState<Record<string, boolean>>({});
  const [attempt, setAttempt] = useState<KeypointAttempt | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setSaveError(null);
    const payload = Object.fromEntries(keyPoints.map((kp) => [kp.id, covered[kp.id] === true]));
    const result = await useBankStore.getState().recordKeypointCheck(question.id, payload);
    setSaving(false);
    if (!result.ok) {
      setSaveError(result.error.message);
      return;
    }
    setAttempt(result.value);
    onSuggest(suggestFromCoverage(result.value.weightedCoverage));
  };

  const suggested = attempt ? suggestFromCoverage(attempt.weightedCoverage) : null;

  return (
    <View style={styles.keyPointSection}>
      <View style={styles.keyPointHeading}>
        <Text style={styles.eyebrow}>要点</Text>
        <Text style={styles.keyPointHint}>勾选你答到的</Text>
      </View>
      {keyPoints.map((kp) => {
        const checked = covered[kp.id] === true;
        return (
          <Pressable
            key={kp.id}
            accessibilityRole="checkbox"
            accessibilityLabel={`我答到了：${kp.text}`}
            accessibilityState={{ checked }}
            onPress={() => setCovered((current) => ({ ...current, [kp.id]: !checked }))}
            style={({ pressed }) => [styles.keyPointRow, pressed && styles.pressed]}
          >
            <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
              {checked ? <Check size={12} color={colors.white} strokeWidth={2.4} /> : null}
            </View>
            <Text style={[styles.keyPointText, keyPointTextStyle(scale)]}>{kp.text}</Text>
            <WeightTag weight={kp.weight} />
          </Pressable>
        );
      })}

      <View style={styles.selfCheckFooter}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={attempt ? '更新要点自评' : '记录要点自评'}
          accessibilityState={{ disabled: saving }}
          disabled={saving}
          hitSlop={6}
          onPress={() => void submit()}
          style={({ pressed }) => [styles.textAction, pressed && styles.pressed]}
        >
          <Text style={styles.textActionLabel}>{attempt ? '更新自评' : '记录自评'}</Text>
        </Pressable>
        {!attempt && lastCheck ? (
          <Text style={styles.caption}>上次覆盖 {formatPercent(lastCheck.weightedCoverage)}</Text>
        ) : null}
      </View>
      {saveError ? <Text style={styles.errorText}>{saveError}</Text> : null}

      {attempt && suggested ? (
        <View style={styles.suggestionBlock} testID="self-check-result">
          <Text style={styles.caption}>
            要点覆盖 {formatPercent(attempt.weightedCoverage)}（按权重）· 建议标记「{MASTERY_LABELS[suggested]}」
            {practiceMode ? '，在底栏确认' : ''}
          </Text>
          {/* 浏览模式没有底栏：在这里直接确认 */}
          {!practiceMode ? (
            <MasteryToggles state={masteryState} suggested={suggestion} onSelect={onSelectMastery} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * 选择题：选项为可选行（多正确项时为多选），「提交」后标出对错并显示解析，
 * 同时给出建议档位（答对 → 会了，答错 → 不会），由用户确认。
 */
function ChoiceSection({
  question,
  scale,
  markdownRules,
  onSubmitted,
  showExplanation,
}: {
  question: Question;
  scale: number;
  markdownRules: RenderRules;
  onSubmitted: (correct: boolean) => void;
  showExplanation: boolean;
}) {
  const choice = question.choice!;
  const multiple = choice.correct.length > 1;
  const [selected, setSelected] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const correct = submitted && isChoiceCorrect(selected, choice.correct);
  const correctLabels = choice.options
    .filter((option) => choice.correct.includes(option.id))
    .map((option) => option.id.toUpperCase())
    .join('、');

  const toggle = (optionId: string) => {
    if (submitted) return;
    setSelected((current) => {
      if (!multiple) return [optionId];
      return current.includes(optionId) ? current.filter((value) => value !== optionId) : [...current, optionId];
    });
  };

  return (
    <View style={styles.choiceSection}>
      {multiple ? <Text style={styles.caption}>多选</Text> : null}
      {choice.options.map((option) => {
        const isSelected = selected.includes(option.id);
        const isCorrectOption = choice.correct.includes(option.id);
        const verdict = submitted ? (isCorrectOption ? 'correct' : isSelected ? 'wrong' : null) : null;
        return (
          <Pressable
            key={option.id}
            accessibilityRole={multiple ? 'checkbox' : 'radio'}
            accessibilityLabel={`选项 ${option.id.toUpperCase()}：${option.text}`}
            accessibilityState={{ checked: isSelected, disabled: submitted }}
            disabled={submitted}
            onPress={() => toggle(option.id)}
            style={({ pressed }) => [
              styles.optionRow,
              isSelected && styles.optionRowSelected,
              verdict === 'correct' && styles.optionRowCorrect,
              verdict === 'wrong' && styles.optionRowWrong,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.optionId}>{option.id.toUpperCase()}</Text>
            <Text style={[styles.optionText, keyPointTextStyle(scale)]}>{option.text}</Text>
            {verdict === 'correct' ? <Check size={16} color={colors.success} strokeWidth={2} /> : null}
            {verdict === 'wrong' ? <X size={16} color={colors.danger} strokeWidth={2} /> : null}
          </Pressable>
        );
      })}

      {submitted ? (
        <View style={styles.choiceResult} testID="choice-result">
          <Text style={[styles.verdict, correct ? styles.verdictCorrect : styles.verdictWrong]}>
            {correct ? '回答正确' : `回答错误，正确答案：${correctLabels}`}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="重新作答"
            hitSlop={6}
            onPress={() => {
              setSubmitted(false);
              setSelected([]);
            }}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <Text style={styles.caption}>重做</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="提交答案"
          accessibilityState={{ disabled: selected.length === 0 }}
          disabled={selected.length === 0}
          hitSlop={6}
          onPress={() => {
            setSubmitted(true);
            onSubmitted(isChoiceCorrect(selected, choice.correct));
          }}
          style={({ pressed }) => [styles.textAction, pressed && styles.pressed]}
        >
          <Text style={[styles.textActionLabel, selected.length === 0 && styles.textDisabled]}>提交</Text>
        </Pressable>
      )}

      {(submitted || showExplanation) && choice.explanation ? (
        <View style={styles.explanation}>
          <Text style={styles.eyebrow}>解析</Text>
          <Markdown markdownit={markdownit} style={createMarkdownStyles(scale)} rules={markdownRules}>
            {choice.explanation}
          </Markdown>
        </View>
      ) : null}
    </View>
  );
}

/** 前置题 / 相关题：不依赖答案是否展开，读不懂时可以先去补前置知识 */
function QuestionLinks({ links, nav }: { links: QuestionDetail['links']; nav: LinkNavigation }) {
  if (links.prerequisites.length === 0 && links.related.length === 0) return null;
  const group = (title: string, items: LinkedQuestion[]) =>
    items.length > 0 ? (
      <View style={styles.linkGroup}>
        <Text style={styles.eyebrow}>{title}</Text>
        {items.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="link"
            accessibilityLabel={`${title}：${item.title}，${item.mastery ? MASTERY_LABELS[item.mastery] : '未标记'}`}
            onPress={() => nav.push('Detail', { id: item.id })}
            style={({ pressed }) => [styles.linkRow, pressed && styles.linkRowPressed]}
          >
            <Text style={styles.linkTitle}>{item.title}</Text>
            <Text style={styles.linkMastery}>{item.mastery ? MASTERY_LABELS[item.mastery] : '未标记'}</Text>
          </Pressable>
        ))}
      </View>
    ) : null;
  return (
    <View style={styles.links} testID="question-links">
      {group('前置题', links.prerequisites)}
      {group('相关题', links.related)}
    </View>
  );
}

/** 参考资料、来源 / 许可、复核日期与「内容有误？」：一组安静的小字 */
function SourceFooter({ question, feedbackUrl }: { question: Question; feedbackUrl: string | null }) {
  const references = question.references ?? [];
  const source = question.source;
  if (references.length === 0 && !source && !question.reviewedAt && !feedbackUrl) return null;
  return (
    <View style={styles.footer} testID="question-footer">
      {references.length > 0 ? (
        <View style={styles.references}>
          <Text style={styles.eyebrow}>参考资料</Text>
          {references.map((reference) => (
            <Text
              key={reference.url}
              accessibilityRole="link"
              style={styles.footerLink}
              onPress={() => void Linking.openURL(reference.url)}
            >
              {reference.title}
            </Text>
          ))}
        </View>
      ) : null}
      {source ? (
        <Text style={styles.caption}>
          来源：
          {source.url ? (
            <Text accessibilityRole="link" style={styles.footerLink} onPress={() => void Linking.openURL(source.url!)}>
              {source.name}
            </Text>
          ) : (
            source.name
          )}
          {source.license ? ` · ${source.license}` : ''}
        </Text>
      ) : null}
      {question.reviewedAt ? <Text style={styles.caption}>复核于 {question.reviewedAt}</Text> : null}
      {feedbackUrl ? (
        <Text
          accessibilityRole="link"
          accessibilityLabel="内容有误？反馈这道题"
          style={[styles.caption, styles.feedbackLink]}
          onPress={() => void Linking.openURL(feedbackUrl)}
        >
          内容有误？
        </Text>
      ) : null}
    </View>
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
  updatedNote: { ...typography.caption, color: colors.textSubtle, marginTop: spacing.xs },
  title: {
    ...typography.readingTitle,
    color: colors.text,
    marginTop: spacing.sm,
  },
  questionBody: { marginTop: spacing.xl },
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
  summary: { marginBottom: spacing.xl },
  keyPointSection: { marginBottom: spacing.lg },
  keyPointHeading: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  keyPointHint: { ...typography.caption, color: colors.textSubtle, marginBottom: spacing.md },
  keyPointRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: spacing.xs, minHeight: 40 },
  keyPointText: { color: colors.text, flex: 1 },
  weightTag: { ...typography.caption, color: colors.textSubtle, marginTop: 3 },
  checkbox: {
    width: 18,
    height: 18,
    marginTop: 4,
    borderRadius: 4,
    borderWidth: 1.2,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  selfCheckFooter: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.xs },
  textAction: { minHeight: 36, justifyContent: 'center', alignSelf: 'flex-start' },
  textActionLabel: { ...typography.bodyStrong, color: colors.primary },
  textDisabled: { color: colors.textSubtle },
  suggestionBlock: { marginTop: spacing.sm, gap: spacing.xs },
  caption: { ...typography.caption, color: colors.textMuted },
  errorText: { ...typography.caption, color: colors.danger, marginTop: spacing.xs },
  collapsible: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  collapsibleToggle: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  collapsibleTitle: { marginBottom: 0 },
  collapsibleBody: { paddingBottom: spacing.md },
  pitfall: { marginBottom: spacing.xs },
  followUpSection: { marginTop: spacing.xl },
  followUpHeadingRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  followUpCount: { ...typography.caption, color: colors.textSubtle, marginBottom: spacing.md },
  choiceSection: { marginTop: spacing.xl, gap: spacing.sm },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    borderRadius: 6,
  },
  optionRowSelected: { borderColor: colors.primary, borderWidth: 1 },
  optionRowCorrect: { borderColor: colors.success, backgroundColor: colors.successSoft },
  optionRowWrong: { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
  optionId: { ...typography.bodyStrong, color: colors.textMuted, width: 16 },
  optionText: { color: colors.text, flex: 1 },
  choiceResult: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xs },
  verdict: { ...typography.bodyStrong },
  verdictCorrect: { color: colors.success },
  verdictWrong: { color: colors.danger },
  explanation: { marginTop: spacing.md },
  links: { marginTop: spacing.xxl, gap: spacing.lg },
  linkGroup: {},
  linkRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  linkRowPressed: { opacity: 0.6 },
  linkTitle: { ...typography.body, color: colors.text, flex: 1 },
  linkMastery: { ...typography.caption, color: colors.textMuted },
  footer: { marginTop: spacing.xxl, gap: spacing.xs },
  references: { marginBottom: spacing.sm, gap: spacing.xs },
  footerLink: { ...typography.caption, color: colors.textSecondary, textDecorationLine: 'underline' },
  feedbackLink: { marginTop: spacing.sm, textDecorationLine: 'underline' },
  chevronExpanded: { transform: [{ rotate: '180deg' }] },
  loadingState: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, padding: spacing.xl },
  loadingTitle: { ...typography.heading, color: colors.text, marginTop: spacing.lg },
  loadingCopy: { ...typography.body, color: colors.textMuted, marginTop: spacing.xs },
  errorState: { flex: 1, justifyContent: 'center', backgroundColor: colors.background },
  pressed: { opacity: 0.6 },
});
