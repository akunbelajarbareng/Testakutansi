import { useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { entryTotals, type JournalEntry } from '../../domain';
import { formatAmount, formatDate, todayISO } from '../../lib/format';
import { useLedger, useLedgerData } from '../../store/ledgerStore';
import { docPath } from '../../lib/paths';
import { DistributionSummary } from '../../components/DistributionEditor';
import { Alert, Button, Field, PageHeader, Panel, StatusBadge, errorMessage, inputClass, td, tdNum, th, thNum } from '../../components/ui';

/** Tampilan baca-saja untuk entri diposting/dibalik. Koreksi hanya lewat pembalikan. */
export function EntryView({ entry }: { entry: JournalEntry }) {
  const data = useLedgerData();
  const reverseEntry = useLedger((s) => s.reverseEntry);
  const navigate = useNavigate();
  const notice = (useLocation().state as { notice?: string } | null)?.notice;

  const [reversing, setReversing] = useState(false);
  const [revDate, setRevDate] = useState(todayISO());
  const [error, setError] = useState<string | null>(null);

  const journal = data.journals.find((j) => j.id === entry.journalId);
  const accounts = new Map(data.accounts.map((a) => [a.id, a]));
  const reversedBy = entry.reversedById ? data.entries.find((e) => e.id === entry.reversedById) : undefined;
  const reversalOf = entry.reversalOfId ? data.entries.find((e) => e.id === entry.reversalOfId) : undefined;
  const totals = entryTotals(entry.lines);
  const sourceInvoice = entry.source?.type === 'invoice' ? data.invoices.find((i) => i.id === entry.source!.id) : undefined;
  const sourcePayment = entry.source?.type === 'payment' ? data.payments.find((p) => p.id === entry.source!.id) : undefined;

  const onReverse = async () => {
    setError(null);
    try {
      const rev = await reverseEntry(entry.id, revDate);
      navigate(`/entri/${rev.id}`, { state: { notice: `Entri pembalik ${rev.number} dibuat dan diposting.` } });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <>
      <PageHeader
        back={{ to: '/entri', label: 'Entri Jurnal' }}
        title={entry.number ?? 'Entri'}
        subtitle={<StatusBadge status={entry.status} />}
        actions={entry.status === 'posted' && !reversing && !entry.source ? <Button onClick={() => setReversing(true)}>Balik entri</Button> : undefined}
      />

      <div className="space-y-4">
        {notice && <Alert tone="ok">{notice}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}
        {sourceInvoice && (
          <Alert tone="info">
            Dibuat otomatis dari <Link className="font-medium underline" to={docPath(sourceInvoice)}>{sourceInvoice.number}</Link>. Koreksi lewat nota kredit di dokumen tersebut.
          </Alert>
        )}
        {entry.source && ['statement', 'cash_session', 'transfer', 'hpp_adjustment', 'closing', 'retail_recap', 'ppn_settlement', 'ppn_payment', 'depreciation', 'asset_disposal'].includes(entry.source.type) && (
          <Alert tone="info">
            {entry.source.type === 'statement' && <>Dibuat otomatis oleh rekonsiliasi bank. Pembatalan dilakukan di halaman <Link className="font-medium underline" to="/rekonsiliasi">Rekonsiliasi</Link>.</>}
            {entry.source.type === 'cash_session' && <>Dibuat otomatis saat penutupan <Link className="font-medium underline" to="/kas-harian">kas harian</Link>.</>}
            {entry.source.type === 'transfer' && <>Transfer antar rekening. Bila tujuannya bank, dana menunggu di 1103 sampai mutasinya dicocokkan.</>}
            {entry.source.type === 'hpp_adjustment' && <>Dibuat dari <Link className="font-medium underline" to="/tutup-buku/hpp">penyesuaian HPP stok opname</Link>. Batalkan dari halaman tersebut.</>}
            {entry.source.type === 'retail_recap' && <>Dibuat dari <Link className="font-medium underline" to="/pajak/eceran">rekap penjualan eceran</Link>. Batalkan dari halaman tersebut.</>}
            {(entry.source.type === 'ppn_settlement' || entry.source.type === 'ppn_payment') && <>Jurnal PPN masa. Kelola di <Link className="font-medium underline" to="/pajak">Ringkasan PPN</Link>.</>}
            {entry.source.type === 'depreciation' && <>Jurnal penyusutan & amortisasi bulanan. Kelola di <Link className="font-medium underline" to="/aset/penyusutan">Penyusutan Bulanan</Link>.</>}
            {entry.source.type === 'asset_disposal' && <>Jurnal pelepasan aset. Lihat <Link className="font-medium underline" to={`/aset/${entry.source.id}`}>kartu aset</Link>.</>}
            {entry.source.type === 'closing' && <>Jurnal penutup tahun buku. Tidak ikut dihitung di Laba Rugi. Kelola di <Link className="font-medium underline" to="/tutup-buku">Tutup Buku</Link>.</>}
          </Alert>
        )}
        {sourcePayment && (
          <Alert tone="info">
            Dibuat otomatis dari pembayaran {sourcePayment.number}. Pembatalan dilakukan di halaman <Link className="font-medium underline" to="/pembayaran">Pembayaran</Link>.
          </Alert>
        )}

        {reversing && (
          <Panel className="flex flex-wrap items-end gap-3 border-orange/40 p-5">
            <div className="min-w-[220px] flex-1">
              <p className="mb-3 text-sm text-ink">
                Entri pembalik akan menukar debit dan kredit semua baris, lalu langsung diposting. Entri ini tetap tersimpan sebagai jejak audit.
              </p>
              <Field label="Tanggal pembalikan">
                <input type="date" className={inputClass} value={revDate} onChange={(e) => setRevDate(e.target.value)} />
              </Field>
            </div>
            <Button variant="primary" onClick={onReverse}>Balik dan posting</Button>
            <Button variant="ghost" onClick={() => setReversing(false)}>Batal</Button>
          </Panel>
        )}

        <Panel className="grid gap-4 p-5 text-sm sm:grid-cols-4">
          <Info label="Jurnal" value={journal ? `${journal.name} (${journal.code})` : '-'} />
          <Info label="Tanggal" value={formatDate(entry.date)} />
          <Info label="Referensi" value={entry.reference || '-'} />
          <Info label="Diposting" value={entry.postedAt ? new Date(entry.postedAt).toLocaleString('id-ID') : '-'} />
          {reversedBy && (
            <Info label="Dibalik oleh" value={<Link className="text-navy-600 hover:underline" to={`/entri/${reversedBy.id}`}>{reversedBy.number}</Link>} />
          )}
          {reversalOf && (
            <Info label="Membalik entri" value={<Link className="text-navy-600 hover:underline" to={`/entri/${reversalOf.id}`}>{reversalOf.number}</Link>} />
          )}
        </Panel>

        <Panel>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse">
              <thead>
                <tr>
                  <th className={th}>Akun</th>
                  <th className={th}>Keterangan</th>
                  <th className={thNum}>Debit</th>
                  <th className={thNum}>Kredit</th>
                </tr>
              </thead>
              <tbody>
                {entry.lines.map((l) => {
                  const a = accounts.get(l.accountId);
                  return (
                    <tr key={l.id}>
                      <td className={td}>
                        {a ? (
                          <Link className="hover:underline" to={`/buku-besar?akun=${a.id}`}>
                            <span className="num font-medium">{a.code}</span> {a.name}
                          </Link>
                        ) : '-'}
                      </td>
                      <td className={td}>
                        {l.label}
                        {l.analytic && <div className="mt-0.5 text-xs"><DistributionSummary value={l.analytic} /></div>}
                      </td>
                      <td className={tdNum}>{formatAmount(l.debit, true)}</td>
                      <td className={tdNum}>{formatAmount(l.credit, true)}</td>
                    </tr>
                  );
                })}
                <tr className="font-semibold">
                  <td className={td} colSpan={2}>Total</td>
                  <td className={tdNum}>{formatAmount(totals.debit)}</td>
                  <td className={tdNum}>{formatAmount(totals.credit)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Panel>

        {entry.status !== 'draft' && (
          <p className="text-xs text-ink-soft">Entri yang sudah diposting tidak bisa diubah atau dihapus. Untuk koreksi, balik entri ini lalu buat entri baru yang benar.</p>
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
