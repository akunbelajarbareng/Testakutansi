import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { actualAmount, budgetVsActual, isPnlAccount, type DateRange } from '../../domain';
import { formatAmount, formatDate } from '../../lib/format';
import { useLedgerData } from '../../store/ledgerStore';
import { Button, EmptyState, LinkButton, PageHeader, Panel, th, thNum } from '../../components/ui';
import { PeriodControls, ReportHeading, presetRange, type Preset } from '../reports/PeriodControls';

const STATUS_CLS = { good: 'bg-ok', warning: 'bg-orange', bad: 'bg-bad' };

export function BudgetVsActualPage() {
  const data = useLedgerData();
  const [preset, setPreset] = useState<Preset>('thisMonth');
  const [range, setRange] = useState<DateRange>(presetRange('thisMonth')!);
  const year = range.from.slice(0, 4);
  const budget = data.budgets.find((b) => b.year === year);
  const r = useMemo(() => (budget ? budgetVsActual(data, budget, range) : null), [data, budget, range]);
  const crossYear = range.from.slice(0, 4) !== range.to.slice(0, 4);
  const unbudgeted = useMemo(() => {
    if (!budget) return [];
    const inBudget = new Set(budget.lines.map((l) => l.accountId));
    return data.accounts
      .filter((a) => isPnlAccount(a) && !inBudget.has(a.id))
      .map((a) => ({ account: a, actual: actualAmount(data, a.id, range) }))
      .filter((x) => x.actual !== 0)
      .sort((a, b) => a.account.code.localeCompare(b.account.code));
  }, [data, budget, range]);

  return (
    <>
      <PageHeader
        title="Anggaran vs Realisasi"
        subtitle={`${formatDate(range.from)} sampai ${formatDate(range.to)}.`}
        actions={<div className="flex gap-2 print:hidden"><Button onClick={() => window.print()}>Cetak</Button><LinkButton to="/anggaran">Ubah anggaran</LinkButton></div>}
      />
      <ReportHeading company={data.company.name} title="Anggaran vs Realisasi" subtitle={`${formatDate(range.from)} sampai ${formatDate(range.to)}`} />
      <Panel className="mb-4 p-5 print:hidden">
        <PeriodControls preset={preset} range={range} onChange={(p, x) => { setPreset(p); setRange(x); }} />
        {crossYear && <p className="mt-2 text-sm text-orange-600">Periode melewati pergantian tahun; hanya anggaran {year} yang dipakai.</p>}
      </Panel>

      {!budget || !r ? (
        <Panel><EmptyState title={`Belum ada anggaran tahun ${year}.`} action={<LinkButton to="/anggaran" variant="primary">Buat anggaran</LinkButton>} /></Panel>
      ) : (
        <>
          <div className="mb-4 grid gap-4 sm:grid-cols-2">
            <Summary label="Pendapatan" budget={r.totals.revenueBudget} actual={r.totals.revenueActual} income />
            <Summary label="Beban (yang dianggarkan)" budget={r.totals.expenseBudget} actual={r.totals.expenseActual} />
          </div>
          <Panel>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse">
                <thead>
                  <tr>
                    <th className={th}>Akun</th>
                    <th className={thNum}>Anggaran</th>
                    <th className={thNum}>Realisasi</th>
                    <th className={thNum}>Selisih</th>
                    <th className={`${th} w-64`}>Capaian</th>
                  </tr>
                </thead>
                <tbody>
                  {r.rows.map((row) => (
                    <tr key={row.line.id} className="hover:bg-navy-100/30">
                      <td className="border-b border-line px-3 py-2 text-sm">
                        <Link className="hover:underline" to={`/analitik/item?akun=${row.account.id}&dari=${range.from}&sampai=${range.to}${row.analytic ? `&aa=${row.analytic.id}` : ''}`}>
                          <span className="num text-ink-soft">{row.account.code}</span> {row.account.name}
                        </Link>
                        {row.analytic && <div className="text-xs text-navy-600">{row.analytic.name}</div>}
                      </td>
                      <td className="num border-b border-line px-3 py-2 text-right text-sm">{formatAmount(row.budget)}</td>
                      <td className="num border-b border-line px-3 py-2 text-right text-sm">{formatAmount(row.actual)}</td>
                      <td className={`num border-b border-line px-3 py-2 text-right text-sm font-medium ${row.variance < 0 ? 'text-bad' : 'text-ok'}`}>{row.variance > 0 ? '+' : ''}{formatAmount(row.variance)}</td>
                      <td className="border-b border-line px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="relative h-2 flex-1 rounded-full bg-paper" aria-hidden>
                            <div className={`h-2 rounded-full ${STATUS_CLS[row.status]}`} style={{ width: `${Math.min(100, row.achievement ?? (row.actual ? 100 : 0))}%` }} />
                            <div className="absolute inset-y-[-3px] right-0 w-px bg-ink-soft" />
                          </div>
                          <span className={`num w-16 text-right text-sm ${row.status === 'bad' ? 'font-semibold text-bad' : ''}`}>{row.achievement === null ? '-' : `${row.achievement.toFixed(1)}%`}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {unbudgeted.length > 0 && (
              <div className="border-t border-line px-3 py-3">
                <h3 className="text-sm font-semibold text-orange-600">Realisasi tanpa anggaran</h3>
                <ul className="mt-1 text-sm">
                  {unbudgeted.map((u) => (
                    <li key={u.account.id} className="flex justify-between gap-4 py-0.5">
                      <Link className="hover:underline" to={`/analitik/item?akun=${u.account.id}&dari=${range.from}&sampai=${range.to}`}><span className="num text-ink-soft">{u.account.code}</span> {u.account.name}</Link>
                      <span className="num">{formatAmount(u.actual)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="px-3 py-2 text-xs text-ink-soft">Selisih positif = lebih baik dari anggaran (pendapatan di atas target, beban di bawah anggaran). Merah: beban melebihi anggaran atau pendapatan di bawah 90% target.</p>
          </Panel>
        </>
      )}
    </>
  );
}

function Summary({ label, budget, actual, income }: { label: string; budget: number; actual: number; income?: boolean }) {
  const pct = budget ? (actual / budget) * 100 : null;
  const good = income ? (pct ?? 0) >= 100 : (pct ?? 0) <= 100;
  return (
    <Panel className="p-5">
      <div className="text-sm text-ink-soft">{label}</div>
      <div className="num mt-1 text-2xl font-semibold text-navy">{formatAmount(actual)}</div>
      <div className="num text-sm text-ink-soft">dari anggaran {formatAmount(budget)}{pct !== null && <span className={`ml-2 font-medium ${good ? 'text-ok' : 'text-bad'}`}>{pct.toFixed(1)}%</span>}</div>
    </Panel>
  );
}
