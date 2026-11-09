import { QID, sampleBundle } from '../__fixtures__/sample-bank';
import { BankError } from '../errors';
import { assertValidBundle, compareSemver, validateBundle, validateManifest } from '../validate';
import type { Bundle } from '../types';

function errorsOf(mutate: (bundle: Bundle & Record<string, unknown>) => void): string[] {
  const bundle = sampleBundle() as Bundle & Record<string, unknown>;
  mutate(bundle);
  const result = validateBundle(JSON.parse(JSON.stringify(bundle)));
  return result.ok ? [] : result.errors;
}

describe('validateBundle', () => {
  it('合法 bundle 通过，未知字段被忽略', () => {
    expect(errorsOf(() => undefined)).toEqual([]);
    expect(
      errorsOf((b) => {
        b.extra = { anything: true };
        (b.questions[0] as unknown as Record<string, unknown>).futureField = 1;
      }),
    ).toEqual([]);
  });

  it('schemaVersion 不是 2 时给出升级提示并拒绝', () => {
    const higher = validateBundle({ ...sampleBundle(), schemaVersion: 3 });
    expect(higher.ok).toBe(false);
    expect(!higher.ok && higher.errors[0]).toContain('请先升级 FaceE App');
    expect(() => assertValidBundle({ ...sampleBundle(), schemaVersion: 1 })).toThrow(BankError);
    try {
      assertValidBundle({ ...sampleBundle(), schemaVersion: 3 });
    } catch (error) {
      expect((error as BankError).code).toBe('schema-version');
    }
  });

  it('id 格式：题库 / 题目 / 分类 / 要点 / 追问', () => {
    expect(errorsOf((b) => (b.bank.id = 'facee-bank'))).toEqual([expect.stringContaining('bank.id')]);
    expect(errorsOf((b) => (b.questions[1].id = 'q_lowercase'))).toEqual(
      expect.arrayContaining([expect.stringMatching(/^questions\[1\]\.id/)]),
    );
    expect(errorsOf((b) => (b.categories[0].id = 'Redis'))).toEqual(expect.arrayContaining([expect.stringMatching(/^categories\[0\]\.id/)]));
    expect(errorsOf((b) => (b.questions[0].answer.keyPoints[0].id = 'k1'))).toEqual([
      expect.stringMatching(/^questions\[0\]\.answer\.keyPoints\[0\]\.id/),
    ]);
    expect(errorsOf((b) => (b.questions[0].followups[0].id = 'f0'))).toEqual([expect.stringMatching(/^questions\[0\]\.followups\[0\]\.id/)]);
  });

  it('必填字段与枚举', () => {
    expect(errorsOf((b) => delete (b.questions[0] as Partial<Bundle['questions'][0]>).title)).toEqual(['questions[0].title：必填，应为非空字符串']);
    expect(errorsOf((b) => ((b.questions[0] as unknown as Record<string, unknown>).difficulty = 'insane'))).toEqual([
      expect.stringMatching(/^questions\[0\]\.difficulty：取值应为/),
    ]);
    expect(errorsOf((b) => ((b.questions[0] as unknown as Record<string, unknown>).importance = 5))).toHaveLength(1);
    expect(errorsOf((b) => ((b.questions[0].answer.keyPoints[0] as unknown as Record<string, unknown>).weight = 0))).toHaveLength(1);
    expect(errorsOf((b) => ((b.questions[0] as unknown as Record<string, unknown>).prompt = undefined))).toEqual([
      'questions[0].prompt：必填，无补充时为 null',
    ]);
  });

  it('要点数量 3–5 条', () => {
    expect(errorsOf((b) => b.questions[0].answer.keyPoints.pop())).toEqual(['questions[0].answer.keyPoints：要点应为 3–5 条，实际 2 条']);
    expect(
      errorsOf((b) => {
        const kps = b.questions[2].answer.keyPoints;
        kps.push({ id: 'kp5', text: 'x', weight: 1 }, { id: 'kp6', text: 'y', weight: 1 });
      }),
    ).toEqual(['questions[2].answer.keyPoints：要点应为 3–5 条，实际 6 条']);
  });

  it('id 重复', () => {
    expect(errorsOf((b) => (b.questions[0].answer.keyPoints[1].id = 'kp1'))).toEqual([expect.stringContaining('要点 id 重复')]);
    expect(errorsOf((b) => b.categories.push({ id: 'redis', name: 'dup' }))).toEqual([expect.stringContaining('分类 id 重复')]);
  });

  it('引用完整性：分类 / 标签 / related / prerequisites / 专题 / 父标签', () => {
    expect(errorsOf((b) => (b.questions[0].categoryId = 'nope'))).toEqual(['questions[0].categoryId：引用了不存在的分类 nope']);
    expect(errorsOf((b) => b.questions[0].tags.push('ghost'))).toEqual(['questions[0].tags[2]：引用了不存在的标签 ghost']);
    expect(errorsOf((b) => (b.questions[0].related = ['q_01JC8ZQ4N3V6W8X0Y2Z4A6B8ZZ']))).toEqual([
      expect.stringMatching(/^questions\[0\]\.related\[0\]：引用了不存在的题目/),
    ]);
    expect(errorsOf((b) => (b.questions[3].prerequisites = [QID.mysqlTx]))).toEqual([expect.stringContaining('prerequisites 成环')]);
    expect(errorsOf((b) => b.collections[0].questions.push('q_01JC8ZQ4N3V6W8X0Y2Z4A6B8ZZ'))).toEqual([
      expect.stringMatching(/^collections\[0\]\.questions\[2\]/),
    ]);
    expect(errorsOf((b) => (b.tags[0].parent = 'redis'))).toEqual([expect.stringContaining('父子关系成环')]);
    expect(errorsOf((b) => (b.tags[0].parent = 'ghost'))).toEqual([expect.stringContaining('不存在的父标签')]);
  });

  it('选择题与 lifecycle 一致性', () => {
    expect(errorsOf((b) => (b.questions[3].choice = null))).toEqual(['questions[3].choice：选择题必须提供 choice']);
    expect(errorsOf((b) => (b.questions[3].choice!.correct = ['z']))).toEqual([expect.stringContaining('不是有效选项')]);
    expect(errorsOf((b) => b.lifecycle.removed.push(QID.redisExpire))).toEqual([expect.stringContaining('已删除的题目仍在 questions 中')]);
    expect(errorsOf((b) => (b.lifecycle.merged['q_01JC8ZQ4N3V6W8X0Y2Z4A6B8ZZ'] = 'q_01JC8ZQ4N3V6W8X0Y2Z4A6B8ZY'))).toEqual([
      expect.stringContaining('合并目标不存在'),
    ]);
    // 链式合并落到现存题目：合法
    expect(
      errorsOf((b) => {
        b.lifecycle.merged['q_01JC8ZQ4N3V6W8X0Y2Z4A6B8ZZ'] = 'q_01JC8ZQ4N3V6W8X0Y2Z4A6B8ZY';
        b.lifecycle.merged['q_01JC8ZQ4N3V6W8X0Y2Z4A6B8ZY'] = QID.redisExpire;
      }),
    ).toEqual([]);
  });

  it('资源引用与 contentHash 格式', () => {
    expect(errorsOf((b) => (b.questions[0].answer.detail = '![x](asset:abc.png)'))).toEqual([expect.stringContaining('资源引用格式不正确')]);
    expect(errorsOf((b) => (b.questions[0].contentHash = 'md5:123'))).toEqual([expect.stringMatching(/contentHash：格式不正确/)]);
  });

  it('错误信息汇总成 BankError(invalid) 并带完整路径列表', () => {
    try {
      assertValidBundle({ ...sampleBundle(), categories: 'x' });
      throw new Error('should fail');
    } catch (error) {
      const bankError = error as BankError;
      expect(bankError.code).toBe('invalid');
      expect(bankError.details?.length).toBeGreaterThan(0);
      expect(bankError.message).toContain('题库数据不符合规范');
    }
  });
});

