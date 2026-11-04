import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { useQuestionBankStore } from '../../question-bank/store';
import { colors, spacing } from '../../theme';
import { ModalSheet, SheetError } from './ModalSheet';
import { InlineNote, ListRow, TextAction } from './components/list';

/**
 * 备份与恢复弹窗（v1：只备题库本体）。导出 = 本地源 + 图片资产打 ZIP 走系统
 * 分享；导入 = 选 ZIP 增量开新库（id 冲突自动换新 id 加「导入」后缀）。
 * 收藏/掌握度/统计的备份随合并策略后续版本支持；LLM Key 永不进备份。
 */
export function BackupModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const exportBackup = useQuestionBankStore((state) => state.exportBackup);
  const importBackup = useQuestionBankStore((state) => state.importBackup);
  const installing = useQuestionBankStore((state) => state.installing);
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleExport() {
    if (busy) return;
    setBusy('export');
    setError(null);
    setNotice(null);
    try {
      const { zipPath, bankCount } = await exportBackup();
      if (!(await Sharing.isAvailableAsync())) {
        setNotice(`备份已生成（${bankCount} 个题库）：${zipPath}`);
        return;
      }
      await Sharing.shareAsync(zipPath, {
        mimeType: 'application/zip',
        dialogTitle: 'FaceE 题库备份',
      });
      setNotice(`已生成 ${bankCount} 个题库的备份，选择保存位置或发送给自己。`);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : String(exportError));
    } finally {
      setBusy(null);
    }
  }

  async function handleImport() {
    if (busy) return;
    setBusy('import');
    setError(null);
    setNotice(null);
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });
      if (picked.canceled) return;
      const fileUri = picked.assets[0]?.uri;
      if (!fileUri) return;
      const { imported } = await importBackup(fileUri);
      const parts = imported.map((bank) => `${bank.title}（${bank.questionCount} 题）`);
      setNotice(`导入完成：${parts.join('、')}${imported.some((bank) => bank.reusedExisting) ? '；与现有题库同名的已作为新库加入' : ''}`);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : String(importError));
    } finally {
      setBusy(null);
    }
  }

  return (
    <ModalSheet
      visible={visible}
      title="备份与恢复"
      hint="备份包含全部本地题库与题目图片，通过系统分享保存到网盘或发送给自己；导入会把备份里的题库作为新库加入，不影响现有题库。收藏与刷题进度的备份将在后续版本支持。"
      onClose={onClose}
      dismissDisabled={Boolean(busy || installing)}
    >
      <SheetError message={error} />
      {notice ? (
        <View style={styles.notice}>
          <InlineNote text={notice} tone="default" live />
        </View>
      ) : null}
      <View style={styles.list}>
        <ListRow
          title="导出备份"
          subtitle="把全部本地题库打包成 ZIP，分享到任意位置保存。"
          right={
            <TextAction
              label={busy === 'export' ? '正在打包' : '导出'}
              accessibilityLabel="导出备份"
              tone="primary"
              onPress={() => void handleExport()}
              disabled={busy !== null || installing}
            />
          }
        />
        <ListRow
          title="从备份导入"
          subtitle="选择之前导出的备份 ZIP，题库会作为新库加入。"
          right={
            <TextAction
              label={busy === 'import' ? '正在导入' : '选择文件'}
              accessibilityLabel="选择备份文件"
              tone="primary"
              onPress={() => void handleImport()}
              disabled={busy !== null || installing}
            />
          }
        />
      </View>
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  notice: { marginTop: spacing.md },
  list: {
    marginTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
