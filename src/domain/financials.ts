/**
 * LAPORAN KEUANGAN — Laba Rugi, laba kotor per pilar, Neraca. Fungsi murni.
 *
 * Jurnal penutup tahun (source.type = 'closing') DIKECUALIKAN dari Laba Rugi,
 * agar laporan tahun yang sudah ditutup tetap menampilkan pendapatan & beban setahun penuh.
 */
import type { Account, AccountGroup, ISODate, JournalEntry, LedgerData, Money } from './types';
import { toNormalBalance } from './accounting';

export interface DateRange {
  from: ISODate;
  to: ISODate;
}

const isClosing = (e: JournalEntry) => e.source?.type === 'closing';
const counts = (e: JournalEntry) => e.status !== 'draft';

/** Mutasi bersih (kredit − debit) per akun dalam periode — positif = menambah laba. */
function profitEffects(data: LedgerData, p: DateRange, includeClosing = false): Map<string, Money> {
  const m = new Map<string, Money>();
  for (const e of data.entries) {
    if (!counts(e) || e.date < p.from || e.date > p.to) continue;
    if (!includeClosing && isClosing(e)) continue;
    for (const l of e.lines) m.set(l.accountId, (m.get(l.accountId) ?? 0) + l.credit - l.debit);
  }
  return m;
}

export const isPnlAccount = (a: Pick<Account, 'type'>) => a.type === 'income' || a.type === 'expense';

export interface PnlLine {
  account: Account;
  /** Nilai tampilan: pendapatan positif bila kredit, beban positif bila debit. */
  amount: Money;
  compare?: Money;
}

export interface PnlSection {
  key: string;
  title: string;
  /** income = menambah laba, expense = mengurangi laba, mixed = ditampilkan sebagai efek ke laba. */
  nature: 'income' | 'expense' | 'mixed';
  lines: PnlLine[];
  total: Money;
  compareTotal?: Money;
}

export interface ProfitAndLoss {
  period: DateRange;
  compare?: DateRange;
  sections: PnlSection[];
  revenue: Money;
  grossProfit: Money;
  operatingProfit: Money;
  profitBeforeTax: Money;
  netProfit: Money;
  cmp?: { revenue: Money; grossProfit: Money; operatingProfit: Money; profitBeforeTax: Money; netProfit: Money };
}

const SECTIONS: { key: string; title: string; group: AccountGroup; nature: PnlSection['nature'] }[] = [
  { key: 'revenue', title: 'Pendapatan', group: 'Pendapatan', nature: 'income' },
  { key: 'cogs', title: 'Harga Pokok Penjualan', group: 'Harga Pokok Penjualan', nature: 'expense' },
  { key: 'opex', title: 'Beban Operasional', group: 'Beban Operasional', nature: 'expense' },
  { key: 'other', title: 'Pendapatan & Beban Lain', group: 'Pendapatan & Beban Lain', nature: 'mixed' },
  { key: 'tax', title: 'Pajak Penghasilan', group: 'Pajak Penghasilan', nature: 'expense' },
];

function buildSections(data: LedgerData, eff: Map<string, Money>, cmp?: Map<string, Money>, includeZero = false): PnlSection[] {
  return SECTIONS.map((s) => {
    const lines: PnlLine[] = [];
    for (const a of [...data.accounts].sort((x, y) => x.code.localeCompare(y.code))) {
      if (a.group !== s.group) continue;
      const sign = s.nature === 'expense' ? -1 : 1;
      const amount = sign * (eff.get(a.id) ?? 0);
      const compare = cmp ? sign * (cmp.get(a.id) ?? 0) : undefined;
      if (!includeZero && amount === 0 && !compare) continue;
      lines.push({ account: a, amount, compare });
    }
    return {
      key: s.key,
      title: s.title,
      nature: s.nature,
      lines,
      total: lines.reduce((t, l) => t + l.amount, 0),
      compareTotal: cmp ? lines.reduce((t, l) => t + (l.compare ?? 0), 0) : undefined,
    };
  });
}

function summarize(sections: PnlSection[], pick: (s: PnlSection) => Money) {
  const v = (k: string) => pick(sections.find((s) => s.key === k)!);
  const revenue = v('revenue');
  const grossProfit = revenue - v('cogs');
  const operatingProfit = grossProfit - v('opex');
  const profitBeforeTax = operatingProfit + v('other');
  const netProfit = profitBeforeTax - v('tax');
  return { revenue, grossProfit, operatingProfit, profitBeforeTax, netProfit };
}

export function profitAndLoss(data: LedgerData, period: DateRange, compare?: DateRange): ProfitAndLoss {
  const sections = buildSections(data, profitEffects(data, period), compare ? profitEffects(data, compare) : undefined);
  const main = summarize(sections, (s) => s.total);
  return {
    period,
    compare,
    sections,
    ...main,
    cmp: compare ? summarize(sections, (s) => s.compareTotal ?? 0) : undefined,
  };
}

