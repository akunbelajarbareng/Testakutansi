/**
 * ANALITIK & ANGGARAN — fungsi murni.
 *
 * Distribusi analitik adalah informasi manajemen yang menempel di baris jurnal.
 * Mengubahnya tidak mengubah debit/kredit/saldo akun, sehingga boleh diedit pada entri
 * yang sudah diposting — kecuali di periode yang sudah ditutup.
 */
import { LedgerError } from './errors';
import { isPnlAccount, type DateRange } from './financials';
import type {
  Account,
  AnalyticAccount,
  AnalyticDistribution,
  AnalyticPlan,
  Applicability,
  ApplicabilityKey,
  Budget,
  BudgetLine,
  JournalEntry,
  LedgerData,
  LineRef,
  Money,
} from './types';
import { formatRupiah } from '../lib/format';

// ── Dasar ────────────────────────────────────────────────────────────

export function applicabilityKey(a: Pick<Account, 'type' | 'group'>): ApplicabilityKey {
  if (!isPnlAccount(a)) return 'balance';
  switch (a.group) {
    case 'Pendapatan':
      return 'revenue';
    case 'Harga Pokok Penjualan':
      return 'cogs';
    case 'Beban Operasional':
      return 'opex';
    case 'Pajak Penghasilan':
      return 'tax';
    default:
      return 'other';
  }
}

export function levelFor(plan: AnalyticPlan, account: Pick<Account, 'type' | 'group'>): Applicability {
  return plan.applicability[applicabilityKey(account)];
}

/** Pecah distribusi gabungan menjadi per dimensi. */
export function splitByPlan(dist: AnalyticDistribution | undefined, data: Pick<LedgerData, 'analyticAccounts'>): Map<string, AnalyticDistribution> {
  const out = new Map<string, AnalyticDistribution>();
  for (const [id, pct] of Object.entries(dist ?? {})) {
    const aa = data.analyticAccounts.find((a) => a.id === id);
    if (!aa) continue;
    out.set(aa.planId, { ...(out.get(aa.planId) ?? {}), [id]: pct });
  }
  return out;
}

export function validateDistribution(dist: AnalyticDistribution | undefined, data: Pick<LedgerData, 'analyticAccounts' | 'analyticPlans'>): string[] {
  const issues: string[] = [];
  for (const [id, pct] of Object.entries(dist ?? {})) {
    if (!data.analyticAccounts.some((a) => a.id === id)) issues.push('Akun analitik tidak dikenal.');
    if (!(pct > 0) || pct > 100 || Math.round(pct * 100) !== pct * 100) issues.push('Persentase harus > 0, ≤ 100, maksimal 2 desimal.');
  }
  for (const [planId, d] of splitByPlan(dist, data)) {
    const sum = Math.round(Object.values(d).reduce((s, v) => s + v, 0) * 100) / 100;
    if (sum !== 100) {
      const plan = data.analyticPlans.find((p) => p.id === planId);
      issues.push(`Distribusi ${plan?.name ?? 'analitik'} berjumlah ${sum}%, harus 100%.`);
    }
  }
  return [...new Set(issues)];
}

/**
 * Bagi nominal sesuai persentase. Pembulatan per rupiah; sisa pembulatan masuk ke porsi terbesar
 * sehingga total selalu sama persis dengan nominal awal.
 */
export function allocate(amount: Money, dist: AnalyticDistribution): Record<string, Money> {
  const entries = Object.entries(dist);
  const out: Record<string, Money> = {};
  if (!entries.length) return out;
  let assigned = 0;
  for (const [id, pct] of entries) {
    out[id] = Math.round((amount * pct) / 100);
    assigned += out[id];
  }
  const biggest = entries.sort((a, b) => b[1] - a[1])[0][0];
  out[biggest] += amount - assigned;
  return out;
}

/** Akun analitik teratas (induk paling atas) — laporan meringkas ke tingkat ini. */
export function rootOf(id: string, data: Pick<LedgerData, 'analyticAccounts'>): AnalyticAccount | undefined {
  const find = (x: string) => data.analyticAccounts.find((a) => a.id === x);
  let cur = find(id);
  const seen = new Set<string>();
  while (cur?.parentId && !seen.has(cur.id)) {
    seen.add(cur.id);
    const parent = find(cur.parentId);
    if (!parent) break;
    cur = parent;
  }
  return cur;
}

