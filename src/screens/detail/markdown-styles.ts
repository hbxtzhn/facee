import { StyleSheet } from 'react-native';
import { colors, fontFamily, radii, spacing, typography } from '../../theme';

/**
 * 题干 / 答案正文共用的 Markdown 样式（极简阅读风）：
 * - 正文用 typography.reading（17/30），标题只比正文略大、靠字重区分，不抢视线；
 * - 代码块：surfaceSubtle 浅底、无描边无阴影、等宽字体、留足内边距；
 * - 引用：一条细左线 + 次级文字色，不铺底；
 * - 表格：发丝线边框，表头只加粗不铺色。
 *
 * scale 来自 userStore.readingScale（标准 1 / 大 1.15 / 特大 1.3），字号与行高同比放大。
 */

const cache = new Map<number, ReturnType<typeof buildMarkdownStyles>>();

/** 按字号倍率取样式（同一倍率复用同一对象，避免 Markdown 每次渲染都重建样式表） */
export function createMarkdownStyles(scale = 1) {
  let styles = cache.get(scale);
  if (!styles) {
    styles = buildMarkdownStyles(scale);
    cache.set(scale, styles);
  }
  return styles;
}

function buildMarkdownStyles(scale: number) {
  const size = (value: number) => Math.round(value * scale);
  const codeBlock = {
    fontFamily: fontFamily.mono,
    color: colors.text,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 0,
    borderRadius: radii.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: size(14),
    lineHeight: size(23),
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  };
  return {
    body: {
      ...typography.reading,
      fontSize: size(typography.reading.fontSize),
      lineHeight: size(typography.reading.lineHeight),
      color: colors.text,
    },
    paragraph: { marginTop: 0, marginBottom: spacing.lg },
    heading1: {
      fontSize: size(20),
      lineHeight: size(30),
      fontWeight: '600' as const,
      color: colors.text,
      marginTop: spacing.xl,
      marginBottom: spacing.sm,
    },
    heading2: {
      fontSize: size(18),
      lineHeight: size(28),
      fontWeight: '600' as const,
      color: colors.text,
      marginTop: spacing.xl,
      marginBottom: spacing.sm,
    },
    heading3: {
      fontSize: size(17),
      lineHeight: size(26),
      fontWeight: '600' as const,
      color: colors.text,
      marginTop: spacing.lg,
      marginBottom: spacing.xs,
    },
    heading4: {
      fontSize: size(16),
      lineHeight: size(24),
      fontWeight: '600' as const,
      color: colors.textSecondary,
      marginTop: spacing.md,
      marginBottom: spacing.xs,
    },
    strong: { fontWeight: '600' as const },
    bullet_list: { marginBottom: spacing.lg },
    ordered_list: { marginBottom: spacing.lg },
    list_item: { marginBottom: spacing.xs },
    blockquote: {
      backgroundColor: 'transparent',
      borderLeftColor: colors.borderStrong,
      borderLeftWidth: 2,
      paddingLeft: spacing.md,
      paddingRight: 0,
      paddingVertical: 0,
      marginLeft: 0,
      marginBottom: spacing.lg,
      opacity: 0.9,
    },
    code_inline: {
      fontFamily: fontFamily.mono,
      color: colors.code,
      backgroundColor: colors.surfaceSubtle,
      borderRadius: radii.xs,
      borderWidth: 0,
      paddingHorizontal: 4,
      fontSize: size(14),
    },
    code_block: codeBlock,
    fence: codeBlock,
    hr: { backgroundColor: colors.border, height: StyleSheet.hairlineWidth, marginVertical: spacing.xl },
    // 表格：发丝线外框 + 行分隔，表头只加粗
    table: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderStrong,
      borderRadius: 0,
      alignSelf: 'stretch' as const,
      marginBottom: spacing.lg,
    },
    thead: { backgroundColor: 'transparent' },
    tbody: {},
    th: { flex: 1, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
    tr: {
      flexDirection: 'row' as const,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    td: { flex: 1, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
    tableHeaderText: { fontWeight: '600' as const, fontSize: size(14), color: colors.text },
    image: {
      backgroundColor: colors.surfaceSubtle,
      borderRadius: radii.xs,
    },
  };
}

/** 标准字号样式（兼容旧引用；表头 rule 也用它的 tableHeaderText 字重） */
export const markdownStyles = createMarkdownStyles(1);

/** 追问展开内容：比正文小一档，保持安静 */
export function createFollowUpMarkdownStyles(scale = 1) {
  return createMarkdownStyles(Math.round(scale * 0.94 * 100) / 100);
}
