import type { BankRuntime } from './runtime-types';

/**
 * Web 端默认运行时：不支持本地题库，返回 null（store 据此进入 unsupported 状态）。
 * 原生端由 Metro 解析同名 runtime.native.ts；这里不 import 任何原生模块，
 * 保证 `expo export --platform web` 不会把 expo-sqlite / zip 打进 Web 包。
 */
export async function createDefaultRuntime(): Promise<BankRuntime | null> {
  return null;
}
