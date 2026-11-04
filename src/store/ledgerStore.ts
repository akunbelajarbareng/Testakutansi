/**
 * Store aplikasi (Zustand). Alur setiap aksi:
 *   1. hitung perubahan dengan fungsi domain — melempar LedgerError bila melanggar aturan
 *   2. simpan lewat repository.commit() (atomik)
 *   3. perbarui state dengan changeset yang sama
 * Layar tidak pernah menulis data langsung; semuanya lewat aksi di sini.
 */
import { create } from 'zustand';
import {
  LedgerError,
  assertEditable,
  cancelPayment as cancelPaymentRule,
  cleanLines,
  createRefundDraft,
  postEntry as postEntryRule,
  postInvoice as postInvoiceRule,
  postPayment as postPaymentRule,
  reverseEntry as reverseEntryRule,
  validateAccount,
  closeCashDay,
  buildClosingEntry,
  cancelClosingEntry as cancelClosingRule,
  cancelHppAdjustment,
  closePeriod as closePeriodRule,
  postHppAdjustment,
  reopenPeriod as reopenPeriodRule,
  type HppInput,
  cancelPpnSettlement,
  cancelRetailRecap,
  markExported,
  payPpn as payPpnRule,
  postRetailRecap,
  recordTaxNumber as recordTaxNumberRule,
  settlePpnPeriod,
  validateCreditPeriod,
  type Tax,
  type TaxInvoiceGroup,
  mandatoryIssues,
  setDistribution as setDistributionRule,
  validateBudget,
  validateDistribution,
  withAnalyticDefaults,
  type AnalyticAccount,
  type AnalyticDistribution,
  type AnalyticPlan,
  type Budget,
  type DistributionModel,
  addImprovement as addImprovementRule,
  cancelDepreciationRun,
  disposeAsset as disposeAssetRule,
  hasPostedDepreciation,
  lockedFieldChanges,
  postDepreciationRun,
  validateAsset,
  validateDeferral,
  type Asset,
  type AssetImprovement,
  type Deferral,
  nextLiquidityCode,
  planImport,
  reconcileSettlement as reconcileSettlementRule,
  reconcileTransit as reconcileTransitRule,
  reconcileWithAccount,
  reconcileWithBook,
  reconcileWithInvoices,
  toStatementLines,
  transferFunds,
  unreconcile as unreconcileRule,
  type CashSession,
  type LineRef,
  type ParsedStatement,
  type ReconcileRule,
  type StatementFormat,
  type StatementLine,
  type Account,
  type Company,
  type ISODate,
  type Invoice,
  type JournalEntry,
  type JournalLine,
  type LedgerData,
  type Partner,
  type Payment,
  type PaymentDraft,
} from '../domain';
import { applyChanges, type ChangeSet, type LedgerRepository } from '../data/repository';
import { LocalStorageRepository } from '../data/localStorageRepository';
import { newId } from '../lib/id';

export interface DraftInput {
  id?: string;
  journalId: string;
  date: ISODate;
  reference: string;
  lines: JournalLine[];
}

export type InvoiceDraftInput = Omit<Invoice, 'id' | 'number' | 'status' | 'createdAt'> & { id?: string };

