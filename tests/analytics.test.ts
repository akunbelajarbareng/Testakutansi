/**
 * Mini App 6 — 7 skenario uji Analitik & Anggaran.
 * Jalankan: npm test
 */
import { describe, expect, it } from 'vitest';
import {
  actualAmount,
  allocate,
  analyticItems,
  budgetFromActual,
  budgetVsActual,
  dimensionalPnl,
  mandatoryIssues,
  monthPeriod,
  postEntry,
  profitAndLoss,
  setDistribution,
  splitByPlan,
  trialBalance,
  validateDistribution,
  withAnalyticDefaults,
  UNALLOCATED,
  type LedgerData,
} from '../src/domain';
import { PLAN_OUTLET, PLAN_PILAR, aaId, accountId, createDemoData, journalId } from '../src/data/seed';

const NOW = '2026-11-30T10:00:00.000Z';
let seq = 0;
const newId = () => `a-${++seq}`;
const NOV = monthPeriod('2026-11');

function post(data: LedgerData, date: string, lines: [string, number, number][], journal = 'BNK') {
  const e = withAnalyticDefaults(
    postEntry(
      {
        id: newId(),
        journalId: journalId(journal),
        number: null,
        date,
        reference: 'tes',
        status: 'draft',
        lines: lines.map(([code, debit, credit]) => ({ id: newId(), accountId: accountId(code), label: '', debit, credit })),
        createdAt: NOW,
      },
      data,
      NOW,
    ),
    data,
  );
  data.entries.push(e);
  return e;
}
const pillarOf = (data: LedgerData, code: string) => {
  const e = data.entries.find((x) => x.status !== 'draft' && x.lines.some((l) => l.accountId === accountId(code)))!;
  return splitByPlan(e.lines.find((l) => l.accountId === accountId(code))!.analytic, data).get(PLAN_PILAR);
};

describe('Skenario 1 — model distribusi listrik 60/30/10', () => {
  it('beban terbagi ke pilar dan total per pilar = Laba Rugi biasa', () => {
    const data = createDemoData();
    expect(pillarOf(data, '6202')).toEqual({ [aaId('P3')]: 60, [aaId('P2')]: 30, [aaId('P1')]: 10 });
    const d = dimensionalPnl(data, NOV, PLAN_PILAR);
    const opex = d.sections.find((s) => s.key === 'opex')!.lines.find((l) => l.account.code === '6202')!;
    expect(opex.values[aaId('P3')]).toBe(1_920_000);
    expect(opex.values[aaId('P2')]).toBe(960_000);
    expect(opex.values[aaId('P1')]).toBe(320_000);
    const total = Object.values(d.netProfit).reduce((a, b) => a + b, 0);
    expect(total).toBe(profitAndLoss(data, NOV).netProfit);
  });
});

describe('Skenario 2 — validasi & pembulatan distribusi', () => {
  it('total bukan 100% ditolak; sisa pembulatan masuk porsi terbesar', () => {
    const data = createDemoData();
    expect(validateDistribution({ [aaId('P1')]: 60, [aaId('P2')]: 30 }, data)[0]).toMatch(/90%/);
    expect(validateDistribution({ [aaId('P1')]: 60, [aaId('P2')]: 40, [aaId('L1')]: 100 }, data)).toEqual([]);
    const big = allocate(100_000, { a: 33.33, b: 33.33, c: 33.34 });
    expect(big).toEqual({ a: 33_330, b: 33_330, c: 33_340 });
    // Rp100 × 33,33% = 33,33 → 33; sisa Rp1 masuk ke porsi terbesar.
    const small = allocate(100, { a: 33.33, b: 33.33, c: 33.34 });
    expect(small).toEqual({ a: 33, b: 33, c: 34 });
  });
});

describe('Skenario 3 — pengisian otomatis', () => {
  it('pendapatan & HPP pilar otomatis; kas toko otomatis ke outlet Toko', () => {
    const data = createDemoData();
    expect(pillarOf(data, '4103')).toEqual({ [aaId('P3')]: 100 });
    const recap = data.entries.find((e) => e.source?.type === 'retail_recap' && e.lines.some((l) => l.accountId === accountId('1101')))!;
    const rev = recap.lines.find((l) => l.accountId === accountId('4101'))!;
    expect(splitByPlan(rev.analytic, data).get(PLAN_PILAR)).toEqual({ [aaId('P1')]: 100 });
    expect(splitByPlan(rev.analytic, data).get(PLAN_OUTLET)).toEqual({ [aaId('L1')]: 100 });
    // Baris neraca tidak pernah membawa analitik.
    expect(recap.lines.find((l) => l.accountId === accountId('1101'))!.analytic).toBeUndefined();
  });

  it('dimensi wajib yang kosong memblokir posting', () => {
    const data = createDemoData();
    data.analyticPlans = data.analyticPlans.map((p) => (p.id === PLAN_PILAR ? { ...p, applicability: { ...p.applicability, opex: 'mandatory' } } : p));
    const e = post(data, '2026-11-10', [['6201', 2_000_000, 0], ['1111', 0, 2_000_000]]);
    expect(mandatoryIssues(e, data)[0]).toMatch(/Pilar wajib/);
  });
});

