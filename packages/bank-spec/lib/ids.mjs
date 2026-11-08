// `new` 与 `fix-ids`：分配题目 / 要点 / 追问 id 并回写源文件。
//
// 要点 / 追问 id 的分配规则（见规范 §2.1「id 分配」）：
// - 已有 id 永不改号；
// - 删除过的 id 记在 front matter `retired`，永不复用；
// - 新 id = max(现有 id ∪ retired 的数字后缀) + 1；
// - 编号空洞（如现有 kp1、kp3，retired 无 kp2）视为已删除，fix-ids 自动把 kp2 写入 retired。
//   局限：删除「编号最大」的那条且没有手工写 retired 时无法察觉，再次新增会复用该号——
//   因此删除要点 / 追问时应把 id 加入 retired（或删除后先运行一次 fix-ids 之前不要新增）。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseQuestionFile, parseIdBracket } from './parse.mjs';
import { readYaml } from './yaml.mjs';
import { newQuestionId } from './ulid.mjs';
import { listBankFiles, isQuestionId, BANK_FILE, QUESTIONS_DIR } from './compile.mjs';
import { SLUG_ID_PATTERN } from './rules.mjs';

const KP_RE = /^kp([1-9][0-9]{0,2})$/;
const F_RE = /^f([1-9][0-9]{0,2})$/;

/**
 * 修正单个文件文本；返回 { text, changes }。text 不变时 changes 为空。
 * @param {string} source
 * @param {{ newId?: () => string }} [opts]
 */
