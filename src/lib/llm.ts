/**
 * LLM 题目抽取：OpenAI 兼容 /chat/completions 端点（非流式）。
 *
 * 用户在「AI 设置」里自填 服务地址 + Key + 模型名（DeepSeek / 智谱 / Kimi
 * 等全部兼容该协议），原生 Key 存系统安全存储。本文件是纯逻辑：
 * 网络调用可注入（fetchImpl），解析与规范化可单测。
 */

import { withNetworkTimeout } from './network';
import { inspectImageBase64, type LlmImageInput } from './import-image';
import { clipSpecChars, countSpecChars } from './import-text';
import type { Difficulty, KeyPointWeight, QuestionType } from '../bank/types';

export interface LlmConfig {
  /** 例如 https://api.deepseek.com/v1（不含 /chat/completions） */
  baseUrl: string;
  apiKey: string;
  model: string;
}

/**
 * LLM 抽取出的 v2 结构题目草稿（尚未写入题库；题目 / 要点 / 追问 id 由数据层分配）。
 * 已按规范规范化：要点 3–5 条、一句话 ≤ 80 字、要点 ≤ 40 字；做过的修正记在 notes 里供预览提示。
 */
export interface GeneratedQuestionDraft {
  title: string;
  /** 不含 choice（AI 导入不生成选项） */
  type: Exclude<QuestionType, 'choice'>;
  difficulty: Difficulty;
  /** 标题之外的补充（Markdown），无则 null */
  prompt: string | null;
  summary: string;
  keyPoints: Array<{ text: string; weight: KeyPointWeight }>;
  detail: string | null;
  pitfalls: string[];
  followups: Array<{ q: string; a: string }>;
  /** 规范化时做过的修正（截断等），预览时提示用户核对 */
  notes: string[];
}

export const DRAFT_SUMMARY_LIMIT = 80;
export const DRAFT_KEY_POINT_LIMIT = 40;
export const DRAFT_MIN_KEY_POINTS = 3;
export const DRAFT_MAX_KEY_POINTS = 5;

export interface LlmPreset {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
}

