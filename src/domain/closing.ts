/**
 * PENYESUAIAN HPP (STOK OPNAME), PENUTUPAN PERIODE, TUTUP TAHUN — fungsi murni.
 */
import { LedgerError } from './errors';
import { assertNotLocked, isValidDate, nextEntryNumber, reverseEntry } from './rules';
import { trialBalance } from './reports';
import { cashDaySummary, openClearingLines, SETTLEMENT_ACCOUNT, TRANSIT_ACCOUNT } from './banking';
import { balanceSheet, isPnlAccount, monthEnd, netProfit, PILLARS, profitAndLoss } from './financials';
import { outputTaxGroups } from './tax';
import { analyticItems } from './analytics';
import { runPreview } from './assets';
import type { HppAdjustment, ISODate, JournalEntry, LedgerData, Money, PeriodClose, PeriodSnapshot } from './types';
import { formatRupiah } from '../lib/format';

interface Opts {
  now: string;
  newId: () => string;
}

export const GOODS_INVENTORY = ['1301', '1302', '1303'];
export const PACKAGING_INVENTORY = '1304';
export const PACKAGING_EXPENSE = '6204';
export const RETAINED_EARNINGS = '3201';

const acc = (data: LedgerData, code: string) => {
  const a = data.accounts.find((x) => x.code === code);
  if (!a) throw new LedgerError('UNKNOWN_ACCOUNT', `Akun ${code} tidak ditemukan.`);
  return a;
};

/** Jurnal penutup yang aktif (bukan yang sudah dibatalkan, dan bukan pembaliknya). */
export const activeClosingEntry = (data: LedgerData, year: string) =>
  data.entries.find((e) => e.source?.type === 'closing' && e.source.id === year && e.status === 'posted' && !e.reversalOfId);

const generalJournal = (data: LedgerData) => {
  const j = data.journals.find((x) => x.type === 'general');
  if (!j) throw new LedgerError('UNKNOWN_JOURNAL', 'Jurnal Umum tidak ditemukan.');
  return j;
};

/** Saldo debit − kredit per akun s.d. tanggal (tanpa draft). */
function balanceAt(data: LedgerData, accountId: string, asOf: ISODate): Money {
  let s = 0;
  for (const e of data.entries) {
    if (e.status === 'draft' || e.date > asOf) continue;
    for (const l of e.lines) if (l.accountId === accountId) s += l.debit - l.credit;
  }
  return s;
}

// ── Penyesuaian HPP ──────────────────────────────────────────────────

export interface HppWorksheetRow {
  accountId: string;
  code: string;
  name: string;
  book: Money;
  isPackaging: boolean;
}

export function hppWorksheet(data: LedgerData, periodEnd: ISODate): HppWorksheetRow[] {
  return [...GOODS_INVENTORY, PACKAGING_INVENTORY].map((code) => {
    const a = acc(data, code);
    return { accountId: a.id, code, name: a.name, book: balanceAt(data, a.id, periodEnd), isPackaging: code === PACKAGING_INVENTORY };
  });
}

/** Akun HPP per pilar yang menerima pembagian (pilar tanpa HPP — Learn, Waste — dilewati). */
export function cogsAccounts(data: LedgerData) {
  return PILLARS.filter((p) => p.cogs).map((p) => ({ pillar: p.name, revenueCode: p.revenue, account: acc(data, p.cogs!) }));
}

/**
 * Usulan pembagian HPP proporsional terhadap pendapatan per pilar bulan itu.
 * Sisa pembulatan masuk ke pilar dengan pendapatan terbesar. Bila belum ada pendapatan, semua 0.
 */
