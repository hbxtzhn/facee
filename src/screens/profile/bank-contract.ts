import type { InstalledBankSummary } from '../../question-bank/types';
import type { useQuestionBankStore } from '../../question-bank/store';

/**
 * 与并行开发中的 store 新契约对接的唯一落点。
 * 集成时把这里的类型断言删掉，直接读 store / summary 上的真实字段即可。
 */

export interface BankSourceMatch {
  bankId: string;
  title: string;
  locallyModified: boolean;
}

type QuestionBankStoreState = ReturnType<typeof useQuestionBankStore.getState>;

// TODO(merge): store.findBankBySourceUrl —— store 分支落地后去掉断言，改为 (state) => state.findBankBySourceUrl
export function selectFindBankBySourceUrl(state: QuestionBankStoreState) {
  return (state as QuestionBankStoreState & {
    findBankBySourceUrl(url: string): Promise<BankSourceMatch | null>;
  }).findBankBySourceUrl;
}

// TODO(merge): InstalledBankSummary.editable —— store 分支落地后直接用 bank.editable
export function isBankEditable(bank: InstalledBankSummary): boolean {
  const { editable } = bank as InstalledBankSummary & { editable?: boolean };
  return editable ?? bank.source === 'local';
}

/** 线上题库 = 下载且未改动；本地题库 = 自建 / 复制 / 旧模型下改过的下载库（已修改） */
export function isOnlineBank(bank: InstalledBankSummary): boolean {
  return bank.source === 'online';
}
