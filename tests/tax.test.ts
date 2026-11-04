/**
 * Mini App 5 — 7 skenario uji Pajak (PPN).
 * Jalankan: npm test
 */
import { describe, expect, it } from 'vitest';
import {
  LedgerError,
  buyerTaxIssues,
  closingChecklist,
  exportIssues,
  inputTaxRows,
  markExported,
  matchCoretaxInput,
  outputTaxGroups,
  parseCoretaxInputCsv,
  payPpn,
  postInvoice,
  postRetailRecap,
  ppnSummary,
  recordTaxNumber,
  settlePpnPeriod,
  splitInclusive,
  trialBalance,
  validateCreditPeriod,
  type Invoice,
  type InvoiceKind,
  type LedgerData,
} from '../src/domain';
import { TAX_EXEMPT, TAX_PPN, accountId, createDemoData, createEmptyData, journalId, partnerId } from '../src/data/seed';

const NOW = '2026-11-30T10:00:00.000Z';
let seq = 0;
const opts = { now: NOW, newId: () => `x-${++seq}` };

function doc(data: LedgerData, kind: InvoiceKind, partner: string, date: string, lines: [string, number, number, string][], extra: Partial<Invoice> = {}) {
  const inv: Invoice = {
    id: opts.newId(),
    kind,
    partnerId: partnerId(partner),
    number: null,
    date,
    dueDate: date,
    reference: '',
    notes: '',
    lines: lines.map(([code, quantity, unitPrice, taxId]) => ({ id: opts.newId(), description: 'Barang', accountId: accountId(code), quantity, unitPrice, taxId })),
    status: 'draft',
    createdAt: NOW,
    ...extra,
  };
  const r = postInvoice(inv, data, opts);
  data.invoices.push(r.invoice);
  data.entries.push(r.entry);
  return r.invoice;
}
const bal = (data: LedgerData, code: string) => {
  const r = trialBalance(data, {}).rows.find((x) => x.account.code === code);
  return r ? r.closing.debit - r.closing.credit : 0;
};

describe('Skenario 1 — identitas pembeli wajib lengkap sebelum ekspor', () => {
  it('menolak pembeli tanpa NPWP/NIK dan kode 08 tanpa keterangan tambahan', () => {
    const data = createDemoData();
    doc(data, 'out_invoice', 'daeng', '2026-11-10', [['4102', 1, 1_000_000, TAX_PPN]]);
    const issues = exportIssues(outputTaxGroups(data, '2026-11'), data).map((i) => i.message);
    expect(issues.some((m) => m.includes('Warung Makan Daeng') && m.includes('16 digit'))).toBe(true);
    expect(issues.some((m) => m.includes('kode transaksi 08') || m.includes('Kode transaksi 08'))).toBe(true);
    expect(buyerTaxIssues(data.partners.find((p) => p.id === partnerId('sinar-jaya'))!)).toEqual([]);
  });
});

describe('Skenario 2 — Faktur Pajak dipecah per kode transaksi, nilai sama dengan faktur', () => {
  it('faktur campuran (PPN + bebas) menjadi 2 Faktur Pajak', () => {
    const data = createDemoData();
    const groups = outputTaxGroups(data, '2026-11').filter((g) => g.invoice.number === 'PJ/2026/11/0002');
    expect(groups.map((g) => g.code).sort()).toEqual(['04', '08']);
    const g04 = groups.find((g) => g.code === '04')!;
    expect(g04).toMatchObject({ dpp: 12_400_000, dppOther: 11_366_667, ppn: 1_364_000 });
    expect(groups.find((g) => g.code === '08')!.ppn).toBe(0);
  });
});

describe('Skenario 3 — nomor Faktur Pajak dicatat; nota kredit memicu pembetulan', () => {
  it('status exported → issued, lalu ditandai perlu retur setelah nota kredit', () => {
    const data = createDemoData();
    const group = outputTaxGroups(data, '2026-11').find((g) => g.invoice.number === 'PJ/2026/11/0002' && g.code === '04')!;
    const [rec] = markExported([group], 'batch-1', opts);
    data.taxInvoices.push(rec);
    expect(() => recordTaxNumber(rec, '123', '2026-11-03', data)).toThrowError(LedgerError);
    const issued = recordTaxNumber(rec, '04.002-26.00001234-5', '2026-11-03', data);
    expect(issued.status).toBe('issued');
    data.taxInvoices = [issued];
    doc(data, 'out_refund', 'sinar-jaya', '2026-11-05', [['4201', 1, 310_000, TAX_PPN]], { refundOfId: group.invoice.id });
    expect(outputTaxGroups(data, '2026-11').find((g) => g.key === group.key)!.needsCorrection).toBe(true);
  });
});

