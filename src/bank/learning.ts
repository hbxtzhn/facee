import { BankError } from './errors';
import { scheduleMark } from './spaced-review';
import type { BankRuntime } from './runtime-types';
import type { Question } from './types';
import type { KeypointAttempt, Mastery, QuestionLearningInfo } from './model';

/**
 * 学习数据（§6.2）：掌握度 + 间隔复习、浏览记录与「内容已更新」、要点自评、追问掌握、收藏、到期列表。
 * 全部以 (bank_id, question_id[, keypoint_id | followup_id]) 为键，永不随题库更新删除。
 */

const MASTERY_VALUES: readonly Mastery[] = ['unknown', 'fuzzy', 'known'];

function now(rt: BankRuntime): number {
  return rt.now ? rt.now() : Date.now();
}

function assertMastery(value: unknown): asserts value is Mastery {
  if (!MASTERY_VALUES.includes(value as Mastery)) throw new BankError('invalid', `无效的掌握度：${String(value)}`);
}

async function requireQuestion(rt: BankRuntime, bankId: string, questionId: string): Promise<{ content_hash: string; data: string }> {
  const row = await rt.db.getFirstAsync<{ content_hash: string; data: string }>(
    'SELECT content_hash, data FROM questions WHERE bank_id = ? AND id = ?',
    [bankId, questionId],
  );
  if (!row) throw new BankError('not-found', '题目不存在');
  return row;
}

interface ProgressRow {
  mastery: Mastery | null;
  streak: number;
  due_at: number | null;
  marked_at: number | null;
  seen_hash: string | null;
  viewed_at: number | null;
}

export interface MasteryRecord {
  mastery: Mastery | null;
  streak: number;
  dueAt: number | null;
  markedAt: number | null;
}

/**
 * 打标（不会 / 模糊 / 会了）并排期；传 null 清除标记（退出复习循环，浏览记录保留）。
 * 打标同时记录 seen_hash（视为已学习当前内容）。
 */
export async function setMastery(rt: BankRuntime, bankId: string, questionId: string, mastery: Mastery | null): Promise<MasteryRecord> {
  if (mastery !== null) assertMastery(mastery);
  const question = await requireQuestion(rt, bankId, questionId);
  const timestamp = now(rt);
  let result: MasteryRecord = { mastery: null, streak: 0, dueAt: null, markedAt: null };
  await rt.db.withExclusiveTransactionAsync(async (tx) => {
    const previous = await tx.getFirstAsync<ProgressRow>(
      'SELECT mastery, streak, due_at, marked_at, seen_hash, viewed_at FROM progress WHERE bank_id = ? AND question_id = ?',
      [bankId, questionId],
    );
    if (mastery === null) {
      result = { mastery: null, streak: 0, dueAt: null, markedAt: null };
    } else {
      const prevRecord =
        previous?.mastery && previous.marked_at !== null
          ? { mastery: previous.mastery, markedAt: previous.marked_at, streak: previous.streak }
          : null;
      const { streak, dueAt } = scheduleMark(prevRecord, mastery, timestamp);
      result = { mastery, streak, dueAt, markedAt: timestamp };
    }
    await tx.runAsync(
      `INSERT INTO progress (bank_id, question_id, mastery, streak, due_at, marked_at, seen_hash, viewed_at, archived_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
       ON CONFLICT(bank_id, question_id) DO UPDATE SET mastery = excluded.mastery, streak = excluded.streak,
         due_at = excluded.due_at, marked_at = excluded.marked_at,
         seen_hash = COALESCE(excluded.seen_hash, progress.seen_hash), archived_at = NULL, updated_at = excluded.updated_at`,
      [
        bankId, questionId, result.mastery, result.streak, result.dueAt, result.markedAt,
        mastery === null ? null : question.content_hash, previous?.viewed_at ?? null, timestamp,
      ],
    );
  });
  return result;
}

