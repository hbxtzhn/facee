import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  copiedBankTitle,
  copyBankAsLocal,
  createLocalBankPackage,
  hashName,
  isLocalBankId,
  listLocalBankSources,
  loadLocalBankSource,
  newLocalBankId,
  questionIdFromTitle,
  removeQuestion,
  saveLocalBankSource,
  tagIdFromName,
  upsertQuestion,
  type LocalBankSource,
} from './local-banks';
import { validateDecodedPackage } from './file-repository';
import type { QuestionBankPackage } from './types';

/** 与 file-repository.spec 的 MemoryFileSystem 同款最小桩（只实现用到的部分） */
class MemoryFileSystem {
  readonly documentDirectory = 'file:///documents/';
  private readonly entries = new Map<string, { isDirectory: boolean; value?: string }>();

  async getInfoAsync(uri: string) {
    const entry = this.entries.get(uri);
    return { exists: Boolean(entry), isDirectory: entry?.isDirectory ?? false };
  }

  async makeDirectoryAsync(uri: string) {
    this.entries.set(uri, { isDirectory: true });
  }

  async writeAsStringAsync(uri: string, value: string) {
    this.entries.set(uri, { isDirectory: false, value });
  }

  async readAsStringAsync(uri: string) {
    const entry = this.entries.get(uri);
    if (!entry || entry.isDirectory) throw new Error(`Missing file: ${uri}`);
    return entry.value ?? '';
  }

  async readDirectoryAsync(uri: string) {
    const prefix = uri.endsWith('/') ? uri : `${uri}/`;
    const children = new Set<string>();
    for (const key of this.entries.keys()) {
      if (!key.startsWith(prefix)) continue;
      const segment = key.slice(prefix.length).split('/')[0];
      if (segment) children.add(segment);
    }
    return [...children];
  }

  async deleteAsync(uri: string) {
    for (const key of [...this.entries.keys()]) {
      if (key === uri || key.startsWith(uri.endsWith('/') ? uri : `${uri}/`)) this.entries.delete(key);
    }
  }
}

const DRAFT = {
  title: 'HashMap 的底层实现？',
  difficulty: 2 as const,
  tags: ['Java', '集合'],
  questionMd: '请说明 HashMap 的底层数据结构。',
  answerMd: '数组 + 链表 + 红黑树。',
};

describe('local-banks 包构造', () => {
  it('空本地题库包通过 validateDecodedPackage 校验', () => {
    const bank = createLocalBankPackage('我的面经题库');
    expect(() => validateDecodedPackage(bank)).not.toThrow();
    expect(bank.catalog.id).toMatch(/^local-[a-z0-9]+$/);
    expect(bank.catalog.categories?.[0]?.id).toBe('local');
  });

  it('newLocalBankId 符合规范且不重复', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newLocalBankId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(isLocalBankId(id)).toBe(true);
  });
});

