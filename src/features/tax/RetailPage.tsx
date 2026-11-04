import { useState } from 'react';
import { Link } from 'react-router-dom';
import { retailSummary, splitInclusive, standardPpnTax } from '../../domain';
import { formatAmount, formatDate, formatRupiah, todayISO } from '../../lib/format';
import { exportRetailRecap } from '../../lib/taxExport';
import { useLedger, useLedgerData } from '../../store/ledgerStore';
import { MoneyInput } from '../../components/MoneyInput';
import { Alert, Button, DocBadge, Field, PageHeader, Panel, errorMessage, inputClass, td, tdNum, th, thNum } from '../../components/ui';
import { MonthPicker } from './common';

export function RetailPage() {
  const data = useLedgerData();
  const store = useLedger();
  const today = todayISO();
  const cashJournals = data.journals.filter((j) => j.type === 'cash' && j.defaultAccountId);
  const [period, setPeriod] = useState(today.slice(0, 7));
  const [f, setF] = useState({ date: today, cashJournalId: cashJournals[0]?.id ?? '', cash: 0, nonCash: 0, exemptGross: 0, notes: '' });
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const tax = standardPpnTax(data);
  const gross = f.cash + f.nonCash;
  const preview = splitInclusive(Math.max(0, gross - f.exemptGross), tax);
  const sum = retailSummary(data, period);
  const all = data.retailRecaps.filter((r) => r.date.startsWith(period)).sort((a, b) => b.date.localeCompare(a.date));

  const run = async (fn: () => Promise<void>, ok: string) => {
    setMessage(null);
    try {
      await fn();
      setMessage({ tone: 'ok', text: ok });
    } catch (e) {
      setMessage({ tone: 'error', text: errorMessage(e) });
    }
  };

  if (!data.company.retailTrader) {
    return (
      <>
        <PageHeader title="Penjualan Eceran" />
        <Alert tone="info">Rekap digunggung hanya untuk PKP Pedagang Eceran. Aktifkan di <Link className="underline" to="/pengaturan">Pengaturan → Pajak</Link> bila Oriental sudah terdaftar.</Alert>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Penjualan Eceran (digunggung)" subtitle="Rekap harian penjualan toko ke konsumen akhir. Harga sudah termasuk PPN; sistem memisahkan DPP dan PPN." />
      <div className="space-y-4">
        {message && <Alert tone={message.tone}>{message.text}</Alert>}

        <Panel className="p-5">
          <h2 className="mb-4 text-base font-semibold text-navy">Rekap harian</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="Tanggal"><input type="date" className={inputClass} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
            <Field label="Kas toko">
              <select className={inputClass} value={f.cashJournalId} onChange={(e) => setF({ ...f, cashJournalId: e.target.value })}>
                {cashJournals.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
              </select>
            </Field>
            <Field label="Penjualan tunai" hint="Termasuk PPN"><MoneyInput value={f.cash} onChange={(v) => setF({ ...f, cash: v })} aria-label="Penjualan tunai" /></Field>
            <Field label="Penjualan QRIS/EDC" hint="Masuk 1112 sampai cair"><MoneyInput value={f.nonCash} onChange={(v) => setF({ ...f, nonCash: v })} aria-label="Penjualan QRIS/EDC" /></Field>
            <Field label="Dari total itu, bebas PPN" hint="mis. beras, gula"><MoneyInput value={f.exemptGross} onChange={(v) => setF({ ...f, exemptGross: v })} aria-label="Penjualan bebas PPN" /></Field>
          </div>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-4 border-t border-line pt-4">
            <dl className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm sm:grid-cols-4">
              <dt className="text-ink-soft">Total penjualan</dt><dd className="num">{formatRupiah(gross)}</dd>
              <dt className="text-ink-soft">Bebas PPN</dt><dd className="num">{formatRupiah(f.exemptGross)}</dd>
              <dt className="text-ink-soft">DPP kena PPN</dt><dd className="num">{formatRupiah(preview.dpp)}</dd>
              <dt className="font-medium">PPN Keluaran</dt><dd className="num font-semibold text-navy">{formatRupiah(preview.ppn)}</dd>
            </dl>
            <Button variant="primary" disabled={gross <= 0} onClick={() => run(async () => { await store.postRetail(f); setF({ ...f, cash: 0, nonCash: 0, exemptGross: 0, notes: '' }); }, `Rekap ${formatDate(f.date)} diposting.`)}>
              Posting rekap
            </Button>
          </div>
          <p className="mt-3 text-xs text-ink-soft">PPN = total kena PPN × {tax.rate * tax.dppNumerator}/({100 * tax.dppDenominator}+{tax.rate * tax.dppNumerator}), sesuai {tax.name}.</p>
        </Panel>

        <Panel>
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line p-5">
            <MonthPicker value={period} onChange={setPeriod} />
            <div className="flex flex-wrap items-center gap-6 text-sm">
              <span>DPP <span className="num font-semibold">{formatAmount(sum.dpp)}</span></span>
              <span>PPN <span className="num font-semibold">{formatAmount(sum.ppn)}</span></span>
              <Button onClick={() => run(() => exportRetailRecap(data, period), 'Rekap digunggung diekspor.')}>Ekspor rekap Excel</Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse">
              <thead>
                <tr><th className={th}>Tanggal</th><th className={th}>Kas</th><th className={thNum}>Tunai</th><th className={thNum}>QRIS/EDC</th><th className={thNum}>Bebas PPN</th><th className={thNum}>DPP</th><th className={thNum}>PPN</th><th className={th}>Status</th><th className={th} /></tr>
              </thead>
              <tbody>
                {all.length === 0 && <tr><td colSpan={9} className="px-3 py-4 text-sm text-ink-soft">Belum ada rekap di masa ini.</td></tr>}
                {all.map((r) => (
                  <tr key={r.id} className={r.status === 'cancelled' ? 'text-ink-soft' : ''}>
                    <td className={td}><Link className="hover:underline" to={`/entri/${r.entryId}`}>{formatDate(r.date)}</Link></td>
                    <td className={td}>{data.journals.find((j) => j.id === r.cashJournalId)?.name}</td>
                    <td className={tdNum}>{formatAmount(r.cash, true)}</td>
                    <td className={tdNum}>{formatAmount(r.nonCash, true)}</td>
                    <td className={tdNum}>{formatAmount(r.exemptGross, true)}</td>
                    <td className={tdNum}>{formatAmount(r.dpp)}</td>
                    <td className={tdNum}>{formatAmount(r.ppn)}</td>
                    <td className={td}><DocBadge state={r.status === 'posted' ? 'posted' : 'cancelled'} /></td>
                    <td className={td}>{r.status === 'posted' && <Button variant="ghost" onClick={() => run(() => store.cancelRetail(r.id), 'Rekap dibatalkan, jurnalnya dibalik.')}>Batalkan</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <p className="text-xs text-ink-soft">Hasil ekspor adalah rekap pendukung; pindahkan angkanya ke template "Retail (Digunggung)" resmi DJP untuk lampiran SPT Masa PPN.</p>
      </div>
    </>
  );
}