/** 记录浏览：更新 viewed_at 与 seen_hash（清除「内容已更新」标记） */
export async function markViewed(rt: BankRuntime, bankId: string, questionId: string): Promise<void> {
  const question = await requireQuestion(rt, bankId, questionId);
  const timestamp = now(rt);
  await rt.db.runAsync(
    `INSERT INTO progress (bank_id, question_id, mastery, streak, seen_hash, viewed_at, updated_at)
     VALUES (?, ?, NULL, 0, ?, ?, ?)
     ON CONFLICT(bank_id, question_id) DO UPDATE SET seen_hash = excluded.seen_hash, viewed_at = excluded.viewed_at,
       updated_at = excluded.updated_at`,
    [bankId, questionId, question.content_hash, timestamp, timestamp],
  );
}

/** 今日到期的题（只含题库中仍存在的题）：最久未复习优先，同刻按 id */
export async function listDueQuestionIds(rt: BankRuntime, bankId: string): Promise<string[]> {
  const rows = await rt.db.getAllAsync<{ question_id: string }>(
    `SELECT p.question_id FROM progress p JOIN questions q ON q.bank_id = p.bank_id AND q.id = p.question_id
     WHERE p.bank_id = ? AND p.mastery IS NOT NULL AND p.due_at <= ?
     ORDER BY p.marked_at, p.question_id`,
    [bankId, now(rt)],
  );
  return rows.map((row) => row.question_id);
}

export interface BankLearningStats {
  questionCount: number;
  markedCount: number;
  knownCount: number;
  fuzzyCount: number;
  unknownCount: number;
  dueCount: number;
  favoriteCount: number;
  /** 学过 / 看过后内容有更新的题数 */
  updatedCount: number;
}

export async function getLearningStats(rt: BankRuntime, bankId: string): Promise<BankLearningStats> {
  const row = await rt.db.getFirstAsync<Record<string, number | null>>(
    `SELECT COUNT(*) AS total,
       SUM(p.mastery IS NOT NULL) AS marked,
       SUM(p.mastery = 'known') AS known,
       SUM(p.mastery = 'fuzzy') AS fuzzy,
       SUM(p.mastery = 'unknown') AS unknown,
       SUM(p.mastery IS NOT NULL AND p.due_at <= ?) AS due,
       SUM(fav.question_id IS NOT NULL) AS favorites,
       SUM(p.seen_hash IS NOT NULL AND p.seen_hash <> q.content_hash) AS updated
     FROM questions q
     LEFT JOIN progress p ON p.bank_id = q.bank_id AND p.question_id = q.id
     LEFT JOIN favorites fav ON fav.bank_id = q.bank_id AND fav.question_id = q.id
     WHERE q.bank_id = ?`,
    [now(rt), bankId],
  );
  const n = (key: string) => Number(row?.[key] ?? 0);
  return {
    questionCount: n('total'),
    markedCount: n('marked'),
    knownCount: n('known'),
    fuzzyCount: n('fuzzy'),
    unknownCount: n('unknown'),
    dueCount: n('due'),
    favoriteCount: n('favorites'),
    updatedCount: n('updated'),
  };
}

// ---------- 收藏 ----------

export async function setFavorite(rt: BankRuntime, bankId: string, questionId: string, favorite: boolean): Promise<boolean> {
  if (favorite) {
    await requireQuestion(rt, bankId, questionId);
    await rt.db.runAsync(
      'INSERT OR IGNORE INTO favorites (bank_id, question_id, created_at, archived_at) VALUES (?, ?, ?, NULL)',
      [bankId, questionId, now(rt)],
    );
  } else {
    await rt.db.runAsync('DELETE FROM favorites WHERE bank_id = ? AND question_id = ?', [bankId, questionId]);
  }
  return favorite;
}

export async function toggleFavorite(rt: BankRuntime, bankId: string, questionId: string): Promise<boolean> {
  const row = await rt.db.getFirstAsync<{ question_id: string }>(
    'SELECT question_id FROM favorites WHERE bank_id = ? AND question_id = ?',
    [bankId, questionId],
  );
  return setFavorite(rt, bankId, questionId, !row);
}

