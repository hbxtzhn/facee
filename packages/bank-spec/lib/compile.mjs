// 编写格式 → 分发格式：读取作者仓库、全量校验、生成 bundle 对象与资源表。
// validate 与 build 共用本模块：build = compile 无 error 后再写文件。

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { parseQuestionFile } from './parse.mjs';
import { readYaml } from './yaml.mjs';
import { scanFences, findHtml, findImages, charCount } from './markdown.mjs';
import { questionContentHash, sha256Hex } from './canonical.mjs';
import { isSemver, compareSemver } from './semver.mjs';
import { isUlid } from './ulid.mjs';
import {
  BANK_SCHEMA_VERSION, BANK_ID_PATTERN, QUESTION_ID_PATTERN, KEY_POINT_ID_PATTERN, FOLLOWUP_ID_PATTERN,
  SLUG_ID_PATTERN, CHOICE_OPTION_ID_PATTERN, DATE_PATTERN, QUESTION_TYPES, DIFFICULTIES, DEFAULT_IMPORTANCE,
  DEFAULT_KEYPOINT_WEIGHT, LIMITS, FRONT_MATTER_KEYS,
} from './rules.mjs';

export const BANK_FILE = 'bank.yaml';
export const QUESTIONS_DIR = 'questions';

/**
 * @typedef {{ file: string, line: number, code: string, message: string, severity: 'error'|'warning' }} Diagnostic
 */

/** 列出 questions/ 下全部文件（相对 bank 目录，`/` 分隔，排序） */
export function listBankFiles(bankDir) {
  const root = join(bankDir, QUESTIONS_DIR);
  const out = [];
  if (!existsSync(root)) return out;
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      if (name.startsWith('.')) continue;
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else out.push(toPosix(relative(bankDir, abs)));
    }
  };
  walk(root);
  return out;
}

export function toPosix(p) {
  return p.split(sep).join('/');
}

/** 是合法的题目 id（格式 + ULID 不超过 128 位） */
export function isQuestionId(id) {
  return typeof id === 'string' && QUESTION_ID_PATTERN.test(id) && isUlid(id.slice(2));
}

/**
 * @param {string} bankDir
 * @param {{ previous?: object|null, previousFile?: string }} [opts]
 * @returns {{ bundle: object|null, assets: Map<string, Buffer>, diagnostics: Diagnostic[], release: object, errorCount: number }}
 */
