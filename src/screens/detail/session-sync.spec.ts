import { describe, it, expect, jest, afterEach } from '@jest/globals';

/**
 * session-sync 的守卫式 require：practiceSessionStore 合入前是 no-op，合入后转调 updateIndex。
 * TODO(merge): 改为直接 import 后，这里改为直接 mock 真实模块即可。
 */
describe('syncPracticeIndex', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('../../store/practiceSessionStore');
  });

  it('practiceSessionStore 存在时以 (bankId, index) 调用 updateIndex', () => {
    const updateIndex = jest.fn();
    jest.doMock(
      '../../store/practiceSessionStore',
      () => ({ usePracticeSessionStore: { getState: () => ({ updateIndex }) } }),
      { virtual: true },
    );
    jest.isolateModules(() => {
      const { syncPracticeIndex } = require('./session-sync') as typeof import('./session-sync');
      syncPracticeIndex('bank-a', 3);
    });
    expect(updateIndex).toHaveBeenCalledWith('bank-a', 3);
  });

  it('store 抛错时吞掉异常，不影响翻页', () => {
    jest.doMock(
      '../../store/practiceSessionStore',
      () => ({
        usePracticeSessionStore: {
          getState: () => ({
            updateIndex: () => {
              throw new Error('boom');
            },
          }),
        },
      }),
      { virtual: true },
    );
    jest.isolateModules(() => {
      const { syncPracticeIndex } = require('./session-sync') as typeof import('./session-sync');
      expect(() => syncPracticeIndex('bank-a', 1)).not.toThrow();
    });
  });

  it('未 mock 时（本基线模块不存在）调用不抛错', () => {
    jest.isolateModules(() => {
      const { syncPracticeIndex } = require('./session-sync') as typeof import('./session-sync');
      expect(() => syncPracticeIndex('bank-a', 0)).not.toThrow();
    });
  });

  it('模块形状不符时静默 no-op', () => {
    jest.doMock('../../store/practiceSessionStore', () => ({}), { virtual: true });
    jest.isolateModules(() => {
      const { syncPracticeIndex } = require('./session-sync') as typeof import('./session-sync');
      expect(() => syncPracticeIndex('bank-a', 0)).not.toThrow();
    });
  });
});
