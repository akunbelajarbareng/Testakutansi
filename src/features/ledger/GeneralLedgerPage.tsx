import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { generalLedger, normalSide } from '../../domain';
import { firstDayOfMonth, formatAmount, formatDate, todayISO } from '../../lib/format';
import { useLedgerData } from '../../store/ledgerStore';
import { AccountSelect } from '../entries/AccountSelect';
import { EmptyState, Field, PageHeader, Panel, inputClass, td, tdNum, th, thNum } from '../../components/ui';

/** Filter disimpan di query string (?akun=&dari=&sampai=) agar bisa ditautkan dari layar lain. */
export function GeneralLedgerPage() {
  const data = useLedgerData();
  const [params, setParams] = useSearchParams();
  const today = todayISO();
  const accountId = params.get('akun') ?? data.accounts.find((a) => a.liquidity)?.id ?? data.accounts[0]?.id ?? '';
  const from = params.get('dari') ?? firstDayOfMonth(today);
  const to = params.get('sampai') ?? today;

  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => next.set(k, v));
    setParams(next, { replace: true });
  };

  const result = useMemo(() => generalLedger(accountId, data, { from, to }), [accountId, data, from, to]);

  return (
    <>
      <PageHeader title="Buku Besar" subtitle="Mutasi per akun dengan saldo berjalan. Saldo positif berarti sesuai sisi normal akun." />

      <Panel className="mb-4 grid gap-4 p-5 sm:grid-cols-[2fr_1fr_1fr]">
        <Field label="Akun">
          <AccountSelect accounts={data.accounts} value={accountId} onChange={(v) => update({ akun: v })} />
        </Field>
        <Field label="Dari">
          <input type="date" className={inputClass} value={from} onChange={(e) => update({ dari: e.target.value })} />
        </Field>
        <Field label="Sampai">
          <input type="date" className={inputClass} value={to} onChange={(e) => update({ sampai: e.target.value })} />
        </Field>
      </Panel>

      {!result ? (
        <Panel><EmptyState title="Pilih akun untuk melihat mutasinya." /></Panel>
      ) : (
        <Panel>
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-4">
            <h2 className="font-semibold text-navy">
              <span className="num">{result.account.code}</span> {result.account.name}
            </h2>
            <span className="text-sm text-ink-soft">Saldo normal {normalSide(result.account) === 'debit' ? 'debit' : 'kredit'}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse">
              <thead>
                <tr>
                  <th className={th}>Tanggal</th>
                  <th className={th}>Nomor</th>
                  <th className={th}>Keterangan</th>
                  <th className={thNum}>Debit</th>
                  <th className={thNum}>Kredit</th>
                  <th className={thNum}>Saldo</th>
                </tr>
              </thead>
              <tbody>
                <tr className="bg-paper/60">
                  <td className={td} colSpan={5}>Saldo awal per {formatDate(from)}</td>
                  <td className={`${tdNum} font-medium`}>{formatAmount(result.opening)}</td>
                </tr>
                {result.rows.length === 0 && (
                  <tr><td className={`${td} text-ink-soft`} colSpan={6}>Tidak ada mutasi di periode ini.</td></tr>
                )}
                {result.rows.map((r, i) => (
                  <tr key={`${r.entryId}-${i}`}>
                    <td className={`${td} whitespace-nowrap`}>{formatDate(r.date)}</td>
                    <td className={`${td} whitespace-nowrap`}>
                      <Link className="text-navy-600 hover:underline" to={`/entri/${r.entryId}`}>{r.number}</Link>
                    </td>
                    <td className={td}>{r.label || r.reference}</td>
                    <td className={tdNum}>{formatAmount(r.debit, true)}</td>
                    <td className={tdNum}>{formatAmount(r.credit, true)}</td>
                    <td className={tdNum}>{formatAmount(r.balance)}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className={td} colSpan={3}>Saldo akhir per {formatDate(to)}</td>
                  <td className={tdNum}>{formatAmount(result.totalDebit)}</td>
                  <td className={tdNum}>{formatAmount(result.totalCredit)}</td>
                  <td className={tdNum}>{formatAmount(result.closing)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  );
}
