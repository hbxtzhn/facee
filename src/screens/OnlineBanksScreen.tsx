import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePreventRemove } from '@react-navigation/native';
import { useBankStore, type BankSummary } from '../bank';
import { AppButton } from '../components/ui';
import { colors, layout, spacing, typography } from '../theme';
import {
  OFFICIAL_MANIFEST_URL,
  UNSUPPORTED_TEXT,
  bankErrorText,
  describeBank,
  describeInstall,
} from './profile/bank-helpers';
import { useBankUpdates } from './profile/useBankUpdates';
import { BankBusyNote, UpdateCheckPanel } from './profile/components/bank-status';
import { InlineNote, ListRow, ListSection, TextAction, listStyles } from './profile/components/list';

type Feedback = { message: string; failed: boolean } | null;

/**
 * 线上题库页（RootStack 栈页面 OnlineBanks）：
 * 官方题库一键添加、按 latest.json 地址添加、已装线上题库逐个「检查更新」——
 * 先展示新增 / 修改 / 删除与更新说明，用户确认后才下载更新。
 * 线上题库只能更新不能直接编辑；要改题先在题库管理里「复制为本地编辑」。
 */
export function OnlineBanksScreen() {
  const status = useBankStore((state) => state.status);
  const banks = useBankStore((state) => state.banks);
  const busy = useBankStore((state) => state.busy);
  const activeBankId = useBankStore((state) => state.activeBankId);
  const addOnlineBank = useBankStore((state) => state.addOnlineBank);
  const updates = useBankUpdates();
  const [draftUrl, setDraftUrl] = useState('');
  const [officialFeedback, setOfficialFeedback] = useState<Feedback>(null);
  const [urlFeedback, setUrlFeedback] = useState<Feedback>(null);
  const [installing, setInstalling] = useState<'official' | 'url' | null>(null);

  const working = busy !== null || installing !== null || updates.checkingId !== null;
  // 下载 / 更新中离开会打断写入：拦截返回键与手势
  usePreventRemove(busy !== null || installing !== null, () => undefined);

  const remoteBanks = useMemo(() => banks.filter((bank) => bank.origin === 'remote'), [banks]);
  const officialBank = useMemo(
    () => remoteBanks.find((bank) => bank.manifestUrl === OFFICIAL_MANIFEST_URL),
    [remoteBanks],
  );

  async function install(kind: 'official' | 'url', url: string) {
    if (working) return;
    const setFeedback = kind === 'official' ? setOfficialFeedback : setUrlFeedback;
    setInstalling(kind);
    setFeedback(null);
    try {
      const result = await addOnlineBank(url.trim());
      if (result.ok) {
        setFeedback({ message: describeInstall(result.value), failed: false });
        if (kind === 'url') setDraftUrl('');
      } else {
        setFeedback({ message: bankErrorText(result.error, { official: kind === 'official' }), failed: true });
      }
    } finally {
      setInstalling(null);
    }
  }

  if (status === 'unsupported') {
    return (
      <SafeAreaView testID="online-banks-screen" style={styles.safeArea} edges={['bottom']}>
        <View style={styles.content}>
          <View style={styles.official}>
            <InlineNote text={UNSUPPORTED_TEXT} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const renderUpdateArea = (bank: BankSummary) => {
    const check = updates.checks[bank.id];
    const notice = updates.notices[bank.id];
    return (
      <>
        {check ? (
          <UpdateCheckPanel
            bankName={bank.name}
            check={check}
            disabled={working}
            onConfirm={() => void updates.update(bank.id)}
            onDismiss={() => updates.dismiss(bank.id)}
          />
        ) : null}
        {notice ? (
          <View style={styles.rowNotice}>
            <InlineNote text={notice.message} tone={notice.failed ? 'danger' : 'default'} live />
          </View>
        ) : null}
      </>
    );
  };

  return (
    <SafeAreaView testID="online-banks-screen" style={styles.safeArea} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <BankBusyNote />

        {/* 官方题库：用字号与留白突出，不铺色块 */}
        <View style={styles.official}>
          <Text style={styles.eyebrow}>官方推荐</Text>
          <Text style={styles.officialTitle}>FaceE 官方题库</Text>
          <Text style={styles.officialBody}>
            由 FaceE 维护的面试题库，添加一次即可离线刷题；有新版本时先看变化，再决定是否更新。
          </Text>
          {officialBank ? (
            <>
              <Text style={styles.officialMeta}>
                已安装 · {describeBank(officialBank)}{officialBank.id === activeBankId ? ' · 使用中' : ''}
              </Text>
              <AppButton
                label={updates.checkingId === officialBank.id ? '正在检查' : '检查官方题库更新'}
                onPress={() => void updates.check(officialBank.id)}
                loading={updates.checkingId === officialBank.id}
                disabled={working}
                style={styles.officialButton}
              />
              <View style={styles.officialFeedback}>{renderUpdateArea(officialBank)}</View>
            </>
          ) : (
            <AppButton
              label="安装官方题库"
              onPress={() => void install('official', OFFICIAL_MANIFEST_URL)}
              loading={installing === 'official'}
              disabled={working}
              style={styles.officialButton}
            />
          )}
          {officialFeedback ? (
            <View style={styles.officialFeedback}>
              <InlineNote text={officialFeedback.message} tone={officialFeedback.failed ? 'danger' : 'default'} live />
            </View>
          ) : null}
        </View>

        <ListSection
          title="按网址添加"
          footnote="粘贴题库的 latest.json 地址（如 GitHub Release 的 …/releases/latest/download/latest.json）。地址对应已装的线上题库时会直接安装最新版本。"
        >
          <View style={styles.urlRow}>
            <TextInput
              value={draftUrl}
              onChangeText={(value) => { setDraftUrl(value); setUrlFeedback(null); }}
              placeholder="https://…/latest.json"
              placeholderTextColor={colors.textSubtle}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              editable={!working}
              onSubmitEditing={() => void install('url', draftUrl)}
              accessibilityLabel="题库清单地址"
              style={[listStyles.input, styles.urlInput]}
            />
            <TextAction
              label={installing === 'url' ? '添加中' : '添加'}
              accessibilityLabel="按网址添加题库"
              tone="primary"
              disabled={!draftUrl.trim() || working}
              onPress={() => void install('url', draftUrl)}
            />
          </View>
          {urlFeedback ? (
            <View style={styles.feedback}>
              <InlineNote text={urlFeedback.message} tone={urlFeedback.failed ? 'danger' : 'default'} live />
            </View>
          ) : null}
        </ListSection>

        <ListSection
          title="已安装的线上题库"
          footnote="线上题库只能更新，不能直接编辑；想改题请在题库管理里「复制为本地编辑」。"
        >
          {remoteBanks.length === 0 ? (
            <View style={styles.empty}>
              <InlineNote text="还没有线上题库。安装官方题库，或在上方粘贴地址。" />
            </View>
          ) : null}
          {remoteBanks.map((bank) => {
            const checking = updates.checkingId === bank.id;
            const updating = busy?.kind === 'update' && busy.bankId === bank.id;
            return (
              <ListRow
                key={bank.id}
                title={bank.name}
                subtitle={`${describeBank(bank)}${bank.id === activeBankId ? ' · 使用中' : ''}`}
                right={
                  <TextAction
                    label={updating ? '更新中' : checking ? '检查中' : '检查更新'}
                    accessibilityLabel={`检查更新 ${bank.name}`}
                    disabled={working}
                    onPress={() => void updates.check(bank.id)}
                  />
                }
              >
                {renderUpdateArea(bank)}
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
  officialFeedback: { marginTop: spacing.md },
  urlRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, paddingTop: spacing.sm },
  urlInput: { flex: 1 },
  feedback: { paddingVertical: spacing.md },
  empty: { paddingVertical: spacing.lg },
  rowNotice: { paddingBottom: spacing.md },
});
