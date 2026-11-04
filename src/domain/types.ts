/**
 * Tipe data inti Core Ledger.
 * Struktur sengaja mengikuti pola Odoo (account.account, account.journal,
 * account.move, account.move.line) agar mudah dipetakan ke skema database.
 *
 * ATURAN UANG: semua nominal disimpan sebagai bilangan bulat Rupiah (integer).
 * Jangan pernah menyimpan nominal sebagai float.
 */

export type ISODate = string; // format 'YYYY-MM-DD'
export type Money = number; // integer Rupiah

export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

export type AccountGroup =
  | 'Aset Lancar'
  | 'Aset Tetap'
  | 'Kewajiban'
  | 'Ekuitas'
  | 'Pendapatan'
  | 'Harga Pokok Penjualan'
  | 'Beban Operasional'
  | 'Pendapatan & Beban Lain'
  | 'Pajak Penghasilan';

export interface Account {
  id: string;
  code: string; // 4 digit, digit pertama = kelompok
  name: string;
  type: AccountType;
  group: AccountGroup;
  /** Akun kontra: saldo normal berlawanan dengan tipenya (mis. Akumulasi Penyusutan, Retur Penjualan, Prive). */
  contra?: boolean;
  /** Akun kas/bank — dipakai dashboard untuk ringkasan likuiditas. */
  liquidity?: boolean;
  active: boolean;
}

export type JournalType = 'sale' | 'purchase' | 'bank' | 'cash' | 'general';

export interface Journal {
  id: string;
  code: string; // dipakai sebagai prefix penomoran, mis. 'UMUM'
  name: string;
  type: JournalType;
  /** Akun kas/bank bawaan untuk jurnal bertipe bank/cash (dipakai pembayaran). */
  defaultAccountId?: string;
  /** Mini App 6 — distribusi analitik bawaan untuk baris jurnal ini (mis. outlet dari kas toko). */
  defaultAnalytic?: AnalyticDistribution;
  /** Mini App 3 — info rekening bank. */
  bankName?: string;
  accountNumber?: string;
  statementFormat?: StatementFormat;
  /** Mutasi buku sebelum tanggal ini dianggap sudah cocok (saldo awal rekonsiliasi). */
  reconcileFrom?: ISODate;
}

export type StatementFormat = 'bca' | 'generic';

export type EntryStatus = 'draft' | 'posted' | 'reversed';

/** Distribusi analitik: id akun analitik → persen (maks. 2 desimal). Per dimensi totalnya 100. */
export type AnalyticDistribution = Record<string, number>;

export interface JournalLine {
  id: string;
  accountId: string;
  label: string;
  debit: Money;
  credit: Money;
  /** Mini App 6 — informasi manajemen; tidak memengaruhi saldo akun. */
  analytic?: AnalyticDistribution;
}

/** Dokumen asal sebuah entri jurnal (faktur, tagihan, pembayaran). */
export interface EntrySource {
  type: 'invoice' | 'payment' | 'statement' | 'cash_session' | 'transfer' | 'hpp_adjustment' | 'closing' | 'retail_recap' | 'ppn_settlement' | 'ppn_payment' | 'depreciation' | 'asset_disposal';
  id: string;
}

export interface JournalEntry {
  id: string;
  journalId: string;
  /** Diberikan saat posting. Draft selalu null. */
  number: string | null;
  date: ISODate;
  reference: string;
  status: EntryStatus;
  lines: JournalLine[];
  /** Diisi pada entri asli bila sudah dibalik. */
  reversedById?: string;
  /** Diisi pada entri pembalik, menunjuk entri asli. */
  reversalOfId?: string;
  createdAt: string;
  postedAt?: string;
  /** Entri yang dibuat otomatis dari dokumen. Entri seperti ini hanya bisa dikoreksi lewat dokumennya. */
  source?: EntrySource;
}

