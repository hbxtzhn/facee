import { Pressable, StyleSheet, Text } from 'react-native';
import {
  READING_SCALE_LABELS,
  nextReadingScale,
  useUserStore,
} from '../../store/userStore';
import { colors, spacing } from '../../theme';

/**
 * 详情页头部右侧的「Aa」字号开关：点按循环 标准 → 大 → 特大 → 标准，
 * 选择写入 userStore.readingScale 并持久化；题干 / 答案 / 追问的 Markdown 跟随放大。
 * 「A」的大小随档位微调，给出当前档位的视觉提示。
 */
export function ReadingScaleButton() {
  const scale = useUserStore((state) => state.readingScale);
  const setReadingScale = useUserStore((state) => state.setReadingScale);
  const label = READING_SCALE_LABELS[scale];
  const nextLabel = READING_SCALE_LABELS[nextReadingScale(scale)];

  return (
    <Pressable
      testID="reading-scale-button"
      accessibilityRole="button"
      accessibilityLabel={`阅读字号：${label}`}
      accessibilityHint={`点按切换为${nextLabel}`}
      hitSlop={8}
      onPress={() => setReadingScale(nextReadingScale(scale))}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Text style={styles.small}>A</Text>
      <Text style={[styles.large, { fontSize: Math.round(17 * scale) }]}>a</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'baseline',
    minWidth: 40,
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
    paddingTop: 8,
  },
  small: { fontSize: 14, color: colors.textSecondary, fontWeight: '500' },
  large: { color: colors.text, fontWeight: '600', marginLeft: 1 },
  pressed: { opacity: 0.6 },
});
