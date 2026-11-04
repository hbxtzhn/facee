import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useQuestionBankStore } from '../../question-bank/store';
import { ProgressBar } from '../../components/ui';
import { colors, spacing, typography } from '../../theme';
import { ModalSheet, SheetActions } from './ModalSheet';
import { InlineNote, TextAction, listStyles } from './components/list';
import { OFFICIAL_BANK_URL } from './official-bank';
import { useBankUpdateRecords, useUpdateBank } from './bank-updates';
import { useBankUrlInstall, type BankUrlInstall } from './useBankUrlInstall';

/** 题库 ZIP 地址输入框（发丝线风格） */
export function BankUrlInput({
  value,
  onChangeText,
  editable,
  onSubmit,
}: {
  value: string;
  onChangeText: (value: string) => void;
  editable: boolean;
  onSubmit?: () => void;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder="https://github.com/.../releases/latest/download/question-bank.zip"
      placeholderTextColor={colors.textSubtle}
      autoCapitalize="none"
      autoCorrect={false}
      keyboardType="url"
      returnKeyType="go"
      onSubmitEditing={onSubmit}
      editable={editable}
      accessibilityLabel="题库 ZIP 地址"
      style={listStyles.input}
    />
  );
}

/**
 * 按网址安装的反馈区：下载进度、失败原因、已修改旧库的二次选择、完成提示。
 * 「线上题库」页与 Web 端地址弹窗共用，保证文案与行为一致。
 */
export function BankInstallFeedback({ flow }: { flow: BankUrlInstall }) {
  const installing = useQuestionBankStore((state) => state.installing);
  const installProgress = useQuestionBankStore((state) => state.installProgress);
  const { phase, busy } = flow;
  const failure = flow.error;
  // 进度来自全局 store：只在本流程正在处理时显示，同页多个入口互不串台
  const mine = phase.kind === 'checking';

  return (
    <View>
      {mine && !installProgress ? (
        <InlineNote text="正在核对地址…" live />
      ) : null}
      {mine && installing && installProgress ? (
        <View style={styles.progress}>
          <View style={styles.progressRow}>
            <Text style={styles.progressLabel}>{installProgress.label}</Text>
            <Text style={styles.progressCount}>
              {installProgress.completed}/{installProgress.total}
            </Text>
          </View>
          <ProgressBar
            value={installProgress.total ? installProgress.completed / installProgress.total : 0}
            accessibilityLabel="题库下载进度"
          />
        </View>
      ) : null}
      {failure && phase.kind !== 'done' ? (
        <View style={styles.error} accessibilityRole="alert">
          <Text style={styles.errorTitle}>下载失败</Text>
          <Text style={styles.errorText}>{failure}</Text>
        </View>
      ) : null}

      {phase.kind === 'askReinstall' ? (
        <View style={styles.choice} accessibilityRole="alert">
          <Text style={styles.choiceTitle}>这个地址对应已装的「{phase.match.title}」</Text>
          <InlineNote text="它在本机改过（已修改）。可以更新原题库，或者另装一份线上原版。" />
          <View style={styles.choiceActions}>
            <TextAction
              label="更新原题库（会先询问如何处理本地修改）"
              tone="primary"
              disabled={busy}
              onPress={() => void flow.updateOriginal()}
              style={styles.choiceAction}
            />
            <TextAction label="另装一份" disabled={busy} onPress={() => void flow.installSeparately()} style={styles.choiceAction} />
            <TextAction label="取消" tone="muted" disabled={busy} onPress={flow.reset} style={styles.choiceAction} />
          </View>
        </View>
      ) : null}

      {phase.kind === 'askLocalEdits' ? (
        <View style={styles.choice} accessibilityRole="alert">
          <Text style={styles.choiceTitle}>「{phase.match.title}」有新版本</Text>
          <InlineNote text="本地修改会被线上内容覆盖，先决定怎么处理。" />
          <View style={styles.choiceActions}>
            <TextAction
              label="另存副本后更新"
              accessibilityLabel={`另存副本后更新题库 ${phase.match.title}`}
              tone="primary"
              disabled={busy}
              onPress={() => void flow.resolveLocalEdits('keepCopy')}
              style={styles.choiceAction}
            />
            <TextAction
              label="直接覆盖"
              accessibilityLabel={`直接覆盖更新题库 ${phase.match.title}`}
              tone="danger"
              disabled={busy}
              onPress={() => void flow.resolveLocalEdits('overwrite')}
              style={styles.choiceAction}
            />
            <TextAction label="取消" accessibilityLabel="取消更新" tone="muted" disabled={busy} onPress={flow.reset} style={styles.choiceAction} />
          </View>
        </View>
      ) : null}

      {phase.kind === 'done' ? <InlineNote text={phase.message} tone="default" live /> : null}
    </View>
  );
}

