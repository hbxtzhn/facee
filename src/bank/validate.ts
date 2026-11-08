import { BankError } from './errors';
import {
  ASSET_REF_PATTERN,
  BANK_ID_PATTERN,
  BANK_SCHEMA_VERSION,
  FOLLOWUP_ID_PATTERN,
  KEY_POINT_ID_PATTERN,
  QUESTION_ID_PATTERN,
  SLUG_ID_PATTERN,
  type Bundle,
  type Manifest,
} from './types';

/**
 * bundle.json / latest.json 的运行时校验（src/bank/types.ts 的契约）。
 *
 * - 未知字段一律忽略（不报错、不删除）；
 * - schemaVersion ≠ 2 直接拒绝，其余检查不再进行；
 * - 收集全部问题再返回，每条带具体路径，如 `questions[3].answer.keyPoints`；
 * - 本地自建题库与远程题库共用同一套规则（要点 3–5 条等不放宽）。
 *
 * 不在 App 端重复的作者规范：文本长度上限、代码块语言、Markdown 不含 HTML 等由构建工具负责；
 * contentHash 只校验格式，不重算（构建工具的规范化细节以其实现为准）。
 */

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
export const CONTENT_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CHOICE_OPTION_ID_PATTERN = /^[a-z]{1,2}$/;
const QUESTION_TYPES = ['concept', 'scenario', 'coding', 'design', 'behavioral', 'choice'];
const DIFFICULTIES = ['easy', 'medium', 'hard'];
const MARKDOWN_ASSET_PATTERN = /\]\((asset:[^)\s]*)\)/g;
const MAX_ERRORS = 50;

type Rec = Record<string, unknown>;

function isRecord(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class Collector {
  readonly errors: string[] = [];
  add(path: string, message: string): void {
    if (this.errors.length < MAX_ERRORS) this.errors.push(`${path}：${message}`);
  }
  get full(): boolean {
    return this.errors.length >= MAX_ERRORS;
  }
}

function schemaVersionError(value: unknown): string | null {
  if (value === BANK_SCHEMA_VERSION) return null;
  if (typeof value === 'number' && value > BANK_SCHEMA_VERSION) {
    return `题库格式版本 ${value} 高于当前 App 支持的版本 ${BANK_SCHEMA_VERSION}，请先升级 FaceE App 再安装`;
  }
  return `不支持的题库格式版本 ${JSON.stringify(value ?? null)}：当前 App 只支持 schemaVersion ${BANK_SCHEMA_VERSION}（v1 题库已停用，请使用 v2 题库）`;
}

function requireString(c: Collector, value: unknown, path: string, options: { pattern?: RegExp; optional?: boolean } = {}): boolean {
  if (value === undefined && options.optional) return true;
  if (typeof value !== 'string' || value.trim() === '') {
    c.add(path, options.optional ? '应为非空字符串或省略' : '必填，应为非空字符串');
    return false;
  }
  if (options.pattern && !options.pattern.test(value)) {
    c.add(path, `格式不正确：${JSON.stringify(value)}`);
    return false;
  }
  return true;
}

function optionalNullableString(c: Collector, value: unknown, path: string): void {
  if (value === undefined || value === null) return;
  if (typeof value !== 'string') c.add(path, '应为字符串、null 或省略');
}

function requireEnum(c: Collector, value: unknown, path: string, allowed: readonly unknown[]): void {
  if (!allowed.includes(value)) c.add(path, `取值应为 ${allowed.map((v) => JSON.stringify(v)).join(' / ')}，实际 ${JSON.stringify(value ?? null)}`);
}

function requireArray(c: Collector, value: unknown, path: string, optional = false): unknown[] {
  if (value === undefined && optional) return [];
  if (!Array.isArray(value)) {
    c.add(path, optional ? '应为数组或省略' : '必填，应为数组');
    return [];
  }
  return value;
}

function checkAssetRefs(c: Collector, markdown: unknown, path: string): void {
  if (typeof markdown !== 'string') return;
  for (const match of markdown.matchAll(MARKDOWN_ASSET_PATTERN)) {
    if (!ASSET_REF_PATTERN.test(match[1])) c.add(path, `资源引用格式不正确：${match[1]}`);
  }
}

function validateBankMeta(c: Collector, bank: unknown): void {
  if (!isRecord(bank)) {
    c.add('bank', '必填，应为对象');
    return;
  }
  requireString(c, bank.id, 'bank.id', { pattern: BANK_ID_PATTERN });
  requireString(c, bank.name, 'bank.name');
  requireString(c, bank.version, 'bank.version', { pattern: SEMVER_PATTERN });
  for (const key of ['description', 'locale', 'license', 'homepage', 'feedbackUrl'] as const) {
    if (bank[key] !== undefined && typeof bank[key] !== 'string') c.add(`bank.${key}`, '应为字符串或省略');
  }
  if (bank.update !== undefined) {
    if (!isRecord(bank.update)) c.add('bank.update', '应为对象或省略');
    else {
      requireString(c, bank.update.manifest, 'bank.update.manifest');
      if (bank.update.fallback !== undefined && typeof bank.update.fallback !== 'string') {
        c.add('bank.update.fallback', '应为字符串或省略');
      }
    }
  }
}

function validateOrder(c: Collector, value: unknown, path: string): void {
  if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) c.add(path, '应为数字或省略');
}

