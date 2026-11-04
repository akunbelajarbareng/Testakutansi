import { useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  KIND_LABEL,
  invoiceResidual,
  invoiceTotals,
  isRefund,
  isSale,
  lineSubtotal,
  paidAmount,
  refundedAmount,
  type Invoice,
} from '../../domain';
import { formatAmount, formatDate, todayISO } from '../../lib/format';
import { docPath } from '../../lib/paths';
import { useLedger, useLedgerData } from '../../store/ledgerStore';
import { Alert, Button, DocBadge, LinkButton, PageHeader, Panel, errorMessage, td, tdNum, th, thNum } from '../../components/ui';
import { PaymentForm } from '../payments/PaymentForm';
import { InvoiceTotalsBox } from './InvoiceTotalsBox';
import { displayState } from './docState';

/** Dokumen diposting: baca-saja. Koreksi lewat nota kredit, pelunasan lewat pembayaran. */
export function InvoiceView({ invoice }: { invoice: Invoice }) {
  const data = useLedgerData();
  const createRefund = useLedger((s) => s.createRefund);
  const navigate = useNavigate();
  const navState = useLocation().state as { notice?: string } | null;
  const [paying, setPaying] = useState(false);
  const [notice, setNotice] = useState(navState?.notice ?? null);
  const [error, setError] = useState<string | null>(null);

  const today = todayISO();
  const sale = isSale(invoice.kind);
  const refund = isRefund(invoice.kind);
  const partner = data.partners.find((p) => p.id === invoice.partnerId);
  const totals = invoiceTotals(invoice, data.taxes);
  const residual = invoiceResidual(invoice, data);
  const state = displayState(invoice, data, today);
  const accounts = new Map(data.accounts.map((a) => [a.id, a]));
  const taxes = new Map(data.taxes.map((t) => [t.id, t]));
  const origin = invoice.refundOfId ? data.invoices.find((i) => i.id === invoice.refundOfId) : undefined;
  const refunds = data.invoices.filter((i) => i.refundOfId === invoice.id);
  const payments = data.payments.filter((p) => p.allocations.some((a) => a.invoiceId === invoice.id));

  const onRefund = async () => {
    setError(null);
    try {
      const r = await createRefund(invoice.id, today);
      navigate(docPath(r), { state: { notice: 'Draft nota kredit dibuat dari dokumen asal. Sesuaikan kuantitas barang yang diretur, lalu posting.' } });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <>
      <PageHeader
        back={origin ? { to: docPath(origin), label: origin.number ?? '' } : { to: sale ? '/faktur' : '/tagihan', label: sale ? 'Faktur Penjualan' : 'Tagihan Vendor' }}
        title={invoice.number ?? ''}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            {KIND_LABEL[invoice.kind]} <DocBadge state={state} />
          </span>
        }
        actions={
          <>
            {sale && <LinkButton to={`/cetak/${invoice.id}`}>Cetak</LinkButton>}
            {!refund && residual > 0 && <Button onClick={onRefund}>Buat nota kredit</Button>}
            {!refund && residual > 0 && !paying && (
              <Button variant="primary" onClick={() => setPaying(true)}>{sale ? 'Terima pembayaran' : 'Bayar'}</Button>
            )}
          </>
        }
      />

      <div className="space-y-4">
        {notice && <Alert tone="ok">{notice}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}

        {paying && (
          <PaymentForm
            direction={sale ? 'inbound' : 'outbound'}
            partnerId={invoice.partnerId}
            invoiceId={invoice.id}
            onCancel={() => setPaying(false)}
            onDone={(p) => {
              setPaying(false);
              setNotice(`Pembayaran ${p.number} dicatat.`);
            }}
          />
        )}

        <Panel className="grid gap-4 p-5 text-sm sm:grid-cols-3 lg:grid-cols-5">
          <Info label={sale ? 'Pelanggan' : 'Supplier'} value={partner?.name ?? '-'} />
          <Info label="Tanggal" value={formatDate(invoice.date)} />
          {!refund && <Info label="Jatuh tempo" value={<span className={state === 'overdue' ? 'font-medium text-bad' : ''}>{formatDate(invoice.dueDate)}</span>} />}
          <Info label={sale ? 'No. PO pelanggan' : 'No. faktur supplier'} value={invoice.reference || '-'} />
          <Info label="Entri jurnal" value={invoice.entryId ? <Link className="text-navy-600 hover:underline" to={`/entri/${invoice.entryId}`}>Lihat jurnal</Link> : '-'} />
          {invoice.kind === 'in_invoice' && (
            <Info label="Faktur Pajak supplier" value={invoice.supplierTaxInvoiceNumber ? <Link className="num text-navy-600 hover:underline" to="/pajak/masukan">{invoice.supplierTaxInvoiceNumber}</Link> : <Link className="text-orange-600 hover:underline" to="/pajak/masukan">Belum diisi</Link>} />
          )}
          {origin && <Info label="Mengoreksi" value={<Link className="text-navy-600 hover:underline" to={docPath(origin)}>{origin.number}</Link>} />}
        </Panel>

        <Panel>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse">
              <thead>
                <tr>
                  <th className={th}>Barang / jasa</th>
                  <th className={th}>Akun</th>
                  <th className={thNum}>Kuantitas</th>
                  <th className={thNum}>Harga satuan</th>
                  <th className={th}>Pajak</th>
                  <th className={thNum}>Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {invoice.lines.map((l) => {
                  const a = accounts.get(l.accountId);
                  return (
                    <tr key={l.id}>
                      <td className={td}>{l.description}</td>
                      <td className={`${td} text-ink-soft`}>{a ? `${a.code} ${a.name}` : '-'}</td>
                      <td className={tdNum}>{l.quantity.toLocaleString('id-ID')}</td>
                      <td className={tdNum}>{formatAmount(l.unitPrice)}</td>
                      <td className={`${td} text-ink-soft`}>{taxes.get(l.taxId)?.name}</td>
                      <td className={tdNum}>{formatAmount(lineSubtotal(l))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap justify-between gap-6 p-5">
            <p className="max-w-md text-sm text-ink-soft">{invoice.notes}</p>
            <InvoiceTotalsBox
              totals={totals}
              extra={
                refund
                  ? undefined
                  : [
                      { label: 'Dibayar', value: -paidAmount(invoice, data) },
                      { label: 'Nota kredit', value: -refundedAmount(invoice, data) },
                      { label: 'Sisa tagihan', value: residual, strong: true, tone: residual > 0 ? 'text-orange-600' : 'text-ok' },
                    ]
              }
            />
          </div>
        </Panel>

        {(payments.length > 0 || refunds.length > 0) && (
          <Panel className="p-5">
            <h2 className="mb-3 text-base font-semibold text-navy">Riwayat pelunasan</h2>
            <ul className="divide-y divide-line text-sm">
              {payments.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <Link className="font-medium text-navy-600 hover:underline" to={`/entri/${p.entryId}`}>{p.number}</Link>
                    <span className="ml-2 text-ink-soft">{formatDate(p.date)}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="num">{formatAmount(p.allocations.find((a) => a.invoiceId === invoice.id)?.amount ?? 0)}</span>
                    <DocBadge state={p.status} />
                  </span>
                </li>
              ))}
              {refunds.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <Link className="font-medium text-navy-600 hover:underline" to={docPath(r)}>{r.number ?? 'Draft nota kredit'}</Link>
                    <span className="ml-2 text-ink-soft">{KIND_LABEL[r.kind]}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="num">{formatAmount(invoiceTotals(r, data.taxes).total)}</span>
                    <DocBadge state={r.status === 'draft' ? 'draft' : 'applied'} />
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
    </>
  );
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-xs text-ink-soft">{label}</div>
      <div className="mt-0.5 text-ink">{value}</div>
    </div>
  );
}
