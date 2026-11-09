/**
 * 题库 v2 数据层公开入口。UI 只应从这里（或 ./store）导入。
 * 不导出 db/node-sqlite（测试专用）与原生运行时（由 store 按平台创建）。
 */
export { useBankStore, resolveActiveAssetUri } from './store';
export type { BankState, BankResult, BankActionError, BankStatus, BusyKind, BusyState } from './store';
export { BankError } from './errors';
export type { BankErrorCode } from './errors';
export { rewriteMarkdownAssets, resolveAssetRef } from './install';
export type { InstallProgress, InstallResult, UpdateCheck } from './install';
export type {
  BankOrigin,
  BankSummary,
  CategoryInfo,
  CollectionInfo,
  KeypointAttempt,
  Mastery,
  QuestionDetail,
  LinkedQuestion,
  QuestionFilter,
  QuestionLearningInfo,
  QuestionListItem,
  SearchHit,
  TagInfo,
} from './model';
export type { PracticeMode, PracticeSession, PracticeSessionInput } from './sessions';
export type { SectionInfo, SectionCategory } from './sections';
export type { MasteryRecord, BankLearningStats } from './learning';
export { suggestMasteryFromCoverage } from './learning';
export type { LocalBankInput, LocalCategoryInput, LocalTagInput, LocalQuestionInput } from './local';
export type { BackupImportResult } from './backup';
export { reviewIntervalMs, DAY_MS } from './spaced-review';
export * from './types';
