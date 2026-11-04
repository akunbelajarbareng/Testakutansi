/**
 * PAJAK (PPN) — Faktur Pajak Keluaran, penjualan eceran digunggung, PPN Masukan,
 * rekap & kompensasi SPT Masa PPN. Fungsi murni.
 */
import { LedgerError } from './errors';
import { assertNotLocked, isValidDate, nextEntryNumber, reverseEntry, type ValidationIssue } from './rules';
import { invoiceTotals, isRefund } from './invoicing';
import { monthEnd, shiftMonth } from './financials';
import type {
  Company,
  ISODate,
  Invoice,
  JournalEntry,
  LedgerData,
  Money,
  Partner,
  PpnPeriod,
  RetailRecap,
  Tax,
  TaxInvoice,
} from './types';
import { formatRupiah } from '../lib/format';

interface Opts {
  now: string;
  newId: () => string;
}

const digits = (s?: string) => (s ?? '').replace(/\D/g, '');
const acc = (data: LedgerData, code: string) => {
  const a = data.accounts.find((x) => x.code === code);
  if (!a) throw new LedgerError('UNKNOWN_ACCOUNT', `Akun ${code} tidak ditemukan.`);
  return a;
};
const generalJournal = (data: LedgerData) => {
  const j = data.journals.find((x) => x.type === 'general');
  if (!j) throw new LedgerError('UNKNOWN_JOURNAL', 'Jurnal Umum tidak ditemukan.');
  return j;
};
const inPeriod = (date: string, period: string) => date.startsWith(period);

/** Masa pajak jatuh tempo lapor & setor: akhir bulan berikutnya (PMK 81/2024). */
export const ppnDueDate = (period: string): ISODate => monthEnd(shiftMonth(period, 1));

// ── Identitas pajak ──────────────────────────────────────────────────

/** ID TKU bawaan = NPWP 16 digit + 000000 (kantor pusat). */
export const defaultNitku = (npwp?: string) => (digits(npwp).length === 16 ? `${digits(npwp)}000000` : '');

export function sellerTaxIssues(c: Company): string[] {
  const out: string[] = [];
  if (digits(c.npwp).length !== 16) out.push('NPWP perusahaan harus 16 digit (Pengaturan → Profil perusahaan).');
  const nitku = digits(c.nitku) || defaultNitku(c.npwp);
  if (nitku.length !== 22) out.push('ID TKU perusahaan harus 22 digit.');
  return out;
}

export function buyerTaxIssues(p: Partner): string[] {
  const out: string[] = [];
  const type = p.taxIdType ?? 'TIN';
  const id = digits(p.npwp);
  if ((type === 'TIN' || type === 'NIK') && id.length !== 16) {
    out.push(`${p.name}: ${type === 'TIN' ? 'NPWP' : 'NIK'} harus 16 digit.`);
  }
  if ((type === 'PASSPORT' || type === 'OTHER') && !p.npwp?.trim()) out.push(`${p.name}: isi nomor identitas.`);
  if (type === 'TIN') {
    const nitku = digits(p.nitku) || defaultNitku(p.npwp);
    if (nitku.length !== 22) out.push(`${p.name}: ID TKU harus 22 digit.`);
  }
  if (!p.address?.trim()) out.push(`${p.name}: alamat pembeli wajib diisi.`);
  return out;
}

// ── Faktur Pajak Keluaran ────────────────────────────────────────────

export interface TaxInvoiceGroup {
  key: string; // `${invoiceId}|${code}`
  invoice: Invoice;
  partner: Partner | undefined;
  code: string;
  taxes: Tax[];
  dpp: Money;
  dppOther: Money;
  ppn: Money;
  record?: TaxInvoice;
  /** Faktur sudah terbit tetapi kemudian ada nota kredit: perlu retur/pembetulan di Coretax. */
  needsCorrection: boolean;
}

export const taxInvoiceKey = (invoiceId: string, code: string) => `${invoiceId}|${code}`;

