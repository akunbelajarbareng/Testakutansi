/**
 * FAKTUR, TAGIHAN, NOTA KREDIT — fungsi murni.
 * Setiap dokumen yang diposting menghasilkan satu entri jurnal (source = invoice)
 * yang nomornya sama dengan nomor dokumen.
 */
import { LedgerError } from './errors';
import { assertNotLocked, isValidDate, nextSequenceNumber, type ValidationIssue } from './rules';
import type {
  CustomerTier,
  ISODate,
  Invoice,
  InvoiceKind,
  InvoiceLine,
  JournalEntry,
  JournalLine,
  LedgerData,
  Money,
  Partner,
  Tax,
} from './types';
import { formatRupiah } from '../lib/format';

// ── Klasifikasi dokumen ──────────────────────────────────────────────

export const isSale = (k: InvoiceKind) => k === 'out_invoice' || k === 'out_refund';
export const isRefund = (k: InvoiceKind) => k === 'out_refund' || k === 'in_refund';

/** Awalan nomor dokumen. Faktur/tagihan memakai kode jurnalnya, nota kredit diberi awalan R. */
export const NUMBER_PREFIX: Record<InvoiceKind, string> = {
  out_invoice: 'PJ',
  out_refund: 'RPJ',
  in_invoice: 'PB',
  in_refund: 'RPB',
};
/** Kode jurnal tempat entri dokumen dicatat. */
export const JOURNAL_CODE: Record<InvoiceKind, string> = {
  out_invoice: 'PJ',
  out_refund: 'PJ',
  in_invoice: 'PB',
  in_refund: 'PB',
};
export const KIND_LABEL: Record<InvoiceKind, string> = {
  out_invoice: 'Faktur Penjualan',
  out_refund: 'Nota Kredit Penjualan',
  in_invoice: 'Tagihan Vendor',
  in_refund: 'Nota Kredit Pembelian',
};

/** Akun pendapatan bawaan per tier pelanggan (pilar bisnis). */
export const INCOME_ACCOUNT_BY_TIER: Record<CustomerTier, string> = {
  retail: '4101',
  ukm: '4102',
  grosir: '4103',
};
export const DEFAULT_PURCHASE_ACCOUNT = '1301';
export const SALES_RETURN_ACCOUNT = '4201';
export const CUSTOMER_DEPOSIT_ACCOUNT = '2301';
export const SUPPLIER_ADVANCE_ACCOUNT = '1402';

// ── Perhitungan ──────────────────────────────────────────────────────

/** Subtotal baris dibulatkan ke rupiah. */
export function lineSubtotal(line: Pick<InvoiceLine, 'quantity' | 'unitPrice'>): Money {
  return Math.round(line.quantity * line.unitPrice);
}

export interface TaxSummary {
  tax: Tax;
  base: Money; // jumlah subtotal baris dengan pajak ini
  dpp: Money; // dasar pengenaan pajak
  amount: Money; // PPN
}

export interface InvoiceTotals {
  untaxed: Money;
  taxes: TaxSummary[];
  tax: Money;
  total: Money;
}

/**
 * PPN dihitung per dokumen per jenis pajak (bukan per baris):
 *   DPP = round(dasar × pembilang / penyebut)   → PPN nonmewah: 11/12
 *   PPN = round(DPP × tarif / 100)
 * Sama dengan cara faktur pajak menampilkan DPP dan PPN.
 */
export function invoiceTotals(invoice: Pick<Invoice, 'lines'>, taxes: Tax[]): InvoiceTotals {
  const bases = new Map<string, Money>();
  let untaxed = 0;
  for (const l of invoice.lines) {
    const sub = lineSubtotal(l);
    untaxed += sub;
    bases.set(l.taxId, (bases.get(l.taxId) ?? 0) + sub);
  }
  const summaries: TaxSummary[] = [];
  for (const [taxId, base] of bases) {
    const tax = taxes.find((t) => t.id === taxId);
    if (!tax) continue;
    const dpp = Math.round((base * tax.dppNumerator) / tax.dppDenominator);
    const amount = Math.round((dpp * tax.rate) / 100);
    summaries.push({ tax, base, dpp, amount });
  }
  const tax = summaries.reduce((s, t) => s + t.amount, 0);
  return { untaxed, taxes: summaries, tax, total: untaxed + tax };
}

export function addDays(date: ISODate, days: number): ISODate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

// ── Sisa tagihan & status pembayaran ─────────────────────────────────

