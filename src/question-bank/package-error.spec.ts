import { formatQuestionBankPackageError } from './package-error';
import { QuestionBankValidationError } from './schema';

it.each([
  [Object.assign(new Error('native failure'), { code: 'ERR_CORRUPT_ARCHIVE' }), '已损坏或不是有效的 ZIP'],
  [new Error('Zip headers not found. Probably not a zip file'), '已损坏或不是有效的 ZIP'],
  [Object.assign(new Error('native failure'), { code: 'ERR_WRONG_PASSWORD' }), '不支持加密题库包'],
  [new Error('Encrypted ZIP entries are not supported: catalog.json'), '不支持加密题库包'],
  [new Error('Unsafe ZIP entry path: ../catalog.json'), '不安全或无效的文件路径'],
  [new Error('Malformed asset path: %zz'), '不安全或无效的文件路径'],
  [new Error('题库包内有多个 catalog.json，无法确定题库根目录：a, b'), '唯一且有效的 catalog.json'],
  [new QuestionBankValidationError(['questions must be an array']), '目录或题目内容格式不符合规范'],
  [new Error('Duplicate ZIP entry: questions/q/question.md'), '重复的文件路径'],
  [new Error('ZIP is missing question directory: q'), '目录结构与题目清单不一致'],
  [new Error('Missing referenced asset for question q: ./assets/a.png'), '缺少有效的答案文件或引用的图片资源'],
  [new Error('题库文件数量超限'), '题库文件数量超限'],
])('已知校验错误提供中文说明，并保留原异常 %#', (original, localized) => {
  const result = formatQuestionBankPackageError(original);
  expect(result.message.startsWith('题库包校验失败：')).toBe(true);
  expect(result.message).toContain(localized);
  expect(result.cause).toBe(original);
});

it('未知错误保留原文并加题库包校验前缀', () => {
  expect(formatQuestionBankPackageError(new Error('Unexpected native exception')).message)
    .toBe('题库包校验失败：Unexpected native exception');
});