describe('Skenario 4 — rekap penjualan eceran digunggung', () => {
  it('Rp11.100.000 termasuk PPN → DPP Rp10.000.000 + PPN Rp1.100.000', () => {
    expect(splitInclusive(11_100_000, { rate: 12, dppNumerator: 11, dppDenominator: 12 })).toEqual({ dpp: 10_000_000, ppn: 1_100_000 });
    const data = createEmptyData();
    data.company.retailTrader = true;
    const r = postRetailRecap({ date: '2026-11-10', cashJournalId: journalId('KAS'), cash: 8_000_000, nonCash: 4_100_000, exemptGross: 1_000_000, notes: '' }, data, opts);
    data.retailRecaps.push(r.recap);
    data.entries.push(r.entry);
    expect(bal(data, '4101')).toBe(-11_000_000);
    expect(bal(data, '2201')).toBe(-1_100_000);
    expect(bal(data, '1112')).toBe(4_100_000);
    expect(() => postRetailRecap({ date: '2026-11-10', cashJournalId: journalId('KAS'), cash: 1, nonCash: 0, exemptGross: 0, notes: '' }, data, opts)).toThrowError(/sudah ada/);
    data.company.retailTrader = false;
    expect(() => postRetailRecap({ date: '2026-11-11', cashJournalId: journalId('KAS'), cash: 1, nonCash: 0, exemptGross: 0, notes: '' }, data, opts)).toThrowError(/Pedagang Eceran/);
  });
});

describe('Skenario 5 — cocokkan PPN Masukan dengan Coretax', () => {
  it('menandai cocok, hanya di Coretax, hanya di buku, dan beda nominal', () => {
    const data = createEmptyData();
    doc(data, 'in_invoice', 'tepung-makmur', '2026-11-02', [['1301', 100, 285_000, TAX_PPN]], { supplierTaxInvoiceNumber: '04002600000008770' });
    doc(data, 'in_invoice', 'frozen-sulawesi', '2026-11-05', [['1302', 10, 100_000, TAX_PPN]], { supplierTaxInvoiceNumber: '04002600000011111' });
    doc(data, 'in_invoice', 'frozen-sulawesi', '2026-11-06', [['1302', 5, 100_000, TAX_PPN]]);
    const csv = [
      'npwp_penjual,nama_penjual,nomor_faktur,tanggal_faktur,dpp,ppn',
      '0765432109876543,CV Tepung Makmur,04002600000008770,2026-11-02,26125000,3135000',
      '0654321098765432,PT Frozen Sulawesi,04002600000011111,2026-11-05,916667,110001',
      '0111111111111111,UD Lain,04002600000099999,2026-11-07,1000000,120000',
    ].join('\n');
    const { rows, errors } = parseCoretaxInputCsv(csv);
    expect(errors).toEqual([]);
    const m = matchCoretaxInput(rows, data, '2026-11');
    const by = (s: string) => m.filter((x) => x.status === s).length;
    expect(by('matched')).toBe(1);
    expect(by('amount_mismatch')).toBe(1);
    expect(by('only_coretax')).toBe(1);
    expect(by('only_book')).toBe(1);
  });

  it('masa pengkreditan boleh digeser maksimal 3 masa', () => {
    const bill = { date: '2026-11-02', supplierTaxInvoiceDate: '2026-11-02' };
    expect(validateCreditPeriod(bill, '2027-02')).toBeNull();
    expect(validateCreditPeriod(bill, '2027-03')).toMatch(/3 masa/);
    expect(validateCreditPeriod(bill, '2026-10')).toMatch(/sebelum/);
    const data = createDemoData();
    const tepung = data.invoices.find((i) => i.kind === 'in_invoice' && i.reference === 'TM-2026-0877')!;
    expect(inputTaxRows(data, '2026-11').some((r) => r.bill.id === tepung.id)).toBe(true);
    data.invoices = data.invoices.map((i) => (i.id === tepung.id ? { ...i, creditPeriod: '2026-12' } : i));
    expect(inputTaxRows(data, '2026-11').some((r) => r.bill.id === tepung.id)).toBe(false);
    expect(inputTaxRows(data, '2026-12').some((r) => r.bill.id === tepung.id)).toBe(true);
  });
});

