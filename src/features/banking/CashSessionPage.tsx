import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DENOMINATIONS, cashDaySummary } from '../../domain';
import { formatAmount, formatDate, formatRupiah, todayISO } from '../../lib/format';
import { useLedger, useLedgerData } from '../../store/ledgerStore';
import { Alert, Button, EmptyState, Field, PageHeader, Panel, errorMessage, inputClass, td, tdNum, th, thNum } from '../../components/ui';
import { JournalPicker, liquidityJournals } from './JournalPicker';

export function CashSessionPage() {
  const data = useLedgerData();
  const closeCash = useLedger((s) => s.closeCash);
  const cashes = liquidityJournals(data.journals, 'cash');
  const [params, setParams] = useSearchParams();
  const journalId = params.get('rekening') ?? cashes[0]?.id ?? '';
  const [date, setDate] = useState(todayISO());
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState('');
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const summary = useMemo(() => (journalId ? cashDaySummary(data, journalId, date) : null), [data, journalId, date]);
  const counted = DENOMINATIONS.reduce((s, d) => s + d * (counts[d] ?? 0), 0);
  const difference = summary ? counted - summary.expected : 0;
  const closed = data.cashSessions.find((s) => s.journalId === journalId && s.date === date);
  const history = data.cashSessions.filter((s) => s.journalId === journalId).sort((a, b) => b.date.localeCompare(a.date));

  if (!journalId || !summary) return <EmptyState title="Belum ada rekening kas." />;

  const onClose = async () => {
    try {
      const s = await closeCash({ journalId, date, counted, denominations: Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0)), notes });
      setMessage({ tone: 'ok', text: s.difference === 0 ? 'Kas ditutup, tidak ada selisih.' : `Kas ditutup. Selisih ${s.difference > 0 ? 'lebih' : 'kurang'} ${formatRupiah(Math.abs(s.difference))} sudah dijurnal.` });
      setCounts({});
      setNotes('');
    } catch (e) {
      setMessage({ tone: 'error', text: errorMessage(e) });
    }
  };

  return (
    <>
      <PageHeader title="Kas Harian" subtitle="Hitung uang fisik di akhir hari dan bandingkan dengan saldo buku." actions={<JournalPicker journals={cashes} value={journalId} onChange={(id) => setParams({ rekening: id })} />} />
      <div className="space-y-4">
        {message && <Alert tone={message.tone}>{message.text}</Alert>}

        <Panel className="grid gap-4 p-5 sm:grid-cols-5">
          <Field label="Tanggal"><input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Stat label="Saldo awal" value={formatAmount(summary.opening)} />
          <Stat label="Masuk" value={formatAmount(summary.inflow)} />
          <Stat label="Keluar" value={formatAmount(summary.outflow)} />
          <Stat label="Seharusnya ada" value={formatAmount(summary.expected)} strong />
        </Panel>

        {closed ? (
          <Alert tone="info">
            Kas tanggal ini sudah ditutup: dihitung {formatRupiah(closed.counted)}, selisih {formatRupiah(closed.difference)}
            {closed.expected !== summary.expected && `. Perhatian: saldo buku berubah ${formatRupiah(summary.expected - closed.expected)} setelah kas ditutup. Periksa entri bertanggal ini.`}
            {closed.entryId && <> (<Link className="underline" to={`/entri/${closed.entryId}`}>lihat jurnal selisih</Link>)</>}
          </Alert>
        ) : (
          <Panel className="p-5">
            <h2 className="mb-3 text-base font-semibold text-navy">Hitung fisik</h2>
            <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {DENOMINATIONS.map((d) => (
                <label key={d} className="flex items-center gap-3 text-sm">
                  <span className="num w-24 text-right">{formatAmount(d)}</span>
                  <span className="text-ink-soft">×</span>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    className={`${inputClass} num w-24 text-right`}
                    value={counts[d] ?? ''}
                    onChange={(e) => setCounts({ ...counts, [d]: Math.max(0, Number.parseInt(e.target.value || '0', 10)) })}
                    aria-label={`Jumlah pecahan ${d}`}
                  />
                  <span className="num flex-1 text-right text-ink-soft">{formatAmount(d * (counts[d] ?? 0), true)}</span>
                </label>
              ))}
            </div>
            <div className="mt-5 flex flex-wrap items-end justify-between gap-4 border-t border-line pt-4">
              <div className="min-w-[240px] flex-1"><Field label="Catatan"><input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="mis. kasir shift sore" /></Field></div>
              <div className="text-right">
                <div className="text-sm text-ink-soft">Total dihitung</div>
                <div className="num text-2xl font-semibold text-navy">{formatRupiah(counted)}</div>
                <div className={`num text-sm font-medium ${difference === 0 ? 'text-ok' : 'text-bad'}`}>
                  {difference === 0 ? 'Pas, tidak ada selisih' : `Selisih ${difference > 0 ? 'lebih' : 'kurang'} ${formatRupiah(Math.abs(difference))}`}
                </div>
              </div>
            </div>
            <Button variant="primary" className="mt-4" onClick={onClose}>Tutup kas</Button>
          </Panel>
        )}

        {history.length > 0 && (
          <Panel>
            <h2 className="border-b border-line px-5 py-3 font-semibold text-navy">Riwayat tutup kas</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse">
                <thead><tr><th className={th}>Tanggal</th><th className={thNum}>Seharusnya</th><th className={thNum}>Dihitung</th><th className={thNum}>Selisih</th><th className={th}>Catatan</th></tr></thead>
                <tbody>
                  {history.map((s) => (
                    <tr key={s.id}>
                      <td className={td}>{formatDate(s.date)}</td>
                      <td className={tdNum}>{formatAmount(s.expected)}</td>
                      <td className={tdNum}>{formatAmount(s.counted)}</td>
                      <td className={`${tdNum} ${s.difference ? 'font-medium text-bad' : 'text-ok'}`}>{formatAmount(s.difference)}</td>
                      <td className={`${td} text-ink-soft`}>{s.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}
      </div>
    </>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <div className="text-xs text-ink-soft">{label}</div>
      <div className={`num mt-2 ${strong ? 'text-lg font-semibold text-navy' : 'text-base text-ink'}`}>{value}</div>
    </div>
  );
}