/** Total yang sudah dilunasi lewat pembayaran (tidak termasuk yang dibatalkan). */
export function paidAmount(invoice: Invoice, data: Pick<LedgerData, 'payments'>): Money {
  let sum = 0;
  for (const p of data.payments) {
    if (p.status !== 'posted') continue;
    for (const a of p.allocations) if (a.invoiceId === invoice.id) sum += a.amount;
  }
  return sum;
}

/** Total nota kredit yang sudah diposting atas dokumen ini. */
export function refundedAmount(invoice: Invoice, data: Pick<LedgerData, 'invoices' | 'taxes'>): Money {
  return data.invoices
    .filter((r) => r.refundOfId === invoice.id && r.status === 'posted')
    .reduce((s, r) => s + invoiceTotals(r, data.taxes).total, 0);
}

/**
 * Sisa tagihan = total − pembayaran − nota kredit.
 * Nota kredit sendiri langsung diterapkan ke dokumen asalnya, jadi sisanya selalu 0.
 */
export function invoiceResidual(invoice: Invoice, data: Pick<LedgerData, 'invoices' | 'payments' | 'taxes'>): Money {
  if (isRefund(invoice.kind) && invoice.status === 'posted') return 0;
  return invoiceTotals(invoice, data.taxes).total - paidAmount(invoice, data) - refundedAmount(invoice, data);
}

export type PaymentState = 'draft' | 'unpaid' | 'partial' | 'paid' | 'applied';

export function paymentState(invoice: Invoice, data: Pick<LedgerData, 'invoices' | 'payments' | 'taxes'>): PaymentState {
  if (invoice.status === 'draft') return 'draft';
  if (isRefund(invoice.kind)) return 'applied';
  const total = invoiceTotals(invoice, data.taxes).total;
  const residual = invoiceResidual(invoice, data);
  if (residual <= 0) return 'paid';
  return residual < total ? 'partial' : 'unpaid';
}

export function isOverdue(invoice: Invoice, data: Pick<LedgerData, 'invoices' | 'payments' | 'taxes'>, today: ISODate): boolean {
  const s = paymentState(invoice, data);
  return (s === 'unpaid' || s === 'partial') && invoice.dueDate < today;
}

// ── Batas kredit ─────────────────────────────────────────────────────

export interface CreditCheck {
  limit: Money;
  /** Piutang terbuka saat ini (faktur diposting yang belum lunas). */
  outstanding: Money;
  /** Piutang terbuka bila dokumen tambahan ikut dihitung. */
  exposure: Money;
  exceeded: boolean;
}

export function creditCheck(partner: Partner, data: LedgerData, additional: Money = 0, excludeInvoiceId?: string): CreditCheck {
  const outstanding = data.invoices
    .filter((i) => i.partnerId === partner.id && i.kind === 'out_invoice' && i.status === 'posted' && i.id !== excludeInvoiceId)
    .reduce((s, i) => s + Math.max(0, invoiceResidual(i, data)), 0);
  const exposure = outstanding + additional;
  return { limit: partner.creditLimit, outstanding, exposure, exceeded: partner.creditLimit > 0 && exposure > partner.creditLimit };
}

// ── Validasi & posting ───────────────────────────────────────────────

export function validateInvoice(invoice: Invoice, data: LedgerData): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const partner = data.partners.find((p) => p.id === invoice.partnerId);
  if (!partner) {
    issues.push({ code: 'UNKNOWN_PARTNER', message: isSale(invoice.kind) ? 'Pilih pelanggan.' : 'Pilih supplier.' });
  }
  if (!isValidDate(invoice.date)) issues.push({ code: 'INVALID_DATE', message: 'Tanggal dokumen tidak valid.' });
  if (!isValidDate(invoice.dueDate)) issues.push({ code: 'INVALID_DATE', message: 'Tanggal jatuh tempo tidak valid.' });
  else if (invoice.dueDate < invoice.date) {
    issues.push({ code: 'INVALID_DATE', message: 'Jatuh tempo tidak boleh sebelum tanggal dokumen.' });
  }
  if (invoice.lines.length === 0) {
    issues.push({ code: 'INVALID_INVOICE', message: 'Dokumen minimal berisi 1 baris.' });
  }
  invoice.lines.forEach((l, i) => {
    const row = `Baris ${i + 1}`;
    if (!l.description.trim()) issues.push({ code: 'INVALID_INVOICE', lineIndex: i, message: `${row}: isi deskripsi barang/jasa.` });
    if (!(l.quantity > 0) || Math.round(l.quantity * 1000) !== l.quantity * 1000) {
      issues.push({ code: 'INVALID_INVOICE', lineIndex: i, message: `${row}: kuantitas harus lebih dari 0 (maks. 3 desimal).` });
    }
    if (!Number.isInteger(l.unitPrice) || l.unitPrice < 0) {
      issues.push({ code: 'INVALID_INVOICE', lineIndex: i, message: `${row}: harga harus bilangan bulat Rupiah, tidak negatif.` });
    }
    const account = data.accounts.find((a) => a.id === l.accountId);
    if (!account) issues.push({ code: 'UNKNOWN_ACCOUNT', lineIndex: i, message: `${row}: pilih akun.` });
    else if (!account.active) issues.push({ code: 'INACTIVE_ACCOUNT', lineIndex: i, message: `${row}: akun ${account.code} nonaktif.` });
    if (!data.taxes.some((t) => t.id === l.taxId)) issues.push({ code: 'INVALID_INVOICE', lineIndex: i, message: `${row}: pilih pajak.` });
  });
  if (issues.length === 0 && invoiceTotals(invoice, data.taxes).total <= 0) {
    issues.push({ code: 'INVALID_INVOICE', message: 'Total dokumen harus lebih dari 0.' });
  }
  return issues;
}

