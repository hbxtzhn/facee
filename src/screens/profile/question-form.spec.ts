import { describe, expect, it } from '@jest/globals';
import { sampleBundle } from '../../bank/__fixtures__/sample-bank';
import {
  emptyForm,
  formFromQuestion,
  formKey,
  formToInput,
  mapStoreDetails,
  moveItem,
  validateForm,
  type QuestionForm,
} from './question-form';
import { countSpecChars } from './bank-helpers';

function filled(patch: Partial<QuestionForm> = {}): QuestionForm {
  const form = emptyForm('redis');
  return {
    ...form,
    title: '题目',
    summary: '一句话结论。',
    keyPoints: ['一', '二', '三'].map((text) => ({ key: formKey(), text, weight: 1 as const })),
    ...patch,
  };
}

describe('countSpecChars（规范 §2.1 字数口径）', () => {
  it('非 ASCII 计 1，ASCII 计 0.5，向上取整', () => {
    expect(countSpecChars('中文')).toBe(2);
    expect(countSpecChars('abc')).toBe(2);
    expect(countSpecChars('Redis 过期')).toBe(5);
  });
});

describe('validateForm', () => {
  it('合法表单无错误', () => {
    expect(validateForm(filled())).toEqual({});
  });

  it('一句话 ≤ 80 字：80 个汉字通过，81 个报错；160 个 ASCII 字母等于 80 字', () => {
    expect(validateForm(filled({ summary: '字'.repeat(80) })).summary).toBeUndefined();
    expect(validateForm(filled({ summary: '字'.repeat(81) })).summary).toBe('一句话结论不超过 80 字（当前 81 字）');
    expect(validateForm(filled({ summary: 'a'.repeat(160) })).summary).toBeUndefined();
    expect(validateForm(filled({ summary: '  ' })).summary).toBe('请填写一句话结论');
  });

  it('要点必须 3–5 条（空行不计），单条 ≤ 40 字', () => {
    const two = filled({ keyPoints: [...filled().keyPoints.slice(0, 2), { key: formKey(), text: '  ', weight: 1 }] });
    expect(validateForm(two).keyPoints).toBe('要点需要 3–5 条（当前 2 条）');
    const six = filled({ keyPoints: ['1', '2', '3', '4', '5', '6'].map((text) => ({ key: formKey(), text, weight: 1 as const })) });
    expect(validateForm(six).keyPoints).toBe('要点需要 3–5 条（当前 6 条）');
    const long = filled();
    long.keyPoints[1] = { ...long.keyPoints[1], text: '长'.repeat(41) };
    expect(validateForm(long)['keyPoints.1']).toBe('每条要点不超过 40 字');
  });

  it('追问、参考资料、选择题的局部规则', () => {
    const errors = validateForm(filled({
      followups: [{ key: formKey(), q: '只有问题', a: '' }, { key: formKey(), q: '', a: '' }],
      references: [{ key: formKey(), title: '文档', url: 'redis.io' }],
      type: 'choice',
      options: [{ key: formKey(), text: 'A', correct: false }, { key: formKey(), text: 'B', correct: false }],
    }));
    expect(errors['followups.0']).toBe('请填写追问答案');
    expect(errors['followups.1']).toBeUndefined();
    expect(errors['references.0']).toBe('链接需以 http(s):// 开头');
    expect(errors.choice).toBe('请标记至少 1 个正确选项');
  });
});

describe('formFromQuestion / formToInput', () => {
  it('往返保留要点 / 追问 id 与表单未覆盖的字段', () => {
    const question = sampleBundle().questions[0];
    const form = formFromQuestion(question);
    expect(form.keyPoints.map((kp) => kp.id)).toEqual(['kp1', 'kp2', 'kp3']);
    const input = formToInput(form, question);
    expect(input.answer.keyPoints.map((kp) => kp.id)).toEqual(['kp1', 'kp2', 'kp3']);
    expect(input.followups?.[0]).toMatchObject({ id: 'f1' });
    expect(input.related).toEqual(question.related);
    expect(input.source).toEqual(question.source);
    expect(input.appliesTo).toEqual(['Redis >= 6']);
    expect(input.answer.pitfalls).toEqual(question.answer.pitfalls);
  });

  it('新增要点不带 id；重排后 id 跟随条目', () => {
    const question = sampleBundle().questions[0];
    const form = formFromQuestion(question);
    form.keyPoints = moveItem(form.keyPoints, 0, 1);
    form.keyPoints.push({ key: formKey(), text: '新要点', weight: 3 });
    const input = formToInput(form, question);
    expect(input.answer.keyPoints).toEqual([
      expect.objectContaining({ id: 'kp2' }),
      expect.objectContaining({ id: 'kp1' }),
      expect.objectContaining({ id: 'kp3' }),
      { text: '新要点', weight: 3 },
    ]);
  });

  it('选择题：选项按顺序编号，详解写入 choice.explanation', () => {
    const input = formToInput(filled({
      type: 'choice',
      detail: '解析',
      options: [{ key: formKey(), text: '甲', correct: false }, { key: formKey(), text: ' ', correct: true }, { key: formKey(), text: '乙', correct: true }],
    }), null);
    expect(input.choice).toEqual({ options: [{ id: 'a', text: '甲' }, { id: 'b', text: '乙' }], correct: ['b'], explanation: '解析' });
    expect(input.answer.detail).toBeNull();
  });
});

describe('mapStoreDetails', () => {
  it('把整库校验路径映射回字段，未知路径进 general', () => {
    const errors = mapStoreDetails([
      'questions[3].answer.keyPoints：要点应为 3–5 条，实际 2 条',
      'questions[3].answer.keyPoints[1].text：必填，应为非空字符串',
      'questions[3].followups[0].a：必填，应为非空字符串',
      'questions[3].choice.correct：至少 1 个正确选项',
      'bank.version：格式不正确',
    ], '本地题库不符合规范');
    expect(errors).toEqual({
      keyPoints: '要点应为 3–5 条，实际 2 条',
      'keyPoints.1': '必填，应为非空字符串',
      'followups.0': '必填，应为非空字符串',
      choice: '至少 1 个正确选项',
      general: 'bank.version：格式不正确',
    });
  });

  it('没有详情时回退到整体错误信息', () => {
    expect(mapStoreDetails(undefined, '本地题库不符合规范')).toEqual({ general: '本地题库不符合规范' });
  });
});
