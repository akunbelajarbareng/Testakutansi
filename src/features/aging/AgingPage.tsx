import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AGING_BUCKETS, agingReport } from '../../domain';
import { formatAmount, formatDate, todayISO } from '../../lib/format';
import { docPath } from '../../lib/paths';
import { useLedgerData } from '../../store/ledgerStore';
import { EmptyState, Field, PageHeader, Panel, inputClass, td, tdNum, th, thNum } from '../../components/ui';

export function AgingPage() {
  const data = useLedgerData();
  const [side, setSide] = useState<'receivable' | 'payable'>('receivable');
  const [asOf, setAsOf] = useState(todayISO());
  const [open, setOpen] = useState<string | null>(null);
  const report = useMemo(() => agingReport(data, side, asOf), [data, side, asOf]);

  return (
    <>
      <PageHeader title="Umur Piutang & Utang" subtitle="Sisa tagihan terbuka dikelompokkan menurut lama keterlambatan dari jatuh tempo." />

      <Panel className="mb-4 flex flex-wrap items-end gap-4 p-5">
        <div className="flex rounded-md border border-line p-0.5" role="tablist">
          {(['receivable', 'payable'] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={side === s}
              onClick={() => setSide(s)}
              className={`rounded px-4 py-1.5 text-sm ${side === s ? 'bg-navy text-white' : 'text-ink-soft hover:text-ink'}`}
            >
              {s === 'receivable' ? 'Piutang' : 'Utang'}
            </button>
          ))}
        </div>
        <div className="w-44">
          <Field label="Per tanggal"><input type="date" className={inputClass} value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field>
        </div>
      </Panel>

      <Panel>
        {report.rows.length === 0 ? (
          <EmptyState title={side === 'receivable' ? 'Tidak ada piutang terbuka.' : 'Tidak ada utang terbuka.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] border-collapse">
              <thead>
                <tr>
                  <th className={th}>{side === 'receivable' ? 'Pelanggan' : 'Supplier'}</th>
                  {AGING_BUCKETS.map((b) => <th key={b} className={thNum}>{b}</th>)}
                  <th className={thNum}>Total</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <Fragment key={r.partner.id}>
                    <tr
                      tabIndex={0}
                      aria-expanded={open === r.partner.id}
                      className="cursor-pointer hover:bg-navy-100/40"
                      onClick={() => setOpen(open === r.partner.id ? null : r.partner.id)}
                      onKeyDown={(e) => e.key === 'Enter' && setOpen(open === r.partner.id ? null : r.partner.id)}
                    >
                      <td className={`${td} font-medium`}>
                        <span className="mr-2 inline-block w-3 text-ink-soft">{open === r.partner.id ? '−' : '+'}</span>
                        {r.partner.name}
                      </td>
                      {r.buckets.map((v, i) => (
                        <td key={i} className={`${tdNum} ${i >= 2 && v > 0 ? 'font-medium text-bad' : ''}`}>{formatAmount(v, true)}</td>
                      ))}
                      <td className={`${tdNum} font-semibold`}>{formatAmount(r.total)}</td>
                    </tr>
                    {open === r.partner.id &&
                      r.invoices.map(({ invoice, residual, bucket }) => (
                        <tr key={invoice.id} className="bg-paper/60 text-sm">
                          <td className={`${td} pl-10`}>
                            <Link className="text-navy-600 hover:underline" to={docPath(invoice)}>{invoice.number}</Link>
                            <span className="ml-2 text-xs text-ink-soft">jatuh tempo {formatDate(invoice.dueDate)}</span>
                          </td>
                          {AGING_BUCKETS.map((_, i) => <td key={i} className={tdNum}>{i === bucket ? formatAmount(residual) : ''}</td>)}
                          <td className={tdNum} />
                        </tr>
                      ))}
                  </Fragment>
                ))}
                <tr className="bg-paper/60 font-semibold">
                  <td className={td}>Total</td>
                  {report.totals.map((v, i) => <td key={i} className={tdNum}>{formatAmount(v)}</td>)}
                  <td className={tdNum}>{formatAmount(report.grandTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
