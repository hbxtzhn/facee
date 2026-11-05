import type { SqlExecutor } from './db/types';
import { placeholders } from './bank-rows';

/**
 * 安装 / 更新后按 lifecycle 迁移学习数据（§4、§6.2）。必须在导入题库的同一事务内调用。
 *
 * - removed：progress / favorites 打上 archived_at（不删除，可在「已移除题目」里查看）；
 * - merged（旧 → 新，支持链式）：学习数据并入最终存在的目标题，冲突时取最近一次标记；
 * - 现存题目上的 archived_at 清除（防御性：题目重新出现时恢复）。
 *
 * 幂等：已迁移过的旧 id 不再有学习数据，重复执行无副作用。
 */
export async function applyLifecycle(tx: SqlExecutor, bankId: string, now: number): Promise<void> {
  const rows = await tx.getAllAsync<{ question_id: string; kind: string; target_id: string | null }>(
    'SELECT question_id, kind, target_id FROM lifecycle WHERE bank_id = ?',
    [bankId],
  );
  const existing = new Set(
    (await tx.getAllAsync<{ id: string }>('SELECT id FROM questions WHERE bank_id = ?', [bankId])).map((row) => row.id),
  );

  await tx.runAsync(
    `UPDATE progress SET archived_at = NULL WHERE bank_id = ? AND archived_at IS NOT NULL
       AND question_id IN (SELECT id FROM questions WHERE bank_id = ?)`,
    [bankId, bankId],
  );
  await tx.runAsync(
    `UPDATE favorites SET archived_at = NULL WHERE bank_id = ? AND archived_at IS NOT NULL
       AND question_id IN (SELECT id FROM questions WHERE bank_id = ?)`,
    [bankId, bankId],
  );

  const removed = rows.filter((row) => row.kind === 'removed' && !existing.has(row.question_id)).map((row) => row.question_id);
  for (let start = 0; start < removed.length; start += 200) {
    const ids = removed.slice(start, start + 200);
    await tx.runAsync(
      `UPDATE progress SET archived_at = ?, updated_at = ? WHERE bank_id = ? AND archived_at IS NULL AND question_id IN (${placeholders(ids.length)})`,
      [now, now, bankId, ...ids],
    );
    await tx.runAsync(
      `UPDATE favorites SET archived_at = ? WHERE bank_id = ? AND archived_at IS NULL AND question_id IN (${placeholders(ids.length)})`,
      [now, bankId, ...ids],
    );
  }

  const mergedMap = new Map<string, string>();
  for (const row of rows) if (row.kind === 'merged' && row.target_id) mergedMap.set(row.question_id, row.target_id);
  const resolve = (from: string): string | null => {
    let target = mergedMap.get(from) ?? null;
    const seen = new Set([from]);
    while (target && !existing.has(target) && mergedMap.has(target) && !seen.has(target)) {
      seen.add(target);
      target = mergedMap.get(target) ?? null;
    }
    return target && existing.has(target) ? target : null;
  };

  const renames = new Map<string, string>();
  for (const from of mergedMap.keys()) {
    if (existing.has(from)) continue;
    const target = resolve(from);
    if (!target) continue;
    renames.set(from, target);
    await mergeQuestionLearning(tx, bankId, from, target, now);
  }
  if (renames.size > 0) await rewriteSessionQueue(tx, bankId, renames, now);
}

interface ProgressRow {
  mastery: string | null;
  streak: number;
  due_at: number | null;
  marked_at: number | null;
  seen_hash: string | null;
  viewed_at: number | null;
}

