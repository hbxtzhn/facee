import { describe, it, expect } from '@jest/globals';
import {
  DEFAULT_EXTRACTION_REQUIREMENTS,
  buildExtractionUserPrompt,
  extractQuestionsFromChunks,
  fetchModelIds,
  LLM_PRESETS,
  parseGeneratedQuestions,
  parseRewrittenQuestion,
  rewriteQuestion,
  validateConfig,
  type LlmConfig,
} from './llm';

const CONFIG: LlmConfig = { baseUrl: 'https://api.example.com/v1/', apiKey: 'sk-test', model: 'test-model' };

function jsonResponse(content: string, ok = true, status = 200) {
  return {
    ok,
    status,
    text: async () => JSON.stringify({ choices: [{ message: { content } }] }),
  };
}

const KP3 = [{ text: '惰性删除', weight: 2 }, { text: '定期删除', weight: 2 }, { text: '内存淘汰兜底', weight: 1 }];
const GOOD = {
  title: 'Redis 过期 key 怎么删？',
  type: 'concept',
  difficulty: 'medium',
  prompt: null,
  summary: '惰性删除与定期删除组合清理过期 key。',
  keyPoints: KP3,
  detail: '### 惰性删除\n访问时检查。',
  pitfalls: ['混淆过期删除与内存淘汰'],
  followups: [{ q: '大量 key 同时过期？', a: '加随机偏移。' }],
};

describe('parseGeneratedQuestions（v2 结构）', () => {
  it('解析裸 JSON 数组为 v2 草稿', () => {
    const drafts = parseGeneratedQuestions(JSON.stringify([GOOD]));
    expect(drafts).toEqual([{ ...GOOD, notes: [] }]);
  });

  it('剥掉 Markdown 代码栏与前后废话', () => {
    const raw = ['好的，以下是提取结果：', '```json', JSON.stringify([GOOD]), '```'].join('\n');
    expect(parseGeneratedQuestions(raw)).toHaveLength(1);
  });

  it('畸形输出规范化：要点字符串 / 重复 / 超 5 条截取、权重与难度与题型兜底、追问缺答案丢弃', () => {
    const raw = JSON.stringify([{
      title: '  题  ',
      type: 'choice',
      difficulty: 3,
      summary: '结论',
      keyPoints: ['一', '一', { text: '二', weight: '核心' }, { text: '三', weight: 9 }, '四', '五', '六'],
      pitfalls: ['坑', 3, '坑'],
      followups: [{ q: '追问', a: '' }, { question: '旧字段追问', answer: '答' }],
    }]);
    const [draft] = parseGeneratedQuestions(raw);
    expect(draft.title).toBe('题');
    expect(draft.type).toBe('concept');
    expect(draft.difficulty).toBe('hard');
    expect(draft.keyPoints).toEqual([
      { text: '一', weight: 1 }, { text: '二', weight: 3 }, { text: '三', weight: 1 }, { text: '四', weight: 1 }, { text: '五', weight: 1 },
    ]);
    expect(draft.pitfalls).toEqual(['坑']);
    expect(draft.followups).toEqual([{ q: '旧字段追问', a: '答' }]);
    expect(draft.notes).toEqual(['要点超过 5 条，只保留前 5 条']);
    expect(draft.prompt).toBeNull();
    expect(draft.detail).toBeNull();
  });

  it('一句话超过 80 字、要点超过 40 字时截断并记录', () => {
    const [draft] = parseGeneratedQuestions(JSON.stringify([{ ...GOOD, summary: '长'.repeat(100), keyPoints: [...KP3, { text: '字'.repeat(50), weight: 1 }] }]));
    expect(draft.summary).toBe('长'.repeat(80));
    expect(draft.keyPoints[3].text).toBe('字'.repeat(40));
    expect(draft.notes).toEqual(['一句话超过 80 字，已截断', '有要点超过 40 字，已截断']);
  });

  it('缺标题 / 缺一句话 / 要点不足 3 条的条目被跳过', () => {
    const raw = JSON.stringify([
      { ...GOOD, title: '' },
      { ...GOOD, summary: undefined },
      { ...GOOD, keyPoints: ['只有', '两条'] },
      { ...GOOD, keyPoints: 'not-an-array' },
      'garbage',
      null,
      GOOD,
    ]);
    expect(parseGeneratedQuestions(raw)).toHaveLength(1);
  });

  it('旧格式（question / answer 字符串）兼容为 prompt / detail，但仍要求一句话与要点', () => {
    const [draft] = parseGeneratedQuestions(JSON.stringify([{ title: 't', question: '题干', answer: '答案', summary: 's', keyPoints: ['a', 'b', 'c'] }]));
    expect(draft).toMatchObject({ prompt: '题干', detail: '答案', difficulty: 'medium' });
    expect(parseGeneratedQuestions(JSON.stringify([{ title: 't', question: '题干', answer: '答案' }]))).toEqual([]);
  });

  it('完全不是 JSON 时返回空数组而不抛错', () => {
    expect(parseGeneratedQuestions('抱歉我做不到')).toEqual([]);
    expect(parseGeneratedQuestions('')).toEqual([]);
    expect(parseGeneratedQuestions('[{"title": "坏 JSON",]')).toEqual([]);
  });
});