export interface Company {
  name: string;
  currency: 'IDR';
  /** Entri bertanggal <= lockDate tidak boleh diposting. null = tidak dikunci. */
  lockDate: ISODate | null;
  address?: string;
  npwp?: string;
  phone?: string;
  /** Batas wajar potongan MDR settlement QRIS/EDC, dalam persen dari nilai kotor. */
  settlementFeeTolerance?: number;
  /** Mini App 5 — identitas pajak penjual. NPWP 16 digit. */
  nitku?: string; // ID TKU penjual (22 digit)
  /** PKP Pedagang Eceran: penjualan ke konsumen akhir boleh dilaporkan digunggung. */
  retailTrader?: boolean;
  /** true setelah pemetaan kolom ekspor Coretax dicocokkan dengan template resmi DJP. */
  coretaxTemplateVerified?: boolean;
}

// ───────────────────────── Mini App 2: AR/AP ─────────────────────────

export type PartnerKind = 'customer' | 'supplier' | 'both';
/** Tier harga Oriental Member. */
export type CustomerTier = 'retail' | 'ukm' | 'grosir';

export interface Partner {
  id: string;
  name: string;
  kind: PartnerKind;
  tier: CustomerTier | null;
  /** Termin pembayaran dalam hari. 0 = tunai/jatuh tempo hari itu juga. */
  paymentTermDays: number;
  /** Batas piutang. 0 = tanpa batas. */
  creditLimit: Money;
  receivableAccountId: string;
  payableAccountId: string;
  npwp?: string;
  address?: string;
  phone?: string;
  active: boolean;
  /** Mini App 5 — jenis identitas pembeli untuk Faktur Pajak. */
  taxIdType?: TaxIdType;
  /** ID TKU (22 digit: NPWP 16 digit + 6 digit kode tempat usaha, pusat = 000000). */
  nitku?: string;
  email?: string;
}

export type TaxIdType = 'TIN' | 'NIK' | 'PASSPORT' | 'OTHER';

export interface Tax {
  id: string;
  name: string;
  /** Tarif dalam persen, mis. 12. */
  rate: number;
  /** DPP = dasar × dppNumerator / dppDenominator. PPN nonmewah: 11/12. */
  dppNumerator: number;
  dppDenominator: number;
  salesAccountId: string; // PPN Keluaran
  purchaseAccountId: string; // PPN Masukan
  active: boolean;
  /** Kode transaksi Faktur Pajak Coretax, mis. '04' (DPP nilai lain) atau '08' (dibebaskan). */
  coretaxCode?: string;
  /** Keterangan tambahan/cap fasilitas untuk kode 07/08 (diisi sesuai arahan konsultan). */
  coretaxAdditionalInfo?: string;
  /** Hanya untuk pembelian (mis. supplier non-PKP); tidak muncul di faktur penjualan. */
  purchaseOnly?: boolean;
}

/** out_invoice = faktur penjualan, in_invoice = tagihan vendor, *_refund = nota kredit. */
export type InvoiceKind = 'out_invoice' | 'in_invoice' | 'out_refund' | 'in_refund';
export type InvoiceStatus = 'draft' | 'posted';

export interface InvoiceLine {
  id: string;
  description: string;
  accountId: string;
  /** Boleh desimal (mis. 2,5 kg), maks. 3 angka di belakang koma. */
  quantity: number;
  unitPrice: Money;
  taxId: string;
  analytic?: AnalyticDistribution;
}

export interface Invoice {
  id: string;
  kind: InvoiceKind;
  partnerId: string;
  number: string | null;
  date: ISODate;
  dueDate: ISODate;
  /** No. faktur supplier / no. PO pelanggan. */
  reference: string;
  notes: string;
  lines: InvoiceLine[];
  status: InvoiceStatus;
  /** Diisi saat posting. */
  entryId?: string;
  /** Akun piutang/utang yang dipakai saat posting (dibekukan agar tidak berubah bila kontak diubah). */
  counterpartAccountId?: string;
  /** Nota kredit: faktur/tagihan asal. */
  refundOfId?: string;
  createdAt: string;
  postedAt?: string;
  /** Mini App 5 — tagihan vendor: Faktur Pajak dari supplier. */
  supplierTaxInvoiceNumber?: string;
  supplierTaxInvoiceDate?: ISODate;
  /** Masa pengkreditan PPN Masukan ('YYYY-MM'). Default masa tanggal faktur pajak. */
  creditPeriod?: string;
}

