import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useBankStore, type BackupImportResult } from '../../bank';
import { colors, spacing, typography } from '../../theme';
import { ModalSheet, SheetError } from './ModalSheet';
import { InlineNote, ListRow, TextAction } from './components/list';
import { BankBusyNote } from './components/bank-status';
import { UNSUPPORTED_TEXT, bankErrorText, describeInstall, shareFile } from './bank-helpers';

/** 恢复结果摘要（纯文本，供展示与测试） */
export function describeBackupImport(result: BackupImportResult): string {
  const merged = result.merged;
  const lines = [
    `学习数据：掌握度 ${merged.progress} 条、要点自评 ${merged.keypointChecks} 条、追问 ${merged.followupProgress} 条、收藏 ${merged.favorites} 条、练习会话 ${merged.sessions} 个、分区 ${merged.sections} 个已合并。`,
  ];
  if (result.importedLocalBanks.length > 0) lines.push(`导入 / 更新本地题库 ${result.importedLocalBanks.length} 个。`);
  if (result.skippedLocalBanks.length > 0) lines.push(`${result.skippedLocalBanks.length} 个本地题库本机已有更新版本，已跳过。`);
  if (result.missingRemoteBanks.length > 0) {
    lines.push(`备份中有 ${result.missingRemoteBanks.length} 个线上题库本机未安装，重新添加后对应学习数据即可显示。`);
  }
  return lines.join('\n');
}

/**
 * 备份与恢复：导出 = 学习数据（掌握度 / 自评 / 追问 / 收藏 / 会话 / 分区）+ 本地题库 bundle 的 JSON，
 * 走系统分享；恢复 = 选择 JSON 合并（较新者胜出，收藏与自评取并集）。AI Key 永不进备份。
 */
export function BackupModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const status = useBankStore((state) => state.status);
  const storeBusy = useBankStore((state) => state.busy);
  const [busy, setBusy] = useState<'export' | 'import' | string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [missing, setMissing] = useState<BackupImportResult['missingRemoteBanks']>([]);
  const locked = busy !== null || storeBusy !== null;

  async function handleExport() {
    if (locked) return;
    setBusy('export');
    setError(null);
    setNotice(null);
    try {
      const result = await useBankStore.getState().exportBackup();
      if (!result.ok) {
        setError(bankErrorText(result.error));
        return;
      }
      const shared = await shareFile(result.value, 'FaceE 学习数据备份');
      setNotice(shared ? '备份已生成，选择保存位置或发送给自己。' : `备份已生成：${result.value}`);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : String(exportError));
    } finally {
      setBusy(null);
    }
  }

  async function handleImport() {
    if (locked) return;
    setBusy('import');
    setError(null);
    setNotice(null);
    setMissing([]);
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: ['application/json', '*/*'], copyToCacheDirectory: true, multiple: false });
      if (picked.canceled || !picked.assets?.[0]?.uri) return;
      const result = await useBankStore.getState().importBackup(picked.assets[0].uri);
      if (!result.ok) {
        setError(bankErrorText(result.error));
        return;
      }
      setNotice(`恢复完成。\n${describeBackupImport(result.value)}`);
      setMissing(result.value.missingRemoteBanks);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : String(importError));
    } finally {
      setBusy(null);
    }
  }

  async function handleReAdd(bank: BackupImportResult['missingRemoteBanks'][number]) {
    if (locked) return;
    setBusy(bank.id);
    setError(null);
    try {
      const result = await useBankStore.getState().addOnlineBank(bank.manifestUrl);
      if (result.ok) {
        setMissing((current) => current.filter((item) => item.id !== bank.id));
        setNotice(describeInstall(result.value));
      } else {
        setError(bankErrorText(result.error));
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <ModalSheet
      visible={visible}
      title="备份与恢复"
      hint="备份包含学习数据（掌握度、要点自评、追问、收藏、练习进度、自定义分区）与全部本地题库；线上题库只记录地址。恢复时按记录合并，较新的胜出，不会覆盖更新的本机数据。"
      onClose={onClose}
      dismissDisabled={locked}
    >
      {status === 'unsupported' ? <InlineNote text={UNSUPPORTED_TEXT} /> : (
        <>
          <SheetError message={error} />
          <BankBusyNote />
          {notice ? (
            <View style={styles.notice}>
              <InlineNote text={notice} tone="default" live />
            </View>
          ) : null}
          {missing.length > 0 ? (
            <View style={styles.missing}>
              <Text style={styles.missingTitle}>本机缺少的线上题库</Text>
              {missing.map((bank) => (
                <ListRow
                  key={bank.id}
                  title={bank.name}
                  subtitle={bank.manifestUrl}
                  right={
                    <TextAction
                      label={busy === bank.id ? '添加中' : '重新添加'}
                      accessibilityLabel={`重新添加题库 ${bank.name}`}
                      tone="primary"
                      disabled={locked}
                      onPress={() => void handleReAdd(bank)}
                    />
                  }
                />
              ))}
            </View>
          ) : null}
          <View style={styles.list}>
            <ListRow
              title="导出备份"
              subtitle="生成 JSON 备份文件，分享到任意位置保存。"
              right={
                <TextAction
                  label={busy === 'export' ? '正在导出' : '导出'}
                  accessibilityLabel="导出备份"
                  tone="primary"
                  onPress={() => void handleExport()}
                  disabled={locked}
                />
              }
            />
            <ListRow
              title="从备份恢复"
              subtitle="选择之前导出的备份 JSON，与本机数据合并。"
              right={
                <TextAction
                  label={busy === 'import' ? '正在恢复' : '选择文件'}
                  accessibilityLabel="选择备份文件"
                  tone="primary"
                  onPress={() => void handleImport()}
                  disabled={locked}
                />
              }
            />
          </View>
        </>
      )}
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  notice: { marginTop: spacing.md },
  missing: { marginTop: spacing.md },
  missingTitle: { ...typography.eyebrow, color: colors.textMuted, marginBottom: spacing.xs },
  list: {
    marginTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