export function proportionalAllocation(data: LedgerData, periodEnd: ISODate, total: Money): Record<string, Money> {
  const from = `${periodEnd.slice(0, 7)}-01`;
  const targets = cogsAccounts(data).map((c) => {
    const rev = acc(data, c.revenueCode);
    let r = 0;
    for (const e of data.entries) {
      if (e.status === 'draft' || e.date < from || e.date > periodEnd || e.source?.type === 'closing') continue;
      for (const l of e.lines) if (l.accountId === rev.id) r += l.credit - l.debit;
    }
    return { accountId: c.account.id, revenue: Math.max(0, r) };
  });
  const sum = targets.reduce((s, t) => s + t.revenue, 0);
  const out: Record<string, Money> = {};
  if (sum === 0) {
    targets.forEach((t) => (out[t.accountId] = 0));
    return out;
  }
  let assigned = 0;
  for (const t of targets) {
    out[t.accountId] = Math.floor((total * t.revenue) / sum);
    assigned += out[t.accountId];
  }
  const biggest = [...targets].sort((a, b) => b.revenue - a.revenue)[0];
  out[biggest.accountId] += total - assigned;
  return out;
}

export interface HppInput {
  periodEnd: ISODate;
  counted: Record<string, Money>; // accountId persediaan → nilai opname
  allocation: Record<string, Money>; // accountId HPP pilar → jumlah
  notes: string;
}

export function postHppAdjustment(input: HppInput, data: LedgerData, opts: Opts): { record: HppAdjustment; entry: JournalEntry } {
  if (!isValidDate(input.periodEnd) || input.periodEnd !== monthEnd(input.periodEnd.slice(0, 7))) {
    throw new LedgerError('INVALID_PERIOD', 'Penyesuaian HPP dibuat per akhir bulan.');
  }
  if (data.hppAdjustments.some((h) => h.periodEnd === input.periodEnd && h.status === 'posted')) {
    throw new LedgerError('INVALID_HPP', `Penyesuaian HPP per ${input.periodEnd} sudah ada. Batalkan dulu bila ingin membuat ulang.`);
  }
  assertNotLocked(input.periodEnd, data);

  const rows = hppWorksheet(data, input.periodEnd);
  const lines = rows.map((r) => {
    const counted = input.counted[r.accountId];
    if (counted === undefined || !Number.isInteger(counted) || counted < 0) {
      throw new LedgerError('INVALID_HPP', `Isi nilai stok opname ${r.code} ${r.name} (0 bila habis).`);
    }
    return { accountId: r.accountId, book: r.book, counted, usage: r.book - counted };
  });
  const goodsUsage = lines.filter((l) => !rows.find((r) => r.accountId === l.accountId)!.isPackaging).reduce((s, l) => s + l.usage, 0);
  const packaging = lines.find((l) => rows.find((r) => r.accountId === l.accountId)!.isPackaging)!;

  const cogs = cogsAccounts(data).map((c) => c.account.id);
  for (const k of Object.keys(input.allocation)) if (!cogs.includes(k)) throw new LedgerError('INVALID_HPP', 'Pembagian hanya ke akun HPP pilar (5101–5104).');
  const allocTotal = cogs.reduce((s, id) => s + (input.allocation[id] ?? 0), 0);
  if (cogs.some((id) => !Number.isInteger(input.allocation[id] ?? 0))) throw new LedgerError('INVALID_HPP', 'Pembagian harus bilangan bulat Rupiah.');
  if (allocTotal !== goodsUsage) {
    throw new LedgerError('INVALID_HPP', `Total pembagian ke pilar ${formatRupiah(allocTotal)} harus sama dengan HPP barang ${formatRupiah(goodsUsage)}.`);
  }
  if (lines.every((l) => l.usage === 0)) throw new LedgerError('INVALID_HPP', 'Tidak ada selisih antara saldo buku dan stok opname; tidak perlu jurnal.');

  const proportional = proportionalAllocation(data, input.periodEnd, goodsUsage);
  const edited = cogs.some((id) => (input.allocation[id] ?? 0) !== (proportional[id] ?? 0));

  const label = `Penyesuaian HPP stok opname ${input.periodEnd.slice(0, 7)}`;
  const jl: { accountId: string; label: string; debit: Money; credit: Money }[] = [];
  const dr = (accountId: string, amount: Money, text: string) => {
    if (amount === 0) return;
    jl.push({ accountId, label: text, debit: amount > 0 ? amount : 0, credit: amount < 0 ? -amount : 0 });
  };
  for (const id of cogs) dr(id, input.allocation[id] ?? 0, 'HPP dari stok opname');
  dr(acc(data, PACKAGING_EXPENSE).id, packaging.usage, 'Pemakaian kemasan');
  for (const l of lines) dr(l.accountId, -l.usage, 'Selisih saldo buku vs stok opname');

  const journal = generalJournal(data);
  const recordId = opts.newId();
  const entry: JournalEntry = {
    id: opts.newId(),
    journalId: journal.id,
    number: nextEntryNumber(journal, input.periodEnd, data.entries),
    date: input.periodEnd,
    reference: label,
    status: 'posted',
    lines: jl.map((x) => ({ id: opts.newId(), ...x })),
    createdAt: opts.now,
    postedAt: opts.now,
    source: { type: 'hpp_adjustment', id: recordId },
  };
  return {
    record: {
      id: recordId,
      periodEnd: input.periodEnd,
      lines,
      allocation: Object.fromEntries(cogs.map((id) => [id, input.allocation[id] ?? 0])),
      proportional,
      edited,
      entryId: entry.id,
      status: 'posted',
      notes: input.notes,
      createdAt: opts.now,
    },
    entry,
  };
}