async function mergeQuestionLearning(tx: SqlExecutor, bankId: string, from: string, to: string, now: number): Promise<void> {
  const select = 'SELECT mastery, streak, due_at, marked_at, seen_hash, viewed_at FROM progress WHERE bank_id = ? AND question_id = ?';
  const source = await tx.getFirstAsync<ProgressRow>(select, [bankId, from]);
  if (source) {
    const target = await tx.getFirstAsync<ProgressRow>(select, [bankId, to]);
    if (!target) {
      await tx.runAsync(
        'UPDATE progress SET question_id = ?, archived_at = NULL, updated_at = ? WHERE bank_id = ? AND question_id = ?',
        [to, now, bankId, from],
      );
    } else {
      // 冲突：取最近一次标记（marked_at 较大者）；浏览时间取较晚者
      const sourceWins = (source.marked_at ?? -1) > (target.marked_at ?? -1);
      const winner = sourceWins ? source : target;
      const viewedAt = Math.max(source.viewed_at ?? 0, target.viewed_at ?? 0) || null;
      await tx.runAsync(
        `UPDATE progress SET mastery = ?, streak = ?, due_at = ?, marked_at = ?, seen_hash = ?, viewed_at = ?,
           archived_at = NULL, updated_at = ? WHERE bank_id = ? AND question_id = ?`,
        [winner.mastery, winner.streak, winner.due_at, winner.marked_at, winner.seen_hash, viewedAt, now, bankId, to],
      );
      await tx.runAsync('DELETE FROM progress WHERE bank_id = ? AND question_id = ?', [bankId, from]);
    }
  }

  await tx.runAsync(
    `INSERT OR IGNORE INTO favorites (bank_id, question_id, created_at, archived_at)
       SELECT bank_id, ?, created_at, NULL FROM favorites WHERE bank_id = ? AND question_id = ?`,
    [to, bankId, from],
  );
  await tx.runAsync('DELETE FROM favorites WHERE bank_id = ? AND question_id = ?', [bankId, from]);

  // 要点自评按次记录：并入目标题（要点 id 若在目标题中不存在，读取时自然归入「已归档要点」）
  await tx.runAsync(
    'UPDATE OR IGNORE keypoint_checks SET question_id = ? WHERE bank_id = ? AND question_id = ?',
    [to, bankId, from],
  );
  await tx.runAsync('DELETE FROM keypoint_checks WHERE bank_id = ? AND question_id = ?', [bankId, from]);

  await tx.runAsync(
    `INSERT OR REPLACE INTO followup_progress (bank_id, question_id, followup_id, mastery, updated_at)
       SELECT s.bank_id, ?, s.followup_id, s.mastery, s.updated_at FROM followup_progress s
       WHERE s.bank_id = ? AND s.question_id = ?
         AND NOT EXISTS (SELECT 1 FROM followup_progress t WHERE t.bank_id = s.bank_id AND t.question_id = ?
                           AND t.followup_id = s.followup_id AND t.updated_at >= s.updated_at)`,
    [to, bankId, from, to],
  );
  await tx.runAsync('DELETE FROM followup_progress WHERE bank_id = ? AND question_id = ?', [bankId, from]);
}

async function rewriteSessionQueue(tx: SqlExecutor, bankId: string, renames: Map<string, string>, now: number): Promise<void> {
  const session = await tx.getFirstAsync<{ queue: string; idx: number }>('SELECT queue, idx FROM sessions WHERE bank_id = ?', [bankId]);
  if (!session) return;
  let queue: string[];
  try {
    queue = JSON.parse(session.queue) as string[];
  } catch {
    return;
  }
  if (!queue.some((id) => renames.has(id))) return;
  const next: string[] = [];
  let index = 0;
  queue.forEach((id, position) => {
    const mapped = renames.get(id) ?? id;
    if (position === session.idx) index = next.includes(mapped) ? next.indexOf(mapped) : next.length;
    if (!next.includes(mapped)) next.push(mapped);
  });
  await tx.runAsync('UPDATE sessions SET queue = ?, idx = ?, updated_at = ? WHERE bank_id = ?', [
    JSON.stringify(next),
    Math.min(index, next.length - 1),
    now,
    bankId,
  ]);
}
