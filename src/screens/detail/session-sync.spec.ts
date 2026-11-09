import { createTestRuntime, publish, type TestRuntime } from '../../bank/__fixtures__/node-runtime';
import { QID, SAMPLE_ASSET_CONTENT, SAMPLE_ASSET_NAME, sampleBundle } from '../../bank/__fixtures__/sample-bank';
import { resetBankStoreForTests, useBankStore } from '../../bank/store';
import { syncPracticeIndex } from './session-sync';

jest.mock('../../bank/runtime', () => ({ createDefaultRuntime: async () => null }));

/** 等待 fire-and-forget 的 store 写入落库 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('syncPracticeIndex（题库 v2 会话）', () => {
  let t: TestRuntime;
  beforeEach(async () => {
    await resetBankStoreForTests();
    t = await createTestRuntime({ migrate: false });
  });
  afterEach(async () => {
    await resetBankStoreForTests();
    await t.cleanup();
  });

  it('store 未就绪时直接忽略（不写 lastError）', () => {
    expect(() => syncPracticeIndex(1)).not.toThrow();
    expect(useBankStore.getState().lastError).toBeNull();
  });

  it('有会话时经 updateSessionIndex 推进下标', async () => {
    await useBankStore.getState().initialize({ runtime: t.rt });
    await useBankStore.getState().addOnlineBank(publish(t, sampleBundle(), { assets: { [SAMPLE_ASSET_NAME]: SAMPLE_ASSET_CONTENT } }));
    await useBankStore.getState().saveSession({ queue: [QID.mysqlTx, QID.redisExpire, QID.tcpHandshake], index: 0, mode: 'practice' });

    syncPracticeIndex(2);
    await flush();
    const session = await useBankStore.getState().getSession();
    expect(session.ok && session.value?.index).toBe(2);
  });

  it('没有会话时静默忽略', async () => {
    await useBankStore.getState().initialize({ runtime: t.rt });
    await useBankStore.getState().addOnlineBank(publish(t, sampleBundle(), { assets: { [SAMPLE_ASSET_NAME]: SAMPLE_ASSET_CONTENT } }));
    syncPracticeIndex(3);
    await flush();
    expect(useBankStore.getState().lastError).toBeNull();
  });
});
