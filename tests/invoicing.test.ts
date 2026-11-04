/**
 * Mini App 2 — 6 skenario uji Faktur, Tagihan, Nota Kredit, Pembayaran.
 * Jalankan: npm test
 */
import { describe, expect, it } from 'vitest';
import {
  LedgerError,
  agingReport,
  autoAllocate,
  cancelPayment,
  createRefundDraft,
  creditCheck,
  invoiceResidual,
  invoiceTotals,
  paymentState,
  postInvoice,
  postPayment,
  reverseEntry,
  trialBalance,
  type Invoice,
  type InvoiceKind,
  type LedgerData,
} from '../src/domain';
import { TAX_EXEMPT, TAX_PPN, accountId, createDemoData, createEmptyData, journalId, partnerId } from '../src/data/seed';

const NOW = '2026-11-04T08:00:00.000Z';
let seq = 0;
const newId = () => `t-${++seq}`;
const opts = { now: NOW, newId };

function draftInvoice(kind: InvoiceKind, partner: string, date: string, lines: [string, number, number, string][], due = date): Invoice {
  return {
    id: newId(),
    kind,
    partnerId: partnerId(partner),
    number: null,
    date,
    dueDate: due,
    reference: '',
    notes: '',
    lines: lines.map(([code, quantity, unitPrice, taxId]) => ({ id: newId(), description: 'Barang', accountId: accountId(code), quantity, unitPrice, taxId })),
    status: 'draft',
    createdAt: NOW,
  };
}

function post(data: LedgerData, inv: Invoice): Invoice {
  const res = postInvoice(inv, data, opts);
  data.invoices.push(res.invoice);
  data.entries.push(res.entry);
  return res.invoice;
}

function pay(data: LedgerData, inv: Invoice, amount: number, date = '2026-11-10') {
  const res = postPayment(
    {
      id: newId(),
      direction: inv.kind === 'out_invoice' ? 'inbound' : 'outbound',
      partnerId: inv.partnerId,
      date,
      journalId: journalId('BNK'),
      amount,
      memo: '',
      allocations: [{ invoiceId: inv.id, amount }],
    },
    data,
    opts,
  );
  data.payments.push(res.payment);
  data.entries.push(res.entry);
  return res.payment;
}

function balance(data: LedgerData, code: string) {
  const row = trialBalance(data, {}).rows.find((r) => r.account.code === code);
  return row ? row.closing.debit - row.closing.credit : 0;
}

describe('Skenario 1 — faktur grosir + PPN diposting ke buku besar', () => {
  it('menghitung DPP 11/12 dan menjurnal piutang, pendapatan, PPN keluaran', () => {
    const data = createEmptyData();
    const inv = post(data, draftInvoice('out_invoice', 'sinar-jaya', '2026-11-03', [['4103', 1, 10_000_000, TAX_PPN]]));

    const t = invoiceTotals(inv, data.taxes);
    expect(t.taxes[0].dpp).toBe(9_166_667);
    expect(t.tax).toBe(1_100_000);
    expect(t.total).toBe(11_100_000);
    expect(inv.number).toBe('PJ/2026/11/0001');

    expect(balance(data, '1201')).toBe(11_100_000);
    expect(balance(data, '4103')).toBe(-10_000_000);
    expect(balance(data, '2201')).toBe(-1_100_000);
    expect(trialBalance(data, {}).balanced).toBe(true);
  });

  it('barang dibebaskan PPN tidak menghasilkan baris pajak', () => {
    const data = createEmptyData();
    const inv = post(data, draftInvoice('out_invoice', 'sinar-jaya', '2026-11-03', [['4103', 10, 780_000, TAX_EXEMPT]]));
    expect(invoiceTotals(inv, data.taxes).tax).toBe(0);
    expect(data.entries[0].lines).toHaveLength(2);
  });
});

describe('Skenario 2 — pembayaran sebagian lalu pelunasan', () => {
  it('status berubah Belum dibayar → Sebagian → Lunas', () => {
    const data = createEmptyData();
    const inv = post(data, draftInvoice('out_invoice', 'daeng', '2026-11-01', [['4102', 1, 10_000_000, TAX_EXEMPT]]));
    expect(paymentState(inv, data)).toBe('unpaid');
    pay(data, inv, 4_000_000);
    expect(paymentState(inv, data)).toBe('partial');
    expect(invoiceResidual(inv, data)).toBe(6_000_000);
    pay(data, inv, 6_000_000);
    expect(paymentState(inv, data)).toBe('paid');
    expect(balance(data, '1202')).toBe(0);
    expect(balance(data, '1111')).toBe(10_000_000);
  });

  it('kelebihan bayar masuk deposit pelanggan, alokasi melebihi sisa ditolak', () => {
    const data = createEmptyData();
    const inv = post(data, draftInvoice('out_invoice', 'daeng', '2026-11-01', [['4102', 1, 1_000_000, TAX_EXEMPT]]));
    const res = postPayment(
      { id: newId(), direction: 'inbound', partnerId: inv.partnerId, date: '2026-11-02', journalId: journalId('KAS'), amount: 1_200_000, memo: '', allocations: autoAllocate({ direction: 'inbound', partnerId: inv.partnerId, amount: 1_200_000 }, data) },
      data,
      opts,
    );
    data.payments.push(res.payment);
    data.entries.push(res.entry);
    expect(balance(data, '2301')).toBe(-200_000);
    expect(() => pay(data, inv, 1)).toThrowError(LedgerError);
  });

  it('pembatalan pembayaran membuka kembali faktur', () => {
    const data = createEmptyData();
    const inv = post(data, draftInvoice('out_invoice', 'daeng', '2026-11-01', [['4102', 1, 500_000, TAX_EXEMPT]]));
    const p = pay(data, inv, 500_000);
    const res = cancelPayment(p, data, { date: '2026-11-11', ...opts });
    data.payments = data.payments.map((x) => (x.id === p.id ? res.payment : x));
    data.entries = data.entries.map((e) => (e.id === res.original.id ? res.original : e)).concat(res.reversal);
    expect(paymentState(inv, data)).toBe('unpaid');
    expect(balance(data, '1111')).toBe(0);
  });
});

