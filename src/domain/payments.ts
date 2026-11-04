/**
 * PEMBAYARAN — penerimaan dari pelanggan (inbound) dan pembayaran ke supplier (outbound).
 * Satu pembayaran bisa dialokasikan ke beberapa dokumen; kelebihan bayar dicatat sebagai
 * deposit pelanggan (2301) atau uang muka pembelian (1402).
 */
import { LedgerError } from './errors';
import { assertNotLocked, isValidDate, nextEntryNumber, reverseEntry, type ValidationIssue } from './rules';
import { CUSTOMER_DEPOSIT_ACCOUNT, SUPPLIER_ADVANCE_ACCOUNT, invoiceResidual } from './invoicing';
import type { ISODate, JournalEntry, JournalLine, LedgerData, Payment } from './types';
import { formatRupiah } from '../lib/format';

export type PaymentDraft = Omit<Payment, 'number' | 'status' | 'entryId' | 'cancelEntryId' | 'createdAt'>;

export function validatePayment(p: PaymentDraft, data: LedgerData): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!data.partners.some((x) => x.id === p.partnerId)) issues.push({ code: 'UNKNOWN_PARTNER', message: 'Pilih kontak.' });
  if (!isValidDate(p.date)) issues.push({ code: 'INVALID_DATE', message: 'Tanggal pembayaran tidak valid.' });
  const journal = data.journals.find((j) => j.id === p.journalId);
  if (!journal || !journal.defaultAccountId || (journal.type !== 'bank' && journal.type !== 'cash')) {
    issues.push({ code: 'INVALID_PAYMENT', message: 'Pilih jurnal kas atau bank.' });
  }
  if (!Number.isInteger(p.amount) || p.amount <= 0) {
    issues.push({ code: 'INVALID_PAYMENT', message: 'Jumlah pembayaran harus lebih dari 0.' });
  }

  const expectedKind = p.direction === 'inbound' ? 'out_invoice' : 'in_invoice';
  let allocated = 0;
  const seen = new Set<string>();
  for (const a of p.allocations) {
    const inv = data.invoices.find((i) => i.id === a.invoiceId);
    if (!inv || inv.kind !== expectedKind || inv.status !== 'posted' || inv.partnerId !== p.partnerId) {
      issues.push({ code: 'INVALID_PAYMENT', message: 'Alokasi hanya ke faktur/tagihan diposting milik kontak yang sama.' });
      continue;
    }
    if (seen.has(inv.id)) issues.push({ code: 'INVALID_PAYMENT', message: `${inv.number} dialokasikan lebih dari sekali.` });
    seen.add(inv.id);
    if (!Number.isInteger(a.amount) || a.amount <= 0) {
      issues.push({ code: 'INVALID_PAYMENT', message: `Alokasi ke ${inv.number} harus lebih dari 0.` });
    }
    const residual = invoiceResidual(inv, data);
    if (a.amount > residual) {
      issues.push({
        code: 'ALLOCATION_EXCEEDS_RESIDUAL',
        message: `Alokasi ke ${inv.number} (${formatRupiah(a.amount)}) melebihi sisa tagihan ${formatRupiah(residual)}.`,
      });
    }
    allocated += a.amount;
  }
  if (allocated > p.amount) {
    issues.push({ code: 'INVALID_PAYMENT', message: `Total alokasi ${formatRupiah(allocated)} melebihi jumlah pembayaran ${formatRupiah(p.amount)}.` });
  }
  return issues;
}

/** Alokasi otomatis ke dokumen tertua lebih dulu (FIFO berdasarkan jatuh tempo). */
export function autoAllocate(p: Pick<PaymentDraft, 'direction' | 'partnerId' | 'amount'>, data: LedgerData) {
  const kind = p.direction === 'inbound' ? 'out_invoice' : 'in_invoice';
  let remaining = p.amount;
  const allocations: { invoiceId: string; amount: number }[] = [];
  const open = data.invoices
    .filter((i) => i.kind === kind && i.status === 'posted' && i.partnerId === p.partnerId)
    .map((i) => ({ i, residual: invoiceResidual(i, data) }))
    .filter((x) => x.residual > 0)
    .sort((a, b) => a.i.dueDate.localeCompare(b.i.dueDate) || (a.i.number ?? '').localeCompare(b.i.number ?? ''));
  for (const { i, residual } of open) {
    if (remaining <= 0) break;
    const amount = Math.min(remaining, residual);
    allocations.push({ invoiceId: i.id, amount });
    remaining -= amount;
  }
  return allocations;
}

