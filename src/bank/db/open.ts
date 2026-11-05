import { BankError } from '../errors';
import type { BankDatabase } from './types';

/**
 * Web 实现：不支持本地题库。
 *
 * expo-sqlite 在 Web 需要 wasm 资源与 COOP/COEP 响应头，CI 的 `expo export --platform web`
 * 与静态托管的预览都不具备，因此 Web 端不打包 expo-sqlite，由 store 进入「unsupported」状态。
 * 原生端由 Metro 解析同名 open.native.ts。
 */
export const BANK_DATABASE_NAME = 'facee-bank-v2.db';

export async function openBankDatabase(_name: string = BANK_DATABASE_NAME): Promise<BankDatabase> {
  throw new BankError('unsupported', 'Web 预览不支持本地题库，请在 Android App 中使用');
}
