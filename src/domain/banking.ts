/**
 * REKONSILIASI BANK, TRANSFER ANTAR REKENING, KAS HARIAN — fungsi murni.
 *
 * Prinsip: mutasi bank tidak pernah mengubah entri yang sudah diposting. Status "cocok"
 * disimpan di sisi mutasi (StatementLine.reconciliation). Bila pencocokan perlu membuat
 * jurnal/pembayaran baru, semuanya tercatat sehingga bisa dibatalkan dengan rapi.
 */
import { LedgerError } from './errors';
import { assertNotLocked, isValidDate, nextEntryNumber, reverseEntry } from './rules';
import { CUSTOMER_DEPOSIT_ACCOUNT, invoiceResidual } from './invoicing';
import { cancelPayment, postPayment } from './payments';
import type {
  Account,
  CashSession,
  EntrySource,
  ISODate,
  Invoice,
  Journal,
  JournalEntry,
  LedgerData,
  LineRef,
  Money,
  Payment,
  ReconcileRule,
  StatementLine,
} from './types';
import { formatRupiah } from '../lib/format';

export const SETTLEMENT_ACCOUNT = '1112';
export const TRANSIT_ACCOUNT = '1103';
export const BANK_FEE_ACCOUNT = '6205';
export const CASH_OVER_ACCOUNT = '7102';
export const CASH_SHORT_ACCOUNT = '7202';
export const DEFAULT_FEE_TOLERANCE = 3;

interface Opts {
  now: string;
  newId: () => string;
}

const refKey = (r: LineRef) => `${r.entryId}:${r.lineId}`;

function accountByCode(data: LedgerData, code: string): Account {
  const a = data.accounts.find((x) => x.code === code);
  if (!a) throw new LedgerError('UNKNOWN_ACCOUNT', `Akun ${code} tidak ditemukan di bagan akun.`);
  return a;
}

function bankJournal(data: LedgerData, journalId: string): Journal & { defaultAccountId: string } {
  const j = data.journals.find((x) => x.id === journalId);
  if (!j || !j.defaultAccountId || (j.type !== 'bank' && j.type !== 'cash')) {
    throw new LedgerError('UNKNOWN_JOURNAL', 'Rekening kas/bank tidak ditemukan.');
  }
  return j as Journal & { defaultAccountId: string };
}

/** Entri yang saling meniadakan (dibalik & pembaliknya) tidak perlu dicocokkan dengan bank. */
const isLiveEntry = (e: JournalEntry) => e.status === 'posted' && !e.reversalOfId;

export interface BookLine {
  ref: LineRef;
  entry: JournalEntry;
  date: ISODate;
  label: string;
  /** debit − kredit di akun tersebut. */
  amount: Money;
}

