import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { trialBalance, type DebitCredit } from '../../domain';
import { firstDayOfMonth, formatAmount, formatDate, todayISO } from '../../lib/format';
import { useLedgerData } from '../../store/ledgerStore';
import { Alert, EmptyState, Field, PageHeader, Panel, inputClass, td, tdNum, th } from '../../components/ui';

const groupTh = 'border-b border-l border-line bg-paper px-3 py-2 text-center text-xs font-semibold text-ink-soft';
const subTh = 'border-b border-line bg-paper px-3 py-1.5 text-right text-xs font-medium text-ink-soft';

function Pair({ v, strong = false }: { v: DebitCredit; strong?: boolean }) {
  const cls = `${tdNum} ${strong ? 'font-semibold' : ''}`;
  return (
    <>
      <td className={`${cls} border-l`}>{formatAmount(v.debit, !strong)}</td>
      <td className={cls}>{formatAmount(v.credit, !strong)}</td>
    </>
  );
}

export function TrialBalancePage() {
  const data = useLedgerData();
  const today = todayISO();
  const [from, setFrom] = useState(firstDayOfMonth(today));
  const [to, setTo] = useState(today);
  const [includeZero, setIncludeZero] = useState(false);

  const tb = useMemo(() => trialBalance(data, { from, to }, includeZero), [data, from, to, includeZero]);
  const ledgerLink = (accountId: string) => `/buku-besar?akun=${accountId}&dari=${from}&sampai=${to}`;

  return (
    <>
      <PageHeader title="Neraca Saldo" subtitle={`${formatDate(from)} sampai ${formatDate(to)}. Hanya entri yang sudah diposting.`} />

      <Panel className="mb-4 flex flex-wrap items-end gap-4 p-5">
        <div className="w-44"><Field label="Dari"><input type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} /></Field></div>
        <div className="w-44"><Field label="Sampai"><input type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} /></Field></div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-navy" checked={includeZero} onChange={(e) => setIncludeZero(e.target.checked)} />
          Tampilkan akun bersaldo nol
        </label>
      </Panel>

      <div className="mb-4">
        {tb.balanced ? (
          <Alert tone="ok">Seimbang: total debit sama dengan total kredit di saldo awal, mutasi, dan saldo akhir.</Alert>
        ) : (
          <Alert tone="error">Tidak seimbang. Ini menandakan data rusak dan harus diperiksa — aturan posting seharusnya mencegah kondisi ini.</Alert>
        )}
      </div>

      <Panel>
        {tb.rows.length === 0 ? (
          <EmptyState title="Belum ada saldo atau mutasi di periode ini." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse">
              <thead>
                <tr>
                  <th className={th} rowSpan={2}>Akun</th>
                  <th className={groupTh} colSpan={2}>Saldo awal</th>
                  <th className={groupTh} colSpan={2}>Mutasi periode</th>
                  <th className={groupTh} colSpan={2}>Saldo akhir</th>
                </tr>
                <tr>
                  {['awal', 'mutasi', 'akhir'].flatMap((k) => [
                    <th key={`${k}-d`} className={`${subTh} border-l`}>Debit</th>,
                    <th key={`${k}-k`} className={subTh}>Kredit</th>,
                  ])}
                </tr>
              </thead>
              <tbody>
                {tb.rows.map((r) => (
                  <tr key={r.account.id} className="hover:bg-navy-100/40">
                    <td className={td}>
                      <Link className="hover:underline" to={ledgerLink(r.account.id)}>
                        <span className="num font-medium">{r.account.code}</span> {r.account.name}
                      </Link>
                    </td>
                    <Pair v={r.opening} />
                    <Pair v={r.movement} />
                    <Pair v={r.closing} />
                  </tr>
                ))}
                <tr className="bg-paper/60">
                  <td className={`${td} font-semibold`}>Total</td>
                  <Pair v={tb.totals.opening} strong />
                  <Pair v={tb.totals.movement} strong />
                  <Pair v={tb.totals.closing} strong />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
