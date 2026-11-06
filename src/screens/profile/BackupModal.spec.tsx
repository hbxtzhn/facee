import * as nodeFs from 'node:fs';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

/**
 * 备份与恢复（真实 useBankStore + Node SQLite 运行时）：
 * 导出 JSON 交给系统分享 → 换一台「新设备」从备份恢复 → 显示合并摘要与本机缺少的线上题库 →
 * 重新添加后学习数据回到题目上。
 */

const mockPick = jest.fn();
jest.mock('expo-document-picker', () => ({ getDocumentAsync: (...args: unknown[]) => mockPick(...args) }));
const mockShare = jest.fn();
jest.mock('expo-sharing', () => ({
  isAvailableAsync: async () => true,
  shareAsync: (...args: unknown[]) => mockShare(...args),
}));
jest.mock('@react-navigation/native', () => ({ usePreventRemove: () => undefined }));
jest.mock('expo-file-system/legacy', () => jest.requireActual('./bank-test-utils').mockLegacyFs());

// eslint-disable-next-line import/first
import { BackupModal, describeBackupImport } from './BackupModal';
// eslint-disable-next-line import/first
import { useBankStore } from '../../bank';
// eslint-disable-next-line import/first
import type { TestRuntime } from '../../bank/__fixtures__/node-runtime';
// eslint-disable-next-line import/first
import { QID, SAMPLE_ASSETS, SAMPLE_BANK_ID, installSampleRemote, publish, sampleBundle, setupBankStore, teardownBankStore } from './bank-test-utils';

let t: TestRuntime | null = null;
beforeEach(() => jest.clearAllMocks());
afterEach(async () => {
  if (t) await teardownBankStore(t);
  t = null;
});

const store = () => useBankStore.getState();

describe('BackupModal 备份与恢复', () => {
  it('导出 → 新设备恢复：显示合并摘要，缺少的线上题库可重新添加，学习数据随之恢复', async () => {
    // 设备 A：线上题库 + 本地题库 + 学习数据
    t = await setupBankStore();
    await installSampleRemote(t);
    await store().setMastery(QID.redisExpire, 'known');
    await store().toggleFavorite(QID.mysqlTx);
    await store().createLocalBank({ name: '我的本地库' });

    let view = await render(<BackupModal visible onClose={() => undefined} />);
    await act(async () => { fireEvent.press(view.getByLabelText('导出备份')); });
    expect(mockShare).toHaveBeenCalledWith(expect.stringMatching(/\.json$/), expect.objectContaining({ mimeType: 'application/json' }));
    expect(view.getByText('备份已生成，选择保存位置或发送给自己。')).toBeTruthy();
    const backupText = nodeFs.readFileSync(mockShare.mock.calls[0][0] as string, 'utf8');
    view.unmount();
    await teardownBankStore(t);

    // 设备 B：全新安装
    t = await setupBankStore();
    const backupUri = t.writeLocalFile('backup.json', backupText);
    mockPick.mockResolvedValueOnce({ canceled: false, assets: [{ uri: backupUri, name: 'backup.json' }] });
    view = await render(<BackupModal visible onClose={() => undefined} />);
    await act(async () => { fireEvent.press(view.getByLabelText('选择备份文件')); });
    await waitFor(() => expect(view.getByText(/恢复完成。/)).toBeTruthy());
    expect(view.getByText(/掌握度 1 条/)).toBeTruthy();
    expect(view.getByText(/收藏 1 条/)).toBeTruthy();
    expect(view.getByText(/导入 \/ 更新本地题库 1 个/)).toBeTruthy();
    expect(view.getByText('本机缺少的线上题库')).toBeTruthy();
    expect(store().banks.map((bank) => bank.name)).toEqual(['我的本地库']);

    publish(t, sampleBundle(), { assets: SAMPLE_ASSETS });
    await act(async () => { fireEvent.press(view.getByLabelText('重新添加题库 测试题库')); });
    await waitFor(() => expect(view.getByText('已添加「测试题库」（5 题，线上题库）。')).toBeTruthy());
    expect(view.queryByText('本机缺少的线上题库')).toBeNull();
    const detail = await store().getQuestion(QID.redisExpire, SAMPLE_BANK_ID);
    expect(detail.ok && detail.value.learning.mastery).toBe('known');
  });

  it('选择不是备份的文件时显示错误；取消选择不做任何事', async () => {
    t = await setupBankStore();
    const view = await render(<BackupModal visible onClose={() => undefined} />);
    mockPick.mockResolvedValueOnce({ canceled: true, assets: null });
    await act(async () => { fireEvent.press(view.getByLabelText('选择备份文件')); });
    expect(view.queryByText(/恢复完成/)).toBeNull();

    mockPick.mockResolvedValueOnce({ canceled: false, assets: [{ uri: t.writeLocalFile('x.json', '{"hello":1}') }] });
    await act(async () => { fireEvent.press(view.getByLabelText('选择备份文件')); });
    expect(view.getByText('不是 FaceE 题库备份文件')).toBeTruthy();
    expect(view.queryByText(/恢复完成/)).toBeNull();
  });

  it('describeBackupImport 汇总跳过的本地题库与缺少的线上题库', () => {
    const text = describeBackupImport({
      importedLocalBanks: [],
      skippedLocalBanks: ['local/device/x'],
      missingRemoteBanks: [{ id: 'a/b/c', name: 'n', manifestUrl: 'https://x' }],
      merged: { progress: 0, keypointChecks: 2, followupProgress: 0, favorites: 0, sessions: 1, sections: 0, sectionCategories: 0 },
    });
    expect(text).toContain('要点自评 2 条');
    expect(text).toContain('1 个本地题库本机已有更新版本，已跳过');
    expect(text).toContain('1 个线上题库本机未安装');
  });

  it('Web（unsupported）显示不支持说明', async () => {
    await act(async () => { useBankStore.setState({ status: 'unsupported' }); });
    const view = await render(<BackupModal visible onClose={() => undefined} />);
    expect(view.getByText('Web 预览不支持本地题库，请在 Android App 中使用。')).toBeTruthy();
    await act(async () => { useBankStore.setState({ status: 'idle' }); });
  });
});