export function cancelHppAdjustment(record: HppAdjustment, data: LedgerData, opts: Opts & { date: ISODate }) {
  if (record.status !== 'posted') throw new LedgerError('INVALID_HPP', 'Penyesuaian ini sudah dibatalkan.');
  const entry = data.entries.find((e) => e.id === record.entryId);
  if (!entry) throw new LedgerError('INVALID_HPP', 'Jurnal penyesuaian tidak ditemukan.');
  const { original, reversal } = reverseEntry(entry, data, { ...opts, allowSourceDocument: true });
  return { record: { ...record, status: 'cancelled' as const, cancelEntryId: reversal.id }, original, reversal: { ...reversal, source: entry.source } };
}

// ── Checklist penutupan ──────────────────────────────────────────────

export interface ChecklistItem {
  id: string;
  label: string;
  level: 'required' | 'warning';
  ok: boolean;
  detail: string;
  link?: string;
}

export function closingChecklist(data: LedgerData, periodEnd: ISODate): ChecklistItem[] {
  const from = `${periodEnd.slice(0, 7)}-01`;
  const items: ChecklistItem[] = [];

  const draftEntries = data.entries.filter((e) => e.status === 'draft' && e.date <= periodEnd);
  const draftDocs = data.invoices.filter((i) => i.status === 'draft' && i.date <= periodEnd);
  items.push({
    id: 'drafts',
    label: 'Tidak ada draft sampai akhir periode',
    level: 'required',
    ok: !draftEntries.length && !draftDocs.length,
    detail: draftEntries.length || draftDocs.length ? `${draftEntries.length} draft entri jurnal dan ${draftDocs.length} draft faktur/tagihan. Posting atau hapus dulu.` : 'Semua dokumen sudah diposting.',
    link: draftEntries.length ? '/entri' : draftDocs.length ? '/faktur' : undefined,
  });

  const tb = trialBalance(data, { to: periodEnd });
  items.push({ id: 'balanced', label: 'Neraca saldo seimbang', level: 'required', ok: tb.balanced, detail: tb.balanced ? 'Debit sama dengan kredit.' : 'Data tidak seimbang, periksa entri.', link: '/neraca-saldo' });

  if (periodEnd.endsWith('-12-31')) {
    const year = periodEnd.slice(0, 4);
    const closing = activeClosingEntry(data, year);
    const remaining = pnlRemainingForYear(data, year);
    items.push({
      id: 'yearend',
      label: `Jurnal penutup tahun ${year}`,
      level: 'required',
      ok: !!closing && remaining === 0,
      detail: !closing
        ? 'Buat jurnal penutup tahun sebelum menutup Desember.'
        : remaining !== 0
          ? `Ada transaksi pendapatan/beban ${formatRupiah(remaining)} setelah jurnal penutup dibuat. Batalkan lalu buat ulang jurnal penutup.`
          : 'Pendapatan & beban sudah dipindahkan ke Laba Ditahan.',
    });
  }

  const openBank = data.statementLines.filter((l) => l.status === 'open' && l.date <= periodEnd);
  items.push({
    id: 'bank',
    label: 'Semua mutasi bank sudah dicocokkan',
    level: 'warning',
    ok: !openBank.length,
    detail: openBank.length ? `${openBank.length} mutasi sampai ${periodEnd} belum dicocokkan.` : 'Tidak ada mutasi tertunda. Pastikan mutasi sampai akhir bulan sudah diimpor.',
    link: '/rekonsiliasi',
  });

  const hpp = data.hppAdjustments.find((h) => h.periodEnd === periodEnd && h.status === 'posted');
  items.push({ id: 'hpp', label: 'Penyesuaian HPP dari stok opname sudah dibuat', level: 'warning', ok: !!hpp, detail: hpp ? 'Sudah dibuat.' : 'HPP bulan ini belum dibukukan; laba kotor akan terlalu besar.', link: '/tutup-buku/hpp' });

  // Hari dengan mutasi kas tetapi belum ditutup.
  const missing: string[] = [];
  for (const j of data.journals.filter((x) => x.type === 'cash' && x.defaultAccountId)) {
    const days = new Set<string>();
    for (const e of data.entries) {
      if (e.status === 'draft' || e.date < from || e.date > periodEnd) continue;
      if (e.lines.some((l) => l.accountId === j.defaultAccountId)) days.add(e.date);
    }
    for (const d of days) if (!data.cashSessions.some((s) => s.journalId === j.id && s.date === d)) missing.push(`${j.name} ${d}`);
  }
  items.push({ id: 'cash', label: 'Kas harian ditutup untuk setiap hari bertransaksi', level: 'warning', ok: !missing.length, detail: missing.length ? `Belum ditutup: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? `, dan ${missing.length - 5} lainnya` : ''}.` : 'Semua hari bertransaksi sudah ditutup.', link: '/kas-harian' });

  const stale = (code: string) => {
    try {
      return openClearingLines(data, code).filter((b) => b.date <= periodEnd && (Date.parse(periodEnd) - Date.parse(b.date)) / 86_400_000 > 7);
    } catch {
      return [];
    }
  };
  const s1112 = stale(SETTLEMENT_ACCOUNT);
  const s1103 = stale(TRANSIT_ACCOUNT);
  items.push({
    id: 'clearing',
    label: 'Tidak ada dana QRIS/EDC atau dana dalam perjalanan yang menggantung lebih dari 7 hari',
    level: 'warning',
    ok: !s1112.length && !s1103.length,
    detail: s1112.length || s1103.length ? `${s1112.length} transaksi QRIS/EDC dan ${s1103.length} dana dalam perjalanan belum cair lebih dari 7 hari.` : 'Akun penampung bersih.',
    link: '/rekonsiliasi',
  });
  const period = periodEnd.slice(0, 7);
  const groups = outputTaxGroups(data, period);
  const notIssued = groups.filter((g) => g.record?.status !== 'issued');
  items.push({
    id: 'taxinvoice',
    label: 'Semua Faktur Pajak Keluaran masa ini sudah terbit',
    level: 'warning',
    ok: !notIssued.length && !groups.some((g) => g.needsCorrection),
    detail: notIssued.length
      ? `${notIssued.length} Faktur Pajak belum terbit di Coretax.`
      : groups.some((g) => g.needsCorrection)
        ? 'Ada Faktur Pajak yang perlu retur/pembetulan karena nota kredit.'
        : 'Semua sudah terbit.',
    link: '/pajak/keluaran',
  });
  const ppnDone = data.ppnPeriods.some((p) => p.period === period && p.status !== 'cancelled');
  items.push({ id: 'ppn', label: 'PPN masa ini sudah dikompensasi', level: 'warning', ok: ppnDone, detail: ppnDone ? 'Jurnal kompensasi PPN sudah dibuat.' : 'Buat jurnal kompensasi PPN di halaman Pajak.', link: '/pajak' });
  const noAnalytic = (data.analyticPlans ?? []).length ? analyticItems(data, { from, to: periodEnd }).filter((i) => i.missingPlans.length) : [];
  items.push({
    id: 'analytic',
    label: 'Baris pendapatan & beban sudah didistribusikan ke dimensi analitik',
    level: 'warning',
    ok: !noAnalytic.length,
    detail: noAnalytic.length ? `${noAnalytic.length} baris belum punya distribusi pada dimensi yang disarankan.` : 'Semua baris sudah terdistribusi.',
    link: '/analitik/item?belum=1',
  });
  const due = (data.assets ?? []).length || (data.deferrals ?? []).length ? runPreview(data, period) : [];
  const runDone = (data.depreciationRuns ?? []).some((r) => r.status === 'posted' && r.period === period);
  items.push({
    id: 'depreciation',
    label: 'Penyusutan & amortisasi bulan ini sudah dibukukan',
    level: 'warning',
    ok: !due.length || runDone,
    detail: !due.length ? 'Tidak ada aset atau penangguhan yang jatuh di bulan ini.' : runDone ? 'Sudah dibukukan.' : `${due.length} aset/penangguhan menunggu dibukukan.`,
    link: '/aset/penyusutan',
  });
  void cashDaySummary;
  return items;
}

