/**
 * 练习会话进度同步：队列模式翻页时把当前下标写进 practiceSessionStore（另一位同事负责）。
 *
 * TODO(merge): practiceSessionStore 合入后，改成直接
 *   `import { usePracticeSessionStore } from '../../store/practiceSessionStore';`
 *   `usePracticeSessionStore.getState().updateIndex(bankId, index);`
 * 并删掉下面的守卫式 require。在此之前模块不存在时静默 no-op：
 * Expo 的 Metro 配置开启了 allowOptionalDependencies，try/catch 内的 require 缺失不会打断打包。
 */

interface PracticeSessionModule {
  usePracticeSessionStore?: {
    getState?: () => { updateIndex?: (bankId: string, index: number) => void };
  };
}

function loadPracticeSessionModule(): PracticeSessionModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('../../store/practiceSessionStore') as PracticeSessionModule;
  } catch {
    return null;
  }
}

export function syncPracticeIndex(bankId: string, index: number): void {
  try {
    loadPracticeSessionModule()?.usePracticeSessionStore?.getState?.().updateIndex?.(bankId, index);
  } catch {
    // 会话进度只是「继续练习」的便利数据，写失败不影响刷题
  }
}