export function fixIdsInSource(source, opts = {}) {
  const newId = opts.newId ?? (() => newQuestionId());
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const p = parseQuestionFile(source);
  const changes = [];
  if (!p.frontMatter) return { text: source, changes, skipped: 'front matter 无法解析' };
  const lines = p.lines.slice();
  const fm = p.frontMatter;
  const retired = new Set(Array.isArray(fm.retired) ? fm.retired.filter((x) => typeof x === 'string') : []);
  const retiredBefore = new Set(retired);

  // ---- 正文：先做同行替换（不改变行数）----
  const assign = (items, re, prefix, rewrite) => {
    const nums = new Set();
    for (const id of [...items.map((i) => i.id).filter(Boolean), ...retired]) {
      const m = re.exec(id);
      if (m) nums.add(Number(m[1]));
    }
    let max = Math.max(0, ...nums);
    // 空洞 = 已删除未登记
    for (let n = 1; n < max; n++) {
      if (!nums.has(n)) {
        retired.add(`${prefix}${n}`);
        changes.push(`retired += ${prefix}${n}`);
      }
    }
    for (const it of items) {
      if (it.id !== null) continue;
      max += 1;
      const id = `${prefix}${max}`;
      rewrite(it, id);
      changes.push(`第 ${it.line} 行：${id}`);
    }
  };

  if (p.keyPoints) {
    assign(p.keyPoints.items, KP_RE, 'kp', (it, id) => {
      const i = it.line - 1;
      const m = /^(\s*[-*+]\s+)(.*)$/.exec(lines[i]);
      const b = parseIdBracket(m[2]);
      lines[i] = `${m[1]}[${id}${b.weight ? `|${b.weight}` : ''}] ${b.text}`;
    });
  }
  if (p.followups) {
    assign(p.followups.items, F_RE, 'f', (it, id) => {
      const i = it.line - 1;
      const m = /^(###\s*)(.*)$/.exec(lines[i]);
      const b = parseIdBracket(m[2].trim());
      lines[i] = `### [${id}] ${b.text}`;
    });
  }

  // ---- front matter：可能插入 / 删除行，放在正文之后处理 ----
  const fmEnd = p.fmLines.end - 1; // 结束 `---` 的下标
  const sameSet = retired.size === retiredBefore.size && [...retired].every((x) => retiredBefore.has(x));
  if (!sameSet) {
    const sorted = [...retired].sort(compareLocalId);
    const newLine = `retired: [${sorted.join(', ')}]`;
    const at = lines.findIndex((l, i) => i > 0 && i < fmEnd && /^retired\s*:/.test(l));
    if (at >= 0) {
      let end = at + 1;
      while (end < fmEnd && /^(\s+|-\s|-$)/.test(lines[end])) end++;
      lines.splice(at, end - at, newLine);
    } else {
      lines.splice(fmEnd, 0, newLine);
    }
  }
  if (fm.id === undefined || fm.id === null || fm.id === '') {
    const id = newId();
    const at = lines.findIndex((l, i) => i > 0 && i < fmEnd && /^id\s*:/.test(l));
    if (at >= 0) lines[at] = `id: ${id}`;
    else lines.splice(1, 0, `id: ${id}`);
    changes.unshift(`题目 id：${id}`);
  }

  if (changes.length === 0) return { text: source, changes };
  return { text: lines.join(eol), changes };
}

function compareLocalId(a, b) {
  const pa = a.startsWith('kp') ? 0 : 1;
  const pb = b.startsWith('kp') ? 0 : 1;
  if (pa !== pb) return pa - pb;
  return Number(a.replace(/^\D+/, '')) - Number(b.replace(/^\D+/, '')) || (a < b ? -1 : a > b ? 1 : 0);
}

/** 对整个题库运行 fix-ids；返回每个改动文件的变更 */
export function fixIds(bankDir, opts = {}) {
  const report = [];
  for (const file of listBankFiles(bankDir).filter((f) => f.endsWith('.md'))) {
    const abs = join(bankDir, file);
    const src = readFileSync(abs, 'utf8');
    const { text, changes, skipped } = fixIdsInSource(src, opts);
    if (skipped) report.push({ file, changes: [], skipped });
    if (changes.length) {
      if (!opts.dryRun) writeFileSync(abs, text, 'utf8');
      report.push({ file, changes });
    }
  }
  return report;
}

/** 题目骨架；要点 / 追问不带 id，交给 fix-ids 补号 */
export function questionSkeleton({ id, title, category, tags = [] }) {
  return [
    '---',
    `id: ${id}`,
    `title: ${JSON.stringify(title ?? 'TODO 题目标题')}`,
    'type: concept',
    'difficulty: medium',
    'importance: 2',
    `category: ${category}`,
    `tags: [${tags.join(', ')}]`,
    '---',
    '',
    '## 一句话',
    'TODO 一句话结论',
    '',
    '## 要点',
    '- [|2] TODO 要点一',
    '- [|2] TODO 要点二',
    '- TODO 要点三',
    '',
    '## 详解',
    'TODO',
    '',
  ].join('\n');
}

/**
 * 新建题目文件：questions/<category>/<id>.md
 * @returns {{ id: string, file: string }}
 */
export function newQuestion(bankDir, { category, title, tags = [], now, rand } = {}) {
  if (!category || !SLUG_ID_PATTERN.test(category)) throw new Error(`--category 必须匹配 ${SLUG_ID_PATTERN}`);
  const bankPath = join(bankDir, BANK_FILE);
  if (!existsSync(bankPath)) throw new Error(`找不到 ${bankPath}`);
  const by = readYaml(readFileSync(bankPath, 'utf8'));
  const cats = Array.isArray(by.value?.categories) ? by.value.categories.map((c) => c?.id) : [];
  if (!cats.includes(category)) throw new Error(`分类「${category}」未在 bank.yaml categories 中声明`);
  const declaredTags = Array.isArray(by.value?.tags) ? by.value.tags.map((t) => t?.id) : [];
  for (const t of tags) if (!declaredTags.includes(t)) throw new Error(`标签「${t}」未在 bank.yaml tags 中声明`);
  const id = newQuestionId(now, rand);
  if (!isQuestionId(id)) throw new Error(`生成的 id 不合法：${id}`);
  const dir = join(bankDir, QUESTIONS_DIR, category);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${id}.md`);
  if (existsSync(file)) throw new Error(`文件已存在：${file}`);
  writeFileSync(file, questionSkeleton({ id, title, category, tags }), 'utf8');
  return { id, file };
}
