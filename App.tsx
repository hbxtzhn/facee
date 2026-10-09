// 应用根：只在本地题库安装后加载导航
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useFonts } from 'expo-font';
import { BookOpenCheck } from 'lucide-react-native';
import { AppNavigator } from './src/navigation/AppNavigator';
import { useQuestionBankStore } from './src/question-bank/store';
import { useFavoritesStore } from './src/store/favoritesStore';
import { useMasteryStore } from './src/store/masteryStore';
import { useUserStore } from './src/store/userStore';
import { colors, spacing, typography } from './src/theme';

export default function App() {
  const userLoad = useUserStore((s) => s.load);
  const favoritesLoad = useFavoritesStore((s) => s.load);
  const masteryLoad = useMasteryStore((s) => s.load);
  const [ready, setReady] = useState(false);
  const questionBankStatus = useQuestionBankStore((state) => state.status);
  const initializeQuestionBank = useQuestionBankStore((state) => state.initialize);
  // 加载失败时照常进入应用：代码排版回退到系统 monospace，不阻塞启动
  const [fontsLoaded, fontsError] = useFonts({
    JetBrainsMono: require('./assets/fonts/JetBrainsMono-Regular.ttf'),
  });
  const fontsReady = fontsLoaded || Boolean(fontsError);

  useEffect(() => {
    void Promise.all([userLoad(), favoritesLoad(), masteryLoad(), initializeQuestionBank()])
      .finally(() => setReady(true));
  }, [favoritesLoad, initializeQuestionBank, masteryLoad, userLoad]);

  if (!ready || !fontsReady || questionBankStatus === 'idle' || questionBankStatus === 'loading') {
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

  // The app shell is usable before a question bank is installed. The Home,
  // Favorites and Profile tabs can render their empty states, while Profile
  // remains the place to configure and download a remote bank.
  return <AppNavigator />;
}

const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
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
  spinner: { marginTop: spacing.xl },
});
