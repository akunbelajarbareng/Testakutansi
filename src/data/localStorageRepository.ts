import type { LedgerData } from '../domain/types';
import { applyChanges, type ChangeSet, type LedgerRepository } from './repository';
import { createDemoData, createEmptyData } from './seed';
import { seedJournals } from './seed/journals';
import { seedPartners } from './seed/partners';
import { seedTaxes } from './seed/taxes';
import { seedRules } from './seed/rules';
import { seedAccounts } from './seed/coa';
import { seedAnalyticAccounts, seedDistributionModels, seedPlans } from './seed/analytics';
import { seedAssetCategories } from './seed/assets';

const KEY = 'oriental-ledger:v1';
const SCHEMA_VERSION = 7;

interface Stored {
  schemaVersion: number;
  data: LedgerData;
}

/** Migrasi data lama di browser ke skema terbaru tanpa menghapus entri pengguna. */
function migrate(stored: Stored): LedgerData {
  let data = stored.data;
  if (stored.schemaVersion < 2) {
    const journals = seedJournals();
    data = {
      ...data,
      company: { ...createEmptyData().company, ...data.company },
      journals: data.journals.map((j) => ({ ...j, defaultAccountId: j.defaultAccountId ?? journals.find((s) => s.code === j.code)?.defaultAccountId })),
      partners: seedPartners(),
      taxes: seedTaxes(),
      invoices: [],
      payments: [],
    };
  }
  if (stored.schemaVersion < 3) {
    const journals = seedJournals();
    const accounts = seedAccounts();
    const missingAccounts = accounts.filter((a) => ['1103', '7102', '7202'].includes(a.code) && !data.accounts.some((x) => x.code === a.code));
    const missingJournals = journals.filter((j) => !data.journals.some((x) => x.code === j.code));
    data = {
      ...data,
      company: { settlementFeeTolerance: 3, ...data.company },
      accounts: [...data.accounts, ...missingAccounts],
      journals: [
        ...data.journals.map((j) => {
          const seed = journals.find((s) => s.code === j.code);
          return j.code === 'BNK' && seed ? { ...seed, ...j, name: j.name === 'Bank' ? seed.name : j.name } : j;
        }),
        ...missingJournals,
      ],
      statementLines: [],
      statementImports: [],
      reconcileRules: seedRules(),
      cashSessions: [],
    };
  }
  if (stored.schemaVersion < 4) {
    data = { ...data, hppAdjustments: [], periodCloses: [] };
  }
  if (stored.schemaVersion < 5) {
    const seedAcc = seedAccounts();
    const missing = seedAcc.filter((a) => ['1404', '2204'].includes(a.code) && !data.accounts.some((x) => x.code === a.code));
    const seedTax = seedTaxes();
    data = {
      ...data,
      company: { retailTrader: true, ...data.company },
      accounts: [...data.accounts, ...missing],
      taxes: data.taxes.map((t) => ({ ...seedTax.find((s) => s.id === t.id), ...t, coretaxCode: t.coretaxCode ?? seedTax.find((s) => s.id === t.id)?.coretaxCode })),
      taxInvoices: [],
      retailRecaps: [],
      ppnPeriods: [],
    };
  }
  if (stored.schemaVersion < 6) {
    const seedJ = seedJournals();
    data = {
      ...data,
      journals: data.journals.map((j) => ({ ...j, defaultAnalytic: j.defaultAnalytic ?? seedJ.find((s) => s.code === j.code)?.defaultAnalytic })),
      analyticPlans: seedPlans(),
      analyticAccounts: seedAnalyticAccounts(),
      distributionModels: seedDistributionModels(),
      budgets: [],
    };
  }
  if (stored.schemaVersion < 7) {
    const seedAcc = seedAccounts();
    const missing = seedAcc.filter((a) => ['1505', '1506', '1507', '1508', '2303', '7103', '7203'].includes(a.code) && !data.accounts.some((x) => x.code === a.code));
    const seedTax = seedTaxes().filter((t) => !data.taxes.some((x) => x.id === t.id));
    data = { ...data, accounts: [...data.accounts, ...missing], taxes: [...data.taxes, ...seedTax], assetCategories: seedAssetCategories(), assets: [], deferrals: [], depreciationRuns: [] };
  }
  return data;
}

/** Prototipe: seluruh data disimpan sebagai satu snapshot di localStorage. Fallback ke memori bila storage tidak tersedia. */
export class LocalStorageRepository implements LedgerRepository {
  private memory: LedgerData | null = null;

  private read(): LedgerData | null {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return this.memory;
      const parsed = JSON.parse(raw) as Stored;
      if (parsed.schemaVersion > SCHEMA_VERSION) return null;
      return migrate(parsed);
    } catch {
      return this.memory;
    }
  }

  private write(data: LedgerData): void {
    this.memory = data;
    try {
      localStorage.setItem(KEY, JSON.stringify({ schemaVersion: SCHEMA_VERSION, data } satisfies Stored));
    } catch {
      // storage penuh/tidak tersedia — data tetap ada di memori selama sesi.
    }
  }

  private current(): LedgerData {
    const data = this.read();
    if (!data) throw new Error('Data belum dimuat.');
    return data;
  }

  async load(): Promise<LedgerData> {
    const existing = this.read();
    if (existing) {
      this.write(existing);
      return existing;
    }
    const demo = createDemoData();
    this.write(demo);
    return demo;
  }

  async commit(changes: ChangeSet): Promise<void> {
    this.write(applyChanges(this.current(), changes));
  }

  async deleteEntry(id: string): Promise<void> {
    const data = this.current();
    this.write({ ...data, entries: data.entries.filter((e) => e.id !== id) });
  }

  async deleteInvoice(id: string): Promise<void> {
    const data = this.current();
    this.write({ ...data, invoices: data.invoices.filter((i) => i.id !== id) });
  }

  async reset(mode: 'demo' | 'empty'): Promise<LedgerData> {
    const data = mode === 'demo' ? createDemoData() : createEmptyData();
    this.write(data);
    return data;
  }
}
