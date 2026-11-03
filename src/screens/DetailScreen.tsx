import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  FullscreenImageModal,
  ImageViewerProvider,
} from '../components/image-viewer';
import type { HomeStackParamList } from '../navigation/AppNavigator';
import { useQuestionBankStore } from '../question-bank/store';
import { useUserStore } from '../store/userStore';
import { useFavoritesStore } from '../store/favoritesStore';
import { colors } from '../theme';
import { PracticeBar } from './detail/PracticeBar';
import { QuestionPage } from './detail/QuestionPage';
import { QuestionPager } from './detail/QuestionPager';

type Nav = NativeStackNavigationProp<HomeStackParamList, 'Detail'>;
type DetailRoute = RouteProp<HomeStackParamList, 'Detail'>;

/**
 * 题目详情页。
 * - 浏览模式：单题阅读，头部打标入口 +「查看参考答案」按钮；
 * - 练习/复习模式（或带队列）：原生分页左右滑切题（只渲染当前 ±1 页），
 *   底部固定操作栏承载答案开关、掌握度与上一题/下一题。
 * 返回完全交给原生栈的系统返回手势/返回键，不再自绘边缘手势。
 */
export function DetailScreen() {
  const route = useRoute<DetailRoute>();
  const nav = useNavigation<Nav>();
  const { id: initialId, queue, meta: initialMeta, mode } = route.params;
  const initialQueueIndex = route.params.queueIndex ?? queue?.indexOf(initialId) ?? -1;
  const practiceMode = mode === 'practice' || mode === 'review' || (queue?.length ?? 0) > 1;
  // 队列模式：有可分页的队列且起始题在队列中
  const queueMode = Boolean(queue && queue.length > 1 && initialQueueIndex >= 0 && initialQueueIndex < queue.length);

  const answerExpandedByDefault = useUserStore((state) => state.answerExpandedByDefault);
  const loadFavorites = useFavoritesStore((state) => state.load);
  const bankId = useQuestionBankStore((state) => state.catalog?.id ?? null);

  // 当前页只在本屏内推进（不再 nav.replace 重建页面），起始页来自路由参数
  const [pageIndex, setPageIndex] = useState(queueMode ? initialQueueIndex : 0);
  const currentId = queueMode && queue ? queue[pageIndex] : initialId;
  // 每题的答案显隐：用户手动切换过的记在这里，否则跟随「默认展开答案」设置
  const [answerOverrides, setAnswerOverrides] = useState<Record<string, boolean>>({});
  const [answerAvailability, setAnswerAvailability] = useState<Record<string, boolean>>({});
  const [previewImage, setPreviewImage] = useState<{ src: string; alt?: string } | null>(null);
  const openImageViewer = useCallback((src: string, alt?: string) => setPreviewImage({ src, alt }), []);

  useFocusEffect(
    useCallback(() => {
      if (!practiceMode) return undefined;
      const parent = nav.getParent();
      const tabNavigator = parent?.getParent?.() ?? parent;
      tabNavigator?.setOptions({ tabBarStyle: { display: 'none' } });
      return () => tabNavigator?.setOptions({ tabBarStyle: undefined });
    }, [nav, practiceMode]),
  );

  useEffect(() => {
    void loadFavorites();
  }, [loadFavorites]);

  const isAnswerVisible = useCallback(
    (questionId: string) => answerOverrides[questionId] ?? answerExpandedByDefault,
    [answerOverrides, answerExpandedByDefault],
  );
  const setAnswerVisible = useCallback((questionId: string, visible: boolean) => {
    setAnswerOverrides((current) => ({ ...current, [questionId]: visible }));
  }, []);
  const handleAnswerAvailability = useCallback((questionId: string, available: boolean) => {
    setAnswerAvailability((current) =>
      current[questionId] === available ? current : { ...current, [questionId]: available },
    );
  }, []);

  const goToPage = useCallback(
    (next: number) => {
      if (!queue || next < 0 || next >= queue.length) return;
      setPageIndex(next);
    },
    [queue],
  );

  const renderQuestion = (questionId: string, active: boolean) => (
    <QuestionPage
      id={questionId}
      metaHint={initialMeta}
      active={active}
      practiceMode={practiceMode}
      showAnswer={isAnswerVisible(questionId)}
      onShowAnswer={() => setAnswerVisible(questionId, true)}
      onAnswerAvailabilityChange={handleAnswerAvailability}
      nav={nav}
    />
  );

  const currentAnswerVisible = isAnswerVisible(currentId);

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
            bankId={bankId}
            questionId={currentId}
            answerVisible={currentAnswerVisible}
            answerAvailable={answerAvailability[currentId] === true}
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
  body: { flex: 1 },
});