// ---------- 要点自评 ----------

function weightedCoverage(question: Question, covered: Record<string, boolean>): number {
  let total = 0;
  let hit = 0;
  for (const kp of question.answer.keyPoints) {
    total += kp.weight;
    if (covered[kp.id]) hit += kp.weight;
  }
  return total > 0 ? hit / total : 0;
}

/**
 * 记录一次要点自评：`covered` 为「要点 id → 是否答到」，必须覆盖当前题的全部要点。
 * 每次自评独立保存（同一时间戳），不覆盖历史。
 */
export async function recordKeypointCheck(
  rt: BankRuntime,
  bankId: string,
  questionId: string,
  covered: Record<string, boolean>,
): Promise<KeypointAttempt> {
  const question = JSON.parse((await requireQuestion(rt, bankId, questionId)).data) as Question;
  const ids = question.answer.keyPoints.map((kp) => kp.id);
  const unknown = Object.keys(covered).filter((id) => !ids.includes(id));
  if (unknown.length > 0) throw new BankError('invalid', `题目中没有要点 ${unknown.join('、')}`);
  const missing = ids.filter((id) => typeof covered[id] !== 'boolean');
  if (missing.length > 0) throw new BankError('invalid', `缺少要点 ${missing.join('、')} 的自评结果`);
  let checkedAt = now(rt);
  await rt.db.withExclusiveTransactionAsync(async (tx) => {
    // 同一毫秒内的两次自评顺延 1ms，保证每次独立成条
    const last = await tx.getFirstAsync<{ t: number | null }>(
      'SELECT MAX(checked_at) AS t FROM keypoint_checks WHERE bank_id = ? AND question_id = ?',
      [bankId, questionId],
    );
    if (last?.t !== null && last?.t !== undefined && last.t >= checkedAt) checkedAt = last.t + 1;
    for (const id of ids) {
      await tx.runAsync(
        'INSERT INTO keypoint_checks (bank_id, question_id, keypoint_id, checked_at, covered) VALUES (?, ?, ?, ?, ?)',
        [bankId, questionId, id, checkedAt, covered[id] ? 1 : 0],
      );
    }
  });
  const coveredMap = Object.fromEntries(ids.map((id) => [id, !!covered[id]]));
  return { checkedAt, covered: coveredMap, weightedCoverage: weightedCoverage(question, coveredMap) };
}

/**
 * 某题的全部要点自评（新的在前）。`covered` 只含当前题仍存在的要点；
 * 已删除要点的历史记录归入 `archivedKeypointIds`（§4：对应自评记录归档）。
 */
export async function listKeypointAttempts(
  rt: BankRuntime,
  bankId: string,
  questionId: string,
): Promise<Array<KeypointAttempt & { archivedKeypointIds: string[] }>> {
  const question = JSON.parse((await requireQuestion(rt, bankId, questionId)).data) as Question;
  return attemptsFor(rt, bankId, question);
}

async function attemptsFor(rt: BankRuntime, bankId: string, question: Question) {
  const rows = await rt.db.getAllAsync<{ keypoint_id: string; checked_at: number; covered: number }>(
    'SELECT keypoint_id, checked_at, covered FROM keypoint_checks WHERE bank_id = ? AND question_id = ? ORDER BY checked_at DESC, keypoint_id',
    [bankId, question.id],
  );
  const current = new Set(question.answer.keyPoints.map((kp) => kp.id));
  const attempts = new Map<number, { covered: Record<string, boolean>; archived: string[] }>();
  for (const row of rows) {
    const attempt = attempts.get(row.checked_at) ?? { covered: {}, archived: [] };
    if (current.has(row.keypoint_id)) attempt.covered[row.keypoint_id] = row.covered === 1;
    else attempt.archived.push(row.keypoint_id);
    attempts.set(row.checked_at, attempt);
  }
  return [...attempts.entries()].map(([checkedAt, attempt]) => ({
    checkedAt,
    covered: attempt.covered,
    weightedCoverage: weightedCoverage(question, attempt.covered),
    archivedKeypointIds: attempt.archived,
  }));
}

