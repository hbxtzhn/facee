#!/usr/bin/env node
// FaceE 题库工具链 v2（docs/题库规范-v2-草案.md §5）
//
//   node packages/bank-spec/cli.mjs new      --bank <dir> --category <id> [--title <t>] [--tags a,b]
//   node packages/bank-spec/cli.mjs fix-ids  --bank <dir> [--dry-run]
//   node packages/bank-spec/cli.mjs validate --bank <dir> [--previous <latest.json>]
//   node packages/bank-spec/cli.mjs build    --bank <dir> --out <dist> (--previous <latest.json> | --first-release)
//                                            [--base-url <url>] [--published-at <iso>] [--pretty]
//   node packages/bank-spec/cli.mjs stats    --bank <dir> [--stale-days <n>] [--today <YYYY-MM-DD>] [--json]
//   node packages/bank-spec/cli.mjs merge-question  --bank <dir> --from <id> --into <id> [--dry-run]
//   node packages/bank-spec/cli.mjs remove-question --bank <dir> --id <id> [--dry-run]
//
// 诊断输出：`file:line: CODE message`（警告为 `file:line: warning CODE message`）；有 error 时退出码 1。

import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { compileBank } from './lib/compile.mjs';
import { buildBank } from './lib/build.mjs';
import { fixIds, newQuestion } from './lib/ids.mjs';
import { bankStats, formatStats } from './lib/stats.mjs';
import { retireQuestion } from './lib/retire.mjs';

const USAGE = `用法：bank-spec <command> [options]

命令：
  new       --bank <dir> --category <id> [--title <t>] [--tags a,b]
                                                          新建题目骨架（分配 q_ + ULID）
  fix-ids   --bank <dir> [--dry-run]                      补齐题目 / 要点 / 追问 id 并回写
  validate  --bank <dir> [--previous <latest.json>]       全量校验；--previous 时检查 bank.id 不变、生命周期完整
  build     --bank <dir> --out <dist> (--previous <latest.json> | --first-release)
            [--base-url <url>] [--published-at <iso>] [--pretty]
                                                          发版构建：校验并生成 bundle / assets / latest.json；
                                                          --previous 时另要求版本递增，首发必须显式 --first-release
  stats     --bank <dir> [--stale-days <n>] [--today <YYYY-MM-DD>] [--json]
                                                          分类 / 标签 / 题型 / 难度 / 重要度分布，未用标签，复核时效
  merge-question  --bank <dir> --from <id> --into <id> [--dry-run]
                                                          合并题目：改写引用与专题、展开合并链、写 lifecycle.merged、删除旧题文件
  remove-question --bank <dir> --id <id> [--dry-run]      删除题目：清理引用与专题、写 lifecycle.removed、删除题目文件`;

