import { useState } from 'react';
import { Link } from 'react-router-dom';
import { invoiceTotals, outputTaxGroups, ppnSummary } from '../../domain';
import { daysBetween } from '../../domain/invoicing';
import { formatDate, formatMonth, formatRupiah, todayISO } from '../../lib/format';
import { useLedger, useLedgerData } from '../../store/ledgerStore';
import { Alert, Button, DocBadge, Field, PageHeader, Panel, errorMessage, inputClass } from '../../components/ui';
import { MonthPicker, TemplateWarning } from './common';

export function TaxOverviewPage() {
  const data = useLedgerData();
  const store = useLedger();
  const today = todayISO();
  const [period, setPeriod] = useState(today.slice(0, 7));
  const [pay, setPay] = useState({ journalId: data.journals.find((j) => j.type === 'bank')?.id ?? '', date: today, ntpn: '' });
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const s = ppnSummary(data, period);
  const groups = outputTaxGroups(data, period);
  const notIssued = groups.filter((g) => g.record?.status !== 'issued').length;
  const daysLeft = daysBetween(today, s.dueDate);
  const missingPm = data.invoices.filter((i) => i.kind === 'in_invoice' && i.status === 'posted' && i.date.startsWith(period) && !i.supplierTaxInvoiceNumber && invoiceTotals(i, data.taxes).tax > 0).length;

  const run = async (fn: () => Promise<void>, ok: string) => {
    setMessage(null);
    try {
      await fn();
      setMessage({ tone: 'ok', text: ok });
    } catch (e) {
      setMessage({ tone: 'error', text: errorMessage(e) });
    }
  };

  const Row = ({ label, v, strong, hint }: { label: string; v: number; strong?: boolean; hint?: string }) => (
    <div className={`flex justify-between gap-6 py-1.5 ${strong ? 'border-t border-line pt-2 font-semibold' : ''}`}>
      <dt>{label}{hint && <span className="block text-xs font-normal text-ink-soft">{hint}</span>}</dt>
      <dd className="num">{formatRupiah(v)}</dd>
    </div>
  );

  return (
    <>
      <PageHeader title="Ringkasan PPN" subtitle="Rekap SPT Masa PPN, kompensasi, dan setoran." />
      <div className="space-y-4">
        <TemplateWarning />
        {message && <Alert tone={message.tone}>{message.text}</Alert>}

        <Panel className="flex flex-wrap items-end gap-6 p-5">
          <MonthPicker value={period} onChange={setPeriod} />
          <div className="pb-5 text-sm">
            <div className="text-ink-soft">Batas lapor & setor</div>
            <div className={`font-semibold ${!s.record || s.record.status === 'settled' ? (daysLeft < 0 ? 'text-bad' : daysLeft <= 7 ? 'text-orange-600' : 'text-ink') : 'text-ok'}`}>
              {formatDate(s.dueDate)}
              {(!s.record || s.record.status === 'settled') && s.net > 0 && (daysLeft < 0 ? `, terlambat ${-daysLeft} hari` : `, ${daysLeft} hari lagi`)}
            </div>
          </div>
        </Panel>

        <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
          <Panel className="p-5">
            <h2 className="mb-2 text-base font-semibold text-navy">Rekap masa {formatMonth(period)}</h2>
            <dl className="text-sm">
              <Row label="PPN Keluaran dari Faktur Pajak" v={s.outputInvoices} hint="Faktur penjualan dikurangi nota kredit" />
              <Row label="PPN Keluaran penjualan eceran (digunggung)" v={s.outputRetail} />
              <Row label="Total PPN Keluaran" v={s.outputTax} strong />
              <Row label="PPN Masukan yang dikreditkan" v={-s.inputTax} />
              {s.priorCredit > 0 && <Row label="Kompensasi lebih bayar masa lalu" v={-s.priorCredit} />}
              <div className={`mt-2 flex justify-between rounded-md px-3 py-2 font-semibold ${s.net > 0 ? 'bg-orange-100 text-orange-600' : 'bg-ok-100 text-ok'}`}>
                <span>{s.net > 0 ? 'Kurang bayar (wajib disetor)' : s.net < 0 ? 'Lebih bayar (dikompensasi ke masa berikutnya)' : 'Nihil'}</span>
                <span className="num">{formatRupiah(Math.abs(s.net))}</span>
              </div>
            </dl>
            <div className="mt-3">
              {s.glMatches ? (
                <p className="text-sm text-ok">PPN Keluaran di buku besar sama dengan rekap.</p>
              ) : (
                <Alert tone="error">PPN Keluaran di buku {formatRupiah(s.glOutput)} tidak sama dengan rekap {formatRupiah(s.outputTax)}. Periksa jurnal manual ke akun PPN Keluaran.</Alert>
              )}
            </div>
          </Panel>

          <div className="space-y-4">
            <Panel className="p-5 text-sm">
              <h2 className="mb-2 text-base font-semibold text-navy">Kelengkapan</h2>
              <ul className="space-y-2">
                <li className="flex justify-between gap-2">
                  <Link className="hover:underline" to="/pajak/keluaran">Faktur Pajak Keluaran terbit</Link>
                  <span className={notIssued ? 'font-medium text-orange-600' : 'text-ok'}>{groups.length - notIssued}/{groups.length}</span>
                </li>
                <li className="flex justify-between gap-2">
                  <Link className="hover:underline" to="/pajak/masukan">Tagihan tanpa nomor Faktur Pajak</Link>
                  <span className={missingPm ? 'font-medium text-orange-600' : 'text-ok'}>{missingPm}</span>
                </li>
              </ul>
            </Panel>

            <Panel className="p-5 text-sm">
              <h2 className="mb-2 text-base font-semibold text-navy">Kompensasi & setor</h2>
              {!s.record ? (
                <>
                  <p className="text-ink-soft">Jurnal akhir masa: PPN Keluaran dikompensasi dengan PPN Masukan; sisanya menjadi Utang PPN (2204) atau PPN Lebih Bayar (1404).</p>
                  <Button variant="primary" className="mt-3" onClick={() => run(() => store.settlePpn(period), `Kompensasi PPN ${formatMonth(period)} dibuat.`)}>Buat jurnal kompensasi</Button>
                </>
              ) : (
                <>
                  <p className="flex items-center gap-2">
                    <DocBadge state={s.record.status === 'paid' ? 'paid' : 'posted'} />
                    <Link className="text-navy-600 hover:underline" to={`/entri/${s.record.settlementEntryId}`}>Jurnal kompensasi</Link>
                    {s.record.paymentEntryId && <Link className="text-navy-600 hover:underline" to={`/entri/${s.record.paymentEntryId}`}>Jurnal setor</Link>}
                  </p>
                  {s.record.status === 'paid' && <p className="mt-2">Disetor {formatDate(s.record.paidDate!)}, NTPN {s.record.ntpn}.</p>}
                  {s.record.status === 'settled' && s.record.net > 0 && (
                    <div className="mt-3 grid gap-3">
                      <Field label="Dibayar dari">
                        <select className={inputClass} value={pay.journalId} onChange={(e) => setPay({ ...pay, journalId: e.target.value })}>
                          {data.journals.filter((j) => j.type === 'bank').map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
                        </select>
                      </Field>
                      <Field label="Tanggal setor"><input type="date" className={inputClass} value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} /></Field>
                      <Field label="NTPN" hint="16 karakter dari bukti penerimaan negara"><input className={`${inputClass} uppercase`} maxLength={16} value={pay.ntpn} onChange={(e) => setPay({ ...pay, ntpn: e.target.value })} /></Field>
                      <div className="num text-ink">Jumlah: {formatRupiah(s.record.net)}</div>
                      <Button variant="primary" onClick={() => run(() => store.payPpn(s.record!.id, pay), 'Setoran PPN dicatat.')}>Catat setoran</Button>
                    </div>
                  )}
                  {s.record.status === 'settled' && (
                    <Button variant="ghost" className="mt-2" onClick={() => run(() => store.cancelPpn(s.record!.id), 'Kompensasi dibatalkan.')}>Batalkan kompensasi</Button>
                  )}
                </>
              )}
            </Panel>
          </div>
        </div>
        <p className="text-xs text-ink-soft">Rekap ini adalah bahan pengisian SPT Masa PPN di Coretax. Angka resmi tetap mengikuti data prepopulated di Coretax setelah Faktur Pajak terbit.</p>
      </div>
    </>
  );
}