/** Susun baris jurnal dari dokumen. Arah debit/kredit dibalik untuk nota kredit. */
export function buildInvoiceLines(invoice: Invoice, data: LedgerData, counterpartAccountId: string, newId: () => string): JournalLine[] {
  const totals = invoiceTotals(invoice, data.taxes);
  const sale = isSale(invoice.kind);
  // Penjualan: pendapatan & PPN di kredit. Pembelian: barang/beban & PPN di debit. Nota kredit: kebalikannya.
  const goodsOnCredit = sale !== isRefund(invoice.kind);
  const line = (accountId: string, label: string, amount: Money, onCredit: boolean): JournalLine => ({
    id: newId(),
    accountId,
    label,
    debit: onCredit ? 0 : amount,
    credit: onCredit ? amount : 0,
  });

  const lines: JournalLine[] = [];
  // Baris barang/jasa digabung per akun (dan per distribusi analitik) agar jurnal ringkas.
  const keyOf = (l: Invoice['lines'][number]) => `${l.accountId}|${l.analytic ? JSON.stringify(Object.entries(l.analytic).sort()) : ''}`;
  const byKey = new Map<string, { accountId: string; label: string; amount: Money; analytic?: Record<string, number> }>();
  for (const l of invoice.lines) {
    const k = keyOf(l);
    const cur = byKey.get(k) ?? { accountId: l.accountId, label: l.description, amount: 0, analytic: l.analytic };
    cur.amount += lineSubtotal(l);
    byKey.set(k, cur);
  }
  for (const g of byKey.values()) {
    if (g.amount !== 0) lines.push({ ...line(g.accountId, g.label, g.amount, goodsOnCredit), ...(g.analytic && Object.keys(g.analytic).length ? { analytic: g.analytic } : {}) });
  }
  for (const t of totals.taxes) {
    if (t.amount === 0) continue;
    lines.push(line(sale ? t.tax.salesAccountId : t.tax.purchaseAccountId, `${t.tax.name} atas DPP ${formatRupiah(t.dpp)}`, t.amount, goodsOnCredit));
  }
  const partner = data.partners.find((p) => p.id === invoice.partnerId);
  lines.push(line(counterpartAccountId, partner?.name ?? '', totals.total, !goodsOnCredit));
  return lines;
}

export interface PostInvoiceOptions {
  now: string;
  newId: () => string;
}

