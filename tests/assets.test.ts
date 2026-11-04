/**
 * Mini App 7 — 7 skenario uji Aset & Penyusutan (+ penangguhan).
 * Jalankan: npm test
 */
import { describe, expect, it } from 'vitest';
import {
  LedgerError,
  addImprovement,
  assetSchedule,
  deferralSchedule,
  disposeAsset,
  fiscalComparison,
  fiscalSchedule,
  postDepreciationRun,
  registerVsLedger,
  sourceCandidates,
  splitByPlan,
  trialBalance,
  withAnalyticDefaults,
  type Asset,
  type LedgerData,
} from '../src/domain';
import { PLAN_PILAR, aaId, catId, createDemoData, journalId } from '../src/data/seed';

const NOW = '2026-11-30T10:00:00.000Z';
let seq = 0;
const opts = { now: NOW, newId: () => `as-${++seq}` };

const chiller = (over: Partial<Asset> = {}): Asset => ({
  id: 'a1', code: 'T-1', name: 'Chiller uji', categoryId: catId('peralatan'), serial: '',
  acquisitionDate: '2026-01-05', inServiceDate: '2026-01-05', cost: 24_000_000, salvage: 0, usefulLifeMonths: 48,
  fiscalGroup: 'G1', fiscalMethod: 'SL', status: 'running', openingAccumulated: 0, improvements: [], createdAt: NOW, ...over,
});
const bal = (data: LedgerData, code: string) => {
  const r = trialBalance(data, {}).rows.find((x) => x.account.code === code);
  return r ? r.closing.debit - r.closing.credit : 0;
};
function run(data: LedgerData, period: string) {
  const r = postDepreciationRun(period, data, opts);
  data.depreciationRuns.push(r.run);
  data.entries.push(withAnalyticDefaults(r.entry, data));
  return r;
}

describe('Skenario 1 — garis lurus 48 bulan', () => {
  it('Rp500.000/bulan, nilai buku akhir tepat Rp0', () => {
    const s = assetSchedule(chiller());
    expect(s).toHaveLength(48);
    expect(s[0]).toMatchObject({ period: '2026-01', depreciation: 500_000 });
    expect(s[47].bookValue).toBe(0);
    const odd = assetSchedule(chiller({ cost: 10_000_000, usefulLifeMonths: 3 }));
    expect(odd.map((r) => r.depreciation)).toEqual([3_333_333, 3_333_334, 3_333_333]);
    expect(odd[2].bookValue).toBe(0);
  });

  it('saldo awal aset lama: penyusutan berlanjut dari bulan setelah saldo awal', () => {
    const truk = createDemoData().assets.find((a) => a.code === 'KND-001')!;
    const s = assetSchedule(truk);
    expect(s[0]).toMatchObject({ period: '2026-11', depreciation: 1_875_000, accumulated: 65_625_000 });
    expect(s).toHaveLength(96 - 34);
  });
});

describe('Skenario 2 — fiskal saldo menurun 50%', () => {
  it('tahun 1 Rp12 jt, tahun 2 Rp6 jt, tahun terakhir sisa sekaligus', () => {
    const f = fiscalSchedule(chiller({ fiscalMethod: 'DB' }));
    expect(f.map((r) => r.depreciation)).toEqual([12_000_000, 6_000_000, 3_000_000, 3_000_000]);
    expect(f[3].bookValue).toBe(0);
    // Perolehan Juli: tahun pertama prorata 6 bulan.
    const jul = fiscalSchedule(chiller({ acquisitionDate: '2026-07-01', fiscalMethod: 'SL' }));
    expect(jul[0].depreciation).toBe(3_000_000);
  });
});

describe('Skenario 3 — draft aset dari tagihan vendor', () => {
  it('baris tagihan ke akun aset menjadi kandidat dengan nilai tanpa PPN', () => {
    const data = createDemoData();
    data.assets = data.assets.filter((a) => a.code !== 'PRL-001');
    const c = sourceCandidates(data).find((x) => x.target === 'asset')!;
    expect(c.amount).toBe(24_000_000);
    expect(c.description).toBe('Chiller display 2 pintu');
    const def = sourceCandidates(createDemoData());
    expect(def).toHaveLength(0); // semua sudah punya kartu di data contoh
  });
});

describe('Skenario 4 — run penyusutan bulanan', () => {
  it('dibukukan sekali, beban terbagi ke pilar aset; penangguhan ikut', () => {
    const data = createDemoData();
    const r = run(data, '2026-11');
    expect(r.run.items.find((i) => i.id === 'ast-truk-01')!.amount).toBe(1_875_000);
    expect(r.run.items.find((i) => i.id === 'ast-chiller-01')!.amount).toBe(500_000);
    expect(r.run.items.find((i) => i.id === 'def-sewa-01')!.amount).toBe(3_000_000);
    expect(r.run.items.find((i) => i.id === 'def-learn-01')!.amount).toBe(1_000_000);
    expect(bal(data, '6301')).toBe(2_375_000);
    expect(bal(data, '1403')).toBe(33_000_000);
    expect(bal(data, '2303')).toBe(-5_000_000);
    const truckLine = data.entries.at(-1)!.lines.find((l) => l.label.includes('KND-001') && l.debit > 0)!;
    expect(splitByPlan(truckLine.analytic, data).get(PLAN_PILAR)).toEqual({ [aaId('P3')]: 70, [aaId('P2')]: 30 });
    expect(() => postDepreciationRun('2026-11', data, opts)).toThrowError(/sudah dibukukan/);
    expect(() => postDepreciationRun('2027-01', data, opts)).toThrowError(/2026-12/);
    expect(trialBalance(data, {}).balanced).toBe(true);
  });

  it('register cocok dengan buku besar', () => {
    const data = createDemoData();
    run(data, '2026-11');
    const checks = registerVsLedger(data, '2026-11-30');
    const k = checks.find((c) => c.categoryId === catId('kendaraan'))!;
    expect(k.registerCost).toBe(k.glCost);
    expect(k.registerAccum).toBe(k.glAccum);
    const p = checks.find((c) => c.categoryId === catId('peralatan'))!;
    expect([p.registerCost, p.registerAccum]).toEqual([p.glCost, p.glAccum]);
  });
});

