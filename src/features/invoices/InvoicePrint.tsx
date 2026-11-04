import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { KIND_LABEL, invoiceTotals, isSale, lineSubtotal } from '../../domain';
import { formatAmount, formatDate, formatRupiah } from '../../lib/format';
import { docPath } from '../../lib/paths';
import { useLedgerData } from '../../store/ledgerStore';
import { Button, EmptyState } from '../../components/ui';

/** Tampilan cetak faktur/nota kredit penjualan. Gunakan Print → Save as PDF di browser. */
export function InvoicePrint() {
  const { id } = useParams();
  const data = useLedgerData();
  const navigate = useNavigate();
  const inv = data.invoices.find((i) => i.id === id);
  if (!inv || inv.status !== 'posted' || !isSale(inv.kind)) return <EmptyState title="Hanya faktur penjualan yang sudah diposting yang bisa dicetak." />;

  const partner = data.partners.find((p) => p.id === inv.partnerId);
  const totals = invoiceTotals(inv, data.taxes);
  const c = data.company;

  return (
    <>
      <div className="mb-4 flex gap-2 print:hidden">
        <Button onClick={() => navigate(docPath(inv))}>Kembali</Button>
        <Button variant="primary" onClick={() => window.print()}>Cetak / simpan PDF</Button>
      </div>

      <article className="mx-auto max-w-3xl bg-white p-8 text-sm text-ink shadow-sm ring-1 ring-line print:max-w-none print:p-0 print:shadow-none print:ring-0">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b-4 border-orange pb-5">
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-md bg-navy text-2xl font-bold text-white">{c.name.charAt(0)}</span>
            <div>
              <div className="text-xl font-semibold text-navy">{c.name}</div>
              {c.address && <div className="text-ink-soft">{c.address}</div>}
              {c.phone && <div className="text-ink-soft">Telp. {c.phone}</div>}
              {c.npwp && <div className="text-ink-soft">NPWP {c.npwp}</div>}
            </div>
          </div>
          <div className="text-right">
            <div className="text-lg font-semibold text-navy">{KIND_LABEL[inv.kind]}</div>
            <div className="num text-base">{inv.number}</div>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-6 py-5">
          <div>
            <div className="text-xs text-ink-soft">Ditagihkan kepada</div>
            <div className="font-semibold">{partner?.name}</div>
            {partner?.address && <div>{partner.address}</div>}
            {partner?.npwp && <div>NPWP {partner.npwp}</div>}
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 justify-self-end">
            <dt className="text-ink-soft">Tanggal</dt><dd>{formatDate(inv.date)}</dd>
            {inv.kind === 'out_invoice' && (<><dt className="text-ink-soft">Jatuh tempo</dt><dd>{formatDate(inv.dueDate)}</dd></>)}
            {inv.reference && (<><dt className="text-ink-soft">Referensi</dt><dd>{inv.reference}</dd></>)}
          </dl>
        </section>

        <table className="w-full border-collapse">
          <thead>
            <tr className="border-y border-navy text-left text-xs text-navy">
              <th className="py-2">Barang / jasa</th>
              <th className="py-2 text-right">Kuantitas</th>
              <th className="py-2 text-right">Harga</th>
              <th className="py-2 text-right">Jumlah</th>
            </tr>
          </thead>
          <tbody>
            {inv.lines.map((l) => (
              <tr key={l.id} className="border-b border-line">
                <td className="py-2">
                  {l.description}
                  {data.taxes.find((t) => t.id === l.taxId)?.rate === 0 && <span className="ml-1 text-xs text-ink-soft">(dibebaskan PPN)</span>}
                </td>
                <td className="num py-2 text-right">{l.quantity.toLocaleString('id-ID')}</td>
                <td className="num py-2 text-right">{formatAmount(l.unitPrice)}</td>
                <td className="num py-2 text-right">{formatAmount(lineSubtotal(l))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 flex justify-end">
          <dl className="w-72">
            <Row label="Subtotal" value={formatAmount(totals.untaxed)} />
            {totals.taxes.filter((t) => t.tax.rate > 0).map((t) => (
              <div key={t.tax.id}>
                <Row label="DPP nilai lain" value={formatAmount(t.dpp)} />
                <Row label={t.tax.name} value={formatAmount(t.amount)} />
              </div>
            ))}
            <div className="mt-1 border-t-2 border-navy pt-1">
              <Row label={<strong>Total</strong>} value={<strong>{formatRupiah(totals.total)}</strong>} />
            </div>
          </dl>
        </div>

        {inv.notes && <p className="mt-6 whitespace-pre-line">{inv.notes}</p>}
        <p className="mt-10 text-xs text-ink-soft">Dokumen ini adalah faktur komersial, bukan Faktur Pajak. Faktur Pajak diterbitkan terpisah melalui sistem DJP.</p>
      </article>
    </>
  );
}

function Row({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex justify-between py-0.5">
      <dt>{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  );
}