/**
 * Web 端「增加题库 / 更换题库」弹窗：填入 ZIP 地址后下载并启用（原生端改用「线上题库」页）。
 * 地址框为空时给出「安装官方题库」一键入口。
 */
export function BankUrlDialog({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const catalog = useQuestionBankStore((state) => state.catalog);
  const banks = useQuestionBankStore((state) => state.banks);
  const clearInstallError = useQuestionBankStore((state) => state.clearInstallError);
  const { remember } = useBankUpdateRecords(banks, visible);
  const updateBank = useUpdateBank(remember);
  const flow = useBankUrlInstall({ updateBank, onInstalled: onClose });
  const [draftUrl, setDraftUrl] = useState('');
  const { reset } = flow;

  // 每次打开：草稿回填已保存地址，清掉上一次的失败提示与选择
  useEffect(() => {
    if (!visible) return;
    setDraftUrl(useQuestionBankStore.getState().sourceUrl);
    clearInstallError();
    reset();
  }, [visible, clearInstallError, reset]);

  const close = () => {
    if (!flow.busy) onClose();
  };

  const installOfficial = () => {
    setDraftUrl(OFFICIAL_BANK_URL);
    void flow.submit(OFFICIAL_BANK_URL);
  };

  const done = flow.phase.kind === 'done';
  const choosing = flow.phase.kind === 'askReinstall' || flow.phase.kind === 'askLocalEdits';

  return (
    <ModalSheet
      visible={visible}
      title={catalog ? '更换题库' : '增加题库'}
      hint="粘贴题库 ZIP 下载地址（如 GitHub Release 链接），下载校验完成后自动启用，之后可完全离线使用。"
      onClose={close}
      dismissDisabled={flow.busy}
      footer={
        done ? (
          <SheetActions cancelLabel="" confirmLabel="完成" onCancel={onClose} onConfirm={onClose} />
        ) : (
          <SheetActions
            confirmLabel={flow.busy ? '正在下载' : '确认下载'}
            confirmLoading={flow.busy}
            confirmDisabled={!draftUrl.trim() || choosing}
            cancelDisabled={flow.busy}
            onCancel={close}
            onConfirm={() => void flow.submit(draftUrl)}
          />
        )
      }
    >
      <BankUrlInput
        value={draftUrl}
        onChangeText={(value) => { setDraftUrl(value); if (choosing) reset(); }}
        editable={!flow.busy}
        onSubmit={() => void flow.submit(draftUrl)}
      />
      {!draftUrl.trim() ? (
        <View style={styles.official}>
          <InlineNote text="没有地址？可以先装 FaceE 官方题库。" />
          <TextAction
            label="安装官方题库"
            tone="primary"
            disabled={flow.busy}
            onPress={installOfficial}
            style={styles.officialAction}
          />
        </View>
      ) : null}
      <BankInstallFeedback flow={flow} />
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  progress: { marginTop: spacing.lg },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs },
  progressLabel: { ...typography.caption, color: colors.text },
  progressCount: { ...typography.caption, color: colors.textMuted },
  error: {
    marginTop: spacing.lg,
    paddingLeft: spacing.md,
    borderLeftWidth: 2,
    borderLeftColor: colors.danger,
  },
  errorTitle: { ...typography.label, color: colors.danger },
  errorText: { ...typography.caption, color: colors.danger, marginTop: 2, lineHeight: 18 },
  choice: {
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: spacing.xs,
  },
  choiceTitle: { ...typography.bodyStrong, color: colors.text },
  choiceActions: { marginTop: spacing.xs },
  choiceAction: { alignItems: 'flex-start', paddingHorizontal: 0 },
  official: { marginTop: spacing.md, gap: spacing.xs },
  officialAction: { alignItems: 'flex-start', paddingHorizontal: 0 },
});
