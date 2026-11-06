import { createTestRuntime, publish, type TestRuntime } from '../../../bank/__fixtures__/node-runtime';
import { QID, SAMPLE_ASSET_CONTENT, SAMPLE_ASSET_NAME, SAMPLE_BANK_ID, sampleBundle } from '../../../bank/__fixtures__/sample-bank';
import { resetBankStoreForTests, useBankStore } from '../../../bank/store';
import type { Bundle } from '../../../bank';

const ASSETS = { [SAMPLE_ASSET_NAME]: SAMPLE_ASSET_CONTENT };

/**
 * 屏幕测试用：真实 useBankStore + Node SQLite 运行时 + 内存网络里的样例题库。
 * 使用方需在 spec 顶部 `jest.mock('../bank/runtime', () => ({ createDefaultRuntime: async () => null }))`
 * （路径按 spec 位置调整），避免加载原生 expo-sqlite。
 */

export { QID, SAMPLE_BANK_ID, sampleBundle };

export const bankStore = () => useBankStore.getState();

export async function unwrap<T>(pending: Promise<{ ok: true; value: T } | { ok: false; error: { message: string } }>): Promise<T> {
  const result = await pending;
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** 初始化 store（不装题库） */
export async function startEmptyBank(): Promise<TestRuntime> {
  await resetBankStoreForTests();
  const t = await createTestRuntime({ migrate: false });
  await unwrap(useBankStore.getState().initialize({ runtime: t.rt }));
  return t;
}

/** 初始化 store 并安装样例题库（成为当前题库） */
export async function startSampleBank(bundle: Bundle = sampleBundle()): Promise<TestRuntime> {
  const t = await startEmptyBank();
  await unwrap(useBankStore.getState().addOnlineBank(publish(t, bundle, { assets: ASSETS })));
  return t;
}

/** 发布并安装新版本（同一地址） */
export async function updateSampleBank(t: TestRuntime, bundle: Bundle): Promise<void> {
  publish(t, bundle, { assets: ASSETS });
  await unwrap(useBankStore.getState().updateBank(SAMPLE_BANK_ID));
}

export async function stopBank(t: TestRuntime | null): Promise<void> {
  await resetBankStoreForTests();
  await t?.cleanup();
}