/** Pecah faktur penjualan menjadi Faktur Pajak per kode transaksi. */
export function invoiceTaxGroups(invoice: Invoice, data: LedgerData): Omit<TaxInvoiceGroup, 'record' | 'needsCorrection'>[] {
  const totals = invoiceTotals(invoice, data.taxes);
  const groups = new Map<string, { taxes: Tax[]; dpp: Money; dppOther: Money; ppn: Money }>();
  for (const t of totals.taxes) {
    const code = t.tax.coretaxCode ?? '04';
    const g = groups.get(code) ?? { taxes: [], dpp: 0, dppOther: 0, ppn: 0 };
    g.taxes.push(t.tax);
    g.dpp += t.base;
    g.dppOther += t.dpp;
    g.ppn += t.amount;
    groups.set(code, g);
  }
  const partner = data.partners.find((p) => p.id === invoice.partnerId);
  return [...groups].map(([code, g]) => ({ key: taxInvoiceKey(invoice.id, code), invoice, partner, code, ...g }));
}

export function outputTaxGroups(data: LedgerData, period: string): TaxInvoiceGroup[] {
  const out: TaxInvoiceGroup[] = [];
  for (const inv of data.invoices) {
    if (inv.kind !== 'out_invoice' || inv.status !== 'posted' || !inPeriod(inv.date, period)) continue;
    const refunded = data.invoices.some((r) => r.refundOfId === inv.id && r.status === 'posted');
    for (const g of invoiceTaxGroups(inv, data)) {
      const record = data.taxInvoices.find((t) => t.invoiceId === inv.id && t.transactionCode === g.code && t.status !== 'cancelled');
      out.push({ ...g, record, needsCorrection: !!record && record.status === 'issued' && refunded });
    }
  }
  return out.sort((a, b) => a.invoice.date.localeCompare(b.invoice.date) || (a.invoice.number ?? '').localeCompare(b.invoice.number ?? ''));
}

/** Validasi sebelum ekspor: identitas penjual & pembeli, keterangan tambahan untuk kode 07/08. */
export function exportIssues(groups: TaxInvoiceGroup[], data: LedgerData): ValidationIssue[] {
  const issues: ValidationIssue[] = sellerTaxIssues(data.company).map((m) => ({ code: 'INVALID_TAX_ID', message: m }));
  const seen = new Set<string>();
  for (const g of groups) {
    if (g.partner && !seen.has(g.partner.id)) {
      seen.add(g.partner.id);
      for (const m of buyerTaxIssues(g.partner)) issues.push({ code: 'INVALID_TAX_ID', message: m });
    }
    if ((g.code === '07' || g.code === '08') && g.taxes.some((t) => !t.coretaxAdditionalInfo?.trim())) {
      const msg = `Kode transaksi ${g.code} memerlukan keterangan tambahan/cap fasilitas. Isi di Pengaturan → Pajak (konfirmasi ke konsultan).`;
      if (!issues.some((i) => i.message === msg)) issues.push({ code: 'INVALID_TAX', message: msg });
    }
  }
  return issues;
}

export function markExported(groups: TaxInvoiceGroup[], batchId: string, opts: Opts): TaxInvoice[] {
  return groups.map((g) => ({
    id: opts.newId(),
    invoiceId: g.invoice.id,
    transactionCode: g.code,
    dpp: g.dpp,
    dppOther: g.dppOther,
    ppn: g.ppn,
    status: 'exported' as const,
    exportBatchId: batchId,
    notes: '',
    createdAt: opts.now,
  }));
}

/** Catat nomor Faktur Pajak yang terbit di Coretax. */
export function recordTaxNumber(record: TaxInvoice, taxNumber: string, issuedDate: ISODate, data: LedgerData): TaxInvoice {
  const n = digits(taxNumber);
  if (n.length < 13 || n.length > 20) throw new LedgerError('INVALID_TAX', 'Nomor Faktur Pajak tidak valid (salin dari Coretax).');
  if (!isValidDate(issuedDate)) throw new LedgerError('INVALID_DATE', 'Tanggal terbit tidak valid.');
  if (data.taxInvoices.some((t) => t.id !== record.id && t.status !== 'cancelled' && digits(t.taxNumber) === n)) {
    throw new LedgerError('INVALID_TAX', 'Nomor Faktur Pajak ini sudah dipakai di faktur lain.');
  }
  return { ...record, status: 'issued', taxNumber: n, issuedDate };
}

