import { View } from 'react-native';

/**
 * 测试环境下的图标替身。
 *
 * lucide-react-native 只发 ESM（`dist/esm/*.mjs`），而 jest 的 transform 默认不处理 .mjs，
 * 于是任何 import 图标的组件都直接解析失败。图标是第三方装饰件，测试里不需要真实渲染，
 * 用一个渲染空 View 的 Proxy 顶掉即可（用到的 accessibilityLabel 都在外层 Pressable 上，
 * 不受影响）。
 */
const IconStub = (props: Record<string, unknown>) => <View {...props} />;

const icons = new Proxy(
  {},
  {
    get: () => IconStub,
  },
);

module.exports = icons;
module.exports.default = icons;
