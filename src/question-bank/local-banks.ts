import * as FileSystem from 'expo-file-system/legacy';
import type {
  LocalBankSource,
  Question,
  QuestionBankPackage,
} from './types';
import { QUESTION_BANK_ROOT_NAME } from './file-repository';

/** 类型定义随题库包模型放在 types.ts，这里转出口维持既有导入路径 */
export type { LocalBankSource };

/**
 * 本地题库源管理。
 *
 * 源真值是可编辑的 QuestionBankPackage JSON，存放在
 * `<documents>/facee-question-bank/local-sources/<bankId>.json`；安装物
 * （banks/ 下的 namespace）由「保存 → repository.install()」整体重建——
 * 原子、缓存安全，复用全部既有校验。编辑永远只改源文件。
 *
 * 约定：本地题库 catalog.id 以 `local-` 前缀开头（file-repository 据此
 * 在 listBanks 里标注来源）；新建本地题库使用分类 `local`（我的题目），复制库保留原分类，
 * 标签按需增删。id 一律由名称哈希生成（规范要求 [a-z0-9][a-z0-9._-]*）。
 */

/** 与 file-repository 共享的文件系统注入点（测试用内存桩替换） */
export type LocalBankFileSystem = typeof FileSystem;
export type QuestionDraft = {
  /** 编辑既有题目时传入；新建不传由标题生成 */
  id?: string;
  title: string;
  /** 1 简单 / 2 中等 / 3 困难 */
  difficulty: 1 | 2 | 3;
  /** 标签名列表（展示名，如「JVM」）；id 由名称哈希生成并自动去重 */
  tags: string[];
  questionMd: string;
  /** 空/纯空白视为无答案（hasAnswer: false） */
  answerMd: string | null;
};

export interface LocalBankSourceSummary {
  bankId: string;
  title: string;
  questionCount: number;
  updatedAt: string;
}

const DEFAULT_CATEGORY_ID = 'local';
const DEFAULT_CATEGORY_NAME = '我的题目';
const MAX_BANK_ID_ATTEMPTS = 8;

function defaultFs(): LocalBankFileSystem {
  return FileSystem;
}

export function localSourcesRoot(fs: LocalBankFileSystem = defaultFs()): string {
  const documentDirectory = fs.documentDirectory;
  if (!documentDirectory) throw new Error('本机文档目录不可用');
  return `${documentDirectory}${QUESTION_BANK_ROOT_NAME}local-sources/`;
}

function sourcePath(bankId: string, fs: LocalBankFileSystem): string {
  assertLocalBankId(bankId);
  return `${localSourcesRoot(fs)}${bankId}.json`;
}

export function isLocalBankId(bankId: string): boolean {
  return bankId.startsWith('local-') && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(bankId);
}

function assertLocalBankId(bankId: string): string {
  if (!isLocalBankId(bankId)) throw new Error(`非法的本地题库 id：${bankId}`);
  return bankId;
}

/** 稳定字符串哈希（djb2 变体），用于从名称生成符合规范的 id */
export function hashName(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

/** 新建本地题库的 id：local- + 时间戳/随机（小写，符合题库 id 规范） */
export function newLocalBankId(): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `local-${Date.now().toString(36)}${random}`.slice(0, 40);
}