/** 由要点覆盖率给出建议掌握度（UI 可用来预选，不自动打标）：≥ 0.8 会了，≥ 0.4 模糊，否则不会 */
export function suggestMasteryFromCoverage(coverage: number): Mastery {
  if (coverage >= 0.8) return 'known';
  if (coverage >= 0.4) return 'fuzzy';
  return 'unknown';
}

// ---------- 追问 ----------

export async function setFollowupMastery(
  rt: BankRuntime,
  bankId: string,
  questionId: string,
  followupId: string,
  mastery: Mastery | null,
): Promise<void> {
  const question = JSON.parse((await requireQuestion(rt, bankId, questionId)).data) as Question;
  if (!question.followups.some((f) => f.id === followupId)) throw new BankError('not-found', `题目中没有追问 ${followupId}`);
  if (mastery === null) {
    await rt.db.runAsync('DELETE FROM followup_progress WHERE bank_id = ? AND question_id = ? AND followup_id = ?', [bankId, questionId, followupId]);
    return;
  }
  assertMastery(mastery);
  await rt.db.runAsync(
    'INSERT OR REPLACE INTO followup_progress (bank_id, question_id, followup_id, mastery, updated_at) VALUES (?, ?, ?, ?, ?)',
    [bankId, questionId, followupId, mastery, now(rt)],
  );
}

// ---------- 单题汇总 ----------

export async function getQuestionLearning(rt: BankRuntime, bankId: string, question: Question): Promise<QuestionLearningInfo> {
  const progress = await rt.db.getFirstAsync<ProgressRow>(
    'SELECT mastery, streak, due_at, marked_at, seen_hash, viewed_at FROM progress WHERE bank_id = ? AND question_id = ?',
    [bankId, question.id],
  );
  const favorite = await rt.db.getFirstAsync<{ question_id: string }>(
    'SELECT question_id FROM favorites WHERE bank_id = ? AND question_id = ?',
    [bankId, question.id],
  );
  const followupRows = await rt.db.getAllAsync<{ followup_id: string; mastery: Mastery }>(
    'SELECT followup_id, mastery FROM followup_progress WHERE bank_id = ? AND question_id = ?',
    [bankId, question.id],
  );
  const currentFollowups = new Set(question.followups.map((f) => f.id));
  const followups: Record<string, Mastery> = {};
  for (const row of followupRows) if (currentFollowups.has(row.followup_id)) followups[row.followup_id] = row.mastery;
  const attempts = await attemptsFor(rt, bankId, question);
  const last = attempts.find((attempt) => Object.keys(attempt.covered).length > 0) ?? null;
  return {
    mastery: progress?.mastery ?? null,
    streak: progress?.streak ?? 0,
    dueAt: progress?.mastery ? progress.due_at : null,
    markedAt: progress?.mastery ? progress.marked_at : null,
    viewedAt: progress?.viewed_at ?? null,
    favorite: !!favorite,
    contentUpdated: !!progress?.seen_hash && progress.seen_hash !== question.contentHash,
    followups,
    lastKeypointCheck: last ? { checkedAt: last.checkedAt, covered: last.covered, weightedCoverage: last.weightedCoverage } : null,
  };
}

/** 「已移除题目」：学习数据仍在、但题目已从题库删除（lifecycle.removed / 本地删除）的题 id */
export async function listArchivedQuestionIds(rt: BankRuntime, bankId: string): Promise<string[]> {
  const rows = await rt.db.getAllAsync<{ question_id: string }>(
    `SELECT question_id FROM progress WHERE bank_id = ? AND archived_at IS NOT NULL
     UNION SELECT question_id FROM favorites WHERE bank_id = ? AND archived_at IS NOT NULL
     ORDER BY question_id`,
    [bankId, bankId],
  );
  return rows.map((row) => row.question_id);
}
