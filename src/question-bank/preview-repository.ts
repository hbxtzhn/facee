import { parseCatalog, assertQuestionContent } from './schema';
import { filterCatalogQuestions } from './catalog';
import { buildCorpus, searchCorpus, buildSnippet } from './search';
import previewBank from './__fixtures__/preview-bank.json';
import type {
  InstallResult,
  InstalledBankSummary,
  Question,
  QuestionBankCatalog,
  QuestionBankPackage,
  QuestionContent,
  QuestionFilter,
  QuestionId,
  QuestionBankRepository,
} from './types';

interface PreviewContent {
  id: QuestionId;
  questionMd: string;
  answerMd: string | null;
  followupsMd?: string | null;
}

/**
 * Web 预览专用仓库：内置与题库规范 v1 种子一致的示例题库（29 题）。
 *
 * 浏览器没有 documentDirectory 与 zip 原生模块，真机的下载/解压/激活路径
 * 在 Web 上整体不可用（client.ts 的 Web 分支固定走本类）。数据由
 * packages/bank-spec/export-preview-contents.mjs 从种子生成，种子更新后重跑：
 *   node packages/bank-spec/export-preview-contents.mjs
 */
export class PreviewQuestionBankRepository implements QuestionBankRepository {
  private readonly catalog: QuestionBankCatalog;
  private readonly contentsById: Map<QuestionId, QuestionContent>;
  /** 正文搜索语料（§6.2）：模块构造时一次性生成，常驻内存 */
  private readonly corpus: string;

  constructor() {
    this.catalog = parseCatalog(previewBank.catalog);
    this.contentsById = new Map();
    const corpusEntries: { id: QuestionId; markdown: string }[] = [];
    for (const raw of previewBank.contents as PreviewContent[]) {
      const content: QuestionContent = {
        id: raw.id,
        questionMd: raw.questionMd,
        answerMd: raw.answerMd ?? null,
        followupsMd: raw.followupsMd ?? null,
      };
      assertQuestionContent(content);
      this.contentsById.set(content.id, content);
      corpusEntries.push({ id: content.id, markdown: `${content.questionMd}\n${content.answerMd ?? ''}` });
    }
    this.corpus = buildCorpus(corpusEntries);
  }

  async getCatalog(): Promise<QuestionBankCatalog | null> {
    return this.catalog;
  }

  async getQuestion(id: QuestionId): Promise<Question | null> {
    return this.catalog.questions.find((question) => question.id === id) ?? null;
  }

  async getContent(id: QuestionId): Promise<QuestionContent | null> {
    return this.contentsById.get(id) ?? null;
  }

  async listQuestions(filter: QuestionFilter = {}): Promise<Question[]> {
    return filterCatalogQuestions(this.catalog, filter);
  }

  async searchBody(
    query: string,
  ): Promise<{ id: QuestionId; hits: number; snippet: string | null }[]> {
    if (!query.trim()) return [];
    return searchCorpus(this.corpus, query).map((hit) => ({
      ...hit,
      snippet: buildSnippet(this.corpus, hit.id, query),
    }));
  }

  async install(_questionBank: QuestionBankPackage): Promise<InstallResult> {
    throw new Error('Web 预览使用内置示例题库，请在移动端安装正式题库');
  }

  async clear(): Promise<void> {
    // 示例题库常驻内存，Web 端无需清理
  }

  async listBanks(): Promise<InstalledBankSummary[]> {
    // Web 预览只有内置示例库，没有多题库；UI 层据此隐藏本地题库入口
    return [];
  }

  async getQuestionIds(_catalogId: string): Promise<Set<string> | null> {
    // Web 预览没有多题库与在线更新；占位满足接口
    return null;
  }

  async switchBank(_catalogId: string): Promise<void> {
    throw new Error('Web 预览不支持切换题库，请在移动端使用');
  }

  async deleteBank(_catalogId: string): Promise<void> {
    throw new Error('Web 预览不支持删除题库，请在移动端使用');
  }

  async exportPackage(_catalogId: string): Promise<QuestionBankPackage | null> {
    return null;
  }

  async copyBankAssets(_sourceCatalogId: string, _targetCatalogId: string): Promise<void> {
    // Web 预览无已装题库与文件系统
  }

  async stageLocalBankAssets(_targetAssetsRoot: string): Promise<number> {
    return 0;
  }

  async restoreBankAssets(_assetsRoot: string, _catalogId: string): Promise<void> {
    // Web 预览无已装题库与文件系统
  }
}
