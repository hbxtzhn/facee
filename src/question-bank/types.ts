/**
 * Domain types for an installed FaceE question bank.
 *
 * A catalog only contains searchable metadata. Markdown is kept separately in
 * the content adapter so a catalog can be read and filtered without loading
 * every answer into memory.
 */

export type QuestionId = string;
export type TagId = string;

export type Difficulty = 1 | 2 | 3;

export interface QuestionTag {
  id: TagId;
  name: string;
  parentId: TagId | null;
  sort: number;
}

export interface QuestionTagRef {
  id: TagId;
  name: string;
}

/** 题库分类（可选题库数据）。分类内容由题库决定，不在 App 中写死。 */
export interface QuestionCategory {
  id: string;
  name: string;
  sort: number;
  description?: string;
}

/** Searchable metadata for one question. */
export interface Question {
  id: QuestionId;
  title: string;
  difficulty: Difficulty;
  hasAnswer: boolean;
  sort: number;
  tags: QuestionTagRef[];
  /** 所属分类；题库未提供分类时为 null */
  categoryId?: string | null;
  /** 面试官追问条数；用于「有追问」标记，正文按需读取 */
  followupCount?: number;
}

/** Markdown content stored separately from the catalog. */
export interface QuestionContent {
  id: QuestionId;
  questionMd: string;
  answerMd: string | null;
  /** 面试官追问（`followups.md`）原文；不存在时为 null */
  followupsMd?: string | null;
  /** Base `file://` URI for this question's extracted assets, when available. */
  assetBaseUri?: string;
}

export interface QuestionBankCatalog {
  schemaVersion: 1;
  id: string;
  title: string;
  /** 题库版本（题库规范 v1 的 bank.version）；旧格式可能没有 */
  version?: string;
  /** 最近更新时间（题库规范 v1 的 bank.updatedAt） */
  updatedAt?: string;
  /** 分类列表；题库未提供时为 undefined */
  categories?: QuestionCategory[];
  tags: QuestionTag[];
  questions: Question[];
}

export interface QuestionBankPackage {
  catalog: QuestionBankCatalog;
  contents: QuestionContent[];
}

/** 本地题库源（可编辑真值），持久化为 <documents>/…/local-sources/<bankId>.json */
export interface LocalBankSource {
  bankId: string;
  updatedAt: string;
  package: QuestionBankPackage;
  /** 若该库来自线上 ZIP 下载，记录下载地址：同地址重复下载按"更新原库"处理 */
  sourceUrl?: string;
}

export interface QuestionFilter {
  tagId?: TagId;
  /** 标签多选（§6.4 并集，父标签自动含子孙、父子同选去重）；与 tagId 同时给出时在其范围内进一步收窄 */
  tagIds?: TagId[];
  /** 难度多选（§6.3 并集）；空数组/缺省 = 不限 */
  difficulties?: Difficulty[];
  query?: string;
  /** 分类筛选（§5.1）；题库未提供分类时该字段无意义。 */
  categoryId?: string;
}

export interface InstallationProgress {
  completed: number;
  total: number;
  label: string;
}

export type InstallationProgressListener = (progress: InstallationProgress) => void;

export interface InstallResult {
  questionCount: number;
  tagCount: number;
  /** installFromUrl 专属：下载即本地化产出的题库源（调用方负责落盘 local-sources） */
  localSource?: LocalBankSource;
}

/** 已安装题库的摘要（listBanks 返回） */
export interface InstalledBankSummary {
  /** 题库 catalog.id；本地题库约定以 local- 前缀开头 */
  catalogId: string;
  /** 存储命名空间（内部标识） */
  namespace: string;
  title: string;
  questionCount: number;
  source: 'local' | 'online';
  /** 是否为当前激活（active 指针指向）的题库 */
  active: boolean;
  /** 题库规范 bank.version；旧格式库可能没有 */
  version?: string;
  /** 题库规范 bank.updatedAt（ISO 字符串）；旧格式库可能没有 */
  updatedAt?: string;
  /** 线上下载来源地址；存在即可在管理弹窗里在线更新（来自本地源文件） */
  sourceUrl?: string;
}

export interface QuestionBankRepository {
  /** Return the installed catalog, or null when this device has no bank. */
  getCatalog(): Promise<QuestionBankCatalog | null>;
  /** Return metadata for one installed question. */
  getQuestion(id: QuestionId): Promise<Question | null>;
  /** Return Markdown for one installed question. */
  getContent(id: QuestionId): Promise<QuestionContent | null>;
  /** Filter local metadata. This method never performs network I/O. */
  listQuestions(filter?: QuestionFilter): Promise<Question[]>;
  /**
   * 正文全文搜索（§6.2）：在安装期生成的语料里检索，返回命中题目与命中次数。
   * 不走网络；题库没有语料（旧安装或无正文）时返回空数组。
   */
  searchBody(query: string): Promise<{ id: QuestionId; hits: number; snippet: string | null }[]>;
  /** Install a complete package with an atomic active-pointer switch. */
  install(
    questionBank: QuestionBankPackage,
    onProgress?: InstallationProgressListener,
  ): Promise<InstallResult>;
  /** Remove the installed bank. Favorites and user progress are unaffected. */
  clear(): Promise<void>;
  /** 列出本机全部已安装题库（多题库共存；本地 + 线上）。 */
  listBanks(): Promise<InstalledBankSummary[]>;
  /** 读取指定题库的题目 id 集合（在线更新前后对比用）；题库不存在返回 null */
  getQuestionIds(catalogId: string): Promise<Set<string> | null>;
  /** 把当前使用的题库切换为指定 catalog.id 的题库。 */
  switchBank(catalogId: string): Promise<void>;
  /** 删除一个已安装题库；若删除的是当前题库，自动切到剩余题库或清空。 */
  deleteBank(catalogId: string): Promise<void>;
  /**
   * 把已装题库反向重建为完整包（含每题 followupsMd），供「复制为本地题库」。
   * 找不到题库返回 null；题库数据损坏时抛错。
   */
  exportPackage(catalogId: string): Promise<QuestionBankPackage | null>;
  /** 复制源题库的题目图片资产到目标题库（尽力而为，缺资产时逐题跳过）。 */
  copyBankAssets(sourceCatalogId: string, targetCatalogId: string): Promise<void>;
  /**
   * 把本机全部本地题库（catalog.id 带 local- 前缀）的图片资产拷到备份暂存目录，
   * 布局为 <targetAssetsRoot>/<catalogId>/<questionId>/assets/…。尽力而为，返回涉题库数。
   */
  stageLocalBankAssets(targetAssetsRoot: string): Promise<number>;
  /** 从备份源 id 读取图片并回填到目标题库；冲突导入时两者不同。 */
  restoreBankAssets(assetsRoot: string, sourceCatalogId: string, targetCatalogId: string): Promise<void>;
}

export interface RemoteQuestionBankRepository extends QuestionBankRepository {
  installFromUrl(
    url: string,
    onProgress?: InstallationProgressListener,
    options?: { reuseCatalogId?: string },
  ): Promise<InstallResult>;
}