function checkUnique(c: Collector, ids: unknown[], path: string, label: string): Set<string> {
  const seen = new Set<string>();
  ids.forEach((id, index) => {
    if (typeof id !== 'string') return;
    if (seen.has(id)) c.add(`${path}[${index}].id`, `${label} id 重复：${id}`);
    seen.add(id);
  });
  return seen;
}

function validateQuestion(c: Collector, raw: unknown, path: string, refs: {
  categoryIds: Set<string>;
  tagIds: Set<string>;
  questionIds: Set<string>;
}): void {
  if (!isRecord(raw)) {
    c.add(path, '应为对象');
    return;
  }
  requireString(c, raw.id, `${path}.id`, { pattern: QUESTION_ID_PATTERN });
  requireString(c, raw.title, `${path}.title`);
  requireEnum(c, raw.type, `${path}.type`, QUESTION_TYPES);
  requireEnum(c, raw.difficulty, `${path}.difficulty`, DIFFICULTIES);
  requireEnum(c, raw.importance, `${path}.importance`, [1, 2, 3]);
  if (requireString(c, raw.categoryId, `${path}.categoryId`, { pattern: SLUG_ID_PATTERN }) && !refs.categoryIds.has(raw.categoryId as string)) {
    c.add(`${path}.categoryId`, `引用了不存在的分类 ${raw.categoryId}`);
  }
  const tags = requireArray(c, raw.tags, `${path}.tags`);
  const seenTags = new Set<string>();
  tags.forEach((tag, index) => {
    if (typeof tag !== 'string' || !SLUG_ID_PATTERN.test(tag)) c.add(`${path}.tags[${index}]`, '标签 id 格式不正确');
    else if (!refs.tagIds.has(tag)) c.add(`${path}.tags[${index}]`, `引用了不存在的标签 ${tag}`);
    else if (seenTags.has(tag)) c.add(`${path}.tags[${index}]`, `标签重复 ${tag}`);
    else seenTags.add(tag);
  });
  requireArray(c, raw.appliesTo, `${path}.appliesTo`, true).forEach((item, index) => {
    if (typeof item !== 'string') c.add(`${path}.appliesTo[${index}]`, '应为字符串');
  });
  for (const key of ['prerequisites', 'related'] as const) {
    requireArray(c, raw[key], `${path}.${key}`, true).forEach((id, index) => {
      if (typeof id !== 'string' || !QUESTION_ID_PATTERN.test(id)) c.add(`${path}.${key}[${index}]`, '题目 id 格式不正确');
      else if (!refs.questionIds.has(id)) c.add(`${path}.${key}[${index}]`, `引用了不存在的题目 ${id}`);
      else if (id === raw.id) c.add(`${path}.${key}[${index}]`, '不能引用自身');
    });
  }
  optionalNullableString(c, raw.prompt, `${path}.prompt`);
  if (raw.prompt === undefined) c.add(`${path}.prompt`, '必填，无补充时为 null');
  checkAssetRefs(c, raw.prompt, `${path}.prompt`);

  // answer
  const answer = raw.answer;
  if (!isRecord(answer)) {
    c.add(`${path}.answer`, '必填，应为对象');
  } else {
    requireString(c, answer.summary, `${path}.answer.summary`);
    const keyPoints = requireArray(c, answer.keyPoints, `${path}.answer.keyPoints`);
    if (Array.isArray(answer.keyPoints) && (keyPoints.length < 3 || keyPoints.length > 5)) {
      c.add(`${path}.answer.keyPoints`, `要点应为 3–5 条，实际 ${keyPoints.length} 条`);
    }
    const kpIds = new Set<string>();
    keyPoints.forEach((kp, index) => {
      const kpPath = `${path}.answer.keyPoints[${index}]`;
      if (!isRecord(kp)) {
        c.add(kpPath, '应为对象');
        return;
      }
      if (requireString(c, kp.id, `${kpPath}.id`, { pattern: KEY_POINT_ID_PATTERN })) {
        if (kpIds.has(kp.id as string)) c.add(`${kpPath}.id`, `要点 id 重复：${kp.id}`);
        kpIds.add(kp.id as string);
      }
      requireString(c, kp.text, `${kpPath}.text`);
      requireEnum(c, kp.weight, `${kpPath}.weight`, [1, 2, 3]);
    });
    optionalNullableString(c, answer.detail, `${path}.answer.detail`);
    optionalNullableString(c, answer.examples, `${path}.answer.examples`);
    checkAssetRefs(c, answer.detail, `${path}.answer.detail`);
    checkAssetRefs(c, answer.examples, `${path}.answer.examples`);
    requireArray(c, answer.pitfalls, `${path}.answer.pitfalls`, true).forEach((item, index) => {
      if (typeof item !== 'string') c.add(`${path}.answer.pitfalls[${index}]`, '应为字符串');
    });
  }

  // choice
  if (raw.type === 'choice') {
    const choice = raw.choice;
    if (!isRecord(choice)) c.add(`${path}.choice`, '选择题必须提供 choice');
    else {
      const options = requireArray(c, choice.options, `${path}.choice.options`);
      if (Array.isArray(choice.options) && options.length < 2) c.add(`${path}.choice.options`, '至少 2 个选项');
      const optionIds = new Set<string>();
      options.forEach((option, index) => {
        const optionPath = `${path}.choice.options[${index}]`;
        if (!isRecord(option)) {
          c.add(optionPath, '应为对象');
          return;
        }
        if (requireString(c, option.id, `${optionPath}.id`, { pattern: CHOICE_OPTION_ID_PATTERN })) {
          if (optionIds.has(option.id as string)) c.add(`${optionPath}.id`, `选项 id 重复：${option.id}`);
          optionIds.add(option.id as string);
        }
        requireString(c, option.text, `${optionPath}.text`);
      });
      const correct = requireArray(c, choice.correct, `${path}.choice.correct`);
      if (Array.isArray(choice.correct) && correct.length === 0) c.add(`${path}.choice.correct`, '至少 1 个正确选项');
      correct.forEach((id, index) => {
        if (typeof id !== 'string' || !optionIds.has(id)) c.add(`${path}.choice.correct[${index}]`, `不是有效选项：${JSON.stringify(id)}`);
      });
      optionalNullableString(c, choice.explanation, `${path}.choice.explanation`);
      checkAssetRefs(c, choice.explanation, `${path}.choice.explanation`);
    }
  } else if (raw.choice !== null) {
    c.add(`${path}.choice`, '非选择题的 choice 必须为 null');
  }

  // followups
  const followupIds = new Set<string>();
  requireArray(c, raw.followups, `${path}.followups`).forEach((followup, index) => {
    const fPath = `${path}.followups[${index}]`;
    if (!isRecord(followup)) {
      c.add(fPath, '应为对象');
      return;
    }
    if (requireString(c, followup.id, `${fPath}.id`, { pattern: FOLLOWUP_ID_PATTERN })) {
      if (followupIds.has(followup.id as string)) c.add(`${fPath}.id`, `追问 id 重复：${followup.id}`);
      followupIds.add(followup.id as string);
    }
    requireString(c, followup.q, `${fPath}.q`);
    requireString(c, followup.a, `${fPath}.a`);
    checkAssetRefs(c, followup.a, `${fPath}.a`);
  });

  if (raw.source !== undefined) {
    if (!isRecord(raw.source)) c.add(`${path}.source`, '应为对象或省略');
    else requireString(c, raw.source.name, `${path}.source.name`);
  }
  requireArray(c, raw.references, `${path}.references`, true).forEach((ref, index) => {
    if (!isRecord(ref)) c.add(`${path}.references[${index}]`, '应为对象');
    else {
      requireString(c, ref.title, `${path}.references[${index}].title`);
      requireString(c, ref.url, `${path}.references[${index}].url`);
    }
  });
  if (raw.reviewedAt !== undefined) requireString(c, raw.reviewedAt, `${path}.reviewedAt`, { pattern: DATE_PATTERN });
  if (raw.estimatedMinutes !== undefined && (typeof raw.estimatedMinutes !== 'number' || !(raw.estimatedMinutes > 0))) {
    c.add(`${path}.estimatedMinutes`, '应为正数或省略');
  }
  requireString(c, raw.contentHash, `${path}.contentHash`, { pattern: CONTENT_HASH_PATTERN });
}

