import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MonitorX } from 'lucide-react-native';
import {
  FullscreenImageModal,
  ImageViewerProvider,
} from '../components/image-viewer';
import { EmptyState } from '../components/ui';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useBankStore, type Mastery, type QuestionDetail } from '../bank';
import { useUserStore } from '../store/userStore';
import { colors } from '../theme';
import { PracticeBar } from './detail/PracticeBar';
import { QuestionPage } from './detail/QuestionPage';
import { QuestionPager } from './detail/QuestionPager';
import { ReadingScaleButton } from './detail/ReadingScaleButton';
import { syncPracticeIndex } from './detail/session-sync';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Detail'>;
type DetailRoute = RouteProp<RootStackParamList, 'Detail'>;

/**
 * 题目详情页（题库 v2：数据全部经 useBankStore 读写）。
 * - 浏览模式：单题阅读，头部打标入口 +「查看参考答案」按钮（答案默认展开跟随 userStore.answerExpandedByDefault）；
 * - 练习/复习模式（或带队列）：答案区一律先隐藏，底部固定操作栏承载答案开关、掌握度与上一题/下一题；
 *   队列用原生分页左右滑切题（只渲染当前 ±1 页），翻页经 useBankStore.updateSessionIndex 同步练习会话下标。
 * 返回完全交给原生栈的系统返回手势/返回键。头部右侧「Aa」切换阅读字号（userStore.readingScale）。
 * 路由参数 meta（v1 元数据）不再使用。
 */