// ── Tutup & buka kembali periode ─────────────────────────────────────

export function periodSnapshot(data: LedgerData, periodStart: ISODate, periodEnd: ISODate): PeriodSnapshot {
  const pnl = profitAndLoss(data, { from: periodStart, to: periodEnd });
  const bs = balanceSheet(data, periodEnd);
  return { revenue: pnl.revenue, netProfit: pnl.netProfit, totalAssets: bs.totalAssets, totalLiabilities: bs.totalLiabilities, totalEquity: bs.totalEquity };
}

export function closePeriod(
  input: { periodEnd: ISODate; notes: string },
  data: LedgerData,
  opts: Opts,
): { record: PeriodClose; lockDate: ISODate } {
  const periodStart = `${input.periodEnd.slice(0, 7)}-01`;
  if (input.periodEnd !== monthEnd(input.periodEnd.slice(0, 7))) throw new LedgerError('INVALID_PERIOD', 'Periode ditutup per akhir bulan.');
  if (data.company.lockDate && input.periodEnd <= data.company.lockDate) {
    throw new LedgerError('INVALID_PERIOD', `Periode sampai ${data.company.lockDate} sudah terkunci.`);
  }
  const checks = closingChecklist(data, input.periodEnd);
  const failed = checks.filter((c) => c.level === 'required' && !c.ok);
  if (failed.length) throw new LedgerError('CHECKLIST_FAILED', `Belum bisa ditutup: ${failed.map((f) => f.label.toLowerCase()).join('; ')}.`);
  const warnings = checks.filter((c) => c.level === 'warning' && !c.ok);
  if (warnings.length && input.notes.trim().length < 10) {
    throw new LedgerError('CHECKLIST_FAILED', 'Ada peringatan yang dilewati. Tulis alasannya di catatan (minimal 10 karakter).');
  }
  return {
    record: {
      id: opts.newId(),
      periodStart,
      periodEnd: input.periodEnd,
      status: 'closed',
      closedAt: opts.now,
      notes: input.notes.trim(),
      warningsAtClose: warnings.map((w) => w.label),
      snapshot: periodSnapshot(data, periodStart, input.periodEnd),
    },
    lockDate: input.periodEnd,
  };
}