// ── Penjualan eceran (digunggung) ────────────────────────────────────

/** PPN dari harga termasuk pajak: PPN = bruto × (tarif × num/den) / (100 + tarif × num/den). */
export function splitInclusive(gross: Money, tax: Pick<Tax, 'rate' | 'dppNumerator' | 'dppDenominator'>): { dpp: Money; ppn: Money } {
  const eff = tax.rate * tax.dppNumerator; // dibagi penyebut di kedua sisi
  const ppn = Math.round((gross * eff) / (100 * tax.dppDenominator + eff));
  return { dpp: gross - ppn, ppn };
}

export const standardPpnTax = (data: LedgerData) => {
  const t = data.taxes.find((x) => x.active && x.rate > 0);
  if (!t) throw new LedgerError('INVALID_TAX', 'Pajak PPN aktif tidak ditemukan.');
  return t;
};

export function postRetailRecap(
  input: { date: ISODate; cashJournalId: string; cash: Money; nonCash: Money; exemptGross: Money; notes: string },
  data: LedgerData,
  opts: Opts,
): { recap: RetailRecap; entry: JournalEntry } {
  if (!data.company.retailTrader) throw new LedgerError('INVALID_TAX', 'Rekap digunggung hanya untuk PKP Pedagang Eceran (aktifkan di Pengaturan bila sudah terdaftar).');
  if (!isValidDate(input.date)) throw new LedgerError('INVALID_DATE', 'Tanggal tidak valid.');
  for (const v of [input.cash, input.nonCash, input.exemptGross]) {
    if (!Number.isInteger(v) || v < 0) throw new LedgerError('INVALID_TAX', 'Nominal harus bilangan bulat, tidak negatif.');
  }
  const gross = input.cash + input.nonCash;
  if (gross <= 0) throw new LedgerError('INVALID_TAX', 'Isi total penjualan tunai dan/atau QRIS/EDC.');
  if (input.exemptGross > gross) throw new LedgerError('INVALID_TAX', 'Penjualan barang bebas PPN tidak boleh melebihi total penjualan.');
  const journal = data.journals.find((j) => j.id === input.cashJournalId && j.type === 'cash' && j.defaultAccountId);
  if (!journal) throw new LedgerError('UNKNOWN_JOURNAL', 'Pilih rekening kas toko.');
  if (data.retailRecaps.some((r) => r.status === 'posted' && r.date === input.date && r.cashJournalId === journal.id)) {
    throw new LedgerError('INVALID_TAX', `Rekap ${journal.name} tanggal ${input.date} sudah ada. Batalkan dulu bila ingin membuat ulang.`);
  }
  assertNotLocked(input.date, data);

  const tax = standardPpnTax(data);
  const { dpp, ppn } = splitInclusive(gross - input.exemptGross, tax);
  const recapId = opts.newId();
  const label = `Rekap penjualan eceran ${journal.name} ${input.date}`;
  const lines = [
    { accountId: journal.defaultAccountId!, label: 'Penjualan tunai', debit: input.cash, credit: 0 },
    { accountId: acc(data, '1112').id, label: 'Penjualan QRIS/EDC, menunggu pencairan', debit: input.nonCash, credit: 0 },
    { accountId: acc(data, '4101').id, label: 'Penjualan retail (tanpa PPN)', debit: 0, credit: dpp + input.exemptGross },
    { accountId: tax.salesAccountId, label: `PPN Keluaran digunggung`, debit: 0, credit: ppn },
  ].filter((l) => l.debit || l.credit);
  const entry: JournalEntry = {
    id: opts.newId(),
    journalId: journal.id,
    number: nextEntryNumber(journal, input.date, data.entries),
    date: input.date,
    reference: label,
    status: 'posted',
    lines: lines.map((l) => ({ id: opts.newId(), ...l })),
    createdAt: opts.now,
    postedAt: opts.now,
    source: { type: 'retail_recap', id: recapId },
  };
  return {
    recap: { id: recapId, date: input.date, cashJournalId: journal.id, cash: input.cash, nonCash: input.nonCash, exemptGross: input.exemptGross, dpp, ppn, entryId: entry.id, status: 'posted', notes: input.notes, createdAt: opts.now },
    entry,
  };
}

