import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { comparePeriod, pillarMargins, profitAndLoss, type DateRange } from '../../domain';
import { formatAmount, formatDate } from '../../lib/format';
import { exportFinancialsXlsx } from '../../lib/excelExport';
import { useLedgerData } from '../../store/ledgerStore';
import { Alert, Button, PageHeader, Panel, errorMessage, inputClass, th, thNum } from '../../components/ui';
import { PeriodControls, ReportHeading, presetRange, type Preset } from './PeriodControls';

type Compare = 'none' | 'previous' | 'lastYear';

const ledgerLink = (accountId: string, r: DateRange) => `/buku-besar?akun=${accountId}&dari=${r.from}&sampai=${r.to}`;

export function ProfitLossPage() {
  const data = useLedgerData();
  const [preset, setPreset] = useState<Preset>('thisMonth');
  const [range, setRange] = useState<DateRange>(presetRange('thisMonth')!);
  const [cmpMode, setCmpMode] = useState<Compare>('previous');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const cmpRange = cmpMode === 'none' ? undefined : comparePeriod(range, cmpMode);
  const pnl = useMemo(() => profitAndLoss(data, range, cmpRange), [data, range, cmpRange?.from, cmpRange?.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const pillars = useMemo(() => pillarMargins(data, range), [data, range]);
  const hasCmp = !!cmpRange;

  const onExport = async () => {
    setError(null);
    setBusy(true);
    try {
      await exportFinancialsXlsx(data, range, range.to);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const Num = ({ v, strong }: { v: number; strong?: boolean }) => (
    <td className={`num whitespace-nowrap border-b border-line px-3 py-2 text-right text-sm ${strong ? 'font-semibold' : ''} ${v < 0 ? 'text-bad' : ''}`}>{formatAmount(v)}</td>
  );
  const Delta = ({ a, b }: { a: number; b: number }) => {
    if (!hasCmp) return null;
    const pct = b ? ((a - b) / Math.abs(b)) * 100 : null;
    return <td className="num whitespace-nowrap border-b border-line px-3 py-2 text-right text-xs text-ink-soft">{pct === null ? '' : `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`}</td>;
  };
  const Subtotal = ({ label, v, c }: { label: string; v: number; c?: number }) => (
    <tr className="bg-navy-100/40">
      <td className="border-b border-line px-3 py-2 text-sm font-semibold text-navy" colSpan={2}>{label}</td>
      <Num v={v} strong />
      {hasCmp && <Num v={c ?? 0} />}
      <Delta a={v} b={c ?? 0} />
    </tr>
  );

  return (
    <>
      <PageHeader
        title="Laba Rugi"
        subtitle={`${formatDate(range.from)} sampai ${formatDate(range.to)}. Klik angka untuk menelusuri ke buku besar.`}
        actions={
          <div className="flex gap-2 print:hidden">
            <Button onClick={() => window.print()}>Cetak</Button>
            <Button variant="primary" onClick={onExport} disabled={busy}>{busy ? 'Menyiapkan…' : 'Ekspor Excel'}</Button>
          </div>
        }
      />
      <ReportHeading company={data.company.name} title="Laporan Laba Rugi" subtitle={`${formatDate(range.from)} sampai ${formatDate(range.to)}`} />

      <Panel className="mb-4 flex flex-wrap items-end gap-4 p-5 print:hidden">
        <PeriodControls preset={preset} range={range} onChange={(p, r) => { setPreset(p); setRange(r); }} />
        <label className="text-sm">
          <span className="mb-1 block font-medium">Bandingkan dengan</span>
          <select className={`${inputClass} w-48`} value={cmpMode} onChange={(e) => setCmpMode(e.target.value as Compare)}>
            <option value="none">Tidak dibandingkan</option>
            <option value="previous">Periode sebelumnya</option>
            <option value="lastYear">Periode sama tahun lalu</option>
          </select>
        </label>
      </Panel>
      {error && <div className="mb-4"><Alert tone="error">{error}</Alert></div>}

      <Panel className="mb-6">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr>
                <th className={`${th} w-16`}>Kode</th>
                <th className={th}>Akun</th>
                <th className={thNum}>{formatDate(range.from)} – {formatDate(range.to)}</th>
                {hasCmp && <th className={thNum}>{formatDate(cmpRange!.from)} – {formatDate(cmpRange!.to)}</th>}
                {hasCmp && <th className={thNum}>Perubahan</th>}
              </tr>
            </thead>
            <tbody>
              {pnl.sections.map((s) => (
                <SectionRows key={s.key} section={s} range={range} hasCmp={hasCmp} Num={Num} Delta={Delta}>
                  {s.key === 'cogs' && <Subtotal label="Laba Kotor" v={pnl.grossProfit} c={pnl.cmp?.grossProfit} />}
                  {s.key === 'opex' && <Subtotal label="Laba Usaha" v={pnl.operatingProfit} c={pnl.cmp?.operatingProfit} />}
                  {s.key === 'other' && <Subtotal label="Laba Sebelum Pajak" v={pnl.profitBeforeTax} c={pnl.cmp?.profitBeforeTax} />}
                </SectionRows>
              ))}
              <tr className="bg-navy text-white">
                <td className="px-3 py-3 font-semibold" colSpan={2}>Laba Bersih</td>
                <td className="num px-3 py-3 text-right text-lg font-semibold">{formatAmount(pnl.netProfit)}</td>
                {hasCmp && <td className="num px-3 py-3 text-right">{formatAmount(pnl.cmp!.netProfit)}</td>}
                {hasCmp && <td className="num px-3 py-3 text-right text-xs">{pnl.cmp!.netProfit ? `${pnl.netProfit >= pnl.cmp!.netProfit ? '+' : ''}${(((pnl.netProfit - pnl.cmp!.netProfit) / Math.abs(pnl.cmp!.netProfit)) * 100).toFixed(1)}%` : ''}</td>}
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>

      <h2 className="mb-2 text-base font-semibold text-navy">Laba kotor per pilar</h2>
      {pillars.estimated && (
        <div className="mb-3">
          <Alert tone="warn">HPP periode ini dibagi ke pilar secara proporsional terhadap penjualan, sehingga margin antar pilar cenderung sama. Koreksi pembagiannya di Penyesuaian HPP untuk angka yang lebih tepat.</Alert>
        </div>
      )}
      <Panel>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr>
                <th className={th}>Pilar</th>
                <th className={thNum}>Pendapatan</th>
                <th className={thNum}>HPP</th>
                <th className={thNum}>Laba kotor</th>
                <th className={`${th} w-56`}>Margin</th>
              </tr>
            </thead>
            <tbody>
              {pillars.rows.map((r) => (
                <tr key={r.key}>
                  <td className="border-b border-line px-3 py-2 text-sm font-medium">{r.name}</td>
                  <Num v={r.revenue} />
                  <Num v={r.cogs} />
                  <Num v={r.grossProfit} strong />
                  <td className="border-b border-line px-3 py-2">
                    {r.margin === null ? (
                      <span className="text-xs text-ink-soft">-</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 rounded-full bg-paper" aria-hidden>
                          <div className={`h-2 rounded-full ${r.margin >= 0 ? 'bg-ok' : 'bg-bad'}`} style={{ width: `${Math.min(100, Math.abs(r.margin))}%` }} />
                        </div>
                        <span className="num w-14 text-right text-sm">{r.margin.toFixed(1)}%</span>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {pillars.rows.length === 0 && <tr><td className="px-3 py-4 text-sm text-ink-soft" colSpan={5}>Belum ada pendapatan di periode ini.</td></tr>}
            </tbody>
          </table>
        </div>
        {pillars.unallocated.length > 0 && (
          <p className="border-t border-line px-3 py-2 text-xs text-ink-soft">
            Belum dibagi per pilar: {pillars.unallocated.map((u) => `${u.label} ${formatAmount(Math.abs(u.amount))}`).join(', ')}.
          </p>
        )}
      </Panel>
      <p className="mt-3 text-xs text-ink-soft print:hidden">
        Laba per pilar setelah beban operasional menunggu modul analitik. Jurnal penutup tahun tidak ikut dihitung di laporan ini. <Link className="underline" to="/tutup-buku">Tutup buku</Link>
      </p>
    </>
  );
}

function SectionRows({
  section,
  range,
  hasCmp,
  Num,
  Delta,
  children,
}: {
  section: ReturnType<typeof profitAndLoss>['sections'][number];
  range: DateRange;
  hasCmp: boolean;
  Num: (p: { v: number; strong?: boolean }) => ReactNode;
  Delta: (p: { a: number; b: number }) => ReactNode;
  children?: ReactNode;
}) {
  return (
    <>
      <tr>
        <td colSpan={hasCmp ? 5 : 3} className="border-b border-line bg-paper px-3 py-1.5 text-xs font-semibold text-ink-soft">{section.title}</td>
      </tr>
      {section.lines.length === 0 && (
        <tr><td colSpan={hasCmp ? 5 : 3} className="border-b border-line px-3 py-2 text-sm text-ink-soft">Tidak ada</td></tr>
      )}
      {section.lines.map((l) => (
        <tr key={l.account.id} className="hover:bg-navy-100/30">
          <td className="num border-b border-line px-3 py-2 text-sm text-ink-soft">{l.account.code}</td>
          <td className="border-b border-line px-3 py-2 text-sm">
            <Link className="hover:underline" to={ledgerLink(l.account.id, range)}>{l.account.name}</Link>
          </td>
          <Num v={l.amount} />
          {hasCmp && <Num v={l.compare ?? 0} />}
          <Delta a={l.amount} b={l.compare ?? 0} />
        </tr>
      ))}
      {section.lines.length > 0 && (
        <tr>
          <td className="border-b border-line px-3 py-2 text-sm italic text-ink-soft" colSpan={2}>Total {section.title.toLowerCase()}</td>
          <Num v={section.total} strong />
          {hasCmp && <Num v={section.compareTotal ?? 0} />}
          <Delta a={section.total} b={section.compareTotal ?? 0} />
        </tr>
      )}
      {children}
    </>
  );
}
