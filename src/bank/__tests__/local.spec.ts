import * as fs from 'node:fs';
import { createTestRuntime, type TestRuntime } from '../__fixtures__/node-runtime';
import { canonicalJson, computeContentHash, sha256HexOfText } from '../hash';
import { addBankFromBundleFile } from '../install';
import { getQuestionLearning, listArchivedQuestionIds, setMastery } from '../learning';
import {
  addLocalCategory,
  addLocalQuestion,
  addLocalTag,
  createLocalBank,
  deleteLocalCategory,
  deleteLocalQuestion,
  deleteLocalTag,
  exportBundle,
  exportBundleFile,
  reorderLocalCategories,
  updateLocalBankInfo,
  updateLocalQuestion,
  type LocalQuestionInput,
} from '../local';
import { getBank, getRawQuestion, listCategories, listQuestions, searchQuestions } from '../repository';
import { BANK_ID_PATTERN, QUESTION_ID_PATTERN, type Question } from '../types';
import { validateBundle } from '../validate';

function input(overrides: Partial<LocalQuestionInput> = {}): LocalQuestionInput {
  return {
    title: '什么是 CAP 定理？',
    type: 'concept',
    difficulty: 'medium',
    importance: 2,
    categoryId: 'default',
    answer: {
      summary: '一致性、可用性、分区容错三者不可兼得。',
      keyPoints: [{ text: '一致性 C' }, { text: '可用性 A', weight: 2 }, { text: '分区容错 P', weight: 3 }],
    },
    followups: [{ q: 'BASE 是什么？', a: '基本可用、软状态、最终一致。' }],
    ...overrides,
  };
}

describe('contentHash 规范化', () => {
  it('键排序、无空白、忽略 undefined；只取内容字段（不含 contentHash 与元数据）', () => {
    expect(canonicalJson({ b: 1, a: [true, null, 'x'], c: undefined, d: { z: 1, y: '中' } })).toBe('{"a":[true,null,"x"],"b":1,"d":{"y":"中","z":1}}');
    const q = { id: 'q', title: 't', tags: ['a'], prompt: null, followups: [] };
    const expected = `sha256:${sha256HexOfText('{"followups":[],"prompt":null,"title":"t"}')}`;
    expect(computeContentHash(q as never)).toBe(expected);
    expect(computeContentHash({ ...q, contentHash: 'sha256:old' } as never)).toBe(expected);
    // 与键顺序无关
    expect(computeContentHash({ followups: [], title: 't', prompt: null, tags: ['a'], id: 'q' } as never)).toBe(expected);
    // 元数据变化不改变 hash
    expect(computeContentHash({ ...q, tags: ['b'], difficulty: 'hard', related: ['x'], reviewedAt: '2026-01-01' } as never)).toBe(expected);
    expect(computeContentHash({ ...q, title: 't2' } as never)).not.toBe(expected);
  });
});