describe('Skenario 5 — penjualan kendaraan', () => {
  it('laba pelepasan tercatat, saldo aset & akumulasi untuk unit itu nol', () => {
    const data = createDemoData();
    run(data, '2026-11');
    run(data, '2026-12');
    const truk = data.assets.find((a) => a.code === 'KND-001')!;
    expect(() => disposeAsset(truk, { date: '2027-02-10', type: 'sale', proceeds: 1, journalId: journalId('BNK'), note: '' }, data, opts)).toThrowError(/2027-01/);
    // Nilai buku per akhir Des: 180 − 63,75 − 2 × 1,875 = 112,5 jt; dijual 115 jt.
    const r = disposeAsset(truk, { date: '2027-01-10', type: 'sale', proceeds: 115_000_000, journalId: journalId('BNK'), note: '' }, data, opts);
    data.entries.push(r.entry);
    data.assets = data.assets.map((a) => (a.id === truk.id ? r.asset : a));
    expect(bal(data, '7103')).toBe(-2_500_000);
    expect(bal(data, '1501')).toBe(0);
    expect(bal(data, '1502')).toBe(0);
    expect(trialBalance(data, {}).balanced).toBe(true);
    expect(assetSchedule(r.asset).at(-1)!.period).toBe('2026-12');
  });
});

describe('Skenario 6 — perbaikan dikapitalisasi', () => {
  it('nilai buku bertambah dan beban sisa dihitung ulang', () => {
    const data = createDemoData();
    const a = chiller();
    data.assets.push(a);
    // Setelah 12 bulan: nilai buku 18 jt, sisa 36 bulan. Tambah 6 jt & 12 bulan → 24 jt / 48 = 500.000.
    const improved = addImprovement(a, { date: '2027-01-15', amount: 6_000_000, extraMonths: 12, note: 'Ganti kompresor' }, data, opts.newId);
    const s = assetSchedule(improved);
    expect(s.find((r) => r.period === '2026-12')!.bookValue).toBe(18_000_000);
    expect(s.find((r) => r.period === '2027-01')!.depreciation).toBe(500_000);
    expect(s).toHaveLength(60);
    expect(s.at(-1)!.bookValue).toBe(0);
    expect(() => addImprovement(a, { date: '2027-01-01', amount: 0, extraMonths: 0, note: '' }, data, opts.newId)).toThrowError(LedgerError);
  });
});

describe('Skenario 7 — komersial vs fiskal', () => {
  it('aset lama: perbandingan memakai jadwal komersial setahun penuh, bukan sejak aplikasi dipakai', () => {
    const data = createDemoData();
    const rows = fiscalComparison(data, '2026');
    const truk = rows.find((r) => r.asset.code === 'KND-001')!;
    expect(truk.commercial).toBe(22_500_000);
    expect(truk.correction).toBe(0);
    // Chiller: fiskal mulai bulan perolehan (Okt), komersial mulai dipakai (Nov).
    const ch = rows.find((r) => r.asset.code === 'PRL-001')!;
    expect([ch.commercial, ch.fiscal, ch.correction]).toEqual([1_000_000, 1_500_000, -500_000]);
  });

  it('register vs buku besar per tanggal di tengah bulan tidak menghitung run akhir bulan', () => {
    const data = createDemoData();
    run(data, '2026-11');
    const mid = registerVsLedger(data, '2026-11-04').find((c) => c.categoryId === catId('kendaraan'))!;
    expect(mid.registerAccum).toBe(mid.glAccum);
  });

  it('komersial 5 tahun vs fiskal kelompok 1 → koreksi fiskal negatif', () => {
    const data = createDemoData();
    data.assets = [chiller({ usefulLifeMonths: 60 })];
    const [row] = fiscalComparison(data, '2026');
    expect(row.commercial).toBe(4_800_000); // 400.000 × 12
    expect(row.fiscal).toBe(6_000_000); // 25%
    expect(row.correction).toBe(-1_200_000);
  });

  it('penangguhan: 12 bulan rata, saldo awal yang sudah diakui dilewati', () => {
    const d = createDemoData().deferrals.find((x) => x.kind === 'expense')!;
    expect(deferralSchedule(d).map((r) => r.amount)).toEqual(Array(12).fill(3_000_000));
    const opened = deferralSchedule({ ...d, openingRecognized: 7_500_000 });
    expect(opened[0]).toMatchObject({ period: '2027-01', amount: 1_500_000 });
    expect(opened.reduce((s, r) => s + r.amount, 0)).toBe(28_500_000);
  });
});