describe('extractQuestionsFromChunks', () => {
  it('逐块调用并汇总，进度按块推进', async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(url);
      return jsonResponse(`[${JSON.stringify({ ...GOOD, title: `题-${calls.length}` })}]`);
    };

    const drafts = await extractQuestionsFromChunks(CONFIG, ['第一块资料', '第二块资料'], {
      fetchImpl,
      onProgress: () => undefined,
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toBe('https://api.example.com/v1/chat/completions');
    expect(drafts.map((draft) => draft.title)).toEqual(['题-1', '题-2']);
  });

  it('请求体带模型、Bearer Key 与系统提示词；提示词要求 v2 字段', async () => {
    let capturedInit: { method?: string; headers?: Record<string, string>; body?: string } | undefined;
    const fetchImpl = async (_url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
      capturedInit = init;
      return jsonResponse('[]');
    };
    await extractQuestionsFromChunks(CONFIG, ['资料'], { fetchImpl });

    expect(capturedInit?.method).toBe('POST');
    expect(capturedInit?.headers?.Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(capturedInit?.body ?? '{}') as {
      model: string;
      messages: { role: string; content: string }[];
    };
    expect(body.model).toBe('test-model');
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].role).toBe('user');
    expect(body.messages[1].content).toContain('【资料开始】');
    for (const field of ['"summary"', '"keyPoints"', '"weight"', '"pitfalls"', '"followups"', 'keyPoints 必须 3–5 条']) {
      expect(body.messages[1].content).toContain(field);
    }
  });

  it('首块失败自动重试一次，两次都失败时报出块序号', async () => {
    let attempts = 0;
    const retryingFetch = async () => {
      attempts += 1;
      if (attempts === 1) return { ok: false, status: 500, text: async () => 'boom' };
      return jsonResponse('[]');
    };
    await expect(
      extractQuestionsFromChunks(CONFIG, ['资料'], { fetchImpl: retryingFetch }),
    ).resolves.toEqual([]);
    expect(attempts).toBe(2);

    const alwaysFailing = async () => ({ ok: false, status: 500, text: async () => 'boom' });
    await expect(
      extractQuestionsFromChunks(CONFIG, ['块一', '块二'], { fetchImpl: alwaysFailing }),
    ).rejects.toThrow('第 1/2 段抽取失败');
  });

  it('配置不合法时直接拒绝', async () => {
    await expect(
      extractQuestionsFromChunks({ baseUrl: 'api.example.com', apiKey: 'k', model: 'm' }, ['资料'], {}),
    ).rejects.toThrow('http');
  });
});

describe('parseRewrittenQuestion / rewriteQuestion - AI 改写单题', () => {
  const ORIGINAL = {
    title: '原题',
    prompt: '原题补充',
    summary: '原结论',
    keyPoints: [{ text: '原要点一', weight: 2 as const }],
    detail: null,
    pitfalls: [],
    followups: [],
  };

  it('解析裸 JSON 对象', () => {
    const draft = parseRewrittenQuestion(JSON.stringify(GOOD));
    expect(draft).toMatchObject({ title: GOOD.title, difficulty: 'medium', summary: GOOD.summary });
  });

  it('解析代码栏包裹、前后带话的对象', () => {
    const raw = `好的，这是改写后的版本：\n\`\`\`json\n${JSON.stringify(GOOD)}\n\`\`\`\n希望有帮助。`;
    expect(parseRewrittenQuestion(raw)?.title).toBe(GOOD.title);
  });

  it('模型把单题包进数组时也能取到', () => {
    expect(parseRewrittenQuestion(JSON.stringify([GOOD]))?.title).toBe(GOOD.title);
  });

  it('不满足规范（缺标题 / 要点不足）返回 null', () => {
    expect(parseRewrittenQuestion(JSON.stringify({ ...GOOD, title: '' }))).toBeNull();
    expect(parseRewrittenQuestion(JSON.stringify({ ...GOOD, keyPoints: ['一'] }))).toBeNull();
    expect(parseRewrittenQuestion('完全不是 JSON')).toBeNull();
  });

  it('rewriteQuestion 调用 chat 并把原题结构与用户要求放进提示词', async () => {
    let capturedBody = '';
    const fetchImpl = async (_url: string, init?: { body?: string }) => {
      capturedBody = init?.body ?? '';
      return jsonResponse(JSON.stringify(GOOD));
    };

    const draft = await rewriteQuestion(CONFIG, ORIGINAL, { instruction: '更难一点', fetchImpl });

    expect(draft.title).toBe(GOOD.title);
    const userPrompt = (JSON.parse(capturedBody) as { messages: { content: string }[] }).messages[1].content;
    expect(userPrompt).toContain('原题补充');
    expect(userPrompt).toContain('[权重 2] 原要点一');
    expect(userPrompt).toContain('更难一点');
    expect(userPrompt).toContain('"keyPoints"');
    expect(userPrompt).toContain('【原题开始】');
  });

  it('模型输出解析失败时抛可读错误', async () => {
    const fetchImpl = async () => jsonResponse('我也说不清楚');
    await expect(rewriteQuestion(CONFIG, ORIGINAL, { fetchImpl })).rejects.toThrow('无法解析');
  });
});


