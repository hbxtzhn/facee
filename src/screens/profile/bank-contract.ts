import type { InstalledBankSummary } from '../../question-bank/types';
import type { useQuestionBankStore } from '../../question-bank/store';

/** 界面读取题库「线上 / 本地 / 可编辑」语义的统一落点，避免各处按 id 前缀自行判断。 */

export interface BankSourceMatch {
  bankId: string;
  title: string;
  locallyModified: boolean;
}

type QuestionBankStoreState = ReturnType<typeof useQuestionBankStore.getState>;

export function selectFindBankBySourceUrl(
  state: QuestionBankStoreState,
): (url: string) => Promise<BankSourceMatch | null> {
  return state.findBankBySourceUrl;
}

/** editable 由 store 填充；旧数据或测试构造的摘要缺省时按来源推断 */
export function isBankEditable(bank: InstalledBankSummary): boolean {
  return bank.editable ?? bank.source === 'local';
}

/** 线上题库 = 下载且未改动；本地题库 = 自建 / 复制 / 旧模型下改过的下载库（已修改） */
export function isOnlineBank(bank: InstalledBankSummary): boolean {
  return bank.source === 'online';
}