/** Buka kembali periode terakhir yang ditutup. Wajib alasan; tanggal kunci mundur ke penutupan sebelumnya. */
export function reopenPeriod(record: PeriodClose, reason: string, data: LedgerData, now: string): { record: PeriodClose; lockDate: ISODate | null } {
  if (record.status !== 'closed') throw new LedgerError('INVALID_PERIOD', 'Periode ini tidak dalam status ditutup.');
  if (data.company.lockDate !== record.periodEnd) {
    throw new LedgerError('INVALID_PERIOD', 'Hanya periode yang terakhir ditutup yang bisa dibuka kembali.');
  }
  if (reason.trim().length < 10) throw new LedgerError('INVALID_PERIOD', 'Tulis alasan membuka kembali periode (minimal 10 karakter).');
  const prev = data.periodCloses
    .filter((p) => p.status === 'closed' && p.periodEnd < record.periodEnd)
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))[0];
  return { record: { ...record, status: 'reopened', reopenedAt: now, reopenReason: reason.trim() }, lockDate: prev?.periodEnd ?? null };
}

export interface SnapshotDiff {
  field: keyof PeriodSnapshot;
  label: string;
  before: Money;
  after: Money;
}

const SNAP_LABEL: Record<keyof PeriodSnapshot, string> = {
  revenue: 'Pendapatan',
  netProfit: 'Laba bersih',
  totalAssets: 'Total aset',
  totalLiabilities: 'Total kewajiban',
  totalEquity: 'Total ekuitas',
};