describe('Skenario 4 — edit massal', () => {
  it('distribusi terpasang, saldo akun tidak berubah; periode tertutup ditolak', () => {
    const data = createDemoData();
    post(data, '2026-11-10', [['6201', 2_000_000, 0], ['1111', 0, 2_000_000]]);
    post(data, '2026-11-11', [['6101', 5_000_000, 0], ['1111', 0, 5_000_000]]);
    const tbBefore = JSON.stringify(trialBalance(data, {}).rows.map((r) => [r.account.code, r.closing]));
    const items = analyticItems(data, NOV).filter((i) => i.missingPlans.includes(PLAN_PILAR));
    expect(items.map((i) => i.account.code).sort()).toEqual(['6101', '6201']);
    const updated = setDistribution(items.map((i) => i.ref), PLAN_PILAR, { [aaId('P1')]: 50, [aaId('P3')]: 50 }, data);
    data.entries = data.entries.map((e) => updated.find((u) => u.id === e.id) ?? e);
    expect(analyticItems(data, NOV).filter((i) => i.missingPlans.includes(PLAN_PILAR))).toHaveLength(0);
    expect(JSON.stringify(trialBalance(data, {}).rows.map((r) => [r.account.code, r.closing]))).toBe(tbBefore);

    data.company.lockDate = '2026-11-30';
    expect(() => setDistribution([items[0].ref], PLAN_PILAR, { [aaId('P1')]: 100 }, data)).toThrowError(/ditutup/);
  });
});

describe('Skenario 5 — biaya bersama: tidak teralokasi vs alokasi menurut pendapatan', () => {
  it('kedua mode menghasilkan total laba bersih yang sama', () => {
    const data = createDemoData();
    post(data, '2026-11-10', [['6201', 2_000_000, 0], ['1111', 0, 2_000_000]]); // sewa, tanpa distribusi
    const a = dimensionalPnl(data, NOV, PLAN_PILAR, 'unallocated');
    const b = dimensionalPnl(data, NOV, PLAN_PILAR, 'byRevenue');
    const sum = (r: Record<string, number>) => Object.values(r).reduce((x, y) => x + y, 0);
    expect(a.netProfit[UNALLOCATED]).toBe(-2_000_000);
    expect(b.netProfit[UNALLOCATED]).toBe(0);
    expect(sum(a.netProfit)).toBe(sum(b.netProfit));
    expect(sum(a.netProfit)).toBe(profitAndLoss(data, NOV).netProfit);
    // Grosir (pendapatan terbesar) menanggung porsi sewa terbesar.
    expect(a.netProfit[aaId('P3')] - b.netProfit[aaId('P3')]).toBeGreaterThan(a.netProfit[aaId('P1')] - b.netProfit[aaId('P1')]);
  });
});

describe('Skenario 6 — anggaran vs realisasi', () => {
  it('listrik Rp3.000.000 vs realisasi Rp3.200.000 → −Rp200.000, 106,7%, merah', () => {
    const data = createDemoData();
    const r = budgetVsActual(data, data.budgets[0], NOV).rows.find((x) => x.account.code === '6202')!;
    expect(r.budget).toBe(3_000_000);
    expect(r.actual).toBe(3_200_000);
    expect(r.variance).toBe(-200_000);
    expect(r.achievement!.toFixed(1)).toBe('106.7');
    expect(r.status).toBe('bad');
    // Realisasi per pilar mengikuti distribusi.
    expect(actualAmount(data, accountId('6202'), NOV, aaId('P3'))).toBe(1_920_000);
    expect(actualAmount(data, accountId('6202'), NOV, aaId('L2'))).toBe(3_200_000); // induk Gudang = Kering + Frozen
  });
});

describe('Skenario 7 — salin anggaran dari realisasi + 10%', () => {
  it('setiap bulan per akun terisi', () => {
    const data = createDemoData();
    const lines = budgetFromActual(data, '2026', '2027', 10, newId);
    const listrik = lines.find((l) => l.accountId === accountId('6202'))!;
    expect(listrik.amounts[10]).toBe(3_520_000);
    expect(listrik.amounts[0]).toBe(0);
    const grosir = lines.find((l) => l.accountId === accountId('4103'))!;
    expect(grosir.amounts[10]).toBe(22_220_000);
  });
});