describe('Skenario 6 — rekap SPT Masa PPN cocok dengan buku', () => {
  it('data contoh November: lebih bayar, PPN Keluaran sama dengan saldo buku', () => {
    const s = ppnSummary(createDemoData(), '2026-11');
    expect(s.outputInvoices).toBe(1_364_000);
    expect(s.outputRetail).toBe(495_495 + 550_000);
    expect(s.inputTax).toBe(4_950_000);
    expect(s.net).toBe(1_364_000 + 1_045_495 - 4_950_000);
    expect(s.glMatches).toBe(true);
    expect(s.dueDate).toBe('2026-12-31');
  });
});

describe('Skenario 7 — kompensasi & setor PPN', () => {
  it('kurang bayar dikompensasi lalu disetor; lebih bayar dibawa ke masa berikutnya', () => {
    const data = createEmptyData();
    data.company.npwp = '0123456789012345';
    doc(data, 'out_invoice', 'sinar-jaya', '2026-10-05', [['4103', 1, 10_000_000, TAX_PPN]]);
    doc(data, 'in_invoice', 'tepung-makmur', '2026-10-06', [['1301', 1, 3_000_000, TAX_PPN]], { supplierTaxInvoiceNumber: '1' });
    const oct = settlePpnPeriod('2026-10', data, opts);
    expect(oct.record.net).toBe(1_100_000 - 330_000);
    data.ppnPeriods.push(oct.record);
    data.entries.push(oct.entry);
    expect(bal(data, '2201')).toBe(0);
    expect(bal(data, '1401')).toBe(0);
    expect(bal(data, '2204')).toBe(-770_000);
    expect(() => settlePpnPeriod('2026-10', data, opts)).toThrowError(/sudah dikompensasi/);
    expect(() => payPpn(oct.record, { journalId: journalId('BNK'), date: '2026-11-20', ntpn: 'ABC' }, data, opts)).toThrowError(/NTPN/);
    const paid = payPpn(oct.record, { journalId: journalId('BNK'), date: '2026-11-20', ntpn: 'A1B2C3D4E5F6G7H8' }, data, opts);
    data.ppnPeriods = [paid.record];
    data.entries.push(paid.entry);
    expect(bal(data, '2204')).toBe(0);

    // November lebih bayar → Desember mengompensasi.
    doc(data, 'in_invoice', 'tepung-makmur', '2026-11-03', [['1301', 1, 5_000_000, TAX_PPN]], { supplierTaxInvoiceNumber: '2' });
    const nov = settlePpnPeriod('2026-11', data, opts);
    expect(nov.record.net).toBe(-550_000);
    data.ppnPeriods.push(nov.record);
    data.entries.push(nov.entry);
    expect(bal(data, '1404')).toBe(550_000);
    doc(data, 'out_invoice', 'sinar-jaya', '2026-12-02', [['4103', 1, 10_000_000, TAX_PPN]]);
    const dec = settlePpnPeriod('2026-12', data, opts);
    expect(dec.record.priorCredit).toBe(550_000);
    expect(dec.record.net).toBe(1_100_000 - 550_000);
    data.entries.push(dec.entry);
    expect(bal(data, '1404')).toBe(0);
    expect(trialBalance(data, {}).balanced).toBe(true);
  });

  it('checklist tutup buku memuat peringatan pajak', () => {
    const items = closingChecklist(createDemoData(), '2026-11-30');
    expect(items.find((i) => i.id === 'taxinvoice')!.ok).toBe(false);
    expect(items.find((i) => i.id === 'ppn')!.ok).toBe(false);
  });
});

void TAX_EXEMPT;