export function isDescendant(id: string, ancestorId: string, data: Pick<LedgerData, 'analyticAccounts'>): boolean {
  let cur = data.analyticAccounts.find((a) => a.id === id);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    if (cur.id === ancestorId) return true;
    seen.add(cur.id);
    cur = cur.parentId ? data.analyticAccounts.find((a) => a.id === cur!.parentId) : undefined;
  }
  return false;
}

// ── Pengisian otomatis ───────────────────────────────────────────────

function partnerOfEntry(entry: JournalEntry, data: LedgerData): string | undefined {
  if (entry.source?.type === 'invoice') return data.invoices.find((i) => i.id === entry.source!.id)?.partnerId;
  if (entry.source?.type === 'payment') return data.payments.find((p) => p.id === entry.source!.id)?.partnerId;
  return undefined;
}

/**
 * Lengkapi distribusi analitik setiap baris (per dimensi, hanya bila dimensi itu belum diisi):
 *   1. akun pendapatan/HPP pilar → pilarnya (dimensi Pilar)
 *   2. model distribusi yang cocok (akun + kontak lebih spesifik daripada akun saja)
 *   3. distribusi bawaan jurnal (mis. outlet kas toko)
 * Baris akun neraca dan dimensi berstatus "tidak tersedia" dikosongkan.
 */
export function withAnalyticDefaults(entry: JournalEntry, data: LedgerData): JournalEntry {
  if (!data.analyticPlans?.length) return entry;
  const journal = data.journals.find((j) => j.id === entry.journalId);
  const partnerId = partnerOfEntry(entry, data);
  const lines = entry.lines.map((l) => {
    const account = data.accounts.find((a) => a.id === l.accountId);
    if (!account) return l;
    const byPlan = splitByPlan(l.analytic, data);
    for (const plan of data.analyticPlans) {
      if (levelFor(plan, account) === 'unavailable') {
        byPlan.delete(plan.id);
        continue;
      }
      if (byPlan.has(plan.id)) continue;
      const auto = data.analyticAccounts.find((aa) => aa.planId === plan.id && aa.active && aa.autoAccountCodes?.includes(account.code));
      if (auto) {
        byPlan.set(plan.id, { [auto.id]: 100 });
        continue;
      }
      const models = data.distributionModels.filter((m) => m.active && m.accountIds.includes(account.id) && (!m.partnerId || m.partnerId === partnerId));
      const model = models.find((m) => m.partnerId) ?? models[0];
      const fromModel = model ? splitByPlan(model.analytic, data).get(plan.id) : undefined;
      if (fromModel) {
        byPlan.set(plan.id, fromModel);
        continue;
      }
      const fromJournal = journal?.defaultAnalytic ? splitByPlan(journal.defaultAnalytic, data).get(plan.id) : undefined;
      if (fromJournal) byPlan.set(plan.id, fromJournal);
    }
    const merged: AnalyticDistribution = Object.assign({}, ...byPlan.values());
    const { analytic: _drop, ...rest } = l;
    void _drop;
    return Object.keys(merged).length ? { ...rest, analytic: merged } : rest;
  });
  return { ...entry, lines };
}

/** Dimensi wajib yang belum diisi (dipakai untuk memblokir posting). */
export function mandatoryIssues(entry: JournalEntry, data: LedgerData): string[] {
  const out: string[] = [];
  for (const l of entry.lines) {
    const account = data.accounts.find((a) => a.id === l.accountId);
    if (!account) continue;
    const byPlan = splitByPlan(l.analytic, data);
    for (const plan of data.analyticPlans ?? []) {
      if (levelFor(plan, account) === 'mandatory' && !byPlan.has(plan.id)) out.push(`Baris ${account.code} ${account.name}: dimensi ${plan.name} wajib diisi.`);
    }
    for (const m of validateDistribution(l.analytic, data)) out.push(`Baris ${account.code}: ${m}`);
  }
  return [...new Set(out)];
}

