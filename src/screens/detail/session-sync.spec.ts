import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { usePracticeSessionStore } from '../../store/practiceSessionStore';
import { syncPracticeIndex } from './session-sync';

describe('syncPracticeIndex', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('以 (bankId, index) 调用 practiceSessionStore.updateIndex', () => {
    const updateIndex = jest.fn();
    jest.spyOn(usePracticeSessionStore, 'getState').mockReturnValue({
      ...usePracticeSessionStore.getState(),
      updateIndex,
    });
    syncPracticeIndex('bank-a', 3);
    expect(updateIndex).toHaveBeenCalledWith('bank-a', 3);
  });

  it('store 抛错时吞掉异常，不影响翻页', () => {
    jest.spyOn(usePracticeSessionStore, 'getState').mockImplementation(() => {
      throw new Error('boom');
    });
    expect(() => syncPracticeIndex('bank-a', 1)).not.toThrow();
  });

  it('真实 store：有会话时更新下标', () => {
    usePracticeSessionStore.getState().saveSession('bank-real', { queue: ['a', 'b', 'c'], index: 0, mode: 'practice' });
    syncPracticeIndex('bank-real', 2);
    expect(usePracticeSessionStore.getState().getSession('bank-real')?.index).toBe(2);
  });
});
