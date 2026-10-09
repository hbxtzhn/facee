import * as FileSystem from 'expo-file-system/legacy';
import {
  assertCatalog,
  assertQuestionContent,
  parseCatalog,
} from './schema';
import { filterCatalogQuestions } from './catalog';
import type {
  InstallationProgress,
  InstallationProgressListener,
  InstallResult,
  InstalledBankSummary,
  Question,
  QuestionBankCatalog,
  QuestionBankPackage,
  QuestionContent,
  QuestionFilter,
  QuestionId,
  RemoteQuestionBankRepository,
} from './types';
import { buildSnippet, encodeCorpusLine, searchCorpus } from './search';

export interface ZipEntryLike {
  path: string;
  isDirectory: boolean;
  isEncrypted?: boolean;
  size?: number;
}

export interface ZipArchiveModule {
  listContents(source: string, charset?: string): Promise<ZipEntryLike[]>;
  unzip(source: string, target: string, charset?: string, entries?: string[]): Promise<string>;
}

export interface FileSystemQuestionBankRepositoryOptions {
  fileSystem?: typeof FileSystem;
  zipArchive?: ZipArchiveModule;
}

export const QUESTION_BANK_ROOT_NAME = 'facee-question-bank/';
const ROOT_NAME = QUESTION_BANK_ROOT_NAME;
const BANKS_NAME = 'banks/';
const STAGING_NAME = 'staging/';
const ACTIVE_POINTER_NAME = 'active';
const REGISTRY_NAME = 'registry.json';
const DOWNLOAD_NAME = 'facee-question-bank-downloads/';
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SAFE_NAMESPACE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;

/** 与 local-banks.newLocalBankId 同格式的本地库 id（file-repository 不反向依赖 local-banks） */
function makeLocalBankId(): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `local-${Date.now().toString(36)}${random}`.slice(0, 40);
}

/**
 * 题库注册表：catalogId -> namespace。
 * 多题库共存的关键——install 激活新库后只删除「同 catalogId」的旧 namespace，
 * 线上题库与本地题库互不误删。v1.2.1 之前没有注册表，旧安装通过
 * install 时的 previousCatalogId 自动迁移登记。
 */
type BankRegistry = Record<string, string>;

/** 本地题库的 catalogId 前缀约定（local-banks.ts 生成），用于 UI 区分来源 */
export const LOCAL_BANK_ID_PREFIX = 'local-';

export const QUESTION_BANK_ZIP_CATALOG_PATH = 'catalog.json';
/** 正文全文搜索语料（§6.2）：安装期生成，一行一题 */
export const QUESTION_BANK_CORPUS_PATH = 'index/body.txt';

/** 题目目录内允许的文件（followups.md 为面试官追问，可选） */
const QUESTION_MARKDOWN_FILES = new Set(['question.md', 'answer.md', 'followups.md']);

/** 题库仓库自带的非题库文件：不参与校验，也不影响安装 */
/** 题库内容只可能出现在 catalog.json 与 questions/（规范 v1 §2）：其余一律视为仓库自带内容 */
const BANK_CATALOG_FILE = 'catalog.json';

/**
 * 判断路径是否属于「题库内容」。
 *
 * 关键设计：**只有 catalog.json 与 questions/** 是题库内容，其余一律当作仓库自带内容忽略**。
 *
 * 早期实现用的是一张固定的忽略白名单（只认 LICENSE / README.md / .gitattributes /
 * .github/**），结果被真实仓库打脸：为满足 Apache-2.0 必须随附的
 * `LICENSE-Apache-2.0`、`NOTICE`、`sources.md` 不在白名单里，导致整包被拒
 * （真机报错 `Unexpected ZIP entry path: LICENSE-Apache-2.0`）。
 *
 * 黑名单永远列不全，白名单式判断才是稳的：题库内容的位置由规范固定，
 * 其他位置的任何文件都与 App 无关。
 * 注意：路径安全（穿越/绝对路径/反斜杠/控制字符）、加密、重复条目等检查
 * 对**所有**条目仍然生效，与这里无关。
 */
export function isIgnoredRepositoryPath(relativePath: string): boolean {
  const segments = relativePath.split('/').filter((segment) => segment.length > 0);
  if (segments.length === 0) return true;
  // catalog.json 与 questions（含其下全部内容）是题库内容；注意 questions 目录条目本身
  // 也走严格校验，这样「questions 被做成了文件」这种畸形包仍会被拒。
  if (segments.length === 1 && segments[0] === BANK_CATALOG_FILE) return false;
  if (segments[0] === 'questions') return false;
  return true;
}

/**
 * 确定题库根目录前缀。
 *
 * 支持两种包形态：
 *   1. catalog.json 在包根（自己打的题库包、raw 下载链接）  => ''
 *   2. catalog.json 在唯一顶层目录下（GitHub 归档 ZIP）    => '<repo>-<branch>/'
 */
export function resolveQuestionBankZipRoot(entries: readonly ZipEntryLike[]): string {
  const candidates = new Set<string>();
  for (const entry of entries) {
    const normalized = normalizeQuestionBankZipPath(entry.path);
    const segments = normalized.split('/');
    const leaf = segments[segments.length - 1];
    if (leaf !== QUESTION_BANK_ZIP_CATALOG_PATH) continue;
    if (segments.length === 1) candidates.add('');
    else if (segments.length === 2) candidates.add(`${segments[0]}/`);
    else candidates.add(`${segments[0]}/`);
  }
  if (candidates.size === 0) throw new Error('题库包内没有找到 catalog.json');
  if (candidates.size > 1) {
    throw new Error(`题库包内有多个 catalog.json，无法确定题库根目录：${[...candidates].join(', ')}`);
  }
  return [...candidates][0];
}

/**
 * Native repository for complete ZIP packages. It stores Markdown and assets
 * on disk; only catalog metadata is held in memory while a screen is open.
 */
