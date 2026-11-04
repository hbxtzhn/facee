import { useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useQuestionBankStore } from '../question-bank/store';
import { getBankReadingProgress } from '../question-bank/catalog';
import { useUserStore } from '../store/userStore';
import { AppUpdateCard } from '../components/app-update-card';
import { colors, layout, spacing, typography } from '../theme';
import { BankUrlDialog } from './profile/BankUrlDialog';
import { BackupModal } from './profile/BackupModal';
import { LlmSettingsModal } from './profile/LlmSettingsModal';
import { ListRow, ListSection } from './profile/components/list';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * 「我的」页（极简阅读风）：顶部一行统计，下方是安静的设置列表——
 * 题库 / 刷题 / AI / 关于。题库行永远进管理页；本地题库另给「编辑当前题库」。
 */
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

  const { totalCount: totalBankCount, ratio: progressRatio } =
    getBankReadingProgress(catalog, user.viewedQuestionIds);
  const progressPercent = Math.round(progressRatio * 100);
  const statsLine = totalBankCount > 0
    ? `已刷 ${user.totalCount} 题 · 当前题库进度 ${progressPercent}%`
    : `已刷 ${user.totalCount} 题`;

  // 地址弹窗打开时自行回填已保存地址并清掉旧错误（见 BankUrlDialog）
  const openUrlDialog = () => setUrlDialogVisible(true);

  const currentBankIsLocal = Boolean(catalog?.id?.startsWith('local-'));
  const openBankManager = () => navigation.navigate('BankManager');
  const openCurrentBankEditor = () => {
    if (catalog && currentBankIsLocal) navigation.navigate('BankEditor', { bankId: catalog.id });
  };

  const bankMeta = catalog
    ? `${catalog.questions.length} 题 · ${catalog.tags.length} 个分类${catalog.version ? ` · v${catalog.version}` : ''}`
    : undefined;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">我的</Text>
          <Text style={styles.stats} accessibilityLabel={statsLine}>{statsLine}</Text>
        </View>

        <ListSection title="题库">
          {catalog ? (
            <>
              <ListRow
                title={catalog.title}
                subtitle={bankMeta}
                value={isNative ? '管理' : undefined}
                onPress={isNative ? openBankManager : undefined}
                accessibilityLabel={`管理题库 ${catalog.title}`}
              />
              {isNative && currentBankIsLocal ? (
                <ListRow
                  title="编辑当前题库"
                  onPress={openCurrentBankEditor}
                  accessibilityLabel={`编辑当前题库 ${catalog.title}`}
                />
              ) : null}
              {!isNative ? (
                <ListRow title="更换题库" onPress={openUrlDialog} accessibilityLabel="更换题库" />
              ) : null}
            </>
          ) : isNative ? (
            <ListRow
              title="新建或管理题库"
              subtitle="还没有题库：新建本地题库，或到「线上题库」安装官方题库"
              onPress={openBankManager}
              accessibilityLabel="新建或管理题库"
            />
          ) : (
            <ListRow title="增加题库" onPress={openUrlDialog} accessibilityLabel="增加题库" />
          )}
          {isNative ? (
            <ListRow
              title="线上题库"
              subtitle="官方题库、按网址添加与更新"
              onPress={() => navigation.navigate('OnlineBanks')}
              accessibilityLabel="线上题库"
            />
          ) : null}
          {isNative ? (
            <ListRow
              title="备份与恢复"
              onPress={() => setBackupVisible(true)}
              accessibilityLabel="备份与恢复"
            />
          ) : null}
        </ListSection>

        <ListSection title="刷题">
          <ListRow
            title="默认展开答案"
            subtitle={user.answerExpandedByDefault ? '进入题目即显示解答' : '先自己想，再按需查看'}
            right={
              <Switch
                value={user.answerExpandedByDefault}
                onValueChange={user.setAnswerExpandedByDefault}
                trackColor={{ false: colors.borderStrong, true: colors.primary }}
                thumbColor={colors.white}
                accessibilityLabel="进入题目时默认展开答案"
              />
            }
          />
        </ListSection>

        {isNative ? (
          <ListSection title="AI">
            <ListRow
              title="AI 设置"
              subtitle="配置模型服务，从文本 / 图片出题"
              onPress={() => setLlmSettingsVisible(true)}
              accessibilityLabel="AI 设置"
            />
          </ListSection>
        ) : null}

        <ListSection title="关于" footnote="所有数据只保存在本机。">
          <AppUpdateCard />
        </ListSection>
      </ScrollView>

      {/* 增加题库 / 更换题库弹窗（Web 入口）：填入 ZIP 地址后下载并启用 */}
      <BankUrlDialog visible={urlDialogVisible} onClose={() => setUrlDialogVisible(false)} />

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
  content: {
    paddingHorizontal: layout.pagePadding,
    paddingBottom: spacing.xxxl,
    width: '100%',
    maxWidth: layout.readingMaxWidth,
    alignSelf: 'center',
  },
  header: { paddingTop: spacing.xl },
  title: { ...typography.title, color: colors.text },
  stats: { ...typography.body, color: colors.textMuted, marginTop: spacing.xs },
});