interface LedgerState {
  data: LedgerData | null;
  loading: boolean;
  loadError: string | null;
  init: () => Promise<void>;
  // Core Ledger
  saveDraft: (input: DraftInput) => Promise<JournalEntry>;
  postEntry: (id: string) => Promise<JournalEntry>;
  reverseEntry: (id: string, date: ISODate) => Promise<JournalEntry>;
  deleteDraft: (id: string) => Promise<void>;
  saveAccount: (account: Account) => Promise<void>;
  setLockDate: (date: ISODate | null) => Promise<void>;
  saveCompany: (company: Company) => Promise<void>;
  reset: (mode: 'demo' | 'empty') => Promise<void>;
  // AR/AP
  savePartner: (partner: Partner) => Promise<void>;
  saveInvoiceDraft: (input: InvoiceDraftInput) => Promise<Invoice>;
  postInvoice: (id: string) => Promise<Invoice>;
  deleteInvoiceDraft: (id: string) => Promise<void>;
  createRefund: (invoiceId: string, date: ISODate) => Promise<Invoice>;
  registerPayment: (draft: Omit<PaymentDraft, 'id'>) => Promise<Payment>;
  cancelPayment: (id: string, date: ISODate) => Promise<Payment>;
  // Bank & kas
  createBankAccount: (input: NewBankAccountInput) => Promise<void>;
  importStatement: (journalId: string, fileName: string, format: StatementFormat, parsed: ParsedStatement) => Promise<{ imported: number; duplicates: number }>;
  addStatementLine: (input: { journalId: string; date: ISODate; description: string; amount: number }) => Promise<void>;
  deleteImport: (importId: string) => Promise<void>;
  reconcileBook: (lineId: string, refs: LineRef[]) => Promise<void>;
  reconcileInvoices: (lineId: string, partnerId: string, invoiceIds: string[]) => Promise<void>;
  reconcileAccount: (lineId: string, accountId: string, label: string) => Promise<void>;
  reconcileSettlement: (lineId: string, refs: LineRef[]) => Promise<void>;
  reconcileTransit: (lineId: string, refs: LineRef[]) => Promise<void>;
  unreconcile: (lineId: string, date: ISODate) => Promise<void>;
  transfer: (input: { fromJournalId: string; toJournalId: string; date: ISODate; amount: number; memo: string }) => Promise<JournalEntry>;
  closeCash: (input: { journalId: string; date: ISODate; counted: number; denominations: Record<string, number>; notes: string }) => Promise<CashSession>;
  saveRule: (rule: ReconcileRule) => Promise<void>;
  deleteRule: (id: string) => Promise<void>;
  // Laporan & tutup buku
  postHpp: (input: HppInput) => Promise<void>;
  cancelHpp: (id: string, date: ISODate) => Promise<void>;
  closePeriod: (periodEnd: ISODate, notes: string) => Promise<void>;
  reopenPeriod: (id: string, reason: string) => Promise<void>;
  createClosingEntry: (year: string) => Promise<JournalEntry>;
  cancelClosingEntry: (year: string) => Promise<void>;
  // Pajak
  markTaxExported: (groups: TaxInvoiceGroup[]) => Promise<void>;
  recordTaxNumber: (recordId: string, taxNumber: string, issuedDate: ISODate) => Promise<void>;
  cancelTaxInvoice: (recordId: string) => Promise<void>;
  postRetail: (input: { date: ISODate; cashJournalId: string; cash: number; nonCash: number; exemptGross: number; notes: string }) => Promise<void>;
  cancelRetail: (id: string) => Promise<void>;
  updateBillTax: (invoiceId: string, patch: { supplierTaxInvoiceNumber?: string; supplierTaxInvoiceDate?: ISODate; creditPeriod?: string }) => Promise<void>;
  settlePpn: (period: string) => Promise<void>;
  cancelPpn: (id: string) => Promise<void>;
  payPpn: (id: string, input: { journalId: string; date: ISODate; ntpn: string }) => Promise<void>;
  saveTax: (tax: Tax) => Promise<void>;
  // Analitik & anggaran
  savePlan: (plan: AnalyticPlan) => Promise<void>;
  saveAnalyticAccount: (a: AnalyticAccount) => Promise<void>;
  saveModel: (m: DistributionModel) => Promise<void>;
  deleteModel: (id: string) => Promise<void>;
  setJournalAnalytic: (journalId: string, dist: AnalyticDistribution | undefined) => Promise<void>;
  setDistribution: (refs: LineRef[], planId: string, dist: AnalyticDistribution | null) => Promise<number>;
  saveBudget: (b: Budget) => Promise<void>;
  deleteBudget: (id: string) => Promise<void>;
  // Aset & penangguhan
  saveAsset: (asset: Asset) => Promise<void>;
  deleteAsset: (id: string) => Promise<void>;
  addImprovement: (id: string, imp: Omit<AssetImprovement, 'id'>) => Promise<void>;
  disposeAsset: (id: string, input: { date: ISODate; type: 'sale' | 'writeoff'; proceeds: number; journalId?: string; note: string }) => Promise<void>;
  saveDeferral: (d: Deferral) => Promise<void>;
  runDepreciation: (period: string) => Promise<void>;
  cancelRun: (id: string) => Promise<void>;
}