/** Laba bersih periode (tanpa jurnal penutup). */
export function netProfit(data: LedgerData, period: DateRange): Money {
  let sum = 0;
  for (const [id, v] of profitEffects(data, period)) {
    const a = data.accounts.find((x) => x.id === id);
    if (a && isPnlAccount(a)) sum += v;
  }
  return sum;
}

// ── Laba kotor per pilar ─────────────────────────────────────────────

export const PILLARS: { key: string; name: string; revenue: string; cogs: string | null }[] = [
  { key: 'retail', name: 'Oriental Retail', revenue: '4101', cogs: '5101' },
  { key: 'ukm', name: 'Supply Chain UKM', revenue: '4102', cogs: '5102' },
  { key: 'grosir', name: 'Oriental Grosir', revenue: '4103', cogs: '5103' },
  { key: 'whitelabel', name: 'White Label', revenue: '4104', cogs: '5104' },
  { key: 'learn', name: 'Oriental Learn', revenue: '4105', cogs: null },
  { key: 'waste', name: 'Waste Responsibility', revenue: '4106', cogs: null },
];

export interface PillarRow {
  key: string;
  name: string;
  revenue: Money;
  cogs: Money;
  grossProfit: Money;
  /** Margin kotor dalam persen; null bila tidak ada pendapatan. */
  margin: number | null;
}

export interface PillarReport {
  rows: PillarRow[];
  /** Pos yang belum bisa dibagi per pilar (retur, barang rusak, ongkos angkut). */
  unallocated: { label: string; amount: Money }[];
  /** true bila sebagian HPP periode ini dibagi murni proporsional (margin antar pilar jadi seragam). */
  estimated: boolean;
}

export function pillarMargins(data: LedgerData, period: DateRange): PillarReport {
  const eff = profitEffects(data, period);
  const byCode = (code: string) => {
    const a = data.accounts.find((x) => x.code === code);
    return a ? (eff.get(a.id) ?? 0) : 0;
  };
  const rows = PILLARS.map((p) => {
    const revenue = byCode(p.revenue);
    const cogs = p.cogs ? -byCode(p.cogs) : 0;
    const grossProfit = revenue - cogs;
    return { key: p.key, name: p.name, revenue, cogs, grossProfit, margin: revenue ? (grossProfit / revenue) * 100 : null };
  }).filter((r) => r.revenue !== 0 || r.cogs !== 0);
  const unallocated = [
    { label: 'Retur & potongan penjualan (4201)', amount: byCode('4201') },
    { label: 'Barang rusak/kedaluwarsa (5201)', amount: byCode('5201') },
    { label: 'Ongkos angkut pembelian (5202)', amount: byCode('5202') },
  ].filter((u) => u.amount !== 0);
  const estimated = data.hppAdjustments.some((h) => h.status === 'posted' && !h.edited && h.periodEnd >= period.from && h.periodEnd <= period.to);
  return { rows, unallocated, estimated };
}

// ── Neraca ───────────────────────────────────────────────────────────

export interface BsLine {
  account: Account | null;
  label: string;
  amount: Money;
  compare?: Money;
}

export interface BsGroup {
  title: string;
  lines: BsLine[];
  total: Money;
  compareTotal?: Money;
}

export interface BalanceSheet {
  asOf: ISODate;
  compareAsOf?: ISODate;
  assets: BsGroup[];
  liabilities: BsGroup[];
  equity: BsGroup[];
  totalAssets: Money;
  totalLiabilities: Money;
  totalEquity: Money;
  cmpTotals?: { assets: Money; liabilities: Money; equity: Money };
  balanced: boolean;
}

function netBalances(data: LedgerData, asOf: ISODate): Map<string, Money> {
  const m = new Map<string, Money>();
  for (const e of data.entries) {
    if (!counts(e) || e.date > asOf) continue;
    for (const l of e.lines) m.set(l.accountId, (m.get(l.accountId) ?? 0) + l.debit - l.credit);
  }
  return m;
}

/** Laba yang belum ditutup ke ekuitas, dipecah: tahun berjalan vs tahun-tahun sebelumnya. */
function unclosedEarnings(data: LedgerData, asOf: ISODate, net: Map<string, Money>) {
  let total = 0;
  for (const a of data.accounts) if (isPnlAccount(a)) total += -(net.get(a.id) ?? 0);
  // Termasuk jurnal penutup: setelah tahun ditutup, labanya sudah pindah ke Laba Ditahan.
  let current = 0;
  for (const [id, v] of profitEffects(data, { from: `${asOf.slice(0, 4)}-01-01`, to: asOf }, true)) {
    const a = data.accounts.find((x) => x.id === id);
    if (a && isPnlAccount(a)) current += v;
  }
  return { current, prior: total - current };
}