describe('local-banks 题目模型（纯函数）', () => {
  it('新增题目：写齐元数据与内容，标签 upsert，空答案 → hasAnswer:false', () => {
    let bank = createLocalBankPackage('测试库');
    bank = upsertQuestion(bank, DRAFT);
    expect(bank.catalog.questions).toHaveLength(1);

    const question = bank.catalog.questions[0];
    expect(question.title).toBe(DRAFT.title);
    expect(question.difficulty).toBe(2);
    expect(question.categoryId).toBe('local');
    expect(question.hasAnswer).toBe(true);
    expect(question.tags.map((tag) => tag.name)).toEqual(['Java', '集合']);
    expect(question.tags.map((tag) => tag.id)).toEqual([tagIdFromName('Java'), tagIdFromName('集合')]);

    expect(bank.catalog.tags.map((tag) => tag.name).sort()).toEqual(['Java', '集合'].sort());
    expect(bank.contents).toHaveLength(1);
    expect(bank.contents[0].answerMd).toBe(DRAFT.answerMd);
  });

  it('同名标签在不同题目间复用同一 id', () => {
    let bank = createLocalBankPackage('测试库');
    bank = upsertQuestion(bank, DRAFT);
    bank = upsertQuestion(bank, { ...DRAFT, title: '第二道题', tags: ['Java'] });
    expect(bank.catalog.tags).toHaveLength(2);
    expect(bank.catalog.questions[1].tags[0].id).toBe(bank.catalog.questions[0].tags[0].id);
  });

  it('空答案（纯空白）→ hasAnswer:false 且 answerMd 为 null', () => {
    let bank = createLocalBankPackage('测试库');
    bank = upsertQuestion(bank, { ...DRAFT, answerMd: '   ' });
    expect(bank.catalog.questions[0].hasAnswer).toBe(false);
    expect(bank.contents[0].answerMd).toBeNull();
  });

  it('编辑既有题目：id 与 sort 保持，内容替换', () => {
    let bank = createLocalBankPackage('测试库');
    bank = upsertQuestion(bank, DRAFT);
    const id = bank.catalog.questions[0].id;
    const sort = bank.catalog.questions[0].sort;

    bank = upsertQuestion(bank, { ...DRAFT, id, title: '改名后的题' });
    expect(bank.catalog.questions).toHaveLength(1);
    expect(bank.catalog.questions[0].id).toBe(id);
    expect(bank.catalog.questions[0].sort).toBe(sort);
    expect(bank.catalog.questions[0].title).toBe('改名后的题');
    expect(bank.contents[0].questionMd).toBe(DRAFT.questionMd);
  });

  it('编辑不存在的题目 id 会报错', () => {
    const bank = createLocalBankPackage('测试库');
    expect(() => upsertQuestion(bank, { ...DRAFT, id: 'q-nope' })).toThrow('不存在');
  });

  it('编辑保留 followupsMd 与 assetBaseUri（表单不覆盖它们）', () => {
    let bank = createLocalBankPackage('测试库');
    bank = upsertQuestion(bank, DRAFT);
    const id = bank.catalog.questions[0].id;
    const withExtras = {
      ...bank.contents[0],
      followupsMd: '## 追问 1：为什么线程不安全？',
      assetBaseUri: 'file:///docs/banks/ns/questions/x/assets/',
    };
    bank = { ...bank, contents: [withExtras] };

    bank = upsertQuestion(bank, { ...DRAFT, id, questionMd: '改后的题干。' });
    expect(bank.contents[0].questionMd).toBe('改后的题干。');
    expect(bank.contents[0].followupsMd).toBe('## 追问 1：为什么线程不安全？');
    expect(bank.contents[0].assetBaseUri).toBe('file:///docs/banks/ns/questions/x/assets/');
  });

  it('编辑保留原 categoryId（复制题库的分类各不相同），新题用默认分类', () => {
    const bank: QuestionBankPackage = {
      catalog: {
        schemaVersion: 1,
        id: 'interview-bank',
        title: '线上题库',
        categories: [
          { id: 'java', name: 'Java', sort: 10 },
          { id: 'db', name: '数据库', sort: 20 },
        ],
        tags: [],
        questions: [
          {
            id: 'q-hashmap',
            title: 'HashMap 原理',
            difficulty: 2,
            hasAnswer: true,
            sort: 10,
            tags: [],
            categoryId: 'java',
          },
        ],
      },
      contents: [{ id: 'q-hashmap', questionMd: '讲讲 HashMap。', answerMd: '数组+红黑树。' }],
    };

    const edited = upsertQuestion(bank, {
      id: 'q-hashmap',
      title: 'HashMap 原理（改）',
      difficulty: 3,
      tags: [],
      questionMd: '讲讲 HashMap（改）。',
      answerMd: null,
    });
    expect(edited.catalog.questions[0].categoryId).toBe('java');
    expect(edited.catalog.categories).toEqual(bank.catalog.categories);
    expect(() => validateDecodedPackage(edited)).not.toThrow();

    const added = upsertQuestion(bank, { ...DRAFT, title: '新加的题' });
    expect(added.catalog.questions[1].categoryId).toBe('local');
    expect(() => validateDecodedPackage(added)).not.toThrow();
    expect(added.catalog.categories).toEqual([
      ...bank.catalog.categories!,
      { id: 'local', name: '我的题目', sort: 10 },
    ]);
    expect(bank.catalog.categories).toHaveLength(2);
  });

  it.each([undefined, []])('新增题目补齐缺省分类（原 categories=%s）', (categories) => {
    const bank = createLocalBankPackage('无分类题库');
    bank.catalog.categories = categories;
    const added = upsertQuestion(bank, DRAFT);
    expect(() => validateDecodedPackage(added)).not.toThrow();
    expect(added.catalog.categories).toEqual([{ id: 'local', name: '我的题目', sort: 10 }]);
    expect(bank.catalog.categories).toBe(categories);
  });

  it('已有 local 分类复用且批量新增不重复、不覆盖原定义', () => {
    const bank = createLocalBankPackage('已有分类');
    bank.catalog.categories = [{ id: 'local', name: '原有分类名', sort: 99 }];
    const added = upsertQuestion(upsertQuestion(bank, DRAFT), { ...DRAFT, title: 'AI 第二题' });
    expect(added.catalog.categories).toEqual(bank.catalog.categories);
    expect(added.catalog.categories).toHaveLength(1);
    expect(() => validateDecodedPackage(added)).not.toThrow();
    expect(bank.catalog.questions).toHaveLength(0);
  });

  it('删除题目同时移除元数据与内容', () => {
    let bank = createLocalBankPackage('测试库');
    bank = upsertQuestion(bank, DRAFT);
    const id = bank.catalog.questions[0].id;
    bank = removeQuestion(bank, id);
    expect(bank.catalog.questions).toHaveLength(0);
    expect(bank.contents).toHaveLength(0);
  });

  it('questionIdFromTitle 确定性生成，冲突时追加序号', () => {
    expect(questionIdFromTitle('同一题', new Set())).toBe(questionIdFromTitle('同一题', new Set()));
    const base = questionIdFromTitle('同一题', new Set());
    expect(questionIdFromTitle('同一题', new Set([base]))).toBe(`${base}-1`);
    expect(questionIdFromTitle('同一题', new Set([base, `${base}-1`]))).toBe(`${base}-2`);
  });

  it('hashName 对不同名称给出不同 id（抽样）', () => {
    expect(tagIdFromName('Java')).not.toBe(tagIdFromName('数据库'));
    expect(hashName('abc')).toBe(hashName('abc'));
  });
});

