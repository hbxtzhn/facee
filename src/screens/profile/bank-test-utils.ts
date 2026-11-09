/**
 * 「我的」/ 题库管理相关界面测试的公共夹具：真实 useBankStore + Node SQLite 运行时（src/bank/__fixtures__）。
 * 仅供 *.spec.tsx 使用；界面测试需在自己的文件里 jest.mock('expo-file-system/legacy', mockLegacyFs)。
 */
import type * as fs from 'node:fs';
import { createTestRuntime, publish, type TestRuntime } from '../../bank/__fixtures__/node-runtime';
import { SAMPLE_ASSET_CONTENT, SAMPLE_ASSET_NAME, sampleBundle } from '../../bank/__fixtures__/sample-bank';
import { resetBankStoreForTests, useBankStore } from '../../bank/store';
import type { Bundle } from '../../bank/types';

export { SAMPLE_BANK_ID, QID, sampleBundle } from '../../bank/__fixtures__/sample-bank';

export const SAMPLE_ASSETS = { [SAMPLE_ASSET_NAME]: SAMPLE_ASSET_CONTENT };

/** expo-file-system/legacy 的 Node 实现（测试运行时的 URI 就是普通路径） */
export function mockLegacyFs() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nodeFs = require('node:fs') as typeof fs;
  return {
    readAsStringAsync: async (uri: string) => nodeFs.readFileSync(uri, 'utf8'),
    writeAsStringAsync: async (uri: string, text: string) => nodeFs.writeFileSync(uri, text, 'utf8'),
    deleteAsync: async (uri: string) => nodeFs.rmSync(uri, { force: true, recursive: true }),
    cacheDirectory: null,
    documentDirectory: null,
  };
}

export async function setupBankStore(): Promise<TestRuntime> {
  await resetBankStoreForTests();
  const t = await createTestRuntime({ migrate: false });
  const result = await useBankStore.getState().initialize({ runtime: t.rt });
  if (!result.ok) throw new Error(result.error.message);
  return t;
}

export async function teardownBankStore(t: TestRuntime): Promise<void> {
  await resetBankStoreForTests();
  await t.cleanup();
}

/** 发布并安装示例在线题库，返回 latest.json 地址 */
export async function installSampleRemote(t: TestRuntime, bundle: Bundle = sampleBundle()): Promise<string> {
  const url = publish(t, bundle, { assets: SAMPLE_ASSETS });
  const result = await useBankStore.getState().addOnlineBank(url);
  if (!result.ok) throw new Error(result.error.message);
  return url;
}

/** 示例题库去掉更新地址后的 bundle 文件（导入后为只读的文件题库） */
export function writeFileBundle(t: TestRuntime, name = 'shared.json'): string {
  const bundle = sampleBundle();
  delete bundle.bank.update;
  bundle.bank.id = 'example.com/friend/shared-bank';
  bundle.bank.name = '朋友分享的题库';
  return t.writeLocalFile(name, JSON.stringify(bundle));
}

export { publish };