export type PaymentDirection = 'inbound' | 'outbound';

export interface PaymentAllocation {
  invoiceId: string;
  amount: Money;
}

export interface Payment {
  id: string;
  direction: PaymentDirection;
  partnerId: string;
  number: string;
  date: ISODate;
  journalId: string;
  amount: Money;
  memo: string;
  allocations: PaymentAllocation[];
  status: 'posted' | 'cancelled';
  entryId: string;
  /** Entri pembalik saat pembayaran dibatalkan. */
  cancelEntryId?: string;
  createdAt: string;
}

// ───────────────────────── Mini App 3: Bank & Kas ─────────────────────────

/** Referensi ke satu baris entri jurnal. */
export interface LineRef {
  entryId: string;
  lineId: string;
}

export interface Reconciliation {
  /** Baris buku di akun bank yang menjadi pasangan mutasi ini. Total (debit − kredit) = jumlah mutasi. */
  bankLineRefs: LineRef[];
  /** Baris di akun penampung (1112 settlement, 1103 dana dalam perjalanan) yang ikut diselesaikan. */
  clearedLineRefs: LineRef[];
  /** Entri yang dibuat oleh proses rekonsiliasi (bukan dari pembayaran). */
  createdEntryIds: string[];
  /** Pembayaran yang dibuat oleh proses rekonsiliasi. */
  createdPaymentIds: string[];
  reconciledAt: string;
}

export interface StatementLine {
  id: string;
  journalId: string;
  date: ISODate;
  description: string;
  /** Positif = uang masuk, negatif = uang keluar. */
  amount: Money;
  /** Saldo setelah mutasi menurut bank, bila tersedia. */
  balance: Money | null;
  importId: string | null;
  status: 'open' | 'reconciled';
  reconciliation?: Reconciliation;
  createdAt: string;
}

export interface StatementImport {
  id: string;
  journalId: string;
  fileName: string;
  format: StatementFormat | 'manual';
  periodStart: ISODate | null;
  periodEnd: ISODate | null;
  openingBalance: Money | null;
  closingBalance: Money | null;
  importedCount: number;
  duplicateCount: number;
  importedAt: string;
}

export interface ReconcileRule {
  id: string;
  /** Teks yang dicari di keterangan mutasi (tidak peka huruf besar/kecil). */
  keyword: string;
  direction: 'in' | 'out' | 'any';
  /** account = langsung ke akun; settlement = pencairan QRIS/EDC dari akun 1112. */
  action: 'account' | 'settlement';
  accountId?: string;
  label: string;
  active: boolean;
}

export interface CashSession {
  id: string;
  journalId: string;
  date: ISODate;
  opening: Money;
  inflow: Money;
  outflow: Money;
  expected: Money;
  counted: Money;
  difference: Money;
  /** Rincian pecahan uang (nilai pecahan → jumlah lembar/keping). */
  denominations: Record<string, number>;
  entryId?: string;
  notes: string;
  closedAt: string;
}

// ───────────────────────── Mini App 4: Laporan & Tutup Buku ─────────────────────────

export interface HppAdjustmentLine {
  accountId: string; // akun persediaan
  book: Money; // saldo buku per akhir periode (sebelum penyesuaian)
  counted: Money; // nilai stok opname
  usage: Money; // book − counted (barang keluar)
}

export interface HppAdjustment {
  id: string;
  periodEnd: ISODate;
  lines: HppAdjustmentLine[];
  /** Pembagian HPP barang ke akun HPP per pilar (accountId → jumlah). */
  allocation: Record<string, Money>;
  /** Pembagian proporsional yang disarankan sistem saat dibuat. */
  proportional: Record<string, Money>;
  /** true bila pembagian diubah dari usulan proporsional (bukan estimasi murni). */
  edited: boolean;
  entryId: string;
  status: 'posted' | 'cancelled';
  cancelEntryId?: string;
  notes: string;
  createdAt: string;
}