describe('Skenario 3 — nota kredit', () => {
  it('mengurangi sisa tagihan dan menolak bila melebihi sisa', () => {
    const data = createEmptyData();
    const inv = post(data, draftInvoice('out_invoice', 'sinar-jaya', '2026-11-03', [['4103', 10, 300_000, TAX_PPN]]));
    const total = invoiceTotals(inv, data.taxes).total; // 3.330.000

    const refund = createRefundDraft(inv, data, { date: '2026-11-05', ...opts });
    expect(refund.lines[0].accountId).toBe(accountId('4201'));
    refund.lines[0].quantity = 2; // retur 2 jeriken
    const posted = post(data, refund);
    expect(posted.number).toBe('RPJ/2026/11/0001');
    expect(invoiceResidual(inv, data)).toBe(total - 666_000);
    expect(paymentState(posted, data)).toBe('applied');
    expect(balance(data, '4201')).toBe(600_000);
    expect(trialBalance(data, {}).balanced).toBe(true);

    const tooBig = createRefundDraft(inv, data, { date: '2026-11-06', ...opts });
    expect(() => postInvoice(tooBig, data, opts)).toThrowError(/melebihi sisa tagihan/);
  });

  it('tagihan vendor dan nota kredit pembelian menjurnal sisi sebaliknya', () => {
    const data = createEmptyData();
    const bill = post(data, draftInvoice('in_invoice', 'tepung-makmur', '2026-11-02', [['1301', 100, 285_000, TAX_PPN]]));
    expect(bill.number).toBe('PB/2026/11/0001');
    expect(balance(data, '1301')).toBe(28_500_000);
    expect(balance(data, '1401')).toBe(3_135_000);
    expect(balance(data, '2101')).toBe(-31_635_000);
    const ret = createRefundDraft(bill, data, { date: '2026-11-03', ...opts });
    ret.lines[0].quantity = 10;
    post(data, ret);
    expect(balance(data, '1301')).toBe(25_650_000);
    expect(trialBalance(data, {}).balanced).toBe(true);
  });
});

describe('Skenario 4 — entri dari dokumen hanya bisa dikoreksi lewat dokumennya', () => {
  it('menolak pembalikan langsung dari Entri Jurnal', () => {
    const data = createEmptyData();
    post(data, draftInvoice('out_invoice', 'daeng', '2026-11-01', [['4102', 1, 1_000_000, TAX_EXEMPT]]));
    try {
      reverseEntry(data.entries[0], data, { date: '2026-11-02', ...opts });
      throw new Error('seharusnya ditolak');
    } catch (e) {
      expect((e as LedgerError).code).toBe('HAS_SOURCE_DOCUMENT');
    }
  });
});

describe('Skenario 5 — umur piutang', () => {
  it('faktur 45 hari lalu dengan termin 14 hari masuk kelompok 31–60 hari', () => {
    const data = createEmptyData();
    post(data, draftInvoice('out_invoice', 'kopi-bone', '2026-09-20', [['4102', 1, 1_000_000, TAX_EXEMPT]], '2026-10-04'));
    const aging = agingReport(data, 'receivable', '2026-11-04');
    expect(aging.rows[0].buckets).toEqual([0, 0, 1_000_000, 0, 0]);
  });

  it('data contoh: semua kolom umur piutang terhitung', () => {
    const data = createDemoData();
    const aging = agingReport(data, 'receivable', '2026-11-04');
    expect(aging.grandTotal).toBeGreaterThan(0);
    expect(trialBalance(data, {}).balanced).toBe(true);
  });
});

describe('Skenario 6 — batas kredit', () => {
  it('memberi peringatan saat piutang melewati batas', () => {
    const data = createEmptyData();
    const sinar = data.partners.find((p) => p.id === partnerId('sinar-jaya'))!; // batas 25 jt
    post(data, draftInvoice('out_invoice', 'sinar-jaya', '2026-11-01', [['4103', 1, 20_000_000, TAX_EXEMPT]]));
    expect(creditCheck(sinar, data, 4_000_000).exceeded).toBe(false);
    const check = creditCheck(sinar, data, 6_000_000);
    expect(check.exceeded).toBe(true);
    expect(check.exposure).toBe(26_000_000);
  });
});
