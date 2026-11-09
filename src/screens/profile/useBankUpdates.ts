import { useCallback, useState } from 'react';
import { useBankStore, type UpdateCheck } from '../../bank';
import { bankErrorText, describeInstall } from './bank-helpers';

export interface BankRowNotice {
  message: string;
  failed: boolean;
}

/**
 * 「检查更新 → 展示差异 → 用户确认更新」流程（线上题库页与题库管理共用）。
 * checkUpdate 只拉 latest.json；真正下载安装只在用户点「更新」后进行。
 */
export function useBankUpdates() {
  const checkUpdate = useBankStore((state) => state.checkUpdate);
  const updateBank = useBankStore((state) => state.updateBank);
  const [checks, setChecks] = useState<Record<string, UpdateCheck>>({});
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [notices, setNotices] = useState<Record<string, BankRowNotice>>({});

  const setNotice = useCallback((bankId: string, notice: BankRowNotice | null) => {
    setNotices((current) => {
      const next = { ...current };
      if (notice) next[bankId] = notice;
      else delete next[bankId];
      return next;
    });
  }, []);

  const dismiss = useCallback((bankId: string) => {
    setChecks((current) => {
      const next = { ...current };
      delete next[bankId];
      return next;
    });
  }, []);

  const check = useCallback(async (bankId: string) => {
    if (checkingId) return;
    setCheckingId(bankId);
    setNotice(bankId, null);
    try {
      const result = await checkUpdate(bankId);
      if (result.ok) setChecks((current) => ({ ...current, [bankId]: result.value }));
      else setNotice(bankId, { message: bankErrorText(result.error), failed: true });
    } finally {
      setCheckingId(null);
    }
  }, [checkUpdate, checkingId, setNotice]);

  const update = useCallback(async (bankId: string) => {
    const result = await updateBank(bankId);
    if (result.ok) {
      dismiss(bankId);
      setNotice(bankId, { message: describeInstall(result.value), failed: false });
    } else {
      setNotice(bankId, { message: bankErrorText(result.error), failed: true });
    }
    return result.ok;
  }, [dismiss, setNotice, updateBank]);

  return { checks, checkingId, notices, check, update, dismiss, setNotice };
}
