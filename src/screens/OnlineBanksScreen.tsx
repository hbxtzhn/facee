import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePreventRemove } from '@react-navigation/native';
import { useQuestionBankStore } from '../question-bank/store';
import { AppButton } from '../components/ui';
import { colors, layout, spacing, typography } from '../theme';
import { OFFICIAL_BANK_URL } from './profile/official-bank';
import { isOnlineBank } from './profile/bank-contract';
import { describeLastCheck, useBankUpdateRecords, useUpdateBank } from './profile/bank-updates';
import { useBankUrlInstall } from './profile/useBankUrlInstall';
import { BankInstallFeedback, BankUrlInput } from './profile/BankUrlDialog';
import { InlineNote, ListRow, ListSection, TextAction } from './profile/components/list';

/**
 * 线上题库页（RootStack 栈页面 OnlineBanks）：
 * 官方题库一键安装 / 更新、按网址添加、已装线上题库逐个检查更新。
 * 线上题库只能更新不能直接编辑；要改题先在题库管理里「复制为本地编辑」。
 */
export function OnlineBanksScreen() {
  const banks = useQuestionBankStore((state) => state.banks);
  const refreshBanks = useQuestionBankStore((state) => state.refreshBanks);
  const installing = useQuestionBankStore((state) => state.installing);
  const { records, remember } = useBankUpdateRecords(banks);
  const updateBank = useUpdateBank(remember);
  const officialFlow = useBankUrlInstall({ updateBank });
  const urlFlow = useBankUrlInstall({ updateBank });
  const [draftUrl, setDraftUrl] = useState('');
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);
  const [rowNotice, setRowNotice] = useState<{ bankId: string; message: string; failed: boolean } | null>(null);

  useEffect(() => { void refreshBanks(); }, [refreshBanks]);

  const busy = installing || officialFlow.busy || urlFlow.busy || rowBusyId !== null;
  // 下载 / 更新中离开会打断写入：拦截返回键与手势
  usePreventRemove(busy, () => undefined);

  const officialBank = useMemo(() => banks.find((bank) => bank.sourceUrl === OFFICIAL_BANK_URL), [banks]);
  const onlineBanks = useMemo(() => banks.filter(isOnlineBank), [banks]);

  async function checkRow(bankId: string, title: string) {
    if (busy) return;
    setRowBusyId(bankId);
    setRowNotice(null);
    try {
      const outcome = await updateBank(bankId, title);
      // 线上题库更新从不需要确认；万一遇到（旧模型已修改库），引导去题库管理处理
      if (outcome.kind === 'needsConfirmation') {
        setRowNotice({ bankId, message: '这个题库在本机改过，请到「题库管理」里选择如何更新。', failed: true });
      } else {
        setRowNotice({ bankId, message: outcome.message, failed: outcome.kind === 'failed' });
      }
    } finally {
      setRowBusyId(null);
    }
  }

  const submitUrl = () => { void urlFlow.submit(draftUrl); };

  return (
    <SafeAreaView testID="online-banks-screen" style={styles.safeArea} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* 官方题库：用字号与留白突出，不铺色块 */}
        <View style={styles.official}>
          <Text style={styles.eyebrow}>官方推荐</Text>
          <Text style={styles.officialTitle}>FaceE 官方题库</Text>
          <Text style={styles.officialBody}>
            由 FaceE 维护的面试题库，下载一次即可离线刷题，有新版本时在这里一键更新。
          </Text>
          {officialBank ? (
            <Text style={styles.officialMeta}>
              已安装 · {officialBank.questionCount} 题{officialBank.version ? ` · v${officialBank.version}` : ''}
              {officialBank.active ? ' · 使用中' : ''}
              {'\n'}最近检查：{describeLastCheck(records[officialBank.catalogId])}
            </Text>
          ) : null}
          <AppButton
            label={officialBank ? '检查官方题库更新' : '安装官方题库'}
            onPress={() => void officialFlow.submit(OFFICIAL_BANK_URL)}
            loading={officialFlow.busy}
            disabled={busy && !officialFlow.busy}
            style={styles.officialButton}
          />
          <BankInstallFeedback flow={officialFlow} />
        </View>

        <ListSection
          title="按网址添加"
          footnote="粘贴题库 ZIP 下载地址（如 GitHub Release 链接）。地址对应已装的线上题库时会直接更新它。"
        >
          <View style={styles.urlRow}>
            <View style={styles.urlInput}>
              <BankUrlInput
                value={draftUrl}
                onChangeText={(value) => {
                  setDraftUrl(value);
                  if (urlFlow.phase.kind === 'askReinstall' || urlFlow.phase.kind === 'askLocalEdits') urlFlow.reset();
                }}
                editable={!urlFlow.busy}
                onSubmit={submitUrl}
              />
            </View>
            <TextAction
              label={urlFlow.busy ? '下载中' : '下载'}
              accessibilityLabel="按网址下载题库"
              tone="primary"
              disabled={!draftUrl.trim() || busy}
              onPress={submitUrl}
            />
          </View>
          <View style={styles.feedback}>
            <BankInstallFeedback flow={urlFlow} />
          </View>
        </ListSection>

        <ListSection
          title="已安装的线上题库"
          footnote="线上题库只能更新，不能直接编辑；想改题请在题库管理里「复制为本地编辑」。"
        >
          {onlineBanks.length === 0 ? (
            <View style={styles.empty}>
              <InlineNote text="还没有线上题库。安装官方题库，或在上方粘贴地址。" />
            </View>
          ) : null}
          {onlineBanks.map((bank) => {
            const updatingThis = rowBusyId === bank.catalogId;
            const notice = rowNotice?.bankId === bank.catalogId ? rowNotice : null;
            return (
              <ListRow
                key={bank.namespace}
                title={bank.title}
                subtitle={`${bank.questionCount} 题${bank.version ? ` · v${bank.version}` : ''}${bank.active ? ' · 使用中' : ''}\n最近检查：${describeLastCheck(records[bank.catalogId])}`}
                right={
                  <TextAction
                    label={updatingThis ? '检查中' : '检查更新'}
                    accessibilityLabel={updatingThis ? `正在更新题库 ${bank.title}` : `在线更新题库 ${bank.title}`}
                    disabled={busy}
                    onPress={() => void checkRow(bank.catalogId, bank.title)}
                  />
                }
              >
                {notice ? (
                  <View style={styles.rowNotice}>
                    <InlineNote text={notice.message} tone={notice.failed ? 'danger' : 'default'} live />
                  </View>
                ) : null}
              </ListRow>
            );
          })}
        </ListSection>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: {
    paddingHorizontal: layout.pagePadding,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxxl,
    width: '100%',
    maxWidth: layout.readingMaxWidth,
    alignSelf: 'center',
  },
  official: {
    paddingVertical: spacing.xl,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  eyebrow: { ...typography.eyebrow, color: colors.textMuted },
  officialTitle: { ...typography.readingTitle, color: colors.text, marginTop: spacing.sm },
  officialBody: { ...typography.body, color: colors.textSecondary, marginTop: spacing.sm },
  officialMeta: { ...typography.caption, color: colors.textMuted, marginTop: spacing.md, lineHeight: 18 },
  officialButton: { marginTop: spacing.lg, alignSelf: 'flex-start', minWidth: 160 },
  urlRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, paddingTop: spacing.sm },
  urlInput: { flex: 1 },
  feedback: { paddingBottom: spacing.md },
  empty: { paddingVertical: spacing.lg },
  rowNotice: { paddingBottom: spacing.md },
});