describe('validateManifest', () => {
  const manifest = () => ({
    bankId: 'github.com/a/b',
    schemaVersion: 2,
    version: '1.2.0',
    publishedAt: '2026-11-05T00:00:00Z',
    bundle: { url: 'https://x/b.json', sha256: 'a'.repeat(64), size: 10 },
    questions: { [QID.redisExpire]: `sha256:${'b'.repeat(64)}` },
  });

  it('合法清单通过；字段问题带路径', () => {
    expect(validateManifest(manifest()).ok).toBe(true);
    const bad = validateManifest({ ...manifest(), bundle: { url: '', sha256: 'XYZ', size: -1 }, questions: { bad: 'x' } });
    expect(!bad.ok && bad.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^bundle\.url/),
        expect.stringMatching(/^bundle\.sha256/),
        expect.stringMatching(/^bundle\.size/),
        expect.stringMatching(/^questions\.bad/),
      ]),
    );
    const higher = validateManifest({ ...manifest(), schemaVersion: 5 });
    expect(!higher.ok && higher.errors[0]).toContain('升级');
  });
});

describe('compareSemver', () => {
  it('按数字比较，预发布低于正式版', () => {
    expect(compareSemver('1.10.0', '1.9.9')).toBe(1);
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
    expect(compareSemver('1.0.0-beta', '1.0.0')).toBe(-1);
    expect(compareSemver('0.1.2', '0.3.0')).toBe(-1);
  });
});
