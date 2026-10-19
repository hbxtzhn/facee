import AsyncStorage from '@react-native-async-storage/async-storage';

/** 检查时间独立于题库作者的 updatedAt；诊断记录不参与安装和版本判断。 */
export interface BankUpdateRecord {
  checkedAt: string;
  status: 'updated' | 'unchanged' | 'failed';
  message: string;
}

const PREFIX = 'facee-bank-update-result-v1:';

export async function loadBankUpdateRecord(bankId: string): Promise<BankUpdateRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(`${PREFIX}${bankId}`);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const record = value as Partial<BankUpdateRecord>;
    if (typeof record.checkedAt !== 'string' || !Number.isFinite(Date.parse(record.checkedAt))
      || !['updated', 'unchanged', 'failed'].includes(record.status ?? '')
      || typeof record.message !== 'string') return null;
    return record as BankUpdateRecord;
  } catch {
    return null;
  }
}

export async function saveBankUpdateRecord(bankId: string, record: BankUpdateRecord): Promise<void> {
  await AsyncStorage.setItem(`${PREFIX}${bankId}`, JSON.stringify(record));
}

export async function removeBankUpdateRecord(bankId: string): Promise<void> {
  await AsyncStorage.removeItem(`${PREFIX}${bankId}`);
}
