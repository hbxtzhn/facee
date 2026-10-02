import { Platform } from 'react-native';
import { FileSystemQuestionBankRepository } from './file-repository';
import type {
  QuestionBankRepository,
  RemoteQuestionBankRepository,
} from './types';

/**
 * Select the durable adapter used by the app. Native builds keep Markdown and
 * extracted assets on disk; web serves the built-in sample bank for UI preview
 * (no documentDirectory / zip module in a browser).
 */
export function createQuestionBankRepository(): QuestionBankRepository {
  if (Platform.OS === 'web') {
    // 延迟 require：原生包不会执行预览数据模块（见 file-repository 的 zip 同款模式）
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PreviewQuestionBankRepository } = require('./preview-repository') as typeof import('./preview-repository');
    return new PreviewQuestionBankRepository();
  }
  return new FileSystemQuestionBankRepository();
}

export const questionBankRepository = createQuestionBankRepository();

export function asRemoteQuestionBankRepository(
  repository: QuestionBankRepository,
): RemoteQuestionBankRepository | null {
  if (typeof (repository as Partial<RemoteQuestionBankRepository>).installFromUrl !== 'function') {
    return null;
  }
  return repository as RemoteQuestionBankRepository;
}
