import { useBankStore } from '../../bank';

/**
 * 练习会话进度同步：队列模式翻页时把当前下标写进题库 v2 的练习会话（当前题库），
 * 供首页「继续上次练习」回到最后看到的那一题。
 */
export function syncPracticeIndex(index: number): void {
  const store = useBankStore.getState();
  if (store.status !== 'ready' || !store.activeBankId) return;
  // 会话进度只是「继续练习」的便利数据：store action 永不 reject，失败只记 lastError，不影响刷题
  void store.updateSessionIndex(index);
}