export interface NewBankAccountInput {
  type: 'bank' | 'cash';
  name: string;
  code: string;
  bankName: string;
  accountNumber: string;
}

// Ganti baris ini dengan `new ApiRepository(...)` saat backend siap.
const repo: LedgerRepository = new LocalStorageRepository();

export const useLedger = create<LedgerState>((set, get) => {
  const requireData = (): LedgerData => {
    const data = get().data;
    if (!data) throw new Error('Data belum dimuat.');
    return data;
  };
  const findEntry = (id: string): JournalEntry => {
    const entry = requireData().entries.find((e) => e.id === id);
    if (!entry) throw new Error('Entri tidak ditemukan.');
    return entry;
  };
  const findInvoice = (id: string): Invoice => {
    const inv = requireData().invoices.find((i) => i.id === id);
    if (!inv) throw new Error('Dokumen tidak ditemukan.');
    return inv;
  };
  const findLine = (id: string): StatementLine => {
    const l = requireData().statementLines.find((x) => x.id === id);
    if (!l) throw new Error('Mutasi tidak ditemukan.');
    return l;
  };
  const commit = async (changes: ChangeSet) => {
    // Entri yang baru diposting (dari modul mana pun) dilengkapi distribusi analitiknya di sini,
    // lalu dicek dimensi wajibnya — satu titik, agar semua modul konsisten.
    if (changes.entries?.length) {
      const current = requireData();
      const ctx = applyChanges(current, { ...changes, entries: [] });
      changes = {
        ...changes,
        entries: changes.entries.map((e) => {
          const before = current.entries.find((x) => x.id === e.id);
          const newlyPosted = e.status !== 'draft' && (!before || before.status === 'draft');
          if (!newlyPosted) return e;
          const filled = withAnalyticDefaults(e, { ...ctx, entries: current.entries });
          const issues = mandatoryIssues(filled, ctx);
          if (issues.length) throw new LedgerError('INVALID_ANALYTIC', issues.join(' '));
          return filled;
        }),
      };
    }
    await repo.commit(changes);
    set({ data: applyChanges(requireData(), changes) });
  };
  const now = () => new Date().toISOString();

  return {
    data: null,
    loading: false,
    loadError: null,

    async init() {
      if (get().data || get().loading) return;
      set({ loading: true });
      try {
        set({ data: await repo.load(), loading: false });
      } catch (e) {
        set({ loading: false, loadError: e instanceof Error ? e.message : 'Gagal memuat data.' });
      }
    },

    // ── Core Ledger ──
    async saveDraft(input) {
      let entry: JournalEntry;
      if (input.id) {
        const existing = findEntry(input.id);
        assertEditable(existing);
        entry = { ...existing, journalId: input.journalId, date: input.date, reference: input.reference, lines: cleanLines(input.lines) };
      } else {
        entry = {
          id: newId(),
          journalId: input.journalId,
          number: null,
          date: input.date,
          reference: input.reference,
          status: 'draft',
          lines: cleanLines(input.lines),
          createdAt: now(),
        };
      }
      await commit({ entries: [entry] });
      return entry;
    },

    async postEntry(id) {
      const posted = postEntryRule(findEntry(id), requireData(), now());
      await commit({ entries: [posted] });
      return posted;
    },

    async reverseEntry(id, date) {
      const { original, reversal } = reverseEntryRule(findEntry(id), requireData(), { date, now: now(), newId });
      await commit({ entries: [original, reversal] });
      return reversal;
    },

    async deleteDraft(id) {
      assertEditable(findEntry(id));
      await repo.deleteEntry(id);
      const data = requireData();
      set({ data: { ...data, entries: data.entries.filter((e) => e.id !== id) } });
    },

    async saveAccount(account) {
      const issues = validateAccount(account, requireData().accounts);
      if (issues.length) throw new LedgerError(issues[0].code, issues.map((i) => i.message).join(' '));
      await commit({ accounts: [account] });
    },

    async setLockDate(date) {
      await commit({ company: { ...requireData().company, lockDate: date } });
    },

    async saveCompany(company) {
      await commit({ company });
    },

    async reset(mode) {
      set({ data: await repo.reset(mode) });
    },

    // ── AR/AP ──
    async savePartner(partner) {
      if (partner.name.trim().length < 2) throw new LedgerError('UNKNOWN_PARTNER', 'Nama kontak minimal 2 karakter.');
      await commit({ partners: [partner] });
    },

    async saveInvoiceDraft(input) {
      let invoice: Invoice;
      if (input.id) {
        const existing = findInvoice(input.id);
        if (existing.status !== 'draft') throw new LedgerError('NOT_DRAFT', 'Dokumen yang sudah diposting tidak bisa diubah.');
        invoice = { ...existing, ...input, id: existing.id };
      } else {
        invoice = { ...input, id: newId(), number: null, status: 'draft', createdAt: now() };
      }
      await commit({ invoices: [invoice] });
      return invoice;
    },

    async postInvoice(id) {
      const { invoice, entry } = postInvoiceRule(findInvoice(id), requireData(), { now: now(), newId });
      await commit({ invoices: [invoice], entries: [entry] });
      return invoice;
    },

    async deleteInvoiceDraft(id) {
      if (findInvoice(id).status !== 'draft') throw new LedgerError('NOT_DRAFT', 'Hanya draft yang bisa dihapus.');
      await repo.deleteInvoice(id);
      const data = requireData();
      set({ data: { ...data, invoices: data.invoices.filter((i) => i.id !== id) } });
    },

    async createRefund(invoiceId, date) {
      const refund = createRefundDraft(findInvoice(invoiceId), requireData(), { date, now: now(), newId });
      await commit({ invoices: [refund] });
      return refund;
    },

    async registerPayment(draft) {
      const { payment, entry } = postPaymentRule({ ...draft, id: newId() }, requireData(), { now: now(), newId });
      await commit({ payments: [payment], entries: [entry] });
      return payment;
    },

    async cancelPayment(id, date) {
      const p = requireData().payments.find((x) => x.id === id);
      if (!p) throw new Error('Pembayaran tidak ditemukan.');
      const res = cancelPaymentRule(p, requireData(), { date, now: now(), newId });
      await commit({ payments: [res.payment], entries: [res.original, res.reversal] });
      return res.payment;
    },

    // ── Bank & kas ──
    async createBankAccount(input) {
      const data = requireData();
      const code = input.code.trim().toUpperCase();
      if (!/^[A-Z0-9]{2,6}$/.test(code)) throw new LedgerError('UNKNOWN_JOURNAL', 'Kode jurnal 2–6 huruf/angka, mis. BNK2.');
      if (data.journals.some((j) => j.code === code)) throw new LedgerError('DUPLICATE_CODE', `Kode jurnal ${code} sudah dipakai.`);
      if (input.name.trim().length < 3) throw new LedgerError('UNKNOWN_JOURNAL', 'Nama rekening minimal 3 karakter.');
      const accCode = nextLiquidityCode(data, input.type);
      if (!accCode) throw new LedgerError('INVALID_ACCOUNT', 'Slot kode akun kas/bank sudah penuh. Tambahkan akun manual di Bagan Akun.');
      const account: Account = { id: newId(), code: accCode, name: input.name.trim(), type: 'asset', group: 'Aset Lancar', contra: false, liquidity: true, active: true };
      await commit({
        accounts: [account],
        journals: [
          {
            id: newId(),
            code,
            name: input.name.trim(),
            type: input.type,
            defaultAccountId: account.id,
            ...(input.type === 'bank' ? { bankName: input.bankName.trim(), accountNumber: input.accountNumber.trim(), statementFormat: input.bankName.trim().toUpperCase() === 'BCA' ? 'bca' : 'generic' } : {}),
          },
        ],
      });
    },

    async importStatement(journalId, fileName, format, parsed) {
      const data = requireData();
      if (parsed.errors.length && !parsed.lines.length) throw new LedgerError('INVALID_STATEMENT', parsed.errors.join(' '));
      const plan = planImport(parsed, journalId, data);
      const importId = newId();
      const lines = toStatementLines(plan.newLines, journalId, importId, now(), newId);
      const journal = data.journals.find((j) => j.id === journalId)!;
      const start = parsed.periodStart ?? parsed.lines.map((l) => l.date).sort()[0];
      await commit({
        statementLines: lines,
        statementImports: [
          {
            id: importId,
            journalId,
            fileName,
            format,
            periodStart: parsed.periodStart,
            periodEnd: parsed.periodEnd,
            openingBalance: parsed.openingBalance,
            closingBalance: parsed.closingBalance,
            importedCount: lines.length,
            duplicateCount: plan.duplicateCount,
            importedAt: now(),
          },
        ],
        journals: !journal.reconcileFrom && start ? [{ ...journal, reconcileFrom: start }] : undefined,
      });
      return { imported: lines.length, duplicates: plan.duplicateCount };
    },

    async addStatementLine(input) {
      const data = requireData();
      if (!input.amount || !Number.isInteger(input.amount)) throw new LedgerError('INVALID_STATEMENT', 'Isi jumlah mutasi (negatif untuk uang keluar).');
      if (!input.description.trim()) throw new LedgerError('INVALID_STATEMENT', 'Isi keterangan mutasi.');
      const journal = data.journals.find((j) => j.id === input.journalId)!;
      const line: StatementLine = { id: newId(), ...input, description: input.description.trim(), balance: null, importId: null, status: 'open', createdAt: now() };
      await commit({ statementLines: [line], journals: journal.reconcileFrom ? undefined : [{ ...journal, reconcileFrom: input.date }] });
    },

    async deleteImport(importId) {
      const data = requireData();
      const lines = data.statementLines.filter((l) => l.importId === importId);
      if (lines.some((l) => l.status === 'reconciled')) {
        throw new LedgerError('ALREADY_RECONCILED', 'Sebagian mutasi dari impor ini sudah dicocokkan. Batalkan rekonsiliasinya dulu.');
      }
      await commit({ deletes: { statementLines: lines.map((l) => l.id), statementImports: [importId] } });
    },

    async reconcileBook(lineId, refs) {
      const line = findLine(lineId);
      await commit({ statementLines: [reconcileWithBook(line, refs, requireData(), now())] });
    },

    async reconcileInvoices(lineId, partnerId, invoiceIds) {
      const r = reconcileWithInvoices(findLine(lineId), partnerId, invoiceIds, requireData(), { now: now(), newId });
      await commit({ statementLines: [r.line], payments: [r.payment], entries: [r.entry] });
    },

    async reconcileAccount(lineId, accountId, label) {
      const r = reconcileWithAccount(findLine(lineId), accountId, label, requireData(), { now: now(), newId });
      await commit({ statementLines: [r.line], entries: [r.entry] });
    },

    async reconcileSettlement(lineId, refs) {
      const r = reconcileSettlementRule(findLine(lineId), refs, requireData(), { now: now(), newId });
      await commit({ statementLines: [r.line], entries: [r.entry] });
    },

    async reconcileTransit(lineId, refs) {
      const r = reconcileTransitRule(findLine(lineId), refs, requireData(), { now: now(), newId });
      await commit({ statementLines: [r.line], entries: [r.entry] });
    },

    async unreconcile(lineId, date) {
      const r = unreconcileRule(findLine(lineId), requireData(), { now: now(), newId, date });
      await commit({ statementLines: [r.line], entries: r.entries, payments: r.payments });
    },

    async transfer(input) {
      const entry = transferFunds(input, requireData(), { now: now(), newId });
      await commit({ entries: [entry] });
      return entry;
    },

    async closeCash(input) {
      const r = closeCashDay(input, requireData(), { now: now(), newId });
      await commit({ cashSessions: [r.session], entries: r.entry ? [r.entry] : [] });
      return r.session;
    },

    async saveRule(rule) {
      if (rule.keyword.trim().length < 3) throw new LedgerError('INVALID_STATEMENT', 'Kata kunci minimal 3 karakter.');
      if (rule.action === 'account' && !rule.accountId) throw new LedgerError('UNKNOWN_ACCOUNT', 'Pilih akun tujuan aturan.');
      await commit({ reconcileRules: [{ ...rule, keyword: rule.keyword.trim().toUpperCase() }] });
    },

    async deleteRule(id) {
      await commit({ deletes: { reconcileRules: [id] } });
    },

    // ── Laporan & tutup buku ──
    async postHpp(input) {
      const { record, entry } = postHppAdjustment(input, requireData(), { now: now(), newId });
      await commit({ hppAdjustments: [record], entries: [entry] });
    },

    async cancelHpp(id, date) {
      const rec = requireData().hppAdjustments.find((h) => h.id === id);
      if (!rec) throw new Error('Penyesuaian tidak ditemukan.');
      const r = cancelHppAdjustment(rec, requireData(), { now: now(), newId, date });
      await commit({ hppAdjustments: [r.record], entries: [r.original, r.reversal] });
    },

    async closePeriod(periodEnd, notes) {
      const data = requireData();
      const { record, lockDate } = closePeriodRule({ periodEnd, notes }, data, { now: now(), newId });
      await commit({ periodCloses: [record], company: { ...data.company, lockDate } });
    },

    async reopenPeriod(id, reason) {
      const data = requireData();
      const rec = data.periodCloses.find((p) => p.id === id);
      if (!rec) throw new Error('Penutupan tidak ditemukan.');
      const r = reopenPeriodRule(rec, reason, data, now());
      await commit({ periodCloses: [r.record], company: { ...data.company, lockDate: r.lockDate } });
    },

    async createClosingEntry(year) {
      const entry = buildClosingEntry(year, requireData(), { now: now(), newId });
      await commit({ entries: [entry] });
      return entry;
    },

    async markTaxExported(groups) {
      const pending = groups.filter((g) => !g.record);
      if (!pending.length) throw new LedgerError('INVALID_TAX', 'Tidak ada Faktur Pajak baru untuk diekspor.');
      await commit({ taxInvoices: markExported(pending, newId(), { now: now(), newId }) });
    },

    async recordTaxNumber(recordId, taxNumber, issuedDate) {
      const data = requireData();
      const rec = data.taxInvoices.find((t) => t.id === recordId);
      if (!rec) throw new Error('Faktur Pajak tidak ditemukan.');
      await commit({ taxInvoices: [recordTaxNumberRule(rec, taxNumber, issuedDate, data)] });
    },

    async cancelTaxInvoice(recordId) {
      const rec = requireData().taxInvoices.find((t) => t.id === recordId);
      if (!rec) throw new Error('Faktur Pajak tidak ditemukan.');
      await commit({ taxInvoices: [{ ...rec, status: 'cancelled' }] });
    },

    async postRetail(input) {
      const r = postRetailRecap(input, requireData(), { now: now(), newId });
      await commit({ retailRecaps: [r.recap], entries: [r.entry] });
    },

    async cancelRetail(id) {
      const rec = requireData().retailRecaps.find((r) => r.id === id);
      if (!rec) throw new Error('Rekap tidak ditemukan.');
      const r = cancelRetailRecap(rec, requireData(), { now: now(), newId });
      await commit({ retailRecaps: [r.recap], entries: [r.original, r.reversal] });
    },

    async updateBillTax(invoiceId, patch) {
      const data = requireData();
      const bill = data.invoices.find((i) => i.id === invoiceId);
      if (!bill || bill.kind !== 'in_invoice') throw new Error('Tagihan tidak ditemukan.');
      const next = { ...bill, ...patch };
      const oldPeriod = bill.creditPeriod ?? (bill.supplierTaxInvoiceDate ?? bill.date).slice(0, 7);
      const newPeriod = next.creditPeriod ?? (next.supplierTaxInvoiceDate ?? next.date).slice(0, 7);
      const err = validateCreditPeriod(next, newPeriod);
      if (err) throw new LedgerError('INVALID_TAX', err);
      const settled = data.ppnPeriods.filter((p) => p.status !== 'cancelled').map((p) => p.period);
      if (oldPeriod !== newPeriod && (settled.includes(oldPeriod) || settled.includes(newPeriod))) {
        throw new LedgerError('INVALID_TAX', 'Masa PPN terkait sudah dikompensasi. Batalkan kompensasinya dulu.');
      }
      await commit({ invoices: [next] });
    },

    async settlePpn(period) {
      const r = settlePpnPeriod(period, requireData(), { now: now(), newId });
      await commit({ ppnPeriods: [r.record], entries: [r.entry] });
    },

    async cancelPpn(id) {
      const rec = requireData().ppnPeriods.find((p) => p.id === id);
      if (!rec) throw new Error('Masa PPN tidak ditemukan.');
      const r = cancelPpnSettlement(rec, requireData(), { now: now(), newId });
      await commit({ ppnPeriods: [r.record], entries: [r.original, r.reversal] });
    },

    async payPpn(id, input) {
      const rec = requireData().ppnPeriods.find((p) => p.id === id);
      if (!rec) throw new Error('Masa PPN tidak ditemukan.');
      const r = payPpnRule(rec, input, requireData(), { now: now(), newId });
      await commit({ ppnPeriods: [r.record], entries: [r.entry] });
    },

    async saveTax(tax) {
      await commit({ taxes: [tax] });
    },

    async savePlan(plan) {
      await commit({ analyticPlans: [plan] });
    },

    async saveAnalyticAccount(a) {
      const data = requireData();
      if (!a.code.trim() || a.name.trim().length < 2) throw new LedgerError('INVALID_ANALYTIC', 'Isi kode dan nama akun analitik.');
      if (data.analyticAccounts.some((x) => x.id !== a.id && x.planId === a.planId && x.code.toUpperCase() === a.code.trim().toUpperCase())) {
        throw new LedgerError('DUPLICATE_CODE', `Kode ${a.code} sudah dipakai di dimensi ini.`);
      }
      if (a.parentId && (a.parentId === a.id || data.analyticAccounts.find((x) => x.id === a.parentId)?.planId !== a.planId)) {
        throw new LedgerError('INVALID_ANALYTIC', 'Induk harus akun lain di dimensi yang sama.');
      }
      await commit({ analyticAccounts: [{ ...a, code: a.code.trim().toUpperCase(), name: a.name.trim() }] });
    },

    async saveModel(m) {
      const data = requireData();
      if (m.name.trim().length < 3) throw new LedgerError('INVALID_ANALYTIC', 'Nama model minimal 3 karakter.');
      if (!m.accountIds.length) throw new LedgerError('INVALID_ANALYTIC', 'Pilih minimal satu akun.');
      const issues = validateDistribution(m.analytic, data);
      if (!Object.keys(m.analytic).length) issues.push('Isi distribusi minimal untuk satu dimensi.');
      if (issues.length) throw new LedgerError('INVALID_ANALYTIC', issues.join(' '));
      await commit({ distributionModels: [m] });
    },

    async deleteModel(id) {
      await commit({ deletes: { distributionModels: [id] } });
    },

    async setJournalAnalytic(journalId, dist) {
      const data = requireData();
      const j = data.journals.find((x) => x.id === journalId);
      if (!j) throw new Error('Jurnal tidak ditemukan.');
      if (dist) {
        const issues = validateDistribution(dist, data);
        if (issues.length) throw new LedgerError('INVALID_ANALYTIC', issues.join(' '));
      }
      await commit({ journals: [{ ...j, defaultAnalytic: dist && Object.keys(dist).length ? dist : undefined }] });
    },

    async setDistribution(refs, planId, dist) {
      const entries = setDistributionRule(refs, planId, dist, requireData());
      await commit({ entries });
      return refs.length;
    },

    async saveBudget(b) {
      const issues = validateBudget(b, requireData());
      if (issues.length) throw new LedgerError('INVALID_BUDGET', issues.join(' '));
      await commit({ budgets: [{ ...b, updatedAt: now() }] });
    },

    async deleteBudget(id) {
      await commit({ deletes: { budgets: [id] } });
    },

    async saveAsset(asset) {
      const data = requireData();
      const issues = validateAsset(asset, data);
      if (issues.length) throw new LedgerError('INVALID_ASSET', issues.join(' '));
      const before = data.assets.find((a) => a.id === asset.id);
      if (before && hasPostedDepreciation(asset.id, data)) {
        const changed = lockedFieldChanges(before, asset);
        if (changed.length) throw new LedgerError('INVALID_ASSET', 'Penyusutan aset ini sudah dibukukan; nilai, masa manfaat, dan tanggal tidak bisa diubah. Gunakan perbaikan dikapitalisasi atau pelepasan.');
      }
      if (before?.status === 'disposed') throw new LedgerError('INVALID_ASSET', 'Aset yang sudah dilepas tidak bisa diubah.');
      await commit({ assets: [{ ...asset, code: asset.code.trim().toUpperCase(), name: asset.name.trim() }] });
    },

    async deleteAsset(id) {
      const a = requireData().assets.find((x) => x.id === id);
      if (!a || a.status !== 'draft') throw new LedgerError('INVALID_ASSET', 'Hanya draft aset yang bisa dihapus.');
      await commit({ deletes: { assets: [id] } });
    },

    async addImprovement(id, imp) {
      const data = requireData();
      const a = data.assets.find((x) => x.id === id);
      if (!a) throw new Error('Aset tidak ditemukan.');
      await commit({ assets: [addImprovementRule(a, imp, data, newId)] });
    },

    async disposeAsset(id, input) {
      const data = requireData();
      const a = data.assets.find((x) => x.id === id);
      if (!a) throw new Error('Aset tidak ditemukan.');
      const r = disposeAssetRule(a, input, data, { now: now(), newId });
      await commit({ assets: [r.asset], entries: [r.entry] });
    },

    async saveDeferral(d) {
      const data = requireData();
      const issues = validateDeferral(d, data);
      if (issues.length) throw new LedgerError('INVALID_ASSET', issues.join(' '));
      const used = data.depreciationRuns.some((r) => r.status === 'posted' && r.items.some((i) => i.id === d.id));
      const before = data.deferrals.find((x) => x.id === d.id);
      if (used && before && (['startMonth', 'months', 'total', 'deferralAccountId', 'recognitionAccountId', 'openingRecognized'] as const).some((k) => before[k] !== d[k])) {
        throw new LedgerError('INVALID_ASSET', 'Sudah ada pengakuan yang dibukukan; jadwal tidak bisa diubah. Batalkan (status) lalu buat yang baru untuk sisanya.');
      }
      await commit({ deferrals: [d] });
    },

    async runDepreciation(period) {
      const r = postDepreciationRun(period, requireData(), { now: now(), newId });
      await commit({ depreciationRuns: [r.run], entries: [r.entry] });
    },

    async cancelRun(id) {
      const run = requireData().depreciationRuns.find((r) => r.id === id);
      if (!run) throw new Error('Run tidak ditemukan.');
      const r = cancelDepreciationRun(run, requireData(), { now: now(), newId });
      await commit({ depreciationRuns: [r.run], entries: [r.original, r.reversal] });
    },

    async cancelClosingEntry(year) {
      const r = cancelClosingRule(year, requireData(), { now: now(), newId, date: `${year}-12-31` });
      await commit({ entries: [r.original, r.reversal] });
    },
  };
});

/** Hook praktis untuk layar yang sudah pasti data termuat (dibungkus oleh <DataGate>). */
export function useLedgerData(): LedgerData {
  const data = useLedger((s) => s.data);
  if (!data) throw new Error('useLedgerData dipakai di luar DataGate.');
  return data;
}
