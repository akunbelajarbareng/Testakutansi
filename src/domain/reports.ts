/** Perhitungan laporan dari entri jurnal — fungsi murni. */
import { affectsBalance, toNormalBalance } from './accounting';
import type { Account, ISODate, LedgerData, Money } from './types';

export interface Period {
  from?: ISODate;
  to?: ISODate;
}

export interface DebitCredit {
  debit: Money;
  credit: Money;
}

const before = (date: ISODate, from?: ISODate) => (from ? date < from : false);
const within = (date: ISODate, p: Period) => (!p.from || date >= p.from) && (!p.to || date <= p.to);

/** Saldo bersih (debit - kredit) per akun sampai tanggal tertentu (inklusif). */
export function accountNetBalances(data: LedgerData, upTo?: ISODate): Map<string, Money> {
  const map = new Map<string, Money>();
  for (const e of data.entries) {
    if (!affectsBalance(e) || (upTo && e.date > upTo)) continue;
    for (const l of e.lines) {
      map.set(l.accountId, (map.get(l.accountId) ?? 0) + l.debit - l.credit);
    }
  }
  return map;
}

export interface LedgerRow {
  entryId: string;
  date: ISODate;
  number: string;
  reference: string;
  label: string;
  debit: Money;
  credit: Money;
  /** Saldo berjalan menurut sisi normal akun. */
  balance: Money;
}

export interface GeneralLedgerResult {
  account: Account;
  opening: Money;
  rows: LedgerRow[];
  totalDebit: Money;
  totalCredit: Money;
  closing: Money;
}

export function generalLedger(accountId: string, data: LedgerData, period: Period): GeneralLedgerResult | null {
  const account = data.accounts.find((a) => a.id === accountId);
  if (!account) return null;

  let openingNet = 0;
  const raw: Omit<LedgerRow, 'balance'>[] = [];
  for (const e of data.entries) {
    if (!affectsBalance(e)) continue;
    if (period.to && e.date > period.to) continue;
    for (const l of e.lines) {
      if (l.accountId !== accountId) continue;
      if (before(e.date, period.from)) {
        openingNet += l.debit - l.credit;
      } else if (within(e.date, period)) {
        raw.push({
          entryId: e.id,
          date: e.date,
          number: e.number ?? '',
          reference: e.reference,
          label: l.label,
          debit: l.debit,
          credit: l.credit,
        });
      }
    }
  }
  raw.sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));

  const opening = toNormalBalance(account, openingNet);
  let running = opening;
  let totalDebit = 0;
  let totalCredit = 0;
  const rows = raw.map((r) => {
    running += toNormalBalance(account, r.debit - r.credit);
    totalDebit += r.debit;
    totalCredit += r.credit;
    return { ...r, balance: running };
  });
  return { account, opening, rows, totalDebit, totalCredit, closing: running };
}

export interface TrialBalanceRow {
  account: Account;
  opening: DebitCredit;
  movement: DebitCredit;
  closing: DebitCredit;
}

export interface TrialBalanceResult {
  rows: TrialBalanceRow[];
  totals: { opening: DebitCredit; movement: DebitCredit; closing: DebitCredit };
  balanced: boolean;
}

const split = (net: Money): DebitCredit => (net >= 0 ? { debit: net, credit: 0 } : { debit: 0, credit: -net });

/** Neraca saldo: saldo awal, mutasi periode, saldo akhir — masing-masing kolom debit & kredit. */
export function trialBalance(data: LedgerData, period: Period, includeZero = false): TrialBalanceResult {
  const opening = new Map<string, Money>();
  const mvDebit = new Map<string, Money>();
  const mvCredit = new Map<string, Money>();

  for (const e of data.entries) {
    if (!affectsBalance(e)) continue;
    if (period.to && e.date > period.to) continue;
    for (const l of e.lines) {
      if (before(e.date, period.from)) {
        opening.set(l.accountId, (opening.get(l.accountId) ?? 0) + l.debit - l.credit);
      } else {
        mvDebit.set(l.accountId, (mvDebit.get(l.accountId) ?? 0) + l.debit);
        mvCredit.set(l.accountId, (mvCredit.get(l.accountId) ?? 0) + l.credit);
      }
    }
  }

  const zero = (): DebitCredit => ({ debit: 0, credit: 0 });
  const totals = { opening: zero(), movement: zero(), closing: zero() };
  const rows: TrialBalanceRow[] = [];

  for (const account of [...data.accounts].sort((a, b) => a.code.localeCompare(b.code))) {
    const o = opening.get(account.id) ?? 0;
    const md = mvDebit.get(account.id) ?? 0;
    const mc = mvCredit.get(account.id) ?? 0;
    if (!includeZero && o === 0 && md === 0 && mc === 0) continue;
    const row: TrialBalanceRow = {
      account,
      opening: split(o),
      movement: { debit: md, credit: mc },
      closing: split(o + md - mc),
    };
    rows.push(row);
    for (const k of ['opening', 'movement', 'closing'] as const) {
      totals[k].debit += row[k].debit;
      totals[k].credit += row[k].credit;
    }
  }

  const balanced = (['opening', 'movement', 'closing'] as const).every((k) => totals[k].debit === totals[k].credit);
  return { rows, totals, balanced };
}

export interface JournalSummary {
  journalId: string;
  draftCount: number;
  postedCount: number;
  postedTotal: Money;
}

/** Ringkasan per jurnal untuk bulan tertentu ('YYYY-MM'). Draft dihitung semua periode. */
export function journalSummaries(data: LedgerData, month: string): JournalSummary[] {
  return data.journals.map((j) => {
    const entries = data.entries.filter((e) => e.journalId === j.id);
    const posted = entries.filter((e) => affectsBalance(e) && e.date.startsWith(month));
    return {
      journalId: j.id,
      draftCount: entries.filter((e) => e.status === 'draft').length,
      postedCount: posted.length,
      postedTotal: posted.reduce((s, e) => s + e.lines.reduce((t, l) => t + l.debit, 0), 0),
    };
  });
}
