import { describe, it, expect, beforeEach } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  FAVORITES_STORAGE_KEY,
  LEGACY_FAVORITES_KEY,
  flushFavoritesPersist,
  resetFavoritesForTests,
  useFavoritesStore,
} from './favoritesStore';
import { useQuestionBankStore } from '../question-bank/store';
import type { QuestionBankCatalog } from '../question-bank';

function activate(id: string | null) {
  const catalog: QuestionBankCatalog | null = id
    ? { schemaVersion: 1, id, title: id, tags: [], questions: [] }
    : null;
  useQuestionBankStore.setState({ catalog });
}

async function persisted() {
  await flushFavoritesPersist();
  const raw = await AsyncStorage.getItem(FAVORITES_STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

const fav = () => useFavoritesStore.getState();

describe('favoritesStore（公开 API 兼容）', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    activate('bank-a');
    resetFavoritesForTests();
  });

  it('load 空持久化返回空数组', async () => {
    await fav().load();
    expect(fav().ids).toEqual([]);
  });

  it('toggle 加入新收藏并按当前题库持久化', async () => {
    await fav().toggle('q1');
    expect(fav().ids).toEqual(['q1']);
    expect(fav().has('q1')).toBe(true);
    expect((await persisted()).byBank['bank-a']).toEqual(['q1']);
  });

  it('toggle 已有则移除', async () => {
    await fav().toggle('q1');
    await fav().toggle('q2');
    expect(fav().ids).toEqual(['q1', 'q2']);

    await fav().toggle('q1');
    expect(fav().ids).toEqual(['q2']);
    expect(fav().has('q1')).toBe(false);
  });

  it('load 从 v2 持久化恢复当前题库的收藏', async () => {
    await AsyncStorage.setItem(
      FAVORITES_STORAGE_KEY,
      JSON.stringify({ byBank: { 'bank-a': ['qx', 'qy'], 'bank-b': ['qz'] } }),
    );
    await fav().load();
    expect(fav().ids).toEqual(['qx', 'qy']);
  });
});

describe('favoritesStore 旧全局列表迁移', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    resetFavoritesForTests();
  });

  it('首次 load 时把旧列表归到当前激活题库，并删除旧 key', async () => {
    activate('bank-a');
    await AsyncStorage.setItem(LEGACY_FAVORITES_KEY, JSON.stringify(['qx', 'qy']));

    await fav().load();

    expect(fav().ids).toEqual(['qx', 'qy']);
    expect((await persisted()).byBank).toEqual({ 'bank-a': ['qx', 'qy'] });
    expect(await AsyncStorage.getItem(LEGACY_FAVORITES_KEY)).toBeNull();

    // 再次 load 不会重复迁移到别的库
    activate('bank-b');
    await fav().load();
    expect(fav().ids).toEqual([]);
  });

  it('load 时还没有激活题库：旧列表暂存，题库就绪后再归位', async () => {
    activate(null);
    await AsyncStorage.setItem(LEGACY_FAVORITES_KEY, JSON.stringify(['qx']));

    await fav().load();
    expect(fav().ids).toEqual(['qx']);
    expect((await persisted()).legacy).toEqual(['qx']);

    activate('bank-c');
    expect(fav().ids).toEqual(['qx']);
    const saved = await persisted();
    expect(saved.byBank).toEqual({ 'bank-c': ['qx'] });
    expect(saved.legacy).toBeNull();

    activate('bank-d');
    expect(fav().ids).toEqual([]);
  });

  it('与已有的 v2 数据合并去重', async () => {
    activate('bank-a');
    await AsyncStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify({ byBank: { 'bank-a': ['q1'] } }));
    await AsyncStorage.setItem(LEGACY_FAVORITES_KEY, JSON.stringify(['q1', 'q2']));

    await fav().load();
    expect(fav().ids).toEqual(['q1', 'q2']);
  });
});

describe('favoritesStore 按题库隔离', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    activate('bank-a');
    resetFavoritesForTests();
    await fav().load();
  });

  it('切换题库后 ids 跟随新题库，各库收藏互不可见', async () => {
    await fav().toggle('a1');
    activate('bank-b');
    expect(fav().ids).toEqual([]);
    expect(fav().has('a1')).toBe(false);

    await fav().toggle('b1');
    expect(fav().ids).toEqual(['b1']);

    activate('bank-a');
    expect(fav().ids).toEqual(['a1']);
    expect((await persisted()).byBank).toEqual({ 'bank-a': ['a1'], 'bank-b': ['b1'] });
  });

  it('复制出的题库（同题目 id、不同库 id）不共享收藏', async () => {
    await fav().toggle('shared-id');
    activate('local-copy-of-a');
    expect(fav().has('shared-id')).toBe(false);
  });

  it('重新 load 后仍按库恢复', async () => {
    await fav().toggle('a1');
    activate('bank-b');
    await fav().toggle('b1');
    await flushFavoritesPersist();

    resetFavoritesForTests();
    activate('bank-a');
    await fav().load();
    expect(fav().ids).toEqual(['a1']);
  });
});
