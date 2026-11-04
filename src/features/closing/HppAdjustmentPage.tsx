import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { cogsAccounts, hppWorksheet, monthEnd, proportionalAllocation, shiftMonth } from '../../domain';
import { formatAmount, formatDate, formatMonth, formatRupiah, todayISO } from '../../lib/format';
import { useLedger, useLedgerData } from '../../store/ledgerStore';
import { MoneyInput } from '../../components/MoneyInput';
import { Alert, Button, DocBadge, Field, PageHeader, Panel, errorMessage, inputClass, td, tdNum, th, thNum } from '../../components/ui';

export function HppAdjustmentPage() {
  const data = useLedgerData();
  const { postHpp, cancelHpp } = useLedger();
  const today = todayISO();
  const [month, setMonth] = useState(today.slice(0, 7));
  const periodEnd = monthEnd(month);
  const rows = useMemo(() => hppWorksheet(data, periodEnd), [data, periodEnd]);
  const [counted, setCounted] = useState<Record<string, number | undefined>>({});
  const [manual, setManual] = useState<Record<string, number> | null>(null);
  const [notes, setNotes] = useState('');
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const usage = (id: string, book: number) => (counted[id] === undefined ? 0 : book - counted[id]!);
  const goodsUsage = rows.filter((r) => !r.isPackaging).reduce((s, r) => s + usage(r.accountId, r.book), 0);
  const packaging = rows.find((r) => r.isPackaging)!;
  const proportional = useMemo(() => proportionalAllocation(data, periodEnd, goodsUsage), [data, periodEnd, goodsUsage]);
  const allocation = manual ?? proportional;
  const cogs = cogsAccounts(data);
  const allocTotal = cogs.reduce((s, c) => s + (allocation[c.account.id] ?? 0), 0);
  const allFilled = rows.every((r) => counted[r.accountId] !== undefined);
  const existing = data.hppAdjustments.find((h) => h.periodEnd === periodEnd && h.status === 'posted');
  const history = [...data.hppAdjustments].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
  const locked = !!data.company.lockDate && periodEnd <= data.company.lockDate;

  const revenueOf = (code: string) => {
    const a = data.accounts.find((x) => x.code === code);
    let r = 0;
    for (const e of data.entries) {
      if (e.status === 'draft' || e.date < `${month}-01` || e.date > periodEnd || e.source?.type === 'closing') continue;
      for (const l of e.lines) if (l.accountId === a?.id) r += l.credit - l.debit;
    }
    return r;
  };

  const submit = async () => {
    setMessage(null);
    try {
      await postHpp({ periodEnd, counted: counted as Record<string, number>, allocation, notes });
      setMessage({ tone: 'ok', text: `Jurnal penyesuaian HPP ${formatMonth(month)} dibuat.` });
      setCounted({});
      setManual(null);
      setNotes('');
    } catch (e) {
      setMessage({ tone: 'error', text: errorMessage(e) });
    }
  };

  return (
    <>
      <PageHeader
        back={{ to: '/tutup-buku', label: 'Tutup Buku' }}
        title="Penyesuaian HPP dari Stok Opname"
        subtitle="Masukkan nilai stok fisik akhir bulan (harga beli). Selisih dengan saldo buku menjadi HPP."
      />
      <div className="space-y-4">
        {message && <Alert tone={message.tone}>{message.text}</Alert>}
        <Panel className="flex flex-wrap items-end gap-4 p-5">
          <div className="w-48">
            <Field label="Bulan">
              <input type="month" className={inputClass} value={month} max={today.slice(0, 7)} onChange={(e) => { setMonth(e.target.value); setCounted({}); setManual(null); }} />
            </Field>
          </div>
          <p className="pb-2 text-sm text-ink-soft">Jurnal bertanggal {formatDate(periodEnd)}.</p>
          <Button variant="ghost" className="mb-0.5" onClick={() => setMonth(shiftMonth(month, -1))}>Bulan sebelumnya</Button>
        </Panel>

        {existing ? (
          <Alert tone="info">Penyesuaian HPP {formatMonth(month)} sudah dibuat. Batalkan di riwayat di bawah bila perlu membuat ulang.</Alert>
        ) : locked ? (
          <Alert tone="warn">Periode {formatMonth(month)} sudah ditutup. Buka kembali di Tutup Buku bila perlu.</Alert>
        ) : (
          <>
            <Panel>
              <h2 className="border-b border-line px-5 py-3 font-semibold text-navy">1. Nilai stok opname</h2>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse">
                  <thead>
                    <tr>
                      <th className={th}>Akun persediaan</th>
                      <th className={thNum}>Saldo buku {formatDate(periodEnd)}</th>
                      <th className={`${thNum} w-48`}>Nilai stok opname</th>
                      <th className={thNum}>Pemakaian</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.accountId}>
                        <td className={td}>
                          <span className="num text-ink-soft">{r.code}</span> {r.name}
                          {r.isPackaging && <span className="block text-xs text-ink-soft">Pemakaian dicatat ke 6204 Perlengkapan Toko</span>}
                        </td>
                        <td className={tdNum}>{formatAmount(r.book)}</td>
                        <td className="border-b border-line px-3 py-2">
                          <MoneyInput value={counted[r.accountId] ?? 0} onChange={(v) => { setCounted({ ...counted, [r.accountId]: v }); setManual(null); }} aria-label={`Stok opname ${r.code}`} />
                        </td>
                        <td className={`${tdNum} ${usage(r.accountId, r.book) < 0 ? 'text-orange-600' : ''}`}>{counted[r.accountId] === undefined ? '' : formatAmount(usage(r.accountId, r.book))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="px-5 py-3 text-xs text-ink-soft">
                Isi 0 bila stoknya habis. Pemakaian negatif berarti stok fisik lebih banyak dari catatan; periksa tagihan pembelian yang belum diinput.
              </p>
            </Panel>

            <Panel>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
                <h2 className="font-semibold text-navy">2. Pembagian HPP barang ke pilar</h2>
                {manual && <Button variant="ghost" onClick={() => setManual(null)}>Isi ulang proporsional</Button>}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse">
                  <thead>
                    <tr>
                      <th className={th}>Pilar</th>
                      <th className={thNum}>Penjualan bulan ini</th>
                      <th className={thNum}>Usulan proporsional</th>
                      <th className={`${thNum} w-48`}>HPP dibukukan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cogs.map((c) => (
                      <tr key={c.account.id}>
                        <td className={td}>{c.pillar} <span className="text-xs text-ink-soft">({c.account.code})</span></td>
                        <td className={tdNum}>{formatAmount(revenueOf(c.revenueCode), true)}</td>
                        <td className={`${tdNum} text-ink-soft`}>{formatAmount(proportional[c.account.id] ?? 0)}</td>
                        <td className="border-b border-line px-3 py-2">
                          <MoneyInput value={allocation[c.account.id] ?? 0} onChange={(v) => setManual({ ...allocation, [c.account.id]: v })} aria-label={`HPP ${c.pillar}`} />
                        </td>
                      </tr>
                    ))}
                    <tr className="font-semibold">
                      <td className={td} colSpan={3}>Total dibagi / HPP barang</td>
                      <td className={`${tdNum} ${allocTotal === goodsUsage ? 'text-ok' : 'text-bad'}`}>{formatAmount(allocTotal)} / {formatAmount(goodsUsage)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="px-5 py-3 text-xs text-ink-soft">
                {manual
                  ? 'Pembagian sudah dikoreksi; laporan per pilar tidak diberi label estimasi.'
                  : 'Pembagian proporsional terhadap penjualan membuat margin antar pilar sama. Koreksi bila stok tiap pilar dihitung terpisah (mis. gudang grosir dan toko retail).'}
              </p>
            </Panel>

            <Panel className="flex flex-wrap items-end gap-4 p-5">
              <div className="min-w-[260px] flex-1"><Field label="Catatan"><input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="mis. opname gudang & toko, penanggung jawab" /></Field></div>
              <div className="text-right text-sm">
                <div>HPP barang <span className="num font-semibold">{formatRupiah(goodsUsage)}</span></div>
                <div className="text-ink-soft">Pemakaian kemasan <span className="num">{formatRupiah(usage(packaging.accountId, packaging.book))}</span></div>
              </div>
              <Button variant="primary" disabled={!allFilled || allocTotal !== goodsUsage} onClick={submit}>Buat jurnal HPP</Button>
            </Panel>
          </>
        )}

        {history.length > 0 && (
          <Panel>
            <h2 className="border-b border-line px-5 py-3 font-semibold text-navy">Riwayat penyesuaian</h2>
            <ul className="divide-y divide-line text-sm">
              {history.map((h) => {
                const total = Object.values(h.allocation).reduce((a, b) => a + b, 0);
                return (
                  <li key={h.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <span>
                      <span className="font-medium">{formatMonth(h.periodEnd.slice(0, 7))}</span>
                      <span className="ml-2 text-ink-soft">HPP {formatRupiah(total)}{h.edited ? ', pembagian dikoreksi' : ', pembagian proporsional'}</span>
                      <Link className="ml-2 text-navy-600 hover:underline" to={`/entri/${h.entryId}`}>Lihat jurnal</Link>
                    </span>
                    <span className="flex items-center gap-2">
                      <DocBadge state={h.status === 'posted' ? 'posted' : 'cancelled'} />
                      {h.status === 'posted' && (
                        <Button variant="ghost" onClick={async () => { try { await cancelHpp(h.id, h.periodEnd); setMessage({ tone: 'ok', text: 'Penyesuaian dibatalkan, jurnalnya dibalik.' }); } catch (e) { setMessage({ tone: 'error', text: errorMessage(e) }); } }}>
                          Batalkan
                        </Button>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Panel>
        )}
      </div>
    </>
  );
}
