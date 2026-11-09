// 应用根：初始化 v2 题库数据层（SQLite）与用户设置 / 字体后加载导航
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useFonts } from 'expo-font';
import { BookOpenCheck } from 'lucide-react-native';
import { AppNavigator } from './src/navigation/AppNavigator';
import { useBankStore } from './src/bank';
import { useUserStore } from './src/store/userStore';
import { AppButton } from './src/components/ui';
import { colors, spacing, typography } from './src/theme';

export default function App() {
  const userLoad = useUserStore((s) => s.load);
  const bankStatus = useBankStore((s) => s.status);
  const bankError = useBankStore((s) => s.lastError);
  const [userReady, setUserReady] = useState(false);
  // 加载失败时照常进入应用：代码排版回退到系统 monospace，不阻塞启动
  const [fontsLoaded, fontsError] = useFonts({
    JetBrainsMono: require('./assets/fonts/JetBrainsMono-Regular.ttf'),
  });
  const fontsReady = fontsLoaded || Boolean(fontsError);

  useEffect(() => {
    void Promise.resolve(userLoad()).catch(() => undefined).finally(() => setUserReady(true));
    // initialize 永不 reject；重复调用安全
    void useBankStore.getState().initialize();
  }, [userLoad]);

  if (bankStatus === 'error') {
    return (
      <View style={styles.loadingScreen} accessibilityRole="alert">
        <Text style={styles.brand}>FaceE</Text>
        <Text style={styles.errorTitle}>题库数据库打开失败</Text>
        <Text style={styles.errorBody}>{bankError?.message ?? '未知错误'}</Text>
        <AppButton
          label="重试"
          onPress={() => void useBankStore.getState().initialize()}
          style={styles.retry}
        />
      </View>
    );
  }

  // unsupported（Web 预览）照常进入应用：各页自行显示「Web 预览不支持本地题库」
  const bankSettled = bankStatus === 'ready' || bankStatus === 'unsupported';
  if (!userReady || !fontsReady || !bankSettled) {
    return (
      <View style={styles.loadingScreen}>
        <View style={styles.logoMark}>
          <BookOpenCheck size={34} color={colors.primary} strokeWidth={1.8} />
        </View>
        <Text style={styles.brand}>FaceE</Text>
        <Text style={styles.loadingCopy}>正在准备你的面试题库</Text>
        <ActivityIndicator color={colors.primary} style={styles.spinner} />
      </View>
    );
  }

  return <AppNavigator />;
}

const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    paddingHorizontal: spacing.xxl,
  },
  logoMark: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.borderStrong,
  },
  brand: { ...typography.display, color: colors.text, marginTop: spacing.lg },
  loadingCopy: {
    ...typography.body,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  errorTitle: { ...typography.heading, color: colors.text, marginTop: spacing.lg },
  errorBody: { ...typography.caption, color: colors.danger, marginTop: spacing.sm, textAlign: 'center', lineHeight: 18 },
  retry: { marginTop: spacing.xl, minWidth: 120 },
  spinner: { marginTop: spacing.xl },
});
