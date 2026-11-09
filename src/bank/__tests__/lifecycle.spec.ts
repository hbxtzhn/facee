import { createTestRuntime, type TestRuntime } from '../__fixtures__/node-runtime';
import { finalize, QID, SAMPLE_BANK_ID, sampleBundle } from '../__fixtures__/sample-bank';
import { installBundle } from '../install';
import {
  getQuestionLearning,
  listArchivedQuestionIds,
  listKeypointAttempts,
  recordKeypointCheck,
  setFavorite,
  setFollowupMastery,
  setMastery,
} from '../learning';
import { getRawQuestion } from '../repository';
import { getSession, saveSession } from '../sessions';
import type { Question } from '../types';

describe('lifecycle 迁移学习数据', () => {
  let t: TestRuntime;
  beforeEach(async () => {
    t = await createTestRuntime();
    const bundle = sampleBundle();
    delete bundle.bank.update;
    await installBundle(t.rt, bundle);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  const learningOf = async (id: string) => getQuestionLearning(t.rt, SAMPLE_BANK_ID, (await getRawQuestion(t.rt, SAMPLE_BANK_ID, id)) as Question);

  it('merged：学习数据并入目标题，冲突时取最近一次标记；会话队列改写', async () => {
    // 旧题 redisPersist：较晚标记「不会」、收藏、追问无、要点自评一次
    // 目标题 redisExpire：较早标记「会了」
    await setMastery(t.rt, SAMPLE_BANK_ID, QID.redisExpire, 'known');
    t.clock.value += 1000;
    await setMastery(t.rt, SAMPLE_BANK_ID, QID.redisPersist, 'unknown');
    await setFavorite(t.rt, SAMPLE_BANK_ID, QID.redisPersist, true);
    await recordKeypointCheck(t.rt, SAMPLE_BANK_ID, QID.redisPersist, { kp1: true, kp2: false, kp3: true });
    await saveSession(t.rt, SAMPLE_BANK_ID, { queue: [QID.redisPersist, QID.redisExpire, QID.mysqlTx], index: 0, mode: 'practice' });

    const v2 = sampleBundle('1.1.0');
    delete v2.bank.update;
    v2.questions = v2.questions.filter((q) => q.id !== QID.redisPersist);
    v2.questions[0].related = undefined;
    delete v2.questions[0].related;
    v2.lifecycle.merged[QID.redisPersist] = QID.redisExpire;
    v2.questions[0] = finalize(v2.questions[0]);
    t.clock.value += 1000;
    await installBundle(t.rt, v2);

    const merged = await learningOf(QID.redisExpire);
    expect(merged.mastery).toBe('unknown'); // 较晚的标记胜出
    expect(merged.favorite).toBe(true);
    // 旧题的要点自评已并入（kp1–kp3 在目标题也存在）
    expect(merged.lastKeypointCheck?.covered).toEqual({ kp1: true, kp2: false, kp3: true });
    const leftovers = await t.db.getAllAsync('SELECT * FROM progress WHERE question_id = ?', [QID.redisPersist]);
    expect(leftovers).toEqual([]);
    const session = await getSession(t.rt, SAMPLE_BANK_ID);
    expect(session?.queue).toEqual([QID.redisExpire, QID.mysqlTx]);
    expect(session?.index).toBe(0);

    // 幂等：再次安装同一版本不改变结果
    await installBundle(t.rt, v2);
    expect((await learningOf(QID.redisExpire)).mastery).toBe('unknown');
  });

  it('merged：目标题较新时保留目标题标记；追问按更新时间合并', async () => {
    await setMastery(t.rt, SAMPLE_BANK_ID, QID.mysqlIndex, 'fuzzy');
    t.clock.value += 1000;
    await setMastery(t.rt, SAMPLE_BANK_ID, QID.mysqlTx, 'known');
    await setFollowupMastery(t.rt, SAMPLE_BANK_ID, QID.mysqlTx, 'f1', 'known');

    const v2 = sampleBundle('1.1.0');
    delete v2.bank.update;
    v2.questions = v2.questions.filter((q) => q.id !== QID.mysqlIndex);
    const tx = v2.questions.find((q) => q.id === QID.mysqlTx) as Question;
    delete tx.prerequisites;
    Object.assign(tx, finalize(tx));
    v2.lifecycle.merged[QID.mysqlIndex] = QID.mysqlTx;
    await installBundle(t.rt, v2);
    const learning = await learningOf(QID.mysqlTx);
    expect(learning.mastery).toBe('known');
    expect(learning.followups).toEqual({ f1: 'known' });
  });

  it('removed：学习数据保留并标记归档，出现在「已移除题目」中', async () => {
    await setMastery(t.rt, SAMPLE_BANK_ID, QID.tcpHandshake, 'fuzzy');
    await setFavorite(t.rt, SAMPLE_BANK_ID, QID.tcpHandshake, true);
    const v2 = sampleBundle('1.1.0');
    delete v2.bank.update;
    v2.questions = v2.questions.filter((q) => q.id !== QID.tcpHandshake);
    v2.lifecycle.removed.push(QID.tcpHandshake);
    await installBundle(t.rt, v2);

    const progress = await t.db.getFirstAsync<{ mastery: string; archived_at: number | null }>(
      'SELECT mastery, archived_at FROM progress WHERE bank_id = ? AND question_id = ?',
      [SAMPLE_BANK_ID, QID.tcpHandshake],
    );
    expect(progress?.mastery).toBe('fuzzy');
    expect(progress?.archived_at).toBe(t.clock.value);
    expect(await listArchivedQuestionIds(t.rt, SAMPLE_BANK_ID)).toEqual([QID.tcpHandshake]);
  });

  it('删除的要点：自评记录归入 archivedKeypointIds，不参与覆盖率', async () => {
    await recordKeypointCheck(t.rt, SAMPLE_BANK_ID, QID.mysqlTx, { kp1: true, kp2: true, kp3: false, kp4: true });
    const v2 = sampleBundle('1.1.0');
    delete v2.bank.update;
    const tx = v2.questions.find((q) => q.id === QID.mysqlTx) as Question;
    tx.answer.keyPoints = tx.answer.keyPoints.filter((kp) => kp.id !== 'kp4');
    Object.assign(tx, finalize(tx));
    await installBundle(t.rt, v2);
    const [attempt] = await listKeypointAttempts(t.rt, SAMPLE_BANK_ID, QID.mysqlTx);
    expect(attempt.covered).toEqual({ kp1: true, kp2: true, kp3: false });
    expect(attempt.archivedKeypointIds).toEqual(['kp4']);
    // 权重：kp1 1 + kp2 3 命中，kp3 2 未命中 ⇒ 4/6
    expect(attempt.weightedCoverage).toBeCloseTo(4 / 6);
  });
});
