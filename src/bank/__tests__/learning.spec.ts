import { createTestRuntime, type TestRuntime } from '../__fixtures__/node-runtime';
import { QID, SAMPLE_BANK_ID, sampleBundle } from '../__fixtures__/sample-bank';
import { installBundle } from '../install';
import {
  getLearningStats,
  listDueQuestionIds,
  listKeypointAttempts,
  recordKeypointCheck,
  setFollowupMastery,
  setMastery,
  suggestMasteryFromCoverage,
  toggleFavorite,
} from '../learning';
import { getQuestion } from '../repository';
import { DAY_MS } from '../spaced-review';
import { clearSession, getSession, resolveSessionQueue, saveSession, updateSessionIndex } from '../sessions';
import {
  addCategoryToSection,
  createSection,
  deleteSection,
  listSections,
  removeCategoryFromSection,
  renameSection,
  reorderSectionCategories,
  reorderSections,
} from '../sections';

describe('学习数据', () => {
  let t: TestRuntime;
  beforeEach(async () => {
    t = await createTestRuntime();
    await installBundle(t.rt, sampleBundle());
  });
  afterEach(async () => {
    await t.cleanup();
  });

  const advance = (days: number) => {
    t.clock.value += days * DAY_MS;
  };

  describe('掌握度与间隔复习', () => {
    it('不会 1 天 / 模糊 3 天 / 会了 7 天起，整边界即到期', async () => {
      const start = t.clock.value;
      expect(await setMastery(t.rt, SAMPLE_BANK_ID, QID.mysqlTx, 'unknown')).toEqual({ mastery: 'unknown', streak: 0, dueAt: start + DAY_MS, markedAt: start });
      expect((await setMastery(t.rt, SAMPLE_BANK_ID, QID.redisExpire, 'fuzzy')).dueAt).toBe(start + 3 * DAY_MS);
      expect((await setMastery(t.rt, SAMPLE_BANK_ID, QID.tcpHandshake, 'known')).dueAt).toBe(start + 7 * DAY_MS);
      expect(await listDueQuestionIds(t.rt, SAMPLE_BANK_ID)).toEqual([]);
      advance(1);
      expect(await listDueQuestionIds(t.rt, SAMPLE_BANK_ID)).toEqual([QID.mysqlTx]);
      advance(6);
      // 同一打标时刻按 id 排序
      expect(await listDueQuestionIds(t.rt, SAMPLE_BANK_ID)).toEqual([QID.redisExpire, QID.mysqlTx, QID.tcpHandshake].sort());
    });

    it('「会了」连续次数只在到期后再确认时增长：7 → 14 → 30 → 60 封顶；未到期重复确认不变', async () => {
      const mark = () => setMastery(t.rt, SAMPLE_BANK_ID, QID.redisExpire, 'known');
      expect((await mark()).streak).toBe(1);
      advance(1);
      const early = await mark();
      expect(early.streak).toBe(1); // 未到期：保持
      expect(early.dueAt).toBe(t.clock.value + 7 * DAY_MS);
      advance(7);
      expect(await mark()).toMatchObject({ streak: 2, dueAt: t.clock.value + 14 * DAY_MS });
      advance(14);
      expect(await mark()).toMatchObject({ streak: 3, dueAt: t.clock.value + 30 * DAY_MS });
      advance(30);
      expect(await mark()).toMatchObject({ streak: 4, dueAt: t.clock.value + 60 * DAY_MS });
      advance(60);
      expect(await mark()).toMatchObject({ streak: 5, dueAt: t.clock.value + 60 * DAY_MS });
      // 模糊清零，再会了从 1 开始
      expect((await setMastery(t.rt, SAMPLE_BANK_ID, QID.redisExpire, 'fuzzy')).streak).toBe(0);
      expect((await mark()).streak).toBe(1);
    });

    it('清除标记退出复习循环但保留浏览记录；无效掌握度 / 不存在的题报错', async () => {
      await setMastery(t.rt, SAMPLE_BANK_ID, QID.mysqlTx, 'unknown');
      advance(2);
      await setMastery(t.rt, SAMPLE_BANK_ID, QID.mysqlTx, null);
      expect(await listDueQuestionIds(t.rt, SAMPLE_BANK_ID)).toEqual([]);
      const detail = await getQuestion(t.rt, SAMPLE_BANK_ID, QID.mysqlTx);
      expect(detail?.learning).toMatchObject({ mastery: null, dueAt: null, streak: 0 });
      await expect(setMastery(t.rt, SAMPLE_BANK_ID, QID.mysqlTx, 'great' as never)).rejects.toMatchObject({ code: 'invalid' });
      await expect(setMastery(t.rt, SAMPLE_BANK_ID, 'q_01JC8ZQ4N3V6W8X0Y2Z4A6B8ZZ', 'known')).rejects.toMatchObject({ code: 'not-found' });
    });

    it('统计', async () => {
      await setMastery(t.rt, SAMPLE_BANK_ID, QID.mysqlTx, 'unknown');
      await setMastery(t.rt, SAMPLE_BANK_ID, QID.redisExpire, 'known');
      await toggleFavorite(t.rt, SAMPLE_BANK_ID, QID.redisExpire);
      advance(1);
      expect(await getLearningStats(t.rt, SAMPLE_BANK_ID)).toEqual({
        questionCount: 5, markedCount: 2, knownCount: 1, fuzzyCount: 0, unknownCount: 1, dueCount: 1, favoriteCount: 1, updatedCount: 0,
      });
    });
  });

  it('要点自评按次记录、加权覆盖率；参数校验', async () => {
    const first = await recordKeypointCheck(t.rt, SAMPLE_BANK_ID, QID.redisExpire, { kp1: true, kp2: false, kp3: true });
    expect(first.weightedCoverage).toBeCloseTo(3 / 5);
    const second = await recordKeypointCheck(t.rt, SAMPLE_BANK_ID, QID.redisExpire, { kp1: true, kp2: true, kp3: true });
    expect(second.checkedAt).toBe(first.checkedAt + 1); // 同一毫秒顺延
    const attempts = await listKeypointAttempts(t.rt, SAMPLE_BANK_ID, QID.redisExpire);
    expect(attempts.map((a) => a.weightedCoverage)).toEqual([1, 0.6]);
    expect(suggestMasteryFromCoverage(1)).toBe('known');
    expect(suggestMasteryFromCoverage(0.6)).toBe('fuzzy');
    expect(suggestMasteryFromCoverage(0.2)).toBe('unknown');
    const detail = await getQuestion(t.rt, SAMPLE_BANK_ID, QID.redisExpire);
    expect(detail?.learning.lastKeypointCheck?.covered).toEqual({ kp1: true, kp2: true, kp3: true });
    await expect(recordKeypointCheck(t.rt, SAMPLE_BANK_ID, QID.redisExpire, { kp1: true })).rejects.toMatchObject({ code: 'invalid' });
    await expect(recordKeypointCheck(t.rt, SAMPLE_BANK_ID, QID.redisExpire, { kp1: true, kp2: true, kp3: true, kp9: true })).rejects.toMatchObject({ code: 'invalid' });
  });

  it('追问掌握与收藏', async () => {
    await setFollowupMastery(t.rt, SAMPLE_BANK_ID, QID.mysqlTx, 'f2', 'fuzzy');
    await setFollowupMastery(t.rt, SAMPLE_BANK_ID, QID.mysqlTx, 'f1', 'known');
    await setFollowupMastery(t.rt, SAMPLE_BANK_ID, QID.mysqlTx, 'f1', null);
    await expect(setFollowupMastery(t.rt, SAMPLE_BANK_ID, QID.mysqlTx, 'f9', 'known')).rejects.toMatchObject({ code: 'not-found' });
    expect(await toggleFavorite(t.rt, SAMPLE_BANK_ID, QID.mysqlTx)).toBe(true);
    const detail = await getQuestion(t.rt, SAMPLE_BANK_ID, QID.mysqlTx);
    expect(detail?.learning).toMatchObject({ followups: { f2: 'fuzzy' }, favorite: true });
    expect(await toggleFavorite(t.rt, SAMPLE_BANK_ID, QID.mysqlTx)).toBe(false);
  });

  describe('练习会话', () => {
    it('保存 / 读取 / 推进下标 / 清除；无效队列不写入', async () => {
      expect(await saveSession(t.rt, SAMPLE_BANK_ID, { queue: [], index: 0, mode: 'practice' })).toBeNull();
      const saved = await saveSession(t.rt, SAMPLE_BANK_ID, { queue: [QID.mysqlTx, QID.redisExpire, QID.tcpHandshake], index: 9, mode: 'review', title: '今日复习' });
      expect(saved).toMatchObject({ index: 2, mode: 'review', title: '今日复习' });
      await updateSessionIndex(t.rt, SAMPLE_BANK_ID, 1);
      expect(await getSession(t.rt, SAMPLE_BANK_ID)).toMatchObject({ queue: [QID.mysqlTx, QID.redisExpire, QID.tcpHandshake], index: 1 });
      await updateSessionIndex(t.rt, SAMPLE_BANK_ID, -5);
      expect((await getSession(t.rt, SAMPLE_BANK_ID))?.index).toBe(0);
      await clearSession(t.rt, SAMPLE_BANK_ID);
      expect(await getSession(t.rt, SAMPLE_BANK_ID)).toBeNull();
    });

    it('题库更新后剔除不存在的题，下标落到原位置或其后第一道仍存在的题', async () => {
      await saveSession(t.rt, SAMPLE_BANK_ID, { queue: [QID.mysqlTx, QID.tcpHandshake, QID.redisExpire], index: 1, mode: 'practice' });
      const v2 = sampleBundle('1.1.0');
      v2.questions = v2.questions.filter((q) => q.id !== QID.tcpHandshake);
      v2.lifecycle.removed.push(QID.tcpHandshake);
      await installBundle(t.rt, v2);
      expect(await getSession(t.rt, SAMPLE_BANK_ID)).toMatchObject({ queue: [QID.mysqlTx, QID.redisExpire], index: 1 });
      expect(resolveSessionQueue({ queue: ['a', 'b'], index: 1 }, new Set(['a']))).toEqual({ queue: ['a'], index: 0 });
      expect(resolveSessionQueue({ queue: ['a'], index: 0 }, new Set())).toBeNull();
    });
  });

  describe('自定义分区（issue #3）', () => {
    it('增删改排；分类在题库更新后消失时标记为不存在并可移除', async () => {
      const a = await createSection(t.rt, SAMPLE_BANK_ID, ' 后端 ');
      t.clock.value += 1;
      const b = await createSection(t.rt, SAMPLE_BANK_ID, '网络');
      await expect(createSection(t.rt, SAMPLE_BANK_ID, '  ')).rejects.toMatchObject({ code: 'invalid' });
      await renameSection(t.rt, SAMPLE_BANK_ID, a, '后端存储');
      await addCategoryToSection(t.rt, SAMPLE_BANK_ID, a, 'redis');
      await addCategoryToSection(t.rt, SAMPLE_BANK_ID, a, 'mysql');
      await addCategoryToSection(t.rt, SAMPLE_BANK_ID, a, 'redis'); // 重复忽略
      await addCategoryToSection(t.rt, SAMPLE_BANK_ID, b, 'network');
      await expect(addCategoryToSection(t.rt, SAMPLE_BANK_ID, a, 'ghost')).rejects.toMatchObject({ code: 'not-found' });
      await reorderSections(t.rt, SAMPLE_BANK_ID, [b, a]);
      await reorderSectionCategories(t.rt, SAMPLE_BANK_ID, a, ['mysql', 'redis']);
      await expect(reorderSections(t.rt, SAMPLE_BANK_ID, [a])).rejects.toMatchObject({ code: 'invalid' });

      let sections = await listSections(t.rt, SAMPLE_BANK_ID);
      expect(sections.map((s) => [s.name, s.categories.map((c) => c.id)])).toEqual([
        ['网络', ['network']],
        ['后端存储', ['mysql', 'redis']],
      ]);
      expect(sections[1].categories[0]).toEqual({ id: 'mysql', name: 'MySQL', exists: true, questionCount: 2 });

      // 新版本删除 network 分类
      const v2 = sampleBundle('1.1.0');
      v2.categories = v2.categories.filter((c) => c.id !== 'network');
      v2.questions = v2.questions.filter((q) => q.id !== QID.tcpHandshake);
      v2.lifecycle.removed.push(QID.tcpHandshake);
      await installBundle(t.rt, v2);
      sections = await listSections(t.rt, SAMPLE_BANK_ID);
      expect(sections[0].categories).toEqual([{ id: 'network', name: null, exists: false, questionCount: 0 }]);
      await removeCategoryFromSection(t.rt, SAMPLE_BANK_ID, b, 'network');
      await deleteSection(t.rt, SAMPLE_BANK_ID, a);
      sections = await listSections(t.rt, SAMPLE_BANK_ID);
      expect(sections).toEqual([{ id: b, name: '网络', order: 0, categories: [] }]);
    });
  });
});
