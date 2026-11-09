import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useBankStore } from '../bank';
import { useUserStore } from '../store/userStore';
import { AppUpdateCard } from '../components/app-update-card';
import { colors, layout, spacing, typography } from '../theme';
import { BackupModal } from './profile/BackupModal';
import { LlmSettingsModal } from './profile/LlmSettingsModal';
import { InlineNote, ListRow, ListSection } from './profile/components/list';
import { ORIGIN_LABEL, UNSUPPORTED_TEXT } from './profile/bank-helpers';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * 「我的」页（极简阅读风）：顶部一行学习统计，下方是安静的设置列表——
 * 题库 / 刷题 / AI / 关于。当前题库行进管理页；本地题库另给「编辑当前题库」。
 */
export function ProfileScreen() {
  const navigation = useNavigation<Nav>();
  const answerExpandedByDefault = useUserStore((state) => state.answerExpandedByDefault);
  const setAnswerExpandedByDefault = useUserStore((state) => state.setAnswerExpandedByDefault);
  const loadUser = useUserStore((state) => state.load);
  const status = useBankStore((state) => state.status);
  const activeBank = useBankStore((state) => state.activeBank);
  const banks = useBankStore((state) => state.banks);
  const stats = useBankStore((state) => state.stats);
  const categories = useBankStore((state) => state.categories);

  const [llmSettingsVisible, setLlmSettingsVisible] = useState(false);
  const [backupVisible, setBackupVisible] = useState(false);
  const unsupported = status === 'unsupported';
  const ready = status === 'ready';

  useEffect(() => {
    void loadUser();
  }, [loadUser]);

  const statsLine = !ready
    ? unsupported ? 'Web 预览不记录学习数据' : '正在读取题库…'
    : stats && stats.questionCount > 0
      ? `已标 ${stats.markedCount}/${stats.questionCount} 题 · 会了 ${stats.knownCount} · 今日待复习 ${stats.dueCount} · 收藏 ${stats.favoriteCount}`
      : '还没有学习记录';

  const bankMeta = activeBank
    ? `${ORIGIN_LABEL[activeBank.origin]} · ${activeBank.questionCount} 题 · ${categories.length} 个分类 · v${activeBank.version}`
    : undefined;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">我的</Text>
          <Text style={styles.stats} accessibilityLabel={statsLine}>{statsLine}</Text>
        </View>

        <ListSection title="题库">
          {unsupported ? (
            <View style={styles.note}>
              <InlineNote text={UNSUPPORTED_TEXT} />
            </View>
          ) : (
            <>
              {activeBank ? (
                <ListRow
                  title={activeBank.name}
                  subtitle={bankMeta}
                  value="管理"
                  onPress={() => navigation.navigate('BankManager')}
                  accessibilityLabel={`管理题库 ${activeBank.name}`}
                />
              ) : (
                <ListRow
                  title={banks.length > 0 ? '选择题库' : '新建或管理题库'}
                  subtitle={banks.length > 0 ? '还没有选择当前题库' : '还没有题库：新建本地题库、导入题库文件，或到「线上题库」添加'}
                  onPress={() => navigation.navigate('BankManager')}
                  accessibilityLabel="新建或管理题库"
                />
              )}
              {activeBank?.origin === 'local' ? (
                <ListRow
                  title="编辑当前题库"
                  onPress={() => navigation.navigate('BankEditor', { bankId: activeBank.id })}
                  accessibilityLabel={`编辑当前题库 ${activeBank.name}`}
                />
              ) : null}
              <ListRow
                title="线上题库"
                subtitle="官方题库、按网址添加与检查更新"
                onPress={() => navigation.navigate('OnlineBanks')}
                accessibilityLabel="线上题库"
              />
              <ListRow
                title="备份与恢复"
                subtitle="学习数据与本地题库"
                onPress={() => setBackupVisible(true)}
                accessibilityLabel="备份与恢复"
              />
            </>
          )}
        </ListSection>

        <ListSection title="刷题">
          <ListRow
            title="默认展开答案"
            subtitle={answerExpandedByDefault ? '进入题目即显示解答' : '先自己想，再按需查看'}
            right={
              <Switch
                value={answerExpandedByDefault}
                onValueChange={setAnswerExpandedByDefault}
                trackColor={{ false: colors.borderStrong, true: colors.primary }}
                thumbColor={colors.white}
                accessibilityLabel="进入题目时默认展开答案"
              />
            }
          />
        </ListSection>

        {!unsupported ? (
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

      {!unsupported ? (
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
  note: { paddingVertical: spacing.lg },
});
