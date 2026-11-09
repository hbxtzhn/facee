import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { BankManagerModal } from './profile/BankManagerModal';

type Nav = NativeStackNavigationProp<RootStackParamList, 'BankManager'>;

/**
 * 题库管理页（RootStack 栈页面）：正文复用 BankManagerModal 的 screen 形态。
 * 编辑 / 复制 / 新建本地题库后 push 到编辑页，返回即回到这里；线上题库是独立栈页面。
 */
export function BankManagerScreen() {
  const navigation = useNavigation<Nav>();
  const openEditor = (bankId: string) => navigation.push('BankEditor', { bankId });

  return (
    <BankManagerModal
      visible
      presentation="screen"
      onClose={() => navigation.goBack()}
      onEditBank={openEditor}
      onBankCopied={openEditor}
      onOpenOnlineBanks={() => navigation.navigate('OnlineBanks')}
    />
  );
}