/** Bandingkan ringkasan saat ditutup dengan angka sekarang. */
export function snapshotChanges(record: PeriodClose, data: LedgerData): SnapshotDiff[] {
  const now = periodSnapshot(data, record.periodStart, record.periodEnd);
  return (Object.keys(SNAP_LABEL) as (keyof PeriodSnapshot)[])
    .filter((k) => now[k] !== record.snapshot[k])
    .map((k) => ({ field: k, label: SNAP_LABEL[k], before: record.snapshot[k], after: now[k] }));
}

// ── Tutup tahun (jurnal penutup) ─────────────────────────────────────

/** Sisa saldo pendapatan & beban tahun itu, termasuk jurnal penutup. 0 = sudah tertutup bersih. */
export function pnlRemainingForYear(data: LedgerData, year: string): Money {
  let s = 0;
  for (const e of data.entries) {
    if (e.status === 'draft' || !e.date.startsWith(year)) continue;
    for (const l of e.lines) {
      const a = data.accounts.find((x) => x.id === l.accountId);
      if (a && isPnlAccount(a)) s += l.credit - l.debit;
    }
  }
  return s;
}

/** Jurnal penutup 31 Desember: nolkan semua akun pendapatan & beban tahun itu ke 3201 Laba Ditahan. */
export function buildClosingEntry(year: string, data: LedgerData, opts: Opts): JournalEntry {
  const date = `${year}-12-31`;
  if (activeClosingEntry(data, year)) {
    throw new LedgerError('INVALID_PERIOD', `Jurnal penutup tahun ${year} sudah ada.`);
  }
  assertNotLocked(date, data);
  const balances = new Map<string, Money>();
  for (const e of data.entries) {
    if (e.status === 'draft' || !e.date.startsWith(year)) continue;
    for (const l of e.lines) {
      const a = data.accounts.find((x) => x.id === l.accountId);
      if (a && isPnlAccount(a)) balances.set(a.id, (balances.get(a.id) ?? 0) + l.debit - l.credit);
    }
  }
  const lines = [...balances]
    .filter(([, v]) => v !== 0)
    .map(([accountId, v]) => ({ id: opts.newId(), accountId, label: `Penutupan ${year}`, debit: v < 0 ? -v : 0, credit: v > 0 ? v : 0 }));
  if (!lines.length) throw new LedgerError('INVALID_PERIOD', `Tidak ada saldo pendapatan/beban di tahun ${year}.`);
  const profit = netProfit(data, { from: `${year}-01-01`, to: date });
  lines.push({
    id: opts.newId(),
    accountId: acc(data, RETAINED_EARNINGS).id,
    label: `Laba (rugi) tahun ${year} ke Laba Ditahan`,
    debit: profit < 0 ? -profit : 0,
    credit: profit > 0 ? profit : 0,
  });
  const journal = generalJournal(data);
  return {
    id: opts.newId(),
    journalId: journal.id,
    number: nextEntryNumber(journal, date, data.entries),
    date,
    reference: `Jurnal penutup tahun buku ${year}`,
    status: 'posted',
    lines,
    createdAt: opts.now,
    postedAt: opts.now,
    source: { type: 'closing', id: year },
  };
}

export function cancelClosingEntry(year: string, data: LedgerData, opts: Opts & { date: ISODate }) {
  const entry = activeClosingEntry(data, year);
  if (!entry) throw new LedgerError('INVALID_PERIOD', `Tidak ada jurnal penutup tahun ${year}.`);
  const { original, reversal } = reverseEntry(entry, data, { ...opts, date: entry.date, allowSourceDocument: true });
  // Pembalik bertanggal sama (31 Des) dan ikut ditandai sebagai bagian penutupan agar dikecualikan dari Laba Rugi.
  return { original, reversal: { ...reversal, source: entry.source } };
}