describe('本地自建题库', () => {
  let t: TestRuntime;
  beforeEach(async () => {
    t = await createTestRuntime();
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it('创建题库：id 为 local/device/<ULID>，带默认分类，origin = local', async () => {
    const bankId = await createLocalBank(t.rt, { name: '我的题库', description: '自用' });
    expect(bankId).toMatch(/^local\/device\/[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(BANK_ID_PATTERN.test(bankId)).toBe(true);
    expect(await getBank(t.rt, bankId)).toMatchObject({ origin: 'local', name: '我的题库', version: '1.0.0', questionCount: 0 });
    expect((await listCategories(t.rt, bankId)).map((c) => c.id)).toEqual(['default']);
    await expect(createLocalBank(t.rt, { name: ' ' })).rejects.toMatchObject({ code: 'invalid' });
  });

  it('题目增改删：分配 q_ ULID 与 kpN / fN，id 不复用，contentHash 稳定，版本自增', async () => {
    const bankId = await createLocalBank(t.rt, { name: '我的题库' });
    const created = await addLocalQuestion(t.rt, bankId, input());
    expect(created.id).toMatch(QUESTION_ID_PATTERN);
    expect(created.answer.keyPoints.map((k) => [k.id, k.weight])).toEqual([['kp1', 1], ['kp2', 2], ['kp3', 3]]);
    expect(created.followups.map((f) => f.id)).toEqual(['f1']);
    expect(created.contentHash).toBe(computeContentHash(created));
    expect(created).not.toHaveProperty('appliesTo');
    expect((await getBank(t.rt, bankId))?.version).toBe('1.0.1');

    // 再读出、原样保存：hash 不变
    const stored = (await getRawQuestion(t.rt, bankId, created.id)) as Question;
    expect(stored).toEqual(created);
    const same = await updateLocalQuestion(t.rt, bankId, created.id, {
      ...input(),
      answer: { ...input().answer, keyPoints: stored.answer.keyPoints },
      followups: stored.followups,
    });
    expect(same.contentHash).toBe(created.contentHash);

    // 删除 kp3、新增一条：新 id 为 kp4（不复用 kp3）
    const edited = await updateLocalQuestion(t.rt, bankId, created.id, {
      ...input({ title: '什么是 CAP？' }),
      answer: {
        summary: '三者不可兼得。',
        keyPoints: [stored.answer.keyPoints[0], stored.answer.keyPoints[1], { text: '网络分区必然发生' }],
      },
      followups: [],
    });
    expect(edited.answer.keyPoints.map((k) => k.id)).toEqual(['kp1', 'kp2', 'kp4']);
    expect(edited.contentHash).not.toBe(created.contentHash);
    const again = await updateLocalQuestion(t.rt, bankId, created.id, {
      ...input(),
      answer: { ...input().answer, keyPoints: [...edited.answer.keyPoints.slice(0, 2), { text: 'x' }] },
      followups: [{ q: '新追问', a: '答' }],
    });
    expect(again.answer.keyPoints.map((k) => k.id)).toEqual(['kp1', 'kp2', 'kp5']);
    expect(again.followups.map((f) => f.id)).toEqual(['f2']);

    // 不能凭空指定 id；不满足规范的输入被同一校验器拒绝
    await expect(
      updateLocalQuestion(t.rt, bankId, created.id, { ...input(), answer: { ...input().answer, keyPoints: [{ id: 'kp9', text: 'a' }, { text: 'b' }, { text: 'c' }] } }),
    ).rejects.toMatchObject({ code: 'invalid' });
    await expect(addLocalQuestion(t.rt, bankId, input({ answer: { summary: 's', keyPoints: [{ text: 'a' }] } }))).rejects.toMatchObject({
      code: 'invalid',
      message: expect.stringContaining('要点应为 3–5 条'),
    });
    await expect(addLocalQuestion(t.rt, bankId, input({ categoryId: 'ghost' }))).rejects.toMatchObject({ code: 'invalid' });

    // 搜索可用（FTS 行随编辑更新）
    expect((await searchQuestions(t.rt, bankId, 'CAP')).map((h) => h.id)).toEqual([created.id]);

    // 删除：学习数据归档，写入 lifecycle.removed
    await setMastery(t.rt, bankId, created.id, 'known');
    await deleteLocalQuestion(t.rt, bankId, created.id);
    expect(await listQuestions(t.rt, bankId)).toEqual([]);
    expect(await listArchivedQuestionIds(t.rt, bankId)).toEqual([created.id]);
    expect((await exportBundle(t.rt, bankId)).lifecycle.removed).toEqual([created.id]);
  });

  it('删除题目时清理其它题的 related / prerequisites；关系属于元数据，hash 不变', async () => {
    const bankId = await createLocalBank(t.rt, { name: 'x' });
    const a = await addLocalQuestion(t.rt, bankId, input());
    const b = await addLocalQuestion(t.rt, bankId, input({ title: 'B', related: [a.id], prerequisites: [a.id] }));
    await deleteLocalQuestion(t.rt, bankId, a.id);
    const after = (await getRawQuestion(t.rt, bankId, b.id)) as Question;
    expect(after.related).toBeUndefined();
    expect(after.prerequisites).toBeUndefined();
    expect(after.contentHash).toBe(computeContentHash(after));
    expect(after.contentHash).toBe(b.contentHash);
  });

  it('分类 / 标签管理', async () => {
    const bankId = await createLocalBank(t.rt, { name: 'x' });
    const cat = await addLocalCategory(t.rt, bankId, { name: '分布式' });
    expect(cat).toMatch(/^c-[0-9a-z]{26}$/);
    await addLocalCategory(t.rt, bankId, { id: 'java', name: 'Java' });
    await expect(addLocalCategory(t.rt, bankId, { id: 'java', name: 'dup' })).rejects.toMatchObject({ code: 'invalid' });
    await expect(addLocalCategory(t.rt, bankId, { id: 'Bad Id', name: 'x' })).rejects.toMatchObject({ code: 'invalid' });
    await reorderLocalCategories(t.rt, bankId, ['java', cat, 'default']);
    expect((await listCategories(t.rt, bankId)).map((c) => c.id)).toEqual(['java', cat, 'default']);

    const parent = await addLocalTag(t.rt, bankId, { id: 'backend', name: '后端', parent: null });
    await addLocalTag(t.rt, bankId, { id: 'mq', name: '消息队列', parent: parent });
    const q = await addLocalQuestion(t.rt, bankId, input({ categoryId: cat, tags: ['backend', 'mq'] }));
    expect((await listQuestions(t.rt, bankId, { tagIds: ['backend'] })).map((x) => x.id)).toEqual([q.id]);

    await deleteLocalTag(t.rt, bankId, 'backend');
    const exported = await exportBundle(t.rt, bankId);
    expect(exported.tags).toEqual([{ id: 'mq', name: '消息队列', parent: null, order: 1000 }]);
    expect(exported.questions[0].tags).toEqual(['mq']);
    expect(exported.questions[0].contentHash).toBe(computeContentHash(exported.questions[0]));

    await expect(deleteLocalCategory(t.rt, bankId, cat)).rejects.toMatchObject({ code: 'invalid' });
    await deleteLocalCategory(t.rt, bankId, cat, { moveQuestionsTo: 'java' });
    expect((await listQuestions(t.rt, bankId)).map((x) => x.categoryId)).toEqual(['java']);
  });

  it('只能编辑本地题库', async () => {
    const bankId = await createLocalBank(t.rt, { name: 'x' });
    await updateLocalBankInfo(t.rt, bankId, { name: '新名字' });
    expect((await getBank(t.rt, bankId))?.name).toBe('新名字');
    await expect(addLocalQuestion(t.rt, 'github.com/a/b', input())).rejects.toMatchObject({ code: 'not-found' });
  });

  it('导出 → 导入往返：bundle 合法，id / hash / 学习数据关联不变，仍可编辑', async () => {
    const bankId = await createLocalBank(t.rt, { name: '分享题库' });
    const q = await addLocalQuestion(t.rt, bankId, input());
    await setMastery(t.rt, bankId, q.id, 'fuzzy');
    const uri = await exportBundleFile(t.rt, bankId);
    const exported = JSON.parse(fs.readFileSync(uri, 'utf8'));
    expect(validateBundle(exported).ok).toBe(true);

    // 在「另一台设备」导入
    const other = await createTestRuntime();
    try {
      const fileUri = other.writeLocalFile('shared.json', JSON.stringify(exported));
      const result = await addBankFromBundleFile(other.rt, fileUri);
      expect(result).toMatchObject({ bankId, origin: 'local', questionCount: 1 });
      const imported = (await getRawQuestion(other.rt, bankId, q.id)) as Question;
      expect(imported).toEqual(q);
      // 续号：新增要点从 kp4 开始
      const edited = await updateLocalQuestion(other.rt, bankId, q.id, {
        ...input(),
        answer: { ...input().answer, keyPoints: [...imported.answer.keyPoints, { text: '新增' }] },
      });
      expect(edited.answer.keyPoints.map((k) => k.id)).toEqual(['kp1', 'kp2', 'kp3', 'kp4']);
    } finally {
      await other.cleanup();
    }

    // 同设备再导入：学习数据仍挂在原题上
    await addBankFromBundleFile(t.rt, t.writeLocalFile('again.json', JSON.stringify(exported)));
    const learning = await getQuestionLearning(t.rt, bankId, q);
    expect(learning.mastery).toBe('fuzzy');
  });
});
