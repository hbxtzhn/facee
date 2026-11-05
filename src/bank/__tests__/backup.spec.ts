import * as fs from 'node:fs';
import { createTestRuntime, type TestRuntime } from '../__fixtures__/node-runtime';
import { QID, SAMPLE_BANK_ID, sampleBundle } from '../__fixtures__/sample-bank';
import { createBackup, exportBackupFile, importBackupFile, restoreBackup } from '../backup';
import { installBundle } from '../install';
import { getQuestionLearning, recordKeypointCheck, setFavorite, setMastery } from '../learning';
import { addLocalQuestion, createLocalBank, updateLocalBankInfo } from '../local';
import { getBank, getRawQuestion, listQuestions } from '../repository';
import { addCategoryToSection, createSection, listSections, renameSection } from '../sections';
import { getSession, saveSession } from '../sessions';
import type { Question } from '../types';

describe('备份与恢复', () => {
  let a: TestRuntime;
  let b: TestRuntime;
  beforeEach(async () => {
    a = await createTestRuntime();
    b = await createTestRuntime();
    await installBundle(a.rt, sampleBundle());
    await installBundle(b.rt, sampleBundle());
  });
  afterEach(async () => {
    await a.cleanup();
    await b.cleanup();
  });

  const learning = async (t: TestRuntime, id: string) =>
    getQuestionLearning(t.rt, SAMPLE_BANK_ID, (await getRawQuestion(t.rt, SAMPLE_BANK_ID, id)) as Question);

  it('导出 → 导入：按主键合并，较新记录胜出；收藏与自评取并集；本地题库重新导入', async () => {
    // 设备 A：较早标记 mysqlTx，较晚标记 redisExpire
    await setMastery(a.rt, SAMPLE_BANK_ID, QID.mysqlTx, 'known');
    a.clock.value += 10_000;
    await setMastery(a.rt, SAMPLE_BANK_ID, QID.redisExpire, 'unknown');
    await setFavorite(a.rt, SAMPLE_BANK_ID, QID.tcpHandshake, true);
    await recordKeypointCheck(a.rt, SAMPLE_BANK_ID, QID.redisExpire, { kp1: true, kp2: true, kp3: false });
    await saveSession(a.rt, SAMPLE_BANK_ID, { queue: [QID.redisExpire], index: 0, mode: 'review', title: 'A' });
    const section = await createSection(a.rt, SAMPLE_BANK_ID, '我的分区');
    await addCategoryToSection(a.rt, SAMPLE_BANK_ID, section, 'redis');
    const localId = await createLocalBank(a.rt, { name: 'A 的本地库' });
    const localQ = await addLocalQuestion(a.rt, localId, {
      title: '本地题', type: 'concept', difficulty: 'easy', importance: 1, categoryId: 'default',
      answer: { summary: 's', keyPoints: [{ text: '1' }, { text: '2' }, { text: '3' }] },
    });
    await setMastery(a.rt, localId, localQ.id, 'fuzzy');

    // 设备 B：mysqlTx 较晚标记为 fuzzy（应保留 B），redisExpire 较早（应被 A 覆盖）
    b.clock.value = a.clock.value - 5_000;
    await setMastery(b.rt, SAMPLE_BANK_ID, QID.redisExpire, 'known');
    b.clock.value = a.clock.value + 5_000;
    await setMastery(b.rt, SAMPLE_BANK_ID, QID.mysqlTx, 'fuzzy');
    await setFavorite(b.rt, SAMPLE_BANK_ID, QID.mysqlIndex, true);

    const uri = await exportBackupFile(a.rt);
    const fileOnB = b.writeLocalFile('backup.json', fs.readFileSync(uri));
    const result = await importBackupFile(b.rt, fileOnB);

    expect(result.importedLocalBanks).toEqual([localId]);
    expect(result.missingRemoteBanks).toEqual([]);
    expect((await learning(b, QID.mysqlTx)).mastery).toBe('fuzzy');
    expect((await learning(b, QID.redisExpire)).mastery).toBe('unknown');
    expect((await learning(b, QID.redisExpire)).lastKeypointCheck?.covered).toEqual({ kp1: true, kp2: true, kp3: false });
    expect((await listQuestions(b.rt, SAMPLE_BANK_ID, { favoritesOnly: true })).map((q) => q.id).sort()).toEqual([QID.mysqlIndex, QID.tcpHandshake].sort());
    expect(await getSession(b.rt, SAMPLE_BANK_ID)).toMatchObject({ title: 'A' });
    expect((await listSections(b.rt, SAMPLE_BANK_ID)).map((s) => [s.name, s.categories.map((c) => c.id)])).toEqual([['我的分区', ['redis']]]);
    expect((await getBank(b.rt, localId))?.origin).toBe('local');
    expect((await listQuestions(b.rt, localId, { mastery: ['fuzzy'] })).map((q) => q.id)).toEqual([localQ.id]);

    // 重复导入幂等
    const again = await importBackupFile(b.rt, fileOnB);
    expect(again.skippedLocalBanks).toEqual([localId]);
    expect(again.merged.progress).toBe(0);
    expect(again.merged.keypointChecks).toBe(0);
  });

  it('本地题库只在备份版本更高时覆盖；分区较新的一方胜出', async () => {
    const localId = await createLocalBank(a.rt, { name: '旧名' });
    const section = await createSection(a.rt, SAMPLE_BANK_ID, '旧分区名');
    const backup = await createBackup(a.rt);

    await restoreBackup(b.rt, backup);
    await updateLocalBankInfo(b.rt, localId, { name: 'B 改过' });
    b.clock.value += 60_000;
    await renameSection(b.rt, SAMPLE_BANK_ID, section, 'B 的新名');

    const result = await restoreBackup(b.rt, backup);
    expect(result.skippedLocalBanks).toEqual([localId]);
    expect((await getBank(b.rt, localId))?.name).toBe('B 改过');
    expect((await listSections(b.rt, SAMPLE_BANK_ID))[0].name).toBe('B 的新名');
  });

  it('报告本机缺少的在线题库；非法备份整体拒绝且不写入', async () => {
    const other = sampleBundle();
    other.bank.id = 'github.com/other/bank';
    other.bank.update = { manifest: 'https://example.com/other/latest.json' };
    await installBundle(a.rt, other);
    const backup = await createBackup(a.rt);
    const result = await restoreBackup(b.rt, backup);
    expect(result.missingRemoteBanks).toEqual([{ id: 'github.com/other/bank', name: '测试题库', manifestUrl: 'https://example.com/other/latest.json' }]);

    await expect(restoreBackup(b.rt, { format: 'nope' })).rejects.toMatchObject({ code: 'invalid' });
    await expect(restoreBackup(b.rt, { ...backup, version: 9 })).rejects.toMatchObject({ code: 'schema-version' });
    const broken = JSON.parse(JSON.stringify(backup));
    broken.learning.progress = [{ bank_id: SAMPLE_BANK_ID }];
    await expect(restoreBackup(b.rt, broken)).rejects.toMatchObject({ code: 'invalid', details: expect.arrayContaining([expect.stringContaining('learning.progress[0].question_id')]) });
    await expect(importBackupFile(b.rt, b.writeLocalFile('x.json', 'not json'))).rejects.toMatchObject({ code: 'invalid' });
  });
});