export function DetailScreen() {
  const route = useRoute<DetailRoute>();
  const nav = useNavigation<Nav>();
  const { id: initialId, queue, mode } = route.params;
  const initialQueueIndex = route.params.queueIndex ?? queue?.indexOf(initialId) ?? -1;
  const practiceMode = mode === 'practice' || mode === 'review' || (queue?.length ?? 0) > 1;
  // 队列模式：有可分页的队列且起始题在队列中
  const queueMode = Boolean(queue && queue.length > 1 && initialQueueIndex >= 0 && initialQueueIndex < queue.length);

  const answerExpandedByDefault = useUserStore((state) => state.answerExpandedByDefault);
  const bankStatus = useBankStore((state) => state.status);

  // 当前页只在本屏内推进（不再 nav.replace 重建页面），起始页来自路由参数
  const [pageIndex, setPageIndex] = useState(queueMode ? initialQueueIndex : 0);
  const currentId = queueMode && queue ? queue[pageIndex] : initialId;
  // 每题的答案显隐：用户手动切换过的记在这里；否则浏览模式跟随设置，练习/复习模式一律先隐藏
  const [answerOverrides, setAnswerOverrides] = useState<Record<string, boolean>>({});
  // 各页加载到的详情（底栏掌握度用）与未确认的建议档位
  const [details, setDetails] = useState<Record<string, QuestionDetail | null>>({});
  const [suggestions, setSuggestions] = useState<Record<string, Mastery>>({});
  const [previewImage, setPreviewImage] = useState<{ src: string; alt?: string } | null>(null);
  const openImageViewer = useCallback((src: string, alt?: string) => setPreviewImage({ src, alt }), []);

  // App 启动时已初始化；直接深链进入时这里兜底（重复调用安全）
  useEffect(() => {
    if (bankStatus === 'idle') void useBankStore.getState().initialize();
  }, [bankStatus]);

  useFocusEffect(
    useCallback(() => {
      if (!practiceMode) return undefined;
      const parent = nav.getParent();
      const tabNavigator = parent?.getParent?.() ?? parent;
      tabNavigator?.setOptions({ tabBarStyle: { display: 'none' } });
      return () => tabNavigator?.setOptions({ tabBarStyle: undefined });
    }, [nav, practiceMode]),
  );

  // 头部右侧阅读字号开关（Aa）
  useLayoutEffect(() => {
    nav.setOptions({ headerRight: () => <ReadingScaleButton /> });
  }, [nav]);

  // 队列模式：当前页（含起始页）变化时同步练习会话进度，供「继续练习」恢复到这一题
  useEffect(() => {
    if (!queueMode || bankStatus !== 'ready') return;
    syncPracticeIndex(pageIndex);
  }, [queueMode, bankStatus, pageIndex]);

  const isAnswerVisible = useCallback(
    (questionId: string) => answerOverrides[questionId] ?? (practiceMode ? false : answerExpandedByDefault),
    [answerOverrides, answerExpandedByDefault, practiceMode],
  );
  const setAnswerVisible = useCallback((questionId: string, visible: boolean) => {
    setAnswerOverrides((current) => ({ ...current, [questionId]: visible }));
  }, []);
  const handleDetailChange = useCallback((questionId: string, detail: QuestionDetail | null) => {
    setDetails((current) => (current[questionId] === detail ? current : { ...current, [questionId]: detail }));
  }, []);
  const handleSuggest = useCallback((questionId: string, suggestion: Mastery) => {
    setSuggestions((current) => ({ ...current, [questionId]: suggestion }));
  }, []);
  // 打标经 store 排期（src/bank/spaced-review.ts）；确认后建议提示随之消失
  const handleSelectMastery = useCallback(async (questionId: string, value: Mastery | null) => {
    const result = await useBankStore.getState().setMastery(questionId, value);
    if (!result.ok) return;
    setSuggestions((current) => {
      if (!(questionId in current)) return current;
      const next = { ...current };
      delete next[questionId];
      return next;
    });
  }, []);

  const goToPage = useCallback(
    (next: number) => {
      if (!queue || next < 0 || next >= queue.length) return;
      setPageIndex(next);
    },
    [queue],
  );

  if (bankStatus === 'unsupported') {
    return (
      <View style={[styles.screen, styles.centered]}>
        <EmptyState
          title="Web 预览不支持本地题库"
          description="题目详情依赖本机 SQLite 题库，请在 Android App 中使用。"
          icon={MonitorX}
        />
      </View>
    );
  }

  const renderQuestion = (questionId: string, active: boolean) => (
    <QuestionPage
      id={questionId}
      active={active}
      practiceMode={practiceMode}
      showAnswer={isAnswerVisible(questionId)}
      onShowAnswer={() => setAnswerVisible(questionId, true)}
      onDetailChange={handleDetailChange}
      suggestion={suggestions[questionId] ?? null}
      onSuggest={handleSuggest}
      onSelectMastery={(id, value) => void handleSelectMastery(id, value)}
      nav={nav}
    />
  );

  const currentAnswerVisible = isAnswerVisible(currentId);
  const currentDetail = details[currentId] ?? null;

  return (
    <ImageViewerProvider value={openImageViewer}>
      <View style={styles.screen}>
        <View style={styles.body}>
          {queueMode && queue ? (
            <QuestionPager
              page={pageIndex}
              pageCount={queue.length}
              onPageChange={goToPage}
              renderPage={(index) => renderQuestion(queue[index], index === pageIndex)}
            />
          ) : (
            renderQuestion(initialId, true)
          )}
        </View>

        {practiceMode ? (
          <PracticeBar
            mastery={
              currentDetail
                ? { mastery: currentDetail.learning.mastery, dueAt: currentDetail.learning.dueAt }
                : undefined
            }
            suggested={suggestions[currentId] ?? null}
            onSelectMastery={(value) => void handleSelectMastery(currentId, value)}
            answerVisible={currentAnswerVisible}
            answerAvailable={currentDetail !== null}
            onToggleAnswer={() => setAnswerVisible(currentId, !currentAnswerVisible)}
            queue={
              queueMode && queue
                ? {
                    current: pageIndex + 1,
                    total: queue.length,
                    onPrev: () => goToPage(pageIndex - 1),
                    onNext: () => goToPage(pageIndex + 1),
                  }
                : undefined
            }
          />
        ) : null}

        <FullscreenImageModal preview={previewImage} onClose={() => setPreviewImage(null)} />
      </View>
    </ImageViewerProvider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  centered: { justifyContent: 'center' },
  body: { flex: 1 },
});
