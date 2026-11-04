import { useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useQuestionBankStore } from '../question-bank/store';
import { BankManagerModal } from './profile/BankManagerModal';

type Nav = NativeStackNavigationProp<RootStackParamList, 'BankManager'>;

/**
 * 题库管理页（RootStack 栈页面）：正文复用 BankManagerModal 的 screen 形态。
 * 编辑 / 复制 / 新建本地题库后 push 到编辑页，返回即回到这里；线上题库（官方 / 按网址添加）是独立栈页面。
 */
export function BankManagerScreen() {
  const navigation = useNavigation<Nav>();
  const createLocalBank = useQuestionBankStore((state) => state.createLocalBank);
  const [creatingBank, setCreatingBank] = useState(false);

  const openEditor = (bankId: string) => navigation.push('BankEditor', { bankId });

  const handleCreateLocal = async () => {
    if (creatingBank) return;
    setCreatingBank(true);
    try {
      const bankId = await createLocalBank('我的题库');
      openEditor(bankId);
    } catch {
      // 错误已写入 store.installError
    } finally {
      setCreatingBank(false);
    }
  };

  return (
    <BankManagerModal
      visible
      presentation="screen"
      onClose={() => navigation.goBack()}
      onEditBank={openEditor}
      onBankCopied={openEditor}
      onCreateLocal={() => void handleCreateLocal()}
      onOpenOnlineBanks={() => navigation.navigate('OnlineBanks')}
    />
  );
}
