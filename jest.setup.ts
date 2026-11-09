// User progress and favorites persist in AsyncStorage; tests use an in-memory adapter.
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    getItem: jest.fn((k: string) => Promise.resolve(store.get(k) ?? null)),
    setItem: jest.fn((k: string, v: string) => {
      store.set(k, v);
      return Promise.resolve();
    }),
    removeItem: jest.fn((k: string) => {
      store.delete(k);
      return Promise.resolve();
    }),
    clear: jest.fn(() => {
      store.clear();
      return Promise.resolve();
    }),
    getAllKeys: jest.fn(() => Promise.resolve(Array.from(store.keys()))),
  };
});

// react-native-pager-view 是原生组件（Fabric），jest 下替换成普通 View：
// - 子页照常渲染，测试可直接断言当前 ±1 窗口内的内容；
// - setPage 同步回调 onPageSelected，模拟原生选中页事件；
// - 原生滑动可在测试里用 fireEvent(pager, 'pageSelected', { nativeEvent: { position } }) 模拟。
jest.mock('react-native-pager-view', () => {
  const React = require('react');
  const { View } = require('react-native');
  class MockPagerView extends React.Component<any> {
    setPage = (page: number) => this.props.onPageSelected?.({ nativeEvent: { position: page } });
    setPageWithoutAnimation = (page: number) => this.setPage(page);
    setScrollEnabled = () => undefined;
    render() {
      return React.createElement(View, this.props, this.props.children);
    }
  }
  return { __esModule: true, default: MockPagerView, PagerView: MockPagerView };
});
