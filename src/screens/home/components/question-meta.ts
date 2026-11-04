import type { Question } from '../../../question-bank';
import type { Mastery } from '../../../store/masteryStore';
import { difficultyStyles } from '../../../theme';

const MASTERY_LABEL: Record<Mastery, string> = {
  unknown: '不会',
  fuzzy: '模糊',
  known: '会了',
};

/**
 * 列表行的单行元信息：「难度 · 标签 · 掌握度」，全部是弱化文字，不做色块。
 * 标签最多取两个，避免一行被挤爆；没有的字段直接省略。
 */
export function buildQuestionMeta(
  question: Pick<Question, 'difficulty' | 'tags'>,
  mastery?: Mastery | null,
  options: { maxTags?: number } = {},
): string {
  const parts: string[] = [];
  const difficulty = difficultyStyles[question.difficulty];
  if (difficulty) parts.push(difficulty.label);
  const tags = (question.tags ?? []).slice(0, options.maxTags ?? 2).map((tag) => tag.name);
  if (tags.length > 0) parts.push(tags.join(' / '));
  if (mastery) parts.push(MASTERY_LABEL[mastery]);
  return parts.join(' · ');
}
