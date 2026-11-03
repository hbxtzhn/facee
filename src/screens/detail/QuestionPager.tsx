import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import PagerView from 'react-native-pager-view';

export interface QuestionPagerProps {
  /** 当前页（受控）：底栏「上一题/下一题」改它，原生滑动经 onPageChange 回写 */
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  /** 只对 当前页 ±1 调用；其余页渲染空占位，保证长队列也轻量 */
  renderPage: (index: number) => ReactNode;
}

/** 题目渲染窗口：当前页前后各 1 页 */
export const PAGE_WINDOW = 1;

/**
 * 原生分页容器（Android ViewPager2 / iOS UIPageViewController）。
 * 滑动跟手、惯性与页吸附都在原生线程完成，JS 只在「选中页变化」时收到一次事件。
 *
 * 受控同步：selectedRef 记录原生侧当前页，
 * - 外部改 page（按钮切题）⇒ setPage 动画滚过去，随后原生回调的同页事件被忽略；
 * - 原生滑动选中新页 ⇒ 先写 selectedRef 再上报，避免 effect 反向再 setPage 一次。
 */
export function QuestionPager({ page, pageCount, onPageChange, renderPage }: QuestionPagerProps) {
  const pagerRef = useRef<PagerView>(null);
  const selectedRef = useRef(page);

  useEffect(() => {
    if (selectedRef.current === page) return;
    selectedRef.current = page;
    pagerRef.current?.setPage(page);
  }, [page]);

  const handlePageSelected = useCallback(
    (event: { nativeEvent: { position: number } }) => {
      const next = event.nativeEvent.position;
      if (next === selectedRef.current) return;
      selectedRef.current = next;
      onPageChange(next);
    },
    [onPageChange],
  );

  const pages: ReactNode[] = [];
  for (let index = 0; index < pageCount; index += 1) {
    const inWindow = Math.abs(index - page) <= PAGE_WINDOW;
    pages.push(
      <View key={index} style={styles.page} collapsable={false}>
        {inWindow ? renderPage(index) : null}
      </View>,
    );
  }

  return (
    <PagerView
      ref={pagerRef}
      testID="question-pager"
      style={styles.pager}
      initialPage={page}
      offscreenPageLimit={PAGE_WINDOW}
      keyboardDismissMode="on-drag"
      onPageSelected={handlePageSelected}
    >
      {pages}
    </PagerView>
  );
}

const styles = StyleSheet.create({
  pager: { flex: 1 },
  page: { flex: 1 },
});
