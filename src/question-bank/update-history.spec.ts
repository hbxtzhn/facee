import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadBankUpdateRecord, removeBankUpdateRecord, saveBankUpdateRecord } from './update-history';

beforeEach(async () => {
  await AsyncStorage.clear();
});

it('按题库持久化，重新读取成功/失败结果互不覆盖', async () => {
  const first = { checkedAt: '2026-10-19T08:00:00Z', status: 'unchanged' as const, message: '已是最新版本' };
  const second = { ...first, status: 'failed' as const, message: '题库下载失败（HTTP 500）' };
  await saveBankUpdateRecord('local-a', first);
  await saveBankUpdateRecord('local-b', second);
  expect(await loadBankUpdateRecord('local-a')).toEqual(first);
  expect(await loadBankUpdateRecord('local-b')).toEqual(second);
  await removeBankUpdateRecord('local-a');
  expect(await loadBankUpdateRecord('local-a')).toBeNull();
  expect(await loadBankUpdateRecord('local-b')).toEqual(second);
});

it.each(['{', 'null', '[]', '{"checkedAt":"invalid","status":"updated","message":"ok"}',
  '{"checkedAt":"2026-10-19T08:00:00Z","status":"other","message":"ok"}',
])('损坏或旧格式记录不阻止打开题库信息：%s', async (raw) => {
  await AsyncStorage.setItem('facee-bank-update-result-v1:local-a', raw);
  expect(await loadBankUpdateRecord('local-a')).toBeNull();
});

it('读取存储失败时不阻塞题库，写入失败向调用者反馈', async () => {
  jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('read failed'));
  expect(await loadBankUpdateRecord('local-a')).toBeNull();
  jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk full'));
  await expect(saveBankUpdateRecord('local-a', {
    checkedAt: '2026-10-19T08:00:00Z', status: 'updated', message: '更新完成',
  })).rejects.toThrow('disk full');
});
