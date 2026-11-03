import { StyleSheet, View } from 'react-native';
import type { QuestionPagerProps } from './QuestionPager';

export const PAGE_WINDOW = 1;

/**
 * Web 预览回退：react-native-pager-view 没有 Web 实现，
 * 这里只渲染当前页，切题完全交给底部操作栏的「上一题/下一题」。
 */
export function QuestionPager({ page, renderPage }: QuestionPagerProps) {
  return (
    <View key={page} style={styles.pager}>
      {renderPage(page)}
    </View>
  );
}

const styles = StyleSheet.create({
  pager: { flex: 1 },
});
