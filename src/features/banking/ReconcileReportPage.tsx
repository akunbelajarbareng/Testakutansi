import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { reconciliationReport } from '../../domain';
import { formatAmount, formatDate, formatRupiah, todayISO } from '../../lib/format';
import { useLedgerData } from '../../store/ledgerStore';
import { Alert, EmptyState, Field, PageHeader, Panel, inputClass, td, tdNum, th, thNum } from '../../components/ui';
import { JournalPicker, liquidityJournals } from './JournalPicker';

export function ReconcileReportPage() {
  const data = useLedgerData();
  const banks = liquidityJournals(data.journals, 'bank');
  const [params, setParams] = useSearchParams();
  const journalId = params.get('rekening') ?? banks[0]?.id ?? '';
  const [asOf, setAsOf] = useState(todayISO());
  if (!journalId) return <EmptyState title="Belum ada rekening bank." />;
  const r = reconciliationReport(data, journalId, asOf);
  const journal = data.journals.find((j) => j.id === journalId)!;
  const bookOnlySum = r.bookOnly.reduce((s, b) => s + b.amount, 0);
  const bankOnlySum = r.bankOnly.reduce((s, l) => s + l.amount, 0);

  return (
    <>
      <PageHeader
        back={{ to: `/rekonsiliasi?rekening=${journalId}`, label: 'Rekonsiliasi' }}
        title="Laporan Rekonsiliasi Bank"
        subtitle={`${journal.name} per ${formatDate(asOf)}`}
        actions={<JournalPicker journals={banks} value={journalId} onChange={(id) => setParams({ rekening: id })} />}
      />
      <Panel className="mb-4 flex flex-wrap items-end gap-4 p-5">
        <div className="w-44"><Field label="Per tanggal"><input type="date" className={inputClass} value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field></div>
        {journal.reconcileFrom && <p className="pb-2 text-sm text-ink-soft">Rekonsiliasi dimulai {formatDate(journal.reconcileFrom)}.</p>}
      </Panel>

      <Panel className="mb-4 p-5">
        <dl className="max-w-xl text-sm">
          <Row label="Saldo buku" value={formatRupiah(r.bookBalance)} strong />
          <Row label={`Dikurangi: catatan buku yang belum muncul di bank (${r.bookOnly.length})`} value={formatRupiah(-bookOnlySum)} />
          <Row label={`Ditambah: mutasi bank yang belum dicatat di buku (${r.bankOnly.length})`} value={formatRupiah(bankOnlySum)} />
          <Row label="Saldo bank menurut hitungan" value={formatRupiah(r.computedBankBalance)} strong border />
          <Row label="Saldo bank menurut mutasi" value={r.statementBalance === null ? '-' : formatRupiah(r.statementBalance)} strong />
        </dl>
        <div className="mt-4">
          {r.unexplained === null ? (
            <Alert tone="info">Belum ada mutasi bank sampai tanggal ini.</Alert>
          ) : r.unexplained === 0 ? (
            <Alert tone="ok">Cocok. Semua selisih antara buku dan bank sudah terjelaskan oleh item di bawah.</Alert>
          ) : (
            <Alert tone="error">Ada selisih tak terjelaskan {formatRupiah(r.unexplained)}. Biasanya karena mutasi yang belum diimpor, atau saldo awal buku berbeda dengan saldo awal bank.</Alert>
          )}
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <h2 className="border-b border-line px-5 py-3 font-semibold text-navy">Catatan buku belum muncul di bank</h2>
          {r.bookOnly.length === 0 ? <p className="p-5 text-sm text-ink-soft">Tidak ada.</p> : (
            <table className="w-full border-collapse">
              <thead><tr><th className={th}>Tanggal</th><th className={th}>Entri</th><th className={thNum}>Jumlah</th></tr></thead>
              <tbody>
                {r.bookOnly.map((b) => (
                  <tr key={`${b.ref.entryId}:${b.ref.lineId}`}>
                    <td className={`${td} whitespace-nowrap`}>{formatDate(b.date)}</td>
                    <td className={td}><Link className="text-navy-600 hover:underline" to={`/entri/${b.entry.id}`}>{b.entry.number}</Link> <span className="text-xs text-ink-soft">{b.label}</span></td>
                    <td className={tdNum}>{formatAmount(b.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
        <Panel>
          <h2 className="border-b border-line px-5 py-3 font-semibold text-navy">Mutasi bank belum dicatat di buku</h2>
          {r.bankOnly.length === 0 ? <p className="p-5 text-sm text-ink-soft">Tidak ada.</p> : (
            <table className="w-full border-collapse">
              <thead><tr><th className={th}>Tanggal</th><th className={th}>Keterangan</th><th className={thNum}>Jumlah</th></tr></thead>
              <tbody>
                {r.bankOnly.map((l) => (
                  <tr key={l.id}>
                    <td className={`${td} whitespace-nowrap`}>{formatDate(l.date)}</td>
                    <td className={`${td} text-xs`}>{l.description}</td>
                    <td className={tdNum}>{formatAmount(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </>
  );
}

function Row({ label, value, strong, border }: { label: string; value: string; strong?: boolean; border?: boolean }) {
  return (
    <div className={`flex justify-between gap-6 py-1.5 ${border ? 'mt-1 border-t border-line pt-2' : ''}`}>
      <dt className={strong ? 'font-semibold' : 'text-ink-soft'}>{label}</dt>
      <dd className={`num whitespace-nowrap ${strong ? 'font-semibold' : ''}`}>{value}</dd>
    </div>
  );
}