export function balanceSheet(data: LedgerData, asOf: ISODate, compareAsOf?: ISODate): BalanceSheet {
  const build = (d: ISODate) => {
    const net = netBalances(data, d);
    const group = (title: string, pred: (a: Account) => boolean): BsGroup => {
      const lines = data.accounts
        .filter(pred)
        .sort((a, b) => a.code.localeCompare(b.code))
        .map((a) => {
          // Aset ditampilkan debit − kredit (kontra jadi negatif); kewajiban & ekuitas kredit − debit.
          const raw = net.get(a.id) ?? 0;
          const amount = a.type === 'asset' ? raw : -raw;
          return { account: a, label: a.name, amount };
        })
        .filter((l) => l.amount !== 0);
      return { title, lines, total: lines.reduce((s, l) => s + l.amount, 0) };
    };
    const assets = [group('Aset Lancar', (a) => a.type === 'asset' && a.group === 'Aset Lancar'), group('Aset Tetap', (a) => a.type === 'asset' && a.group === 'Aset Tetap')];
    const liabilities = [group('Kewajiban', (a) => a.type === 'liability')];
    const eq = group('Ekuitas', (a) => a.type === 'equity');
    const earn = unclosedEarnings(data, d, net);
    if (earn.prior !== 0) eq.lines.push({ account: null, label: 'Laba tahun lalu yang belum ditutup', amount: earn.prior });
    eq.lines.push({ account: null, label: 'Laba tahun berjalan', amount: earn.current });
    eq.total = eq.lines.reduce((s, l) => s + l.amount, 0);
    return { assets, liabilities, equity: [eq] };
  };

  const main = build(asOf);
  const sum = (gs: BsGroup[]) => gs.reduce((s, g) => s + g.total, 0);
  const totalAssets = sum(main.assets);
  const totalLiabilities = sum(main.liabilities);
  const totalEquity = sum(main.equity);

  let cmpTotals: BalanceSheet['cmpTotals'];
  if (compareAsOf) {
    const c = build(compareAsOf);
    // Tempelkan nilai pembanding per baris (berdasarkan akun/label).
    const attach = (gs: BsGroup[], cs: BsGroup[]) =>
      gs.forEach((g, i) => {
        const cg = cs[i];
        g.compareTotal = cg.total;
        for (const cl of cg.lines) {
          const hit = g.lines.find((l) => (l.account && cl.account ? l.account.id === cl.account.id : l.label === cl.label));
          if (hit) hit.compare = cl.amount;
          else g.lines.push({ ...cl, amount: 0, compare: cl.amount });
        }
        g.lines.forEach((l) => (l.compare ??= 0));
      });
    attach(main.assets, c.assets);
    attach(main.liabilities, c.liabilities);
    attach(main.equity, c.equity);
    cmpTotals = { assets: sum(c.assets), liabilities: sum(c.liabilities), equity: sum(c.equity) };
  }

  return { asOf, compareAsOf, ...main, totalAssets, totalLiabilities, totalEquity, cmpTotals, balanced: totalAssets === totalLiabilities + totalEquity };
}

/** Saldo akun dengan tanda normal per tanggal (dipakai wizard HPP). */
export function accountBalanceAt(data: LedgerData, accountId: string, asOf: ISODate): Money {
  const a = data.accounts.find((x) => x.id === accountId);
  if (!a) return 0;
  return toNormalBalance(a, netBalances(data, asOf).get(accountId) ?? 0);
}

// ── Utilitas periode ─────────────────────────────────────────────────

export function monthEnd(yyyyMm: string): ISODate {
  const [y, m] = yyyyMm.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}

export function monthPeriod(yyyyMm: string): DateRange {
  return { from: `${yyyyMm}-01`, to: monthEnd(yyyyMm) };
}

export function shiftMonth(yyyyMm: string, delta: number): string {
  const [y, m] = yyyyMm.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

/** Periode pembanding: sebelumnya (panjang sama, tepat sebelum) atau tahun lalu (tanggal sama). */
export function comparePeriod(p: DateRange, mode: 'previous' | 'lastYear'): DateRange {
  if (mode === 'lastYear') {
    const back = (d: ISODate) => `${Number(d.slice(0, 4)) - 1}${d.slice(4)}`.replace(/-02-29$/, '-02-28');
    return { from: back(p.from), to: back(p.to) };
  }
  // Bulan penuh → bulan sebelumnya penuh; selain itu geser sepanjang durasi.
  if (p.from.endsWith('-01') && p.to === monthEnd(p.to.slice(0, 7))) {
    const months = (Number(p.to.slice(0, 4)) - Number(p.from.slice(0, 4))) * 12 + Number(p.to.slice(5, 7)) - Number(p.from.slice(5, 7)) + 1;
    const start = shiftMonth(p.from.slice(0, 7), -months);
    return { from: `${start}-01`, to: monthEnd(shiftMonth(start, months - 1)) };
  }
  const days = Math.round((Date.parse(p.to) - Date.parse(p.from)) / 86_400_000) + 1;
  const to = new Date(Date.parse(p.from) - 86_400_000).toISOString().slice(0, 10);
  const from = new Date(Date.parse(to) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  return { from, to };
}