export function postPayment(
  draft: PaymentDraft,
  data: LedgerData,
  opts: { now: string; newId: () => string },
): { payment: Payment; entry: JournalEntry } {
  const issues = validatePayment(draft, data);
  if (issues.length) throw new LedgerError(issues[0].code, issues.map((i) => i.message).join(' '));
  assertNotLocked(draft.date, data);

  const journal = data.journals.find((j) => j.id === draft.journalId)!;
  const partner = data.partners.find((x) => x.id === draft.partnerId)!;
  const inbound = draft.direction === 'inbound';
  const number = nextEntryNumber(journal, draft.date, data.entries);

  // Sisi kontak: piutang/utang per dokumen, sisanya ke deposit/uang muka.
  const counterpart = new Map<string, number>();
  let allocated = 0;
  for (const a of draft.allocations) {
    const inv = data.invoices.find((i) => i.id === a.invoiceId)!;
    const acc = inv.counterpartAccountId ?? (inbound ? partner.receivableAccountId : partner.payableAccountId);
    counterpart.set(acc, (counterpart.get(acc) ?? 0) + a.amount);
    allocated += a.amount;
  }
  const excess = draft.amount - allocated;
  if (excess > 0) {
    const code = inbound ? CUSTOMER_DEPOSIT_ACCOUNT : SUPPLIER_ADVANCE_ACCOUNT;
    const acc = data.accounts.find((a) => a.code === code);
    if (!acc) throw new LedgerError('UNKNOWN_ACCOUNT', `Akun ${code} untuk kelebihan bayar tidak ditemukan.`);
    counterpart.set(acc.id, (counterpart.get(acc.id) ?? 0) + excess);
  }

  const label = draft.memo || `${inbound ? 'Penerimaan dari' : 'Pembayaran ke'} ${partner.name}`;
  const lines: JournalLine[] = [
    {
      id: opts.newId(),
      accountId: journal.defaultAccountId!,
      label,
      debit: inbound ? draft.amount : 0,
      credit: inbound ? 0 : draft.amount,
    },
    ...[...counterpart].map(([accountId, amount]) => ({
      id: opts.newId(),
      accountId,
      label,
      debit: inbound ? 0 : amount,
      credit: inbound ? amount : 0,
    })),
  ];

  const paymentId = draft.id;
  const entry: JournalEntry = {
    id: opts.newId(),
    journalId: journal.id,
    number,
    date: draft.date,
    reference: label,
    status: 'posted',
    lines,
    createdAt: opts.now,
    postedAt: opts.now,
    source: { type: 'payment', id: paymentId },
  };
  const payment: Payment = {
    ...draft,
    id: paymentId,
    number,
    status: 'posted',
    entryId: entry.id,
    createdAt: opts.now,
  };
  return { payment, entry };
}

/** Batalkan pembayaran: entrinya dibalik, alokasi tidak lagi dihitung sehingga faktur kembali terbuka. */
export function cancelPayment(
  payment: Payment,
  data: LedgerData,
  opts: { date: ISODate; now: string; newId: () => string },
): { payment: Payment; original: JournalEntry; reversal: JournalEntry } {
  if (payment.status === 'cancelled') throw new LedgerError('ALREADY_CANCELLED', `Pembayaran ${payment.number} sudah dibatalkan.`);
  const entry = data.entries.find((e) => e.id === payment.entryId);
  if (!entry) throw new LedgerError('INVALID_PAYMENT', 'Entri jurnal pembayaran tidak ditemukan.');
  const { original, reversal } = reverseEntry(entry, data, { ...opts, allowSourceDocument: true });
  const reversalWithSource: JournalEntry = { ...reversal, source: { type: 'payment', id: payment.id } };
  return {
    payment: { ...payment, status: 'cancelled', cancelEntryId: reversal.id },
    original,
    reversal: reversalWithSource,
  };
}