describe('validateConfig / presets', () => {
  it('校验地址协议、Key 与模型名', () => {
    expect(() => validateConfig(CONFIG)).not.toThrow();
    expect(() => validateConfig({ ...CONFIG, baseUrl: '' })).toThrow();
    expect(() => validateConfig({ ...CONFIG, apiKey: ' ' })).toThrow('Key');
    expect(() => validateConfig({ ...CONFIG, model: '' })).toThrow('模型');
  });

  it('预设地址都是 https 且不含 /chat/completions 后缀', () => {
    for (const preset of LLM_PRESETS) {
      if (preset.id === 'custom') continue;
      expect(preset.baseUrl.startsWith('https://')).toBe(true);
      expect(preset.baseUrl.endsWith('/chat/completions')).toBe(false);
    }
  });

  it('用户提示词包含字段说明与资料边界', () => {
    const prompt = buildExtractionUserPrompt('一段资料');
    expect(prompt).toContain('"title"');
    expect(prompt).toContain('【资料开始】');
    expect(prompt).toContain('一段资料');
  });

  it('默认提示词包含默认抽取要求与固定格式段', () => {
    const prompt = buildExtractionUserPrompt('一段资料');
    expect(prompt).toContain(DEFAULT_EXTRACTION_REQUIREMENTS);
    expect(prompt).toContain('【输出格式（固定要求，必须遵守，不得修改）】');
    expect(prompt).toContain('【资料开始】');
  });

  it('自定义抽取要求替换默认要求，格式段原样保留', () => {
    const prompt = buildExtractionUserPrompt('一段资料', '只要 HTTP 与网络相关的题，答案分点作答');
    expect(prompt).toContain('只要 HTTP 与网络相关的题，答案分点作答');
    expect(prompt).not.toContain(DEFAULT_EXTRACTION_REQUIREMENTS);
    // 格式契约段不受用户要求影响
    expect(prompt).toContain('"difficulty"');
    expect(prompt).toContain('只输出 JSON 本身');
  });

  it('抽取要求为空白时回退默认', () => {
    expect(buildExtractionUserPrompt('资料', '   ')).toContain(DEFAULT_EXTRACTION_REQUIREMENTS);
  });

  it('extractQuestionsFromChunks 把自定义抽取要求带进请求体', async () => {
    let capturedBody = '';
    const fetchImpl = async (_url: string, init?: { body?: string }) => {
      capturedBody = init?.body ?? '';
      return jsonResponse('[]');
    };
    await extractQuestionsFromChunks(CONFIG, ['资料'], { fetchImpl, requirements: '多抽基础题' });
    const content = (JSON.parse(capturedBody) as { messages: { content: string }[] }).messages[1].content;
    expect(content).toContain('多抽基础题');
    expect(content).toContain('"title"');
  });
});

describe('fetchModelIds - 按 Key 拉取模型列表', () => {
  it('请求 /models 并带 Bearer Key，返回排序去重的模型 id', async () => {
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> | undefined;
    const fetchImpl = async (url: string, init?: { headers?: Record<string, string> }) => {
      capturedUrl = url;
      capturedHeaders = init?.headers;
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ object: 'list', data: [{ id: 'model-b' }, { id: 'model-a' }, { id: 'model-a' }, {}] }),
      };
    };

    const ids = await fetchModelIds(CONFIG, fetchImpl);
    expect(capturedUrl).toBe('https://api.example.com/v1/models');
    expect(capturedHeaders?.Authorization).toBe('Bearer sk-test');
    expect(ids).toEqual(['model-a', 'model-b']);
  });

  it('HTTP 错误抛出带状态码的信息；坏 Key 场景同理', async () => {
    const fetchImpl = async () => ({ ok: false, status: 401, text: async () => 'invalid key' });
    await expect(fetchModelIds(CONFIG, fetchImpl)).rejects.toThrow('HTTP 401');
  });

  it('缺 Key 或地址非法时直接拒绝，不打网络', async () => {
    let called = 0;
    const fetchImpl = async () => {
      called += 1;
      return { ok: true, status: 200, text: async () => '{"data":[]}' };
    };
    await expect(fetchModelIds({ ...CONFIG, apiKey: ' ' }, fetchImpl)).rejects.toThrow('Key');
    await expect(fetchModelIds({ ...CONFIG, baseUrl: 'api.example.com' }, fetchImpl)).rejects.toThrow('http');
    expect(called).toBe(0);
  });

  it('非 /models 结构或空列表时报错', async () => {
    const notList = async () => ({ ok: true, status: 200, text: async () => '{"object":"list"}' });
    await expect(fetchModelIds(CONFIG, notList)).rejects.toThrow('/models');
    const empty = async () => ({ ok: true, status: 200, text: async () => '{"data":[]}' });
    await expect(fetchModelIds(CONFIG, empty)).rejects.toThrow('没有返回可用模型');
  });
});