export function cancelRetailRecap(recap: RetailRecap, data: LedgerData, opts: Opts) {
  if (recap.status !== 'posted') throw new LedgerError('INVALID_TAX', 'Rekap ini sudah dibatalkan.');
  const e = data.entries.find((x) => x.id === recap.entryId);
  if (!e) throw new LedgerError('INVALID_TAX', 'Jurnal rekap tidak ditemukan.');
  const { original, reversal } = reverseEntry(e, data, { ...opts, date: recap.date, allowSourceDocument: true });
  return { recap: { ...recap, status: 'cancelled' as const, cancelEntryId: reversal.id }, original, reversal: { ...reversal, source: e.source } };
}

export function retailSummary(data: LedgerData, period: string) {
  const rows = data.retailRecaps.filter((r) => r.status === 'posted' && inPeriod(r.date, period));
  return {
    rows,
    gross: rows.reduce((s, r) => s + r.cash + r.nonCash, 0),
    exempt: rows.reduce((s, r) => s + r.exemptGross, 0),
    dpp: rows.reduce((s, r) => s + r.dpp, 0),
    ppn: rows.reduce((s, r) => s + r.ppn, 0),
  };
}

// ── PPN Masukan ──────────────────────────────────────────────────────

export const creditPeriodOf = (bill: Invoice) => bill.creditPeriod ?? (bill.supplierTaxInvoiceDate ?? bill.date).slice(0, 7);

/** Masa pengkreditan sah: masa faktur pajak s.d. 3 masa sesudahnya (PMK 81/2024 Pasal 376). */
export function validateCreditPeriod(bill: Pick<Invoice, 'date' | 'supplierTaxInvoiceDate'>, period: string): string | null {
  const base = (bill.supplierTaxInvoiceDate ?? bill.date).slice(0, 7);
  if (period < base) return 'Masa pengkreditan tidak boleh sebelum masa Faktur Pajak.';
  if (period > shiftMonth(base, 3)) return 'PPN Masukan paling lambat dikreditkan 3 masa setelah masa Faktur Pajak.';
  return null;
}

export interface InputTaxRow {
  bill: Invoice;
  partner: Partner | undefined;
  dpp: Money;
  ppn: Money; // negatif untuk nota kredit pembelian
  creditPeriod: string;
  missingTaxNumber: boolean;
}

export function inputTaxRows(data: LedgerData, period: string): InputTaxRow[] {
  return data.invoices
    .filter((i) => (i.kind === 'in_invoice' || i.kind === 'in_refund') && i.status === 'posted')
    .map((bill) => {
      const t = invoiceTotals(bill, data.taxes);
      const sign = isRefund(bill.kind) ? -1 : 1;
      const origin = bill.refundOfId ? data.invoices.find((x) => x.id === bill.refundOfId) : undefined;
      const cp = isRefund(bill.kind) ? bill.date.slice(0, 7) : creditPeriodOf(bill);
      return {
        bill,
        partner: data.partners.find((p) => p.id === bill.partnerId),
        dpp: sign * t.taxes.filter((x) => x.amount > 0).reduce((s, x) => s + x.dpp, 0),
        ppn: sign * t.tax,
        creditPeriod: cp,
        missingTaxNumber: t.tax > 0 && !isRefund(bill.kind) && !bill.supplierTaxInvoiceNumber && !origin,
      };
    })
    .filter((r) => r.ppn !== 0 && r.creditPeriod === period);
}

// ── Cocokkan PPN Masukan dengan Coretax ──────────────────────────────

export interface CoretaxInputRow {
  sellerNpwp: string;
  sellerName: string;
  taxNumber: string;
  taxDate: string;
  dpp: Money;
  ppn: Money;
}

