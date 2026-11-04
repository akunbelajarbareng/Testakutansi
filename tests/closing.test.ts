/**
 * Mini App 4 — 7 skenario uji Laporan Keuangan & Tutup Buku.
 * Jalankan: npm test
 */
import { describe, expect, it } from 'vitest';
import {
  LedgerError,
  balanceSheet,
  buildClosingEntry,
  cancelClosingEntry,
  closePeriod,
  closingChecklist,
  comparePeriod,
  hppWorksheet,
  monthPeriod,
  netProfit,
  pillarMargins,
  pnlRemainingForYear,
  postEntry,
  postHppAdjustment,
  profitAndLoss,
  proportionalAllocation,
  reopenPeriod,
  snapshotChanges,
  trialBalance,
  type JournalEntry,
  type LedgerData,
} from '../src/domain';
import { accountId, createDemoData, createEmptyData, journalId } from '../src/data/seed';

const NOW = '2026-11-30T10:00:00.000Z';
let seq = 0;
const opts = { now: NOW, newId: () => `c-${++seq}` };
const NOV = monthPeriod('2026-11');

function entry(data: LedgerData, date: string, lines: [string, number, number][]): JournalEntry {
  const e = postEntry(
    {
      id: opts.newId(),
      journalId: journalId('UMUM'),
      number: null,
      date,
      reference: 'tes',
      status: 'draft',
      lines: lines.map(([code, debit, credit]) => ({ id: opts.newId(), accountId: accountId(code), label: '', debit, credit })),
      createdAt: NOW,
    },
    data,
    NOW,
  );
  data.entries.push(e);
  return e;
}

/** Bersihkan draft data contoh agar periode bisa ditutup. */
const withoutDrafts = (d: LedgerData): LedgerData => ({ ...d, entries: d.entries.filter((e) => e.status !== 'draft'), invoices: d.invoices.filter((i) => i.status !== 'draft') });