/** Semua baris posted di satu akun (dari jurnal mana pun). */
export function linesOnAccount(data: LedgerData, accountId: string): BookLine[] {
  const out: BookLine[] = [];
  for (const e of data.entries) {
    if (!isLiveEntry(e)) continue;
    for (const l of e.lines) {
      if (l.accountId === accountId) {
        out.push({ ref: { entryId: e.id, lineId: l.id }, entry: e, date: e.date, label: l.label || e.reference, amount: l.debit - l.credit });
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function usedRefs(data: LedgerData, which: 'bankLineRefs' | 'clearedLineRefs'): Set<string> {
  const set = new Set<string>();
  for (const s of data.statementLines) for (const r of s.reconciliation?.[which] ?? []) set.add(refKey(r));
  return set;
}

/** Baris buku di akun bank yang belum punya pasangan mutasi (sejak tanggal mulai rekonsiliasi). */
export function unreconciledBookLines(data: LedgerData, journalId: string, upTo?: ISODate): BookLine[] {
  const j = bankJournal(data, journalId);
  const used = usedRefs(data, 'bankLineRefs');
  return linesOnAccount(data, j.defaultAccountId).filter(
    (b) => !used.has(refKey(b.ref)) && (!j.reconcileFrom || b.date >= j.reconcileFrom) && (!upTo || b.date <= upTo),
  );
}

/** Saldo terbuka di akun penampung (1112 settlement QRIS/EDC atau 1103 dana dalam perjalanan). */
export function openClearingLines(data: LedgerData, code: string): BookLine[] {
  const acc = accountByCode(data, code);
  const used = usedRefs(data, 'clearedLineRefs');
  return linesOnAccount(data, acc.id).filter((b) => b.amount > 0 && !used.has(refKey(b.ref)));
}

export function matchRule(line: Pick<StatementLine, 'description' | 'amount'>, rules: ReconcileRule[]): ReconcileRule | undefined {
  const desc = line.description.toUpperCase();
  return rules.find(
    (r) =>
      r.active &&
      r.keyword.trim() &&
      desc.includes(r.keyword.trim().toUpperCase()) &&
      (r.direction === 'any' || (r.direction === 'in') === line.amount > 0),
  );
}

// ── Saran pasangan ───────────────────────────────────────────────────

export type Suggestion =
  | { kind: 'book'; score: number; title: string; detail: string; refs: LineRef[] }
  | { kind: 'invoice'; score: number; title: string; detail: string; partnerId: string; invoiceIds: string[] }
  | { kind: 'settlement'; score: number; title: string; detail: string; refs: LineRef[]; gross: Money; fee: Money }
  | { kind: 'transit'; score: number; title: string; detail: string; refs: LineRef[] }
  | { kind: 'rule'; score: number; title: string; detail: string; accountId: string; label: string };

const GENERIC_WORDS = new Set(['TOKO', 'WARUNG', 'MAKAN', 'KAFE', 'CAFE', 'RUMAH', 'CV', 'PT', 'UD', 'TBK', 'DAN', 'THE']);

function nameScore(name: string, desc: string): number {
  const tokens = name.toUpperCase().split(/[^A-Z0-9]+/).filter((t) => t.length >= 3 && !GENERIC_WORDS.has(t));
  if (!tokens.length) return 0;
  const hit = tokens.filter((t) => desc.includes(t)).length;
  return hit / tokens.length;
}

const dayDiff = (a: ISODate, b: ISODate) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

/** Saran pasangan untuk satu mutasi, diurutkan dari skor tertinggi (maks. 6). */
export function suggestMatches(line: StatementLine, data: LedgerData): Suggestion[] {
  const out: Suggestion[] = [];
  const desc = line.description.toUpperCase();
  const incoming = line.amount > 0;
  const abs = Math.abs(line.amount);

  // 1. Baris buku yang sudah dicatat (mis. pembayaran manual) dengan jumlah persis sama.
  for (const b of unreconciledBookLines(data, line.journalId)) {
    if (b.amount !== line.amount) continue;
    const d = dayDiff(b.date, line.date);
    if (d > 14) continue;
    out.push({
      kind: 'book',
      score: 70 + (d === 0 ? 20 : d <= 3 ? 10 : d <= 7 ? 5 : 0),
      title: `Sudah dicatat: ${b.entry.number}`,
      detail: `${b.label} (${b.date})`,
      refs: [b.ref],
    });
  }

  // 2. Faktur/tagihan terbuka.
  const kind = incoming ? 'out_invoice' : 'in_invoice';
  const open = data.invoices
    .filter((i) => i.kind === kind && i.status === 'posted')
    .map((i) => ({ i, residual: invoiceResidual(i, data) }))
    .filter((x) => x.residual > 0);
  for (const { i, residual } of open) {
    const partner = data.partners.find((p) => p.id === i.partnerId);
    if (!partner) continue;
    const ns = nameScore(partner.name, desc);
    const numberHit = !!i.number && desc.includes(i.number.toUpperCase());
    const exact = residual === abs;
    if (!exact && ns === 0 && !numberHit) continue;
    const score = (exact ? 60 : 30) + (numberHit ? 30 : 0) + (ns === 1 ? 25 : ns > 0 ? 15 : 0);
    out.push({
      kind: 'invoice',
      score: Math.min(score, 99),
      title: `${incoming ? 'Pelunasan' : 'Pembayaran'} ${i.number} — ${partner.name}`,
      detail: exact ? `Sisa tagihan ${formatRupiah(residual)}, sama persis` : `Sisa tagihan ${formatRupiah(residual)}; ${abs > residual ? 'kelebihan dialokasikan ke dokumen lain/deposit' : 'dibayar sebagian'}`,
      partnerId: partner.id,
      invoiceIds: [i.id],
    });
  }

  // Bila catatan buku dengan jumlah persis sudah ada, saran faktur diturunkan agar tidak tercatat ganda.
  if (out.some((x) => x.kind === 'book' && x.score >= 85)) {
    for (const x of out) {
      if (x.kind === 'invoice') {
        x.score = Math.min(x.score, 50);
        x.detail += '. Periksa dulu: sudah ada catatan buku dengan jumlah sama';
      }
    }
  }

  const rule = matchRule(line, data.reconcileRules);

  // 3. Settlement QRIS/EDC: gabungan saldo terbuka 1112 (terlama dulu) yang selisihnya wajar sebagai MDR.
  if (incoming && rule?.action === 'settlement') {
    const tol = data.company.settlementFeeTolerance ?? DEFAULT_FEE_TOLERANCE;
    const openLines = openClearingLines(data, SETTLEMENT_ACCOUNT).filter((b) => b.date <= line.date);
    let gross = 0;
    const refs: LineRef[] = [];
    for (const b of openLines) {
      gross += b.amount;
      refs.push(b.ref);
      const fee = gross - abs;
      if (fee >= 0 && (fee / gross) * 100 <= tol) {
        out.push({
          kind: 'settlement',
          score: 85,
          title: `Pencairan ${rule.label}: ${refs.length} transaksi`,
          detail: `Nilai kotor ${formatRupiah(gross)}, dana masuk ${formatRupiah(abs)}, MDR ${formatRupiah(fee)} (${((fee / gross) * 100).toFixed(2)}%)`,
          refs: [...refs],
          gross,
          fee,
        });
        break;
      }
      if (fee > 0 && (fee / gross) * 100 > tol) break;
    }
  }

  // 4. Dana dalam perjalanan (setoran kas / transfer antar rekening).
  if (incoming) {
    for (const b of openClearingLines(data, TRANSIT_ACCOUNT)) {
      if (b.amount !== abs || b.date > line.date) continue;
      out.push({ kind: 'transit', score: 75 + (desc.includes('SETOR') ? 10 : 0), title: `Dana dalam perjalanan: ${b.entry.number}`, detail: b.label, refs: [b.ref] });
    }
  }

  // 5. Aturan langsung ke akun.
  if (rule?.action === 'account' && rule.accountId) {
    const acc = data.accounts.find((a) => a.id === rule.accountId);
    out.push({ kind: 'rule', score: 88, title: `Aturan "${rule.keyword}" → ${acc ? `${acc.code} ${acc.name}` : 'akun'}`, detail: rule.label, accountId: rule.accountId, label: rule.label });
  }

  return out.sort((a, b) => b.score - a.score).slice(0, 6);
}

// ── Aksi rekonsiliasi ────────────────────────────────────────────────

function assertOpen(line: StatementLine) {
  if (line.status !== 'open') throw new LedgerError('ALREADY_RECONCILED', 'Mutasi ini sudah dicocokkan.');
}

function makeEntry(
  data: LedgerData,
  journal: Journal,
  date: ISODate,
  reference: string,
  lines: { accountId: string; label: string; debit: Money; credit: Money }[],
  source: EntrySource,
  opts: Opts,
): JournalEntry {
  assertNotLocked(date, data);
  return {
    id: opts.newId(),
    journalId: journal.id,
    number: nextEntryNumber(journal, date, data.entries),
    date,
    reference,
    status: 'posted',
    lines: lines.filter((l) => l.debit || l.credit).map((l) => ({ id: opts.newId(), ...l })),
    createdAt: opts.now,
    postedAt: opts.now,
    source,
  };
}

const bankRefOf = (entry: JournalEntry, accountId: string): LineRef[] =>
  entry.lines.filter((l) => l.accountId === accountId).map((l) => ({ entryId: entry.id, lineId: l.id }));

function reconciled(line: StatementLine, partial: Partial<StatementLine['reconciliation']>, now: string): StatementLine {
  return {
    ...line,
    status: 'reconciled',
    reconciliation: { bankLineRefs: [], clearedLineRefs: [], createdEntryIds: [], createdPaymentIds: [], reconciledAt: now, ...partial },
  };
}

/** Cocokkan dengan baris buku yang sudah ada. Total baris harus sama dengan jumlah mutasi. */
export function reconcileWithBook(line: StatementLine, refs: LineRef[], data: LedgerData, now: string): StatementLine {
  assertOpen(line);
  if (!refs.length) throw new LedgerError('RECONCILE_MISMATCH', 'Pilih minimal satu baris buku.');
  const available = new Map(unreconciledBookLines(data, line.journalId).map((b) => [refKey(b.ref), b]));
  let sum = 0;
  for (const r of refs) {
    const b = available.get(refKey(r));
    if (!b) throw new LedgerError('ALREADY_RECONCILED', 'Salah satu baris buku sudah dicocokkan dengan mutasi lain.');
    sum += b.amount;
  }
  if (sum !== line.amount) {
    throw new LedgerError('RECONCILE_MISMATCH', `Total baris buku ${formatRupiah(sum)} tidak sama dengan mutasi ${formatRupiah(line.amount)}.`);
  }
  return reconciled(line, { bankLineRefs: refs }, now);
}

/** Cocokkan dengan faktur/tagihan: membuat pembayaran (alokasi ke dokumen terpilih dulu, lalu jatuh tempo terlama). */
export function reconcileWithInvoices(
  line: StatementLine,
  partnerId: string,
  preferredInvoiceIds: string[],
  data: LedgerData,
  opts: Opts,
): { line: StatementLine; payment: Payment; entry: JournalEntry } {
  assertOpen(line);
  const j = bankJournal(data, line.journalId);
  const direction = line.amount > 0 ? 'inbound' : 'outbound';
  const kind = direction === 'inbound' ? 'out_invoice' : 'in_invoice';
  let remaining = Math.abs(line.amount);
  const open = data.invoices
    .filter((i) => i.kind === kind && i.status === 'posted' && i.partnerId === partnerId)
    .map((i) => ({ i, residual: invoiceResidual(i, data) }))
    .filter((x) => x.residual > 0)
    .sort((a, b) => {
      const pa = preferredInvoiceIds.includes(a.i.id) ? 0 : 1;
      const pb = preferredInvoiceIds.includes(b.i.id) ? 0 : 1;
      return pa - pb || a.i.dueDate.localeCompare(b.i.dueDate);
    });
  const allocations: { invoiceId: string; amount: number }[] = [];
  for (const { i, residual } of open as { i: Invoice; residual: number }[]) {
    if (remaining <= 0) break;
    const amt = Math.min(remaining, residual);
    allocations.push({ invoiceId: i.id, amount: amt });
    remaining -= amt;
  }
  const { payment, entry } = postPayment(
    {
      id: opts.newId(),
      direction,
      partnerId,
      date: line.date,
      journalId: j.id,
      amount: Math.abs(line.amount),
      memo: line.description.slice(0, 120),
      allocations,
    },
    data,
    opts,
  );
  return {
    line: reconciled(line, { bankLineRefs: bankRefOf(entry, j.defaultAccountId), createdPaymentIds: [payment.id] }, opts.now),
    payment,
    entry,
  };
}

/** Cocokkan langsung ke akun (biaya admin, bunga, pajak bunga, dll.). */
export function reconcileWithAccount(
  line: StatementLine,
  accountId: string,
  label: string,
  data: LedgerData,
  opts: Opts,
): { line: StatementLine; entry: JournalEntry } {
  assertOpen(line);
  const j = bankJournal(data, line.journalId);
  const acc = data.accounts.find((a) => a.id === accountId && a.active);
  if (!acc) throw new LedgerError('UNKNOWN_ACCOUNT', 'Pilih akun lawan yang aktif.');
  if (acc.id === j.defaultAccountId) throw new LedgerError('RECONCILE_MISMATCH', 'Akun lawan tidak boleh akun bank itu sendiri.');
  const abs = Math.abs(line.amount);
  const inn = line.amount > 0;
  const text = label || line.description;
  const entry = makeEntry(
    data,
    j,
    line.date,
    text,
    [
      { accountId: j.defaultAccountId, label: text, debit: inn ? abs : 0, credit: inn ? 0 : abs },
      { accountId: acc.id, label: text, debit: inn ? 0 : abs, credit: inn ? abs : 0 },
    ],
    { type: 'statement', id: line.id },
    opts,
  );
  return { line: reconciled(line, { bankLineRefs: bankRefOf(entry, j.defaultAccountId), createdEntryIds: [entry.id] }, opts.now), entry };
}

/** Pencairan QRIS/EDC: Debit bank (bersih) + Debit MDR, Kredit 1112 (kotor). */
export function reconcileSettlement(line: StatementLine, refs: LineRef[], data: LedgerData, opts: Opts): { line: StatementLine; entry: JournalEntry } {
  assertOpen(line);
  if (line.amount <= 0) throw new LedgerError('RECONCILE_MISMATCH', 'Pencairan QRIS/EDC harus berupa uang masuk.');
  const j = bankJournal(data, line.journalId);
  const available = new Map(openClearingLines(data, SETTLEMENT_ACCOUNT).map((b) => [refKey(b.ref), b]));
  let gross = 0;
  for (const r of refs) {
    const b = available.get(refKey(r));
    if (!b) throw new LedgerError('ALREADY_RECONCILED', 'Salah satu transaksi QRIS/EDC sudah dicairkan.');
    gross += b.amount;
  }
  const fee = gross - line.amount;
  if (fee < 0) throw new LedgerError('RECONCILE_MISMATCH', `Dana masuk ${formatRupiah(line.amount)} lebih besar dari nilai transaksi ${formatRupiah(gross)}.`);
  const settlement = accountByCode(data, SETTLEMENT_ACCOUNT);
  const feeAcc = accountByCode(data, BANK_FEE_ACCOUNT);
  const label = `Pencairan QRIS/EDC: ${line.description}`.slice(0, 120);
  const entry = makeEntry(
    data,
    j,
    line.date,
    label,
    [
      { accountId: j.defaultAccountId, label, debit: line.amount, credit: 0 },
      { accountId: feeAcc.id, label: 'Potongan MDR', debit: fee, credit: 0 },
      { accountId: settlement.id, label, debit: 0, credit: gross },
    ],
    { type: 'statement', id: line.id },
    opts,
  );
  return {
    line: reconciled(line, { bankLineRefs: bankRefOf(entry, j.defaultAccountId), clearedLineRefs: refs, createdEntryIds: [entry.id] }, opts.now),
    entry,
  };
}

/** Dana dalam perjalanan masuk ke bank: Debit bank, Kredit 1103. */
export function reconcileTransit(line: StatementLine, refs: LineRef[], data: LedgerData, opts: Opts): { line: StatementLine; entry: JournalEntry } {
  assertOpen(line);
  const j = bankJournal(data, line.journalId);
  const available = new Map(openClearingLines(data, TRANSIT_ACCOUNT).map((b) => [refKey(b.ref), b]));
  let sum = 0;
  for (const r of refs) {
    const b = available.get(refKey(r));
    if (!b) throw new LedgerError('ALREADY_RECONCILED', 'Dana dalam perjalanan ini sudah diterima.');
    sum += b.amount;
  }
  if (sum !== line.amount) throw new LedgerError('RECONCILE_MISMATCH', `Dana dalam perjalanan ${formatRupiah(sum)} tidak sama dengan mutasi ${formatRupiah(line.amount)}.`);
  const transit = accountByCode(data, TRANSIT_ACCOUNT);
  const label = `Dana masuk: ${line.description}`.slice(0, 120);
  const entry = makeEntry(
    data,
    j,
    line.date,
    label,
    [
      { accountId: j.defaultAccountId, label, debit: sum, credit: 0 },
      { accountId: transit.id, label, debit: 0, credit: sum },
    ],
    { type: 'statement', id: line.id },
    opts,
  );
  return {
    line: reconciled(line, { bankLineRefs: bankRefOf(entry, j.defaultAccountId), clearedLineRefs: refs, createdEntryIds: [entry.id] }, opts.now),
    entry,
  };
}

/** Batalkan rekonsiliasi: entri yang dibuat dibalik, pembayaran dibatalkan, mutasi kembali terbuka. */
export function unreconcile(
  line: StatementLine,
  data: LedgerData,
  opts: Opts & { date: ISODate },
): { line: StatementLine; entries: JournalEntry[]; payments: Payment[] } {
  if (line.status !== 'reconciled' || !line.reconciliation) throw new LedgerError('NOT_RECONCILED', 'Mutasi ini belum dicocokkan.');
  let working = data;
  const entries: JournalEntry[] = [];
  const payments: Payment[] = [];
  for (const id of line.reconciliation.createdEntryIds) {
    const e = working.entries.find((x) => x.id === id);
    if (!e || e.status !== 'posted') continue;
    const { original, reversal } = reverseEntry(e, working, { date: opts.date, now: opts.now, newId: opts.newId, allowSourceDocument: true });
    const rev = { ...reversal, source: e.source };
    entries.push(original, rev);
    working = { ...working, entries: working.entries.map((x) => (x.id === original.id ? original : x)).concat(rev) };
  }
  for (const id of line.reconciliation.createdPaymentIds) {
    const p = working.payments.find((x) => x.id === id);
    if (!p || p.status !== 'posted') continue;
    const res = cancelPayment(p, working, opts);
    payments.push(res.payment);
    entries.push(res.original, res.reversal);
    working = {
      ...working,
      payments: working.payments.map((x) => (x.id === p.id ? res.payment : x)),
      entries: working.entries.map((x) => (x.id === res.original.id ? res.original : x)).concat(res.reversal),
    };
  }
  const { reconciliation: _omit, ...rest } = line;
  void _omit;
  return { line: { ...rest, status: 'open' }, entries, payments };
}

// ── Laporan rekonsiliasi ─────────────────────────────────────────────

export interface ReconciliationReport {
  asOf: ISODate;
  bookBalance: Money;
  /** Saldo bank menurut mutasi terakhir yang diimpor (≤ asOf). null bila belum ada mutasi. */
  statementBalance: Money | null;
  bookOnly: BookLine[];
  bankOnly: StatementLine[];
  /** Saldo bank hasil hitung: buku − buku belum di bank + bank belum di buku. */
  computedBankBalance: Money;
  /** Selisih yang tidak terjelaskan (seharusnya 0). */
  unexplained: Money | null;
}

/** Saldo bank menurut mutasi: pakai kolom saldo bila ada, bila tidak saldo awal impor + mutasi. */
export function statementBalanceAt(data: LedgerData, journalId: string, asOf: ISODate): Money | null {
  const lines = data.statementLines.filter((l) => l.journalId === journalId && l.date <= asOf);
  if (!lines.length) return null;
  const imports = data.statementImports.filter((i) => i.journalId === journalId && i.openingBalance !== null).sort((a, b) => (a.periodStart ?? '').localeCompare(b.periodStart ?? ''));
  const first = imports[0];
  if (first && first.openingBalance !== null) {
    const from = first.periodStart ?? '0000-00-00';
    return first.openingBalance + lines.filter((l) => l.date >= from).reduce((s, l) => s + l.amount, 0);
  }
  const last = [...lines].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt)).pop()!;
  return last.balance;
}

export function reconciliationReport(data: LedgerData, journalId: string, asOf: ISODate): ReconciliationReport {
  const j = bankJournal(data, journalId);
  const bookBalance = linesOnAccount(data, j.defaultAccountId)
    .filter((b) => b.date <= asOf)
    .reduce((s, b) => s + b.amount, 0);
  const bookOnly = unreconciledBookLines(data, journalId, asOf);
  const bankOnly = data.statementLines.filter((l) => l.journalId === journalId && l.status === 'open' && l.date <= asOf);
  const computedBankBalance = bookBalance - bookOnly.reduce((s, b) => s + b.amount, 0) + bankOnly.reduce((s, l) => s + l.amount, 0);
  const statementBalance = statementBalanceAt(data, journalId, asOf);
  return {
    asOf,
    bookBalance,
    statementBalance,
    bookOnly,
    bankOnly,
    computedBankBalance,
    unexplained: statementBalance === null ? null : statementBalance - computedBankBalance,
  };
}

// ── Transfer antar rekening ──────────────────────────────────────────

/**
 * Transfer/setoran. Tujuan bank: lewat 1103 Dana dalam Perjalanan, diselesaikan saat mutasinya
 * masuk dan dicocokkan. Tujuan kas: langsung (tidak ada mutasi bank untuk kas).
 */
export function transferFunds(
  input: { fromJournalId: string; toJournalId: string; date: ISODate; amount: Money; memo: string },
  data: LedgerData,
  opts: Opts,
): JournalEntry {
  if (input.fromJournalId === input.toJournalId) throw new LedgerError('INVALID_TRANSFER', 'Rekening asal dan tujuan harus berbeda.');
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new LedgerError('INVALID_TRANSFER', 'Jumlah transfer harus lebih dari 0.');
  if (!isValidDate(input.date)) throw new LedgerError('INVALID_DATE', 'Tanggal transfer tidak valid.');
  const from = bankJournal(data, input.fromJournalId);
  const to = bankJournal(data, input.toJournalId);
  const debitAccount = to.type === 'bank' ? accountByCode(data, TRANSIT_ACCOUNT).id : to.defaultAccountId;
  const label = input.memo || `${to.type === 'bank' && from.type === 'cash' ? 'Setoran' : 'Transfer'} ${from.name} → ${to.name}`;
  return makeEntry(
    data,
    from,
    input.date,
    label,
    [
      { accountId: debitAccount, label, debit: input.amount, credit: 0 },
      { accountId: from.defaultAccountId, label, debit: 0, credit: input.amount },
    ],
    { type: 'transfer', id: opts.newId() },
    opts,
  );
}

// ── Kas harian ───────────────────────────────────────────────────────

export const DENOMINATIONS = [100_000, 50_000, 20_000, 10_000, 5_000, 2_000, 1_000, 500, 200, 100];

export interface CashDaySummary {
  opening: Money;
  inflow: Money;
  outflow: Money;
  expected: Money;
}

export function cashDaySummary(data: LedgerData, journalId: string, date: ISODate): CashDaySummary {
  const j = bankJournal(data, journalId);
  let opening = 0;
  let inflow = 0;
  let outflow = 0;
  for (const e of data.entries) {
    if (e.status === 'draft' || e.date > date) continue;
    for (const l of e.lines) {
      if (l.accountId !== j.defaultAccountId) continue;
      const amt = l.debit - l.credit;
      if (e.date < date) opening += amt;
      else if (amt > 0) inflow += amt;
      else outflow -= amt;
    }
  }
  return { opening, inflow, outflow, expected: opening + inflow - outflow };
}

/** Tutup kas harian: hitung fisik dibanding saldo buku; selisih dijurnal ke 7102/7202. */
export function closeCashDay(
  input: { journalId: string; date: ISODate; counted: Money; denominations: Record<string, number>; notes: string },
  data: LedgerData,
  opts: Opts,
): { session: CashSession; entry: JournalEntry | null } {
  const j = bankJournal(data, input.journalId);
  if (j.type !== 'cash') throw new LedgerError('UNKNOWN_JOURNAL', 'Kas harian hanya untuk rekening kas.');
  if (!isValidDate(input.date)) throw new LedgerError('INVALID_DATE', 'Tanggal tidak valid.');
  if (data.cashSessions.some((s) => s.journalId === j.id && s.date === input.date)) {
    throw new LedgerError('CASH_SESSION_CLOSED', `Kas ${j.name} tanggal ${input.date} sudah ditutup.`);
  }
  if (!Number.isInteger(input.counted) || input.counted < 0) throw new LedgerError('INVALID_STATEMENT', 'Hasil hitung fisik tidak valid.');
  const sum = cashDaySummary(data, j.id, input.date);
  const difference = input.counted - sum.expected;
  const sessionId = opts.newId();
  let entry: JournalEntry | null = null;
  if (difference !== 0) {
    const over = difference > 0;
    const acc = accountByCode(data, over ? CASH_OVER_ACCOUNT : CASH_SHORT_ACCOUNT);
    const abs = Math.abs(difference);
    const label = `Selisih kas ${over ? 'lebih' : 'kurang'} ${j.name} ${input.date}`;
    entry = makeEntry(
      data,
      j,
      input.date,
      label,
      [
        { accountId: j.defaultAccountId, label, debit: over ? abs : 0, credit: over ? 0 : abs },
        { accountId: acc.id, label, debit: over ? 0 : abs, credit: over ? abs : 0 },
      ],
      { type: 'cash_session', id: sessionId },
      opts,
    );
  } else {
    assertNotLocked(input.date, data);
  }
  return {
    session: {
      id: sessionId,
      journalId: j.id,
      date: input.date,
      ...sum,
      counted: input.counted,
      difference,
      denominations: input.denominations,
      entryId: entry?.id,
      notes: input.notes,
      closedAt: opts.now,
    },
    entry,
  };
}

// ── Rekening baru ────────────────────────────────────────────────────

/** Kode akun berikutnya: bank 1113–1119 (1112 settlement), kas 1104–1109 (1103 dana dalam perjalanan). */
export function nextLiquidityCode(data: LedgerData, type: 'bank' | 'cash'): string | null {
  const range = type === 'bank' ? [1113, 1119] : [1104, 1109];
  for (let c = range[0]; c <= range[1]; c++) if (!data.accounts.some((a) => a.code === String(c))) return String(c);
  return null;
}

export { CUSTOMER_DEPOSIT_ACCOUNT };
