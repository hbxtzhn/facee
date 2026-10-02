import type {
  QuestionBankCatalog,
  QuestionContent,
} from './types';

export interface SchemaValidation {
  valid: boolean;
  issues: string[];
}

export class QuestionBankValidationError extends Error {
  readonly issues: string[];

  constructor(issues: readonly string[]) {
    super(`Invalid question bank: ${issues.join('; ')}`);
    this.name = 'QuestionBankValidationError';
    this.issues = [...issues];
  }
}

/** Return a boolean for simple callers that only need to gate an install. */
export function validateCatalog(value: unknown): boolean {
  return inspectCatalog(value).valid;
}

/** Return path-aware schema errors for importers and diagnostics. */
export function validateCatalogSchema(value: unknown): SchemaValidation {
  return inspectCatalog(value);
}

export function assertCatalog(value: unknown): asserts value is QuestionBankCatalog {
  const result = inspectCatalog(value);
  if (!result.valid) throw new QuestionBankValidationError(result.issues);
}

export function isQuestionBankCatalog(value: unknown): value is QuestionBankCatalog {
  return validateCatalog(value);
}

export function parseCatalog(value: unknown): QuestionBankCatalog {
  const parsed = typeof value === 'string' ? parseJson(value) : value;
  const result = inspectCatalog(parsed);
  if (!result.valid) throw new QuestionBankValidationError(result.issues);
  // 必须返回规范化后的对象：调用方（安装管线、缓存、屏幕）只需要认识一种形状。
  return normalizeCatalog(parsed) as QuestionBankCatalog;
}

/**
 * 题库规范 v1 与本地权威形态的差异映射。
 *
 * 本地权威形态（严格校验、UI 与仓库都基于它）：
 *   { schemaVersion, id, title, tags[{id,name,parentId,sort}],
 *     questions[{id,title,difficulty:1|2|3,hasAnswer,sort,tags[{id,name}]}] }
 *
 * 题库规范 v1（GitHub 题库仓库使用）：
 *   { schemaVersion, bank{id,name,version,updatedAt}, categories[{id,name,order}],
 *     tags[{id,name,parentId,order}],
 *     questions[{id,title,difficulty:'easy'|'medium'|'hard',categoryId,tags:['id'],order,hasAnswer?}] }
 *
 * 本函数把 v1 规范化为权威形态：这样安装管线、缓存与屏幕只需要认识一种形状，
 * 而题库作者可以只写 v1（分类、order、难度名、标签引用 id），旧题库也继续可用。
 */
export function normalizeCatalog(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const bank = isRecord(value.bank) ? value.bank : null;
  if (!bank) return value; // 已是旧形态

  const rawTags = Array.isArray(value.tags) ? value.tags : [];
  const nameById = new Map<string, string>();
  for (const tag of rawTags) {
    if (isRecord(tag) && typeof tag.id === 'string' && typeof tag.name === 'string') {
      nameById.set(tag.id, tag.name);
    }
  }

  const tags = rawTags.map((tag) => {
    if (!isRecord(tag)) return tag;
    return {
      id: tag.id,
      name: tag.name,
      parentId: tag.parentId ?? null,
      sort: toSortValue(tag.sort, tag.order),
    };
  });

  const categories = Array.isArray(value.categories)
    ? value.categories.map((category) => {
        if (!isRecord(category)) return category;
        return {
          id: category.id,
          name: category.name,
          sort: toSortValue(category.sort, category.order),
          ...(typeof category.description === 'string' ? { description: category.description } : {}),
        };
      })
    : undefined;

  const questions = Array.isArray(value.questions)
    ? value.questions.map((question) => {
        if (!isRecord(question)) return question;
        const rawRefs = Array.isArray(question.tags) ? question.tags : [];
        const refs = rawRefs.map((ref) => {
          if (typeof ref === 'string') {
            return { id: ref, name: nameById.get(ref) };
          }
          return ref;
        });
        return {
          id: question.id,
          title: question.title,
          difficulty: toDifficultyValue(question.difficulty),
          hasAnswer: typeof question.hasAnswer === 'boolean' ? question.hasAnswer : false,
          sort: toSortValue(question.sort, question.order),
          tags: refs,
          categoryId: question.categoryId ?? null,
          ...(typeof question.followupCount === 'number'
            ? { followupCount: question.followupCount }
            : {}),
        };
      })
    : value.questions;

  return {
    schemaVersion: value.schemaVersion,
    id: bank.id,
    title: bank.name,
    ...(typeof bank.version === 'string' ? { version: bank.version } : {}),
    ...(typeof bank.updatedAt === 'string' ? { updatedAt: bank.updatedAt } : {}),
    ...(categories ? { categories } : {}),
    tags,
    questions,
  };
}