describe('local-banks 复制为本地题库', () => {
  const SOURCE: QuestionBankPackage = {
    catalog: {
      schemaVersion: 1,
      id: 'interview-bank',
      title: '面试题库',
      categories: [
        { id: 'java', name: 'Java', sort: 10 },
        { id: 'db', name: '数据库', sort: 20 },
      ],
      tags: [{ id: 'tag-java', name: 'Java', parentId: null, sort: 10 }],
      questions: [
        {
          id: 'q-hashmap',
          title: 'HashMap 原理',
          difficulty: 2,
          hasAnswer: true,
          sort: 10,
          tags: [{ id: 'tag-java', name: 'Java' }],
          categoryId: 'java',
        },
      ],
    },
    contents: [
      {
        id: 'q-hashmap',
        questionMd: '讲讲 HashMap。',
        answerMd: '数组+红黑树。',
        followupsMd: '## 追问 1：扩容？\n\n2 倍扩容。',
        assetBaseUri: 'file:///old/questions/q-hashmap/assets/',
      },
    ],
  };

  it('复制/备份恢复题库批量新增后保存、重新加载仍通过安装校验', async () => {
    const original = JSON.stringify(SOURCE);
    const copy = copyBankAsLocal(SOURCE);
    copy.package = upsertQuestion(copy.package, DRAFT);
    copy.package = upsertQuestion(copy.package, { ...DRAFT, title: 'AI 导入题' });
    expect(() => validateDecodedPackage(copy.package)).not.toThrow();
    const fs = new MemoryFileSystem();
    await saveLocalBankSource(copy, fs as never);
    const restored = await loadLocalBankSource(copy.bankId, fs as never);
    expect(restored).not.toBeNull();
    expect(() => validateDecodedPackage(restored!.package)).not.toThrow();
    expect(restored!.package.catalog.questions).toHaveLength(3);
    expect(restored!.package.catalog.categories?.filter((category) => category.id === 'local')).toHaveLength(1);
    expect(restored!.package.catalog.questions[0].categoryId).toBe('java');
    expect(restored!.package.contents[0].followupsMd).toContain('扩容');
    expect(JSON.stringify(SOURCE)).toBe(original);
  });

  it('copiedBankTitle：X → X（副本）→ X（副本2）递增', () => {
    expect(copiedBankTitle('面试题库')).toBe('面试题库（副本）');
    expect(copiedBankTitle('面试题库（副本）')).toBe('面试题库（副本2）');
    expect(copiedBankTitle('面试题库（副本3）')).toBe('面试题库（副本4）');
  });

  it('copyBankAsLocal：新 local- id、题目/分类/追问原样保留、去掉源 assetBaseUri', () => {
    const copy = copyBankAsLocal(SOURCE);

    expect(copy.bankId).toMatch(/^local-[a-z0-9]+$/);
    expect(copy.package.catalog.id).toBe(copy.bankId);
    expect(copy.package.catalog.title).toBe('面试题库（副本）');
    // 元数据原样保留
    expect(copy.package.catalog.questions[0].id).toBe('q-hashmap');
    expect(copy.package.catalog.questions[0].categoryId).toBe('java');
    expect(copy.package.catalog.categories).toEqual(SOURCE.catalog.categories);
    // 内容原样保留（含追问），但源命名空间的 assetBaseUri 不带走
    expect(copy.package.contents[0].id).toBe('q-hashmap');
    expect(copy.package.contents[0].followupsMd).toContain('扩容');
    expect(copy.package.contents[0].assetBaseUri).toBeUndefined();
    // 副本必须是可安装的合法包
    expect(() => validateDecodedPackage(copy.package)).not.toThrow();
    // 不修改源包
    expect(SOURCE.catalog.id).toBe('interview-bank');
    expect(SOURCE.contents[0].assetBaseUri).toBeDefined();
  });
});

