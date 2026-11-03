import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Download } from 'lucide-react-native';
import { useQuestionBankStore } from '../../question-bank/store';
import { AppButton, ProgressBar } from '../../components/ui';
import { colors, radii, spacing, typography } from '../../theme';

/**
 * 增加题库 / 更换题库弹窗：填入 ZIP 地址后下载并启用。
 * 「我的」页（Web 入口）与题库管理页（添加线上题库）共用同一份行为。
 */
export function BankUrlDialog({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const catalog = useQuestionBankStore((state) => state.catalog);
  const installing = useQuestionBankStore((state) => state.installing);
  const installProgress = useQuestionBankStore((state) => state.installProgress);
  const installError = useQuestionBankStore((state) => state.installError);
  const setSourceUrl = useQuestionBankStore((state) => state.setSourceUrl);
  const clearInstallError = useQuestionBankStore((state) => state.clearInstallError);
  const reinstallQuestionBank = useQuestionBankStore((state) => state.installConfigured);
  const [draftUrl, setDraftUrl] = useState('');

  // 每次打开：草稿回填已保存地址，清掉上一次的失败提示
  useEffect(() => {
    if (!visible) return;
    setDraftUrl(useQuestionBankStore.getState().sourceUrl);
    clearInstallError();
  }, [visible, clearInstallError]);

  const closeUrlDialog = () => {
    if (!installing) onClose();
  };

  const confirmInstall = async () => {
    const url = draftUrl.trim();
    if (!url || installing) return;
    setSourceUrl(url);
    const ok = await reinstallQuestionBank();
    if (ok) onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={closeUrlDialog}
    >
      <View style={styles.modalScrim}>
        <Pressable
          style={styles.modalScrimTouchable}
          onPress={closeUrlDialog}
          accessibilityLabel="关闭弹窗"
        />
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{catalog ? '更换题库' : '增加题库'}</Text>
          <Text style={styles.modalHint}>
            粘贴题库 ZIP 下载地址（如 GitHub Release 链接），下载校验完成后自动启用，之后可完全离线使用。
          </Text>
          <TextInput
            value={draftUrl}
            onChangeText={setDraftUrl}
            placeholder="https://github.com/.../releases/download/.../bank.zip"
            placeholderTextColor={colors.textSubtle}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            editable={!installing}
            accessibilityLabel="题库 ZIP 地址"
            style={styles.modalInput}
          />
          {installing && installProgress ? (
            <View style={styles.installProgress}>
              <View style={styles.syncRow}>
                <Text style={styles.syncLabel}>{installProgress.label}</Text>
                <Text style={styles.syncCount}>
                  {installProgress.completed}/{installProgress.total}
                </Text>
              </View>
              <ProgressBar
                value={installProgress.total ? installProgress.completed / installProgress.total : 0}
                accessibilityLabel="题库下载进度"
              />
            </View>
          ) : null}
          {installError ? (
            <View style={styles.errorBox} accessibilityRole="alert">
              <Text style={styles.errorTitle}>下载失败</Text>
              <Text style={styles.errorText}>{installError}</Text>
            </View>
          ) : null}
          <View style={styles.modalActions}>
            <AppButton
              label="取消"
              variant="ghost"
              onPress={closeUrlDialog}
              disabled={installing}
              style={styles.modalButton}
            />
            <AppButton
              label={installing ? '正在下载' : '确认下载'}
              icon={Download}
              onPress={() => void confirmInstall()}
              loading={installing}
              disabled={!draftUrl.trim()}
              accessibilityHint={catalog ? '下载并替换当前题库' : '下载并安装题库'}
              style={styles.modalButton}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  installProgress: { marginTop: spacing.md },
  syncRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs },
  syncLabel: { ...typography.caption, color: colors.text },
  syncCount: { ...typography.caption, color: colors.textMuted },
  errorBox: {
    marginTop: spacing.md,
    padding: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.borderWarm,
  },
  errorTitle: { ...typography.label, color: colors.danger, fontSize: 12 },
  errorText: { ...typography.caption, color: colors.danger, marginTop: 2, fontSize: 11 },
  modalScrim: {
    flex: 1,
    backgroundColor: 'rgba(20, 20, 16, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalScrimTouchable: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalTitle: { ...typography.title, color: colors.text, fontSize: 18 },
  modalHint: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs, lineHeight: 16 },
  modalInput: {
    ...typography.body,
    color: colors.text,
    minHeight: 44,
    marginTop: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  modalButton: { minWidth: 108 },
});