function toSortValue(sort: unknown, order: unknown): unknown {
  if (typeof sort === 'number') return sort;
  if (typeof order === 'number') return order;
  return 1000;
}

function toDifficultyValue(value: unknown): unknown {
  if (value === 'easy') return 1;
  if (value === 'medium') return 2;
  if (value === 'hard') return 3;
  return value;
}

export function validateQuestionContent(value: unknown): boolean {
  return inspectQuestionContent(value).valid;
}

export function assertQuestionContent(value: unknown): asserts value is QuestionContent {
  const result = inspectQuestionContent(value);
  if (!result.valid) throw new QuestionBankValidationError(result.issues);
}

function inspectCatalog(value: unknown): SchemaValidation {
  const issues: string[] = [];
  if (!isRecord(value)) return invalid('catalog must be an object');

  // 先规范化两种题库格式，再用同一套严格规则校验。
  const normalized = normalizeCatalog(value);
  if (!isRecord(normalized)) return invalid('catalog must be an object');
  const catalog: Record<string, unknown> = normalized;

  if (catalog.schemaVersion !== 1) issues.push('schemaVersion must be 1');
  requireNonEmptyString(catalog.id, 'id', issues);
  requireNonEmptyString(catalog.title, 'title', issues);
  if (catalog.version !== undefined) requireNonEmptyString(catalog.version, 'version', issues);
  if (catalog.updatedAt !== undefined) requireNonEmptyString(catalog.updatedAt, 'updatedAt', issues);
  if (catalog.categories !== undefined) {
    if (!Array.isArray(catalog.categories)) issues.push('categories must be an array');
    else inspectCategories(catalog.categories, issues);
  }
  if (!Array.isArray(catalog.tags)) {
    issues.push('tags must be an array');
  } else {
    inspectTags(catalog.tags, issues);
  }
  if (!Array.isArray(catalog.questions)) {
    issues.push('questions must be an array');
  } else {
    inspectQuestions(catalog.questions, catalog.tags, catalog.categories, issues);
  }

  return { valid: issues.length === 0, issues };
}

function inspectCategories(value: unknown[], issues: string[]): void {
  const ids = new Set<string>();
  for (const [index, candidate] of value.entries()) {
    const path = `categories[${index}]`;
    if (!isRecord(candidate)) {
      issues.push(`${path} must be an object`);
      continue;
    }
    const id = requireId(candidate.id, `${path}.id`, issues);
    requireNonEmptyString(candidate.name, `${path}.name`, issues);
    requireInteger(candidate.sort, `${path}.sort`, issues);
    if (id && ids.has(id)) issues.push(`${path}.id is duplicated`);
    if (id) ids.add(id);
  }
}

function inspectTags(value: unknown[], issues: string[]): void {
  const ids = new Set<string>();
  for (const [index, candidate] of value.entries()) {
    const path = `tags[${index}]`;
    if (!isRecord(candidate)) {
      issues.push(`${path} must be an object`);
      continue;
    }
    const id = requireId(candidate.id, `${path}.id`, issues);
    requireNonEmptyString(candidate.name, `${path}.name`, issues);
    if (!isNullableId(candidate.parentId)) {
      issues.push(`${path}.parentId must be a valid id or null`);
    }
    requireInteger(candidate.sort, `${path}.sort`, issues);
    if (id && ids.has(id)) issues.push(`${path}.id is duplicated`);
    if (id) ids.add(id);
  }

  for (const [index, candidate] of value.entries()) {
    if (!isRecord(candidate) || candidate.parentId === null) continue;
    if (typeof candidate.parentId === 'string' && !ids.has(candidate.parentId)) {
      issues.push(`tags[${index}].parentId references an unknown tag`);
    }
  }

  // A parent cycle makes subtree filtering non-terminating. Validate it here.
  const parentById = new Map<string, string | null>();
  for (const candidate of value) {
    if (isRecord(candidate) && typeof candidate.id === 'string') {
      parentById.set(candidate.id, typeof candidate.parentId === 'string' ? candidate.parentId : null);
    }
  }
  for (const id of parentById.keys()) {
    const seen = new Set<string>();
    let current: string | null | undefined = id;
    while (current) {
      if (seen.has(current)) {
        issues.push(`tags contains a parent cycle at ${current}`);
        break;
      }
      seen.add(current);
      current = parentById.get(current);
    }
  }
}