export class FileSystemQuestionBankRepository
  implements RemoteQuestionBankRepository
{
  private readonly fs: typeof FileSystem;
  private zipArchive: ZipArchiveModule | null;
  private sequence = 0;
  /** 正文语料缓存：{ 题库命名空间, 语料内容 }；切换题库后自动失效 */
  private corpusCache: { namespace: string; contents: string } | null = null;
  /**
   * catalog 内存缓存：{ 题库命名空间, 解析后的目录 }。
   * 安装总是落在新 namespace 再原子切换指针（createNamespace），同一 namespace
   * 的 catalog.json 不会被原地改写，因此按 namespace 键缓存是安全的；
   * getQuestion / listQuestions / getContent 不再每次整读整解析 catalog.json。
   */
  private catalogCache: { namespace: string; catalog: QuestionBankCatalog } | null = null;

  constructor(options: FileSystemQuestionBankRepositoryOptions = {}) {
    this.fs = options.fileSystem ?? FileSystem;
    this.zipArchive = options.zipArchive ?? null;
  }

  async getCatalog(): Promise<QuestionBankCatalog | null> {
    return (await this.readActiveCatalog())?.catalog ?? null;
  }

  /**
   * 指针当前指向题库的（缓存命中的）目录。namespace 与 catalog 取自同一条缓存，
   * 保留「元数据与 Markdown 不跨代混用」的保证。
   */
  private async readActiveCatalog(): Promise<{ namespace: string; catalog: QuestionBankCatalog } | null> {
    const namespace = await this.readActiveNamespace();
    if (!namespace) return null;
    if (this.catalogCache?.namespace === namespace) return this.catalogCache;
    try {
      const catalog = await this.readCatalogAt(this.bankPath(namespace));
      this.catalogCache = { namespace, catalog };
      return this.catalogCache;
    } catch {
      this.catalogCache = null;
      return null;
    }
  }

  async getQuestion(id: QuestionId): Promise<Question | null> {
    const catalog = await this.getCatalog();
    return catalog?.questions.find((question) => question.id === id) ?? null;
  }

  async getContent(id: QuestionId): Promise<QuestionContent | null> {
    if (!isSafeQuestionId(id)) return null;

    try {
      // Resolve metadata and Markdown from the same namespace. A replacement
      // can switch the pointer between calls, but it cannot mix generations.
      const resolved = await this.readActiveCatalog();
      if (!resolved) return null;
      const { namespace, catalog } = resolved;
      const question = catalog.questions.find((candidate) => candidate.id === id);
      if (!question) return null;
      const questionMd = await this.readUtf8(this.questionPath(namespace, id));
      const answerPath = this.answerPath(namespace, id);
      const answerInfo = await this.fs.getInfoAsync(answerPath);
      let answerMd: string | null = null;
      if (answerInfo.exists) {
        if (answerInfo.isDirectory) return null;
        answerMd = await this.readUtf8(answerPath);
      }
      // 面试官追问：文件可以不存在（题库规范 §6），缺失时不影响题目可读。
      const followupsPath = this.followupsPath(namespace, id);
      const followupsInfo = await this.fs.getInfoAsync(followupsPath);
      const followupsMd =
        followupsInfo.exists && !followupsInfo.isDirectory ? await this.readUtf8(followupsPath) : null;
      const content: QuestionContent = {
        id,
        questionMd,
        answerMd,
        followupsMd,
        assetBaseUri: this.assetsPath(namespace, id),
      };
      assertQuestionContent(content);
      if (question.hasAnswer && answerMd === null) return null;
      return content;
    } catch {
      return null;
    }
  }

  async listQuestions(filter: QuestionFilter = {}): Promise<Question[]> {
    const catalog = await this.getCatalog();
    return catalog ? filterCatalogQuestions(catalog, filter) : [];
  }

  async install(
    questionBank: QuestionBankPackage,
    onProgress?: InstallationProgressListener,
  ): Promise<InstallResult> {
    validateDecodedPackage(questionBank);
    await this.ensureRoot();

    const namespace = this.createNamespace();
    const stagingPath = this.stagingPath(namespace);
    const finalPath = this.bankPath(namespace);
    const previousNamespace = await this.readActiveNamespace();
    // 激活前读取旧库的 catalog.id（旧库目录在删除前不会被改动）
    const previousCatalogId = await this.readCatalogIdAt(previousNamespace);
    // 同 catalogId 的旧安装目录：install 包不含资产文件，重建时从它继承图片
    const registry = await this.readRegistry();
    const priorOwnNamespace = registry[questionBank.catalog.id]
      ?? (previousCatalogId === questionBank.catalog.id ? previousNamespace : null);
    const total = questionBank.contents.length + 1;
    notifyProgress(onProgress, { completed: 0, total, label: '正在准备题库' });
    let activated = false;

    try {
      await this.fs.makeDirectoryAsync(stagingPath, { intermediates: true });
      for (let index = 0; index < questionBank.contents.length; index += 1) {
        const content = questionBank.contents[index];
        const questionDirectory = this.questionDirectory(stagingPath, content.id);
        await this.fs.makeDirectoryAsync(questionDirectory, { intermediates: true });
        await this.fs.writeAsStringAsync(
          `${questionDirectory}question.md`,
          content.questionMd,
          { encoding: 'utf8' },
        );
        if (content.answerMd !== null) {
          await this.fs.writeAsStringAsync(
            `${questionDirectory}answer.md`,
            content.answerMd,
            { encoding: 'utf8' },
          );
        }
        if (content.followupsMd) {
          await this.fs.writeAsStringAsync(
            `${questionDirectory}followups.md`,
            content.followupsMd,
            { encoding: 'utf8' },
          );
        }
        notifyProgress(onProgress, {
          completed: index + 1,
          total,
          label: `正在保存题目 ${index + 1}/${questionBank.contents.length}`,
        });
      }
      await this.fs.writeAsStringAsync(
        `${stagingPath}${QUESTION_BANK_ZIP_CATALOG_PATH}`,
        JSON.stringify(questionBank.catalog),
        { encoding: 'utf8' },
      );
      await this.writeCorpus(
        stagingPath,
        questionBank.contents.map((content) =>
          encodeCorpusLine(content.id, `${content.questionMd}\n${content.answerMd ?? ''}`),
        ),
      );
      // 资产继承：包格式不含图片文件，从同 catalogId 旧安装逐题拷入（尽力而为），
      // 否则本地题库每次「保存并启用」重建 namespace 都会丢图
      await this.inheritAssetsFromPriorBank(stagingPath, questionBank, priorOwnNamespace);
      notifyProgress(onProgress, { completed: total, total, label: '正在激活题库' });
      await this.activateDirectory(stagingPath, finalPath, namespace, previousNamespace);
      activated = true;
      notifyProgress(onProgress, { completed: total, total, label: '题库安装完成' });
      await this.reconcileBanksAfterActivate(
        questionBank.catalog.id,
        namespace,
        previousNamespace,
        previousCatalogId,
      );
      return {
        questionCount: questionBank.catalog.questions.length,
        tagCount: questionBank.catalog.tags.length,
      };
    } catch (error) {
      if (!activated) {
        await this.removeDirectory(stagingPath);
        await this.removeDirectory(finalPath);
      }
      throw error;
    }
  }

  async installFromUrl(
    url: string,
    onProgress?: InstallationProgressListener,
    options?: { reuseCatalogId?: string },
  ): Promise<InstallResult> {
    assertHttpUrl(url);
    await this.ensureRoot();
    const downloadDirectory = this.downloadDirectory();
    await this.ensureDirectory(downloadDirectory);

    const token = this.createNamespace();
    const partPath = `${downloadDirectory}${token}.zip.part`;
    const stagingPath = this.stagingPath(token);
    const finalPath = this.bankPath(token);
    // 解压落在 staging 的**同级**目录：若放在 staging 内部，重命名的目标目录已存在，
    // 设备上会变成「移入子目录」或直接失败。
    const extractPath = this.stagingPath(`${token}-raw`);
    let activated = false;

    try {
      notifyProgress(onProgress, { completed: 0, total: 1, label: '正在下载完整题库' });
      const result = await this.fs.downloadAsync(url, partPath);
      if (!result || result.status < 200 || result.status >= 300) {
        throw new Error(`题库下载失败（HTTP ${result?.status ?? 'unknown'}）`);
      }
      notifyProgress(onProgress, { completed: 1, total: 1, label: '正在检查压缩包' });

      const entries = await this.getZipArchive().listContents(partPath, 'UTF-8');
      // GitHub 归档 ZIP 会多包一层 <repo>-<branch>/，先定位题库根再校验路径。
      const zipRoot = resolveQuestionBankZipRoot(entries);
      validateQuestionBankZipEntries(entries, zipRoot);
      // 解压到独立的 raw 目录，再把题库根一次性重命名到 staging。
      // 单次 rename 而不是逐文件搬移：2000 题时这是数量级的差异。
      await this.fs.makeDirectoryAsync(extractPath, { intermediates: true });
      await this.getZipArchive().unzip(partPath, extractPath, 'UTF-8');
      await this.fs.moveAsync({ from: `${extractPath}${zipRoot}`, to: stagingPath });
      await this.removeDirectory(extractPath);

      const catalog = await this.readCatalogAt(stagingPath);
      assertArchiveMatchesCatalog(entries, catalog, zipRoot);
      const total = catalog.questions.length + 1;
      notifyProgress(onProgress, { completed: 0, total, label: '正在校验题库' });
      const corpusLines: string[] = [];
      await this.validateExtractedFiles(stagingPath, catalog, onProgress, total, corpusLines);
      await this.writeCorpus(stagingPath, corpusLines);

      const previousNamespace = await this.readActiveNamespace();
      const previousCatalogId = await this.readCatalogIdAt(previousNamespace);
      // 下载即本地化：ZIP 落地即成为可编辑的本地题库。catalog.id 重写为
      // local- 前缀（同 URL 更新时沿用原 id，install 原子替换旧库）；
      // 图片资产已随解压目录进入 namespace，后续编辑保存由同 id 继承兜底。
      const localId = options?.reuseCatalogId ?? makeLocalBankId();
      const localizedCatalog: QuestionBankCatalog = { ...catalog, id: localId };
      await this.fs.writeAsStringAsync(
        `${stagingPath}${QUESTION_BANK_ZIP_CATALOG_PATH}`,
        JSON.stringify(localizedCatalog),
        { encoding: 'utf8' },
      );
      notifyProgress(onProgress, { completed: total, total, label: '正在激活题库' });
      await this.activateDirectory(stagingPath, finalPath, token, previousNamespace);
      activated = true;
      notifyProgress(onProgress, { completed: total, total, label: '题库安装完成' });
      await this.reconcileBanksAfterActivate(localizedCatalog.id, token, previousNamespace, previousCatalogId);
      const localPackage = await this.exportPackage(localId);
      if (!localPackage) throw new Error('题库安装完成，但无法读取本地目录');
      return {
        questionCount: localizedCatalog.questions.length,
        tagCount: localizedCatalog.tags.length,
        localSource: { bankId: localId, updatedAt: '', package: localPackage, sourceUrl: url },
      };
    } catch (error) {
      if (!activated) {
        await this.removeDirectory(extractPath);
        await this.removeDirectory(stagingPath);
        await this.removeDirectory(finalPath);
      }
      throw error;
    } finally {
      await this.removeFile(partPath);
    }
  }

  async clear(): Promise<void> {
    await this.removeDirectory(this.bankRoot());
    await this.ensureRoot();
    // 题库已被删除：目录与语料缓存一并失效，避免常驻已删题库的元数据
    this.catalogCache = null;
    this.corpusCache = null;
  }

  /** 列出本机全部已安装题库（banks/ 目录扫描 + 逐库读 catalog）。 */
  async listBanks(): Promise<InstalledBankSummary[]> {
    const activeNamespace = await this.readActiveNamespace();
    let namespaces: string[];
    try {
      const listing = await this.fs.readDirectoryAsync(this.banksRoot());
      namespaces = listing.filter((name) => isSafeNamespace(name));
    } catch {
      return [];
    }

    const banks: InstalledBankSummary[] = [];
    for (const namespace of namespaces) {
      const active = namespace === activeNamespace;
      try {
        const catalog = await this.readCatalogAt(this.bankPath(namespace));
        const catalogId = catalog.id || namespace;
        banks.push({
          catalogId,
          namespace,
          title: catalog.title || catalogId,
          questionCount: catalog.questions.length,
          source: catalogId.startsWith(LOCAL_BANK_ID_PREFIX) ? 'local' : 'online',
          active,
          ...(catalog.version ? { version: catalog.version } : {}),
          ...(catalog.updatedAt ? { updatedAt: catalog.updatedAt } : {}),
        });
      } catch {
        banks.push({
          catalogId: namespace,
          namespace,
          title: '（无法读取）',
          questionCount: 0,
          source: 'online',
          active,
        });
      }
    }
    return banks.sort(
      (left, right) => Number(right.active) - Number(left.active) || left.title.localeCompare(right.title),
    );
  }

  /** 读取指定题库的题目 id 集合（在线更新前后对比用）；找不到或读取失败返回 null */
  async getQuestionIds(catalogId: string): Promise<Set<string> | null> {
    const registry = await this.readRegistry();
    let namespace = registry[catalogId];
    if (!namespace) {
      const match = (await this.listBanks()).find((bank) => bank.catalogId === catalogId);
      if (!match) return null;
      namespace = match.namespace;
    }
    try {
      const catalog = await this.readCatalogAt(this.bankPath(namespace));
      return new Set(catalog.questions.map((question) => question.id));
    } catch {
      return null;
    }
  }

  /** 把当前使用的题库切换为指定 catalog.id 的题库（原子指针切换）。 */
  async switchBank(catalogId: string): Promise<void> {
    const registry = await this.readRegistry();
    let namespace = registry[catalogId];
    if (!namespace) {
      // 未登记（如旧版本升级后的首次切换）：按 catalog.id 扫描目录并补登记
      const match = (await this.listBanks()).find((bank) => bank.catalogId === catalogId);
      if (!match) throw new Error(`没有找到题库：${catalogId}`);
      namespace = match.namespace;
      await this.writeRegistry({ ...registry, [catalogId]: namespace });
    }
    const info = await this.fs.getInfoAsync(this.bankPath(namespace));
    if (!info.exists) throw new Error('题库文件已丢失，请重新安装');
    const previous = await this.readActiveNamespace();
    if (previous === namespace) return;
    await this.activatePointer(namespace, previous);
    // catalogCache 按 namespace 键控：指针切换后自动 miss 重读，无需失效
  }

  /** 删除一个已安装题库；删的是当前题库时自动切到剩余题库（或清空指针）。 */
  async deleteBank(catalogId: string): Promise<void> {
    const registry = await this.readRegistry();
    let namespace = registry[catalogId];
    if (!namespace) {
      const match = (await this.listBanks()).find((bank) => bank.catalogId === catalogId);
      if (!match) throw new Error(`没有找到题库：${catalogId}`);
      namespace = match.namespace;
    }
    const wasActive = (await this.readActiveNamespace()) === namespace;
    await this.removeNamespace(namespace);
    delete registry[catalogId];
    for (const [id, ns] of Object.entries(registry)) {
      if (ns === namespace) delete registry[id];
    }
    await this.writeRegistry(registry);
    if (wasActive) {
      const remaining = Object.entries(registry);
      if (remaining.length > 0) {
        await this.activatePointer(remaining[0][1], namespace);
      } else {
        await this.removeFile(this.activePointerPath());
      }
      this.catalogCache = null;
      this.corpusCache = null;
    }
  }

  /**
   * 把已装题库反向重建为完整 QuestionBankPackage（含每题 followupsMd），
   * 供「复制为本地题库」。找不到该题库返回 null；题库数据损坏时抛错。
   * 不导出 assetBaseUri：副本安装后由 getContent 按新 namespace 重新解析。
   */
  async exportPackage(catalogId: string): Promise<QuestionBankPackage | null> {
    const registry = await this.readRegistry();
    let namespace = registry[catalogId];
    if (!namespace) {
      const match = (await this.listBanks()).find((bank) => bank.catalogId === catalogId);
      if (!match) return null;
      namespace = match.namespace;
    }
    const root = this.bankPath(namespace);
    const catalog = await this.readCatalogAt(root);
    const contents: QuestionContent[] = [];
    for (const question of catalog.questions) {
      contents.push(await this.readQuestionContentAt(namespace, question.id));
    }
    return { catalog, contents };
  }

  /** 复制源题库的题目 assets/ 目录到目标题库（尽力而为：缺失或失败逐题跳过）。 */
  async copyBankAssets(sourceCatalogId: string, targetCatalogId: string): Promise<void> {
    const registry = await this.readRegistry();
    const sourceNamespace = registry[sourceCatalogId];
    const targetNamespace = registry[targetCatalogId];
    if (!sourceNamespace || !targetNamespace) return;
    const catalog = await this.readCatalogAt(this.bankPath(sourceNamespace));
    for (const question of catalog.questions) {
      const source = this.assetsPath(sourceNamespace, question.id);
      try {
        const info = await this.fs.getInfoAsync(source);
        if (!info.exists || !info.isDirectory) continue;
        // 目标目录交给 copyAsync 创建：先建空目录再拷会触发「拷进子目录」歧义
        await this.fs.copyAsync({ from: source, to: this.assetsPath(targetNamespace, question.id) });
      } catch {
        // 资产复制失败只影响该题图片，不阻塞题库复制
      }
    }
  }

  /**
   * install 重建时继承同 catalogId 旧安装的题目图片。本地题库的编辑流程
   * （保存/复制）都走「整包重建」，而包格式不携带资产文件，不继承则每次
   * 保存都会丢图。逐题尽力而为：旧库无资产或拷贝失败只影响图片不影响安装。
   */
  private async inheritAssetsFromPriorBank(
    stagingPath: string,
    questionBank: QuestionBankPackage,
    priorNamespace: string | null,
  ): Promise<void> {
    if (!priorNamespace) return;
    for (const question of questionBank.catalog.questions) {
      try {
        const source = this.assetsPath(priorNamespace, question.id);
        const info = await this.fs.getInfoAsync(source);
        if (!info.exists || !info.isDirectory) continue;
        await this.fs.copyAsync({
          from: source,
          to: joinUri(this.questionDirectory(stagingPath, question.id), 'assets/'),
        });
      } catch {
        // 尽力而为：缺图不阻塞安装
      }
    }
  }

  /** 读单题的完整内容文件（question/answer/followups），缺省文件记为 null */
  private async readQuestionContentAt(
    namespace: string,
    id: QuestionId,
  ): Promise<QuestionContent> {
    const questionMd = await this.readUtf8(this.questionPath(namespace, id));
    const answerMd = await this.readOptionalMarkdown(this.answerPath(namespace, id));
    const followupsMd = await this.readOptionalMarkdown(this.followupsPath(namespace, id));
    return { id, questionMd, answerMd, followupsMd };
  }

  async stageLocalBankAssets(targetAssetsRoot: string): Promise<number> {
    const registry = await this.readRegistry();
    let stagedBanks = 0;
    for (const [catalogId, namespace] of Object.entries(registry)) {
      if (!catalogId.startsWith(LOCAL_BANK_ID_PREFIX)) continue;
      let catalog: QuestionBankCatalog;
      try {
        catalog = await this.readCatalogAt(this.bankPath(namespace));
      } catch {
        continue;
      }
      let stagedAny = false;
      for (const question of catalog.questions) {
        try {
          const source = this.assetsPath(namespace, question.id);
          const info = await this.fs.getInfoAsync(source);
          if (!info.exists || !info.isDirectory) continue;
          // 目录交给 copyAsync 创建：先建空目录再拷会触发「拷进子目录」歧义
          await this.fs.copyAsync({
            from: source,
            to: joinUri(joinUri(targetAssetsRoot, `${catalogId}/`), `${question.id}/assets/`),
          });
          stagedAny = true;
        } catch {
          // 单题失败只影响该题图片，不阻塞备份
        }
      }
      if (stagedAny) stagedBanks += 1;
    }
    return stagedBanks;
  }

  async restoreBankAssets(assetsRoot: string, sourceCatalogId: string, targetCatalogId: string): Promise<void> {
    const registry = await this.readRegistry();
    const namespace = registry[targetCatalogId];
    if (!namespace) return;
    let catalog: QuestionBankCatalog;
    try {
      catalog = await this.readCatalogAt(this.bankPath(namespace));
    } catch {
      return;
    }
    for (const question of catalog.questions) {
      try {
        const source = joinUri(joinUri(assetsRoot, `${sourceCatalogId}/`), `${question.id}/assets/`);
        const info = await this.fs.getInfoAsync(source);
        if (!info.exists || !info.isDirectory) continue;
        await this.fs.copyAsync({ from: source, to: this.assetsPath(namespace, question.id) });
      } catch {
        // 尽力而为：缺图不阻塞导入
      }
    }
  }

  private async readOptionalMarkdown(path: string): Promise<string | null> {
    const info = await this.fs.getInfoAsync(path);
    if (!info.exists || info.isDirectory) return null;
    return this.readUtf8(path);
  }

  /**
   * 激活后的多题库对账：登记新库，只删除「同 catalogId」的旧 namespace。
   * 不同 catalogId 的旧 active（旧版本升级迁移路径）登记保留，实现共存。
   */
  private async reconcileBanksAfterActivate(
    catalogId: string,
    namespace: string,
    previousNamespace: string | null,
    previousCatalogId: string | null,
  ): Promise<void> {
    const registry = await this.readRegistry();
    const stale: string[] = [];
    const prior = registry[catalogId];
    if (prior && prior !== namespace) stale.push(prior);
    if (previousNamespace && previousNamespace !== namespace && previousCatalogId === catalogId) {
      if (!stale.includes(previousNamespace)) stale.push(previousNamespace);
    }

    registry[catalogId] = namespace;
    if (
      previousNamespace &&
      previousCatalogId &&
      previousCatalogId !== catalogId &&
      registry[previousCatalogId] !== previousNamespace
    ) {
      registry[previousCatalogId] = previousNamespace;
    }
    await this.writeRegistry(registry);

    for (const ns of stale) {
      if (ns === registry[catalogId]) continue;
      await this.removeNamespace(ns).catch(() => undefined);
    }
  }

  private async readCatalogIdAt(namespace: string | null): Promise<string | null> {
    if (!namespace) return null;
    try {
      const catalog = await this.readCatalogAt(this.bankPath(namespace));
      return catalog.id;
    } catch {
      return null;
    }
  }

  private registryPath(): string {
    return `${this.bankRoot()}${REGISTRY_NAME}`;
  }

  private async readRegistry(): Promise<BankRegistry> {
    try {
      const value: unknown = JSON.parse(await this.readUtf8(this.registryPath()));
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
      const registry: BankRegistry = {};
      for (const [catalogId, namespace] of Object.entries(value)) {
        if (catalogId.length > 0 && typeof namespace === 'string' && isSafeNamespace(namespace)) {
          registry[catalogId] = namespace;
        }
      }
      return registry;
    } catch {
      return {};
    }
  }

  private async writeRegistry(registry: BankRegistry): Promise<void> {
    try {
      await this.fs.writeAsStringAsync(this.registryPath(), JSON.stringify(registry), {
        encoding: 'utf8',
      });
    } catch {
      // 注册表写失败不会丢题库数据：下次 install/listBanks 会重新迁移登记，
      // 最坏情况是「同 id 替换」退化为「共存」，可手动删除。
    }
  }

  private async validateExtractedFiles(
    root: string,
    catalog: QuestionBankCatalog,
    onProgress: InstallationProgressListener | undefined,
    total: number,
    corpusLines: string[],
  ): Promise<void> {
    for (let index = 0; index < catalog.questions.length; index += 1) {
      const question = catalog.questions[index];
      const questionPath = `${this.questionDirectory(root, question.id)}question.md`;
      const questionMd = await this.readUtf8(questionPath);
      let answerMd: string | null = null;
      const answerInfo = await this.fs.getInfoAsync(`${this.questionDirectory(root, question.id)}answer.md`);
      if (answerInfo.exists) {
        if (answerInfo.isDirectory) throw new Error(`answer.md is a directory: ${question.id}`);
        answerMd = await this.readUtf8(`${this.questionDirectory(root, question.id)}answer.md`);
      }
      assertQuestionContent({ id: question.id, questionMd, answerMd });
      // 一边校验一边攒语料：正文这次读盘已经付过代价，不额外多读一遍
      corpusLines.push(encodeCorpusLine(question.id, `${questionMd}\n${answerMd ?? ''}`));
      if (question.hasAnswer && answerMd === null) {
        throw new Error(`Missing answer.md for question: ${question.id}`);
      }
      await this.validateReferencedAssets(root, question.id, questionMd, answerMd);
      notifyProgress(onProgress, { completed: index + 1, total, label: `正在校验题目 ${index + 1}/${catalog.questions.length}` });
    }
  }

  private async validateReferencedAssets(
    root: string,
    id: QuestionId,
    questionMd: string,
    answerMd: string | null,
  ): Promise<void> {
    const assetBaseUri = joinUri(this.questionDirectory(root, id), 'assets/');
    for (const relativePath of collectQuestionAssetPaths(`${questionMd}\n${answerMd ?? ''}`)) {
      const info = await this.fs.getInfoAsync(resolveAssetUri(assetBaseUri, relativePath));
      if (!info.exists || info.isDirectory) {
        throw new Error(`Missing referenced asset for question ${id}: ${relativePath}`);
      }
    }
  }

  /** 安装期把语料写进题库目录（失败不影响安装，只影响正文搜索能力） */
  private async writeCorpus(root: string, lines: readonly string[]): Promise<void> {
    try {
      const directory = `${root}index/`;
      await this.fs.makeDirectoryAsync(directory, { intermediates: true });
      await this.fs.writeAsStringAsync(`${root}${QUESTION_BANK_CORPUS_PATH}`, lines.join('\n'), {
        encoding: 'utf8',
      });
      this.corpusCache = null;
    } catch {
      // 语料是加速设施：写不进去时正文搜索退化为无结果，不影响题目阅读
    }
  }

  /**
   * 正文全文搜索（§6.2）。语料懒加载并常驻：一次顺序读替代 N 次随机读。
   */
  async searchBody(query: string): Promise<{ id: QuestionId; hits: number; snippet: string | null }[]> {
    if (!query.trim()) return [];
    try {
      const namespace = await this.readActiveNamespace();
      if (!namespace) return [];
      if (!this.corpusCache || this.corpusCache.namespace !== namespace) {
        const path = `${this.bankPath(namespace)}${QUESTION_BANK_CORPUS_PATH}`;
        const info = await this.fs.getInfoAsync(path);
        if (!info.exists) return [];
        this.corpusCache = { namespace, contents: await this.readUtf8(path) };
      }
      const contents = this.corpusCache.contents;
      return searchCorpus(contents, query).map((hit) => ({
        ...hit,
        snippet: buildSnippet(contents, hit.id, query),
      }));
    } catch {
      return [];
    }
  }

  private async readCatalogAt(root: string): Promise<QuestionBankCatalog> {
    const raw = await this.readUtf8(`${root}${QUESTION_BANK_ZIP_CATALOG_PATH}`);
    return parseCatalog(raw);
  }

  private async activateDirectory(
    stagingPath: string,
    finalPath: string,
    namespace: string,
    previousNamespace: string | null,
  ): Promise<void> {
    await this.fs.moveAsync({ from: stagingPath, to: finalPath });
    try {
      await this.activatePointer(namespace, previousNamespace);
    } catch (error) {
      await this.removeDirectory(finalPath);
      throw error;
    }
  }

  private async activatePointer(namespace: string, previousNamespace: string | null): Promise<void> {
    const pointer = this.activePointerPath();
    const temporary = `${pointer}.${namespace}.part`;
    await this.fs.writeAsStringAsync(temporary, namespace, { encoding: 'utf8' });
    try {
      // On platforms where moveAsync refuses an existing destination, retry
      // after removing it. The large bank itself was already fully staged.
      try {
        await this.fs.moveAsync({ from: temporary, to: pointer });
      } catch {
        await this.fs.deleteAsync(pointer, { idempotent: true });
        try {
          await this.fs.moveAsync({ from: temporary, to: pointer });
        } catch (error) {
          if (previousNamespace) {
            await this.fs.writeAsStringAsync(pointer, previousNamespace, { encoding: 'utf8' });
          }
          throw error;
        }
      }
    } finally {
      await this.removeFile(temporary);
    }
  }

  private async readActiveNamespace(): Promise<string | null> {
    try {
      const value = (await this.readUtf8(this.activePointerPath())).trim();
      return isSafeNamespace(value) ? value : null;
    } catch {
      return null;
    }
  }

  private async ensureRoot(): Promise<void> {
    await this.ensureDirectory(this.bankRoot());
    await this.ensureDirectory(this.banksRoot());
    await this.ensureDirectory(this.stagingRoot());
  }

  private async ensureDirectory(uri: string): Promise<void> {
    const info = await this.fs.getInfoAsync(uri);
    if (info.exists) {
      if (info.isDirectory) return;
      throw new Error(`Expected a directory: ${uri}`);
    }
    await this.fs.makeDirectoryAsync(uri, { intermediates: true });
  }

  private async removeNamespace(namespace: string): Promise<void> {
    if (!isSafeNamespace(namespace)) return;
    await this.removeDirectory(this.bankPath(namespace));
    await this.removeDirectory(this.stagingPath(namespace));
    await this.removeDirectory(this.stagingPath(`${namespace}-raw`));
  }

  private async removeDirectory(uri: string): Promise<void> {
    try {
      await this.fs.deleteAsync(uri, { idempotent: true });
    } catch {
      // Cleanup is best effort; callers preserve the original install error.
    }
  }

  private async removeFile(uri: string): Promise<void> {
    try {
      await this.fs.deleteAsync(uri, { idempotent: true });
    } catch {
      // Cache cleanup must not mask a download/extraction error.
    }
  }

  private async readUtf8(uri: string): Promise<string> {
    return this.fs.readAsStringAsync(uri, { encoding: 'utf8' });
  }

  private getZipArchive(): ZipArchiveModule {
    if (this.zipArchive) return this.zipArchive;
    // Keep the native module out of the web startup path. Calling this
    // on Expo Go produces the package's precise "native module not found"
    // error, which tells developers to use a Development Build.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    this.zipArchive = require('react-native-zip-archive') as ZipArchiveModule;
    return this.zipArchive;
  }

  private createNamespace(): string {
    this.sequence = (this.sequence + 1) % 1000000;
    return `staging-${Date.now().toString(36)}-${this.sequence.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  private bankRoot(): string {
    return joinUri(this.requireDocumentDirectory(), ROOT_NAME);
  }

  private banksRoot(): string {
    return joinUri(this.bankRoot(), BANKS_NAME);
  }

  private stagingRoot(): string {
    return joinUri(this.bankRoot(), STAGING_NAME);
  }

  private activePointerPath(): string {
    return `${this.bankRoot()}${ACTIVE_POINTER_NAME}`;
  }

  private bankPath(namespace: string): string {
    return joinUri(this.banksRoot(), `${assertSafeNamespace(namespace)}/`);
  }

  private stagingPath(namespace: string): string {
    return joinUri(this.stagingRoot(), `${assertSafeNamespace(namespace)}/`);
  }

  private questionDirectory(root: string, id: QuestionId): string {
    return joinUri(root, `questions/${assertSafeQuestionId(id)}/`);
  }

  private questionPath(namespace: string, id: QuestionId): string {
    return `${this.questionDirectory(this.bankPath(namespace), id)}question.md`;
  }

  private answerPath(namespace: string, id: QuestionId): string {
    return `${this.questionDirectory(this.bankPath(namespace), id)}answer.md`;
  }

  private followupsPath(namespace: string, id: QuestionId): string {
    return `${this.questionDirectory(this.bankPath(namespace), id)}followups.md`;
  }

  private assetsPath(namespace: string, id: QuestionId): string {
    return joinUri(this.questionDirectory(this.bankPath(namespace), id), 'assets/');
  }

  private downloadDirectory(): string {
    return joinUri(this.requireCacheDirectory(), DOWNLOAD_NAME);
  }

  private requireDocumentDirectory(): string {
    const value = this.fs.documentDirectory;
    if (!value) throw new Error('The native document directory is unavailable');
    return ensureTrailingSlash(value);
  }

  private requireCacheDirectory(): string {
    const value = this.fs.cacheDirectory ?? this.fs.documentDirectory;
    if (!value) throw new Error('The native cache directory is unavailable');
    return ensureTrailingSlash(value);
  }
}

export function isSafeQuestionId(value: string): boolean {
  return typeof value === 'string' && SAFE_ID_PATTERN.test(value);
}

export function assertSafeQuestionId(value: string): string {
  if (!isSafeQuestionId(value)) throw new Error(`Invalid question id: ${value}`);
  return value;
}

export function isSafeNamespace(value: string): boolean {
  return typeof value === 'string' && SAFE_NAMESPACE_PATTERN.test(value);
}

function assertSafeNamespace(value: string): string {
  if (!isSafeNamespace(value)) throw new Error(`Invalid question-bank namespace: ${value}`);
  return value;
}

export function normalizeQuestionBankZipPath(path: string): string {
  if (typeof path !== 'string' || path.length === 0) throw new Error('ZIP entry path is empty');
  if (path.includes('\\') || path.includes('\0') || path.startsWith('/') || /^[A-Za-z]:/.test(path)) {
    throw new Error(`Unsafe ZIP entry path: ${path}`);
  }
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
  if (!trimmed || trimmed.includes('//')) throw new Error(`Unsafe ZIP entry path: ${path}`);
  const decodedSegments: string[] = [];
  for (const segment of trimmed.split('/')) {
    if (!segment || segment === '.' || segment === '..') {
      throw new Error(`Unsafe ZIP entry path: ${path}`);
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new Error(`Malformed ZIP entry path: ${path}`);
    }
    if (decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\') || decoded.includes('\0')) {
      throw new Error(`Unsafe ZIP entry path: ${path}`);
    }
    decodedSegments.push(decoded);
  }
  return decodedSegments.join('/');
}

export function validateQuestionBankZipPath(path: string, isDirectory = false): string {
  const normalized = normalizeQuestionBankZipPath(path);
  const segments = normalized.split('/');
  if (normalized === QUESTION_BANK_ZIP_CATALOG_PATH) {
    if (isDirectory) throw new Error('catalog.json must be a file');
    return normalized;
  }
  if (normalized === 'questions') {
    if (!isDirectory) throw new Error('questions must be a directory');
    return normalized;
  }
  if (segments[0] !== 'questions' || segments.length < 2) {
    throw new Error(`Unexpected ZIP entry path: ${path}`);
  }
  assertSafeQuestionId(segments[1]);
  if (segments.length === 2) {
    if (!isDirectory) throw new Error(`Question entry must be a directory: ${path}`);
    return normalized;
  }
  const leaf = segments[2];
  if (QUESTION_MARKDOWN_FILES.has(leaf)) {
    if (segments.length !== 3 || isDirectory) throw new Error(`Question Markdown path must be a file: ${path}`);
    return normalized;
  }
  if (leaf !== 'assets') throw new Error(`Unexpected question-bank ZIP path: ${path}`);
  if (segments.length === 3 && !isDirectory) throw new Error(`assets must be a directory: ${path}`);
  if (segments.length > 3 && segments.slice(3).some((segment) => segment === '.' || segment === '..')) {
    throw new Error(`Unsafe asset path: ${path}`);
  }
  return normalized;
}

export function validateQuestionBankZipEntries(
  entries: readonly ZipEntryLike[],
  rootPrefix = '',
): string[] {
  const normalizedPaths: string[] = [];
  const seenFiles = new Set<string>();
  for (const entry of entries) {
    if (entry.isEncrypted) throw new Error(`Encrypted ZIP entries are not supported: ${entry.path}`);
    const normalized = normalizeQuestionBankZipPath(entry.path);

    // 包裹目录自身的条目（如 facee-bank-main/）不是内容，直接跳过。
    if (rootPrefix && normalized === rootPrefix.replace(/\/$/, '')) continue;

    // 题库根之外：一律视为仓库自带内容（README/LICENSE/NOTICE/CI 等），忽略。
    if (rootPrefix && !normalized.startsWith(rootPrefix)) continue;
    const relative = rootPrefix ? normalized.slice(rootPrefix.length) : normalized;
    if (!relative) continue;
    if (isIgnoredRepositoryPath(relative)) continue;

    const validated = validateQuestionBankZipPath(relative, entry.isDirectory);
    if (!entry.isDirectory && seenFiles.has(validated)) {
      throw new Error(`Duplicate ZIP entry: ${validated}`);
    }
    if (!entry.isDirectory) seenFiles.add(validated);
    normalizedPaths.push(validated);
  }
  if (!seenFiles.has(QUESTION_BANK_ZIP_CATALOG_PATH)) {
    throw new Error('ZIP package is missing catalog.json');
  }
  return normalizedPaths;
}

export function resolveAssetUri(assetBaseUri: string, relativePath: string): string {
  const normalized = normalizeAssetRelativePath(relativePath);
  return `${ensureTrailingSlash(assetBaseUri)}${normalized.split('/').map(encodeURIComponent).join('/')}`;
}

export function normalizeAssetRelativePath(relativePath: string): string {
  const withoutPrefix = relativePath.replace(/^\.\/assets\//, '').replace(/^assets\//, '');
  if (!withoutPrefix || withoutPrefix.includes('\\') || withoutPrefix.startsWith('/')) {
    throw new Error(`Unsafe asset path: ${relativePath}`);
  }
  const segments = withoutPrefix.split('/');
  const decodedSegments: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..') throw new Error(`Unsafe asset path: ${relativePath}`);
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new Error(`Malformed asset path: ${relativePath}`);
    }
    if (decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\') || decoded.includes('\0')) {
      throw new Error(`Unsafe asset path: ${relativePath}`);
    }
    decodedSegments.push(decoded);
  }
  return decodedSegments.join('/');
}

export function resolveQuestionAssetMarkdown(markdown: string, assetBaseUri?: string): string {
  if (!assetBaseUri) return markdown;
  return markdown.replace(/\]\(\s*((?:\.\/)?assets\/[^)\s]+)\s*\)/g, (match, relativePath: string) => {
    try {
      return `](${resolveAssetUri(assetBaseUri, relativePath)})`;
    } catch {
      return match;
    }
  });
}

function collectQuestionAssetPaths(markdown: string): string[] {
  const paths = new Set<string>();
  const pattern = /!\[[^\]]*\]\(\s*((?:\.\/)?assets\/[^)\s]+)\s*\)/g;
  for (const match of markdown.matchAll(pattern)) paths.add(match[1]);
  return [...paths];
}

function notifyProgress(
  listener: InstallationProgressListener | undefined,
  progress: InstallationProgress,
): void {
  try {
    listener?.(progress);
  } catch {
    // UI progress listeners cannot participate in storage transactions.
  }
}

/** 校验完整题库包（catalog 与 contents 对齐）；本地题库保存前也走这一道校验 */
export function validateDecodedPackage(questionBank: QuestionBankPackage): Map<QuestionId, QuestionContent> {
  assertCatalog(questionBank.catalog);
  if (!Array.isArray(questionBank.contents)) throw new Error('Question bank contents must be an array');
  const questionIds = new Set(questionBank.catalog.questions.map((question) => question.id));
  const contentById = new Map<QuestionId, QuestionContent>();
  for (const content of questionBank.contents) {
    assertQuestionContent(content);
    if (!questionIds.has(content.id)) throw new Error(`Content has no catalog question: ${content.id}`);
    if (contentById.has(content.id)) throw new Error(`Duplicate content for question: ${content.id}`);
    contentById.set(content.id, content);
  }
  for (const question of questionBank.catalog.questions) {
    if (!contentById.has(question.id)) throw new Error(`Missing content for question: ${question.id}`);
    if (question.hasAnswer && contentById.get(question.id)?.answerMd === null) {
      throw new Error(`Missing answer content for question: ${question.id}`);
    }
  }
  return contentById;
}

function assertArchiveMatchesCatalog(
  entries: readonly ZipEntryLike[],
  catalog: QuestionBankCatalog,
  rootPrefix = '',
): void {
  const knownIds = new Set(catalog.questions.map((question) => question.id));
  const archiveIds = new Set<string>();
  for (const entry of entries) {
    const normalized = normalizeQuestionBankZipPath(entry.path);
    const relative = rootPrefix && normalized.startsWith(rootPrefix)
      ? normalized.slice(rootPrefix.length)
      : normalized;
    if (!relative.startsWith('questions/')) continue;
    const segments = relative.split('/');
    if (segments.length < 2) continue;
    if (!knownIds.has(segments[1])) throw new Error(`ZIP contains unknown question: ${segments[1]}`);
    archiveIds.add(segments[1]);
  }
  for (const question of catalog.questions) {
    if (!archiveIds.has(question.id)) throw new Error(`ZIP is missing question directory: ${question.id}`);
  }
}

function assertHttpUrl(value: string): void {
  if (!/^https?:\/\/[^\s]+$/i.test(value.trim())) {
    throw new Error('Question-bank URL must use http:// or https://');
  }
}

function joinUri(base: string, child: string): string {
  return `${ensureTrailingSlash(base)}${child.replace(/^\/+/, '')}`;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}
