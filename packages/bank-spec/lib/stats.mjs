// stats：全库分布报告（分类 / 标签 / 题型 / 难度 / 重要度 / 专题 / 复核时效）。
// 基于 compileBank 的草稿数据，题库有校验错误时也能出报告（同时给出错误数）。

import { compileBank } from './compile.mjs';
import { DIFFICULTIES, QUESTION_TYPES } from './rules.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {string} bankDir
 * @param {{ staleDays?: number, today?: string }} [opts] today 为 YYYY-MM-DD（默认当天 UTC）
 */
export function bankStats(bankDir, { staleDays = 365, today } = {}) {
  const res = compileBank(bankDir);
  if (!res.draft) {
    return { ok: false, errorCount: res.errorCount, diagnostics: res.diagnostics };
  }
  const { categories, tags, collections, questions } = res.draft;
  const total = questions.length;
  const todayMs = Date.parse(`${today ?? new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(todayMs)) throw new Error(`--today 不是合法日期：${today}`);

  const countBy = (keys, pick) => {
    const m = new Map(keys.map((k) => [k, 0]));
    for (const q of questions) {
      const k = pick(q);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m].map(([key, count]) => ({ key, count, ratio: total ? count / total : 0 }));
  };

  // 标签：直接使用数，以及含子标签的题数
  const direct = new Map(tags.map((t) => [t.id, 0]));
  for (const q of questions) for (const t of q.tags) if (direct.has(t)) direct.set(t, direct.get(t) + 1);
  const descendants = (id, seen = new Set([id])) => {
    for (const t of tags) {
      if (t.parent === id && !seen.has(t.id)) {
        seen.add(t.id);
        descendants(t.id, seen);
      }
    }
    return seen;
  };
  const tagRows = tags.map((t) => {
    const ids = descendants(t.id);
    const withChildren = questions.filter((q) => q.tags.some((x) => ids.has(x))).length;
    return { id: t.id, name: t.name, parent: t.parent ?? null, count: direct.get(t.id), withChildren };
  });

  const reviewed = questions.map((q) => {
    const at = typeof q.reviewedAt === 'string' ? Date.parse(`${q.reviewedAt}T00:00:00Z`) : NaN;
    return { q, ageDays: Number.isNaN(at) ? null : Math.floor((todayMs - at) / DAY_MS) };
  });
  const brief = ({ q, ageDays }) => ({ id: q.id, title: q.title, file: q.file, reviewedAt: q.reviewedAt ?? null, ageDays });

  return {
    ok: true,
    errorCount: res.errorCount,
    total,
    categories: countBy(categories.map((c) => c.id), (q) => q.categoryId).map((r) => ({
      ...r,
      name: categories.find((c) => c.id === r.key)?.name ?? null,
    })),
    types: countBy(QUESTION_TYPES, (q) => q.type),
    difficulties: countBy(DIFFICULTIES, (q) => q.difficulty),
    importance: countBy([3, 2, 1], (q) => q.importance),
    tags: tagRows,
    unusedTags: tagRows.filter((t) => t.withChildren === 0).map((t) => t.id),
    singleUseTags: tagRows.filter((t) => t.count === 1).map((t) => t.id),
    collections: collections.map((c) => ({ id: c.id, name: c.name, count: Array.isArray(c.questions) ? c.questions.length : 0 })),
    notInAnyCollection: questions
      .filter((q) => !collections.some((c) => Array.isArray(c.questions) && c.questions.includes(q.id)))
      .map((q) => q.id),
    withoutReferences: questions.filter((q) => !q.references?.length).length,
    staleDays,
    neverReviewed: reviewed.filter((r) => r.ageDays === null).map(brief),
    stale: reviewed.filter((r) => r.ageDays !== null && r.ageDays > staleDays).sort((a, b) => b.ageDays - a.ageDays).map(brief),
  };
}

const pct = (r) => `${(r * 100).toFixed(1)}%`;
/** 按显示宽度补齐（CJK 等宽字符占 2 列） */
const WIDE = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/;
const width = (t) => [...t].reduce((n, ch) => n + (WIDE.test(ch) ? 2 : 1), 0);
const pad = (t, n) => t + ' '.repeat(Math.max(1, n - width(t)));

/** 人读文本报告 */
export function formatStats(s) {
  const lines = [];
  const table = (title, rows, label = (r) => String(r.key)) => {
    lines.push('', `## ${title}`);
    for (const r of rows) lines.push(`  ${pad(label(r), 32)}${String(r.count).padStart(5)}  ${pct(r.ratio).padStart(6)}`);
  };
  lines.push(`题目总数：${s.total}${s.errorCount ? `（题库有 ${s.errorCount} 个校验错误，统计基于可解析部分）` : ''}`);
  table('分类', s.categories, (r) => `${r.name ?? '?'}（${r.key}）`);
  table('题型', s.types);
  table('难度', s.difficulties);
  table('重要度', s.importance, (r) => `importance ${r.key}`);
  lines.push('', '## 标签（直接使用 / 含子标签）');
  for (const t of s.tags) lines.push(`  ${pad((t.parent ? '  ' : '') + `${t.name}（${t.id}）`, 32)}${String(t.count).padStart(5)} / ${t.withChildren}`);
  lines.push(`  未使用：${s.unusedTags.length ? s.unusedTags.join('、') : '无'}`);
  lines.push(`  只用 1 次：${s.singleUseTags.length ? s.singleUseTags.join('、') : '无'}`);
  lines.push('', '## 专题');
  for (const c of s.collections) lines.push(`  ${pad(`${c.name}（${c.id}）`, 32)}${String(c.count).padStart(5)}`);
  lines.push(`  不在任何专题的题：${s.notInAnyCollection.length}`);
  lines.push('', '## 准确性与时效');
  lines.push(`  无 references：${s.withoutReferences}`);
  lines.push(`  未写 reviewedAt：${s.neverReviewed.length}`);
  lines.push(`  复核超过 ${s.staleDays} 天：${s.stale.length}`);
  for (const r of s.stale) lines.push(`    ${r.file}  ${r.reviewedAt}（${r.ageDays} 天）  ${r.title}`);
  return lines.join('\n');
}
