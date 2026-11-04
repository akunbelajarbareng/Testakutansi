import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { UNALLOCATED, dimensionalPnl, type DateRange } from '../../domain';
import { formatAmount, formatDate } from '../../lib/format';
import { exportDimensionalXlsx } from '../../lib/excelExport';
import { useLedgerData } from '../../store/ledgerStore';
import { Alert, Button, PageHeader, Panel, errorMessage, inputClass } from '../../components/ui';
import { PeriodControls, ReportHeading, presetRange, type Preset } from '../reports/PeriodControls';

export function DimensionalPnlPage() {
  const data = useLedgerData();
  const [planId, setPlanId] = useState(data.analyticPlans[0]?.id ?? '');
  const [preset, setPreset] = useState<Preset>('thisMonth');
  const [range, setRange] = useState<DateRange>(presetRange('thisMonth')!);
  const [mode, setMode] = useState<'unallocated' | 'byRevenue'>('unallocated');
  const [error, setError] = useState<string | null>(null);
  const r = useMemo(() => dimensionalPnl(data, range, planId, mode), [data, range, planId, mode]);
  const plan = data.analyticPlans.find((p) => p.id === planId);
  const [showEmpty, setShowEmpty] = useState(false);
  const nonZero = (id: string) => r.sections.some((s) => s.lines.some((l) => (l.values[id] ?? 0) !== 0));
  const cols = showEmpty ? r.columns : r.columns.filter((c) => nonZero(c.id));
  const sections = r.sections.filter((s) => s.lines.length > 0 || s.key === 'cogs' || s.key === 'opex');
  const sumOf = (v: Record<string, number>) => cols.reduce((s, c) => s + (v[c.id] ?? 0), 0);
  const link = (accountId: string, colId: string) =>
    `/analitik/item?akun=${accountId}&dari=${range.from}&sampai=${range.to}${colId === UNALLOCATED ? `&belum=${planId}` : `&aa=${colId}`}`;

  const Cell = ({ v, strong, to }: { v: number; strong?: boolean; to?: string }) => (
    <td className={`num whitespace-nowrap border-b border-line px-3 py-2 text-right text-sm ${strong ? 'font-semibold' : ''} ${v < 0 ? 'text-bad' : ''}`}>
      {to && v !== 0 ? <Link className="hover:underline" to={to}>{formatAmount(v)}</Link> : formatAmount(v, !strong)}
    </td>
  );
  const Sub = ({ label, v, dark }: { label: string; v: Record<string, number>; dark?: boolean }) => (
    <tr className={dark ? 'bg-navy text-white' : 'bg-navy-100/40'}>
      <td className={`px-3 py-2 text-sm font-semibold ${dark ? '' : 'text-navy'}`}>{label}</td>
      {cols.map((c) => (
        <td key={c.id} className={`num whitespace-nowrap px-3 py-2 text-right text-sm font-semibold ${!dark && (v[c.id] ?? 0) < 0 ? 'text-bad' : ''}`}>{formatAmount(v[c.id] ?? 0)}</td>
      ))}
      <td className="num whitespace-nowrap px-3 py-2 text-right text-sm font-semibold">{formatAmount(sumOf(v))}</td>
    </tr>
  );

  return (
    <>
      <PageHeader
        title={`Laba Rugi per ${plan?.name ?? 'dimensi'}`}
        subtitle={`${formatDate(range.from)} sampai ${formatDate(range.to)}. Klik angka untuk melihat baris jurnalnya.`}
        actions={
          <div className="flex gap-2 print:hidden">
            <Button onClick={() => window.print()}>Cetak</Button>
            <Button
              variant="primary"
              onClick={async () => {
                setError(null);
                try {
                  await exportDimensionalXlsx(data, `Laba Rugi per ${plan?.name}`, `${formatDate(range.from)} sampai ${formatDate(range.to)}${mode === 'byRevenue' ? ' — biaya bersama dialokasikan menurut pendapatan' : ''}`, cols, r.sections, [
                    { label: 'Laba kotor', values: r.grossProfit },
                    { label: 'Laba usaha', values: r.operatingProfit },
                    { label: 'Laba bersih', values: r.netProfit },
                  ]);
                } catch (e) {
                  setError(errorMessage(e));
                }
              }}
            >
              Ekspor Excel
            </Button>
          </div>
        }
      />
      <ReportHeading company={data.company.name} title={`Laba Rugi per ${plan?.name}`} subtitle={`${formatDate(range.from)} sampai ${formatDate(range.to)}`} />

      <Panel className="mb-4 flex flex-wrap items-end gap-4 p-5 print:hidden">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Dimensi</span>
          <select className={`${inputClass} w-44`} value={planId} onChange={(e) => setPlanId(e.target.value)}>
            {data.analyticPlans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <PeriodControls preset={preset} range={range} onChange={(p, x) => { setPreset(p); setRange(x); }} />
        <div className="text-sm">
          <span className="mb-1 block font-medium">Biaya yang belum didistribusikan</span>
          <div className="flex rounded-md border border-line p-0.5" role="tablist">
            {(
              [
                ['unallocated', 'Tidak teralokasi'],
                ['byRevenue', 'Alokasi menurut pendapatan'],
              ] as const
            ).map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => setMode(k)} className={`rounded px-3 py-1.5 ${mode === k ? 'bg-navy text-white' : 'text-ink-soft hover:text-ink'}`}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-navy" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} />
          Tampilkan kolom kosong
        </label>
      </Panel>

      {error && <div className="mb-4"><Alert tone="error">{error}</Alert></div>}
      <div className="mb-4">
        {mode === 'unallocated' ? (
          <Alert tone="info">Setiap kolom menunjukkan kontribusi {plan?.name.toLowerCase()} sebelum biaya bersama. Biaya yang belum didistribusikan terlihat di kolom "Tidak teralokasi".</Alert>
        ) : (
          <Alert tone="warn">Biaya yang belum didistribusikan dibagi menurut porsi pendapatan tiap kolom. Ini perkiraan, bukan pemakaian sebenarnya.</Alert>
        )}
      </div>

      <Panel>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse" style={{ minWidth: 260 + cols.length * 140 }}>
            <thead>
              <tr>
                <th className="border-b border-line bg-paper px-3 py-2 text-left text-xs font-semibold text-ink-soft">Akun</th>
                {cols.map((c) => (
                  <th key={c.id} className={`border-b border-line bg-paper px-3 py-2 text-right text-xs font-semibold ${c.id === UNALLOCATED ? 'text-orange-600' : 'text-ink-soft'}`}>{c.name}</th>
                ))}
                <th className="border-b border-line bg-paper px-3 py-2 text-right text-xs font-semibold text-ink-soft">Total</th>
              </tr>
            </thead>
            <tbody>
              {sections.map((s) => (
                <SectionBlock key={s.key} title={s.title} colSpan={cols.length + 2}>
                  {s.lines.map((l) => (
                    <tr key={l.account.id} className="hover:bg-navy-100/30">
                      <td className="border-b border-line px-3 py-2 text-sm"><span className="num text-ink-soft">{l.account.code}</span> {l.account.name}</td>
                      {cols.map((c) => <Cell key={c.id} v={l.values[c.id] ?? 0} to={link(l.account.id, c.id)} />)}
                      <Cell v={sumOf(l.values)} strong />
                    </tr>
                  ))}
                  {s.key === 'cogs' && <Sub label="Laba kotor" v={r.grossProfit} />}
                  {s.key === 'opex' && <Sub label="Laba usaha" v={r.operatingProfit} />}
                </SectionBlock>
              ))}
              <Sub label="Laba bersih" v={r.netProfit} dark />
            </tbody>
          </table>
        </div>
      </Panel>
      <p className="mt-3 text-xs text-ink-soft print:hidden">
        Distribusi diatur di <Link className="underline" to="/analitik/dimensi">Dimensi & Model</Link>; baris yang belum terdistribusi bisa dirapikan di <Link className="underline" to="/analitik/item?belum=1">Edit Analitik</Link>.
      </p>
    </>
  );
}

function SectionBlock({ title, colSpan, children }: { title: string; colSpan: number; children: ReactNode }) {
  return (
    <>
      <tr><td colSpan={colSpan} className="border-b border-line bg-paper px-3 py-1.5 text-xs font-semibold text-ink-soft">{title}</td></tr>
      {children}
    </>
  );
}