/** CSV dari daftar PPN Masukan Coretax. Header: npwp_penjual,nama_penjual,nomor_faktur,tanggal_faktur,dpp,ppn */
export function parseCoretaxInputCsv(text: string): { rows: CoretaxInputRow[]; errors: string[] } {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  const errors: string[] = [];
  if (!lines.length) return { rows: [], errors: ['File kosong.'] };
  const sep = lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
  const head = lines[0].split(sep).map((h) => h.trim().toLowerCase());
  const idx = (n: string) => head.indexOf(n);
  const need = ['npwp_penjual', 'nomor_faktur', 'ppn'];
  const missing = need.filter((n) => idx(n) < 0);
  if (missing.length) return { rows: [], errors: [`Kolom wajib tidak ditemukan: ${missing.join(', ')}.`] };
  const num = (v: string) => Math.round(Number.parseFloat((v ?? '').replace(/[^\d.-]/g, '')) || 0);
  const rows = lines.slice(1).map((l, i) => {
    const c = l.split(sep).map((x) => x.trim().replace(/^"|"$/g, ''));
    const r = {
      sellerNpwp: digits(c[idx('npwp_penjual')]),
      sellerName: idx('nama_penjual') >= 0 ? c[idx('nama_penjual')] : '',
      taxNumber: digits(c[idx('nomor_faktur')]),
      taxDate: idx('tanggal_faktur') >= 0 ? c[idx('tanggal_faktur')] : '',
      dpp: idx('dpp') >= 0 ? num(c[idx('dpp')]) : 0,
      ppn: num(c[idx('ppn')]),
    };
    if (!r.taxNumber) errors.push(`Baris ${i + 2}: nomor faktur kosong.`);
    return r;
  });
  return { rows: rows.filter((r) => r.taxNumber), errors };
}

export type InputMatchStatus = 'matched' | 'amount_mismatch' | 'only_coretax' | 'only_book';

export interface InputMatch {
  status: InputMatchStatus;
  coretax?: CoretaxInputRow;
  book?: InputTaxRow;
  note: string;
}

export function matchCoretaxInput(coretax: CoretaxInputRow[], data: LedgerData, period: string): InputMatch[] {
  const book = inputTaxRows(data, period).filter((r) => r.ppn > 0);
  const used = new Set<string>();
  const out: InputMatch[] = [];
  for (const c of coretax) {
    let hit = book.find((b) => !used.has(b.bill.id) && digits(b.bill.supplierTaxInvoiceNumber) === c.taxNumber);
    let byNumber = !!hit;
    if (!hit) {
      hit = book.find((b) => !used.has(b.bill.id) && digits(b.partner?.npwp) === c.sellerNpwp && b.ppn === c.ppn);
      byNumber = false;
    }
    if (!hit) {
      out.push({ status: 'only_coretax', coretax: c, note: 'Ada di Coretax tetapi belum dicatat (atau belum diberi nomor Faktur Pajak) di tagihan vendor.' });
      continue;
    }
    used.add(hit.bill.id);
    if (hit.ppn !== c.ppn) {
      out.push({ status: 'amount_mismatch', coretax: c, book: hit, note: `PPN di buku ${formatRupiah(hit.ppn)}, di Coretax ${formatRupiah(c.ppn)}.` });
    } else {
      out.push({ status: 'matched', coretax: c, book: hit, note: byNumber ? 'Cocok berdasarkan nomor Faktur Pajak.' : 'Cocok berdasarkan NPWP supplier dan nominal; lengkapi nomor Faktur Pajak di tagihan.' });
    }
  }
  for (const b of book) {
    if (!used.has(b.bill.id)) out.push({ status: 'only_book', book: b, note: 'Dicatat di buku tetapi tidak ada di daftar Coretax. Minta supplier menerbitkan Faktur Pajak, atau geser masa pengkreditan.' });
  }
  return out;
}

// ── Rekap SPT Masa PPN & kompensasi ──────────────────────────────────

