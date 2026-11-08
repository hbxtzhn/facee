import * as fs from 'node:fs';
import { createTestRuntime, publish, type TestRuntime } from '../__fixtures__/node-runtime';
import { QID, SAMPLE_ASSET_CONTENT, SAMPLE_ASSET_NAME, SAMPLE_BANK_ID, sampleBundle } from '../__fixtures__/sample-bank';
import { addBankFromManifestUrl, getAssetBaseUri, installBundle } from '../install';
import { setFavorite, setMastery, markViewed } from '../learning';
import {
  deleteBank,
  getActiveBankId,
  getQuestion,
  getQuestionIds,
  listBanks,
  listCategories,
  listCollections,
  listQuestions,
  listTags,
  searchQuestions,
  setActiveBankId,
} from '../repository';
import { finalize } from '../__fixtures__/sample-bank';
import { exportBundle } from '../local';

describe('查询', () => {
  let t: TestRuntime;
  beforeEach(async () => {
    t = await createTestRuntime();
    await addBankFromManifestUrl(t.rt, publish(t, sampleBundle(), { assets: { [SAMPLE_ASSET_NAME]: SAMPLE_ASSET_CONTENT } }));
  });
  afterEach(async () => {
    await t.cleanup();
  });

  const ids = async (filter: Parameters<typeof listQuestions>[2]) => (await listQuestions(t.rt, SAMPLE_BANK_ID, filter)).map((q) => q.id);

  it('分类按 order → id 排序并带题数；题目稳定排序', async () => {
    const categories = await listCategories(t.rt, SAMPLE_BANK_ID);
    expect(categories.map((c) => [c.id, c.questionCount])).toEqual([
      ['mysql', 2],
      ['network', 1],
      ['redis', 2],
    ]);
    expect(await getQuestionIds(t.rt, SAMPLE_BANK_ID)).toEqual([QID.mysqlTx, QID.mysqlIndex, QID.tcpHandshake, QID.redisExpire, QID.redisPersist]);
    expect(await ids({})).toEqual([QID.mysqlTx, QID.mysqlIndex, QID.tcpHandshake, QID.redisExpire, QID.redisPersist]);
  });

  it('标签含子孙展开：db ⇒ cache / redis / tx', async () => {
    const tags = await listTags(t.rt, SAMPLE_BANK_ID);
    const db = tags.find((tag) => tag.id === 'db');
    expect(db?.childIds.sort()).toEqual(['cache', 'tx']);
    expect(db?.questionCount).toBe(4);
    expect(await ids({ tagIds: ['cache'] })).toEqual([QID.redisExpire, QID.redisPersist]);
    expect(await ids({ tagIds: ['db'] })).toEqual([QID.mysqlTx, QID.mysqlIndex, QID.redisExpire, QID.redisPersist]);
    expect(await ids({ tagIds: ['memory'] })).toEqual([QID.redisExpire]);
    expect(await ids({ tagIds: [] })).toEqual([]);
  });

  it('标签的 description / aliases 随安装写入并由 listTags 返回；本地导出保留它们', async () => {
    const bundle = sampleBundle('1.1.0');
    bundle.tags = bundle.tags.map((tag) =>
      tag.id === 'cache' ? { ...tag, description: '缓存设计与问题', aliases: ['Cache Layer', '缓冲'] } : tag,
    );
    await installBundle(t.rt, bundle);
    const tags = await listTags(t.rt, SAMPLE_BANK_ID);
    expect(tags.find((tag) => tag.id === 'cache')).toMatchObject({ description: '缓存设计与问题', aliases: ['Cache Layer', '缓冲'] });
    expect(tags.find((tag) => tag.id === 'db')).toMatchObject({ description: null, aliases: [] });

    const exported = await exportBundle(t.rt, SAMPLE_BANK_ID);
    expect(exported.tags.find((tag) => tag.id === 'cache')).toEqual({
      id: 'cache',
      name: expect.any(String),
      parent: expect.anything(),
      order: expect.any(Number),
      description: '缓存设计与问题',
      aliases: ['Cache Layer', '缓冲'],
    });
    expect(exported.tags.find((tag) => tag.id === 'db')).not.toHaveProperty('description');
    expect(exported.tags.find((tag) => tag.id === 'db')).not.toHaveProperty('aliases');
  });

  it('详情附带前置题 / 相关题：按书写顺序，带标题与掌握度', async () => {
    await setMastery(t.rt, SAMPLE_BANK_ID, QID.mysqlIndex, 'known');
    const tx = await getQuestion(t.rt, SAMPLE_BANK_ID, QID.mysqlTx);
    expect(tx?.links).toEqual({
      prerequisites: [{ id: QID.mysqlIndex, title: 'MySQL 索引为什么用 B+ 树？', mastery: 'known' }],
      related: [],
    });
    const expire = await getQuestion(t.rt, SAMPLE_BANK_ID, QID.redisExpire);
    expect(expire?.links.related).toEqual([{ id: QID.redisPersist, title: 'Redis 持久化 RDB 与 AOF 的区别', mastery: null }]);
    const persist = await getQuestion(t.rt, SAMPLE_BANK_ID, QID.redisPersist);
    expect(persist?.links).toEqual({ prerequisites: [], related: [] });
  });

  it('难度 / 类型 / 重要度 / 分类 / 专题筛选', async () => {
    expect(await ids({ difficulties: ['easy'] })).toEqual([QID.tcpHandshake, QID.redisPersist]);
    expect(await ids({ types: ['choice'] })).toEqual([QID.mysqlIndex]);
    expect(await ids({ importance: [3] })).toEqual([QID.mysqlTx, QID.redisExpire]);
    expect(await ids({ categoryIds: ['redis'], difficulties: ['medium'] })).toEqual([QID.redisExpire]);
    // 专题按专题内顺序
    expect(await ids({ collectionId: 'sprint' })).toEqual([QID.mysqlTx, QID.redisExpire]);
    const collections = await listCollections(t.rt, SAMPLE_BANK_ID);
    expect(collections).toEqual([{ id: 'sprint', name: '冲刺', description: '高频题', questionIds: [QID.mysqlTx, QID.redisExpire] }]);
  });

  it('掌握度 / 收藏 / 内容已更新筛选', async () => {
    await setMastery(t.rt, SAMPLE_BANK_ID, QID.redisExpire, 'known');
    await setMastery(t.rt, SAMPLE_BANK_ID, QID.mysqlTx, 'fuzzy');
    await setFavorite(t.rt, SAMPLE_BANK_ID, QID.tcpHandshake, true);
    expect(await ids({ mastery: ['known'] })).toEqual([QID.redisExpire]);
    expect(await ids({ mastery: ['fuzzy', 'unknown'] })).toEqual([QID.mysqlTx]);
    expect(await ids({ mastery: ['unmarked'] })).toEqual([QID.mysqlIndex, QID.tcpHandshake, QID.redisPersist]);
    expect(await ids({ favoritesOnly: true })).toEqual([QID.tcpHandshake]);
    const [item] = await listQuestions(t.rt, SAMPLE_BANK_ID, { favoritesOnly: true });
    expect(item).toMatchObject({ favorite: true, mastery: null, dueAt: null, contentUpdated: false });

    await markViewed(t.rt, SAMPLE_BANK_ID, QID.redisPersist);
    const v2 = sampleBundle('1.1.0');
    v2.questions[1].answer.summary = '改了';
    v2.questions[1] = finalize(v2.questions[1]);
    await installBundle(t.rt, v2);
    expect(await ids({ updatedSinceSeen: true })).toEqual([QID.redisPersist]);
    await markViewed(t.rt, SAMPLE_BANK_ID, QID.redisPersist);
    expect(await ids({ updatedSinceSeen: true })).toEqual([]);
  });

  it('搜索：≥3 字走 FTS5 trigram（标题优先），2 字中文走 LIKE，可叠加筛选', async () => {
    const hits = await searchQuestions(t.rt, SAMPLE_BANK_ID, '持久化');
    expect(hits.map((h) => [h.id, h.matchedIn])).toEqual([[QID.redisPersist, 'title']]);

    const body = await searchQuestions(t.rt, SAMPLE_BANK_ID, '间隙锁');
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ id: QID.mysqlTx, matchedIn: 'body' });
    expect(body[0].snippet).toContain('间隙锁');

    // 「事务」只有 2 个字：trigram 无法匹配，走 LIKE
    const short = await searchQuestions(t.rt, SAMPLE_BANK_ID, '事务');
    expect(short.map((h) => h.id)).toEqual([QID.mysqlTx]);
    // 多词 AND：长词 FTS + 短词 LIKE
    expect((await searchQuestions(t.rt, SAMPLE_BANK_ID, 'Redis 删除')).map((h) => h.id)).toEqual([QID.redisExpire]);
    // 大小写不敏感
    expect((await searchQuestions(t.rt, SAMPLE_BANK_ID, 'redis')).map((h) => h.id).sort()).toEqual([QID.redisExpire, QID.redisPersist].sort());
    // 叠加筛选
    expect(await searchQuestions(t.rt, SAMPLE_BANK_ID, 'redis', { filter: { difficulties: ['easy'] } })).toHaveLength(1);
    // LIKE 通配符转义
    expect(await searchQuestions(t.rt, SAMPLE_BANK_ID, '%')).toEqual([]);
    expect(await searchQuestions(t.rt, SAMPLE_BANK_ID, '   ')).toEqual([]);
    // 资源引用不进入搜索正文
    expect(await searchQuestions(t.rt, SAMPLE_BANK_ID, SAMPLE_ASSET_NAME.slice(0, 10))).toEqual([]);
  });

  it('搜索只限当前题库', async () => {
    const other = sampleBundle();
    other.bank.id = 'github.com/other/bank';
    delete other.bank.update;
    other.questions = other.questions.map((q) => ({ ...q, answer: { ...q.answer, detail: null } }));
    await installBundle(t.rt, other);
    expect(await searchQuestions(t.rt, SAMPLE_BANK_ID, '持久化')).toHaveLength(1);
    expect(await searchQuestions(t.rt, 'github.com/other/bank', '持久化')).toHaveLength(1);
  });

  it('当前题库持久化；删除题库清资源，学习数据默认保留，可选清除', async () => {
    expect(await getActiveBankId(t.rt)).toBe(SAMPLE_BANK_ID);
    const other = sampleBundle();
    other.bank.id = 'github.com/other/bank';
    delete other.bank.update;
    other.questions = other.questions.map((q) => ({ ...q, answer: { ...q.answer, detail: null } }));
    t.clock.value += 1;
    await installBundle(t.rt, other);
    await setActiveBankId(t.rt, 'github.com/other/bank');
    expect(await getActiveBankId(t.rt)).toBe('github.com/other/bank');
    await expect(setActiveBankId(t.rt, 'nope/x/y')).rejects.toMatchObject({ code: 'not-found' });

    await setMastery(t.rt, SAMPLE_BANK_ID, QID.redisExpire, 'known');
    const base = (await getAssetBaseUri(t.rt, SAMPLE_BANK_ID)) as string;
    await deleteBank(t.rt, SAMPLE_BANK_ID);
    expect(fs.existsSync(base)).toBe(false);
    expect((await listBanks(t.rt)).map((b) => b.id)).toEqual(['github.com/other/bank']);
    const kept = await t.db.getAllAsync('SELECT question_id FROM progress WHERE bank_id = ?', [SAMPLE_BANK_ID]);
    expect(kept).toHaveLength(1);

    // 重新安装后学习数据恢复
    await installBundle(t.rt, sampleBundle());
    expect(await ids({ mastery: ['known'] })).toEqual([QID.redisExpire]);

    await deleteBank(t.rt, 'github.com/other/bank', { purgeLearningData: true });
    await setMastery(t.rt, SAMPLE_BANK_ID, QID.mysqlTx, 'known');
    await deleteBank(t.rt, SAMPLE_BANK_ID, { purgeLearningData: true });
    expect(await t.db.getAllAsync('SELECT * FROM progress')).toEqual([]);
    expect(await getActiveBankId(t.rt)).toBeNull();
  });

  it('自动选中的当前题库会被持久化：之后装入安装时间相同、id 更靠前的题库也不会悄悄切换', async () => {
    // 从未显式选择过：回退到最早安装的样例题库
    expect(await getActiveBankId(t.rt)).toBe(SAMPLE_BANK_ID);

    const earlier = sampleBundle();
    earlier.bank.id = 'github.com/aaa/first'; // id 排序更靠前
    delete earlier.bank.update;
    // 不推进时钟：与样例题库安装时间相同，单靠 ORDER BY installed_at, id 会选中它
    await installBundle(t.rt, earlier);

    expect(await getActiveBankId(t.rt)).toBe(SAMPLE_BANK_ID);
  });
});
