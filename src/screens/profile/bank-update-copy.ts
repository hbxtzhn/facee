import type { UpdateBankResult } from '../../question-bank/store';

/** 在线更新结果的统一文案（题库管理页与添加地址弹窗共用） */
export function describeUpdateResult(title: string, result: UpdateBankResult): string {
  const { added, removed, updated, copiedBankId } = result;
  const copiedNote = copiedBankId ? '本地修改已另存为副本。' : '';
  return (!updated
    ? `「${title}」已是最新版本。`
    : removed > 0
      ? `「${title}」更新完成：新增 ${added} 题，移除 ${removed} 题。`
      : `「${title}」更新完成：新增 ${added} 题。`) + copiedNote;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