export interface PpnSummary {
  period: string;
  dueDate: ISODate;
  /** PPN Keluaran dari Faktur Pajak (faktur penjualan − nota kredit). */
  outputInvoices: Money;
  outputRetail: Money;
  outputTax: Money;
  inputTax: Money;
  priorCredit: Money;
  /** Positif = kurang bayar, negatif = lebih bayar. */
  net: Money;
  /** Cek ke buku: mutasi kredit bersih 2201 di masa ini (di luar jurnal kompensasi). */
  glOutput: Money;
  glMatches: boolean;
  record?: PpnPeriod;
}

export function ppnSummary(data: LedgerData, period: string): PpnSummary {
  let outputInvoices = 0;
  for (const i of data.invoices) {
    if (i.status !== 'posted' || !inPeriod(i.date, period)) continue;
    if (i.kind === 'out_invoice') outputInvoices += invoiceTotals(i, data.taxes).tax;
    if (i.kind === 'out_refund') outputInvoices -= invoiceTotals(i, data.taxes).tax;
  }
  const outputRetail = retailSummary(data, period).ppn;
  const inputTax = inputTaxRows(data, period).reduce((s, r) => s + r.ppn, 0);

  const record = data.ppnPeriods.find((p) => p.period === period && p.status !== 'cancelled');
  // Lebih bayar yang belum dikompensasikan = saldo 1404 sebelum jurnal kompensasi masa ini.
  const lb = data.accounts.find((a) => a.code === '1404');
  let priorCredit = 0;
  if (lb) {
    for (const e of data.entries) {
      if (e.status === 'draft' || e.date > monthEnd(period)) continue;
      if (record && (e.id === record.settlementEntryId || e.reversalOfId === record.settlementEntryId)) continue;
      for (const l of e.lines) if (l.accountId === lb.id) priorCredit += l.debit - l.credit;
    }
  }
  priorCredit = Math.max(0, priorCredit);

  const ppnOut = data.taxes.map((t) => t.salesAccountId);
  let glOutput = 0;
  for (const e of data.entries) {
    if (e.status === 'draft' || !inPeriod(e.date, period) || e.source?.type === 'ppn_settlement') continue;
    for (const l of e.lines) if (ppnOut.includes(l.accountId)) glOutput += l.credit - l.debit;
  }
  const outputTax = outputInvoices + outputRetail;
  return {
    period,
    dueDate: ppnDueDate(period),
    outputInvoices,
    outputRetail,
    outputTax,
    inputTax,
    priorCredit,
    net: outputTax - inputTax - priorCredit,
    glOutput,
    glMatches: glOutput === outputTax,
    record,
  };
}

/** Jurnal kompensasi akhir masa: Debit PPN Keluaran, Kredit PPN Masukan & lebih bayar lalu, sisanya Utang PPN / PPN Lebih Bayar. */
export function settlePpnPeriod(period: string, data: LedgerData, opts: Opts): { record: PpnPeriod; entry: JournalEntry } {
  if (data.ppnPeriods.some((p) => p.period === period && p.status !== 'cancelled')) {
    throw new LedgerError('INVALID_PERIOD', `PPN masa ${period} sudah dikompensasi.`);
  }
  const s = ppnSummary(data, period);
  if (!s.glMatches) {
    throw new LedgerError('INVALID_TAX', `PPN Keluaran di buku (${formatRupiah(s.glOutput)}) tidak sama dengan rekap (${formatRupiah(s.outputTax)}). Periksa jurnal manual ke akun PPN Keluaran.`);
  }
  if (s.outputTax === 0 && s.inputTax === 0) throw new LedgerError('INVALID_TAX', 'Tidak ada PPN di masa ini.');
  const date = monthEnd(period);
  assertNotLocked(date, data);
  const tax = standardPpnTax(data);
  const label = `Kompensasi PPN masa ${period}`;
  const lines = [
    { accountId: tax.salesAccountId, label: 'PPN Keluaran', debit: s.outputTax, credit: 0 },
    { accountId: tax.purchaseAccountId, label: 'PPN Masukan dikreditkan', debit: 0, credit: s.inputTax },
    { accountId: acc(data, '1404').id, label: 'Kompensasi lebih bayar masa lalu', debit: 0, credit: s.priorCredit },
    s.net >= 0
      ? { accountId: acc(data, '2204').id, label: 'PPN kurang bayar', debit: 0, credit: s.net }
      : { accountId: acc(data, '1404').id, label: 'PPN lebih bayar', debit: -s.net, credit: 0 },
  ]
    .map((l) => (l.debit < 0 || l.credit < 0 ? { ...l, debit: Math.max(0, -l.credit, l.debit), credit: Math.max(0, -l.debit, l.credit) } : l))
    .filter((l) => l.debit || l.credit);
  const journal = generalJournal(data);
  const recordId = opts.newId();
  const entry: JournalEntry = {
    id: opts.newId(),
    journalId: journal.id,
    number: nextEntryNumber(journal, date, data.entries),
    date,
    reference: label,
    status: 'posted',
    lines: lines.map((l) => ({ id: opts.newId(), ...l })),
    createdAt: opts.now,
    postedAt: opts.now,
    source: { type: 'ppn_settlement', id: recordId },
  };
  return {
    record: { id: recordId, period, outputTax: s.outputTax, inputTax: s.inputTax, priorCredit: s.priorCredit, net: s.net, settlementEntryId: entry.id, status: 'settled', createdAt: opts.now },
    entry,
  };
}

