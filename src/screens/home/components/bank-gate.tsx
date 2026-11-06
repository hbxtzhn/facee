import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Globe, Library } from 'lucide-react-native';
import { useBankStore } from '../../../bank';
import { EmptyState } from '../../../components/ui';
import { spacing } from '../../../theme';
import { TextAction } from './reading';

/**
 * 题库 v2 的页面级状态门：未初始化时触发一次 initialize()（重复调用安全），
 * 并把「Web 不支持 / 初始化失败 / 还没有题库」统一成同一套空态（三屏共用）。
 */
export function useEnsureBankInitialized(): void {
  const status = useBankStore((state) => state.status);
  useEffect(() => {
    if (status === 'idle') void useBankStore.getState().initialize();
  }, [status]);
}

export type BankGateState = 'loading' | 'unsupported' | 'error' | 'no-bank' | 'ready';

export function useBankGateState(): BankGateState {
  const status = useBankStore((state) => state.status);
  const activeBankId = useBankStore((state) => state.activeBankId);
  if (status === 'idle' || status === 'initializing') return 'loading';
  if (status === 'unsupported') return 'unsupported';
  if (status === 'error') return 'error';
  return activeBankId ? 'ready' : 'no-bank';
}

/** 非 ready 状态的空态；loading 返回 null（由页面自己画骨架） */
export function BankGateEmpty({
  state,
  onOnlineBanks,
  onCreateLocal,
}: {
  state: Exclude<BankGateState, 'ready'>;
  onOnlineBanks: () => void;
  onCreateLocal: () => void;
}) {
  const lastError = useBankStore((state) => state.lastError);
  if (state === 'loading') return null;
  if (state === 'unsupported') {
    return (
      <EmptyState
        title="Web 预览不支持本地题库"
        description="题库保存在手机本地数据库中，请在 Android App 中使用。"
        icon={Globe}
      />
    );
  }
  if (state === 'error') {
    return (
      <EmptyState
        title="无法打开本地题库"
        description={lastError?.message ?? '读取本地数据库失败，请稍后重试。'}
        actionLabel="重新读取"
        onAction={() => void useBankStore.getState().initialize()}
      />
    );
  }
  return (
    <View>
      <EmptyState
        title="还没有题库"
        description="添加一个线上题库，或新建本地题库后即可开始练习。"
        actionLabel="浏览线上题库"
        onAction={onOnlineBanks}
        icon={Library}
      />
      <View style={styles.secondary}>
        <TextAction label="新建本地题库" muted onPress={onCreateLocal} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  secondary: { alignItems: 'center', marginTop: spacing.sm },
});