describe('local-banks 源文件 CRUD', () => {
  let fs: MemoryFileSystem;

  beforeEach(() => {
    fs = new MemoryFileSystem();
  });

  it('保存后可加载、列出、删除', async () => {
    const bank = createLocalBankPackage('我的错题集');
    const source: LocalBankSource = { bankId: bank.catalog.id, updatedAt: '', package: bank };

    await saveLocalBankSource(source, fs as never);

    const loaded = await loadLocalBankSource(bank.catalog.id, fs as never);
    expect(loaded?.package.catalog.title).toBe('我的错题集');
    expect(loaded?.updatedAt).not.toBe('');

    const summaries = await listLocalBankSources(fs as never);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].bankId).toBe(bank.catalog.id);
    expect(summaries[0].title).toBe('我的错题集');

    await fs.deleteAsync(`file:///documents/facee-question-bank/local-sources/${bank.catalog.id}.json`);
    expect(await loadLocalBankSource(bank.catalog.id, fs as never)).toBeNull();
    expect(await listLocalBankSources(fs as never)).toHaveLength(0);
  });

  it('加载不存在的源返回 null，损坏的 JSON 不抛错', async () => {
    expect(await loadLocalBankSource('local-nothing', fs as never)).toBeNull();

    await fs.makeDirectoryAsync('file:///documents/facee-question-bank/local-sources/');
    await fs.writeAsStringAsync('file:///documents/facee-question-bank/local-sources/local-bad.json', '{oops');
    expect(await loadLocalBankSource('local-bad', fs as never)).toBeNull();
    expect(await listLocalBankSources(fs as never)).toHaveLength(0);
  });

  it('保存时 bankId 与 catalog.id 不一致会拒绝', async () => {
    const bank = createLocalBankPackage('我的题库');
    const source: LocalBankSource = { bankId: 'local-other', updatedAt: '', package: bank };
    await expect(saveLocalBankSource(source, fs as never)).rejects.toThrow('不一致');
  });
});
