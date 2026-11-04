import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { useMasteryStore, type Mastery } from './masteryStore';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'facee-mastery-state.v2';
const LEGACY_STORAGE_KEY = 'facee-mastery-state.v1';

const INITIAL = { marks: {}, markedAt: {}, knownStreaks: {} };

async function flushPersist(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('useMasteryStore - 打标与清除', () => {
  beforeEach(async () => {
    await flushPersist();
    await AsyncStorage.clear();
    useMasteryStore.setState({ ...INITIAL });
  });

  it('打标后可读，覆盖旧值，清除（null）后回到未打标', () => {
    const store = useMasteryStore.getState();
    store.setMark('bank-a', 'q1', 'unknown');
    expect(useMasteryStore.getState().getMark('bank-a', 'q1')).toBe('unknown');

    useMasteryStore.getState().setMark('bank-a', 'q1', 'known');
    expect(useMasteryStore.getState().getMark('bank-a', 'q1')).toBe('known');

    useMasteryStore.getState().setMark('bank-a', 'q1', null);
    expect(useMasteryStore.getState().getMark('bank-a', 'q1')).toBeNull();
  });

  it('「不会」与「未打标」严格区分', () => {
    useMasteryStore.getState().setMark('bank-a', 'q1', 'unknown');
    expect(useMasteryStore.getState().getMark('bank-a', 'q1')).toBe('unknown');
    // 未打标的题返回 null，而不是 unknown
    expect(useMasteryStore.getState().getMark('bank-a', 'q2')).toBeNull();
  });

  it('同一 questionId 在不同题库（命名空间）互不影响', () => {
    useMasteryStore.getState().setMark('bank-a', 'q1', 'known');
    useMasteryStore.getState().setMark('bank-b', 'q1', 'unknown');

    expect(useMasteryStore.getState().getMark('bank-a', 'q1')).toBe('known');
    expect(useMasteryStore.getState().getMark('bank-b', 'q1')).toBe('unknown');
  });

  it('清空一个题库的全部标记后，空的命名空间被回收', () => {
    useMasteryStore.getState().setMark('bank-a', 'q1', 'known');
    useMasteryStore.getState().setMark('bank-a', 'q2', 'fuzzy');
    useMasteryStore.getState().setMark('bank-b', 'q1', 'known');

    useMasteryStore.getState().setMark('bank-a', 'q1', null);
    useMasteryStore.getState().setMark('bank-a', 'q2', null);

    const marks = useMasteryStore.getState().marks;
    expect(marks['bank-a']).toBeUndefined();
    expect(marks['bank-b']).toBeDefined();
  });

  it('打标同步记录时间戳，清除时一并移除', () => {
    const before = Date.now();
    useMasteryStore.getState().setMark('bank-a', 'q1', 'fuzzy');
    const at = useMasteryStore.getState().markedAt['bank-a']?.['q1'];
    expect(typeof at).toBe('number');
    expect(at!).toBeGreaterThanOrEqual(before);
    expect(at!).toBeLessThanOrEqual(Date.now());

    useMasteryStore.getState().setMark('bank-a', 'q1', null);
    expect(useMasteryStore.getState().markedAt['bank-a']).toBeUndefined();
  });

  it('重新打标刷新时间戳', async () => {
    useMasteryStore.getState().setMark('bank-a', 'q1', 'fuzzy');
    const firstAt = useMasteryStore.getState().markedAt['bank-a']!['q1'];
    await new Promise((resolve) => setTimeout(resolve, 5));
    useMasteryStore.getState().setMark('bank-a', 'q1', 'known');
    expect(useMasteryStore.getState().markedAt['bank-a']!['q1']).toBeGreaterThanOrEqual(firstAt + 5);
  });

  it('状态变更异步落盘（含时间戳），可从 AsyncStorage 恢复', async () => {
    useMasteryStore.getState().setMark('bank-a', 'q1', 'fuzzy');
    await flushPersist();

    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const persisted = JSON.parse(raw ?? '{}') as { marks: unknown; markedAt: unknown };
    expect(persisted.marks).toEqual({ 'bank-a': { q1: 'fuzzy' } });
    expect(typeof (persisted.markedAt as Record<string, Record<string, number>>)['bank-a']?.q1).toBe('number');

    useMasteryStore.setState({ ...INITIAL });
    await useMasteryStore.getState().load();
    expect(useMasteryStore.getState().getMark('bank-a', 'q1')).toBe('fuzzy');
    expect(useMasteryStore.getState().markedAt['bank-a']?.q1).toBeDefined();
  });

  it('v1 存量迁移：marks 保留、时间戳按迁移时刻计，且不立刻到期', async () => {
    await AsyncStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({ marks: { 'bank-a': { q1: 'known', q2: 'unknown' } } }));

    const before = Date.now();
    await useMasteryStore.getState().load();
    const state = useMasteryStore.getState();

    expect(state.getMark('bank-a', 'q1')).toBe('known');
    expect(state.getMark('bank-a', 'q2')).toBe('unknown');
    const at = state.markedAt['bank-a']!;
    expect(at.q1).toBeGreaterThanOrEqual(before);
    expect(at.q2).toBe(at.q1);

    // 迁移时刻起算 ⇒ 1 天内的 now 不会让任何题到期
    expect(at.q1 - before).toBeLessThan(24 * 60 * 60 * 1000);
  });

  it('v2 载荷损坏时回退 v1 存量迁移，不静默清空（v1 可能是最后副本）', async () => {
    await AsyncStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({ marks: { 'bank-a': { q1: 'fuzzy' } } }));
    await AsyncStorage.setItem(STORAGE_KEY, '{corrupted-payload');

    await useMasteryStore.getState().load();
    const state = useMasteryStore.getState();
    expect(state.getMark('bank-a', 'q1')).toBe('fuzzy');
    expect(state.markedAt['bank-a']?.q1).toBeDefined();

    // 重新迁移的健康载荷应已覆盖损坏的 v2
    await flushPersist();
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(() => JSON.parse(raw!)).not.toThrow();
  });

  it('markedAt 孤儿条目（无对应 marks 记录）被修剪，非法时间戳丢弃', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        marks: { 'bank-a': { q1: 'known', q2: 'hacked' } },
        markedAt: { 'bank-a': { q1: 12345, q2: 99999, q3: 1 } }, // q3 无 marks 记录，应丢弃
      }),
    );
    await useMasteryStore.getState().load();

    const state = useMasteryStore.getState();
    expect(state.getMark('bank-a', 'q1')).toBe('known');
    expect(state.getMark('bank-a', 'q2')).toBeNull();
    expect(state.markedAt['bank-a']).toEqual({ q1: 12345 });
  });

  it('持久化数据损坏或含非法值时按条目丢弃，不整体崩溃', async () => {
    const broken = JSON.stringify({
      marks: {
        'bank-a': { q1: 'known', q2: 'hacked', q3: '' },
        '': { q9: 'known' },
        'bank-b': 'not-a-record',
      },
    });
    await AsyncStorage.setItem(STORAGE_KEY, broken);

    await useMasteryStore.getState().load();
    const state = useMasteryStore.getState();
    expect(state.getMark('bank-a', 'q1')).toBe('known');
    expect(state.getMark('bank-a', 'q2')).toBeNull();
    expect(state.getMark('bank-a', 'q3')).toBeNull();
    expect(state.getMark('bank-b', 'q9')).toBeNull();
  });

  it('持久化内容不是合法 JSON 时保持内存默认值', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, '{not-json');
    await useMasteryStore.getState().load();
    expect(useMasteryStore.getState().marks).toEqual({});
    expect(useMasteryStore.getState().markedAt).toEqual({});
  });

  it('连续「会了」：首次 1，到期复习 +1，未到期重复确认不变，不会/模糊/清除清零', () => {
    const DAY = 24 * 60 * 60 * 1000;
    let now = 1_800_000_000_000;
    const spy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const streak = () => useMasteryStore.getState().knownStreaks['bank-a']?.q1;
      useMasteryStore.getState().setMark('bank-a', 'q1', 'known');
      expect(streak()).toBe(1);

      now += 3 * DAY; // 未到 7 天：重复确认不扩张
      useMasteryStore.getState().setMark('bank-a', 'q1', 'known');
      expect(streak()).toBe(1);

      now += 7 * DAY; // 到期复习 ⇒ 第 2 档（14 天）
      useMasteryStore.getState().setMark('bank-a', 'q1', 'known');
      expect(streak()).toBe(2);
      now += 14 * DAY;
      useMasteryStore.getState().setMark('bank-a', 'q1', 'known');
      expect(streak()).toBe(3);

      useMasteryStore.getState().setMark('bank-a', 'q1', 'fuzzy');
      expect(streak()).toBeUndefined();
      expect(useMasteryStore.getState().knownStreaks['bank-a']).toBeUndefined();

      useMasteryStore.getState().setMark('bank-a', 'q1', 'known');
      expect(streak()).toBe(1);
      useMasteryStore.getState().setMark('bank-a', 'q1', null);
      expect(useMasteryStore.getState().knownStreaks).toEqual({});
    } finally {
      spy.mockRestore();
    }
  });

  it('连续次数随 v2 载荷落盘并恢复', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        marks: { 'bank-a': { q1: 'known' } },
        markedAt: { 'bank-a': { q1: 100 } },
        knownStreaks: { 'bank-a': { q1: 3 } },
      }),
    );
    await useMasteryStore.getState().load();
    expect(useMasteryStore.getState().knownStreaks).toEqual({ 'bank-a': { q1: 3 } });

    useMasteryStore.getState().setMark('bank-a', 'q2', 'known');
    await flushPersist();
    const persisted = JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) ?? '{}');
    expect(persisted.knownStreaks).toEqual({ 'bank-a': { q1: 3, q2: 1 } });
  });

  it('升级前的 v2 载荷（无 knownStreaks）：known 补 1，其余档不记，排期不变', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        marks: { 'bank-a': { q1: 'known', q2: 'fuzzy' }, 'bank-b': { q9: 'unknown' } },
        markedAt: { 'bank-a': { q1: 100, q2: 200 }, 'bank-b': { q9: 300 } },
      }),
    );
    await useMasteryStore.getState().load();
    const state = useMasteryStore.getState();
    expect(state.getMark('bank-a', 'q1')).toBe('known');
    expect(state.markedAt['bank-a']).toEqual({ q1: 100, q2: 200 });
    expect(state.knownStreaks).toEqual({ 'bank-a': { q1: 1 } });
  });

  it('v1 迁移同样为 known 补上连续次数 1', async () => {
    await AsyncStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({ marks: { 'bank-a': { q1: 'known', q2: 'unknown' } } }));
    await useMasteryStore.getState().load();
    expect(useMasteryStore.getState().knownStreaks).toEqual({ 'bank-a': { q1: 1 } });
    await flushPersist();
    const persisted = JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) ?? '{}');
    expect(persisted.knownStreaks).toEqual({ 'bank-a': { q1: 1 } });
  });

  it('非法连续次数回落为 1，非 known / 孤儿条目丢弃', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        marks: { 'bank-a': { q1: 'known', q2: 'known', q3: 'fuzzy' } },
        markedAt: { 'bank-a': { q1: 1, q2: 1, q3: 1 } },
        knownStreaks: { 'bank-a': { q1: -2, q2: 'x', q3: 4, q4: 2 }, 'bank-z': { q1: 2 } },
      }),
    );
    await useMasteryStore.getState().load();
    expect(useMasteryStore.getState().knownStreaks).toEqual({ 'bank-a': { q1: 1, q2: 1 } });
  });

  it('Mastery 三态取值 closed set', () => {
    const all: Mastery[] = ['unknown', 'fuzzy', 'known'];
    expect(all).toHaveLength(3);
  });
});