export interface PeriodSnapshot {
  revenue: Money;
  netProfit: Money;
  totalAssets: Money;
  totalLiabilities: Money;
  totalEquity: Money;
}

export interface PeriodClose {
  id: string;
  periodStart: ISODate;
  periodEnd: ISODate;
  status: 'closed' | 'reopened';
  closedAt: string;
  notes: string;
  /** Peringatan checklist yang dilewati saat penutupan. */
  warningsAtClose: string[];
  snapshot: PeriodSnapshot;
  reopenedAt?: string;
  reopenReason?: string;
}

// ───────────────────────── Mini App 5: Pajak ─────────────────────────

export type TaxInvoiceStatus = 'exported' | 'issued' | 'cancelled';

/**
 * Faktur Pajak Keluaran. Satu faktur penjualan bisa menghasilkan lebih dari satu Faktur Pajak
 * bila barisnya memakai kode transaksi berbeda (mis. 04 dan 08). Rekaman dibuat saat diekspor.
 */
export interface TaxInvoice {
  id: string;
  invoiceId: string;
  transactionCode: string;
  dpp: Money; // harga jual (dasar)
  dppOther: Money; // DPP nilai lain
  ppn: Money;
  status: TaxInvoiceStatus;
  exportBatchId: string;
  /** Nomor Faktur Pajak dari Coretax setelah terbit. */
  taxNumber?: string;
  issuedDate?: ISODate;
  notes: string;
  createdAt: string;
}

export interface RetailRecap {
  id: string;
  date: ISODate;
  /** Rekening kas penerima uang tunai. */
  cashJournalId: string;
  cash: Money; // termasuk PPN
  nonCash: Money; // QRIS/EDC, termasuk PPN → 1112
  /** Bagian dari total (tunai + non-tunai) yang merupakan barang dibebaskan PPN. */
  exemptGross: Money;
  dpp: Money; // harga jual barang kena pajak (tanpa PPN)
  ppn: Money;
  entryId: string;
  status: 'posted' | 'cancelled';
  cancelEntryId?: string;
  notes: string;
  createdAt: string;
}

export interface PpnPeriod {
  id: string;
  /** Masa pajak 'YYYY-MM'. */
  period: string;
  outputTax: Money;
  inputTax: Money;
  /** Lebih bayar masa sebelumnya yang dikompensasikan. */
  priorCredit: Money;
  /** Positif = kurang bayar, negatif = lebih bayar. */
  net: Money;
  settlementEntryId: string;
  status: 'settled' | 'paid' | 'cancelled';
  paymentEntryId?: string;
  ntpn?: string;
  paidDate?: ISODate;
  createdAt: string;
}

// ───────────────────────── Mini App 6: Analitik & Anggaran ─────────────────────────

/** Tingkat kewajiban dimensi per kelompok akun. */
export type Applicability = 'mandatory' | 'recommended' | 'optional' | 'unavailable';
export type ApplicabilityKey = 'revenue' | 'cogs' | 'opex' | 'other' | 'tax' | 'balance';

export interface AnalyticPlan {
  id: string;
  name: string;
  applicability: Record<ApplicabilityKey, Applicability>;
}

export interface AnalyticAccount {
  id: string;
  planId: string;
  code: string;
  name: string;
  parentId?: string;
  /** Untuk dimensi Pilar: akun pendapatan & HPP yang otomatis masuk ke pilar ini. */
  autoAccountCodes?: string[];
  active: boolean;
}

export interface DistributionModel {
  id: string;
  name: string;
  /** Berlaku untuk akun-akun ini … */
  accountIds: string[];
  /** … dan (opsional) hanya untuk kontak ini. */
  partnerId?: string;
  analytic: AnalyticDistribution;
  active: boolean;
}

export interface BudgetLine {
  id: string;
  accountId: string;
  /** Opsional: anggaran khusus satu akun analitik (mis. satu pilar). */
  analyticAccountId?: string;
  /** 12 angka Januari–Desember, nilai positif (pendapatan maupun beban). */
  amounts: Money[];
}