/** Posting dokumen: validasi, cek tanggal kunci & batas nota kredit, beri nomor, buat entri jurnal. */
export function postInvoice(invoice: Invoice, data: LedgerData, opts: PostInvoiceOptions): { invoice: Invoice; entry: JournalEntry } {
  if (invoice.status !== 'draft') {
    throw new LedgerError('NOT_DRAFT', 'Dokumen yang sudah diposting tidak bisa diubah. Gunakan nota kredit untuk koreksi.');
  }
  const issues = validateInvoice(invoice, data);
  if (issues.length) throw new LedgerError(issues[0].code, issues.map((i) => i.message).join(' '));
  assertNotLocked(invoice.date, data);

  if (isRefund(invoice.kind)) {
    const origin = data.invoices.find((i) => i.id === invoice.refundOfId);
    if (!origin || origin.status !== 'posted') {
      throw new LedgerError('INVALID_INVOICE', 'Nota kredit harus terkait dengan faktur/tagihan yang sudah diposting.');
    }
    const residual = invoiceResidual(origin, data);
    const total = invoiceTotals(invoice, data.taxes).total;
    if (total > residual) {
      throw new LedgerError(
        'REFUND_EXCEEDS_RESIDUAL',
        `Nota kredit ${formatRupiah(total)} melebihi sisa tagihan ${origin.number} sebesar ${formatRupiah(residual)}. Bila sudah lunas, kembalikan dana lewat pembayaran terpisah.`,
      );
    }
  }

  const journal = data.journals.find((j) => j.code === JOURNAL_CODE[invoice.kind]);
  if (!journal) throw new LedgerError('UNKNOWN_JOURNAL', `Jurnal ${JOURNAL_CODE[invoice.kind]} tidak ditemukan.`);
  const partner = data.partners.find((p) => p.id === invoice.partnerId)!;
  const counterpartAccountId = isSale(invoice.kind) ? partner.receivableAccountId : partner.payableAccountId;

  const number = nextSequenceNumber(NUMBER_PREFIX[invoice.kind], invoice.date, data.entries);
  const entry: JournalEntry = {
    id: opts.newId(),
    journalId: journal.id,
    number,
    date: invoice.date,
    reference: `${KIND_LABEL[invoice.kind]} ${partner.name}${invoice.reference ? ` (${invoice.reference})` : ''}`,
    status: 'posted',
    lines: buildInvoiceLines(invoice, data, counterpartAccountId, opts.newId),
    createdAt: opts.now,
    postedAt: opts.now,
    source: { type: 'invoice', id: invoice.id },
  };
  return {
    invoice: { ...invoice, status: 'posted', number, entryId: entry.id, counterpartAccountId, postedAt: opts.now },
    entry,
  };
}

/** Siapkan draft nota kredit dari dokumen asal: baris disalin, penjualan dialihkan ke akun Retur & Potongan. */
export function createRefundDraft(origin: Invoice, data: LedgerData, opts: { date: ISODate; now: string; newId: () => string }): Invoice {
  if (origin.status !== 'posted' || isRefund(origin.kind)) {
    throw new LedgerError('INVALID_INVOICE', 'Nota kredit hanya bisa dibuat dari faktur/tagihan yang sudah diposting.');
  }
  const returnAccount = data.accounts.find((a) => a.code === SALES_RETURN_ACCOUNT);
  const kind: InvoiceKind = origin.kind === 'out_invoice' ? 'out_refund' : 'in_refund';
  return {
    id: opts.newId(),
    kind,
    partnerId: origin.partnerId,
    number: null,
    date: opts.date,
    dueDate: opts.date,
    reference: `Koreksi ${origin.number}`,
    notes: '',
    lines: origin.lines.map((l) => ({
      ...l,
      id: opts.newId(),
      accountId: kind === 'out_refund' && returnAccount ? returnAccount.id : l.accountId,
    })),
    status: 'draft',
    refundOfId: origin.id,
    createdAt: opts.now,
  };
}

// ── Umur piutang/utang ───────────────────────────────────────────────

export const AGING_BUCKETS = ['Belum jatuh tempo', '1–30 hari', '31–60 hari', '61–90 hari', '> 90 hari'] as const;

export function agingBucket(dueDate: ISODate, asOf: ISODate): number {
  const late = daysBetween(dueDate, asOf);
  if (late <= 0) return 0;
  if (late <= 30) return 1;
  if (late <= 60) return 2;
  if (late <= 90) return 3;
  return 4;
}

export interface AgingRow {
  partner: Partner;
  buckets: Money[];
  total: Money;
  invoices: { invoice: Invoice; residual: Money; bucket: number }[];
}

/** Umur piutang (side='receivable') atau utang (side='payable') per tanggal tertentu. */
export function agingReport(data: LedgerData, side: 'receivable' | 'payable', asOf: ISODate) {
  const kind: InvoiceKind = side === 'receivable' ? 'out_invoice' : 'in_invoice';
  const rows = new Map<string, AgingRow>();
  for (const inv of data.invoices) {
    if (inv.kind !== kind || inv.status !== 'posted' || inv.date > asOf) continue;
    const residual = invoiceResidual(inv, data);
    if (residual <= 0) continue;
    const partner = data.partners.find((p) => p.id === inv.partnerId);
    if (!partner) continue;
    const row = rows.get(partner.id) ?? { partner, buckets: [0, 0, 0, 0, 0], total: 0, invoices: [] };
    const bucket = agingBucket(inv.dueDate, asOf);
    row.buckets[bucket] += residual;
    row.total += residual;
    row.invoices.push({ invoice: inv, residual, bucket });
    rows.set(partner.id, row);
  }
  const list = [...rows.values()].sort((a, b) => b.total - a.total);
  const totals = [0, 0, 0, 0, 0];
  for (const r of list) r.buckets.forEach((v, i) => (totals[i] += v));
  return { rows: list, totals, grandTotal: totals.reduce((s, v) => s + v, 0) };
}
