import type {
  Difficulty,
  Importance,
  KeyPointWeight,
  LocalQuestionInput,
  Question,
  QuestionType,
} from '../../bank';
import { countSpecChars } from './bank-helpers';

/**
 * 本地题目编辑表单（v2 结构）的纯逻辑：表单 ⇄ 题目、客户端校验、把 store 校验详情映射回字段。
 * 要点 / 追问的 id 由数据层分配：表单只在内部保留已有 id（不展示），新增条目不带 id。
 */

export const SUMMARY_LIMIT = 80;
export const KEY_POINT_LIMIT = 40;
export const FOLLOWUP_ANSWER_LIMIT = 150;
export const MIN_KEY_POINTS = 3;
export const MAX_KEY_POINTS = 5;

export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  concept: '概念',
  scenario: '场景',
  coding: '编码',
  design: '设计',
  behavioral: '行为',
  choice: '选择',
};
export const QUESTION_TYPES = Object.keys(QUESTION_TYPE_LABEL) as QuestionType[];
export const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: '简单', medium: '中等', hard: '困难' };
export const IMPORTANCE_LABEL: Record<Importance, string> = { 1: '一般', 2: '常见', 3: '高频' };
export const WEIGHT_LABEL: Record<KeyPointWeight, string> = { 1: '加分', 2: '重要', 3: '核心' };

let keySeed = 0;
/** 表单行的 React key（与数据 id 无关） */
export function formKey(): string {
  keySeed += 1;
  return `row-${keySeed}`;
}

export interface KeyPointRow { key: string; id?: string; text: string; weight: KeyPointWeight }
export interface FollowupRow { key: string; id?: string; q: string; a: string }
export interface ReferenceRow { key: string; title: string; url: string }
export interface OptionRow { key: string; text: string; correct: boolean }

export interface QuestionForm {
  title: string;
  type: QuestionType;
  difficulty: Difficulty;
  importance: Importance;
  categoryId: string;
  tags: string[];
  prompt: string;
  summary: string;
  keyPoints: KeyPointRow[];
  detail: string;
  examples: string;
  /** 每行一条 */
  pitfalls: string;
  followups: FollowupRow[];
  references: ReferenceRow[];
  /** 逗号或换行分隔 */
  appliesTo: string;
  options: OptionRow[];
}

/** 字段错误：键为字段名，列表项用 `keyPoints.2` 形式 */
export type FormErrors = Record<string, string>;

export function emptyForm(categoryId: string): QuestionForm {
  return {
    title: '',
    type: 'concept',
    difficulty: 'medium',
    importance: 2,
    categoryId,
    tags: [],
    prompt: '',
    summary: '',
    keyPoints: [1, 2, 3].map(() => ({ key: formKey(), text: '', weight: 1 as KeyPointWeight })),
    detail: '',
    examples: '',
    pitfalls: '',
    followups: [],
    references: [],
    appliesTo: '',
    options: [
      { key: formKey(), text: '', correct: false },
      { key: formKey(), text: '', correct: false },
    ],
  };
}

export function formFromQuestion(question: Question): QuestionForm {
  const choice = question.type === 'choice' ? question.choice : null;
  return {
    title: question.title,
    type: question.type,
    difficulty: question.difficulty,
    importance: question.importance,
    categoryId: question.categoryId,
    tags: [...question.tags],
    prompt: question.prompt ?? '',
    summary: question.answer.summary,
    keyPoints: question.answer.keyPoints.map((kp) => ({ key: formKey(), id: kp.id, text: kp.text, weight: kp.weight })),
    detail: (choice?.explanation ?? question.answer.detail) ?? '',
    examples: question.answer.examples ?? '',
    pitfalls: (question.answer.pitfalls ?? []).join('\n'),
    followups: question.followups.map((f) => ({ key: formKey(), id: f.id, q: f.q, a: f.a })),
    references: (question.references ?? []).map((r) => ({ key: formKey(), title: r.title, url: r.url })),
    appliesTo: (question.appliesTo ?? []).join('，'),
    options: choice
      ? choice.options.map((o) => ({ key: formKey(), text: o.text, correct: choice.correct.includes(o.id) }))
      : emptyForm('').options,
  };
}

const splitList = (text: string, pattern: RegExp) => text.split(pattern).map((item) => item.trim()).filter(Boolean);
const orNull = (text: string) => (text.trim() ? text.trim() : null);

/** 选项 id：a、b、c…（按顺序重新编号） */
export function optionId(index: number): string {
  return String.fromCharCode(97 + index);
}

/**
 * 表单 → 数据层输入。previous 为编辑前的原始题目：表单未覆盖的字段（前置 / 相关题、出处、复核日期等）原样保留。
 */
