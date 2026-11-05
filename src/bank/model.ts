import type { BankOrigin } from './bank-rows';
import type { UpdateCheck } from './install';
import type { Difficulty, Importance, Question, QuestionType } from './types';

/**
 * 数据层对 UI 暴露的读模型（查询结果类型）。
 */

export type { BankOrigin };

/** 三态掌握度：`unknown` 是「不会」，与「未打标」（无记录 / null）严格区分 */
export type Mastery = 'unknown' | 'fuzzy' | 'known';

export interface BankSummary {
  id: string;
  /** remote = 在线（可检查更新）；local = 用户自建（可编辑）；file = 文件导入（只读） */
  origin: BankOrigin;
  name: string;
  version: string;
  locale: string;
  description: string | null;
  homepage: string | null;
  license: string | null;
  feedbackUrl: string | null;
  manifestUrl: string | null;
  questionCount: number;
  installedAt: number;
  updatedAt: number;
  checkedAt: number | null;
  /** 最近一次检查更新的结果（安装新版本后清空） */
  lastCheck: UpdateCheck | null;
}

export interface CategoryInfo {
  id: string;
  name: string;
  description: string | null;
  order: number;
  questionCount: number;
  /** 已打标（任一掌握度）题数 */
  markedCount: number;
  knownCount: number;
}

export interface TagInfo {
  id: string;
  name: string;
  parentId: string | null;
  order: number;
  /** 直接子标签 id（按 order、id 排序） */
  childIds: string[];
  /** 含全部子孙标签的题数（去重） */
  questionCount: number;
}

export interface CollectionInfo {
  id: string;
  name: string;
  description: string | null;
  /** 有序题目 id（只含当前题库中存在的题） */
  questionIds: string[];
}

export interface QuestionFilter {
  categoryIds?: string[];
  /** 命中任一标签即可；自动包含子孙标签 */
  tagIds?: string[];
  difficulties?: Difficulty[];
  types?: QuestionType[];
  importance?: Importance[];
  /** 限定在某个专题内，并按专题顺序排序 */
  collectionId?: string;
  /** 掌握度；`unmarked` = 未打标 */
  mastery?: Array<Mastery | 'unmarked'>;
  favoritesOnly?: boolean;
  /** 只要今天到期需复习的题 */
  dueOnly?: boolean;
  /** 只要「内容已更新」（看过 / 学过后 contentHash 变化）的题 */
  updatedSinceSeen?: boolean;
  /** 限定题目 id 集合 */
  questionIds?: string[];
}

export interface QuestionListItem {
  id: string;
  title: string;
  type: QuestionType;
  difficulty: Difficulty;
  importance: Importance;
  categoryId: string;
  summary: string;
  mastery: Mastery | null;
  favorite: boolean;
  dueAt: number | null;
  /** 学过 / 看过之后内容有更新 */
  contentUpdated: boolean;
}

export interface SearchHit {
  id: string;
  title: string;
  categoryId: string;
  /** 命中位置附近的纯文本片段（无高亮标记） */
  snippet: string;
  /** 命中出现在标题还是正文 */
  matchedIn: 'title' | 'body';
}

export interface QuestionLearningInfo {
  mastery: Mastery | null;
  streak: number;
  dueAt: number | null;
  markedAt: number | null;
  viewedAt: number | null;
  favorite: boolean;
  contentUpdated: boolean;
  /** 追问 id → 掌握度 */
  followups: Record<string, Mastery>;
  /** 最近一次要点自评（仅当前题仍存在的要点）；没有自评为 null */
  lastKeypointCheck: KeypointAttempt | null;
}

export interface KeypointAttempt {
  checkedAt: number;
  /** 要点 id → 是否答到 */
  covered: Record<string, boolean>;
  /** 按权重计算的覆盖率 0–1（只计当前题仍存在的要点） */
  weightedCoverage: number;
}

export interface QuestionDetail {
  bankId: string;
  /** 渲染用：Markdown 中的 `asset:` 已改写为文件 URI */
  question: Question;
  /** 原始数据（编辑本地题目用） */
  raw: Question;
  categoryName: string | null;
  assetBaseUri: string | null;
  learning: QuestionLearningInfo;
}
