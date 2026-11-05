/**
 * FaceE 题库 v2 分发格式的类型契约（docs/题库规范-v2-草案.md §3）。
 *
 * 这是「构建工具 packages/bank-spec」与「App 数据层 src/bank」之间唯一的共享约定：
 * - 构建工具产出的 bundle.json / latest.json 必须满足这些类型；
 * - App 安装器在写入 SQLite 前按这些类型做运行时校验（见 src/bank/validate.ts）。
 *
 * 规则：新增字段一律可选；App 忽略未知字段；仅不兼容变更递增 BANK_SCHEMA_VERSION。
 * Markdown 只出现在标注为 Markdown 的字段内部，结构一律由字段表达。
 */

export const BANK_SCHEMA_VERSION = 2 as const;

/** 题库 id：`<host>/<owner>/<repo>`，如 `github.com/hbxtzhn/facee-bank`；永不改写 */
export type BankId = string;
/** 题目 id：`q_` + 26 位 ULID（Crockford Base32 大写），由工具生成，不从标题派生 */
export type QuestionId = string;
/** 题内要点 id：`kp1`、`kp2`…，删除后不复用 */
export type KeyPointId = string;
/** 题内追问 id：`f1`、`f2`…，删除后不复用 */
export type FollowupId = string;
/** 分类 / 标签 / 专题 id：`^[a-z0-9][a-z0-9-]{0,63}$` */
export type SlugId = string;
/** Markdown 字符串（受限子集：无 HTML；图片引用 `asset:<sha256>.<ext>`） */
export type Markdown = string;

export const BANK_ID_PATTERN = /^[a-z0-9.-]+\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
export const QUESTION_ID_PATTERN = /^q_[0-9A-HJKMNP-TV-Z]{26}$/;
export const KEY_POINT_ID_PATTERN = /^kp[1-9][0-9]{0,2}$/;
export const FOLLOWUP_ID_PATTERN = /^f[1-9][0-9]{0,2}$/;
export const SLUG_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const ASSET_REF_PATTERN = /^asset:[0-9a-f]{64}\.(png|jpe?g|webp)$/;

export type QuestionType = 'concept' | 'scenario' | 'coding' | 'design' | 'behavioral' | 'choice';
export type Difficulty = 'easy' | 'medium' | 'hard';
/** 1 = 一般，2 = 常见（默认），3 = 高频 / 核心 */
export type Importance = 1 | 2 | 3;
/** 要点权重：1 = 加分项（默认），2 = 重要，3 = 核心 */
export type KeyPointWeight = 1 | 2 | 3;

export interface BankMeta {
  id: BankId;
  name: string;
  /** SemVer；发布内容变化必须递增 */
  version: string;
  description?: string;
  /** BCP 47，默认 `zh-CN`；一库一语言 */
  locale?: string;
  /** SPDX 标识 */
  license?: string;
  homepage?: string;
  /** 内容纠错入口；`{questionId}` 占位符由 App 替换 */
  feedbackUrl?: string;
  update?: {
    /** latest.json 地址 */
    manifest: string;
    /** 备用地址（镜像，暂缓） */
    fallback?: string;
  };
}

export interface Category {
  id: SlugId;
  name: string;
  /** 升序；缺省 1000，同值按 id */
  order?: number;
  description?: string;
}

export interface Tag {
  id: SlugId;
  name: string;
  /** 父标签 id；不得成环 */
  parent: SlugId | null;
  order?: number;
}

/** 专题 / 学习路径：作者定义的有序题单 */
export interface Collection {
  id: SlugId;
  name: string;
  description?: string;
  questions: QuestionId[];
}

export interface Lifecycle {
  /** 已删除的题目 id（永不复用） */
  removed: QuestionId[];
  /** 旧题目 id → 并入的题目 id */
  merged: Record<QuestionId, QuestionId>;
}

export interface KeyPoint {
  id: KeyPointId;
  /** 纯文本，≤ 40 字 */
  text: string;
  weight: KeyPointWeight;
}

export interface Followup {
  id: FollowupId;
  /** 纯文本问题 */
  q: string;
  /** Markdown 答案，建议 ≤ 150 字 */
  a: Markdown;
}

export interface Answer {
  /** 一句话结论：纯文本，1–2 句，≤ 80 字 */
  summary: string;
  /** 3–5 条要点 */
  keyPoints: KeyPoint[];
  detail?: Markdown | null;
  examples?: Markdown | null;
  /** 易错点：纯文本列表 */
  pitfalls?: string[];
}

export interface ChoiceOption {
  /** `a`、`b`… */
  id: string;
  text: string;
}

export interface Choice {
  options: ChoiceOption[];
  /** 正确选项 id，可多选 */
  correct: string[];
  explanation?: Markdown | null;
}

export interface Source {
  name: string;
  license?: string;
  url?: string;
}

export interface Reference {
  title: string;
  url: string;
}

export interface Question {
  id: QuestionId;
  title: string;
  type: QuestionType;
  difficulty: Difficulty;
  importance: Importance;
  categoryId: SlugId;
  tags: SlugId[];
  /** 适用的技术版本，如 `Redis >= 6`；纯展示 */
  appliesTo?: string[];
  prerequisites?: QuestionId[];
  related?: QuestionId[];
  /** 标题之外的补充（场景、约束、给定代码）；无补充为 null */
  prompt: Markdown | null;
  answer: Answer;
  /** 仅 type = 'choice' 时非空 */
  choice: Choice | null;
  followups: Followup[];
  source?: Source;
  references?: Reference[];
  /** `YYYY-MM-DD` */
  reviewedAt?: string;
  estimatedMinutes?: number;
  /**
   * `sha256:<hex>`：该题规范化 JSON（不含本字段）的 SHA-256，规则见规范 §3.2。
   * 资源以 `asset:<sha256>.<ext>` 出现在 Markdown 字段中，因此图片变化也会改变它。
   */
  contentHash: string;
}

/** bundle.json */
export interface Bundle {
  schemaVersion: typeof BANK_SCHEMA_VERSION;
  bank: BankMeta;
  categories: Category[];
  tags: Tag[];
  collections: Collection[];
  lifecycle: Lifecycle;
  questions: Question[];
}

export interface ArtifactRef {
  url: string;
  mirrors?: string[];
  /** 小写十六进制 */
  sha256: string;
  size: number;
}

/** latest.json：检查更新只拉它 */
export interface Manifest {
  bankId: BankId;
  schemaVersion: typeof BANK_SCHEMA_VERSION;
  version: string;
  /** ISO-8601 UTC */
  publishedAt: string;
  /** App 低于该版本时提示先升级 App */
  minAppVersion?: string;
  bundle: ArtifactRef;
  /** 无资源时省略 */
  assets?: ArtifactRef;
  /** 题目 id → contentHash */
  questions: Record<QuestionId, string>;
  /** 本版更新说明（纯文本） */
  changes?: string;
}
