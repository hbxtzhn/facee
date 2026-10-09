/**
 * LLM 题目抽取：OpenAI 兼容 /chat/completions 端点（非流式）。
 *
 * 用户在「AI 设置」里自填 服务地址 + Key + 模型名（DeepSeek / 智谱 / Kimi
 * 等全部兼容该协议），原生 Key 存系统安全存储。本文件是纯逻辑：
 * 网络调用可注入（fetchImpl），解析与规范化可单测。
 */

import { withNetworkTimeout } from './network';

export interface LlmConfig {
  /** 例如 https://api.deepseek.com/v1（不含 /chat/completions） */
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** LLM 抽取出的题目草稿（尚未并入题库包；id 由 local-banks 的模型层生成） */
export interface GeneratedQuestionDraft {
  title: string;
  questionMd: string;
  /** 资料没有可用答案时为 null（hasAnswer 将为 false） */
  answerMd: string | null;
  difficulty: 1 | 2 | 3;
  tags: string[];
}

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
  '   {"title": "题目标题（一句话，不超过 60 字）", "question": "题干（Markdown，可包含要求与背景）", "answer": "参考答案（Markdown；资料中没有就填 null）", "difficulty": "easy|medium|hard 之一", "tags": ["1-4 个短标签"]}',
  '2. 输出一个 JSON 数组，只输出 JSON 本身，不要任何解释或 Markdown 代码栏。',
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

async function callChatCompletion(
  doFetch: FetchLike,
  config: LlmConfig,
  userPrompt: string,
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
 * 单条不合法（缺标题/缺题干）直接跳过，不让一条坏数据毁掉整块结果。
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

function normalizeDraft(item: unknown): GeneratedQuestionDraft | null {
  if (typeof item !== 'object' || item === null) return null;
  const record = item as Record<string, unknown>;
  const title = typeof record.title === 'string' ? record.title.trim() : '';
  const question = typeof record.question === 'string' ? record.question.trim() : '';
  if (!title || !question) return null;

  const answer =
    typeof record.answer === 'string' && record.answer.trim().length > 0
      ? record.answer
      : null;

  const difficulty = normalizeDifficulty(record.difficulty);
  const tags = Array.isArray(record.tags)
    ? [...new Set(record.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0).map((tag) => tag.trim()))].slice(0, 4)
    : [];

  return { title: title.slice(0, 200), questionMd: question, answerMd: answer, difficulty, tags };
}

function normalizeDifficulty(value: unknown): 1 | 2 | 3 {
  if (value === 1 || value === '1' || value === 'easy') return 1;
  if (value === 3 || value === '3' || value === 'hard') return 3;
  return 2; // medium / 2 / 未识别一律归中
}

/** 待改写的现有题目（题库里的原版） */
export interface RewriteQuestionInput {
  title: string;
  questionMd: string;
  answerMd: string | null;
  tags?: string[];
}

/** 「AI 改写此题」的用户提示词；instruction 是用户的额外要求，可留空 */
export function buildRewriteUserPrompt(question: RewriteQuestionInput, instruction: string): string {
  const lines = [
    '下面是一道现有的面试题。请重写一份更好的版本：题意更清晰、贴近真实面试提问方式，',
    '答案更完整有条理（分点、给关键概念），但**保持题目主题与考查点不变**，不要换题。',
  ];
  if (instruction.trim()) {
    lines.push(`用户的额外要求（优先满足）：${instruction.trim()}`);
  }
  lines.push(
    '输出一个 JSON 对象，字段固定为：',
    '{"title": "题目标题", "question": "题干（Markdown）", "answer": "参考答案（Markdown；原题没有答案且无法合理补全时填 null）", "difficulty": "easy|medium|hard 之一", "tags": ["1-4 个短标签"]}',
    '只输出 JSON 本身，不要解释或代码栏。',
    '',
    '【原题开始】',
    `标题：${question.title}`,
    `题干：\n${question.questionMd}`,
    question.answerMd ? `参考答案：\n${question.answerMd}` : '参考答案：（无）',
    question.tags?.length ? `标签：${question.tags.join('、')}` : '',
    '【原题结束】',
  );
  return lines.filter((line) => line !== undefined).join('\n');
}

/** 容错解析改写结果：模型可能输出裸对象或包一层数组；解析不出返回 null */
export function parseRewrittenQuestion(raw: string): GeneratedQuestionDraft | null {
  const trimmed = raw.trim();
  const withoutFence = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();

  const tryParse = (text: string): unknown => {
    try {
      return JSON.parse(text);
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
  if (!draft) throw new Error('模型返回的内容无法解析成题目，请重试或换个说法');
  return draft;
}