export function compileBank(bankDir, opts = {}) {
  /** @type {Diagnostic[]} */
  const diagnostics = [];
  const report = (severity) => (file, line, code, message) => diagnostics.push({ file, line, code, message, severity });
  const error = report('error');
  const warn = report('warning');
  /** 资源缓存：绝对路径 → { ref } | { error } */
  const assetCache = new Map();
  /** 资源文件名 `<sha256>.<ext>` → 内容 @type {Map<string, Buffer>} */
  const assets = new Map();
  const usedAssetFiles = new Set();
  /** bank.yaml `release`：只进 latest.json */
  const release = {};

  // ---------------- bank.yaml ----------------
  const bankPath = join(bankDir, BANK_FILE);
  if (!existsSync(bankPath)) {
    error(BANK_FILE, 1, 'BANK_MISSING', `找不到 ${BANK_FILE}`);
    return finish(null);
  }
  const by = readYaml(readFileSync(bankPath, 'utf8').replace(/\r\n?/g, '\n'));
  for (const e of by.errors) error(BANK_FILE, e.line, 'BANK_YAML', `不是合法 YAML：${e.message}`);
  if (by.errors.length) return finish(null);
  const B = by.value;
  const bl = (path) => by.lineOf(path);
  const bankErr = (path, code, msg) => error(BANK_FILE, bl(path), code, msg);
  if (!isPlainObject(B)) {
    bankErr([], 'BANK_YAML', 'bank.yaml 必须是 YAML 映射');
    return finish(null);
  }
  checkKeys(B, ['schemaVersion', 'bank', 'categories', 'tags', 'collections', 'lifecycle', 'release'], [], bankErr);
  if (B.schemaVersion !== BANK_SCHEMA_VERSION) {
    bankErr(['schemaVersion'], 'BANK_SCHEMA_VERSION', `schemaVersion 必须为 ${BANK_SCHEMA_VERSION}`);
  }

  // bank 元数据
  const meta = isPlainObject(B.bank) ? B.bank : {};
  if (!isPlainObject(B.bank)) bankErr(['bank'], 'BANK_FIELD', '缺少 bank 映射');
  checkKeys(meta, ['id', 'name', 'version', 'description', 'locale', 'license', 'homepage', 'feedbackUrl', 'update'], ['bank'], bankErr);
  if (!(typeof meta.id === 'string' && BANK_ID_PATTERN.test(meta.id))) {
    bankErr(['bank', 'id'], 'BANK_FIELD', 'bank.id 必须形如 <host>/<owner>/<repo>（host 小写）');
  }
  if (!nonEmptyString(meta.name)) bankErr(['bank', 'name'], 'BANK_FIELD', 'bank.name 必填');
  if (!isSemver(meta.version)) bankErr(['bank', 'version'], 'BANK_FIELD', 'bank.version 必须是 SemVer 字符串（如 "2.0.0"）');
  for (const k of ['description', 'locale', 'license']) {
    if (meta[k] !== undefined && !nonEmptyString(meta[k])) bankErr(['bank', k], 'BANK_FIELD', `bank.${k} 必须是非空字符串`);
  }
  for (const k of ['homepage', 'feedbackUrl']) {
    if (meta[k] !== undefined && !isHttpUrl(meta[k])) bankErr(['bank', k], 'BANK_FIELD', `bank.${k} 必须是 http(s) URL`);
  }
  if (meta.update !== undefined) {
    if (!isPlainObject(meta.update)) bankErr(['bank', 'update'], 'BANK_FIELD', 'bank.update 必须是映射');
    else {
      checkKeys(meta.update, ['manifest', 'fallback'], ['bank', 'update'], bankErr);
      if (!isHttpUrl(meta.update.manifest)) bankErr(['bank', 'update', 'manifest'], 'BANK_FIELD', 'bank.update.manifest 必须是 http(s) URL');
      if (meta.update.fallback !== undefined && !isHttpUrl(meta.update.fallback)) {
        bankErr(['bank', 'update', 'fallback'], 'BANK_FIELD', 'bank.update.fallback 必须是 http(s) URL');
      }
    }
  }

  // 分类 / 标签 / 专题
  const categories = slugList(B.categories, 'categories', ['id', 'name', 'order', 'description'], bankErr, true);
  const tags = slugList(B.tags, 'tags', ['id', 'name', 'parent', 'order'], bankErr, false);
  const collections = slugList(B.collections, 'collections', ['id', 'name', 'description', 'questions'], bankErr, false);
  const categoryIds = new Set(categories.map((c) => c.item.id));
  const tagIds = new Set(tags.map((t) => t.item.id));
  for (const { item, path } of categories) {
    if (item.order !== undefined && !Number.isInteger(item.order)) bankErr([...path, 'order'], 'BANK_FIELD', 'order 必须是整数');
    if (item.description !== undefined && !nonEmptyString(item.description)) bankErr([...path, 'description'], 'BANK_FIELD', 'description 必须是非空字符串');
  }
  for (const { item, path } of tags) {
    if (item.order !== undefined && !Number.isInteger(item.order)) bankErr([...path, 'order'], 'BANK_FIELD', 'order 必须是整数');
    if (item.parent !== undefined && item.parent !== null) {
      if (typeof item.parent !== 'string' || !tagIds.has(item.parent)) {
        bankErr([...path, 'parent'], 'REF_MISSING', `标签父级「${item.parent}」不存在`);
      }
    }
  }
  // 标签父子无环
  const tagParent = new Map(tags.map(({ item }) => [item.id, typeof item.parent === 'string' ? item.parent : null]));
  const tagReported = new Set();
  for (const { item, path } of tags) {
    const chain = [item.id];
    let cur = tagParent.get(item.id);
    while (cur && tagParent.has(cur)) {
      if (cur === item.id) {
        const key = [...chain].sort().join(',');
        if (!tagReported.has(key)) {
          tagReported.add(key);
          bankErr([...path, 'parent'], 'TAG_CYCLE', `标签父子成环：${[...chain, cur].join(' → ')}`);
        }
        break;
      }
      if (chain.includes(cur)) break; // 环不经过自身，由环上的标签报告
      chain.push(cur);
      cur = tagParent.get(cur);
    }
  }

  // 生命周期
  const lc = B.lifecycle === undefined ? { removed: [], merged: {} } : B.lifecycle;
  const removed = [];
  const merged = {};
  if (!isPlainObject(lc)) bankErr(['lifecycle'], 'BANK_FIELD', 'lifecycle 必须是映射');
  else {
    checkKeys(lc, ['removed', 'merged'], ['lifecycle'], bankErr);
    const rm = lc.removed ?? [];
    if (!Array.isArray(rm)) bankErr(['lifecycle', 'removed'], 'BANK_FIELD', 'lifecycle.removed 必须是数组');
    else {
      rm.forEach((id, i) => {
        if (!isQuestionId(id)) bankErr(['lifecycle', 'removed', i], 'ID_INVALID', `lifecycle.removed 中的「${id}」不是合法题目 id`);
        else if (removed.includes(id)) bankErr(['lifecycle', 'removed', i], 'ID_DUPLICATE', `lifecycle.removed 重复：${id}`);
        else removed.push(id);
      });
    }
    const mg = lc.merged ?? {};
    if (!isPlainObject(mg)) bankErr(['lifecycle', 'merged'], 'BANK_FIELD', 'lifecycle.merged 必须是映射（旧 id: 新 id）');
    else {
      for (const [from, to] of Object.entries(mg)) {
        if (!isQuestionId(from)) bankErr(['lifecycle', 'merged', from], 'ID_INVALID', `lifecycle.merged 的键「${from}」不是合法题目 id`);
        else if (!isQuestionId(to)) bankErr(['lifecycle', 'merged', from], 'ID_INVALID', `lifecycle.merged 的目标「${to}」不是合法题目 id`);
        else if (removed.includes(from)) bankErr(['lifecycle', 'merged', from], 'LIFECYCLE_CONFLICT', `${from} 同时出现在 removed 与 merged`);
        else merged[from] = to;
      }
    }
  }

  // 发布信息（只进 latest.json，不进 bundle）
  if (B.release !== undefined) {
    if (!isPlainObject(B.release)) bankErr(['release'], 'BANK_FIELD', 'release 必须是映射');
    else {
      checkKeys(B.release, ['changes', 'minAppVersion'], ['release'], bankErr);
      if (B.release.changes !== undefined) {
        if (!nonEmptyString(B.release.changes)) bankErr(['release', 'changes'], 'BANK_FIELD', 'release.changes 必须是非空纯文本');
        else {
          if (findHtml(B.release.changes)) bankErr(['release', 'changes'], 'HTML_FORBIDDEN', 'release.changes 不得包含 HTML');
          release.changes = B.release.changes.trim();
        }
      }
      if (B.release.minAppVersion !== undefined) {
        if (!isSemver(B.release.minAppVersion)) bankErr(['release', 'minAppVersion'], 'BANK_FIELD', 'release.minAppVersion 必须是 SemVer 字符串');
        else release.minAppVersion = B.release.minAppVersion;
      }
    }
  }

  // ---------------- 题目文件 ----------------
  const allFiles = listBankFiles(bankDir);
  const mdFiles = allFiles.filter((f) => f.endsWith('.md'));
  if (mdFiles.length === 0) error(QUESTIONS_DIR, 1, 'NO_QUESTIONS', `${QUESTIONS_DIR}/ 下没有题目文件`);

  const parsedQuestions = []; // { file, q (bundle 对象，未含 contentHash), refs: {...}, lines }

  for (const file of mdFiles) {
    const src = readFileSync(join(bankDir, file), 'utf8');
    const p = parseQuestionFile(src);
    for (const d of p.diags) diagnostics.push({ file, ...d });
    if (!p.frontMatter) continue;
    const fm = p.frontMatter;
    const fl = (key) => p.lineOfFm(Array.isArray(key) ? key : [key]);
    const qErr = (line, code, msg) => error(file, line, code, msg);
    const qWarn = (line, code, msg) => warn(file, line, code, msg);

    for (const k of Object.keys(fm)) {
      if (!FRONT_MATTER_KEYS.includes(k)) qErr(fl(k), 'FM_UNKNOWN_KEY', `未知 front matter 字段「${k}」`);
    }
    // id
    if (fm.id === undefined || fm.id === null || fm.id === '') {
      qErr(fl('id'), 'FM_REQUIRED', '缺少题目 id；运行 `bank-spec fix-ids` 自动分配');
    } else if (!isQuestionId(fm.id)) {
      qErr(fl('id'), 'ID_INVALID', `题目 id「${fm.id}」不合法：必须是 q_ + 26 位 ULID（Crockford Base32 大写）`);
    }
    // title
    const title = typeof fm.title === 'string' ? fm.title.trim() : '';
    if (!title) qErr(fl('title'), 'FM_REQUIRED', 'title 必填');
    else checkPlain(title, fl('title'), 'title', qErr);
    // 枚举
    if (!QUESTION_TYPES.includes(fm.type)) qErr(fl('type'), fm.type === undefined ? 'FM_REQUIRED' : 'FM_INVALID', `type 必须是 ${QUESTION_TYPES.join(' | ')}`);
    if (!DIFFICULTIES.includes(fm.difficulty)) qErr(fl('difficulty'), fm.difficulty === undefined ? 'FM_REQUIRED' : 'FM_INVALID', `difficulty 必须是 ${DIFFICULTIES.join(' | ')}`);
    const importance = fm.importance ?? DEFAULT_IMPORTANCE;
    if (![1, 2, 3].includes(importance)) qErr(fl('importance'), 'FM_INVALID', 'importance 必须是 1、2 或 3');
    if (fm.category === undefined) qErr(fl('category'), 'FM_REQUIRED', 'category 必填');
    else if (!categoryIds.has(fm.category)) qErr(fl('category'), 'REF_MISSING', `分类「${fm.category}」未在 bank.yaml categories 中声明`);
    // tags
    const qTags = stringArray(fm.tags, 'tags', fl, qErr) ?? [];
    for (const t of qTags) if (!tagIds.has(t)) qErr(fl('tags'), 'REF_MISSING', `标签「${t}」未在 bank.yaml tags 中声明`);
    const appliesTo = stringArray(fm.appliesTo, 'appliesTo', fl, qErr) ?? [];
    for (const a of appliesTo) checkPlain(a, fl('appliesTo'), 'appliesTo', qErr);
    const prerequisites = stringArray(fm.prerequisites, 'prerequisites', fl, qErr) ?? [];
    const related = stringArray(fm.related, 'related', fl, qErr) ?? [];
    for (const [key, list] of [['prerequisites', prerequisites], ['related', related]]) {
      for (const id of list) {
        if (!isQuestionId(id)) qErr(fl(key), 'ID_INVALID', `${key} 中的「${id}」不是合法题目 id`);
        else if (id === fm.id) qErr(fl(key), 'REF_SELF', `${key} 不得引用本题`);
      }
    }
    // source / references
    let source;
    if (fm.source !== undefined) {
      if (!isPlainObject(fm.source) || !nonEmptyString(fm.source.name)) qErr(fl('source'), 'FM_INVALID', 'source 必须是 { name, license?, url? }');
      else {
        for (const k of Object.keys(fm.source)) if (!['name', 'license', 'url'].includes(k)) qErr(fl('source'), 'FM_UNKNOWN_KEY', `source 未知字段「${k}」`);
        if (fm.source.url !== undefined && !isHttpUrl(fm.source.url)) qErr(fl('source'), 'FM_INVALID', 'source.url 必须是 http(s) URL');
        if (fm.source.license !== undefined && !nonEmptyString(fm.source.license)) qErr(fl('source'), 'FM_INVALID', 'source.license 必须是非空字符串');
        source = pick(fm.source, ['name', 'license', 'url']);
      }
    }
    let references;
    if (fm.references !== undefined) {
      if (!Array.isArray(fm.references)) qErr(fl('references'), 'FM_INVALID', 'references 必须是数组');
      else {
        references = [];
        fm.references.forEach((r, i) => {
          const line = fl(['references', i]);
          if (!isPlainObject(r) || !nonEmptyString(r.title) || !isHttpUrl(r.url)) {
            qErr(line, 'FM_INVALID', 'references 每项必须是 { title, url }，url 为 http(s)');
            return;
          }
          for (const k of Object.keys(r)) if (!['title', 'url'].includes(k)) qErr(line, 'FM_UNKNOWN_KEY', `references 未知字段「${k}」`);
          references.push({ title: r.title, url: r.url });
        });
      }
    }
    if (fm.reviewedAt !== undefined && !isValidDate(fm.reviewedAt)) qErr(fl('reviewedAt'), 'FM_INVALID', 'reviewedAt 必须是 YYYY-MM-DD 字符串');
    if (fm.estimatedMinutes !== undefined && !(Number.isInteger(fm.estimatedMinutes) && fm.estimatedMinutes > 0)) {
      qErr(fl('estimatedMinutes'), 'FM_INVALID', 'estimatedMinutes 必须是正整数');
    }
    const retired = stringArray(fm.retired, 'retired', fl, qErr) ?? [];
    for (const r of retired) {
      if (!KEY_POINT_ID_PATTERN.test(r) && !FOLLOWUP_ID_PATTERN.test(r)) qErr(fl('retired'), 'ID_INVALID', `retired 中的「${r}」不是要点 / 追问 id`);
    }

    // ---- 分段 ----
    const has = new Set(p.sections.map((s) => s.key));
    const bodyLine = p.fmLines.end + 1;
    for (const k of ['summary', 'keyPoints']) {
      if (!has.has(k)) qErr(bodyLine, 'SECTION_REQUIRED', `缺少必填分段「${k === 'summary' ? '一句话' : '要点'}」`);
    }
    const isChoice = fm.type === 'choice';
    if (isChoice && !has.has('choice')) qErr(bodyLine, 'CHOICE_REQUIRED', 'type: choice 必须有「## 选项」分段');
    if (!isChoice && has.has('choice')) qErr(p.choice.line, 'CHOICE_UNEXPECTED', '只有 type: choice 才能有「## 选项」分段');

    const md = (field, label) => (field ? checkMarkdown(field, label, file, qErr, qWarn, resolveAsset) : null);

    // 题目
    let prompt = null;
    if (p.prompt) {
      if (!p.prompt.text) qErr(p.prompt.line, 'SECTION_EMPTY', '「## 题目」为空；无补充时整段省略');
      else {
        const firstLine = p.prompt.text.split('\n')[0].replace(/^#+\s*/, '').trim();
        if (title && (p.prompt.text.trim() === title || firstLine === title)) {
          qErr(p.prompt.line, 'PROMPT_REPEATS_TITLE', '「## 题目」不得重复标题');
        }
        if (/^\s*(?:[-*>]\s*)?(?:来源|出处)\s*[:：]/m.test(p.prompt.text)) {
          qWarn(p.prompt.line, 'PROMPT_SOURCE', '出处请写在 front matter `source`，不要写在「## 题目」');
        }
        prompt = md(p.prompt, '题目');
      }
    }
    // 一句话
    let summary = '';
    if (p.summary) {
      summary = p.summary.text;
      if (!summary) qErr(p.summary.line, 'SECTION_EMPTY', '「## 一句话」为空');
      else {
        if (charCount(summary) > LIMITS.summaryChars) {
          qErr(p.summary.line, 'SUMMARY_LENGTH', `一句话 ${charCount(summary)} 字，超过 ${LIMITS.summaryChars} 字`);
        }
        const sentences = summary.split(/[。！？!?]+/).filter((s) => s.trim()).length;
        if (sentences > LIMITS.summarySentences) qErr(p.summary.line, 'SUMMARY_SENTENCES', `一句话最多 ${LIMITS.summarySentences} 句，当前 ${sentences} 句`);
        checkPlain(summary, p.summary.line, '一句话', qErr);
      }
    }
    // 要点
    const keyPoints = [];
    if (p.keyPoints) {
      const items = p.keyPoints.items;
      if (items.length < LIMITS.keyPointsMin || items.length > LIMITS.keyPointsMax) {
        qErr(p.keyPoints.line, 'KEYPOINT_COUNT', `要点必须 ${LIMITS.keyPointsMin}–${LIMITS.keyPointsMax} 条，当前 ${items.length} 条`);
      }
      for (const it of items) {
        if (it.id === null) qErr(it.line, 'KEYPOINT_ID_MISSING', '要点缺少 id；运行 `bank-spec fix-ids` 自动补号');
        else if (!KEY_POINT_ID_PATTERN.test(it.id)) qErr(it.line, 'ID_INVALID', `要点 id「${it.id}」不合法，应为 kp1、kp2…`);
        let weight = DEFAULT_KEYPOINT_WEIGHT;
        if (it.weight !== null) {
          weight = Number(it.weight);
          if (!['1', '2', '3'].includes(it.weight)) qErr(it.line, 'KEYPOINT_WEIGHT', `要点权重「${it.weight}」不合法，应为 1–3`);
        }
        if (!it.text) qErr(it.line, 'KEYPOINT_EMPTY', '要点文字为空');
        else if (charCount(it.text) > LIMITS.keyPointChars) qErr(it.line, 'KEYPOINT_LENGTH', `要点 ${charCount(it.text)} 字，超过 ${LIMITS.keyPointChars} 字`);
        checkPlain(it.text, it.line, '要点', qErr);
        keyPoints.push({ id: it.id ?? '', text: it.text, weight });
      }
      checkLocalIds(items.filter((i) => i.id), 'kp', retired, file, qErr, fl('retired'));
    }
    // 详解 / 示例
    let detail = null;
    if (p.detail) {
      if (!p.detail.text) qErr(p.detail.line, 'SECTION_EMPTY', '「## 详解」为空；无内容时整段省略');
      else {
        detail = md(p.detail, '详解');
        if (charCount(p.detail.text) > LIMITS.detailCharsWarn) {
          qWarn(p.detail.line, 'DETAIL_LENGTH', `详解 ${charCount(p.detail.text)} 字，建议 ≤ ${LIMITS.detailCharsWarn} 字`);
        }
      }
    }
    let examples = null;
    if (p.examples) {
      if (!p.examples.text) qErr(p.examples.line, 'SECTION_EMPTY', '「## 示例」为空；无内容时整段省略');
      else examples = md(p.examples, '示例');
    }
    // 易错点
    const pitfalls = [];
    if (p.pitfalls) {
      if (p.pitfalls.items.length === 0) qErr(p.pitfalls.line, 'SECTION_EMPTY', '「## 易错点」为空；无内容时整段省略');
      for (const it of p.pitfalls.items) {
        checkPlain(it.text, it.line, '易错点', qErr);
        pitfalls.push(it.text);
      }
    }
    // 追问
    const followups = [];
    if (p.followups) {
      if (p.followups.items.length === 0) qErr(p.followups.line, 'SECTION_EMPTY', '「## 追问」为空；无内容时整段省略');
      for (const it of p.followups.items) {
        if (it.id === null) qErr(it.line, 'FOLLOWUP_ID_MISSING', '追问缺少 id；运行 `bank-spec fix-ids` 自动补号');
        else if (!FOLLOWUP_ID_PATTERN.test(it.id)) qErr(it.line, 'ID_INVALID', `追问 id「${it.id}」不合法，应为 f1、f2…`);
        if (!it.q) qErr(it.line, 'FOLLOWUP_SYNTAX', '追问问题为空');
        checkPlain(it.q, it.line, '追问', qErr);
        let a = '';
        if (!it.a.text) qErr(it.line, 'FOLLOWUP_ANSWER_EMPTY', '追问缺少答案');
        else {
          if (charCount(it.a.text) > LIMITS.followupAnswerChars) {
            qErr(it.a.line, 'FOLLOWUP_ANSWER_LENGTH', `追问答案 ${charCount(it.a.text)} 字，超过 ${LIMITS.followupAnswerChars} 字；需长篇展开请升级为独立题并互相 related`);
          }
          a = md(it.a, '追问答案');
        }
        followups.push({ id: it.id ?? '', q: it.q, a });
      }
      checkLocalIds(p.followups.items.filter((i) => i.id), 'f', retired, file, qErr, fl('retired'));
    }
    // 选项
    let choice = null;
    if (isChoice && p.choice) {
      const opts = p.choice.options;
      if (opts.length < LIMITS.choiceOptionsMin) qErr(p.choice.line, 'CHOICE_SYNTAX', `选项至少 ${LIMITS.choiceOptionsMin} 个`);
      const seen = new Set();
      for (const o of opts) {
        if (!CHOICE_OPTION_ID_PATTERN.test(o.id)) qErr(o.line, 'CHOICE_SYNTAX', `选项 id「${o.id}」不合法，应为单个小写字母`);
        else if (seen.has(o.id)) qErr(o.line, 'ID_DUPLICATE', `选项 id「${o.id}」重复`);
        seen.add(o.id);
        if (!o.text) qErr(o.line, 'CHOICE_SYNTAX', '选项文字为空');
        checkPlain(o.text, o.line, '选项', qErr);
      }
      if (opts.length && !opts.some((o) => o.correct)) qErr(p.choice.line, 'CHOICE_NO_CORRECT', '至少一个选项末尾标 ✓');
      choice = {
        options: opts.map((o) => ({ id: o.id, text: o.text })),
        correct: opts.filter((o) => o.correct).map((o) => o.id),
        // 选择题的「## 详解」作为解析，不再重复写入 answer.detail
        explanation: detail,
      };
      detail = null;
    }

    // TODO 残留（代码块外）
    const { inFence } = scanFences(p.lines);
    p.lines.forEach((line, i) => {
      if (!inFence[i] && /\bTODO\b/.test(line)) qWarn(i + 1, 'TODO_LEFT', '仍有 TODO 占位内容');
    });

    const q = {
      id: fm.id,
      title,
      type: fm.type,
      difficulty: fm.difficulty,
      importance,
      categoryId: fm.category,
      tags: qTags,
      appliesTo,
      prerequisites,
      related,
      prompt,
      answer: { summary, keyPoints, detail, examples, pitfalls },
      choice,
      followups,
      source,
      references,
      reviewedAt: fm.reviewedAt,
      estimatedMinutes: fm.estimatedMinutes,
    };
    parsedQuestions.push({ file, q, idLine: fl('id'), fl });
  }

  function resolveAsset(target, fromFile) {
    // 资源只能是题库内的相对路径；构建时改写为 asset:<sha256>.<ext>
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/') || target.startsWith('\\')) {
      return { error: ['ASSET_PATH', `图片「${target}」必须是相对题目文件的本地路径（如 ./assets/x.png）`] };
    }
    let decoded;
    try {
      decoded = decodeURI(target);
    } catch {
      decoded = target;
    }
    const abs = resolve(bankDir, dirname(fromFile), decoded.split(/[?#]/)[0]);
    const rel = toPosix(relative(bankDir, abs));
    if (rel.startsWith('../') || rel === '..' || /^[A-Za-z]:/.test(rel)) {
      return { error: ['ASSET_PATH', `图片「${target}」越出题库目录`] };
    }
    if (assetCache.has(abs)) return assetCache.get(abs);
    let res;
    if (!existsSync(abs) || !statSync(abs).isFile()) res = { error: ['ASSET_MISSING', `图片「${target}」不存在`] };
    else {
      const data = readFileSync(abs);
      const fmt = sniffImage(data);
      if (!fmt) res = { error: ['ASSET_FORMAT', `图片「${target}」不是 PNG / JPEG / WebP`] };
      else if (data.length > LIMITS.assetBytes) res = { error: ['ASSET_TOO_LARGE', `图片「${target}」${data.length} 字节，超过 1 MB`] };
      else {
        const name = `${sha256Hex(data)}.${fmt}`;
        assets.set(name, data);
        usedAssetFiles.add(rel);
        res = { ref: `asset:${name}` };
      }
    }
    assetCache.set(abs, res);
    return res;
  }

  // ---------------- 跨题检查 ----------------
  const byId = new Map();
  for (const pq of parsedQuestions) {
    if (!isQuestionId(pq.q.id)) continue;
    if (byId.has(pq.q.id)) {
      error(pq.file, pq.idLine, 'ID_DUPLICATE', `题目 id ${pq.q.id} 与 ${byId.get(pq.q.id).file} 重复`);
      continue;
    }
    byId.set(pq.q.id, pq);
  }
  const lifecycleHint = (id) => (removed.includes(id) ? '（该题已在 lifecycle.removed）' : merged[id] ? `（该题已并入 ${merged[id]}）` : '');
  for (const pq of parsedQuestions) {
    for (const key of ['prerequisites', 'related']) {
      for (const id of pq.q[key]) {
        if (isQuestionId(id) && id !== pq.q.id && !byId.has(id)) {
          error(pq.file, pq.fl(key), 'REF_MISSING', `${key} 引用的题目 ${id} 不存在${lifecycleHint(id)}`);
        }
      }
      if (new Set(pq.q[key]).size !== pq.q[key].length) error(pq.file, pq.fl(key), 'ID_DUPLICATE', `${key} 有重复项`);
    }
  }
  // prerequisites 无环
  const state = new Map(); // 0/undefined 未访问，1 栈中，2 完成
  const stack = [];
  const cycleReported = new Set();
  const visit = (id) => {
    state.set(id, 1);
    stack.push(id);
    for (const next of byId.get(id).q.prerequisites) {
      if (!byId.has(next)) continue;
      if (state.get(next) === 1) {
        const cycle = stack.slice(stack.indexOf(next));
        const key = [...cycle].sort().join(',');
        if (!cycleReported.has(key)) {
          cycleReported.add(key);
          const pq = byId.get(id);
          error(pq.file, pq.fl('prerequisites'), 'PREREQ_CYCLE', `prerequisites 成环：${[...cycle, next].join(' → ')}`);
        }
      } else if (!state.get(next)) visit(next);
    }
    stack.pop();
    state.set(id, 2);
  };
  for (const id of [...byId.keys()].sort()) if (!state.get(id)) visit(id);

  // 专题
  for (const { item, path } of collections) {
    if (item.description !== undefined && !nonEmptyString(item.description)) bankErr([...path, 'description'], 'BANK_FIELD', 'description 必须是非空字符串');
    if (!Array.isArray(item.questions) || item.questions.length === 0) {
      bankErr([...path, 'questions'], 'BANK_FIELD', `专题「${item.id}」的 questions 必须是非空数组`);
      continue;
    }
    const seen = new Set();
    item.questions.forEach((id, i) => {
      const at = [...path, 'questions', i];
      if (!isQuestionId(id)) bankErr(at, 'ID_INVALID', `专题「${item.id}」中的「${id}」不是合法题目 id`);
      else if (!byId.has(id)) bankErr(at, 'REF_MISSING', `专题「${item.id}」引用的题目 ${id} 不存在${lifecycleHint(id)}`);
      else if (seen.has(id)) bankErr(at, 'ID_DUPLICATE', `专题「${item.id}」重复引用 ${id}`);
      seen.add(id);
    });
  }

  // 生命周期：声明的 id 不能仍存在；合并目标必须存在
  for (const id of removed) {
    if (byId.has(id)) bankErr(['lifecycle', 'removed', removed.indexOf(id)], 'LIFECYCLE_CONFLICT', `${id} 已声明删除，但题目仍存在（${byId.get(id).file}）`);
  }
  for (const [from, to] of Object.entries(merged)) {
    if (byId.has(from)) bankErr(['lifecycle', 'merged', from], 'LIFECYCLE_CONFLICT', `${from} 已声明合并，但题目仍存在（${byId.get(from).file}）`);
    if (!byId.has(to)) bankErr(['lifecycle', 'merged', from], 'REF_MISSING', `合并目标 ${to} 不存在`);
  }

  // 与上一版对比
  if (opts.previous) {
    const prev = opts.previous;
    const pf = opts.previousFile ?? 'latest.json';
    if (!isPlainObject(prev) || !isPlainObject(prev.questions) || typeof prev.version !== 'string') {
      error(pf, 1, 'PREVIOUS_INVALID', '上一版 latest.json 缺少 version / questions');
    } else {
      if (prev.schemaVersion !== BANK_SCHEMA_VERSION) error(pf, 1, 'PREVIOUS_INVALID', `上一版 schemaVersion=${prev.schemaVersion}，不是 v${BANK_SCHEMA_VERSION}`);
      if (typeof meta.id === 'string' && prev.bankId !== meta.id) {
        bankErr(['bank', 'id'], 'BANK_MISMATCH', `bank.id「${meta.id}」与上一版「${prev.bankId}」不同；题库 id 永不改变`);
      }
      if (isSemver(meta.version) && isSemver(prev.version) && compareSemver(meta.version, prev.version) <= 0) {
        bankErr(['bank', 'version'], 'VERSION_NOT_INCREASED', `bank.version ${meta.version} 必须大于上一版 ${prev.version}`);
      }
      for (const id of Object.keys(prev.questions)) {
        if (!byId.has(id) && !removed.includes(id) && !(id in merged)) {
          bankErr(['lifecycle'], 'LIFECYCLE_MISSING', `上一版的题目 ${id} 已消失，但未在 lifecycle.removed / merged 中声明`);
        }
      }
    }
  }

  // 未被引用的资源文件
  for (const f of allFiles) {
    if (f.endsWith('.md') || usedAssetFiles.has(f)) continue;
    warn(f, 1, 'ASSET_UNUSED', '文件未被任何题目引用，不会进入发布产物');
  }

  // ---------------- 组装 bundle ----------------
  const hasError = diagnostics.some((d) => d.severity === 'error');
  if (hasError) return finish(null);

  const questions = parsedQuestions
    .map(({ q }) => {
      const out = stripUndefined(q);
      out.contentHash = questionContentHash(out);
      return out;
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const bundle = {
    schemaVersion: BANK_SCHEMA_VERSION,
    bank: stripUndefined({
      id: meta.id,
      name: meta.name,
      version: meta.version,
      description: meta.description,
      locale: meta.locale,
      license: meta.license,
      homepage: meta.homepage,
      feedbackUrl: meta.feedbackUrl,
      update: meta.update ? stripUndefined({ manifest: meta.update.manifest, fallback: meta.update.fallback }) : undefined,
    }),
    categories: categories.map(({ item }) => stripUndefined(pick(item, ['id', 'name', 'order', 'description']))),
    tags: tags.map(({ item }) => stripUndefined({ id: item.id, name: item.name, parent: item.parent ?? null, order: item.order })),
    collections: collections.map(({ item }) => stripUndefined(pick(item, ['id', 'name', 'description', 'questions']))),
    lifecycle: { removed, merged },
    questions,
  };
  return finish(bundle);

  function finish(bundle) {
    diagnostics.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
    return {
      bundle,
      assets: new Map([...assets].sort(([a], [b]) => (a < b ? -1 : 1))),
      diagnostics,
      release,
      errorCount: diagnostics.filter((d) => d.severity === 'error').length,
    };
  }
}

// ---------------- 辅助 ----------------

/** 校验 Markdown 字段并改写图片引用；返回改写后的文本 */
function checkMarkdown(field, label, file, qErr, qWarn, resolveAsset) {
  const lines = field.text.split('\n');
  const { inFence, blocks } = scanFences(lines);
  for (const b of blocks) {
    const at = field.line + b.start;
    if (!b.lang) qErr(at, 'CODE_LANG', `${label}中的代码块必须标注语言（如 \`\`\`java）`);
    if (b.lines > LIMITS.codeBlockLines) qErr(at, 'CODE_TOO_LONG', `${label}中的代码块 ${b.lines} 行，超过 ${LIMITS.codeBlockLines} 行`);
  }
  const out = lines.map((line, i) => {
    if (inFence[i]) return line;
    const lineNo = field.line + i;
    const html = findHtml(line);
    if (html) qErr(lineNo, 'HTML_FORBIDDEN', `${label}中不得出现 HTML：${html}`);
    const images = findImages(line);
    if (!images.length) return line;
    let rewritten = '';
    let last = 0;
    for (const img of images) {
      const res = resolveAsset(img.target, file);
      rewritten += line.slice(last, img.index);
      if (res.error) {
        qErr(lineNo, res.error[0], res.error[1]);
        rewritten += line.slice(img.index, img.index + img.length);
      } else {
        rewritten += `![${img.alt}](${res.ref}${img.title})`;
      }
      last = img.index + img.length;
    }
    return rewritten + line.slice(last);
  });
  return out.join('\n');
}

function checkPlain(text, line, label, qErr) {
  const html = findHtml(text);
  if (html) qErr(line, 'HTML_FORBIDDEN', `${label}中不得出现 HTML：${html}`);
}

/** 题内要点 / 追问 id：唯一、不在 retired 中、编号无空洞 */
function checkLocalIds(items, prefix, retired, file, qErr, retiredLine) {
  const seen = new Map();
  for (const it of items) {
    if (seen.has(it.id)) qErr(it.line, 'ID_DUPLICATE', `id「${it.id}」在本题重复（首次出现于第 ${seen.get(it.id)} 行）`);
    else seen.set(it.id, it.line);
    if (retired.includes(it.id)) qErr(it.line, 'ID_REUSED', `id「${it.id}」已在 retired 中，删除过的 id 不得复用`);
  }
  const re = new RegExp(`^${prefix}([1-9][0-9]{0,2})$`);
  const nums = new Set();
  for (const id of [...seen.keys(), ...retired]) {
    const m = re.exec(id);
    if (m) nums.add(Number(m[1]));
  }
  const max = Math.max(0, ...nums);
  const gaps = [];
  for (let n = 1; n < max; n++) if (!nums.has(n)) gaps.push(`${prefix}${n}`);
  if (gaps.length) {
    qErr(retiredLine, 'ID_GAP', `${gaps.join('、')} 已删除但未记入 front matter retired；运行 \`bank-spec fix-ids\` 自动记录`);
  }
}

function slugList(list, key, allowed, bankErr, required) {
  const out = [];
  if (list === undefined || list === null) {
    if (required) bankErr([key], 'BANK_FIELD', `${key} 必填`);
    return out;
  }
  if (!Array.isArray(list)) {
    bankErr([key], 'BANK_FIELD', `${key} 必须是数组`);
    return out;
  }
  const seen = new Set();
  list.forEach((item, i) => {
    const path = [key, i];
    if (!isPlainObject(item)) {
      bankErr(path, 'BANK_FIELD', `${key}[${i}] 必须是映射`);
      return;
    }
    checkKeys(item, allowed, path, bankErr);
    if (typeof item.id !== 'string' || !SLUG_ID_PATTERN.test(item.id)) {
      bankErr([...path, 'id'], 'ID_INVALID', `${key}[${i}].id「${item.id}」必须匹配 ${SLUG_ID_PATTERN}`);
      return;
    }
    if (seen.has(item.id)) {
      bankErr([...path, 'id'], 'ID_DUPLICATE', `${key} 中 id「${item.id}」重复`);
      return;
    }
    seen.add(item.id);
    if (!nonEmptyString(item.name)) bankErr([...path, 'name'], 'BANK_FIELD', `${key}[${i}].name 必填`);
    out.push({ item, path });
  });
  return out;
}

function checkKeys(obj, allowed, path, bankErr) {
  if (!isPlainObject(obj)) return;
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) bankErr([...path, k], 'BANK_UNKNOWN_KEY', `未知字段「${[...path, k].join('.')}」`);
  }
}

function stringArray(v, key, fl, qErr) {
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v) || v.some((x) => !nonEmptyString(x))) {
    qErr(fl(key), 'FM_INVALID', `${key} 必须是非空字符串数组`);
    return null;
  }
  return v.map((x) => x.trim());
}

function isValidDate(s) {
  if (typeof s !== 'string' || !DATE_PATTERN.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** 识别图片格式；返回扩展名或 null */
export function sniffImage(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function nonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== '';
}
function isHttpUrl(v) {
  if (typeof v !== 'string') return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}
function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}
function stripUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
}
