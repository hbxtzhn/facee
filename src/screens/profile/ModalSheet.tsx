import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppButton } from '../../components/ui';
import { colors, radii, spacing, typography } from '../../theme';

/**
 * Profile 弹窗统一骨架：与「增加题库」弹窗同风格（居中卡片 + 蒙层），
 * 但内容区可滚动、高度自适应到 86%，承载编辑器/导入等更大的表单。
 */
export function ModalSheet({
  visible,
  title,
  hint,
  onClose,
  dismissDisabled = false,
  children,
  footer,
}: {
  visible: boolean;
  title: string;
  hint?: string;
  onClose: () => void;
  dismissDisabled?: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <Modal testID={`profile-sheet-${title}`} visible={visible} transparent animationType="fade" onRequestClose={dismissDisabled ? () => undefined : onClose}>
      <View style={styles.scrim}>
        <Pressable style={styles.scrimTouchable} onPress={onClose} disabled={dismissDisabled} accessibilityLabel="关闭弹窗" />
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          {hint ? <Text style={styles.hint}>{hint}</Text> : null}
          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

/** 弹窗内的标准表单标签 */
export function FieldLabel({ text }: { text: string }) {
  return <Text style={styles.fieldLabel}>{text}</Text>;
}

/** 弹窗底部标准双按钮（取消 + 主操作）；cancelLabel 传空串时只显示主操作 */
export function SheetActions({
  cancelLabel = '取消',
  confirmLabel,
  onCancel,
  onConfirm,
  cancelDisabled = false,
  confirmDisabled = false,
  confirmLoading = false,
}: {
  cancelLabel?: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  cancelDisabled?: boolean;
  confirmDisabled?: boolean;
  confirmLoading?: boolean;
}) {
  return (
    <View style={styles.actionsRow}>
      {cancelLabel ? (
        <AppButton label={cancelLabel} variant="ghost" onPress={onCancel} disabled={cancelDisabled} style={styles.actionButton} />
      ) : null}
      <AppButton
        label={confirmLabel}
        onPress={onConfirm}
        loading={confirmLoading}
        disabled={confirmDisabled}
        style={styles.actionButton}
      />
    </View>
  );
}

/** 错误提示块（dangerSoft 底），message 为空时不渲染 */
export function SheetError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View style={styles.errorBox} accessibilityRole="alert">
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(20, 20, 16, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  scrimTouchable: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  card: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '86%',
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  title: { ...typography.title, color: colors.text, fontSize: 18 },
  hint: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs, lineHeight: 16 },
  body: { marginTop: spacing.md },
  bodyContent: { paddingBottom: spacing.xs },
  footer: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionsRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  actionButton: { minWidth: 104 },
  fieldLabel: { ...typography.caption, color: colors.textMuted, fontWeight: '600', marginTop: spacing.md, marginBottom: spacing.xs },
  errorBox: {
    marginTop: spacing.md,
    padding: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.borderWarm,
  },
  errorText: { ...typography.caption, color: colors.danger, fontSize: 11 },
});