export interface Budget {
  id: string;
  year: string;
  name: string;
  lines: BudgetLine[];
  updatedAt: string;
}

// ───────────────────────── Mini App 7: Aset & Penyusutan ─────────────────────────

/** Kelompok harta fiskal PMK 72/2023. BP = bangunan permanen, BT = bangunan tidak permanen. */
export type FiscalGroup = 'G1' | 'G2' | 'G3' | 'G4' | 'BP' | 'BT';
export type FiscalMethod = 'SL' | 'DB';

export interface AssetCategory {
  id: string;
  name: string;
  assetAccountId: string;
  accumAccountId: string;
  expenseAccountId: string;
  defaultFiscalGroup: FiscalGroup;
  active: boolean;
}

export interface AssetImprovement {
  id: string;
  date: ISODate;
  amount: Money;
  extraMonths: number;
  note: string;
}

export interface AssetDisposal {
  date: ISODate;
  type: 'sale' | 'writeoff';
  proceeds: Money;
  /** Rekening penerima hasil penjualan. */
  journalId?: string;
  entryId: string;
  note: string;
}

export interface Asset {
  id: string;
  code: string;
  name: string;
  categoryId: string;
  serial: string;
  acquisitionDate: ISODate;
  inServiceDate: ISODate;
  cost: Money;
  salvage: Money;
  /** Masa manfaat komersial (bulan). Metode komersial: garis lurus. */
  usefulLifeMonths: number;
  fiscalGroup: FiscalGroup;
  fiscalMethod: FiscalMethod;
  analytic?: AnalyticDistribution;
  status: 'draft' | 'running' | 'disposed';
  /** Saldo awal aset lama: akumulasi penyusutan s.d. akhir bulan openingDate. */
  openingAccumulated: Money;
  openingDate?: ISODate;
  improvements: AssetImprovement[];
  disposal?: AssetDisposal;
  sourceInvoiceId?: string;
  sourceLineId?: string;
  createdAt: string;
}

export interface Deferral {
  id: string;
  kind: 'expense' | 'revenue';
  name: string;
  partnerId?: string;
  /** Bulan pertama pengakuan ('YYYY-MM'). */
  startMonth: string;
  months: number;
  total: Money;
  /** 1403 Biaya Dibayar di Muka / 2303 Pendapatan Diterima di Muka. */
  deferralAccountId: string;
  /** Akun beban/pendapatan tujuan pengakuan. */
  recognitionAccountId: string;
  analytic?: AnalyticDistribution;
  /** Sudah diakui sebelum aplikasi dipakai. */
  openingRecognized: Money;
  status: 'running' | 'cancelled';
  sourceInvoiceId?: string;
  sourceLineId?: string;
  createdAt: string;
}

export interface DepreciationRunItem {
  type: 'asset' | 'deferral';
  id: string;
  amount: Money;
}

export interface DepreciationRun {
  id: string;
  period: string;
  entryId: string;
  items: DepreciationRunItem[];
  status: 'posted' | 'cancelled';
  createdAt: string;
}

export interface LedgerData {
  company: Company;
  accounts: Account[];
  journals: Journal[];
  entries: JournalEntry[];
  partners: Partner[];
  taxes: Tax[];
  invoices: Invoice[];
  payments: Payment[];
  statementLines: StatementLine[];
  statementImports: StatementImport[];
  reconcileRules: ReconcileRule[];
  cashSessions: CashSession[];
  hppAdjustments: HppAdjustment[];
  periodCloses: PeriodClose[];
  taxInvoices: TaxInvoice[];
  retailRecaps: RetailRecap[];
  ppnPeriods: PpnPeriod[];
  analyticPlans: AnalyticPlan[];
  analyticAccounts: AnalyticAccount[];
  distributionModels: DistributionModel[];
  budgets: Budget[];
  assetCategories: AssetCategory[];
  assets: Asset[];
  deferrals: Deferral[];
  depreciationRuns: DepreciationRun[];
}
