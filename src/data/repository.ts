/**
 * KONTRAK AKSES DATA.
 * Saat ini diimplementasikan oleh LocalStorageRepository (prototipe, data di browser).
 * Vendor cukup membuat ApiRepository dengan kontrak yang sama; store dan layar tidak berubah.
 *
 * commit() WAJIB atomik di backend (satu transaksi database): posting faktur menyimpan
 * dokumen + entri jurnal sekaligus, pembatalan pembayaran mengubah 3 rekaman sekaligus.
 * Penomoran juga harus dikunci di database (row lock / sequence) agar tidak dobel saat multi-user.
 */
import type { Account, CashSession, HppAdjustment, PeriodClose, PpnPeriod, RetailRecap, TaxInvoice, Company, Invoice, Journal, JournalEntry, LedgerData, Partner, Payment, ReconcileRule, StatementImport, StatementLine } from '../domain/types';

export interface ChangeSet {
  company?: Company;
  accounts?: Account[];
  partners?: Partner[];
  entries?: JournalEntry[];
  invoices?: Invoice[];
  payments?: Payment[];
  journals?: Journal[];
  statementLines?: StatementLine[];
  statementImports?: StatementImport[];
  reconcileRules?: ReconcileRule[];
  cashSessions?: CashSession[];
  hppAdjustments?: HppAdjustment[];
  periodCloses?: PeriodClose[];
  taxInvoices?: TaxInvoice[];
  retailRecaps?: RetailRecap[];
  ppnPeriods?: PpnPeriod[];
  taxes?: import('../domain/types').Tax[];
  analyticPlans?: import('../domain/types').AnalyticPlan[];
  analyticAccounts?: import('../domain/types').AnalyticAccount[];
  distributionModels?: import('../domain/types').DistributionModel[];
  budgets?: import('../domain/types').Budget[];
  assetCategories?: import('../domain/types').AssetCategory[];
  assets?: import('../domain/types').Asset[];
  deferrals?: import('../domain/types').Deferral[];
  depreciationRuns?: import('../domain/types').DepreciationRun[];
  /** Penghapusan (hanya untuk rekaman yang aturannya mengizinkan, dicek di domain/store). */
  deletes?: { statementLines?: string[]; statementImports?: string[]; reconcileRules?: string[]; distributionModels?: string[]; budgets?: string[]; assets?: string[]; deferrals?: string[] };
}

export interface LedgerRepository {
  load(): Promise<LedgerData>;
  /** Upsert semua rekaman dalam changeset secara atomik. */
  commit(changes: ChangeSet): Promise<void>;
  /** Hanya untuk draft — aturan dicek di domain sebelum dipanggil. */
  deleteEntry(id: string): Promise<void>;
  deleteInvoice(id: string): Promise<void>;
  reset(mode: 'demo' | 'empty'): Promise<LedgerData>;
}

/** Terapkan changeset ke snapshot data (dipakai store & adapter lokal). */
export function applyChanges(data: LedgerData, c: ChangeSet): LedgerData {
  const upsert = <T extends { id: string }>(list: T[], items?: T[]): T[] => {
    if (!items?.length) return list;
    const byId = new Map(list.map((x) => [x.id, x]));
    for (const it of items) byId.set(it.id, it);
    return [...byId.values()];
  };
  const drop = <T extends { id: string }>(list: T[], ids?: string[]) => (ids?.length ? list.filter((x) => !ids.includes(x.id)) : list);
  return {
    ...data,
    journals: upsert(data.journals, c.journals),
    statementLines: drop(upsert(data.statementLines, c.statementLines), c.deletes?.statementLines),
    statementImports: drop(upsert(data.statementImports, c.statementImports), c.deletes?.statementImports),
    reconcileRules: drop(upsert(data.reconcileRules, c.reconcileRules), c.deletes?.reconcileRules),
    cashSessions: upsert(data.cashSessions, c.cashSessions),
    hppAdjustments: upsert(data.hppAdjustments, c.hppAdjustments),
    periodCloses: upsert(data.periodCloses, c.periodCloses),
    taxInvoices: upsert(data.taxInvoices, c.taxInvoices),
    retailRecaps: upsert(data.retailRecaps, c.retailRecaps),
    ppnPeriods: upsert(data.ppnPeriods, c.ppnPeriods),
    taxes: upsert(data.taxes, c.taxes),
    analyticPlans: upsert(data.analyticPlans, c.analyticPlans),
    analyticAccounts: upsert(data.analyticAccounts, c.analyticAccounts),
    distributionModels: drop(upsert(data.distributionModels, c.distributionModels), c.deletes?.distributionModels),
    budgets: drop(upsert(data.budgets, c.budgets), c.deletes?.budgets),
    assetCategories: upsert(data.assetCategories, c.assetCategories),
    assets: drop(upsert(data.assets, c.assets), c.deletes?.assets),
    deferrals: drop(upsert(data.deferrals, c.deferrals), c.deletes?.deferrals),
    depreciationRuns: upsert(data.depreciationRuns, c.depreciationRuns),
    company: c.company ?? data.company,
    accounts: upsert(data.accounts, c.accounts),
    partners: upsert(data.partners, c.partners),
    entries: upsert(data.entries, c.entries),
    invoices: upsert(data.invoices, c.invoices),
    payments: upsert(data.payments, c.payments),
  };
}
