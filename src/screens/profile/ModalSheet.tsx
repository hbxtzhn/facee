import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { usePreventRemove } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppButton } from '../../components/ui';
import { colors, layout, radii, spacing, typography } from '../../theme';

/** 弹窗骨架的呈现方式：modal = 居中卡片弹窗；screen = 作为栈页面正文（标题交给导航栏） */
export type SheetPresentation = 'modal' | 'screen';

/**
 * Profile 弹窗统一骨架（极简阅读风）：纸面底 + 发丝描边的居中弹窗，无阴影，
 * 但内容区可滚动、高度自适应到 86%，承载编辑器/导入等更大的表单。
 * presentation="screen" 时同一份内容直接铺满栈页面，忙碌（dismissDisabled）时拦截返回键/手势。
 */
export function ModalSheet({
  visible,
  title,
  hint,
  onClose,
  dismissDisabled = false,
  presentation = 'modal',
  children,
  footer,
}: {
  visible: boolean;
  title: string;
  hint?: string;
  onClose: () => void;
  dismissDisabled?: boolean;
  presentation?: SheetPresentation;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  if (presentation === 'screen') {
    return (
      <ScreenSheet title={title} hint={hint} dismissDisabled={dismissDisabled} footer={footer}>
        {children}
      </ScreenSheet>
    );
  }
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

/** 栈页面形态：无蒙层与卡片，正文可滚动，底部操作栏固定；忙碌时阻止页面被移除 */
function ScreenSheet({
  title,
  hint,
  dismissDisabled,
  children,
  footer,
}: {
  title: string;
  hint?: string;
  dismissDisabled: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  // 处理题库期间离开会打断写入：返回键 / 返回手势一律吞掉，等操作结束
  usePreventRemove(dismissDisabled, () => undefined);
  return (
    // 栈页面不自带底部安全区：整页让开手势条，固定操作栏不被遮挡
    <SafeAreaView testID={`profile-screen-${title}`} style={styles.screen} edges={['bottom']}>
      <ScrollView style={styles.screenBody} contentContainerStyle={styles.screenBodyContent} keyboardShouldPersistTaps="handled">
        {hint ? <Text style={[styles.hint, styles.screenHint]}>{hint}</Text> : null}
        {children}
      </ScrollView>
      {footer ? <View style={styles.screenFooter}>{footer}</View> : null}
    </SafeAreaView>
  );
}

/** 弹窗内的标准表单标签 */
export function FieldLabel({ text }: { text: string }) {
  return <Text style={styles.fieldLabel}>{text}</Text>;
}

/** 弹窗底部标准操作：取消为文字按钮，主操作为唯一实心按钮；cancelLabel 传空串时只显示主操作 */
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
        <AppButton label={cancelLabel} variant="ghost" onPress={onCancel} disabled={cancelDisabled} style={styles.cancelButton} />
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

/** 错误提示：危险色文字 + 左侧细竖线，不铺色块；message 为空时不渲染 */
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
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: layout.pagePadding,
  },
  scrimTouchable: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  card: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '86%',
    backgroundColor: colors.background,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    paddingHorizontal: layout.pagePadding,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
  },
  title: { ...typography.heading, color: colors.text },
  hint: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs, lineHeight: 18 },
  body: { marginTop: spacing.md },
  bodyContent: { paddingBottom: spacing.xs },
  footer: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  screen: { flex: 1, backgroundColor: colors.background },
  screenBody: { flex: 1 },
  screenBodyContent: { paddingHorizontal: layout.pagePadding, paddingTop: spacing.md, paddingBottom: spacing.xxl },
  screenHint: { marginTop: 0, marginBottom: spacing.sm },
  screenFooter: {
    paddingHorizontal: layout.pagePadding,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  actionsRow: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: spacing.sm },
  cancelButton: { minWidth: 64 },
  actionButton: { minWidth: 104 },
  fieldLabel: { ...typography.eyebrow, color: colors.textMuted, marginTop: spacing.lg, marginBottom: spacing.xs },
  errorBox: {
    marginTop: spacing.md,
    paddingLeft: spacing.md,
    paddingVertical: spacing.xs,
    borderLeftWidth: 2,
    borderLeftColor: colors.danger,
  },
  errorText: { ...typography.caption, color: colors.danger, lineHeight: 18 },
});
