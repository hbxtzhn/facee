import { usePracticeSessionStore } from '../../store/practiceSessionStore';

/**
 * 练习会话进度同步：队列模式翻页时把当前下标写进 practiceSessionStore，
 * 供首页「继续上次练习」回到最后看到的那一题。
 */
export function syncPracticeIndex(bankId: string, index: number): void {
  try {
    usePracticeSessionStore.getState().updateIndex(bankId, index);
  } catch {
    // 会话进度只是「继续练习」的便利数据，写失败不影响刷题
  }
}
