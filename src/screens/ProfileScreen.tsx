import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  Bot,
  ChevronRight,
  Database,
  Download,
  Eye,
  FolderCog,
  Pencil,
  Plus,
  Trophy,
  Archive,
} from 'lucide-react-native';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useQuestionBankStore } from '../question-bank/store';
import { getBankReadingProgress } from '../question-bank/catalog';
import { useUserStore } from '../store/userStore';
import { ProgressBar, TabHeader } from '../components/ui';
import { AppUpdateCard } from '../components/app-update-card';
import { cardChrome, colors, radii, spacing, typography } from '../theme';
import { BankUrlDialog } from './profile/BankUrlDialog';
import { BackupModal } from './profile/BackupModal';
import { LlmSettingsModal } from './profile/LlmSettingsModal';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function ProfileScreen() {
  const navigation = useNavigation<Nav>();
  const user = useUserStore();
  const catalog = useQuestionBankStore((state) => state.catalog);
  const status = useQuestionBankStore((state) => state.status);
  const initializeQuestionBank = useQuestionBankStore((state) => state.initialize);

  const [urlDialogVisible, setUrlDialogVisible] = useState(false);
  const [llmSettingsVisible, setLlmSettingsVisible] = useState(false);
  const [backupVisible, setBackupVisible] = useState(false);
  const isNative = Platform.OS !== 'web';

  useEffect(() => {
    void user.load();
    if (status === 'idle') void initializeQuestionBank();
  }, [initializeQuestionBank, status, user.load]);

  const { totalCount: totalBankCount, viewedCount, ratio: progressRatio } =
    getBankReadingProgress(catalog, user.viewedQuestionIds);
  const progressPercent = Math.round(progressRatio * 100);

  // 地址弹窗打开时自行回填已保存地址并清掉旧错误（见 BankUrlDialog）
  const openUrlDialog = () => setUrlDialogVisible(true);

  // 入口一致：题库行永远进管理页；当前是本地题库时另给「编辑当前题库」直达编辑页
  const currentBankIsLocal = Boolean(catalog?.id?.startsWith('local-'));
  const openBankManager = () => navigation.navigate('BankManager');
  const openCurrentBankEditor = () => {
    if (catalog && currentBankIsLocal) navigation.navigate('BankEditor', { bankId: catalog.id });
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* 顶部个人进度 Hero 卡片 */}
        <View style={styles.header}>
          <TabHeader
            eyebrow="学习数据 · 个人中心"
            title="我的进度"
            subtitle="累计刷题与偏好设置，全部保存在本机。"
          />
        </View>

        {/* 学习仪表盘：进度环感与成就数字 */}
        <View style={styles.statsCard}>
          <View style={styles.statsMainRow}>
            <View style={styles.statIconBox}>
              <Trophy size={24} color={colors.primary} strokeWidth={2} />
            </View>
            <View style={styles.statTextGroup}>
              <Text style={styles.statLabel}>累计刷题总数</Text>
              <View style={styles.statNumberRow}>
                <Text style={styles.statNumber}>{user.totalCount}</Text>
                <Text style={styles.statUnit}>道</Text>
              </View>
            </View>
          </View>

          {totalBankCount > 0 ? (
            <View style={styles.progressBarSection}>
              <View style={styles.progressLabelRow}>
                <Text style={styles.progressMetaText}>当前题库已刷 {viewedCount} / {totalBankCount} 题</Text>
                <Text style={styles.progressPercentText}>{progressPercent}%</Text>
              </View>
              <ProgressBar value={progressRatio} accessibilityLabel="当前题库已刷进度" />
            </View>
          ) : null}
          <Text style={styles.statFooterNote}>只统计累计刷过题数，不按天计，温故而知新。</Text>
        </View>

        {/* 偏好设置 */}
        <Text style={styles.sectionHeader}>刷题偏好设置</Text>
        <View style={styles.cardContainer}>
          <View style={styles.settingRow}>
            <View style={styles.settingIconBox}>
              <Eye size={18} color={colors.primary} strokeWidth={2} />
            </View>
            <View style={styles.settingCopy}>
              <Text style={styles.settingTitle}>进入题目时默认展开答案</Text>
              <Text style={styles.settingSubtitle}>
                {user.answerExpandedByDefault ? '已开启：直接查看思路与解答' : '已关闭：先自主思考，按需查看'}
              </Text>
            </View>
            <Switch
              value={user.answerExpandedByDefault}
              onValueChange={user.setAnswerExpandedByDefault}
              trackColor={{ false: colors.borderStrong, true: colors.primarySoft }}
              thumbColor={user.answerExpandedByDefault ? colors.primary : colors.surface}
              accessibilityLabel="进入题目时默认展开答案"
            />
          </View>
          {isNative ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="AI 设置"
              onPress={() => setLlmSettingsVisible(true)}
              style={({ pressed }) => [styles.settingRow, styles.aiSettingRow, pressed && styles.pressedRow]}
            >
              <View style={styles.settingIconBox}>
                <Bot size={18} color={colors.primary} strokeWidth={2} />
              </View>
              <View style={styles.settingCopy}>
                <Text style={styles.settingTitle}>AI 设置</Text>
                <Text style={styles.settingSubtitle}>配置模型服务，从文本智能出题</Text>
              </View>
            </Pressable>
          ) : null}
        </View>

        {/* 本地题库：题库行 → 管理页；本地题库另有「编辑当前题库」→ 编辑页（均为栈页面） */}
        <Text style={styles.sectionHeader}>本地题库信息</Text>
        <View style={styles.cardContainer}>
          {catalog ? (
            <>
              <Pressable
                onPress={isNative ? openBankManager : undefined}
                disabled={!isNative}
                accessibilityRole="button"
                accessibilityLabel={`管理题库 ${catalog.title}`}
                style={({ pressed }) => [styles.libraryRow, pressed && styles.pressedRow]}
              >
                <View style={styles.libraryIconBox}>
                  <Database size={18} color={colors.primary} strokeWidth={2} />
                </View>
                <View style={styles.libraryDetails}>
                  <Text style={styles.libraryTitle}>{catalog.title}</Text>
                  <Text style={styles.libraryMeta}>
                    {catalog.questions.length} 道精选真题 · {catalog.tags.length} 个分类标签
                    {catalog.version ? ` · v${catalog.version}` : ''}
                  </Text>
                </View>
                {isNative ? (
                  <View style={styles.libraryAffordance}>
                    <Text style={styles.libraryAffordanceMuted}>管理</Text>
                    <ChevronRight size={16} color={colors.textMuted} strokeWidth={2} />
                  </View>
                ) : null}
              </Pressable>
              {isNative && currentBankIsLocal ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`编辑当前题库 ${catalog.title}`}
                  onPress={openCurrentBankEditor}
                  style={({ pressed }) => [styles.bankActionRow, pressed && styles.pressedRow]}
                >
                  <Pencil size={14} color={colors.primary} strokeWidth={2} />
                  <Text style={styles.bankActionTextPrimary}>编辑当前题库</Text>
                </Pressable>
              ) : null}
              {isNative ? (
                <Text style={styles.bankHintRow}>
                  点上方题库可切换 / 新建本地题库 / 复制出可编辑副本
                </Text>
              ) : (
                <Pressable
                  onPress={openUrlDialog}
                  style={styles.bankActionRow}
                  accessibilityRole="button"
                  accessibilityLabel="更换题库"
                >
                  <Download size={14} color={colors.textSecondary} strokeWidth={2} />
                  <Text style={styles.bankActionText}>更换题库</Text>
                </Pressable>
              )}
              {isNative ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="备份与恢复"
                  onPress={() => setBackupVisible(true)}
                  style={({ pressed }) => [styles.bankActionRow, pressed && styles.pressedRow]}
                >
                  <Archive size={14} color={colors.textSecondary} strokeWidth={2} />
                  <Text style={styles.bankActionText}>备份与恢复</Text>
                </Pressable>
              ) : null}
            </>
          ) : isNative ? (
            <Pressable
              onPress={openBankManager}
              accessibilityRole="button"
              accessibilityLabel="新建或管理题库"
              style={({ pressed }) => [styles.bankActionRow, pressed && styles.pressedRow]}
            >
              <FolderCog size={16} color={colors.primary} strokeWidth={2} />
              <Text style={styles.bankActionTextStrong}>新建本地题库 / 添加线上题库</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={openUrlDialog}
              style={styles.bankActionRow}
              accessibilityRole="button"
              accessibilityLabel="增加题库"
            >
              <Plus size={16} color={colors.primary} strokeWidth={2.2} />
              <Text style={styles.bankActionTextStrong}>增加题库</Text>
            </Pressable>
          )}
        </View>

        {/* 应用更新 */}
        <Text style={styles.sectionHeader}>版本与更新</Text>
        <AppUpdateCard />
      </ScrollView>

      {/* 增加题库 / 更换题库弹窗：填入 ZIP 地址后下载并启用 */}
      <BankUrlDialog visible={urlDialogVisible} onClose={() => setUrlDialogVisible(false)} />

      {/* 题库管理 / 编辑已是栈页面；这里只保留 AI 设置与备份两个单层弹窗 */}
      {isNative ? (
        <>
          <LlmSettingsModal visible={llmSettingsVisible} onClose={() => setLlmSettingsVisible(false)} />
          <BackupModal visible={backupVisible} onClose={() => setBackupVisible(false)} />
        </>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl },
  header: { paddingTop: spacing.md, paddingBottom: spacing.md },
  statsCard: {
    ...cardChrome,
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  statsMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  statIconBox: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceWarm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statTextGroup: { flex: 1 },
  statLabel: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },
  statNumberRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: 2 },
  statNumber: { fontSize: 28, lineHeight: 34, fontWeight: '700', color: colors.text },
  statUnit: { ...typography.body, color: colors.textSecondary, fontWeight: '600' },
  statRatio: { ...typography.caption, color: colors.textSubtle, marginLeft: spacing.xs },
  progressBarSection: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  progressLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  progressMetaText: { ...typography.caption, color: colors.textMuted },
  progressPercentText: { ...typography.caption, color: colors.text, fontWeight: '700' },
  statFooterNote: {
    ...typography.caption,
    color: colors.textSubtle,
    marginTop: spacing.md,
    fontSize: 11,
  },
  sectionHeader: {
    ...typography.heading,
    fontSize: 15,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  cardContainer: {
    ...cardChrome,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  settingIconBox: {
    width: 32,
    height: 32,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingCopy: { flex: 1 },
  aiSettingRow: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  pressedRow: { opacity: 0.75 },
  settingTitle: { ...typography.bodyStrong, color: colors.text, fontSize: 14 },
  settingSubtitle: { ...typography.caption, color: colors.textMuted, marginTop: 2, fontSize: 12 },
  libraryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  libraryIconBox: {
    width: 32,
    height: 32,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  libraryDetails: { flex: 1 },
  libraryAffordance: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  libraryAffordanceMuted: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '600',
    fontSize: 12,
  },
  libraryTitle: { ...typography.bodyStrong, color: colors.text, fontSize: 14 },
  libraryMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2, fontSize: 12 },
  bankActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  bankHintRow: {
    ...typography.caption,
    color: colors.textSubtle,
    fontSize: 11,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  bankActionText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
    fontSize: 12,
  },
  bankActionTextPrimary: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '700',
    fontSize: 12,
  },
  bankActionTextStrong: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '700',
    fontSize: 13,
  },
});
