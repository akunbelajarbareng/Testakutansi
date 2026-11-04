import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { balanceSheet, shiftMonth, monthEnd, type BsGroup } from '../../domain';
import { formatAmount, formatDate, todayISO } from '../../lib/format';
import { exportFinancialsXlsx } from '../../lib/excelExport';
import { useLedgerData } from '../../store/ledgerStore';
import { Alert, Button, Field, PageHeader, Panel, errorMessage, inputClass } from '../../components/ui';
import { ReportHeading } from './PeriodControls';

export function BalanceSheetPage() {
  const data = useLedgerData();
  const today = todayISO();
  const [asOf, setAsOf] = useState(today);
  const [cmp, setCmp] = useState<string>(monthEnd(shiftMonth(today.slice(0, 7), -1)));
  const [useCmp, setUseCmp] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const bs = useMemo(() => balanceSheet(data, asOf, useCmp ? cmp : undefined), [data, asOf, cmp, useCmp]);
  const from = `${asOf.slice(0, 4)}-01-01`;

  const Group = ({ g }: { g: BsGroup }) => (
    <div className="mb-4">
      <h3 className="mb-1 text-xs font-semibold text-ink-soft">{g.title}</h3>
      <table className="w-full border-collapse text-sm">
        <tbody>
          {g.lines.map((l) => (
            <tr key={l.account?.id ?? l.label} className="hover:bg-navy-100/30">
              <td className="border-b border-line py-1.5 pr-2">
                {l.account ? (
                  <Link className="hover:underline" to={`/buku-besar?akun=${l.account.id}&dari=${from}&sampai=${asOf}`}>
                    <span className="num text-ink-soft">{l.account.code}</span> {l.label}
                  </Link>
                ) : (
                  <Link className="italic hover:underline" to="/laporan/laba-rugi">{l.label}</Link>
                )}
              </td>
              <td className={`num border-b border-line py-1.5 text-right ${l.amount < 0 ? 'text-bad' : ''}`}>{formatAmount(l.amount)}</td>
              {useCmp && <td className="num w-36 border-b border-line py-1.5 text-right text-ink-soft">{formatAmount(l.compare ?? 0)}</td>}
            </tr>
          ))}
          <tr>
            <td className="py-1.5 font-medium">Total {g.title.toLowerCase()}</td>
            <td className="num py-1.5 text-right font-medium">{formatAmount(g.total)}</td>
            {useCmp && <td className="num py-1.5 text-right text-ink-soft">{formatAmount(g.compareTotal ?? 0)}</td>}
          </tr>
        </tbody>
      </table>
    </div>
  );

  const Total = ({ label, v, c }: { label: string; v: number; c?: number }) => (
    <div className="flex justify-between gap-4 rounded-md bg-navy px-4 py-3 text-white">
      <span className="font-semibold">{label}</span>
      <span className="num font-semibold">
        {formatAmount(v)}
        {useCmp && <span className="ml-4 text-sm font-normal text-navy-100/80">{formatAmount(c ?? 0)}</span>}
      </span>
    </div>
  );

  return (
    <>
      <PageHeader
        title="Neraca"
        subtitle={`Posisi keuangan per ${formatDate(asOf)}${useCmp ? `, dibandingkan dengan ${formatDate(cmp)}` : ''}.`}
        actions={
          <div className="flex gap-2 print:hidden">
            <Button onClick={() => window.print()}>Cetak</Button>
            <Button
              variant="primary"
              onClick={async () => {
                setError(null);
                try {
                  await exportFinancialsXlsx(data, { from, to: asOf }, asOf);
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
      <ReportHeading company={data.company.name} title="Neraca" subtitle={`Per ${formatDate(asOf)}`} />

      <Panel className="mb-4 flex flex-wrap items-end gap-4 p-5 print:hidden">
        <div className="w-44"><Field label="Per tanggal"><input type="date" className={inputClass} value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field></div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-navy" checked={useCmp} onChange={(e) => setUseCmp(e.target.checked)} />
          Bandingkan dengan
        </label>
        {useCmp && <div className="w-44"><input type="date" className={inputClass} value={cmp} onChange={(e) => setCmp(e.target.value)} aria-label="Tanggal pembanding" /></div>}
      </Panel>

      <div className="mb-4">
        {error && <Alert tone="error">{error}</Alert>}
        {bs.balanced ? (
          <Alert tone="ok">Seimbang: total aset sama dengan total kewajiban ditambah ekuitas.</Alert>
        ) : (
          <Alert tone="error">Neraca tidak seimbang. Periksa neraca saldo.</Alert>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2 print:grid-cols-2">
        <Panel className="flex flex-col p-5">
          <h2 className="mb-3 text-base font-semibold text-navy">Aset</h2>
          {bs.assets.map((g) => <Group key={g.title} g={g} />)}
          <div className="mt-auto"><Total label="Total aset" v={bs.totalAssets} c={bs.cmpTotals?.assets} /></div>
        </Panel>
        <Panel className="flex flex-col p-5">
          <h2 className="mb-3 text-base font-semibold text-navy">Kewajiban & ekuitas</h2>
          {bs.liabilities.map((g) => <Group key={g.title} g={g} />)}
          {bs.equity.map((g) => <Group key={g.title} g={g} />)}
          <div className="mt-auto"><Total label="Total kewajiban + ekuitas" v={bs.totalLiabilities + bs.totalEquity} c={bs.cmpTotals ? bs.cmpTotals.liabilities + bs.cmpTotals.equity : undefined} /></div>
        </Panel>
      </div>
      {useCmp && <p className="mt-2 text-xs text-ink-soft">Kolom abu-abu: posisi per {formatDate(cmp)}.</p>}
    </>
  );
}
