import type { Difficulty, Importance, Mastery, QuestionListItem, QuestionType } from '../../../bank';

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: '简单',
  medium: '中等',
  hard: '困难',
};

export const TYPE_LABEL: Record<QuestionType, string> = {
  concept: '概念',
  scenario: '场景',
  coding: '编程',
  design: '设计',
  behavioral: '行为',
  choice: '选择',
};

/** 1 = 一般，2 = 常见（默认），3 = 高频 / 核心（见 src/bank/types.ts） */
export const IMPORTANCE_LABEL: Record<Importance, string> = {
  1: '一般',
  2: '常见',
  3: '高频',
};

export const MASTERY_LABEL: Record<Mastery, string> = {
  unknown: '不会',
  fuzzy: '模糊',
  known: '会了',
};

export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];
export const QUESTION_TYPES: QuestionType[] = ['concept', 'scenario', 'coding', 'design', 'behavioral', 'choice'];
export const IMPORTANCES: Importance[] = [3, 2, 1];
export const MASTERY_FILTERS: Array<Mastery | 'unmarked'> = ['unmarked', 'unknown', 'fuzzy', 'known'];
export const MASTERY_FILTER_LABEL: Record<Mastery | 'unmarked', string> = { unmarked: '未标', ...MASTERY_LABEL };

/**
 * 列表行的单行元信息：「难度 · 类型 · 掌握度」，全部是弱化文字，不做色块。
 * 未打标时省略掌握度。
 */
export function buildQuestionMeta(item: Pick<QuestionListItem, 'difficulty' | 'type' | 'mastery'>): string {
  const parts: string[] = [];
  const difficulty = DIFFICULTY_LABEL[item.difficulty];
  if (difficulty) parts.push(difficulty);
  const type = TYPE_LABEL[item.type];
  if (type) parts.push(type);
  if (item.mastery) parts.push(MASTERY_LABEL[item.mastery]);
  return parts.join(' · ');
}

/** 一句话预览：压成单行，空串返回 null */
export function summaryPreview(summary: string | null | undefined): string | null {
  const text = (summary ?? '').replace(/\s+/g, ' ').trim();
  return text ? text : null;
}
