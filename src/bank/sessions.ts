import type { BankRuntime } from './runtime-types';

/**
 * 练习会话（移植自 v1 practiceSessionStore 的语义）：按题库记住「上次练到哪」——
 * 完整队列 + 当前下标 + 模式 + 来源名。每个题库最多一个会话。
 */

export type PracticeMode = 'browse' | 'practice' | 'review';

export interface PracticeSession {
  queue: string[];
  index: number;
  mode: PracticeMode;
  /** 会话来源的可读名（如分类名、「今日复习」） */
  title?: string;
  updatedAt: number;
}

export type PracticeSessionInput = Omit<PracticeSession, 'updatedAt'>;

function now(rt: BankRuntime): number {
  return rt.now ? rt.now() : Date.now();
}

function normalize(input: PracticeSessionInput): Omit<PracticeSession, 'updatedAt'> | null {
  if (!Array.isArray(input.queue)) return null;
  const queue = input.queue.filter((id): id is string => typeof id === 'string' && id.length > 0);
  if (queue.length === 0) return null;
  const mode: PracticeMode = input.mode === 'browse' || input.mode === 'review' || input.mode === 'practice' ? input.mode : 'practice';
  const index = Number.isInteger(input.index) ? Math.min(Math.max(input.index, 0), queue.length - 1) : 0;
  return { queue, index, mode, ...(input.title ? { title: input.title } : {}) };
}

/**
 * 用当前题库校正会话：剔除已不存在的题，下标落到原位置或其后第一道仍存在的题；全部失效返回 null。
 */
export function resolveSessionQueue(
  session: Pick<PracticeSession, 'queue' | 'index'>,
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

/** 保存（覆盖）该题库的会话；空队列视为无效，返回 null 且不写入 */
export async function saveSession(rt: BankRuntime, bankId: string, input: PracticeSessionInput): Promise<PracticeSession | null> {
  const session = normalize(input);
  if (!session) return null;
  const updatedAt = now(rt);
  await rt.db.runAsync(
    'INSERT OR REPLACE INTO sessions (bank_id, queue, idx, mode, title, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [bankId, JSON.stringify(session.queue), session.index, session.mode, session.title ?? null, updatedAt],
  );
  return { ...session, updatedAt };
}

/**
 * 读取会话，并按题库当前题目校正（题库更新 / 删题后）；无会话或全部失效返回 null。
 */
export async function getSession(rt: BankRuntime, bankId: string): Promise<PracticeSession | null> {
  const row = await rt.db.getFirstAsync<{ queue: string; idx: number; mode: PracticeMode; title: string | null; updated_at: number }>(
    'SELECT queue, idx, mode, title, updated_at FROM sessions WHERE bank_id = ?',
    [bankId],
  );
  if (!row) return null;
  let queue: string[];
  try {
    queue = JSON.parse(row.queue) as string[];
  } catch {
    return null;
  }
  const existing = new Set(
    (await rt.db.getAllAsync<{ id: string }>('SELECT id FROM questions WHERE bank_id = ?', [bankId])).map((q) => q.id),
  );
  const resolved = resolveSessionQueue({ queue, index: row.idx }, existing);
  if (!resolved) return null;
  return { ...resolved, mode: row.mode, ...(row.title ? { title: row.title } : {}), updatedAt: row.updated_at };
}

/** 翻页时推进下标（越界自动夹紧）；该库没有会话时静默忽略 */
export async function updateSessionIndex(rt: BankRuntime, bankId: string, index: number): Promise<void> {
  if (!Number.isInteger(index)) return;
  const row = await rt.db.getFirstAsync<{ queue: string; idx: number }>('SELECT queue, idx FROM sessions WHERE bank_id = ?', [bankId]);
  if (!row) return;
  let length = 0;
  try {
    length = (JSON.parse(row.queue) as unknown[]).length;
  } catch {
    return;
  }
  const clamped = Math.min(Math.max(index, 0), Math.max(length - 1, 0));
  if (clamped === row.idx) return;
  await rt.db.runAsync('UPDATE sessions SET idx = ?, updated_at = ? WHERE bank_id = ?', [clamped, now(rt), bankId]);
}

export async function clearSession(rt: BankRuntime, bankId: string): Promise<void> {
  await rt.db.runAsync('DELETE FROM sessions WHERE bank_id = ?', [bankId]);
}
