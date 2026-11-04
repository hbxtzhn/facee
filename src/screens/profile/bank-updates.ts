import { useCallback, useEffect, useState } from 'react';
import {
  loadBankUpdateRecord, removeBankUpdateRecord, saveBankUpdateRecord, type BankUpdateRecord,
} from '../../question-bank/update-history';
import { useQuestionBankStore, type LocalEditsDecision } from '../../question-bank/store';
import type { InstalledBankSummary } from '../../question-bank/types';
import { describeUpdateResult, errorMessage } from './bank-update-copy';

export type BankUpdateOutcome =
  | { kind: 'needsConfirmation' }
  | { kind: 'done'; message: string; updated: boolean }
  | { kind: 'failed'; message: string };

/**
 * 每个题库最近一次「检查更新」的结果：挂载时从本机读取，更新后落盘。
 * 诊断记录写盘失败不影响更新结果本身。
 */
export function useBankUpdateRecords(banks: InstalledBankSummary[], active = true) {
  const [records, setRecords] = useState<Record<string, BankUpdateRecord>>({});

  useEffect(() => {
    if (!active) return;
    let alive = true;
    void Promise.all(banks.map(async (bank) => [bank.catalogId, await loadBankUpdateRecord(bank.catalogId)] as const))
      .then((loaded) => {
        if (!alive) return;
        const next: Record<string, BankUpdateRecord> = {};
        for (const [id, record] of loaded) if (record) next[id] = record;
        setRecords((current) => ({ ...next, ...current }));
      });
    return () => { alive = false; };
  }, [active, banks]);

  const remember = useCallback(async (bankId: string, status: BankUpdateRecord['status'], message: string) => {
    const record: BankUpdateRecord = { checkedAt: new Date().toISOString(), status, message };
    setRecords((current) => ({ ...current, [bankId]: record }));
    try { await saveBankUpdateRecord(bankId, record); } catch { /* 本次结果仍可查看 */ }
  }, []);

  const forget = useCallback(async (bankId: string) => {
    setRecords((current) => {
      const next = { ...current };
      delete next[bankId];
      return next;
    });
    try { await removeBankUpdateRecord(bankId); } catch { /* 不影响删除结果 */ }
  }, []);

  return { records, remember, forget };
}

/**
 * 在线更新一个题库并记录结果。needsConfirmation（旧模型下改过的下载库）不算一次检查，不落记录；
 * 调用方展示「另存副本后更新 / 直接覆盖 / 取消」后带 decision 重试。
 */
export function useUpdateBank(
  remember: (bankId: string, status: BankUpdateRecord['status'], message: string) => Promise<void>,
) {
  const updateBank = useQuestionBankStore((state) => state.updateBank);
  return useCallback(async (bankId: string, title: string, decision?: LocalEditsDecision): Promise<BankUpdateOutcome> => {
    try {
      const result = await updateBank(bankId, decision ? { onLocalEdits: decision } : undefined);
      if (result.needsConfirmation) return { kind: 'needsConfirmation' };
      const message = describeUpdateResult(title, result);
      await remember(bankId, result.updated ? 'updated' : 'unchanged', message);
      return { kind: 'done', message, updated: result.updated };
    } catch (error) {
      const message = errorMessage(error);
      await remember(bankId, 'failed', message);
      return { kind: 'failed', message };
    }
  }, [remember, updateBank]);
}

/** 「最近检查」一行文案 */
export function describeLastCheck(record: BankUpdateRecord | undefined): string {
  if (!record) return '尚未检查更新';
  return `${new Date(record.checkedAt).toLocaleString()} · ${record.status === 'failed' ? '检查失败' : record.status === 'updated' ? '已更新' : '已是最新'}`;
}
