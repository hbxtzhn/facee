import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from '@jest/globals';
import { computeContentHash } from '../hash';
import { validateBundle } from '../validate';
import type { Bundle } from '../types';

/**
 * 构建工具（packages/bank-spec）与 App 数据层是两份独立实现，必须对同一份题库给出相同结论：
 * - App 校验器接受构建工具产出的 bundle；
 * - App 本地计算的 contentHash 与构建工具写入的完全一致——否则本地题库导出再导入、
 *   或日后按指纹比较时会把未改动的题误判为「内容已更新」。
 * 用仓库里提交的官方示例构建产物做跨实现核对。
 */
const DIST = join(__dirname, '../../../packages/bank-spec/examples/dist');
const bundle = JSON.parse(readFileSync(join(DIST, 'bundle-2.0.0.json'), 'utf8')) as Bundle;
const manifest = JSON.parse(readFileSync(join(DIST, 'latest.json'), 'utf8')) as {
  questions: Record<string, string>;
};

describe('构建工具 ↔ App 数据层 契约', () => {
  it('App 校验器接受构建工具产出的示例 bundle', () => {
    const result = validateBundle(bundle);
    expect(result).toMatchObject({ ok: true });
  });

  it.each(bundle.questions.map((question) => [question.id, question] as const))(
    'App 计算的 contentHash 与构建工具一致：%s',
    (_id, question) => {
      expect(computeContentHash(question)).toBe(question.contentHash);
      expect(manifest.questions[question.id]).toBe(question.contentHash);
    },
  );
});
