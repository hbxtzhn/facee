import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

export const colors = {
  // 基础底色：柔和温润的米白纸感，降低长时间刷题疲劳
  background: '#F9F9F6',
  surface: '#FCFCFA',
  surfaceSubtle: '#F4F4F0',
  surfaceMuted: '#EFEFEA',
  surfaceWarm: '#F7F6F1',

  // 字体颜色：避免 #000000 刺眼对比，采用阅读级碳墨黑与多级柔和灰
  text: '#1C1E21',
  textSecondary: '#4A5056',
  textMuted: '#6C737C',
  textSubtle: '#9AA1A9',

  // 主题色与强调色：洗练的深石墨黑与雅致灰
  primary: '#1F2428',
  primaryPressed: '#343A40',
  primarySoft: '#EAEAE4',
  primaryMuted: '#F1F1EB',
  accent: '#2D3748',

  // 边框与分割线：更精细轻盈的线条（borderSoft 用于卡片描边，配合阴影弱化「框感」）
  border: '#E8E8E2',
  borderSoft: '#EFEFEA',
  borderStrong: '#D6D6CC',
  borderWarm: '#DEDECF',

  // 语义色：更现代克制的警示、成功与标签色彩
  success: '#2E7D32',
  successSoft: '#EDF7ED',
  warning: '#D97706',
  warningSoft: '#FEF3C7',
  danger: '#C53030',
  dangerSoft: '#FEE2E2',

  // 辅助
  white: '#FFFFFF',
  overlay: 'rgba(15, 20, 25, 0.4)',
  /** 行内代码前景色：在灰底上与正文拉开区分度 */
  code: '#2B58DB',
} as const;

export const difficultyStyles = {
  // 极简阅读风：只用低饱和文字色区分，不铺底色块
  1: { label: '简单', text: '#4F7A55', background: 'transparent' },
  2: { label: '中等', text: '#9A6B2F', background: 'transparent' },
  3: { label: '困难', text: '#A24A43', background: 'transparent' },
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  xxxl: 36,
} as const;

export const radii = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

export const typography = {
  display: {
    fontSize: 28,
    lineHeight: 36,
    fontWeight: '700',
    letterSpacing: -0.5,
  } satisfies TextStyle,
  title: {
    fontSize: 22,
    lineHeight: 30,
    fontWeight: '700',
    letterSpacing: -0.2,
  } satisfies TextStyle,
  heading: {
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '600',
  } satisfies TextStyle,
  body: {
    fontSize: 15,
    lineHeight: 24,
    fontWeight: '400',
  } satisfies TextStyle,
  bodyStrong: {
    fontSize: 15,
    lineHeight: 24,
    fontWeight: '600',
  } satisfies TextStyle,
  label: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  } satisfies TextStyle,
  caption: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '400',
  } satisfies TextStyle,
  /** 阅读正文（题干 / 答案 Markdown）：更大字号与行高，适合长时间阅读 */
  reading: {
    fontSize: 17,
    lineHeight: 30,
    fontWeight: '400',
  } satisfies TextStyle,
  /** 阅读页题目标题 */
  readingTitle: {
    fontSize: 22,
    lineHeight: 32,
    fontWeight: '600',
    letterSpacing: -0.2,
  } satisfies TextStyle,
  /** 分区眉题：小号、加字距、弱化颜色，替代胶囊徽标 */
  eyebrow: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    letterSpacing: 1,
  } satisfies TextStyle,
} as const;

/** 阅读版心：正文最大宽度与页面左右留白（平板/横屏时居中） */
export const layout = {
  readingMaxWidth: 680,
  pagePadding: 20,
} as const;

/** 等宽字体（App.tsx 启动时经 expo-font 注册；加载失败时 RN 回退系统字体） */
export const fontFamily = {
  mono: 'JetBrainsMono',
} as const;

/**
 * 卡片阴影：极淡漫反射投影，让卡片自然「浮」起。
 * shadow* 系列在 iOS/Web 生效，elevation 在 Android 近似同观感。
 */
export const shadows = {
  // 极简阅读风：去掉投影，层次只靠留白与细分割线
  card: {},
  lifted: {
    shadowColor: '#1C1E21',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
} satisfies Record<string, ViewStyle>;

/** 卡片基础外观（极简阅读风）：纸面同色 + 发丝描边、无阴影；圆角与内边距由使用处覆盖 */
export const cardChrome: ViewStyle = {
  backgroundColor: colors.surface,
  borderWidth: StyleSheet.hairlineWidth,
  borderColor: colors.borderStrong,
};

/** 统一按压态：轻微缩放 + 降透明，替代纯 opacity 的生硬反馈 */
export const pressedScale: ViewStyle = {
  opacity: 0.85,
  transform: [{ scale: 0.985 }],
};

/** 分类图标盒的「底色 + 前景色」。按 id 哈希取色的调用方式保留，极简阅读风下只有一组中性色。 */
export const tints = [
  // 极简阅读风：分类不再用彩色色块，统一中性墨色；保留数组形态兼容按 id 轮换
  { bg: '#F1F1EC', fg: '#4A5056' },
] as const;

export const navigationTheme = {
  dark: false,
  colors: {
    primary: colors.primary,
    background: colors.background,
    card: colors.background,
    text: colors.text,
    border: colors.border,
    notification: colors.accent,
  },
  fonts: {
    regular: { fontFamily: 'System', fontWeight: '400' as const },
    medium: { fontFamily: 'System', fontWeight: '500' as const },
    bold: { fontFamily: 'System', fontWeight: '700' as const },
    heavy: { fontFamily: 'System', fontWeight: '800' as const },
  },
};
