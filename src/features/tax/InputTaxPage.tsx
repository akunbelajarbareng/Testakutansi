import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { inputTaxRows, matchCoretaxInput, parseCoretaxInputCsv, type InputMatch } from '../../domain';
import { formatAmount, formatDate, todayISO } from '../../lib/format';
import { docPath } from '../../lib/paths';
import { useLedger, useLedgerData } from '../../store/ledgerStore';
import { Alert, Button, EmptyState, PageHeader, Panel, errorMessage, inputClass, td, tdNum, th, thNum } from '../../components/ui';
import { MonthPicker } from './common';

const MATCH_LABEL: Record<InputMatch['status'], { label: string; cls: string }> = {
  matched: { label: 'Cocok', cls: 'bg-ok-100 text-ok' },
  amount_mismatch: { label: 'Beda nominal', cls: 'bg-bad-100 text-bad' },
  only_coretax: { label: 'Hanya di Coretax', cls: 'bg-orange-100 text-orange-600' },
  only_book: { label: 'Hanya di buku', cls: 'bg-orange-100 text-orange-600' },
};

export function InputTaxPage() {
  const data = useLedgerData();
  const store = useLedger();
  const [period, setPeriod] = useState(todayISO().slice(0, 7));
  const rows = useMemo(() => inputTaxRows(data, period), [data, period]);
  const [edit, setEdit] = useState<Record<string, { n: string; d: string; p: string }>>({});
  const [matches, setMatches] = useState<InputMatch[] | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const total = rows.reduce((s, r) => s + r.ppn, 0);

  const run = async (fn: () => Promise<void>, ok: string) => {
    setMessage(null);
    try {
      await fn();
      setMessage({ tone: 'ok', text: ok });
    } catch (e) {
      setMessage({ tone: 'error', text: errorMessage(e) });
    }
  };

  const onFile = async (file?: File) => {
    if (!file) return;
    const { rows: ct, errors } = parseCoretaxInputCsv(await file.text());
    if (errors.length && !ct.length) {
      setMessage({ tone: 'error', text: errors.join(' ') });
      return;
    }
    setMatches(matchCoretaxInput(ct, data, period));
  };

  return (
    <>
      <PageHeader title="PPN Masukan" subtitle="Faktur Pajak dari supplier yang dikreditkan di masa ini. Masa pengkreditan bisa digeser maksimal 3 masa." />
      <div className="space-y-4">
        {message && <Alert tone={message.tone}>{message.text}</Alert>}
        <Panel className="flex flex-wrap items-end justify-between gap-4 p-5">
          <MonthPicker value={period} onChange={(v) => { setPeriod(v); setMatches(null); }} />
          <div className="text-sm">Total PPN Masukan dikreditkan <span className="num ml-2 text-lg font-semibold text-navy">{formatAmount(total)}</span></div>
        </Panel>

        <Panel>
          {rows.length === 0 ? (
            <EmptyState title="Tidak ada PPN Masukan yang dikreditkan di masa ini." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] border-collapse">
                <thead>
                  <tr><th className={th}>Tagihan</th><th className={th}>Supplier</th><th className={th}>No. Faktur Pajak</th><th className={th}>Tgl Faktur Pajak</th><th className={th}>Masa kredit</th><th className={thNum}>DPP</th><th className={thNum}>PPN</th><th className={th} /></tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const e = edit[r.bill.id] ?? { n: r.bill.supplierTaxInvoiceNumber ?? '', d: r.bill.supplierTaxInvoiceDate ?? r.bill.date, p: r.creditPeriod };
                    const set = (patch: Partial<typeof e>) => setEdit({ ...edit, [r.bill.id]: { ...e, ...patch } });
                    const isRefund = r.bill.kind === 'in_refund';
                    return (
                      <tr key={r.bill.id} className="align-top">
                        <td className={`${td} whitespace-nowrap`}><Link className="font-medium text-navy-600 hover:underline" to={docPath(r.bill)}>{r.bill.number}</Link><div className="text-xs text-ink-soft">{formatDate(r.bill.date)}</div></td>
                        <td className={td}>{r.partner?.name}<div className="num text-xs text-ink-soft">{r.partner?.npwp || 'NPWP belum diisi'}</div></td>
                        {isRefund ? (
                          <td className={`${td} text-sm text-ink-soft`} colSpan={3}>Nota kredit pembelian (retur PPN Masukan)</td>
                        ) : (
                          <>
                            <td className={td}><input className={`${inputClass} num ${r.missingTaxNumber && !e.n ? 'border-orange' : ''}`} value={e.n} onChange={(ev) => set({ n: ev.target.value })} placeholder="Wajib diisi" aria-label={`No. Faktur Pajak ${r.bill.number}`} /></td>
                            <td className={td}><input type="date" className={inputClass} value={e.d} onChange={(ev) => set({ d: ev.target.value })} aria-label="Tanggal Faktur Pajak" /></td>
                            <td className={td}><input type="month" className={inputClass} value={e.p} onChange={(ev) => set({ p: ev.target.value })} aria-label="Masa kredit" /></td>
                          </>
                        )}
                        <td className={tdNum}>{formatAmount(r.dpp)}</td>
                        <td className={tdNum}>{formatAmount(r.ppn)}</td>
                        <td className={td}>
                          {!isRefund && edit[r.bill.id] && (
                            <Button variant="primary" onClick={() => run(async () => { await store.updateBillTax(r.bill.id, { supplierTaxInvoiceNumber: e.n.trim(), supplierTaxInvoiceDate: e.d, creditPeriod: e.p }); const n = { ...edit }; delete n[r.bill.id]; setEdit(n); }, 'Data Faktur Pajak supplier disimpan.')}>
                              Simpan
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel className="p-5">
          <h2 className="text-base font-semibold text-navy">Cocokkan dengan daftar PPN Masukan di Coretax</h2>
          <p className="mt-1 max-w-prose text-sm text-ink-soft">
            Unduh daftar Faktur Pajak Masukan masa ini dari Coretax, simpan sebagai CSV dengan header <code className="rounded bg-paper px-1">npwp_penjual, nama_penjual, nomor_faktur, tanggal_faktur, dpp, ppn</code>, lalu unggah di sini.
          </p>
          <input type="file" accept=".csv,text/csv" className="mt-3 block text-sm file:mr-3 file:rounded-md file:border file:border-line file:bg-white file:px-3 file:py-2 file:text-sm" onChange={(e) => onFile(e.target.files?.[0])} />
          {matches && (
            <div className="mt-4 overflow-x-auto">
              <p className="mb-2 text-sm">
                {(['matched', 'amount_mismatch', 'only_coretax', 'only_book'] as const).map((k) => `${MATCH_LABEL[k].label}: ${matches.filter((m) => m.status === k).length}`).join(' · ')}
              </p>
              <table className="w-full min-w-[900px] border-collapse">
                <thead><tr><th className={th}>Status</th><th className={th}>Faktur Pajak (Coretax)</th><th className={th}>Tagihan (buku)</th><th className={thNum}>PPN Coretax</th><th className={thNum}>PPN buku</th><th className={th}>Keterangan</th></tr></thead>
                <tbody>
                  {matches.map((m, i) => (
                    <tr key={i} className="align-top">
                      <td className={td}><span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${MATCH_LABEL[m.status].cls}`}>{MATCH_LABEL[m.status].label}</span></td>
                      <td className={`${td} text-sm`}>{m.coretax ? <>{m.coretax.taxNumber}<div className="text-xs text-ink-soft">{m.coretax.sellerName}</div></> : '-'}</td>
                      <td className={`${td} text-sm`}>{m.book ? <Link className="text-navy-600 hover:underline" to={docPath(m.book.bill)}>{m.book.bill.number}</Link> : '-'}</td>
                      <td className={tdNum}>{m.coretax ? formatAmount(m.coretax.ppn) : ''}</td>
                      <td className={tdNum}>{m.book ? formatAmount(m.book.ppn) : ''}</td>
                      <td className={`${td} text-xs text-ink-soft`}>{m.note}</td>
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
