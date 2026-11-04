import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

/**
 * 练习会话：按题库 id 记住「上次练到哪」——完整队列 + 当前下标 + 模式。
 *
 * 首页「继续上次练习」靠它原样恢复队列（此前只记一个全局 lastViewedQuestionId，
 * 恢复时把整份分类当队列，筛选 / 随机 / 错题复习的上下文全丢）。
 * - 从首页 / 列表 / 收藏发起练习队列时调用 saveSession；
 * - 详情页翻页时调用 updateIndex(bankId, index) 推进下标；
 * - App.tsx 不归本模块维护，load() 由首页懒触发（重复调用安全，按 updatedAt 合并）。
 */

export type PracticeMode = 'browse' | 'practice' | 'review';

export interface PracticeSession {
  queue: string[];
  index: number;
  mode: PracticeMode;
  /** 会话来源的可读名（如分类名、「今日复习」），首页恢复行展示用 */
  title?: string;
  updatedAt: number;
}

export type PracticeSessionInput = Omit<PracticeSession, 'updatedAt'> & { updatedAt?: number };

interface PracticeSessionState {
  /** 题库 catalog.id -> 该库最近一次练习会话 */
  sessions: Record<string, PracticeSession>;
  saveSession: (bankId: string, session: PracticeSessionInput) => void;
  getSession: (bankId: string) => PracticeSession | null;
  /** 详情页翻页时推进下标；该库没有会话时静默忽略 */
  updateIndex: (bankId: string, index: number) => void;
  load: () => Promise<void>;
}

export const PRACTICE_SESSION_STORAGE_KEY = 'facee-practice-sessions.v1';

let pendingPersist = Promise.resolve();
/**
 * 首次从磁盘读取并合并的进程内承诺。写入必须排在它之后：否则启动后、首页 load 完成前
 * 的一次 saveSession 会把「只含当前库」的快照写回磁盘，抹掉其它题库的会话。
 */
let hydration: Promise<void> | null = null;

export const usePracticeSessionStore = create<PracticeSessionState>((set, get) => ({
  sessions: {},

  saveSession: (bankId, input) => {
    if (!bankId) return;
    const session = normalizeSession({ ...input, updatedAt: input.updatedAt ?? Date.now() });
    if (!session) return;
    set({ sessions: { ...get().sessions, [bankId]: session } });
    queuePersist();
  },

  getSession: (bankId) => get().sessions[bankId] ?? null,

  updateIndex: (bankId, index) => {
    const current = get().sessions[bankId];
    if (!current || !Number.isInteger(index)) return;
    const clamped = Math.min(Math.max(index, 0), current.queue.length - 1);
    if (clamped === current.index) return;
    set({
      sessions: {
        ...get().sessions,
        [bankId]: { ...current, index: clamped, updatedAt: Date.now() },
      },
    });
    queuePersist();
  },

  load: () => {
    const reading = readAndMerge();
    if (!hydration) hydration = reading;
    return reading;
  },
}));

/**
 * 用当前题库校正会话：剔除已不存在的题（题库更新 / 删题后），下标落到原位置
 * 或其后第一道仍存在的题；全部失效返回 null。
 */
export function resolveSessionQueue(
  session: PracticeSession,
  existingIds: ReadonlySet<string>,
): { queue: string[]; index: number } | null {
  const queue: string[] = [];
  let index = -1;
  session.queue.forEach((id, position) => {
    if (!existingIds.has(id)) return;
    if (index === -1 && position >= session.index) index = queue.length;
    queue.push(id);
  });
  if (queue.length === 0) return null;
  return { queue, index: index === -1 ? queue.length - 1 : index };
}

/** 从磁盘读出会话并与内存合并：读取期间内存里可能已有更新的会话，按 updatedAt 取新者 */
async function readAndMerge(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(PRACTICE_SESSION_STORAGE_KEY);
    if (!raw) return;
    const persisted = parseSessions(JSON.parse(raw));
    const { sessions } = usePracticeSessionStore.getState();
    const merged = { ...persisted };
    for (const [bankId, session] of Object.entries(sessions)) {
      const stored = merged[bankId];
      if (!stored || session.updatedAt >= stored.updatedAt) merged[bankId] = session;
    }
    usePracticeSessionStore.setState({ sessions: merged });
  } catch {
    // 存储只是缓存：读失败保留内存态
  }
}

/**
 * 排队落盘：先等首次读取合并完成，再序列化「写入那一刻」的完整会话表，
 * 而不是调用时的快照——这样磁盘上其它题库的会话不会被未合并的状态覆盖。
 */
function queuePersist(): void {
  pendingPersist = pendingPersist
    .catch(() => undefined)
    .then(() => hydration ?? usePracticeSessionStore.getState().load())
    .then(() => AsyncStorage.setItem(
      PRACTICE_SESSION_STORAGE_KEY,
      JSON.stringify({ sessions: usePracticeSessionStore.getState().sessions }),
    ))
    .catch(() => undefined);
}

/** 测试用：模拟新进程启动（尚未从磁盘读取过） */
export function resetPracticeSessionHydrationForTests(): void {
  hydration = null;
  pendingPersist = Promise.resolve();
}

/** 测试用：等待排队中的写入落盘 */
export function flushPracticeSessionPersist(): Promise<void> {
  return pendingPersist;
}

function parseSessions(value: unknown): Record<string, PracticeSession> {
  if (!isRecord(value) || !isRecord(value.sessions)) return {};
  const result: Record<string, PracticeSession> = {};
  for (const [bankId, entry] of Object.entries(value.sessions)) {
    const session = isRecord(entry) ? normalizeSession(entry) : null;
    if (session) result[bankId] = session;
  }
  return result;
}

function normalizeSession(value: Record<string, unknown> | PracticeSessionInput): PracticeSession | null {
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.queue)) return null;
  const queue = raw.queue.filter((id): id is string => typeof id === 'string' && id.length > 0);
  if (queue.length === 0) return null;
  const mode: PracticeMode =
    raw.mode === 'browse' || raw.mode === 'review' || raw.mode === 'practice' ? raw.mode : 'practice';
  const index =
    typeof raw.index === 'number' && Number.isInteger(raw.index)
      ? Math.min(Math.max(raw.index, 0), queue.length - 1)
      : 0;
  const updatedAt = typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0;
  return {
    queue,
    index,
    mode,
    ...(typeof raw.title === 'string' && raw.title ? { title: raw.title } : {}),
    updatedAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
