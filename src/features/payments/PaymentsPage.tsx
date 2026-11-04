import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { PaymentDirection } from '../../domain';
import { formatAmount, formatDate, todayISO } from '../../lib/format';
import { docPath } from '../../lib/paths';
import { useLedger, useLedgerData } from '../../store/ledgerStore';
import { Alert, Button, DocBadge, EmptyState, PageHeader, Panel, errorMessage, inputClass, td, tdNum, th, thNum } from '../../components/ui';
import { PaymentForm } from './PaymentForm';

export function PaymentsPage() {
  const data = useLedgerData();
  const cancelPayment = useLedger((s) => s.cancelPayment);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<'all' | PaymentDirection>('all');
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [cancelDate, setCancelDate] = useState(todayISO());
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const partners = new Map(data.partners.map((p) => [p.id, p]));
  const invoices = new Map(data.invoices.map((i) => [i.id, i]));
  const journals = new Map(data.journals.map((j) => [j.id, j]));

  const rows = useMemo(
    () => data.payments.filter((p) => filter === 'all' || p.direction === filter).sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number)),
    [data.payments, filter],
  );

  const onCancel = async (id: string) => {
    try {
      const p = await cancelPayment(id, cancelDate);
      setMessage({ tone: 'ok', text: `Pembayaran ${p.number} dibatalkan. Jurnalnya dibalik dan dokumen terkait kembali terbuka.` });
      setCancelling(null);
    } catch (e) {
      setMessage({ tone: 'error', text: errorMessage(e) });
    }
  };

  return (
    <>
      <PageHeader
        title="Pembayaran"
        subtitle="Penerimaan dari pelanggan dan pembayaran ke supplier, beserta dokumen yang dilunasi."
        actions={!creating && <Button variant="primary" onClick={() => setCreating(true)}>Catat pembayaran</Button>}
      />
      <div className="space-y-4">
        {message && <Alert tone={message.tone}>{message.text}</Alert>}
        {creating && (
          <PaymentForm
            onCancel={() => setCreating(false)}
            onDone={(p) => {
              setCreating(false);
              setMessage({ tone: 'ok', text: `Pembayaran ${p.number} dicatat.` });
            }}
          />
        )}

        <select className={`${inputClass} sm:max-w-xs`} value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Filter jenis">
          <option value="all">Semua pembayaran</option>
          <option value="inbound">Penerimaan dari pelanggan</option>
          <option value="outbound">Pembayaran ke supplier</option>
        </select>

        <Panel>
          {rows.length === 0 ? (
            <EmptyState title="Belum ada pembayaran." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse">
                <thead>
                  <tr>
                    <th className={th}>Nomor</th>
                    <th className={th}>Tanggal</th>
                    <th className={th}>Kontak</th>
                    <th className={th}>Lewat</th>
                    <th className={thNum}>Jumlah</th>
                    <th className={th}>Melunasi</th>
                    <th className={th}>Status</th>
                    <th className={th}><span className="sr-only">Aksi</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id} className="align-top">
                      <td className={`${td} whitespace-nowrap`}>
                        <Link className="font-medium text-navy-600 hover:underline" to={`/entri/${p.entryId}`}>{p.number}</Link>
                      </td>
                      <td className={`${td} whitespace-nowrap`}>{formatDate(p.date)}</td>
                      <td className={td}>
                        {partners.get(p.partnerId)?.name}
                        <div className="text-xs text-ink-soft">{p.direction === 'inbound' ? 'Penerimaan' : 'Pembayaran keluar'}</div>
                      </td>
                      <td className={td}>{journals.get(p.journalId)?.name}</td>
                      <td className={tdNum}>{p.direction === 'outbound' ? `-${formatAmount(p.amount)}` : formatAmount(p.amount)}</td>
                      <td className={`${td} text-xs`}>
                        {p.allocations.map((a) => {
                          const inv = invoices.get(a.invoiceId);
                          return inv ? (
                            <div key={a.invoiceId}>
                              <Link className="text-navy-600 hover:underline" to={docPath(inv)}>{inv.number}</Link> <span className="num text-ink-soft">{formatAmount(a.amount)}</span>
                            </div>
                          ) : null;
                        })}
                        {p.allocations.reduce((s, a) => s + a.amount, 0) < p.amount && (
                          <div className="text-ink-soft">{p.direction === 'inbound' ? 'Deposit' : 'Uang muka'} {formatAmount(p.amount - p.allocations.reduce((s, a) => s + a.amount, 0))}</div>
                        )}
                      </td>
                      <td className={td}><DocBadge state={p.status} /></td>
                      <td className={`${td} whitespace-nowrap`}>
                        {p.status === 'posted' &&
                          (cancelling === p.id ? (
                            <div className="flex flex-col gap-2">
                              <input type="date" className={inputClass} value={cancelDate} onChange={(e) => setCancelDate(e.target.value)} aria-label="Tanggal pembatalan" />
                              <div className="flex gap-1">
                                <Button variant="danger" onClick={() => onCancel(p.id)}>Batalkan</Button>
                                <Button variant="ghost" onClick={() => setCancelling(null)}>Tutup</Button>
                              </div>
                            </div>
                          ) : (
                            <Button variant="ghost" onClick={() => setCancelling(p.id)}>Batalkan…</Button>
                          ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
