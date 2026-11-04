import { useState } from 'react';
import type { ReconcileRule } from '../../domain';
import { newId } from '../../lib/id';
import { useLedger, useLedgerData } from '../../store/ledgerStore';
import { Alert, Button, Panel, errorMessage, inputClass, td, th } from '../../components/ui';
import { AccountSelect } from '../entries/AccountSelect';

const DIR: Record<ReconcileRule['direction'], string> = { in: 'Masuk', out: 'Keluar', any: 'Keduanya' };

/** Pengaturan aturan rekonsiliasi & toleransi MDR. */
export function RulesPanel() {
  const data = useLedgerData();
  const { saveRule, deleteRule, saveCompany } = useLedger();
  const [draft, setDraft] = useState<ReconcileRule | null>(null);
  const [tol, setTol] = useState(String(data.company.settlementFeeTolerance ?? 3));
  const [error, setError] = useState<string | null>(null);
  const accounts = new Map(data.accounts.map((a) => [a.id, a]));

  const act = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Panel className="mb-4 p-5">
      <h2 className="text-base font-semibold text-navy">Aturan rekonsiliasi bank</h2>
      <p className="mt-1 max-w-prose text-sm text-ink-soft">
        Bila keterangan mutasi memuat kata kunci, sistem menyarankan jurnal ke akun tertentu, atau memperlakukannya sebagai pencairan QRIS/EDC dari akun 1112. Aturan diperiksa dari atas ke bawah.
      </p>
      {error && <div className="mt-3"><Alert tone="error">{error}</Alert></div>}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse">
          <thead><tr><th className={th}>Kata kunci</th><th className={th}>Arah</th><th className={th}>Tindakan</th><th className={th}><span className="sr-only">Aksi</span></th></tr></thead>
          <tbody>
            {data.reconcileRules.map((r) => (
              <tr key={r.id} className={r.active ? '' : 'text-ink-soft'}>
                <td className={`${td} font-medium`}>{r.keyword}</td>
                <td className={td}>{DIR[r.direction]}</td>
                <td className={td}>{r.action === 'settlement' ? 'Pencairan QRIS/EDC' : `${accounts.get(r.accountId ?? '')?.code ?? ''} ${accounts.get(r.accountId ?? '')?.name ?? ''}`}</td>
                <td className={`${td} whitespace-nowrap text-right`}>
                  <Button variant="ghost" onClick={() => setDraft(r)}>Ubah</Button>
                  <Button variant="ghost" onClick={() => act(() => deleteRule(r.id))}>Hapus</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {draft ? (
        <div className="mt-4 grid gap-3 rounded-md border border-line p-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm">Kata kunci<input className={`${inputClass} mt-1 uppercase`} value={draft.keyword} onChange={(e) => setDraft({ ...draft, keyword: e.target.value })} /></label>
          <label className="text-sm">Arah
            <select className={`${inputClass} mt-1`} value={draft.direction} onChange={(e) => setDraft({ ...draft, direction: e.target.value as ReconcileRule['direction'] })}>
              {Object.entries(DIR).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="text-sm">Tindakan
            <select className={`${inputClass} mt-1`} value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value as ReconcileRule['action'] })}>
              <option value="account">Jurnal ke akun</option>
              <option value="settlement">Pencairan QRIS/EDC</option>
            </select>
          </label>
          {draft.action === 'account' ? (
            <label className="text-sm">Akun<div className="mt-1"><AccountSelect accounts={data.accounts} value={draft.accountId ?? ''} onChange={(v) => setDraft({ ...draft, accountId: v })} /></div></label>
          ) : <span />}
          <label className="text-sm sm:col-span-2">Keterangan jurnal<input className={`${inputClass} mt-1`} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-navy" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />Aktif</label>
          <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
            <Button variant="primary" onClick={() => act(async () => { await saveRule(draft); setDraft(null); })}>Simpan aturan</Button>
            <Button variant="ghost" onClick={() => setDraft(null)}>Batal</Button>
          </div>
        </div>
      ) : (
        <Button variant="ghost" className="mt-3" onClick={() => setDraft({ id: newId(), keyword: '', direction: 'out', action: 'account', label: '', active: true })}>+ Aturan baru</Button>
      )}

      <div className="mt-5 flex flex-wrap items-end gap-3 border-t border-line pt-4">
        <label className="text-sm">
          Toleransi potongan MDR (%)
          <input type="number" min={0} max={20} step={0.1} className={`${inputClass} num mt-1 w-28`} value={tol} onChange={(e) => setTol(e.target.value)} />
        </label>
        <Button onClick={() => act(() => saveCompany({ ...data.company, settlementFeeTolerance: Math.max(0, Number.parseFloat(tol) || 0) }))}>Simpan</Button>
        <p className="max-w-prose pb-2 text-xs text-ink-soft">Saran pencairan QRIS/EDC hanya muncul bila selisih nilai kotor dan dana masuk tidak melebihi persentase ini.</p>
      </div>
    </Panel>
  );
}