function inspectQuestions(
  value: unknown[],
  rawTags: unknown,
  rawCategories: unknown,
  issues: string[],
): void {
  const ids = new Set<string>();
  const knownTagIds = new Set(
    Array.isArray(rawTags)
      ? rawTags.flatMap((tag) => (isRecord(tag) && typeof tag.id === 'string' ? [tag.id] : []))
      : [],
  );
  const knownCategoryIds = new Set(
    Array.isArray(rawCategories)
      ? rawCategories.flatMap((c) => (isRecord(c) && typeof c.id === 'string' ? [c.id] : []))
      : [],
  );

  for (const [index, candidate] of value.entries()) {
    const path = `questions[${index}]`;
    if (!isRecord(candidate)) {
      issues.push(`${path} must be an object`);
      continue;
    }
    const id = requireId(candidate.id, `${path}.id`, issues);
    requireNonEmptyString(candidate.title, `${path}.title`, issues);
    if (candidate.difficulty !== 1 && candidate.difficulty !== 2 && candidate.difficulty !== 3) {
      issues.push(`${path}.difficulty must be 1, 2, or 3`);
    }
    requireBoolean(candidate.hasAnswer, `${path}.hasAnswer`, issues);
    requireInteger(candidate.sort, `${path}.sort`, issues);
    if (!Array.isArray(candidate.tags)) {
      issues.push(`${path}.tags must be an array`);
    } else {
      inspectQuestionTagRefs(candidate.tags, path, knownTagIds, issues);
    }
    if (candidate.categoryId !== undefined && candidate.categoryId !== null) {
      if (typeof candidate.categoryId !== 'string') {
        issues.push(`${path}.categoryId must be a string or null`);
      } else if (Array.isArray(rawCategories) && !knownCategoryIds.has(candidate.categoryId)) {
        issues.push(`${path}.categoryId references an unknown category`);
      }
    }
    if (candidate.followupCount !== undefined) {
      requireInteger(candidate.followupCount, `${path}.followupCount`, issues);
    }
    if (id && ids.has(id)) issues.push(`${path}.id is duplicated`);
    if (id) ids.add(id);
  }
}

function inspectQuestionTagRefs(
  value: unknown[],
  questionPath: string,
  knownTagIds: Set<string>,
  issues: string[],
): void {
  const ids = new Set<string>();
  for (const [index, candidate] of value.entries()) {
    const path = `${questionPath}.tags[${index}]`;
    if (!isRecord(candidate)) {
      issues.push(`${path} must be an object`);
      continue;
    }
    const id = requireId(candidate.id, `${path}.id`, issues);
    requireNonEmptyString(candidate.name, `${path}.name`, issues);
    if (id && !knownTagIds.has(id)) issues.push(`${path}.id references an unknown tag`);
    if (id && ids.has(id)) issues.push(`${path}.id is duplicated`);
    if (id) ids.add(id);
  }
}

function inspectQuestionContent(value: unknown): SchemaValidation {
  const issues: string[] = [];
  if (!isRecord(value)) return invalid('content must be an object');
  requireId(value.id, 'id', issues);
  requireNonEmptyString(value.questionMd, 'questionMd', issues);
  if (value.answerMd !== null && typeof value.answerMd !== 'string') {
    issues.push('answerMd must be a string or null');
  }
  if (value.followupsMd !== undefined && value.followupsMd !== null && typeof value.followupsMd !== 'string') {
    issues.push('followupsMd must be a string or null when provided');
  }
  if (value.assetBaseUri !== undefined && typeof value.assetBaseUri !== 'string') {
    issues.push('assetBaseUri must be a string when provided');
  }
  return { valid: issues.length === 0, issues };
}

function requireId(value: unknown, path: string, issues: string[]): string | null {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) {
    issues.push(`${path} must be a safe non-empty id`);
    return null;
  }
  return value;
}

function isNullableId(value: unknown): boolean {
  return value === null || (typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value));
}

function requireNonEmptyString(value: unknown, path: string, issues: string[]): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    issues.push(`${path} must be a non-empty string`);
  }
}

function requireBoolean(value: unknown, path: string, issues: string[]): void {
  if (typeof value !== 'boolean') issues.push(`${path} must be a boolean`);
}

function requireInteger(value: unknown, path: string, issues: string[]): void {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    issues.push(`${path} must be an integer`);
  }
}

function invalid(issue: string): SchemaValidation {
  return { valid: false, issues: [issue] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new QuestionBankValidationError(['value is not valid JSON']);
  }
}