function findCycle(edges: Map<string, string[]>): string[] | null {
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (node: string): string[] | null => {
    const mark = state.get(node);
    if (mark === 2) return null;
    if (mark === 1) return [...stack.slice(stack.indexOf(node)), node];
    state.set(node, 1);
    stack.push(node);
    for (const next of edges.get(node) ?? []) {
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(node, 2);
    return null;
  };
  for (const node of edges.keys()) {
    const cycle = visit(node);
    if (cycle) return cycle;
  }
  return null;
}

/** 校验 bundle.json（已 JSON.parse 的值） */
export function validateBundle(input: unknown): ValidationResult<Bundle> {
  if (!isRecord(input)) return { ok: false, errors: ['(根)：bundle 应为 JSON 对象'] };
  const versionError = schemaVersionError(input.schemaVersion);
  if (versionError) return { ok: false, errors: [`schemaVersion：${versionError}`] };

  const c = new Collector();
  validateBankMeta(c, input.bank);

  const categories = requireArray(c, input.categories, 'categories');
  categories.forEach((category, index) => {
    const path = `categories[${index}]`;
    if (!isRecord(category)) return c.add(path, '应为对象');
    requireString(c, category.id, `${path}.id`, { pattern: SLUG_ID_PATTERN });
    requireString(c, category.name, `${path}.name`);
    validateOrder(c, category.order, `${path}.order`);
    if (category.description !== undefined && typeof category.description !== 'string') c.add(`${path}.description`, '应为字符串或省略');
  });
  const categoryIds = checkUnique(c, categories.map((x) => (isRecord(x) ? x.id : undefined)), 'categories', '分类');

  const tags = requireArray(c, input.tags, 'tags');
  tags.forEach((tag, index) => {
    const path = `tags[${index}]`;
    if (!isRecord(tag)) return c.add(path, '应为对象');
    requireString(c, tag.id, `${path}.id`, { pattern: SLUG_ID_PATTERN });
    requireString(c, tag.name, `${path}.name`);
    validateOrder(c, tag.order, `${path}.order`);
    if (tag.parent === undefined) c.add(`${path}.parent`, '必填，无父标签时为 null');
    if (tag.description !== undefined && typeof tag.description !== 'string') c.add(`${path}.description`, '应为字符串或省略');
    if (tag.aliases !== undefined && (!Array.isArray(tag.aliases) || tag.aliases.some((a) => typeof a !== 'string'))) {
      c.add(`${path}.aliases`, '应为字符串数组或省略');
    }
  });
  const tagIds = checkUnique(c, tags.map((x) => (isRecord(x) ? x.id : undefined)), 'tags', '标签');
  const tagEdges = new Map<string, string[]>();
  tags.forEach((tag, index) => {
    if (!isRecord(tag) || tag.parent === null || tag.parent === undefined) return;
    if (typeof tag.parent !== 'string' || !tagIds.has(tag.parent)) {
      c.add(`tags[${index}].parent`, `引用了不存在的父标签 ${JSON.stringify(tag.parent)}`);
    } else if (typeof tag.id === 'string') {
      tagEdges.set(tag.id, [tag.parent]);
    }
  });
  const tagCycle = findCycle(tagEdges);
  if (tagCycle) c.add('tags', `父子关系成环：${tagCycle.join(' → ')}`);

  const questions = requireArray(c, input.questions, 'questions');
  const questionIds = checkUnique(c, questions.map((x) => (isRecord(x) ? x.id : undefined)), 'questions', '题目');
  questions.forEach((question, index) => {
    if (!c.full) validateQuestion(c, question, `questions[${index}]`, { categoryIds, tagIds, questionIds });
  });
  const prereqEdges = new Map<string, string[]>();
  for (const question of questions) {
    if (isRecord(question) && typeof question.id === 'string' && Array.isArray(question.prerequisites)) {
      prereqEdges.set(question.id, question.prerequisites.filter((id): id is string => typeof id === 'string' && questionIds.has(id)));
    }
  }
  const prereqCycle = findCycle(prereqEdges);
  if (prereqCycle) c.add('questions', `prerequisites 成环：${prereqCycle.join(' → ')}`);

  const collections = requireArray(c, input.collections, 'collections');
  collections.forEach((collection, index) => {
    const path = `collections[${index}]`;
    if (!isRecord(collection)) return c.add(path, '应为对象');
    requireString(c, collection.id, `${path}.id`, { pattern: SLUG_ID_PATTERN });
    requireString(c, collection.name, `${path}.name`);
    requireArray(c, collection.questions, `${path}.questions`).forEach((id, qIndex) => {
      if (typeof id !== 'string' || !questionIds.has(id)) c.add(`${path}.questions[${qIndex}]`, `引用了不存在的题目 ${JSON.stringify(id)}`);
    });
  });
  checkUnique(c, collections.map((x) => (isRecord(x) ? x.id : undefined)), 'collections', '专题');

  const lifecycle = input.lifecycle;
  if (!isRecord(lifecycle)) c.add('lifecycle', '必填，应为对象');
  else {
    const removed = requireArray(c, lifecycle.removed, 'lifecycle.removed');
    removed.forEach((id, index) => {
      if (typeof id !== 'string' || !QUESTION_ID_PATTERN.test(id)) c.add(`lifecycle.removed[${index}]`, '题目 id 格式不正确');
      else if (questionIds.has(id)) c.add(`lifecycle.removed[${index}]`, `已删除的题目仍在 questions 中：${id}`);
    });
    if (!isRecord(lifecycle.merged)) c.add('lifecycle.merged', '必填，应为对象');
    else {
      const merged = lifecycle.merged;
      for (const [from, to] of Object.entries(merged)) {
        const path = `lifecycle.merged.${from}`;
        if (!QUESTION_ID_PATTERN.test(from)) c.add(path, '题目 id 格式不正确');
        else if (questionIds.has(from)) c.add(path, `已合并的旧题仍在 questions 中：${from}`);
        if (typeof to !== 'string' || !QUESTION_ID_PATTERN.test(to)) {
          c.add(path, '目标题目 id 格式不正确');
          continue;
        }
        // 允许链式合并（a → b，b → c），但最终必须落到现存题目
        let target: string = to;
        const seen = new Set<string>([from]);
        while (!questionIds.has(target) && typeof merged[target] === 'string' && !seen.has(target)) {
          seen.add(target);
          target = merged[target] as string;
        }
        if (!questionIds.has(target)) c.add(path, `合并目标不存在：${to}`);
      }
    }
  }

  return c.errors.length > 0 ? { ok: false, errors: c.errors } : { ok: true, value: input as unknown as Bundle };
}

function validateArtifact(c: Collector, value: unknown, path: string): void {
  if (!isRecord(value)) {
    c.add(path, '必填，应为对象');
    return;
  }
  requireString(c, value.url, `${path}.url`);
  requireString(c, value.sha256, `${path}.sha256`, { pattern: SHA256_PATTERN });
  if (typeof value.size !== 'number' || !Number.isInteger(value.size) || value.size <= 0) c.add(`${path}.size`, '应为正整数');
  requireArray(c, value.mirrors, `${path}.mirrors`, true).forEach((url, index) => {
    if (typeof url !== 'string' || !url) c.add(`${path}.mirrors[${index}]`, '应为非空字符串');
  });
}

/** 校验 latest.json（已 JSON.parse 的值） */
export function validateManifest(input: unknown): ValidationResult<Manifest> {
  if (!isRecord(input)) return { ok: false, errors: ['(根)：latest.json 应为 JSON 对象'] };
  const versionError = schemaVersionError(input.schemaVersion);
  if (versionError) return { ok: false, errors: [`schemaVersion：${versionError}`] };
  const c = new Collector();
  requireString(c, input.bankId, 'bankId', { pattern: BANK_ID_PATTERN });
  requireString(c, input.version, 'version', { pattern: SEMVER_PATTERN });
  requireString(c, input.publishedAt, 'publishedAt');
  if (input.minAppVersion !== undefined) requireString(c, input.minAppVersion, 'minAppVersion', { pattern: SEMVER_PATTERN });
  validateArtifact(c, input.bundle, 'bundle');
  if (input.assets !== undefined) validateArtifact(c, input.assets, 'assets');
  if (!isRecord(input.questions)) c.add('questions', '必填，应为「题目 id → contentHash」对象');
  else {
    for (const [id, hash] of Object.entries(input.questions)) {
      if (!QUESTION_ID_PATTERN.test(id)) c.add(`questions.${id}`, '题目 id 格式不正确');
      if (typeof hash !== 'string' || !CONTENT_HASH_PATTERN.test(hash)) c.add(`questions.${id}`, 'contentHash 格式不正确');
    }
  }
  if (input.changes !== undefined && typeof input.changes !== 'string') c.add('changes', '应为字符串或省略');
  return c.errors.length > 0 ? { ok: false, errors: c.errors } : { ok: true, value: input as unknown as Manifest };
}

/** 把校验结果转成 BankError（schemaVersion 问题单独用 schema-version 码） */
export function validationError(label: string, errors: string[]): BankError {
  const schema = errors.length === 1 && errors[0].startsWith('schemaVersion：');
  if (schema) return new BankError('schema-version', errors[0].slice('schemaVersion：'.length), errors);
  const head = errors.slice(0, 3).join('；');
  const more = errors.length > 3 ? `（另有 ${errors.length - 3} 处）` : '';
  return new BankError('invalid', `${label}不符合规范：${head}${more}`, errors);
}

export function assertValidBundle(input: unknown): Bundle {
  const result = validateBundle(input);
  if (!result.ok) throw validationError('题库数据', result.errors);
  return result.value;
}

export function assertValidManifest(input: unknown): Manifest {
  const result = validateManifest(input);
  if (!result.ok) throw validationError('更新清单', result.errors);
  return result.value;
}

/** SemVer 比较（忽略 build 元数据；预发布版低于正式版） */
export function compareSemver(a: string, b: string): number {
  const parse = (value: string) => {
    const [core, pre] = value.split('+')[0].split(/-(.*)/s);
    return { nums: core.split('.').map((n) => Number.parseInt(n, 10) || 0), pre: pre ?? '' };
  };
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < 3; i += 1) {
    const diff = (left.nums[i] ?? 0) - (right.nums[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  if (left.pre === right.pre) return 0;
  if (!left.pre) return 1;
  if (!right.pre) return -1;
  return left.pre < right.pre ? -1 : 1;
}
