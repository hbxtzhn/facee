import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii, shadows, typography } from '../../theme';

const DOCK_WIDTH = 56;
const DOCK_HEIGHT = 56;
const DOCK_OFFSET_KEY = 'facee.practice-dock-offset.v1';

/**
 * 练习模式悬浮进度容器：单一圆形按钮。
 * - 底部填充层按「当前题 / 总题数」逐渐填满（页面切换时动画过渡）；
 * - 容器内文字显示「1/4」（无队列时显示「答案」）；
 * - 点按 = 查看答案 / 收起答案（答案展开时描边高亮）；
 * - 长按后拖动调整位置（记忆持久化）；
 * - 左右滑动屏幕切题（触摸手势，挂在屏幕根节点上）。
 */
export function PracticeDock({
  currentPage,
  totalPages,
  answerVisible,
  answerAvailable,
  onToggleAnswer,
}: {
  currentPage?: number;
  totalPages?: number;
  answerVisible: boolean;
  answerAvailable: boolean;
  onToggleAnswer: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const dockPosition = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const offsetRef = useRef({ x: 0, y: 0 });
  const dragEnabledRef = useRef(false);
  const dragTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const insetsBottom = insets.bottom;
  const fillValue = useRef(new Animated.Value(0)).current;

  const fillTarget = currentPage !== undefined && totalPages
    ? Math.min(1, currentPage / totalPages)
    : answerVisible
      ? 1
      : 0;

  useEffect(() => {
    Animated.timing(fillValue, {
      toValue: fillTarget,
      duration: 320,
      useNativeDriver: false,
    }).start();
  }, [fillTarget, fillValue]);

  const bounds = useMemo(() => {
    const baseX = width - 16 - DOCK_WIDTH;
    const baseY = height - insetsBottom - 16 - DOCK_HEIGHT;
    return { minX: 8 - baseX, maxX: width - DOCK_WIDTH - 8 - baseX, minY: 8 - baseY, maxY: height - DOCK_HEIGHT - 8 - baseY };
  }, [height, insetsBottom, width]);

  const clamp = useCallback((value: { x: number; y: number }) => ({
    x: Math.min(bounds.maxX, Math.max(bounds.minX, value.x)),
    y: Math.min(bounds.maxY, Math.max(bounds.minY, value.y)),
  }), [bounds]);

  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(DOCK_OFFSET_KEY).then((raw) => {
      if (!active || !raw) return;
      try {
        const saved = clamp(JSON.parse(raw));
        offsetRef.current = saved;
        dockPosition.setValue(saved);
      } catch {
        // Ignore malformed preferences and use the default bottom position.
      }
    });
    return () => { active = false; };
  }, [clamp, dockPosition]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => dragEnabledRef.current,
    onMoveShouldSetPanResponder: () => dragEnabledRef.current,
    onPanResponderGrant: () => { dragStartRef.current = offsetRef.current; },
    onPanResponderMove: (_event, gesture) => { dockPosition.setValue(clamp({ x: dragStartRef.current.x + gesture.dx, y: dragStartRef.current.y + gesture.dy })); },
    onPanResponderRelease: (_event, gesture) => {
      const next = clamp({ x: dragStartRef.current.x + gesture.dx, y: dragStartRef.current.y + gesture.dy });
      offsetRef.current = next;
      dockPosition.setValue(next);
      void AsyncStorage.setItem(DOCK_OFFSET_KEY, JSON.stringify(next));
      dragEnabledRef.current = false;
    },
    onPanResponderTerminate: () => { dragEnabledRef.current = false; dockPosition.setValue(offsetRef.current); },
  }), [clamp, dockPosition]);

  function beginLongPress() {
    dragTimerRef.current = setTimeout(() => { dragEnabledRef.current = true; }, 320);
  }

  function endLongPress() {
    if (dragTimerRef.current) clearTimeout(dragTimerRef.current);
    dragTimerRef.current = null;
    if (!dragEnabledRef.current) return;
    dragEnabledRef.current = false;
  }

  return (
    <Animated.View
      {...panResponder.panHandlers}
      onTouchStart={beginLongPress}
      onTouchEnd={endLongPress}
      onTouchCancel={endLongPress}
      style={[styles.practiceDock, { bottom: insetsBottom + 16 }, dockPosition.getTranslateTransform()]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={answerVisible ? '收起答案' : '查看答案'}
        accessibilityHint={currentPage !== undefined ? `第 ${currentPage} 题，共 ${totalPages ?? '?'} 题；长按后可拖动位置` : '长按后可拖动位置'}
        accessibilityState={{ disabled: !answerAvailable }}
        disabled={!answerAvailable}
        onPress={onToggleAnswer}
        style={({ pressed }) => [styles.practiceDockInner, answerVisible && styles.dockBorderActive, !answerAvailable && styles.dockButtonDisabled, pressed && styles.pressed]}
      >
        <Animated.View style={[styles.dockFillLayer, { height: fillValue.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} pointerEvents="none" />
        <Text style={[styles.dockProgressText, answerVisible && styles.dockProgressTextActive]}>
          {currentPage !== undefined && totalPages ? `${currentPage}/${totalPages}` : '答案'}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  practiceDock: {
    position: 'absolute',
    right: 16,
    width: DOCK_WIDTH,
    height: DOCK_HEIGHT,
  },
  practiceDockInner: {
    width: '100%',
    height: '100%',
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    overflow: 'hidden',
    ...shadows.lifted,
  },
  dockBorderActive: { borderColor: colors.primary },
  /** 底部填充层：高度按队列进度动画增长（JS 驱动，56px 小元素开销可忽略） */
  dockFillLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.primarySoft,
  },
  dockProgressText: {
    ...typography.label,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  dockProgressTextActive: { color: colors.primary },
  dockButtonDisabled: { opacity: 0.3 },
  pressed: { opacity: 0.75 },
});
