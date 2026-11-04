import { Link } from 'react-router-dom';
import { accountNetBalances, addDays, monthEnd, ppnSummary, profitAndLoss, shiftMonth, creditCheck, invoiceResidual, journalSummaries, toNormalBalance, trialBalance } from '../../domain';
import { formatAmount, formatDate, formatMonth, formatRupiah, todayISO } from '../../lib/format';
import { useLedgerData } from '../../store/ledgerStore';
import { LinkButton, PageHeader, Panel, StatusBadge } from '../../components/ui';

const JOURNAL_HINT: Record<string, string> = {
  sale: 'Penjualan ke pelanggan',
  purchase: 'Pembelian dari supplier',
  bank: 'Mutasi rekening bank',
  cash: 'Transaksi kas toko',
  general: 'Penyesuaian & lain-lain',
};

export function DashboardPage() {
  const data = useLedgerData();
  const today = todayISO();
  const month = today.slice(0, 7);

  const net = accountNetBalances(data);
  const liquidity = data.accounts
    .filter((a) => a.liquidity)
    .map((a) => ({ account: a, balance: toNormalBalance(a, net.get(a.id) ?? 0) }));
  const totalLiquidity = liquidity.reduce((s, x) => s + x.balance, 0);

  const summaries = journalSummaries(data, month);
  const drafts = data.entries.filter((e) => e.status === 'draft');
  const tb = trialBalance(data, {});
  const openDocs = (kind: 'out_invoice' | 'in_invoice') =>
    data.invoices
      .filter((i) => i.kind === kind && i.status === 'posted')
      .map((i) => ({ i, residual: invoiceResidual(i, data) }))
      .filter((x) => x.residual > 0);
  const ar = openDocs('out_invoice');
  const ap = openDocs('in_invoice');
  const arTotal = ar.reduce((s, x) => s + x.residual, 0);
  const arOverdue = ar.filter((x) => x.i.dueDate < today);
  const apTotal = ap.reduce((s, x) => s + x.residual, 0);
  const weekAhead = addDays(today, 7);
  const apDueSoon = ap.filter((x) => x.i.dueDate <= weekAhead);
  const overLimit = data.partners.filter((p) => p.kind !== 'supplier' && p.creditLimit > 0 && creditCheck(p, data).exceeded);

  const pnl = profitAndLoss(data, { from: `${month}-01`, to: monthEnd(month) });
  const lastPpn = ppnSummary(data, shiftMonth(month, -1));
  const ppnOpen = !lastPpn.record || lastPpn.record.status === 'settled';

  const recent = [...data.entries]
    .filter((e) => e.status !== 'draft')
    .sort((a, b) => b.date.localeCompare(a.date) || (b.number ?? '').localeCompare(a.number ?? ''))
    .slice(0, 5);

  return (
    <>
      <PageHeader
        title={`Ringkasan ${formatMonth(month)}`}
        subtitle={`Per ${formatDate(today)}`}
        actions={<LinkButton to="/entri/baru" variant="primary">Entri baru</LinkButton>}
      />

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Panel className="p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-medium text-ink-soft">Kas & bank tersedia</h2>
            <Link to="/neraca-saldo" className="text-sm text-navy-600 hover:underline">Lihat neraca saldo</Link>
          </div>
          <p className="num mt-1 text-3xl font-semibold text-navy">{formatRupiah(totalLiquidity)}</p>
          <ul className="mt-4 divide-y divide-line border-t border-line text-sm">
            {liquidity.map(({ account, balance }) => {
              const j = data.journals.find((x) => x.defaultAccountId === account.id && x.type === 'bank');
              const open = j ? data.statementLines.filter((l) => l.journalId === j.id && l.status === 'open').length : 0;
              return (
                <li key={account.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <span>
                    <Link className="hover:underline" to={`/buku-besar?akun=${account.id}`}>
                      <span className="num text-ink-soft">{account.code}</span> {account.name}
                    </Link>
                    {open > 0 && (
                      <Link to={`/rekonsiliasi?rekening=${j!.id}`} className="ml-2 text-xs font-medium text-orange-600 hover:underline">{open} mutasi belum dicocokkan</Link>
                    )}
                  </span>
                  <span className="num">{formatAmount(balance)}</span>
                </li>
              );
            })}
          </ul>
        </Panel>

        <div className="grid gap-4">
          <Panel className={`p-5 ${tb.balanced ? '' : 'border-bad'}`}>
            <h2 className="text-sm font-medium text-ink-soft">Kesehatan buku besar</h2>
            <p className={`mt-1 text-lg font-semibold ${tb.balanced ? 'text-ok' : 'text-bad'}`}>
              {tb.balanced ? 'Debit dan kredit seimbang' : 'Neraca saldo tidak seimbang'}
            </p>
            <p className="num mt-1 text-sm text-ink-soft">Total {formatRupiah(tb.totals.closing.debit)}</p>
          </Panel>
          <Panel className="p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-medium text-ink-soft">Laba bersih bulan ini</h2>
              <Link to="/laporan/laba-rugi" className="text-sm text-navy-600 hover:underline">Laba rugi</Link>
            </div>
            <p className={`num mt-1 text-lg font-semibold ${pnl.netProfit < 0 ? 'text-bad' : 'text-navy'}`}>{formatRupiah(pnl.netProfit)}</p>
            <p className="num text-sm text-ink-soft">
              Margin kotor {pnl.revenue ? `${((pnl.grossProfit / pnl.revenue) * 100).toFixed(1)}%` : '-'}
              {!data.hppAdjustments.some((h) => h.status === 'posted' && h.periodEnd.startsWith(month)) && ', HPP belum dibukukan'}
            </p>
          </Panel>
          <Panel className="p-5">
            <h2 className="text-sm font-medium text-ink-soft">Menunggu posting</h2>
            <p className="mt-1 text-lg font-semibold text-ink">{drafts.length} draft</p>
            {drafts.length > 0 && (
              <Link to="/entri" className="mt-1 inline-block text-sm text-navy-600 hover:underline">Tinjau draft</Link>
            )}
          </Panel>
        </div>
      </div>

      {ppnOpen && (lastPpn.outputTax !== 0 || lastPpn.inputTax !== 0) && (
        <div className={`mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-5 py-3 text-sm ${today > lastPpn.dueDate ? 'border-bad/40 bg-bad-100 text-bad' : 'border-orange/40 bg-orange-100 text-orange-600'}`}>
          <span>
            PPN masa {formatMonth(lastPpn.period)}: {lastPpn.net > 0 ? `kurang bayar ${formatRupiah(lastPpn.net)}` : lastPpn.net < 0 ? `lebih bayar ${formatRupiah(-lastPpn.net)}` : 'nihil'}, batas lapor {formatDate(lastPpn.dueDate)}
            {!lastPpn.record ? ' — belum dikompensasi.' : ' — belum disetor/dilaporkan.'}
          </span>
          <Link to="/pajak" className="font-medium underline">Buka Pajak</Link>
        </div>
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <Panel className="p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-medium text-ink-soft">Piutang terbuka</h2>
            <Link to="/umur-piutang" className="text-sm text-navy-600 hover:underline">Umur piutang</Link>
          </div>
          <p className="num mt-1 text-2xl font-semibold text-navy">{formatRupiah(arTotal)}</p>
          <p className={`mt-1 text-sm ${arOverdue.length ? 'font-medium text-bad' : 'text-ink-soft'}`}>
            {arOverdue.length
              ? `${arOverdue.length} faktur lewat jatuh tempo, ${formatRupiah(arOverdue.reduce((s, x) => s + x.residual, 0))}`
              : 'Tidak ada yang lewat jatuh tempo'}
          </p>
        </Panel>
        <Panel className="p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-medium text-ink-soft">Utang ke supplier</h2>
            <Link to="/tagihan" className="text-sm text-navy-600 hover:underline">Tagihan</Link>
          </div>
          <p className="num mt-1 text-2xl font-semibold text-navy">{formatRupiah(apTotal)}</p>
          <p className={`mt-1 text-sm ${apDueSoon.length ? 'font-medium text-orange-600' : 'text-ink-soft'}`}>
            {apDueSoon.length
              ? `${apDueSoon.length} tagihan jatuh tempo dalam 7 hari atau sudah lewat, ${formatRupiah(apDueSoon.reduce((s, x) => s + x.residual, 0))}`
              : 'Tidak ada yang jatuh tempo minggu ini'}
          </p>
        </Panel>
        <Panel className={`p-5 ${overLimit.length ? 'border-bad/50' : ''}`}>
          <h2 className="text-sm font-medium text-ink-soft">Batas kredit pelanggan</h2>
          {overLimit.length === 0 ? (
            <p className="mt-1 text-lg font-semibold text-ok">Semua dalam batas</p>
          ) : (
            <>
              <p className="mt-1 text-lg font-semibold text-bad">{overLimit.length} pelanggan melewati batas</p>
              <ul className="mt-1 text-sm">
                {overLimit.map((p) => <li key={p.id}><Link to="/kontak" className="hover:underline">{p.name}</Link></li>)}
              </ul>
            </>
          )}
        </Panel>
      </div>

      <h2 className="mb-3 mt-8 text-base font-semibold text-navy">Jurnal bulan ini</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {summaries.map((s) => {
          const j = data.journals.find((x) => x.id === s.journalId)!;
          return (
            <Panel key={s.journalId} className="flex flex-col p-4">
              <div className="flex items-baseline justify-between">
                <h3 className="font-semibold text-ink">{j.name}</h3>
                <span className="text-xs text-ink-soft">{j.code}</span>
              </div>
              <p className="text-xs text-ink-soft">{JOURNAL_HINT[j.type]}</p>
              <p className="mt-3 text-xs text-ink-soft">Nilai entri</p>
              <p className="num text-lg font-semibold text-navy">{formatAmount(s.postedTotal)}</p>
              <p className="text-xs text-ink-soft">{s.postedCount} entri diposting</p>
              {s.draftCount > 0 && <p className="mt-2 text-xs font-medium text-orange-600">{s.draftCount} draft belum diposting</p>}
            </Panel>
          );
        })}
      </div>

      <h2 className="mb-3 mt-8 text-base font-semibold text-navy">Entri terbaru</h2>
      <Panel>
        {recent.length === 0 ? (
          <p className="p-5 text-sm text-ink-soft">Belum ada entri yang diposting.</p>
        ) : (
          <ul className="divide-y divide-line">
            {recent.map((e) => (
              <li key={e.id}>
                <Link to={`/entri/${e.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 hover:bg-navy-100/40">
                  <span className="min-w-0">
                    <span className="font-medium text-ink">{e.number}</span>
                    <span className="ml-2 text-sm text-ink-soft">{e.reference}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="num text-sm">{formatAmount(e.lines.reduce((t, l) => t + l.debit, 0))}</span>
                    <StatusBadge status={e.status} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
