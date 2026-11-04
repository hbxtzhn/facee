import { beforeEach, describe, expect, it } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  PRACTICE_SESSION_STORAGE_KEY,
  flushPracticeSessionPersist,
  resolveSessionQueue,
  usePracticeSessionStore,
} from './practiceSessionStore';

const store = () => usePracticeSessionStore.getState();

async function persisted() {
  await flushPracticeSessionPersist();
  const raw = await AsyncStorage.getItem(PRACTICE_SESSION_STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

describe('practiceSessionStore', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    usePracticeSessionStore.setState({ sessions: {} });
  });

  it('saveSession 按题库保存会话并持久化，getSession 读回', async () => {
    store().saveSession('bank-a', { queue: ['q1', 'q2', 'q3'], index: 1, mode: 'practice', title: 'Java' });

    const session = store().getSession('bank-a');
    expect(session).toEqual(
      expect.objectContaining({ queue: ['q1', 'q2', 'q3'], index: 1, mode: 'practice', title: 'Java' }),
    );
    expect(typeof session?.updatedAt).toBe('number');
    expect(store().getSession('bank-b')).toBeNull();

    const saved = await persisted();
    expect(saved.sessions['bank-a'].queue).toEqual(['q1', 'q2', 'q3']);
  });

  it('不同题库的会话互不覆盖', () => {
    store().saveSession('bank-a', { queue: ['a1'], index: 0, mode: 'practice' });
    store().saveSession('bank-b', { queue: ['b1', 'b2'], index: 1, mode: 'review' });

    expect(store().getSession('bank-a')?.queue).toEqual(['a1']);
    expect(store().getSession('bank-b')).toEqual(expect.objectContaining({ index: 1, mode: 'review' }));
  });

  it('空队列不保存；越界下标被夹到队列范围内', () => {
    store().saveSession('bank-a', { queue: [], index: 0, mode: 'practice' });
    expect(store().getSession('bank-a')).toBeNull();

    store().saveSession('bank-a', { queue: ['q1', 'q2'], index: 9, mode: 'practice' });
    expect(store().getSession('bank-a')?.index).toBe(1);
  });

  it('updateIndex 推进下标并持久化；无会话时静默忽略', async () => {
    store().updateIndex('bank-a', 2);
    expect(store().getSession('bank-a')).toBeNull();

    store().saveSession('bank-a', { queue: ['q1', 'q2', 'q3'], index: 0, mode: 'practice' });
    store().updateIndex('bank-a', 2);
    expect(store().getSession('bank-a')?.index).toBe(2);
    expect((await persisted()).sessions['bank-a'].index).toBe(2);

    store().updateIndex('bank-a', 99);
    expect(store().getSession('bank-a')?.index).toBe(2);
    store().updateIndex('bank-a', -3);
    expect(store().getSession('bank-a')?.index).toBe(0);
  });

  it('load 从持久化恢复，并丢弃损坏条目', async () => {
    await AsyncStorage.setItem(
      PRACTICE_SESSION_STORAGE_KEY,
      JSON.stringify({
        sessions: {
          'bank-a': { queue: ['q1', 'q2'], index: 1, mode: 'review', title: '今日复习', updatedAt: 10 },
          broken: { queue: 'nope' },
        },
      }),
    );
    await store().load();

    expect(store().getSession('bank-a')).toEqual({
      queue: ['q1', 'q2'],
      index: 1,
      mode: 'review',
      title: '今日复习',
      updatedAt: 10,
    });
    expect(store().getSession('broken')).toBeNull();
  });

  it('load 与内存会话合并：更新的一方胜出', async () => {
    await AsyncStorage.setItem(
      PRACTICE_SESSION_STORAGE_KEY,
      JSON.stringify({
        sessions: {
          'bank-a': { queue: ['old'], index: 0, mode: 'practice', updatedAt: 1 },
          'bank-b': { queue: ['b1'], index: 0, mode: 'practice', updatedAt: 1 },
        },
      }),
    );
    store().saveSession('bank-a', { queue: ['new'], index: 0, mode: 'practice', updatedAt: 5 });
    await store().load();

    expect(store().getSession('bank-a')?.queue).toEqual(['new']);
    expect(store().getSession('bank-b')?.queue).toEqual(['b1']);
  });

  it('load 读到坏 JSON 时保留内存态', async () => {
    store().saveSession('bank-a', { queue: ['q1'], index: 0, mode: 'practice' });
    await AsyncStorage.setItem(PRACTICE_SESSION_STORAGE_KEY, '{oops');
    await store().load();
    expect(store().getSession('bank-a')?.queue).toEqual(['q1']);
  });
});

describe('resolveSessionQueue', () => {
  const session = { queue: ['q1', 'q2', 'q3', 'q4'], index: 2, mode: 'practice' as const, updatedAt: 0 };

  it('题都在时原样返回', () => {
    expect(resolveSessionQueue(session, new Set(['q1', 'q2', 'q3', 'q4']))).toEqual({
      queue: ['q1', 'q2', 'q3', 'q4'],
      index: 2,
    });
  });

  it('剔除已删除的题；当前题被删时落到其后第一道仍存在的题', () => {
    expect(resolveSessionQueue(session, new Set(['q1', 'q4']))).toEqual({ queue: ['q1', 'q4'], index: 1 });
    expect(resolveSessionQueue(session, new Set(['q2', 'q3']))).toEqual({ queue: ['q2', 'q3'], index: 1 });
  });

  it('当前位置之后都没了时落到最后一道', () => {
    expect(resolveSessionQueue(session, new Set(['q1', 'q2']))).toEqual({ queue: ['q1', 'q2'], index: 1 });
  });

  it('全部失效返回 null', () => {
    expect(resolveSessionQueue(session, new Set(['x']))).toBeNull();
  });
});