/** 题目 id：q-<标题哈希>；与既有题冲突时追加序号 */
export function questionIdFromTitle(title: string, existingIds: ReadonlySet<string>): string {
  const base = `q-${hashName(title.trim())}`;
  if (!existingIds.has(base)) return base;
  for (let attempt = 1; attempt <= MAX_BANK_ID_ATTEMPTS; attempt += 1) {
    const candidate = `${base}-${attempt}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/** 标签 id：tag-<名称哈希>；同名标签稳定复用同一 id */
export function tagIdFromName(name: string): string {
  return `tag-${hashName(name.trim())}`;
}

/** 新建一个最小合法的空本地题库包（通过 validateDecodedPackage 校验） */
export function createLocalBankPackage(title: string): QuestionBankPackage {
  const trimmed = title.trim();
  return {
    catalog: {
      schemaVersion: 1,
      id: newLocalBankId(),
      title: trimmed.length > 0 ? trimmed : '我的题库',
      categories: [{ id: DEFAULT_CATEGORY_ID, name: DEFAULT_CATEGORY_NAME, sort: 10 }],
      tags: [],
      questions: [],
    },
    contents: [],
  };
}

/**
 * 新增或更新一道题（纯函数，返回新包）。
 * 新题 id 由标题哈希生成；标签 upsert 进 catalog.tags，新题补齐默认分类。
 * 编辑既有题时保留 categoryId 与内容扩展字段（followupsMd/assetBaseUri）——
 * 表单不覆盖它们，覆盖等于静默丢数据（追问、图片资源）。
 */
export function upsertQuestion(
  bank: QuestionBankPackage,
  draft: QuestionDraft,
): QuestionBankPackage {
  const title = draft.title.trim();
  if (!title) throw new Error('题目标题不能为空');
  const questionMd = draft.questionMd.trim();
  if (!questionMd) throw new Error('题干不能为空');
  const answerMd = draft.answerMd !== null && draft.answerMd.trim().length > 0 ? draft.answerMd : null;
  const tagNames = [...new Set(draft.tags.map((name) => name.trim()).filter((name) => name.length > 0))];

  // 标签 upsert：同名标签复用既有 id
  const tags = bank.catalog.tags.map((tag) => ({ ...tag }));
  const questionTags = tagNames.map((name) => {
    const existing = tags.find((tag) => tag.name === name);
    if (existing) return { id: existing.id, name };
    const created = { id: tagIdFromName(name), name, parentId: null, sort: 1000 };
    tags.push(created);
    return { id: created.id, name };
  });

  const existingIds = new Set(bank.catalog.questions.map((question) => question.id));
  const id = draft.id ?? questionIdFromTitle(title, existingIds);
  if (draft.id && !existingIds.has(draft.id)) throw new Error(`要编辑的题目不存在：${draft.id}`);
  const existingQuestion = draft.id ? bank.catalog.questions.find((question) => question.id === id) : undefined;
  const existingContent = draft.id ? bank.contents.find((content) => content.id === id) : undefined;
  const maxSort = bank.catalog.questions.reduce((max, question) => Math.max(max, question.sort), 0);
  // 复制/备份恢复库可能只有原分类；新题引用 local 前必须注册，不能修改源包。
  // 编辑既有题不补分类，保留原分类定义及无分类状态。
  const categories = !existingQuestion && !bank.catalog.categories?.some((category) => category.id === DEFAULT_CATEGORY_ID)
    ? [...(bank.catalog.categories ?? []), { id: DEFAULT_CATEGORY_ID, name: DEFAULT_CATEGORY_NAME, sort: 10 }]
    : bank.catalog.categories;

  const question: Question = {
    id,
    title,
    difficulty: draft.difficulty,
    hasAnswer: answerMd !== null,
    sort: existingQuestion?.sort ?? maxSort + 10,
    tags: questionTags,
    // 编辑保留原分类（复制题库的题目分类各不相同），新题归入默认分类
    categoryId: existingQuestion ? existingQuestion.categoryId ?? null : DEFAULT_CATEGORY_ID,
  };
  const content = existingContent
    ? { ...existingContent, id, questionMd, answerMd }
    : { id, questionMd, answerMd };

  const questions = draft.id
    ? bank.catalog.questions.map((existing) => (existing.id === id ? question : existing))
    : [...bank.catalog.questions, question];
  const contents = draft.id
    ? bank.contents.map((existing) => (existing.id === id ? content : existing))
    : [...bank.contents, content];

  return {
    catalog: { ...bank.catalog, categories, tags, questions },
    contents,
  };
}

/** 删除一道题（元数据 + 内容），纯函数返回新包 */
export function removeQuestion(bank: QuestionBankPackage, id: string): QuestionBankPackage {
  return {
    catalog: { ...bank.catalog, questions: bank.catalog.questions.filter((question) => question.id !== id) },
    contents: bank.contents.filter((content) => content.id !== id),
  };
}

/** 复制题库的标题规则：X → X（副本）→ X（副本2）→ X（副本3）… */
export function copiedBankTitle(title: string): string {
  const match = /^(.*)（副本(\d*)）$/.exec(title.trim());
  if (match) {
    const current = match[2] ? Number.parseInt(match[2], 10) : 1;
    return `${match[1]}（副本${current + 1}）`;
  }
  return `${title.trim()}（副本）`;
}

/**
 * 把已装题库包（repository.exportPackage 的产物）转为新的本地题库源。
 * 题目/标签/分类/题目 id 全部原样保留（收藏按题目 id 记录，自动跟随；
 * 掌握度按题库 id 命名空间，副本从零计）。assetBaseUri 不带走——它指向
 * 源库命名空间，副本安装后由 getContent 按激活命名空间重新解析。
 * 只做内存转换，落盘由调用方 saveLocalBankSource 完成。
 */
export function copyBankAsLocal(source: QuestionBankPackage): LocalBankSource {
  const bankId = newLocalBankId();
  return {
    bankId,
    updatedAt: '',
    package: {
      catalog: {
        ...source.catalog,
        id: bankId,
        title: copiedBankTitle(source.catalog.title),
      },
      contents: source.contents.map((content) => ({
        id: content.id,
        questionMd: content.questionMd,
        answerMd: content.answerMd,
        followupsMd: content.followupsMd ?? null,
      })),
    },
  };
}

/** 列出全部本地题库源（按更新时间倒序） */
export async function listLocalBankSources(
  fs: LocalBankFileSystem = defaultFs(),
): Promise<LocalBankSourceSummary[]> {
  let entries: string[];
  try {
    entries = await fs.readDirectoryAsync(localSourcesRoot(fs));
  } catch {
    return [];
  }
  const summaries: LocalBankSourceSummary[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const bankId = entry.slice(0, -'.json'.length);
    if (!isLocalBankId(bankId)) continue;
    const source = await loadLocalBankSource(bankId, fs);
    if (source) {
      summaries.push({
        bankId,
        title: source.package.catalog.title,
        questionCount: source.package.catalog.questions.length,
        updatedAt: source.updatedAt,
      });
    }
  }
  return summaries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function loadLocalBankSource(
  bankId: string,
  fs: LocalBankFileSystem = defaultFs(),
): Promise<LocalBankSource | null> {
  try {
    const raw = await fs.readAsStringAsync(sourcePath(bankId, fs), { encoding: 'utf8' });
    const parsed = parseLocalBankSource(raw);
    if (!parsed || parsed.bankId !== bankId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveLocalBankSource(
  source: LocalBankSource,
  fs: LocalBankFileSystem = defaultFs(),
): Promise<void> {
  assertLocalBankId(source.bankId);
  if (source.package.catalog.id !== source.bankId) {
    throw new Error('本地题库 id 与 catalog.id 不一致');
  }
  const persisted: LocalBankSource = { ...source, updatedAt: new Date().toISOString() };
  await fs.makeDirectoryAsync(localSourcesRoot(fs), { intermediates: true });
  await fs.writeAsStringAsync(sourcePath(source.bankId, fs), JSON.stringify(persisted), {
    encoding: 'utf8',
  });
}

export async function deleteLocalBankSource(
  bankId: string,
  fs: LocalBankFileSystem = defaultFs(),
): Promise<void> {
  assertLocalBankId(bankId);
  try {
    await fs.deleteAsync(sourcePath(bankId, fs), { idempotent: true });
  } catch {
    // 源文件删除失败不阻塞：题库本体仍会被 repository.deleteBank 移除
  }
}

/** 解析并校验本地题库源 JSON（备份导入复用）；无效返回 null */
export function parseLocalBankSource(raw: string): LocalBankSource | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const bankPackage = record.package as Record<string, unknown> | undefined;
  const catalog = bankPackage?.catalog as Record<string, unknown> | undefined;
  if (
    typeof record.bankId !== 'string' ||
    !isLocalBankId(record.bankId) ||
    !bankPackage ||
    !catalog ||
    catalog.id !== record.bankId ||
    !Array.isArray(bankPackage.contents)
  ) {
    return null;
  }
  return {
    bankId: record.bankId,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : '',
    package: bankPackage as unknown as QuestionBankPackage,
  };
}
