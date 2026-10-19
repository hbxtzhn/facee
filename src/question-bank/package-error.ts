import { QuestionBankValidationError } from './schema';

/** 仅用于下载完成后的解包/内容校验阶段，避免把网络或提交失败误报成坏包。 */
export function formatQuestionBankPackageError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code) : '';
  let localized: string;
  if (error instanceof QuestionBankValidationError || code === 'E_CATALOG_SCHEMA') {
    localized = '题库目录或题目内容格式不符合规范，请检查 catalog.json 和题目文件';
  } else if (code === 'ERR_WRONG_PASSWORD' || /Encrypted ZIP entries|encrypted|password/i.test(message)) {
    localized = '不支持加密题库包，请使用未加密的 ZIP 文件';
  } else if (code === 'ERR_UNSAFE_PATH' || /^Unsafe (?:ZIP entry|asset) path:|^Malformed (?:ZIP entry|asset) path:|^ZIP entry path is empty/.test(message)) {
    localized = '题库包包含不安全或无效的文件路径';
  } else if (code === 'ERR_CORRUPT_ARCHIVE' || code === 'E_ZIP_CORRUPT' || /not a zip|zip headers not found|corrupt archive/i.test(message)) {
    localized = '题库包已损坏或不是有效的 ZIP 文件，请重新下载';
  } else if (code === 'E_CATALOG_ROOT' || /^题库包内(?:没有找到|有多个) catalog\.json|^ZIP package is missing catalog\.json|^catalog\.json must be a file/.test(message)) {
    localized = '题库包必须包含唯一且有效的 catalog.json 文件';
  } else if (/^Duplicate ZIP entry:/.test(message)) {
    localized = '题库包包含重复的文件路径';
  } else if (/^(?:Unexpected (?:ZIP entry|question-bank ZIP) path:|Question (?:entry must be a directory|Markdown path must be a file):|questions must be a directory|assets must be a directory:|ZIP (?:contains unknown question|is missing question directory):)/.test(message)) {
    localized = '题库包的目录结构与题目清单不一致';
  } else if (/^Missing (?:answer\.md for question|referenced asset for question)|^answer\.md is a directory:/.test(message)) {
    localized = '题库包缺少有效的答案文件或引用的图片资源';
  } else if (/超限|超过.*限制/.test(message)) {
    localized = message;
  } else {
    // 未知原生/文件系统错误保留原文，便于排查，不猜测具体原因。
    localized = message;
  }
  return new Error(`题库包校验失败：${localized}`, { cause: error });
}