export async function main(argv = process.argv.slice(2), io = { log: console.log, error: console.error }) {
  const [command, ...rest] = argv;
  if (!command || command === '-h' || command === '--help' || command === 'help') {
    io.log(USAGE);
    return command ? 0 : 2;
  }
  let values;
  try {
    ({ values } = parseArgs({
      args: rest,
      options: {
        bank: { type: 'string' },
        category: { type: 'string' },
        title: { type: 'string' },
        tags: { type: 'string' },
        out: { type: 'string' },
        previous: { type: 'string' },
        'base-url': { type: 'string' },
        'published-at': { type: 'string' },
        pretty: { type: 'boolean' },
        'dry-run': { type: 'boolean' },
        'first-release': { type: 'boolean' },
        'stale-days': { type: 'string' },
        today: { type: 'string' },
        json: { type: 'boolean' },
        from: { type: 'string' },
        into: { type: 'string' },
        id: { type: 'string' },
      },
      strict: true,
    }));
  } catch (err) {
    io.error(`${err.message}\n\n${USAGE}`);
    return 2;
  }
  if (!values.bank) {
    io.error(`缺少 --bank\n\n${USAGE}`);
    return 2;
  }
  const bankDir = resolve(values.bank);

  try {
    switch (command) {
      case 'new': {
        const tags = (values.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean);
        const { id, file } = newQuestion(bankDir, { category: values.category, title: values.title, tags });
        io.log(`${id}\n${relative(process.cwd(), file)}`);
        return 0;
      }
      case 'fix-ids': {
        const report = fixIds(bankDir, { dryRun: values['dry-run'] });
        for (const r of report) {
          if (r.skipped) io.error(`${r.file}: 跳过（${r.skipped}）`);
          for (const c of r.changes) io.log(`${r.file}: ${c}`);
        }
        const changed = report.filter((r) => r.changes.length).length;
        io.log(`${values['dry-run'] ? '[dry-run] ' : ''}fix-ids：${changed} 个文件${values['dry-run'] ? '需要' : '已'}更新`);
        return 0;
      }
      case 'validate': {
        const previous = loadPrevious(values.previous);
        const res = compileBank(bankDir, previous);
        printDiagnostics(res.diagnostics, io);
        const warnings = res.diagnostics.length - res.errorCount;
        if (res.errorCount) {
          io.error(`校验失败：${res.errorCount} 个错误，${warnings} 个警告`);
          return 1;
        }
        io.log(`校验通过：${res.bundle.questions.length} 题，${res.assets.size} 个资源，${warnings} 个警告`);
        return 0;
      }
      case 'build': {
        if (!values.out) {
          io.error(`build 需要 --out\n\n${USAGE}`);
          return 2;
        }
        // 发版必须对比上一版；拿不到上一版时不能悄悄当作首发
        if (!values.previous === !values['first-release']) {
          io.error(`build 需要且只能给出 --previous <上一版 latest.json> 或 --first-release 之一

${USAGE}`);
          return 2;
        }
        const previous = loadPrevious(values.previous);
        const res = buildBank(bankDir, {
          out: resolve(values.out),
          ...previous,
          baseUrl: values['base-url'],
          publishedAt: values['published-at'],
          pretty: values.pretty,
        });
        printDiagnostics(res.diagnostics, io);
        if (!res.manifest) {
          io.error(`构建失败：${res.errorCount} 个错误`);
          return 1;
        }
        io.log(`构建完成 v${res.manifest.version}：${res.bundle.questions.length} 题，${res.assets.size} 个资源`);
        for (const f of res.files) io.log(`  ${values.out.replace(/[\\/]+$/, '')}/${f}`);
        return 0;
      }
      case 'stats': {
        const staleDays = values['stale-days'] === undefined ? undefined : Number(values['stale-days']);
        if (staleDays !== undefined && !(Number.isInteger(staleDays) && staleDays >= 0)) {
          io.error(`--stale-days 必须是非负整数\n\n${USAGE}`);
          return 2;
        }
        const s = bankStats(bankDir, { staleDays, today: values.today });
        if (!s.ok) {
          printDiagnostics(s.diagnostics, io);
          io.error(`无法统计：bank.yaml 有 ${s.errorCount} 个错误`);
          return 1;
        }
        io.log(values.json ? JSON.stringify(s, null, 2) : formatStats(s));
        return 0;
      }
      case 'merge-question':
      case 'remove-question': {
        const merge = command === 'merge-question';
        const from = merge ? values.from : values.id;
        if (!from || (merge && !values.into)) {
          io.error(`${command} 需要 ${merge ? '--from 与 --into' : '--id'}\n\n${USAGE}`);
          return 2;
        }
        const r = retireQuestion(bankDir, { from, into: merge ? values.into : null, dryRun: values['dry-run'] });
        for (const c of r.changes) io.log(c);
        io.log(values['dry-run'] ? '[dry-run] 未写入文件' : `完成；请运行 validate 复核${merge ? '，并确认旧题有价值的内容已并入新题' : ''}`);
        return 0;
      }
      default:
        io.error(`未知命令「${command}」\n\n${USAGE}`);
        return 2;
    }
  } catch (err) {
    io.error(`错误：${err.message}`);
    return 1;
  }
}

function loadPrevious(path) {
  if (!path) return {};
  const abs = resolve(path);
  if (!existsSync(abs)) throw new Error(`找不到 --previous 文件：${path}`);
  return { previous: JSON.parse(readFileSync(abs, 'utf8')), previousFile: path.replace(/\\/g, '/') };
}

export function formatDiagnostic(d) {
  return d.severity === 'warning' ? `${d.file}:${d.line}: warning ${d.code} ${d.message}` : `${d.file}:${d.line}: ${d.code} ${d.message}`;
}

function printDiagnostics(diags, io) {
  for (const d of diags) (d.severity === 'error' ? io.error : io.log)(formatDiagnostic(d));
}

const isEntry = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  main().then((code) => {
    process.exitCode = code;
  });
}