describe('Skenario 1 — Laba Rugi November', () => {
  it('pendapatan − HPP − beban = laba bersih', () => {
    const data = createDemoData();
    const pnl = profitAndLoss(data, NOV);
    // Retail kini tanpa PPN: 02/11 Rp5.000.000 bruto → DPP 4.504.505; 03/11 Rp6.750.000 (Rp1.200.000 bebas PPN) → 1.200.000 + 5.000.000.
    expect(pnl.sections[0].lines.find((l) => l.account.code === '4101')!.amount).toBe(10_704_505);
    expect(pnl.revenue).toBe(32_464_505);
    expect(pnl.sections.find((s) => s.key === 'opex')!.total).toBe(3_200_000);
    expect(pnl.netProfit).toBe(29_264_505);
    expect(pnl.netProfit).toBe(netProfit(data, NOV));
  });

  it('periode pembanding: bulan sebelumnya & tahun lalu', () => {
    expect(comparePeriod(NOV, 'previous')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(comparePeriod({ from: '2026-01-01', to: '2026-03-31' }, 'previous')).toEqual({ from: '2025-10-01', to: '2025-12-31' });
    expect(comparePeriod(NOV, 'lastYear')).toEqual({ from: '2025-11-01', to: '2025-11-30' });
    const pnl = profitAndLoss(createDemoData(), NOV, comparePeriod(NOV, 'previous'));
    expect(pnl.cmp!.revenue).toBe(3_000_000);
  });
});

describe('Skenario 2 — Neraca', () => {
  it('Aset = Kewajiban + Ekuitas, laba tahun berjalan masuk ekuitas', () => {
    const data = createDemoData();
    const bs = balanceSheet(data, '2026-11-30', '2026-10-31');
    expect(bs.balanced).toBe(true);
    const ytd = bs.equity[0].lines.find((l) => l.label === 'Laba tahun berjalan')!;
    expect(ytd.amount).toBe(netProfit(data, { from: '2026-01-01', to: '2026-11-30' }));
    expect(ytd.amount).toBe(33_714_505);
    expect(bs.cmpTotals!.assets).toBe(bs.cmpTotals!.liabilities + bs.cmpTotals!.equity);
  });
});

describe('Skenario 3 — angka laporan bisa ditelusuri ke akun', () => {
  it('setiap baris Laba Rugi membawa akun asalnya', () => {
    const pnl = profitAndLoss(createDemoData(), NOV);
    const grosir = pnl.sections[0].lines.find((l) => l.account.code === '4103')!;
    expect(grosir.amount).toBe(20_200_000);
    expect(grosir.account.id).toBe(accountId('4103'));
  });
});

describe('Skenario 4 — penyesuaian HPP dari stok opname', () => {
  it('saldo buku − opname = HPP, dibagi ke pilar', () => {
    const data = createDemoData();
    const ws = hppWorksheet(data, '2026-11-30');
    expect(ws.find((r) => r.code === '1301')!.book).toBe(57_400_000);
    const total = 23_400_000 + 2_400_000;
    const prop = proportionalAllocation(data, '2026-11-30', total);
    expect(Object.values(prop).reduce((a, b) => a + b, 0)).toBe(total);
    expect(prop[accountId('5103')]).toBeGreaterThan(prop[accountId('5101')]);

    const counted = { [accountId('1301')]: 34_000_000, [accountId('1302')]: 6_000_000, [accountId('1303')]: 0, [accountId('1304')]: 0 };
    expect(() => postHppAdjustment({ periodEnd: '2026-11-30', counted, allocation: { ...prop, [accountId('5101')]: 1 }, notes: '' }, data, opts)).toThrowError(/harus sama/);

    const { record, entry: e } = postHppAdjustment({ periodEnd: '2026-11-30', counted, allocation: prop, notes: '' }, data, opts);
    expect(record.edited).toBe(false);
    data.hppAdjustments.push(record);
    data.entries.push(e);
    expect(hppWorksheet(data, '2026-11-30').find((r) => r.code === '1301')!.book).toBe(34_000_000);
    expect(profitAndLoss(data, NOV).grossProfit).toBe(32_464_505 - total);
    expect(pillarMargins(data, NOV).estimated).toBe(true);
    expect(trialBalance(data, {}).balanced).toBe(true);
    expect(() => postHppAdjustment({ periodEnd: '2026-11-30', counted, allocation: prop, notes: '' }, data, opts)).toThrowError(/sudah ada/);
  });

  it('pembagian yang dikoreksi tidak lagi ditandai estimasi', () => {
    const data = createDemoData();
    const counted = { [accountId('1301')]: 57_000_000, [accountId('1302')]: 8_400_000, [accountId('1303')]: 0, [accountId('1304')]: 0 };
    const { record, entry: e } = postHppAdjustment({ periodEnd: '2026-11-30', counted, allocation: { [accountId('5103')]: 400_000 }, notes: 'gudang grosir dihitung terpisah' }, data, opts);
    data.hppAdjustments.push(record);
    data.entries.push(e);
    expect(record.edited).toBe(true);
    expect(pillarMargins(data, NOV).estimated).toBe(false);
  });
});

describe('Skenario 5 — tutup bulan', () => {
  it('ditolak bila masih ada draft; setelah bersih, tanggal kunci maju', () => {
    const data = createDemoData();
    expect(() => closePeriod({ periodEnd: '2026-11-30', notes: 'catatan panjang sekali' }, data, opts)).toThrowError(/draft/);

    const clean = withoutDrafts(data);
    const checks = closingChecklist(clean, '2026-10-31');
    expect(checks.filter((c) => c.level === 'required').every((c) => c.ok)).toBe(true);
    expect(checks.find((c) => c.id === 'hpp')!.ok).toBe(false);
    expect(() => closePeriod({ periodEnd: '2026-10-31', notes: '' }, clean, opts)).toThrowError(/alasannya/);
    const { record, lockDate } = closePeriod({ periodEnd: '2026-10-31', notes: 'HPP Oktober dihitung manual oleh akuntan' }, clean, opts);
    expect(lockDate).toBe('2026-10-31');
    expect(record.warningsAtClose.length).toBeGreaterThan(0);
  });
});

describe('Skenario 6 — buka kembali periode', () => {
  it('wajib alasan; perubahan angka setelah dibuka terdeteksi', () => {
    const data = withoutDrafts(createDemoData());
    const { record, lockDate } = closePeriod({ periodEnd: '2026-10-31', notes: 'peringatan diketahui direksi' }, data, opts);
    data.periodCloses.push(record);
    data.company.lockDate = lockDate;
    expect(() => reopenPeriod(record, 'salah', data, NOW)).toThrowError(LedgerError);
    const re = reopenPeriod(record, 'Ada tagihan listrik Oktober yang terlewat', data, NOW);
    expect(re.lockDate).toBeNull();
    data.company.lockDate = re.lockDate;
    data.periodCloses = [re.record];
    entry(data, '2026-10-31', [['6202', 500_000, 0], ['2401', 0, 500_000]]);
    const diff = snapshotChanges(re.record, data);
    expect(diff.find((d) => d.field === 'netProfit')).toMatchObject({ before: 3_000_000, after: 2_500_000 });
  });
});

describe('Skenario 7 — tutup tahun dengan jurnal penutup', () => {
  it('saldo pendapatan & beban jadi nol, laba pindah ke Laba Ditahan', () => {
    const data = createEmptyData();
    entry(data, '2026-01-02', [['1111', 100_000_000, 0], ['3101', 0, 100_000_000]]);
    entry(data, '2026-06-10', [['1111', 40_000_000, 0], ['4103', 0, 40_000_000]]);
    entry(data, '2026-06-30', [['5103', 25_000_000, 0], ['1301', 0, 25_000_000]]);
    entry(data, '2026-07-15', [['6202', 3_000_000, 0], ['1111', 0, 3_000_000]]);
    const closing = buildClosingEntry('2026', data, opts);
    data.entries.push(closing);

    expect(pnlRemainingForYear(data, '2026')).toBe(0);
    expect(profitAndLoss(data, { from: '2026-01-01', to: '2026-12-31' }).netProfit).toBe(12_000_000);
    const bs = balanceSheet(data, '2026-12-31');
    expect(bs.balanced).toBe(true);
    expect(bs.equity[0].lines.find((l) => l.account?.code === '3201')!.amount).toBe(12_000_000);
    expect(bs.equity[0].lines.find((l) => l.label === 'Laba tahun berjalan')!.amount).toBe(0);
    expect(closingChecklist(data, '2026-12-31').find((c) => c.id === 'yearend')!.ok).toBe(true);
    expect(() => buildClosingEntry('2026', data, opts)).toThrowError(/sudah ada/);

    // Transaksi setelah jurnal penutup terdeteksi di checklist; batalkan lalu buat ulang.
    entry(data, '2026-12-31', [['6202', 1_000_000, 0], ['1111', 0, 1_000_000]]);
    expect(closingChecklist(data, '2026-12-31').find((c) => c.id === 'yearend')!.ok).toBe(false);
    const { original, reversal } = cancelClosingEntry('2026', data, { ...opts, date: '2026-12-31' });
    data.entries = data.entries.map((e) => (e.id === original.id ? original : e)).concat(reversal);
    data.entries.push(buildClosingEntry('2026', data, opts));
    expect(pnlRemainingForYear(data, '2026')).toBe(0);
    expect(balanceSheet(data, '2026-12-31').equity[0].lines.find((l) => l.account?.code === '3201')!.amount).toBe(11_000_000);
  });
});