// ── Item analitik & edit massal ──────────────────────────────────────

export interface AnalyticItem {
  ref: LineRef;
  entry: JournalEntry;
  account: Account;
  date: string;
  label: string;
  /** Efek ke laba (kredit − debit): pendapatan positif, beban negatif. */
  amount: Money;
  analytic: AnalyticDistribution;
  /** Dimensi berstatus wajib/disarankan yang masih kosong. */
  missingPlans: string[];
}

export function analyticItems(data: LedgerData, range: DateRange): AnalyticItem[] {
  const out: AnalyticItem[] = [];
  for (const e of data.entries) {
    if (e.status === 'draft' || e.date < range.from || e.date > range.to || e.source?.type === 'closing') continue;
    for (const l of e.lines) {
      const account = data.accounts.find((a) => a.id === l.accountId);
      if (!account || !isPnlAccount(account)) continue;
      const byPlan = splitByPlan(l.analytic, data);
      const missingPlans = (data.analyticPlans ?? [])
        .filter((p) => ['mandatory', 'recommended'].includes(levelFor(p, account)) && !byPlan.has(p.id))
        .map((p) => p.id);
      out.push({ ref: { entryId: e.id, lineId: l.id }, entry: e, account, date: e.date, label: l.label || e.reference, amount: l.credit - l.debit, analytic: l.analytic ?? {}, missingPlans });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.account.code.localeCompare(b.account.code));
}

/** Pasang distribusi satu dimensi ke banyak baris sekaligus. Saldo akun tidak berubah. */
export function setDistribution(refs: LineRef[], planId: string, dist: AnalyticDistribution | null, data: LedgerData): JournalEntry[] {
  if (!refs.length) throw new LedgerError('INVALID_ANALYTIC', 'Pilih minimal satu baris.');
  const plan = data.analyticPlans.find((p) => p.id === planId);
  if (!plan) throw new LedgerError('INVALID_ANALYTIC', 'Dimensi tidak ditemukan.');
  if (dist) {
    if (Object.keys(dist).some((id) => data.analyticAccounts.find((a) => a.id === id)?.planId !== planId)) {
      throw new LedgerError('INVALID_ANALYTIC', `Semua akun analitik harus dari dimensi ${plan.name}.`);
    }
    const issues = validateDistribution(dist, data);
    if (issues.length) throw new LedgerError('INVALID_ANALYTIC', issues.join(' '));
  }
  const byEntry = new Map<string, Set<string>>();
  for (const r of refs) byEntry.set(r.entryId, (byEntry.get(r.entryId) ?? new Set()).add(r.lineId));
  const lock = data.company.lockDate;
  return [...byEntry].map(([entryId, lineIds]) => {
    const e = data.entries.find((x) => x.id === entryId);
    if (!e) throw new LedgerError('INVALID_ANALYTIC', 'Entri tidak ditemukan.');
    if (lock && e.date <= lock) throw new LedgerError('PERIOD_LOCKED', `Entri ${e.number} berada di periode yang sudah ditutup; distribusi analitiknya dikunci.`);
    return {
      ...e,
      lines: e.lines.map((l) => {
        if (!lineIds.has(l.id)) return l;
        const account = data.accounts.find((a) => a.id === l.accountId);
        if (account && levelFor(plan, account) === 'unavailable') throw new LedgerError('INVALID_ANALYTIC', `Dimensi ${plan.name} tidak tersedia untuk akun ${account.code}.`);
        const byPlan = splitByPlan(l.analytic, data);
        if (dist) byPlan.set(planId, dist);
        else byPlan.delete(planId);
        const merged: AnalyticDistribution = Object.assign({}, ...byPlan.values());
        const { analytic: _drop, ...rest } = l;
        void _drop;
        return Object.keys(merged).length ? { ...rest, analytic: merged } : rest;
      }),
    };
  });
}

// ── Laba Rugi per dimensi ────────────────────────────────────────────

export const UNALLOCATED = '__unallocated__';

export interface DimPnlLine {
  account: Account;
  /** Nilai tampilan per kolom (pendapatan positif, beban positif). */
  values: Record<string, Money>;
  total: Money;
}

export interface DimPnlSection {
  key: 'revenue' | 'cogs' | 'opex' | 'other' | 'tax';
  title: string;
  nature: 'income' | 'expense' | 'mixed';
  lines: DimPnlLine[];
  totals: Record<string, Money>;
}

export interface DimensionalPnl {
  columns: { id: string; name: string }[];
  sections: DimPnlSection[];
  grossProfit: Record<string, Money>;
  operatingProfit: Record<string, Money>;
  netProfit: Record<string, Money>;
  mode: 'unallocated' | 'byRevenue';
}

const SECTION_DEF: { key: DimPnlSection['key']; title: string; nature: DimPnlSection['nature'] }[] = [
  { key: 'revenue', title: 'Pendapatan', nature: 'income' },
  { key: 'cogs', title: 'Harga Pokok Penjualan', nature: 'expense' },
  { key: 'opex', title: 'Beban Operasional', nature: 'expense' },
  { key: 'other', title: 'Pendapatan & Beban Lain', nature: 'mixed' },
  { key: 'tax', title: 'Pajak Penghasilan', nature: 'expense' },
];

/**
 * Laba Rugi dengan kolom per akun analitik teratas di satu dimensi, plus kolom "Tidak teralokasi".
 * mode byRevenue: porsi beban yang tidak teralokasi dibagi ke kolom menurut porsi pendapatan.
 * Total semua kolom selalu sama dengan Laba Rugi biasa.
 */
export function dimensionalPnl(data: LedgerData, range: DateRange, planId: string, mode: 'unallocated' | 'byRevenue' = 'unallocated'): DimensionalPnl {
  const roots = data.analyticAccounts.filter((a) => a.planId === planId && !a.parentId).sort((a, b) => a.code.localeCompare(b.code));
  const colIds = [...roots.map((r) => r.id), UNALLOCATED];
  const zero = () => Object.fromEntries(colIds.map((c) => [c, 0])) as Record<string, Money>;

  // Efek laba (kredit − debit) per akun per kolom.
  const effect = new Map<string, Record<string, Money>>();
  for (const e of data.entries) {
    if (e.status === 'draft' || e.date < range.from || e.date > range.to || e.source?.type === 'closing') continue;
    for (const l of e.lines) {
      const account = data.accounts.find((a) => a.id === l.accountId);
      if (!account || !isPnlAccount(account)) continue;
      const amt = l.credit - l.debit;
      const row = effect.get(account.id) ?? zero();
      const dist = splitByPlan(l.analytic, data).get(planId);
      if (!dist) row[UNALLOCATED] += amt;
      else {
        // Ringkas ke akun teratas.
        const rolled: AnalyticDistribution = {};
        for (const [id, pct] of Object.entries(dist)) {
          const root = rootOf(id, data);
          if (root) rolled[root.id] = (rolled[root.id] ?? 0) + pct;
        }
        for (const [id, v] of Object.entries(allocate(amt, rolled))) row[id] += v;
      }
      effect.set(account.id, row);
    }
  }

  if (mode === 'byRevenue') {
    const revenueByCol = zero();
    for (const [accId, row] of effect) {
      const a = data.accounts.find((x) => x.id === accId)!;
      if (applicabilityKey(a) === 'revenue') for (const c of colIds) if (c !== UNALLOCATED) revenueByCol[c] += row[c];
    }
    const pctDist: AnalyticDistribution = {};
    const totalRev = Object.entries(revenueByCol).filter(([c]) => c !== UNALLOCATED).reduce((s, [, v]) => s + Math.max(0, v), 0);
    if (totalRev > 0) {
      for (const c of colIds) if (c !== UNALLOCATED && revenueByCol[c] > 0) pctDist[c] = (revenueByCol[c] / totalRev) * 100;
      for (const [accId, row] of effect) {
        const a = data.accounts.find((x) => x.id === accId)!;
        if (applicabilityKey(a) === 'revenue' || row[UNALLOCATED] === 0) continue;
        for (const [c, v] of Object.entries(allocate(row[UNALLOCATED], pctDist))) row[c] += v;
        row[UNALLOCATED] = 0;
      }
    }
  }

  const sections: DimPnlSection[] = SECTION_DEF.map((s) => {
    const sign = s.nature === 'expense' ? -1 : 1;
    const lines = [...effect]
      .map(([accId, row]) => ({ account: data.accounts.find((a) => a.id === accId)!, row }))
      .filter((x) => applicabilityKey(x.account) === s.key)
      .sort((a, b) => a.account.code.localeCompare(b.account.code))
      .map(({ account, row }) => {
        const values = Object.fromEntries(colIds.map((c) => [c, sign * row[c]])) as Record<string, Money>;
        return { account, values, total: Object.values(values).reduce((t, v) => t + v, 0) };
      })
      .filter((l) => l.total !== 0 || Object.values(l.values).some((v) => v !== 0));
    const totals = zero();
    for (const l of lines) for (const c of colIds) totals[c] += l.values[c];
    return { ...s, lines, totals };
  });

  const t = (k: DimPnlSection['key']) => sections.find((s) => s.key === k)!.totals;
  const combine = (f: (c: string) => Money) => Object.fromEntries(colIds.map((c) => [c, f(c)])) as Record<string, Money>;
  const grossProfit = combine((c) => t('revenue')[c] - t('cogs')[c]);
  const operatingProfit = combine((c) => grossProfit[c] - t('opex')[c]);
  const netProfit = combine((c) => operatingProfit[c] + t('other')[c] - t('tax')[c]);
  const showUnalloc = sections.some((s) => s.lines.some((l) => l.values[UNALLOCATED] !== 0));
  return {
    columns: [...roots.map((r) => ({ id: r.id, name: r.name })), ...(showUnalloc ? [{ id: UNALLOCATED, name: 'Tidak teralokasi' }] : [])],
    sections,
    grossProfit,
    operatingProfit,
    netProfit,
    mode,
  };
}

// ── Anggaran ─────────────────────────────────────────────────────────

/** Realisasi bertanda "natural": pendapatan = kredit − debit, beban = debit − kredit. Opsional per akun analitik (beserta turunannya). */
export function actualAmount(data: LedgerData, accountId: string, range: DateRange, analyticAccountId?: string): Money {
  const account = data.accounts.find((a) => a.id === accountId);
  if (!account) return 0;
  const sign = account.type === 'income' ? 1 : -1;
  const target = analyticAccountId ? data.analyticAccounts.find((a) => a.id === analyticAccountId) : undefined;
  let sum = 0;
  for (const e of data.entries) {
    if (e.status === 'draft' || e.date < range.from || e.date > range.to || e.source?.type === 'closing') continue;
    for (const l of e.lines) {
      if (l.accountId !== accountId) continue;
      const amt = l.credit - l.debit;
      if (!target) {
        sum += amt;
        continue;
      }
      const dist = splitByPlan(l.analytic, data).get(target.planId);
      if (!dist) continue;
      const parts = allocate(amt, dist);
      for (const [id, v] of Object.entries(parts)) if (isDescendant(id, target.id, data)) sum += v;
    }
  }
  return sign * sum;
}

const monthsIn = (range: DateRange, year: string): number[] => {
  const out: number[] = [];
  for (let m = 1; m <= 12; m++) {
    const ym = `${year}-${String(m).padStart(2, '0')}`;
    if (`${ym}-01` <= range.to && `${ym}-31` >= range.from) out.push(m - 1);
  }
  return out;
};

export interface BudgetRow {
  line: BudgetLine;
  account: Account;
  analytic?: AnalyticAccount;
  budget: Money;
  actual: Money;
  /** Positif = baik (pendapatan di atas target / beban di bawah anggaran). */
  variance: Money;
  /** Capaian realisasi terhadap anggaran, persen. null bila anggaran 0. */
  achievement: number | null;
  status: 'good' | 'warning' | 'bad';
}

export function budgetVsActual(data: LedgerData, budget: Budget, range: DateRange): { rows: BudgetRow[]; totals: { revenueBudget: Money; revenueActual: Money; expenseBudget: Money; expenseActual: Money } } {
  const months = monthsIn(range, budget.year);
  const rows = budget.lines
    .map((line) => {
      const account = data.accounts.find((a) => a.id === line.accountId)!;
      const b = months.reduce((s, m) => s + (line.amounts[m] ?? 0), 0);
      const actual = actualAmount(data, line.accountId, range, line.analyticAccountId);
      const income = account.type === 'income';
      const variance = income ? actual - b : b - actual;
      const achievement = b ? (actual / b) * 100 : null;
      let status: BudgetRow['status'] = 'good';
      if (achievement !== null) {
        if (income) status = achievement >= 100 ? 'good' : achievement >= 90 ? 'warning' : 'bad';
        else status = achievement <= 100 ? (achievement > 90 ? 'warning' : 'good') : 'bad';
      } else if (!income && actual > 0) status = 'bad';
      return { line, account, analytic: data.analyticAccounts.find((a) => a.id === line.analyticAccountId), budget: b, actual, variance, achievement, status };
    })
    .sort((a, b) => a.account.code.localeCompare(b.account.code));
  const sum = (pred: (r: BudgetRow) => boolean, f: (r: BudgetRow) => Money) => rows.filter(pred).reduce((s, r) => s + f(r), 0);
  return {
    rows,
    totals: {
      revenueBudget: sum((r) => r.account.type === 'income', (r) => r.budget),
      revenueActual: sum((r) => r.account.type === 'income', (r) => r.actual),
      expenseBudget: sum((r) => r.account.type === 'expense', (r) => r.budget),
      expenseActual: sum((r) => r.account.type === 'expense', (r) => r.actual),
    },
  };
}

export function validateBudget(b: Budget, data: LedgerData): string[] {
  const issues: string[] = [];
  if (!/^\d{4}$/.test(b.year)) issues.push('Tahun anggaran tidak valid.');
  const seen = new Set<string>();
  for (const l of b.lines) {
    const a = data.accounts.find((x) => x.id === l.accountId);
    if (!a || !isPnlAccount(a)) issues.push('Anggaran hanya untuk akun pendapatan & beban.');
    const k = `${l.accountId}|${l.analyticAccountId ?? ''}`;
    if (seen.has(k)) issues.push(`Akun ${a?.code} ${l.analyticAccountId ? 'dengan akun analitik yang sama ' : ''}muncul lebih dari sekali.`);
    seen.add(k);
    if (l.amounts.length !== 12 || l.amounts.some((v) => !Number.isInteger(v) || v < 0)) issues.push(`Akun ${a?.code}: nilai bulanan harus 12 bilangan bulat tidak negatif.`);
  }
  if (data.budgets.some((x) => x.id !== b.id && x.year === b.year)) issues.push(`Anggaran tahun ${b.year} sudah ada.`);
  return [...new Set(issues)];
}

/** Anggaran baru dari realisasi tahun sumber × (1 + persen), per akun per bulan. */
export function budgetFromActual(data: LedgerData, sourceYear: string, targetYear: string, pctChange: number, newId: () => string): BudgetLine[] {
  const lines: BudgetLine[] = [];
  for (const a of data.accounts.filter(isPnlAccount).sort((x, y) => x.code.localeCompare(y.code))) {
    const amounts = Array.from({ length: 12 }, (_, i) => {
      const ym = `${sourceYear}-${String(i + 1).padStart(2, '0')}`;
      const v = actualAmount(data, a.id, { from: `${ym}-01`, to: `${ym}-31` });
      return Math.max(0, Math.round(v * (1 + pctChange / 100)));
    });
    if (amounts.some((v) => v > 0)) lines.push({ id: newId(), accountId: a.id, amounts });
  }
  void targetYear;
  return lines;
}

export function describeVariance(r: BudgetRow): string {
  const over = r.account.type === 'income' ? r.variance >= 0 : r.variance < 0;
  return `${over ? 'Di atas' : 'Di bawah'} anggaran ${formatRupiah(Math.abs(r.actual - r.budget))}`;
}
