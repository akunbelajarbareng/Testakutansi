import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { budgetFromActual, type Budget, type BudgetLine } from '../../domain';
import { formatAmount, todayISO } from '../../lib/format';
import { newId } from '../../lib/id';
import { useLedger, useLedgerData } from '../../store/ledgerStore';
import { MoneyInput } from '../../components/MoneyInput';
import { AccountSelect } from '../entries/AccountSelect';
import { Alert, Button, Field, PageHeader, Panel, errorMessage, inputClass } from '../../components/ui';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

export function BudgetPage() {
  const data = useLedgerData();
  const store = useLedger();
  const thisYear = todayISO().slice(0, 4);
  const [year, setYear] = useState(thisYear);
  const saved = data.budgets.find((b) => b.year === year);
  const [draft, setDraft] = useState<Budget | null>(null);
  const budget = draft?.year === year ? draft : saved ?? null;
  const [pct, setPct] = useState('10');
  const [newLine, setNewLine] = useState({ accountId: '', analyticAccountId: '' });
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const pillars = data.analyticAccounts.filter((a) => a.planId === data.analyticPlans[0]?.id && !a.parentId);
  const dirty = !!draft && draft.year === year;

  const lines = useMemo(() => [...(budget?.lines ?? [])].sort((a, b) => {
    const ca = data.accounts.find((x) => x.id === a.accountId)?.code ?? '';
    const cb = data.accounts.find((x) => x.id === b.accountId)?.code ?? '';
    return ca.localeCompare(cb);
  }), [budget, data.accounts]);

  const edit = (fn: (b: Budget) => Budget) => setDraft(fn(budget ?? { id: newId(), year, name: `Anggaran ${year}`, lines: [], updatedAt: '' }));
  const setLine = (id: string, patch: Partial<BudgetLine>) => edit((b) => ({ ...b, lines: b.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));

  const run = async (fn: () => Promise<void>, ok: string) => {
    setMessage(null);
    try {
      await fn();
      setMessage({ tone: 'ok', text: ok });
    } catch (e) {
      setMessage({ tone: 'error', text: errorMessage(e) });
    }
  };

  return (
    <>
      <PageHeader
        title="Anggaran"
        subtitle="Anggaran per akun per bulan, opsional per pilar. Nilai selalu positif untuk pendapatan maupun beban."
        actions={<Link to="/anggaran/realisasi" className="text-sm text-navy-600 hover:underline">Lihat anggaran vs realisasi</Link>}
      />
      <div className="space-y-4">
        {message && <Alert tone={message.tone}>{message.text}</Alert>}
        <Panel className="flex flex-wrap items-end gap-4 p-5">
          <div className="w-32">
            <Field label="Tahun"><input type="number" className={`${inputClass} num`} value={year} onChange={(e) => { setYear(e.target.value); setDraft(null); }} /></Field>
          </div>
          {!budget && (
            <>
              <Button variant="primary" onClick={() => edit((b) => b)}>Buat anggaran kosong</Button>
              <div className="flex items-end gap-2">
                <div className="w-28"><Field label="Realisasi tahun lalu ±%"><input type="number" className={`${inputClass} num`} value={pct} onChange={(e) => setPct(e.target.value)} /></Field></div>
                <Button onClick={() => edit((b) => ({ ...b, lines: budgetFromActual(data, String(Number(year) - 1), year, Number(pct) || 0, newId) }))}>Salin dari realisasi {Number(year) - 1}</Button>
              </div>
            </>
          )}
          {budget && <p className="pb-2 text-sm text-ink-soft">{budget.lines.length} baris anggaran{dirty ? ', ada perubahan belum disimpan' : ''}.</p>}
        </Panel>

        {budget && (
          <>
            <Panel>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1500px] border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="sticky left-0 border-b border-line bg-paper px-3 py-2 text-left text-xs font-semibold text-ink-soft">Akun</th>
                      {MONTHS.map((m) => <th key={m} className="border-b border-line bg-paper px-2 py-2 text-right text-xs font-semibold text-ink-soft">{m}</th>)}
                      <th className="border-b border-line bg-paper px-3 py-2 text-right text-xs font-semibold text-ink-soft">Setahun</th>
                      <th className="border-b border-line bg-paper" />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => {
                      const a = data.accounts.find((x) => x.id === l.accountId);
                      const aa = data.analyticAccounts.find((x) => x.id === l.analyticAccountId);
                      return (
                        <tr key={l.id}>
                          <td className="sticky left-0 border-b border-line bg-white px-3 py-1.5">
                            <span className="num text-ink-soft">{a?.code}</span> {a?.name}
                            {aa && <div className="text-xs text-navy-600">{aa.name}</div>}
                          </td>
                          {l.amounts.map((v, i) => (
                            <td key={i} className="w-28 border-b border-line px-1 py-1.5">
                              <MoneyInput value={v} onChange={(n) => setLine(l.id, { amounts: l.amounts.map((x, j) => (j === i ? n : x)) })} aria-label={`${a?.code} ${MONTHS[i]}`} />
                            </td>
                          ))}
                          <td className="num border-b border-line px-3 py-1.5 text-right font-medium">{formatAmount(l.amounts.reduce((s, x) => s + x, 0))}</td>
                          <td className="border-b border-line px-2 py-1.5 whitespace-nowrap">
                            <button type="button" className="text-xs text-navy-600 hover:underline" onClick={() => setLine(l.id, { amounts: Array(12).fill(l.amounts[0]) })} title="Salin nilai Januari ke semua bulan">Ratakan</button>
                            <button type="button" className="ml-2 text-xs text-ink-soft hover:text-bad" onClick={() => edit((b) => ({ ...b, lines: b.lines.filter((x) => x.id !== l.id) }))} aria-label={`Hapus ${a?.code}`}>✕</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-end gap-3 border-t border-line p-4">
                <div className="w-72"><Field label="Tambah akun"><AccountSelect accounts={data.accounts.filter((a) => a.type === 'income' || a.type === 'expense')} value={newLine.accountId} onChange={(v) => setNewLine({ ...newLine, accountId: v })} /></Field></div>
                <div className="w-56">
                  <Field label="Khusus pilar (opsional)">
                    <select className={inputClass} value={newLine.analyticAccountId} onChange={(e) => setNewLine({ ...newLine, analyticAccountId: e.target.value })}>
                      <option value="">Semua pilar</option>
                      {pillars.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </Field>
                </div>
                <Button disabled={!newLine.accountId} onClick={() => { edit((b) => ({ ...b, lines: [...b.lines, { id: newId(), accountId: newLine.accountId, analyticAccountId: newLine.analyticAccountId || undefined, amounts: Array(12).fill(0) }] })); setNewLine({ accountId: '', analyticAccountId: '' }); }}>
                  Tambah baris
                </Button>
              </div>
            </Panel>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" disabled={!dirty} onClick={() => run(async () => { await store.saveBudget(budget); setDraft(null); }, `Anggaran ${year} disimpan.`)}>Simpan anggaran</Button>
              {dirty && <Button variant="ghost" onClick={() => setDraft(null)}>Batalkan perubahan</Button>}
              {saved && !dirty && <Button variant="danger" onClick={() => run(() => store.deleteBudget(saved.id), `Anggaran ${year} dihapus.`)}>Hapus anggaran {year}</Button>}
            </div>
          </>
        )}
      </div>
    </>
  );
}
