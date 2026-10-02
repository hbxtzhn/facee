import { describe, it, expect } from '@jest/globals';
import {
  DEFAULT_EXTRACTION_REQUIREMENTS,
  buildExtractionUserPrompt,
  buildRewriteUserPrompt,
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

describe('parseGeneratedQuestions', () => {
  it('解析裸 JSON 数组', () => {
    const raw = JSON.stringify([
      { title: '什么是 JVM？', question: '介绍 JVM。', answer: 'Java 虚拟机。', difficulty: 'easy', tags: ['JVM'] },
      { title: '难一点的题', question: '题干', answer: null, difficulty: 'hard', tags: [] },
    ]);
    const drafts = parseGeneratedQuestions(raw);
    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toEqual({
      title: '什么是 JVM？',
      questionMd: '介绍 JVM。',
      answerMd: 'Java 虚拟机。',
      difficulty: 1,
      tags: ['JVM'],
    });
    expect(drafts[1]).toMatchObject({ difficulty: 3, answerMd: null });
  });

  it('剥掉 Markdown 代码栏与前后废话', () => {
    const raw = [
      '好的，以下是提取结果：',
      '```json',
      JSON.stringify([{ title: '题', question: '干', answer: '案', difficulty: 2, tags: ['a', 'a', 'b'] }]),
      '```',
    ].join('\n');
    const drafts = parseGeneratedQuestions(raw);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].difficulty).toBe(2);
    // 标签去重
    expect(drafts[0].tags).toEqual(['a', 'b']);
  });

  it('缺失标题或题干的条目被跳过，难度未知归中等', () => {
    const raw = JSON.stringify([
      { question: '没有标题' },
      { title: '没有题干' },
      { title: '默认难度', question: '干', difficulty: '啥也不是' },
    ]);
    const drafts = parseGeneratedQuestions(raw);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].difficulty).toBe(2);
  });

  it('完全不是 JSON 时返回空数组而不抛错', () => {
    expect(parseGeneratedQuestions('抱歉我做不到')).toEqual([]);
    expect(parseGeneratedQuestions('')).toEqual([]);
  });
});

describe('extractQuestionsFromChunks', () => {
  it('逐块调用并汇总，进度按块推进', async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(url);
      return jsonResponse(`[${JSON.stringify({ title: `题-${calls.length}`, question: '干', answer: null, difficulty: 'easy', tags: [] })}]`);
    };

    const drafts = await extractQuestionsFromChunks(CONFIG, ['第一块资料', '第二块资料'], {
      fetchImpl,
      onProgress: () => undefined,
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toBe('https://api.example.com/v1/chat/completions');
    expect(drafts.map((draft) => draft.title)).toEqual(['题-1', '题-2']);
  });

  it('请求体带模型、Bearer Key 与系统提示词', async () => {
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
  const GOOD_OBJECT = {
    title: 'HashMap 在 JDK 8 后做了哪些优化？',
    question: '请结合源码说明。',
    answer: '引入红黑树、扩容优化等。',
    difficulty: 'medium',
    tags: ['Java'],
  };

  it('解析裸 JSON 对象', () => {
    const draft = parseRewrittenQuestion(JSON.stringify(GOOD_OBJECT));
    expect(draft).toMatchObject({ title: GOOD_OBJECT.title, difficulty: 2, answerMd: GOOD_OBJECT.answer });
  });

  it('解析代码栏包裹、前后带话的对象', () => {
    const raw = `好的，这是改写后的版本：\n\`\`\`json\n${JSON.stringify(GOOD_OBJECT)}\n\`\`\`\n希望有帮助。`;
    expect(parseRewrittenQuestion(raw)?.title).toBe(GOOD_OBJECT.title);
  });

  it('模型把单题包进数组时也能取到', () => {
    const draft = parseRewrittenQuestion(JSON.stringify([GOOD_OBJECT]));
    expect(draft?.title).toBe(GOOD_OBJECT.title);
  });

  it('缺标题或缺题干返回 null', () => {
    expect(parseRewrittenQuestion(JSON.stringify({ question: '只有题干' }))).toBeNull();
    expect(parseRewrittenQuestion('完全不是 JSON')).toBeNull();
  });

  it('rewriteQuestion 调用 chat 并把原题与用户要求放进提示词', async () => {
    let capturedBody = '';
    const fetchImpl = async (_url: string, init?: { body?: string }) => {
      capturedBody = init?.body ?? '';
      return jsonResponse(JSON.stringify(GOOD_OBJECT));
    };

    const draft = await rewriteQuestion(
      CONFIG,
      { title: '原题', questionMd: '原题干', answerMd: null, tags: ['Java'] },
      { instruction: '更难一点', fetchImpl },
    );

    expect(draft.title).toBe(GOOD_OBJECT.title);
    const userPrompt = (JSON.parse(capturedBody) as { messages: { content: string }[] }).messages[1].content;
    expect(userPrompt).toContain('原题干');
    expect(userPrompt).toContain('更难一点');
    expect(userPrompt).toContain('【原题开始】');
  });

  it('模型输出解析失败时抛可读错误', async () => {
    const fetchImpl = async () => jsonResponse('我也说不清楚');
    await expect(
      rewriteQuestion(CONFIG, { title: '原题', questionMd: '干', answerMd: null }, { fetchImpl }),
    ).rejects.toThrow('无法解析');
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