export const LLM_PRESETS: LlmPreset[] = [
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { id: 'zhipu', label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { id: 'moonshot', label: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { id: 'custom', label: '自定义', baseUrl: '', model: '' },
];

type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

export interface ExtractOptions {
  onProgress?: (completedChunks: number, totalChunks: number) => void;
  fetchImpl?: FetchLike;
  /** 用户自定义的抽取要求（导入弹窗里可编辑）；空/空白时用默认值 */
  requirements?: string;
  signal?: AbortSignal;
}

const SYSTEM_PROMPT = '你是面试题库编辑。只输出 JSON，不要输出任何解释文字或 Markdown 代码栏。';

/** 默认抽取要求：导入弹窗里可整段修改；输出格式段不在其中，由 App 固定追加 */
export const DEFAULT_EXTRACTION_REQUIREMENTS =
  '只提取资料真实覆盖的题目，不要编造资料里没有的内容；答案要忠实于资料。';

/** 输出格式段（写死）：JSON 字段结构是 App 解析的契约，不随用户的抽取要求变化 */
const EXTRACTION_FORMAT_LINES = [
  '【输出格式（固定要求，必须遵守，不得修改）】',
  '1. 每道题输出一个 JSON 对象，字段固定为：',
  '   {"title": "题目标题（一句话，不超过 60 字）", "type": "concept|scenario|coding|design|behavioral 之一", "difficulty": "easy|medium|hard 之一", "prompt": "标题之外的补充：场景、约束、给定代码（Markdown；没有填 null）", "summary": "一句话结论（纯文本，1–2 句，不超过 80 字）", "keyPoints": [{"text": "答题要点（纯文本，不超过 40 字）", "weight": 1}], "detail": "详解（Markdown，代码块标注语言；没有填 null）", "pitfalls": ["易错点（纯文本）"], "followups": [{"q": "追问问题", "a": "追问答案（Markdown，不超过 150 字）"}]}',
  '2. keyPoints 必须 3–5 条；weight 取 1（加分项）、2（重要）或 3（核心）。summary 与 keyPoints 必填，资料无法支撑答案的题目不要输出。',
  '3. 输出一个 JSON 数组，只输出 JSON 本身，不要任何解释或 Markdown 代码栏。',
];

/** 从一段资料中抽取面试题的用户提示词；requirements 为用户在导入弹窗里编辑的抽取要求 */
export function buildExtractionUserPrompt(chunk: string, requirements?: string): string {
  const effectiveRequirements = requirements?.trim() ? requirements.trim() : DEFAULT_EXTRACTION_REQUIREMENTS;
  return [
    '从下面的面试资料中提取面试题目。',
    '',
    '【抽取要求】',
    effectiveRequirements,
    '',
    ...EXTRACTION_FORMAT_LINES,
    '',
    '【资料开始】',
    chunk,
    '【资料结束】',
  ].join('\n');
}

/**
 * 逐块抽取题目（顺序执行，避免触发限流）。每块失败自动重试一次，
 * 仍失败则抛出带块序号的错误（UI 可让用户重试整个导入）。
 */
export async function extractQuestionsFromChunks(
  config: LlmConfig,
  chunks: readonly string[],
  options: ExtractOptions = {},
): Promise<GeneratedQuestionDraft[]> {
  validateConfig(config);
  const doFetch = options.fetchImpl ?? fetch;
  const drafts: GeneratedQuestionDraft[] = [];

  for (let index = 0; index < chunks.length; index += 1) {
    let lastError: unknown = null;
    let raw: string | null = null;
    for (let attempt = 0; attempt < 2 && raw === null; attempt += 1) {
      try {
        raw = await callChatCompletion(doFetch, config, buildExtractionUserPrompt(chunks[index], options.requirements), options.signal);
      } catch (error) {
        if (options.signal?.aborted) throw error;
        lastError = error;
      }
    }
    if (raw === null) {
      throw new Error(
        `第 ${index + 1}/${chunks.length} 段抽取失败：${lastError instanceof Error ? lastError.message : String(lastError)}`,
      );
    }
    drafts.push(...parseGeneratedQuestions(raw));
    options.onProgress?.(index + 1, chunks.length);
  }
  return drafts;
}

/** 单张图片视觉抽取。图片上传只请求一次，避免自动重试导致重复计费。 */
export async function extractQuestionsFromImage(
  config: LlmConfig,
  image: LlmImageInput,
  options: ExtractOptions = {},
): Promise<GeneratedQuestionDraft[]> {
  validateConfig(config);
  if (inspectImageBase64(image.base64) !== image.mimeType) throw new Error('图片内容与类型不一致，请重新选择');
  const prompt = buildExtractionUserPrompt(
    '资料是本消息附带的图片。请阅读图片中的题目和答案；保留公式、选项与上下文。看不清的内容不要猜测；无法给出要点的题目不要输出。',
    options.requirements,
  );
  const raw = await callChatCompletion(options.fetchImpl ?? fetch, config, [
    { type: 'text', text: prompt },
    { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.base64}`, detail: 'auto' } },
  ], options.signal);
  const drafts = parseGeneratedQuestions(raw);
  options.onProgress?.(1, 1);
  return drafts;
}

export function validateConfig(config: LlmConfig): void {
  const baseUrl = config.baseUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(baseUrl)) throw new Error('AI 服务地址必须以 http(s):// 开头');
  if (!config.apiKey.trim()) throw new Error('请先在「AI 设置」中填写 API Key');
  if (!config.model.trim()) throw new Error('请先在「AI 设置」中填写模型名');
}

/**
 * 用 Key 拉取可用模型列表（OpenAI 兼容 GET /models）。
 * 供「AI 设置」的「获取模型列表」按钮使用；Key 错误 / 地址不对时抛带状态码的错误。
 */
export async function fetchModelIds(config: LlmConfig, fetchImpl?: FetchLike): Promise<string[]> {
  const doFetch = fetchImpl ?? fetch;
  const baseUrl = config.baseUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(baseUrl)) throw new Error('AI 服务地址必须以 http(s):// 开头');
  if (!config.apiKey.trim()) throw new Error('请先填写 API Key 再获取模型列表');

  const { response, body } = await withNetworkTimeout(async (signal) => {
    const response = await doFetch(`${baseUrl}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${config.apiKey.trim()}` },
      signal,
    });
    return { response, body: await response.text() };
  });
  if (!response.ok) {
    throw new Error(`获取模型列表失败（HTTP ${response.status}）${body.slice(0, 120)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('模型列表响应不是合法 JSON');
  }
  const data = (parsed as { data?: unknown }).data;
  if (!Array.isArray(data)) throw new Error('响应不是 OpenAI /models 结构（缺少 data 数组）');
  const ids = [
    ...new Set(
      data
        .map((item) => (typeof (item as { id?: unknown })?.id === 'string' ? ((item as { id: string }).id).trim() : ''))
        .filter((id) => id.length > 0),
    ),
  ].sort((left, right) => left.localeCompare(right));
  if (ids.length === 0) throw new Error('该服务没有返回可用模型');
  return ids;
}

type ChatUserContent = string | (
  { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail: 'auto' } }
)[];

async function callChatCompletion(
  doFetch: FetchLike,
  config: LlmConfig,
  userPrompt: ChatUserContent,
  signal?: AbortSignal,
): Promise<string> {
  const url = `${config.baseUrl.trim().replace(/\/+$/, '')}/chat/completions`;
  const { response, body } = await withNetworkTimeout(async (requestSignal) => {
    const response = await doFetch(url, {
      signal: requestSignal,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: config.model.trim(),
        stream: false,
        temperature: 0.2,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    return { response, body: await response.text() };
  }, { timeoutMs: 60_000, signal });
  if (!response.ok) {
    // 图片错误响应可能回显原图数据，不将其展示或记录。
    if (Array.isArray(userPrompt)) throw new Error(`HTTP ${response.status}：图片请求失败，请确认服务与模型支持图片输入`);
    throw new Error(`HTTP ${response.status} ${body.slice(0, 160)}`);
  }
  const parsed = JSON.parse(body) as { choices?: { message?: { content?: unknown } }[] };
  const content = parsed.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('模型返回为空');
  }
  return content;
}

/**
 * 容错解析模型输出：剥 Markdown 代码栏；无 fenced 时截取首个「[」到最后一个「]」。
 * 单条不合法（缺标题 / 缺一句话 / 要点不足 3 条）直接跳过，不让一条坏数据毁掉整块结果；规范化见 normalizeDraft。
 */
export function parseGeneratedQuestions(raw: string): GeneratedQuestionDraft[] {
  const jsonArrayText = extractJsonArrayText(raw);
  if (jsonArrayText === null) return [];

  let value: unknown;
  try {
    value = JSON.parse(jsonArrayText);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];

  const drafts: GeneratedQuestionDraft[] = [];
  for (const item of value) {
    const draft = normalizeDraft(item);
    if (draft) drafts.push(draft);
  }
  return drafts;
}

function extractJsonArrayText(raw: string): string | null {
  const trimmed = raw.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
  const start = withoutFence.indexOf('[');
  const end = withoutFence.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  return withoutFence.slice(start, end + 1);
}

const QUESTION_TYPES_FOR_DRAFT = ['concept', 'scenario', 'coding', 'design', 'behavioral'] as const;

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const markdownOrNull = (value: unknown): string | null => (text(value) ? text(value) : null);

function normalizeWeight(value: unknown): KeyPointWeight {
  if (value === 3 || value === '3' || value === '核心') return 3;
  if (value === 2 || value === '2' || value === '重要') return 2;
  return 1;
}

function normalizeType(value: unknown): GeneratedQuestionDraft['type'] {
  const candidate = text(value).toLowerCase();
  return (QUESTION_TYPES_FOR_DRAFT as readonly string[]).includes(candidate)
    ? (candidate as GeneratedQuestionDraft['type'])
    : 'concept';
}

function normalizeDifficulty(value: unknown): Difficulty {
  if (value === 1 || value === '1' || value === 'easy') return 'easy';
  if (value === 3 || value === '3' || value === 'hard') return 'hard';
  return 'medium'; // medium / 2 / 未识别一律归中
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(text).filter(Boolean))];
}

/**
 * 规范化单条模型输出为 v2 草稿；无法满足硬性规则（缺标题 / 缺一句话 / 要点不足 3 条）返回 null。
 * 可修复的偏差就地修正并记入 notes：一句话超 80 字截断、要点超 40 字截断、要点超过 5 条只留前 5 条。
 */
export function normalizeDraft(item: unknown): GeneratedQuestionDraft | null {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) return null;
  const record = item as Record<string, unknown>;
  const answer = typeof record.answer === 'object' && record.answer !== null ? (record.answer as Record<string, unknown>) : {};
  const title = text(record.title);
  let summary = text(record.summary ?? answer.summary).replace(/\s+/g, ' ');
  if (!title || !summary) return null;
  const notes: string[] = [];

  if (countSpecChars(summary) > DRAFT_SUMMARY_LIMIT) {
    summary = clipSpecChars(summary, DRAFT_SUMMARY_LIMIT);
    notes.push(`一句话超过 ${DRAFT_SUMMARY_LIMIT} 字，已截断`);
  }

  const rawKeyPoints = Array.isArray(record.keyPoints) ? record.keyPoints : Array.isArray(answer.keyPoints) ? answer.keyPoints : [];
  const seen = new Set<string>();
  let clippedKeyPoint = false;
  let keyPoints: GeneratedQuestionDraft['keyPoints'] = [];
  for (const entry of rawKeyPoints) {
    const isObject = typeof entry === 'object' && entry !== null;
    let kpText = text(isObject ? (entry as Record<string, unknown>).text : entry).replace(/\s+/g, ' ');
    if (!kpText || seen.has(kpText)) continue;
    seen.add(kpText);
    if (countSpecChars(kpText) > DRAFT_KEY_POINT_LIMIT) {
      kpText = clipSpecChars(kpText, DRAFT_KEY_POINT_LIMIT);
      clippedKeyPoint = true;
    }
    keyPoints.push({ text: kpText, weight: normalizeWeight(isObject ? (entry as Record<string, unknown>).weight : undefined) });
  }
  if (keyPoints.length < DRAFT_MIN_KEY_POINTS) return null;
  if (clippedKeyPoint) notes.push(`有要点超过 ${DRAFT_KEY_POINT_LIMIT} 字，已截断`);
  if (keyPoints.length > DRAFT_MAX_KEY_POINTS) {
    notes.push(`要点超过 ${DRAFT_MAX_KEY_POINTS} 条，只保留前 ${DRAFT_MAX_KEY_POINTS} 条`);
    keyPoints = keyPoints.slice(0, DRAFT_MAX_KEY_POINTS);
  }

  const followups: GeneratedQuestionDraft['followups'] = [];
  if (Array.isArray(record.followups)) {
    for (const entry of record.followups) {
      if (typeof entry !== 'object' || entry === null) continue;
      const f = entry as Record<string, unknown>;
      const q = text(f.q ?? f.question);
      const a = text(f.a ?? f.answer);
      if (q && a) followups.push({ q, a });
    }
  }

  return {
    title: title.slice(0, 200),
    type: normalizeType(record.type),
    difficulty: normalizeDifficulty(record.difficulty),
    prompt: markdownOrNull(record.prompt ?? record.question),
    summary,
    keyPoints,
    detail: markdownOrNull(record.detail ?? answer.detail ?? (typeof record.answer === 'string' ? record.answer : null)),
    pitfalls: stringList(record.pitfalls ?? answer.pitfalls),
    followups,
    notes,
  };
}

/** 待改写的现有题目（编辑表单当前内容） */
export interface RewriteQuestionInput {
  title: string;
  prompt: string | null;
  summary: string;
  keyPoints: Array<{ text: string; weight: KeyPointWeight }>;
  detail: string | null;
  pitfalls: string[];
  followups: Array<{ q: string; a: string }>;
}

/** 「AI 改写此题」的用户提示词；instruction 是用户的额外要求，可留空 */
export function buildRewriteUserPrompt(question: RewriteQuestionInput, instruction: string): string {
  const lines = [
    '下面是一道现有的面试题。请重写一份更好的版本：题意更清晰、贴近真实面试提问方式，',
    '结论更精炼、要点更准确有区分度，但**保持题目主题与考查点不变**，不要换题。',
  ];
  if (instruction.trim()) {
    lines.push(`用户的额外要求（优先满足）：${instruction.trim()}`);
  }
  lines.push(
    '输出一个 JSON 对象，字段固定为：',
    EXTRACTION_FORMAT_LINES[1].trim(),
    EXTRACTION_FORMAT_LINES[2].replace(/^2\. /, ''),
    '只输出 JSON 本身，不要解释或代码栏。',
    '',
    '【原题开始】',
    `标题：${question.title}`,
    question.prompt ? `补充：\n${question.prompt}` : '补充：（无）',
    `一句话：${question.summary || '（无）'}`,
    '要点：',
    ...(question.keyPoints.length > 0
      ? question.keyPoints.map((kp) => `- [权重 ${kp.weight}] ${kp.text}`)
      : ['（无）']),
    question.detail ? `详解：\n${question.detail}` : '详解：（无）',
    question.pitfalls.length > 0 ? `易错点：${question.pitfalls.join('；')}` : '',
    ...question.followups.map((f) => `追问：${f.q}\n答：${f.a}`),
    '【原题结束】',
  );
  return lines.filter((line) => line !== '').join('\n');
}

/** 容错解析改写结果：模型可能输出裸对象或包一层数组；解析不出或不满足规范返回 null */
export function parseRewrittenQuestion(raw: string): GeneratedQuestionDraft | null {
  const trimmed = raw.trim();
  const withoutFence = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();

  const tryParse = (input: string): unknown => {
    try {
      return JSON.parse(input);
    } catch {
      return undefined;
    }
  };

  let value = tryParse(withoutFence);
  if (value === undefined) {
    const objectStart = withoutFence.indexOf('{');
    const objectEnd = withoutFence.lastIndexOf('}');
    if (objectStart >= 0 && objectEnd > objectStart) {
      value = tryParse(withoutFence.slice(objectStart, objectEnd + 1));
    }
  }
  if (value === undefined) {
    // 兜底：按数组再试一次（模型偶发把单题包进数组）
    const drafts = parseGeneratedQuestions(withoutFence);
    return drafts[0] ?? null;
  }
  if (Array.isArray(value)) return normalizeDraft(value[0]);
  return normalizeDraft(value);
}

/** AI 改写一道现有题目，返回新版本草稿（不直接落库，由 UI 让用户二选一） */
export async function rewriteQuestion(
  config: LlmConfig,
  question: RewriteQuestionInput,
  options: { instruction?: string; fetchImpl?: FetchLike; signal?: AbortSignal } = {},
): Promise<GeneratedQuestionDraft> {
  const doFetch = options.fetchImpl ?? fetch;
  validateConfig(config);
  const raw = await callChatCompletion(doFetch, config, buildRewriteUserPrompt(question, options.instruction ?? ''), options.signal);
  const draft = parseRewrittenQuestion(raw);
  if (!draft) throw new Error('模型返回的内容无法解析成符合规范的题目（需要标题、一句话与 3–5 条要点），请重试或换个说法');
  return draft;
}
