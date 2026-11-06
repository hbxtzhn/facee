import { suggestMasteryFromCoverage, type KeyPoint, type Mastery, type Question, type QuestionType } from '../bank';

/**
 * 详情页的纯函数（不依赖 React / store，便于单测）：元信息行、要点覆盖率与建议打标、
 * 选择题判分、纠错链接。
 */

export const DIFFICULTY_LABELS: Record<Question['difficulty'], string> = {
  easy: '简单',
  medium: '中等',
  hard: '困难',
};

export const TYPE_LABELS: Record<QuestionType, string> = {
  concept: '概念',
  scenario: '场景',
  coding: '编码',
  design: '设计',
  behavioral: '行为',
  choice: '选择题',
};

/** 要点权重的弱化标注：3 = 核心，2 = 重要，1（加分项）不标 */
export function keyPointWeightLabel(weight: KeyPoint['weight']): string | null {
  if (weight === 3) return '核心';
  if (weight === 2) return '重要';
  return null;
}

/** 一行弱化元信息：分类 · 难度 · 类型 · 适用版本 */
export function buildMetaLine(question: Pick<Question, 'difficulty' | 'type' | 'appliesTo'>, categoryName: string | null): string {
  return [
    categoryName,
    DIFFICULTY_LABELS[question.difficulty],
    TYPE_LABELS[question.type],
    ...(question.appliesTo ?? []),
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · ');
}

/** 按权重计算要点覆盖率（0–1）；与数据层口径一致，用于提交前的即时预览 */
export function weightedCoverage(keyPoints: readonly KeyPoint[], covered: Record<string, boolean>): number {
  let total = 0;
  let hit = 0;
  for (const kp of keyPoints) {
    total += kp.weight;
    if (covered[kp.id]) hit += kp.weight;
  }
  return total > 0 ? hit / total : 0;
}

/**
 * 由要点覆盖率给出建议打标（阈值沿用数据层 suggestMasteryFromCoverage）：
 * ≥ 80 % 会了，40 %–80 % 模糊，< 40 % 不会。只是建议，必须由用户在三态开关上确认。
 */
export function suggestFromCoverage(coverage: number): Mastery {
  return suggestMasteryFromCoverage(coverage);
}

/** 选择题判分：所选集合与正确集合完全一致才算对（支持多选） */
export function isChoiceCorrect(selected: readonly string[], correct: readonly string[]): boolean {
  if (selected.length !== correct.length) return false;
  const expected = new Set(correct);
  return selected.every((id) => expected.has(id));
}

/** 选择题的建议打标：答对 → 会了，答错 → 不会 */
export function suggestFromChoice(correct: boolean): Mastery {
  return correct ? 'known' : 'unknown';
}

/** 纠错链接：替换 `{questionId}` 占位符（URL 编码）；只接受 http(s) */
export function buildFeedbackUrl(feedbackUrl: string | null | undefined, questionId: string): string | null {
  if (!feedbackUrl || !/^https?:\/\//i.test(feedbackUrl)) return null;
  return feedbackUrl.split('{questionId}').join(encodeURIComponent(questionId));
}

/** 百分比文案（四舍五入到整数） */
export function formatPercent(ratio: number): string {
  return `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
}
