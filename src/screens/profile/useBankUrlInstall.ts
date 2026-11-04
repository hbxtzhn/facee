import { useCallback, useState } from 'react';
import { useQuestionBankStore, type LocalEditsDecision } from '../../question-bank/store';
import { selectFindBankBySourceUrl, type BankSourceMatch } from './bank-contract';
import { errorMessage } from './bank-update-copy';
import type { BankUpdateOutcome } from './bank-updates';

/**
 * 按网址安装 / 更新题库的决策流程（「线上题库」页与 Web 端地址弹窗共用）：
 * - 地址对应已装线上题库：直接在线更新它（线上题库更新从不需要确认）；
 * - 对应旧模型下改过的下载库（已修改）：先问「更新原题库 / 另装一份 / 取消」，
 *   更新原题库若需确认，再问「另存副本后更新 / 直接覆盖 / 取消」；
 * - 没有对应题库：下载安装并启用。
 * 所有 await 都兜住异常，不留未处理的 Promise 拒绝。
 */
export type BankUrlPhase =
  | { kind: 'idle' }
  | { kind: 'checking' }
  /** 已修改的旧下载库：选择更新原库还是另装一份 */
  | { kind: 'askReinstall'; url: string; match: BankSourceMatch }
  /** 更新原库需要决定本地修改去留 */
  | { kind: 'askLocalEdits'; url: string; match: BankSourceMatch }
  | { kind: 'done'; message: string; installed: boolean };

export function useBankUrlInstall({
  updateBank,
  onInstalled,
}: {
  /** 来自 useUpdateBank：负责记录检查结果 */
  updateBank: (bankId: string, title: string, decision?: LocalEditsDecision) => Promise<BankUpdateOutcome>;
  /** 新装成功（非更新）后回调，例如 Web 弹窗关闭 */
  onInstalled?: () => void;
}) {
  const installing = useQuestionBankStore((state) => state.installing);
  const setSourceUrl = useQuestionBankStore((state) => state.setSourceUrl);
  const installConfigured = useQuestionBankStore((state) => state.installConfigured);
  const findBankBySourceUrl = useQuestionBankStore(selectFindBankBySourceUrl);
  const [phase, setPhase] = useState<BankUrlPhase>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);

  const install = useCallback(async (url: string) => {
    setSourceUrl(url);
    try {
      const ok = await installConfigured();
      if (!ok) {
        // installConfigured 把失败原因写进 store.installError 并返回 false：
        // 取回到本流程自己的 error，避免同页另一个安装入口也显示这条失败
        setPhase({ kind: 'idle' });
        setError(useQuestionBankStore.getState().installError ?? '题库下载失败，请检查地址后重试');
        return;
      }
      setPhase({ kind: 'done', message: '题库已下载并启用，可以离线刷题了。', installed: true });
      onInstalled?.();
    } catch (installError) {
      setPhase({ kind: 'idle' });
      setError(errorMessage(installError));
    }
  }, [installConfigured, onInstalled, setSourceUrl]);

  const update = useCallback(async (url: string, match: BankSourceMatch, decision?: LocalEditsDecision) => {
    setPhase({ kind: 'checking' });
    const outcome = await updateBank(match.bankId, match.title, decision);
    if (outcome.kind === 'needsConfirmation') setPhase({ kind: 'askLocalEdits', url, match });
    else if (outcome.kind === 'done') setPhase({ kind: 'done', message: outcome.message, installed: false });
    else { setPhase({ kind: 'idle' }); setError(outcome.message); }
  }, [updateBank]);

  const submit = useCallback(async (rawUrl: string) => {
    const url = rawUrl.trim();
    if (!url || installing || phase.kind === 'checking') return;
    setError(null);
    setPhase({ kind: 'checking' });
    let match: BankSourceMatch | null = null;
    try {
      match = await findBankBySourceUrl(url);
    } catch {
      // 查重失败不阻塞：按新地址安装（安装器本身会按 catalog.id 原地覆盖同一题库）
      match = null;
    }
    if (match?.locallyModified) {
      setPhase({ kind: 'askReinstall', url, match });
      return;
    }
    if (match) await update(url, match);
    else await install(url);
  }, [findBankBySourceUrl, install, installing, phase.kind, update]);

  /** askReinstall → 更新原题库 */
  const updateOriginal = useCallback(async () => {
    if (phase.kind !== 'askReinstall') return;
    await update(phase.url, phase.match);
  }, [phase, update]);

  /** askReinstall → 另装一份 */
  const installSeparately = useCallback(async () => {
    if (phase.kind !== 'askReinstall') return;
    const { url } = phase;
    setPhase({ kind: 'checking' });
    await install(url);
  }, [install, phase]);

  /** askLocalEdits → 另存副本后更新 / 直接覆盖 */
  const resolveLocalEdits = useCallback(async (decision: LocalEditsDecision) => {
    if (phase.kind !== 'askLocalEdits') return;
    await update(phase.url, phase.match, decision);
  }, [phase, update]);

  const reset = useCallback(() => {
    setPhase({ kind: 'idle' });
    setError(null);
  }, []);

  const busy = installing || phase.kind === 'checking';
  return { phase, error, busy, submit, updateOriginal, installSeparately, resolveLocalEdits, reset };
}

export type BankUrlInstall = ReturnType<typeof useBankUrlInstall>;
