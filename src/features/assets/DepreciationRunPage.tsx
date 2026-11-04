import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { firstUnpostedPeriod, lastRunPeriod, runPreview, shiftMonth } from '../../domain';
import { formatAmount, formatMonth, todayISO } from '../../lib/format';
import { useLedger, useLedgerData } from '../../store/ledgerStore';
import { DistributionSummary } from '../../components/DistributionEditor';
import { Alert, Button, EmptyState, PageHeader, Panel, errorMessage, td, tdNum, th, thNum } from '../../components/ui';
import { MonthPicker } from '../tax/common';

export function DepreciationRunPage() {
  const data = useLedgerData();
  const store = useLedger();
  const today = todayISO().slice(0, 7);
  const suggested = firstUnpostedPeriod(data, today) ?? today;
  const [period, setPeriod] = useState(suggested);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const items = useMemo(() => runPreview(data, period), [data, period]);
  const done = data.depreciationRuns.find((r) => r.status === 'posted' && r.period === period);
  const last = lastRunPeriod(data);
  const runs = [...data.depreciationRuns].sort((a, b) => b.period.localeCompare(a.period));
  const total = (type: 'asset' | 'deferral') => items.filter((i) => i.type === type).reduce((s, i) => s + i.amount, 0);

  const run = async (fn: () => Promise<void>, ok: string) => {
    setMessage(null);
    try {
      await fn();
      setMessage({ tone: 'ok', text: ok });
    } catch (e) {
      setMessage({ tone: 'error', text: errorMessage(e) });
    }
  };

  return (
    <>
      <PageHeader title="Penyusutan & Amortisasi Bulanan" subtitle="Satu jurnal per bulan untuk semua aset dan penangguhan. Dibukukan berurutan." />
      <div className="space-y-4">
        {message && <Alert tone={message.tone}>{message.text}</Alert>}
        <Panel className="flex flex-wrap items-end justify-between gap-4 p-5">
          <MonthPicker value={period} onChange={setPeriod} />
          <div className="text-sm text-ink-soft">
            {last ? `Terakhir dibukukan: ${formatMonth(last)}.` : 'Belum pernah dibukukan.'} Berikutnya: <button type="button" className="text-navy-600 underline" onClick={() => setPeriod(suggested)}>{formatMonth(suggested)}</button>
          </div>
          {done ? (
            <div className="flex items-center gap-3">
              <Link className="text-sm text-navy-600 hover:underline" to={`/entri/${done.entryId}`}>Lihat jurnal</Link>
              {last === period && <Button variant="ghost" onClick={() => run(() => store.cancelRun(done.id), `Run ${formatMonth(period)} dibatalkan.`)}>Batalkan run</Button>}
            </div>
          ) : (
            <Button variant="primary" disabled={!items.length} onClick={() => run(() => store.runDepreciation(period), `Penyusutan & amortisasi ${formatMonth(period)} dibukukan.`)}>
              Bukukan {formatMonth(period)}
            </Button>
          )}
        </Panel>

        <Panel>
          {items.length === 0 ? (
            <EmptyState title={`Tidak ada penyusutan atau amortisasi di ${formatMonth(period)}.`} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px] border-collapse">
                <thead><tr><th className={th}>Jenis</th><th className={th}>Nama</th><th className={th}>Akun</th><th className={th}>Pemakai</th><th className={thNum}>Jumlah</th></tr></thead>
                <tbody>
                  {items.map((i) => {
                    if (i.type === 'asset') {
                      const a = data.assets.find((x) => x.id === i.id)!;
                      const cat = data.assetCategories.find((c) => c.id === a.categoryId)!;
                      return (
                        <tr key={i.id}>
                          <td className={`${td} text-sm`}>Penyusutan</td>
                          <td className={td}><Link className="text-navy-600 hover:underline" to={`/aset/${a.id}`}>{a.code}</Link> {a.name}</td>
                          <td className={`${td} text-xs text-ink-soft`}>{data.accounts.find((x) => x.id === cat.expenseAccountId)?.code} / {data.accounts.find((x) => x.id === cat.accumAccountId)?.code}</td>
                          <td className={`${td} text-xs`}><DistributionSummary value={a.analytic} empty="Belum diisi" /></td>
                          <td className={tdNum}>{formatAmount(i.amount)}</td>
                        </tr>
                      );
                    }
                    const d = data.deferrals.find((x) => x.id === i.id)!;
                    return (
                      <tr key={i.id}>
                        <td className={`${td} text-sm`}>{d.kind === 'expense' ? 'Amortisasi biaya' : 'Pengakuan pendapatan'}</td>
                        <td className={td}>{d.name}</td>
                        <td className={`${td} text-xs text-ink-soft`}>{d.kind === 'expense' ? `${data.accounts.find((x) => x.id === d.recognitionAccountId)?.code} / ${data.accounts.find((x) => x.id === d.deferralAccountId)?.code}` : `${data.accounts.find((x) => x.id === d.deferralAccountId)?.code} / ${data.accounts.find((x) => x.id === d.recognitionAccountId)?.code}`}</td>
                        <td className={`${td} text-xs`}><DistributionSummary value={d.analytic} empty="Otomatis" /></td>
                        <td className={tdNum}>{formatAmount(i.amount)}</td>
                      </tr>
                    );
                  })}
                  <tr className="font-semibold">
                    <td className={td} colSpan={4}>Penyusutan {formatAmount(total('asset'))}, penangguhan {formatAmount(total('deferral'))}</td>
                    <td className={tdNum}>{formatAmount(total('asset') + total('deferral'))}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        {runs.length > 0 && (
          <Panel className="p-5">
            <h2 className="mb-2 text-base font-semibold text-navy">Riwayat</h2>
            <ul className="divide-y divide-line text-sm">
              {runs.map((r) => (
                <li key={r.id} className="flex justify-between gap-2 py-2">
                  <span>{formatMonth(r.period)} <Link className="ml-2 text-navy-600 hover:underline" to={`/entri/${r.entryId}`}>jurnal</Link></span>
                  <span className={r.status === 'cancelled' ? 'text-ink-soft line-through' : 'num'}>{formatAmount(r.items.reduce((s, i) => s + i.amount, 0))}</span>
                </li>
              ))}
            </ul>
          </Panel>
        )}
        <p className="text-xs text-ink-soft">Run harus berurutan: bulan {formatMonth(shiftMonth(suggested, 0))} dulu sebelum bulan berikutnya. Hanya run terakhir yang bisa dibatalkan.</p>
      </div>
    </>
  );
}
