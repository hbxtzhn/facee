import { createTestRuntime, publish, type TestRuntime } from '../__fixtures__/node-runtime';
import { QID, SAMPLE_ASSET_CONTENT, SAMPLE_ASSET_NAME, SAMPLE_BANK_ID, sampleBundle } from '../__fixtures__/sample-bank';
import { resetBankStoreForTests, resolveActiveAssetUri, useBankStore } from '../store';

// 默认运行时按 Web 处理（返回 null）；其余用例都显式注入 Node 运行时
jest.mock('../runtime', () => ({ createDefaultRuntime: async () => null }));

const ASSETS = { [SAMPLE_ASSET_NAME]: SAMPLE_ASSET_CONTENT };

describe('useBankStore', () => {
  let t: TestRuntime;
  beforeEach(async () => {
    await resetBankStoreForTests();
    t = await createTestRuntime({ migrate: false });
  });
  afterEach(async () => {
    await resetBankStoreForTests();
    await t.cleanup();
  });

  const store = () => useBankStore.getState();

  it('初始化前调用 action 返回 not-ready，不抛出', async () => {
    const result = await store().listQuestions();
    expect(result).toEqual({ ok: false, error: { code: 'not-ready', message: '题库尚未初始化' } });
    expect(store().lastError?.code).toBe('not-ready');
  });

  it('Web（默认运行时返回 null）进入 unsupported，所有 action 返回 unsupported', async () => {
    // Web 端 Metro 解析 runtime.ts：不加载任何原生模块，直接返回 null
    const web = jest.requireActual('../runtime.ts') as { createDefaultRuntime: () => Promise<unknown> };
    expect(await web.createDefaultRuntime()).toBeNull();
    const { openBankDatabase } = jest.requireActual('../db/open.ts') as { openBankDatabase: () => Promise<unknown> };
    await expect(openBankDatabase()).rejects.toMatchObject({ code: 'unsupported' });

    const init = await store().initialize();
    expect(!init.ok && init.error.code).toBe('unsupported');
    expect(store().status).toBe('unsupported');
    const list = await store().listQuestions();
    expect(list).toEqual({ ok: false, error: { code: 'unsupported', message: expect.stringContaining('Web 预览不支持本地题库') } });
    const add = await store().addOnlineBank('https://example.com/latest.json');
    expect(!add.ok && add.error.code).toBe('unsupported');
  });

  it('初始化：迁移 + 空状态；安装首个题库后自动设为当前，并加载分类 / 标签 / 专题 / 统计', async () => {
    expect(await store().initialize({ runtime: t.rt })).toEqual({ ok: true, value: undefined });
    expect(store()).toMatchObject({ status: 'ready', banks: [], activeBankId: null, activeBank: null });
    // 重复初始化安全
    expect((await store().initialize({ runtime: t.rt })).ok).toBe(true);

    const url = publish(t, sampleBundle(), { assets: ASSETS });
    const progress: string[] = [];
    const unsubscribe = useBankStore.subscribe((state) => {
      if (state.progress) progress.push(state.progress.stage);
    });
    const pending = store().addOnlineBank(url);
    expect(store().busy).toEqual({ kind: 'install', bankId: null });
    const result = await pending;
    unsubscribe();
    expect(result.ok && result.value.questionCount).toBe(5);
    expect(progress).toContain('import');
    expect(store()).toMatchObject({ busy: null, progress: null, activeBankId: SAMPLE_BANK_ID });
    expect(store().activeBank?.name).toBe('测试题库');
    expect(store().categories.map((c) => c.id)).toEqual(['mysql', 'network', 'redis']);
    expect(store().collections).toHaveLength(1);
    expect(store().stats?.questionCount).toBe(5);
    expect(resolveActiveAssetUri(`asset:${SAMPLE_ASSET_NAME}`)).toMatch(new RegExp(`${SAMPLE_ASSET_NAME}$`));
    expect(store().contentVersion).toBeGreaterThan(0);
  });

  it('独占操作进行中再调用返回 busy；失败统一返回结果对象并写入 lastError', async () => {
    await store().initialize({ runtime: t.rt });
    const url = publish(t, sampleBundle(), { assets: ASSETS });
    const first = store().addOnlineBank(url);
    const second = await store().addOnlineBank(url);
    expect(second).toEqual({ ok: false, error: { code: 'busy', message: '正在进行其它题库操作，请稍候' } });
    expect((await first).ok).toBe(true);

    const bad = await store().addOnlineBank('https://example.com/missing/latest.json');
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error.code).toBe('network');
    expect(store().lastError?.code).toBe('network');
    expect(store().busy).toBeNull();
    store().clearError();
    expect(store().lastError).toBeNull();

    const invalid = await store().importBankFile(t.writeLocalFile('bad.json', JSON.stringify({ ...sampleBundle(), categories: 1 })));
    expect(!invalid.ok && invalid.error.code).toBe('invalid');
    expect(!invalid.ok && invalid.error.details?.[0]).toMatch(/^categories/);

    const missing = await store().getQuestion('q_01JC8ZQ4N3V6W8X0Y2Z4A6B8ZZ');
    expect(!missing.ok && missing.error.code).toBe('not-found');
  });

  it('学习数据 action 刷新统计与 learningVersion；列表 / 搜索 / 详情 / 会话 / 分区走当前题库', async () => {
    await store().initialize({ runtime: t.rt });
    await store().addOnlineBank(publish(t, sampleBundle(), { assets: ASSETS }));
    const version = store().learningVersion;

    const mark = await store().setMastery(QID.mysqlTx, 'unknown');
    expect(mark.ok && mark.value.mastery).toBe('unknown');
    expect(store().learningVersion).toBe(version + 1);
    expect(store().stats?.markedCount).toBe(1);
    expect(store().categories.find((c) => c.id === 'mysql')?.markedCount).toBe(1);

    expect(await store().toggleFavorite(QID.mysqlTx)).toEqual({ ok: true, value: true });
    const list = await store().listQuestions({ favoritesOnly: true });
    expect(list.ok && list.value.map((q) => q.id)).toEqual([QID.mysqlTx]);
    const search = await store().search('事务');
    expect(search.ok && search.value.map((h) => h.id)).toEqual([QID.mysqlTx]);
    const detail = await store().getQuestion(QID.redisExpire);
    expect(detail.ok && detail.value.question.answer.detail).toContain(store().assetBaseUri as string);

    const kp = await store().recordKeypointCheck(QID.redisExpire, { kp1: true, kp2: true, kp3: true });
    expect(kp.ok && kp.value.weightedCoverage).toBe(1);
    const badKp = await store().recordKeypointCheck(QID.redisExpire, { kp1: true });
    expect(!badKp.ok && badKp.error.code).toBe('invalid');

    await store().saveSession({ queue: [QID.mysqlTx, QID.redisExpire], index: 0, mode: 'practice', title: '分类' });
    await store().updateSessionIndex(1);
    const session = await store().getSession();
    expect(session.ok && session.value?.index).toBe(1);

    const section = await store().createSection('常看');
    expect(section.ok).toBe(true);
    if (section.ok) await store().addCategoryToSection(section.value, 'redis');
    expect(store().sections.map((s) => s.categories.map((c) => c.id))).toEqual([['redis']]);

    const exported = await store().exportBackup();
    expect(exported.ok && exported.value).toMatch(/facee-backup-\d+\.json$/);
  });

  it('本地题库 CRUD 经 store 走独占通道并刷新状态；切换 / 删除题库', async () => {
    await store().initialize({ runtime: t.rt });
    await store().addOnlineBank(publish(t, sampleBundle(), { assets: ASSETS }));
    const created = await store().createLocalBank({ name: '我的' });
    expect(created.ok).toBe(true);
    const localId = created.ok ? created.value : '';
    expect(store().activeBankId).toBe(SAMPLE_BANK_ID); // 已有当前题库时不自动切换
    expect(store().banks.map((b) => b.id)).toEqual([SAMPLE_BANK_ID, localId]);

    expect((await store().switchBank(localId)).ok).toBe(true);
    expect(store().activeBank?.origin).toBe('local');
    const q = await store().addLocalQuestion(localId, {
      title: '本地题', type: 'concept', difficulty: 'easy', importance: 1, categoryId: 'default',
      answer: { summary: 's', keyPoints: [{ text: '1' }, { text: '2' }, { text: '3' }] },
    });
    expect(q.ok).toBe(true);
    expect(store().stats?.questionCount).toBe(1);
    const forbidden = await store().addLocalQuestion(SAMPLE_BANK_ID, {
      title: 'x', type: 'concept', difficulty: 'easy', importance: 1, categoryId: 'redis',
      answer: { summary: 's', keyPoints: [{ text: '1' }, { text: '2' }, { text: '3' }] },
    });
    expect(!forbidden.ok && forbidden.error.code).toBe('forbidden');

    const file = await store().exportBankFile(localId);
    expect(file.ok).toBe(true);

    expect((await store().deleteBank(localId)).ok).toBe(true);
    expect(store().activeBankId).toBe(SAMPLE_BANK_ID);
    expect((await store().switchBank('nope/x/y')).ok).toBe(false);
  });

  it('检查更新与更新', async () => {
    await store().initialize({ runtime: t.rt });
    await store().addOnlineBank(publish(t, sampleBundle(), { assets: ASSETS }));
    publish(t, sampleBundle('1.2.0'), { assets: ASSETS });
    const check = await store().checkUpdate(SAMPLE_BANK_ID);
    expect(check.ok && check.value.hasUpdate).toBe(true);
    expect(store().activeBank?.lastCheck?.version).toBe('1.2.0');
    const updated = await store().updateBank(SAMPLE_BANK_ID);
    expect(updated.ok && updated.value.previousVersion).toBe('1.0.0');
    expect(store().activeBank?.version).toBe('1.2.0');
  });
});

describe('公开入口 src/bank/index.ts', () => {
  it('导出 store、错误类型与工具函数', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const api = require('../index') as typeof import('../index');
    expect(api.useBankStore).toBe(useBankStore);
    expect(api.BANK_SCHEMA_VERSION).toBe(2);
    expect(typeof api.rewriteMarkdownAssets).toBe('function');
    expect(api.suggestMasteryFromCoverage(0.9)).toBe('known');
  });
});