export function cancelPpnSettlement(record: PpnPeriod, data: LedgerData, opts: Opts) {
  if (record.status !== 'settled') throw new LedgerError('INVALID_TAX', record.status === 'paid' ? 'PPN masa ini sudah disetor; tidak bisa dibatalkan.' : 'Kompensasi sudah dibatalkan.');
  const e = data.entries.find((x) => x.id === record.settlementEntryId);
  if (!e) throw new LedgerError('INVALID_TAX', 'Jurnal kompensasi tidak ditemukan.');
  const { original, reversal } = reverseEntry(e, data, { ...opts, date: e.date, allowSourceDocument: true });
  return { record: { ...record, status: 'cancelled' as const }, original, reversal: { ...reversal, source: e.source } };
}

/** Setor PPN kurang bayar: Debit Utang PPN, Kredit bank. */
export function payPpn(record: PpnPeriod, input: { journalId: string; date: ISODate; ntpn: string }, data: LedgerData, opts: Opts): { record: PpnPeriod; entry: JournalEntry } {
  if (record.status !== 'settled') throw new LedgerError('INVALID_TAX', 'Hanya masa yang sudah dikompensasi dan belum disetor.');
  if (record.net <= 0) throw new LedgerError('INVALID_TAX', 'Masa ini lebih bayar atau nihil; tidak ada yang disetor.');
  if (!/^[A-Z0-9]{16}$/i.test(input.ntpn.trim())) throw new LedgerError('INVALID_TAX', 'NTPN terdiri dari 16 karakter huruf/angka.');
  if (!isValidDate(input.date)) throw new LedgerError('INVALID_DATE', 'Tanggal setor tidak valid.');
  const journal = data.journals.find((j) => j.id === input.journalId && (j.type === 'bank' || j.type === 'cash') && j.defaultAccountId);
  if (!journal) throw new LedgerError('UNKNOWN_JOURNAL', 'Pilih rekening pembayar.');
  assertNotLocked(input.date, data);
  const label = `Setor PPN masa ${record.period}, NTPN ${input.ntpn.trim().toUpperCase()}`;
  const entry: JournalEntry = {
    id: opts.newId(),
    journalId: journal.id,
    number: nextEntryNumber(journal, input.date, data.entries),
    date: input.date,
    reference: label,
    status: 'posted',
    lines: [
      { id: opts.newId(), accountId: acc(data, '2204').id, label, debit: record.net, credit: 0 },
      { id: opts.newId(), accountId: journal.defaultAccountId!, label, debit: 0, credit: record.net },
    ],
    createdAt: opts.now,
    postedAt: opts.now,
    source: { type: 'ppn_payment', id: record.id },
  };
  return { record: { ...record, status: 'paid', paymentEntryId: entry.id, ntpn: input.ntpn.trim().toUpperCase(), paidDate: input.date }, entry };
}
