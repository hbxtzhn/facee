import { describe, it, expect, beforeEach } from '@jest/globals';
import { READING_SCALES, READING_SCALE_LABELS, nextReadingScale, useUserStore } from './userStore';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'facee-user-state';

const INITIAL = {
  totalCount: 0,
  viewedQuestionIds: [] as string[],
  hasPromptedRule: false,
  lastViewedQuestionId: null,
  answerExpandedByDefault: false,
  readingScale: 1 as const,
};

async function flushPersist(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('useUserStore - 刷题总数（不按天统计）', () => {
  beforeEach(async () => {
    await flushPersist();
    await AsyncStorage.clear();
    useUserStore.setState({ ...INITIAL });
  });

  it('同一道题重复打开只计一次总数', () => {
    useUserStore.getState().recordView('q1');
    expect(useUserStore.getState().totalCount).toBe(1);

    useUserStore.getState().recordView('q1');
    useUserStore.getState().recordView('q1');

    const state = useUserStore.getState();
    expect(state.totalCount).toBe(1);
    expect(state.viewedQuestionIds).toEqual(['q1']);
  });

  it('不同题目各计一次', () => {
    for (let i = 1; i <= 10; i += 1) {
      useUserStore.getState().recordView(`q${i}`);
    }

    const state = useUserStore.getState();
    expect(state.totalCount).toBe(10);
    expect(state.viewedQuestionIds).toHaveLength(10);
  });

  it('没有按天统计字段（今日/连续打卡已移除）', () => {
    useUserStore.getState().recordView('q1');

    const state = useUserStore.getState() as unknown as Record<string, unknown>;
    expect(state.todayCount).toBeUndefined();
    expect(state.streakDays).toBeUndefined();
    expect(state.checkinDays).toBeUndefined();
    expect(state.todayViewed).toBeUndefined();
  });

  it('lastViewedQuestionId 跟随最近一次，无论是否已计过数', () => {
    useUserStore.getState().recordView('qA');
    useUserStore.getState().recordView('qB');
    expect(useUserStore.getState().lastViewedQuestionId).toBe('qB');

    useUserStore.getState().recordView('qA');
    expect(useUserStore.getState().lastViewedQuestionId).toBe('qA');
    expect(useUserStore.getState().totalCount).toBe(2);
  });

  it('hasPromptedRule 默认 false，setPrompted 后置 true', () => {
    expect(useUserStore.getState().hasPromptedRule).toBe(false);
    useUserStore.getState().setPrompted();
    expect(useUserStore.getState().hasPromptedRule).toBe(true);
  });

  it('阅读字号默认标准（1），可切换并持久化、恢复', async () => {
    expect(useUserStore.getState().readingScale).toBe(1);

    useUserStore.getState().setReadingScale(1.3);
    expect(useUserStore.getState().readingScale).toBe(1.3);
    await flushPersist();
    expect(JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) ?? '{}').readingScale).toBe(1.3);

    useUserStore.setState({ ...INITIAL });
    await useUserStore.getState().load();
    expect(useUserStore.getState().readingScale).toBe(1.3);
  });

  it('阅读字号只接受三档；旧数据缺字段或非法值回落标准', async () => {
    useUserStore.getState().setReadingScale(2 as never);
    expect(useUserStore.getState().readingScale).toBe(1);

    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ totalCount: 3, viewedQuestionIds: [], readingScale: 1.2 }));
    await useUserStore.getState().load();
    expect(useUserStore.getState().readingScale).toBe(1);

    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ totalCount: 3, viewedQuestionIds: [] }));
    useUserStore.setState({ readingScale: 1.15 });
    await useUserStore.getState().load();
    expect(useUserStore.getState().readingScale).toBe(1);
  });

  it('nextReadingScale 循环 标准 → 大 → 特大 → 标准', () => {
    expect(nextReadingScale(1)).toBe(1.15);
    expect(nextReadingScale(1.15)).toBe(1.3);
    expect(nextReadingScale(1.3)).toBe(1);
    expect(READING_SCALES.map((scale) => READING_SCALE_LABELS[scale])).toEqual(['标准', '大', '特大']);
  });

  it('答案默认展开设置默认关闭，可切换并持久化', async () => {
    expect(useUserStore.getState().answerExpandedByDefault).toBe(false);

    useUserStore.getState().setAnswerExpandedByDefault(true);
    expect(useUserStore.getState().answerExpandedByDefault).toBe(true);

    await flushPersist();
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    expect(JSON.parse(raw ?? '{}').answerExpandedByDefault).toBe(true);
  });

  it('recordView 后写入本机存储', async () => {
    useUserStore.getState().recordView('q1');
    await flushPersist();

    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const persisted = JSON.parse(raw ?? '{}');
    expect(persisted.totalCount).toBe(1);
    expect(persisted.viewedQuestionIds).toEqual(['q1']);
  });

  it('load 恢复总数、去重列表与设置', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        totalCount: 12,
        viewedQuestionIds: ['q1', 'q2'],
        hasPromptedRule: true,
        lastViewedQuestionId: 'q2',
        answerExpandedByDefault: true,
      }),
    );

    await useUserStore.getState().load();

    const state = useUserStore.getState();
    expect(state.totalCount).toBe(12);
    expect(state.viewedQuestionIds).toEqual(['q1', 'q2']);
    expect(state.lastViewedQuestionId).toBe('q2');
    expect(state.answerExpandedByDefault).toBe(true);
  });

  it('旧版数据（含按天字段、无 id 列表）迁移后进度不倒退', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        todayCount: 4,
        totalCount: 30,
        checkinDays: 3,
        streakDays: 2,
        hasPromptedRule: true,
        lastViewedQuestionId: 'q10',
        todayViewed: { q10: true },
        lastViewedDate: '2026-07-19',
        lastCheckinDate: '2026-07-19',
      }),
    );

    await useUserStore.getState().load();

    const state = useUserStore.getState();
    expect(state.totalCount).toBe(30);
    expect(state.viewedQuestionIds).toEqual([]);
    expect(state.hasPromptedRule).toBe(true);
    expect(state.lastViewedQuestionId).toBe('q10');
    expect(state.answerExpandedByDefault).toBe(false);
  });

  it('去重列表长度大于历史总数时以列表为准', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ totalCount: 1, viewedQuestionIds: ['a', 'b', 'c', 'a'] }),
    );

    await useUserStore.getState().load();

    const state = useUserStore.getState();
    expect(state.viewedQuestionIds).toEqual(['a', 'b', 'c']);
    expect(state.totalCount).toBe(3);
  });

  it('损坏的持久化数据不会覆盖内存状态', async () => {
    useUserStore.setState({ totalCount: 7 });
    await AsyncStorage.setItem(STORAGE_KEY, '{invalid json');

    await useUserStore.getState().load();

    expect(useUserStore.getState().totalCount).toBe(7);
  });
});
