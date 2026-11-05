// 测试辅助：临时题库、最小合法题库、极简 JSON Schema 校验器。

import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after } from 'node:test';

export const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_DIR = join(PKG_DIR, '..', '..');
export const SAMPLE_BANK = join(PKG_DIR, 'examples', 'sample-bank');
export const SAMPLE_DIST = join(PKG_DIR, 'examples', 'dist');

const temps = [];
after(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

export function tempDir(prefix = 'bank-spec-') {
  const d = mkdtempSync(join(tmpdir(), prefix));
  temps.push(d);
  return d;
}

/** 复制示例题库到临时目录 */
export function copySampleBank() {
  const dir = tempDir();
  cpSync(SAMPLE_BANK, dir, { recursive: true });
  return dir;
}

export const QID = {
  a: 'q_01J0000000000000000000000A',
  b: 'q_01J0000000000000000000000B',
  c: 'q_01J0000000000000000000000C',
  d: 'q_01J0000000000000000000000D',
};

export const BANK_YAML = `schemaVersion: 2
bank:
  id: github.com/example/test-bank
  name: 测试题库
  version: 1.0.0
categories:
  - { id: redis, name: Redis }
  - { id: mysql, name: MySQL }
tags:
  - { id: storage, name: 存储, parent: null }
  - { id: cache, name: 缓存, parent: storage }
collections:
  - { id: core, name: 核心, questions: [${QID.a}, ${QID.b}] }
lifecycle:
  removed: []
  merged: {}
`;

/**
 * 题目文件文本。fm 覆盖 front matter 行（值为 null 表示删除该行）；body 覆盖正文。
 */
export function questionMd({ id = QID.a, fm = {}, body } = {}) {
  const fields = {
    id,
    title: '缓存是什么？',
    type: 'concept',
    difficulty: 'easy',
    category: 'redis',
    tags: '[cache]',
    ...fm,
  };
  const lines = ['---'];
  for (const [k, v] of Object.entries(fields)) if (v !== null) lines.push(`${k}: ${v}`);
  lines.push('---', '');
  return `${lines.join('\n')}\n${body ?? DEFAULT_BODY}`;
}

export const DEFAULT_BODY = `## 一句话
缓存把热点数据放在更快的存储里。

## 要点
- [kp1|2] 读多写少的数据适合缓存
- [kp2] 需要考虑一致性
- [kp3] 需要考虑过期与淘汰
`;

/** 写一个最小合法题库：bank.yaml + 两道题；extra 为 { 相对路径: 内容 } */
export function writeBank(files = {}) {
  const dir = tempDir();
  const all = {
    'bank.yaml': BANK_YAML,
    'questions/redis/a.md': questionMd({ id: QID.a }),
    'questions/redis/b.md': questionMd({ id: QID.b, fm: { title: '缓存一致性怎么保证？' } }),
    ...files,
  };
  for (const [rel, content] of Object.entries(all)) {
    if (content === null) continue;
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}

// ---------------- 极简 JSON Schema（2020-12 子集）校验器 ----------------
// strict = true 时，未声明 additionalProperties 的对象也不允许出现未知字段，
// 用于确认构建产物与 src/bank/types.ts 的字段集合完全一致。

export function validateSchema(schema, value, { strict = false } = {}) {
  const errors = [];
  const root = schema;
  const resolveRef = (ref) => {
    if (!ref.startsWith('#/')) throw new Error(`unsupported $ref ${ref}`);
    return ref.slice(2).split('/').reduce((o, k) => o[k], root);
  };
  const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
  const matchesType = (t, v) => t === typeOf(v) || (t === 'number' && typeof v === 'number');

  const check = (s, v, path) => {
    if (s.$ref) return check(resolveRef(s.$ref), v, path);
    const before = errors.length;
    if (s.anyOf) {
      const ok = s.anyOf.some((sub) => {
        const n = errors.length;
        check(sub, v, path);
        const pass = errors.length === n;
        errors.length = n;
        return pass;
      });
      if (!ok) errors.push(`${path}: 不满足 anyOf`);
      return;
    }
    if ('const' in s && v !== s.const) errors.push(`${path}: 应为 ${JSON.stringify(s.const)}`);
    if (s.enum && !s.enum.includes(v)) errors.push(`${path}: 不在枚举 ${JSON.stringify(s.enum)} 中`);
    if (s.type) {
      const types = Array.isArray(s.type) ? s.type : [s.type];
      if (!types.some((t) => matchesType(t, v))) {
        errors.push(`${path}: 类型应为 ${types.join('|')}，实际 ${typeOf(v)}`);
        return;
      }
    }
    if (errors.length !== before) return;
    if (typeof v === 'string') {
      if (s.minLength !== undefined && [...v].length < s.minLength) errors.push(`${path}: 长度 < ${s.minLength}`);
      if (s.pattern && !new RegExp(s.pattern, 'u').test(v)) errors.push(`${path}: 不匹配 ${s.pattern}`);
    }
    if (typeof v === 'number') {
      if (s.minimum !== undefined && v < s.minimum) errors.push(`${path}: < ${s.minimum}`);
    }
    if (Array.isArray(v)) {
      if (s.minItems !== undefined && v.length < s.minItems) errors.push(`${path}: 少于 ${s.minItems} 项`);
      if (s.maxItems !== undefined && v.length > s.maxItems) errors.push(`${path}: 多于 ${s.maxItems} 项`);
      if (s.items) v.forEach((x, i) => check(s.items, x, `${path}[${i}]`));
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const r of s.required ?? []) if (!(r in v)) errors.push(`${path}: 缺少必填字段 ${r}`);
      const props = s.properties ?? {};
      for (const [k, x] of Object.entries(v)) {
        if (s.propertyNames) check(s.propertyNames, k, `${path}{${k}}`);
        if (k in props) check(props[k], x, `${path}.${k}`);
        else if (s.additionalProperties === false || (strict && s.additionalProperties === undefined)) {
          errors.push(`${path}: 未知字段 ${k}`);
        } else if (s.additionalProperties && typeof s.additionalProperties === 'object') {
          check(s.additionalProperties, x, `${path}.${k}`);
        }
      }
    }
  };
  check(schema, value, '$');
  return errors;
}