export function formToInput(form: QuestionForm, previous: Question | null): LocalQuestionInput {
  const isChoice = form.type === 'choice';
  const detail = orNull(form.detail);
  const options = form.options.filter((o) => o.text.trim());
  return {
    title: form.title.trim(),
    type: form.type,
    difficulty: form.difficulty,
    importance: form.importance,
    categoryId: form.categoryId,
    tags: form.tags,
    appliesTo: splitList(form.appliesTo, /[，,\n]/),
    prerequisites: previous?.prerequisites,
    related: previous?.related,
    prompt: orNull(form.prompt),
    answer: {
      summary: form.summary.trim(),
      keyPoints: form.keyPoints
        .filter((kp) => kp.text.trim())
        .map((kp) => ({ ...(kp.id ? { id: kp.id } : {}), text: kp.text.trim(), weight: kp.weight })),
      // 选择题的「详解」作为解析存入 choice.explanation（规范 §2.2），answer.detail 为 null
      detail: isChoice ? null : detail,
      examples: orNull(form.examples),
      pitfalls: splitList(form.pitfalls, /\n/),
    },
    choice: isChoice
      ? {
        options: options.map((o, index) => ({ id: optionId(index), text: o.text.trim() })),
        correct: options.map((o, index) => (o.correct ? optionId(index) : null)).filter((id): id is string => id !== null),
        explanation: detail,
      }
      : null,
    followups: form.followups
      .filter((f) => f.q.trim() || f.a.trim())
      .map((f) => ({ ...(f.id ? { id: f.id } : {}), q: f.q.trim(), a: f.a.trim() })),
    source: previous?.source,
    references: form.references
      .filter((r) => r.title.trim() || r.url.trim())
      .map((r) => ({ title: r.title.trim(), url: r.url.trim() })),
    reviewedAt: previous?.reviewedAt,
    estimatedMinutes: previous?.estimatedMinutes,
  };
}

/** 客户端校验（规范 §2.1 写法约定）；返回空对象表示通过 */
export function validateForm(form: QuestionForm): FormErrors {
  const errors: FormErrors = {};
  if (!form.title.trim()) errors.title = '请填写题目标题';
  if (!form.categoryId) errors.categoryId = '请选择分类';
  const summary = form.summary.trim();
  if (!summary) errors.summary = '请填写一句话结论';
  else if (countSpecChars(summary) > SUMMARY_LIMIT) {
    errors.summary = `一句话结论不超过 ${SUMMARY_LIMIT} 字（当前 ${countSpecChars(summary)} 字）`;
  }
  const keyPoints = form.keyPoints.filter((kp) => kp.text.trim());
  if (keyPoints.length < MIN_KEY_POINTS || keyPoints.length > MAX_KEY_POINTS) {
    errors.keyPoints = `要点需要 ${MIN_KEY_POINTS}–${MAX_KEY_POINTS} 条（当前 ${keyPoints.length} 条）`;
  }
  form.keyPoints.forEach((kp, index) => {
    if (countSpecChars(kp.text.trim()) > KEY_POINT_LIMIT) errors[`keyPoints.${index}`] = `每条要点不超过 ${KEY_POINT_LIMIT} 字`;
  });
  form.followups.forEach((f, index) => {
    if (!f.q.trim() && !f.a.trim()) return;
    if (!f.q.trim()) errors[`followups.${index}`] = '请填写追问问题';
    else if (!f.a.trim()) errors[`followups.${index}`] = '请填写追问答案';
    else if (countSpecChars(f.a.trim()) > FOLLOWUP_ANSWER_LIMIT) {
      errors[`followups.${index}`] = `追问答案建议不超过 ${FOLLOWUP_ANSWER_LIMIT} 字；需要长篇展开请拆成独立题`;
    }
  });
  form.references.forEach((r, index) => {
    if (!r.title.trim() && !r.url.trim()) return;
    if (!r.title.trim() || !r.url.trim()) errors[`references.${index}`] = '参考资料需要标题和链接';
    else if (!/^https?:\/\//i.test(r.url.trim())) errors[`references.${index}`] = '链接需以 http(s):// 开头';
  });
  if (form.type === 'choice') {
    const options = form.options.filter((o) => o.text.trim());
    if (options.length < 2) errors.choice = '选择题至少 2 个选项';
    else if (!options.some((o) => o.correct)) errors.choice = '请标记至少 1 个正确选项';
  }
  return errors;
}

/**
 * 把 store 返回的整库校验详情（如 `questions[3].answer.keyPoints：要点应为 3–5 条`）映射到表单字段。
 * 映射不到的放进 `general`。
 */
export function mapStoreDetails(details: string[] | undefined, fallback: string): FormErrors {
  const errors: FormErrors = {};
  const general: string[] = [];
  const add = (key: string, message: string) => { if (!errors[key]) errors[key] = message; };
  for (const detail of details ?? []) {
    const separator = detail.indexOf('：');
    const path = separator >= 0 ? detail.slice(0, separator) : '';
    const message = separator >= 0 ? detail.slice(separator + 1) : detail;
    const field = /^questions\[\d+\]\.(.+)$/.exec(path)?.[1];
    if (!field) { general.push(detail); continue; }
    let match: RegExpExecArray | null;
    if ((match = /^answer\.keyPoints\[(\d+)\]/.exec(field))) add(`keyPoints.${match[1]}`, message);
    else if (field.startsWith('answer.keyPoints')) add('keyPoints', message);
    else if (field.startsWith('answer.summary')) add('summary', message);
    else if ((match = /^followups\[(\d+)\]/.exec(field))) add(`followups.${match[1]}`, message);
    else if ((match = /^references\[(\d+)\]/.exec(field))) add(`references.${match[1]}`, message);
    else if (field.startsWith('choice')) add('choice', message);
    else if (field.startsWith('title')) add('title', message);
    else if (field.startsWith('categoryId')) add('categoryId', message);
    else if (field.startsWith('tags')) add('tags', message);
    else general.push(detail);
  }
  if (general.length > 0 || Object.keys(errors).length === 0) errors.general = general.length > 0 ? general.join('；') : fallback;
  return errors;
}

/** 列表上移 / 下移（越界不动） */
export function moveItem<T>(items: T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
