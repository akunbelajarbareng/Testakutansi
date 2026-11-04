import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KIND_LABEL, invoiceResidual, invoiceTotals, isRefund, isSale } from '../../domain';
import { formatAmount, formatDate, todayISO } from '../../lib/format';
import { docPath } from '../../lib/paths';
import { useLedgerData } from '../../store/ledgerStore';
import { DocBadge, EmptyState, LinkButton, PageHeader, Panel, inputClass, td, tdNum, th, thNum } from '../../components/ui';
import { displayState } from './docState';

type Filter = 'all' | 'draft' | 'open' | 'overdue' | 'paid';

export function InvoicesListPage({ side }: { side: 'sale' | 'purchase' }) {
  const data = useLedgerData();
  const navigate = useNavigate();
  const today = todayISO();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const sale = side === 'sale';
  const base = sale ? '/faktur' : '/tagihan';

  const partners = useMemo(() => new Map(data.partners.map((p) => [p.id, p])), [data.partners]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.invoices
      .filter((i) => isSale(i.kind) === sale)
      .map((i) => ({
        inv: i,
        state: displayState(i, data, today),
        total: invoiceTotals(i, data.taxes).total,
        residual: i.status === 'posted' ? invoiceResidual(i, data) : invoiceTotals(i, data.taxes).total,
      }))
      .filter(({ state }) => {
        if (filter === 'all') return true;
        if (filter === 'open') return state === 'unpaid' || state === 'partial' || state === 'overdue';
        return state === filter;
      })
      .filter(({ inv }) => !needle || `${inv.number ?? ''} ${inv.reference} ${partners.get(inv.partnerId)?.name ?? ''}`.toLowerCase().includes(needle))
      .sort((a, b) => b.inv.date.localeCompare(a.inv.date) || b.inv.createdAt.localeCompare(a.inv.createdAt));
  }, [data, sale, filter, q, partners, today]);

  const openTotal = rows.filter((r) => r.inv.status === 'posted' && !isRefund(r.inv.kind)).reduce((s, r) => s + Math.max(0, r.residual), 0);

  return (
    <>
      <PageHeader
        title={sale ? 'Faktur Penjualan' : 'Tagihan Vendor'}
        subtitle={sale ? 'Tagihan ke pelanggan beserta nota kreditnya. Piutang tercatat otomatis saat diposting.' : 'Tagihan dari supplier beserta nota kreditnya. Utang tercatat otomatis saat diposting.'}
        actions={<LinkButton to={`${base}/baru`} variant="primary">{sale ? 'Faktur baru' : 'Tagihan baru'}</LinkButton>}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto]">
        <input className={inputClass} placeholder="Cari nomor, referensi, atau kontak" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari dokumen" />
        <select className={inputClass} value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Filter status">
          <option value="all">Semua status</option>
          <option value="draft">Draft</option>
          <option value="open">Belum lunas</option>
          <option value="overdue">Lewat jatuh tempo</option>
          <option value="paid">Lunas</option>
        </select>
      </div>

      <Panel>
        {rows.length === 0 ? (
          <EmptyState
            title={sale ? 'Belum ada faktur yang cocok.' : 'Belum ada tagihan yang cocok.'}
            action={<LinkButton to={`${base}/baru`} variant="primary">{sale ? 'Faktur baru' : 'Tagihan baru'}</LinkButton>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse">
              <thead>
                <tr>
                  <th className={th}>Nomor</th>
                  <th className={th}>{sale ? 'Pelanggan' : 'Supplier'}</th>
                  <th className={th}>Tanggal</th>
                  <th className={th}>Jatuh tempo</th>
                  <th className={thNum}>Total</th>
                  <th className={thNum}>Sisa</th>
                  <th className={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ inv, state, total, residual }) => (
                  <tr
                    key={inv.id}
                    tabIndex={0}
                    className="cursor-pointer hover:bg-navy-100/40 focus:bg-navy-100/40"
                    onClick={() => navigate(docPath(inv))}
                    onKeyDown={(e) => e.key === 'Enter' && navigate(docPath(inv))}
                  >
                    <td className={`${td} whitespace-nowrap font-medium`}>
                      {inv.number ?? <span className="text-ink-soft">Belum bernomor</span>}
                      {isRefund(inv.kind) && <span className="ml-2 text-xs font-normal text-ink-soft">{KIND_LABEL[inv.kind]}</span>}
                    </td>
                    <td className={td}>{partners.get(inv.partnerId)?.name}</td>
                    <td className={`${td} whitespace-nowrap`}>{formatDate(inv.date)}</td>
                    <td className={`${td} whitespace-nowrap ${state === 'overdue' ? 'font-medium text-bad' : ''}`}>
                      {isRefund(inv.kind) ? '-' : formatDate(inv.dueDate)}
                    </td>
                    <td className={tdNum}>{isRefund(inv.kind) ? `-${formatAmount(total)}` : formatAmount(total)}</td>
                    <td className={tdNum}>{isRefund(inv.kind) ? '' : formatAmount(residual, true)}</td>
                    <td className={td}><DocBadge state={state} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <p className="mt-3 text-xs text-ink-soft">
        {rows.length} dokumen ditampilkan. Sisa {sale ? 'piutang' : 'utang'} terbuka: <span className="num font-medium text-ink">{formatAmount(openTotal)}</span>
      </p>
    </>
  );
}
