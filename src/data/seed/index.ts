import { postEntry } from '../../domain/rules';
import { addDays, postInvoice } from '../../domain/invoicing';
import { autoAllocate, postPayment } from '../../domain/payments';
import type { Invoice, InvoiceKind, JournalEntry, LedgerData } from '../../domain/types';
import { newId } from '../../lib/id';
import { accountId, seedAccounts } from './coa';
import { journalId, seedJournals } from './journals';
import { partnerId, seedPartners } from './partners';
import { TAX_EXEMPT, TAX_NONE, TAX_PPN, seedTaxes } from './taxes';
import { catId, seedAssetCategories } from './assets';
import { seedRules } from './rules';
import { planImport, parseBcaCsv, toStatementLines } from '../../domain/statementImport';
import { transferFunds } from '../../domain/banking';
import { postRetailRecap } from '../../domain/tax';
import { DEMO_BCA_CSV } from './demoStatement';
import { seedAnalyticAccounts, seedBudget, seedDistributionModels, seedPlans } from './analytics';
export { aaId, PLAN_PILAR, PLAN_OUTLET } from './analytics';
import { withAnalyticDefaults } from '../../domain/analytics';

export { accountId, journalId, partnerId, TAX_EXEMPT, TAX_NONE, TAX_PPN, catId };

type DemoLine = [code: string, label: string, debit: number, credit: number];

function draft(journal: string, date: string, reference: string, lines: DemoLine[]): JournalEntry {
  return {
    id: newId(),
    journalId: journalId(journal),
    number: null,
    date,
    reference,
    status: 'draft',
    lines: lines.map(([code, label, debit, credit]) => ({ id: newId(), accountId: accountId(code), label, debit, credit })),
    createdAt: new Date().toISOString(),
  };
}

export function createEmptyData(): LedgerData {
  return {
    company: {
      name: 'Oriental',
      currency: 'IDR',
      lockDate: null,
      address: 'Watampone, Sulawesi Selatan',
      npwp: '0123456789012345', // fiktif untuk data contoh — ganti dengan NPWP asli di Pengaturan
      nitku: '',
      phone: '',
      settlementFeeTolerance: 3,
      retailTrader: true,
      coretaxTemplateVerified: false,
    },
    accounts: seedAccounts(),
    journals: seedJournals(),
    entries: [],
    partners: seedPartners(),
    taxes: seedTaxes(),
    invoices: [],
    payments: [],
    statementLines: [],
    statementImports: [],
    reconcileRules: seedRules(),
    cashSessions: [],
    hppAdjustments: [],
    periodCloses: [],
    taxInvoices: [],
    retailRecaps: [],
    ppnPeriods: [],
    analyticPlans: seedPlans(),
    analyticAccounts: seedAnalyticAccounts(),
    distributionModels: seedDistributionModels(),
    budgets: [],
    assetCategories: seedAssetCategories(),
    assets: [],
    deferrals: [],
    depreciationRuns: [],
  };
}

type DocLine = [description: string, accountCode: string, qty: number, price: number, taxId: string];

/** Data contoh: transaksi khas distribusi & ritel F&B, semuanya diposting lewat aturan domain yang sama. */
export function createDemoData(): LedgerData {
  const data = createEmptyData();
  const now = new Date().toISOString();
  const opts = { now, newId };

  const entry = (e: JournalEntry) => data.entries.push(postEntry(e, data, now));

  const doc = (kind: InvoiceKind, partner: string, date: string, termDays: number, reference: string, lines: DocLine[], post = true, extra: Partial<Invoice> = {}) => {
    const inv = {
      ...extra,
      id: newId(),
      kind,
      partnerId: partnerId(partner),
      number: null,
      date,
      dueDate: addDays(date, termDays),
      reference,
      notes: '',
      lines: lines.map(([description, code, quantity, unitPrice, taxId]) => ({ id: newId(), description, accountId: accountId(code), quantity, unitPrice, taxId })),
      status: 'draft' as const,
      createdAt: now,
    };
    if (!post) {
      data.invoices.push(inv);
      return inv;
    }
    const res = postInvoice(inv, data, opts);
    data.invoices.push(res.invoice);
    data.entries.push(res.entry);
    return res.invoice;
  };

  const pay = (direction: 'inbound' | 'outbound', partner: string, date: string, journal: string, amount: number, memo = '', target?: { id: string }) => {
    const base = { direction, partnerId: partnerId(partner), amount };
    const allocations = target ? [{ invoiceId: target.id, amount }] : autoAllocate(base, data);
    const res = postPayment(
      { ...base, id: newId(), date, journalId: journalId(journal), memo, allocations },
      data,
      opts,
    );
    data.payments.push(res.payment);
    data.entries.push(res.entry);
  };

  // September–Oktober
  doc('out_invoice', 'kopi-bone', '2026-09-15', 14, '', [['Kopi bubuk robusta 1 kg', '4102', 10, 145_000, TAX_PPN]]);
  doc('out_invoice', 'daeng', '2026-10-10', 14, 'PO-0112', [['Minyak goreng 18 L', '4102', 10, 300_000, TAX_PPN]]);
  doc('in_invoice', 'frozen-sulawesi', '2026-10-20', 14, 'FS/INV/1029', [['Nugget ayam 1 kg', '1302', 200, 42_000, TAX_PPN]], true, {
    supplierTaxInvoiceNumber: '04002600000010291',
    supplierTaxInvoiceDate: '2026-10-20',
  });
  pay('inbound', 'daeng', '2026-10-25', 'KAS', 1_000_000, 'Cicilan Warung Makan Daeng');
  entry(draft('UMUM', '2026-10-28', 'Setoran modal awal', [
    ['1111', 'Setoran modal ke rekening operasional', 500_000_000, 0],
    ['3101', 'Modal disetor pemilik', 0, 500_000_000],
  ]));
  // Aset lama yang dimasukkan sebagai modal (saldo awal register aset).
  entry(draft('UMUM', '2026-10-31', 'Saldo awal aset tetap: truk distribusi', [
    ['1501', 'Truk distribusi (perolehan Jan 2024)', 180_000_000, 0],
    ['1502', 'Akumulasi penyusutan s.d. Okt 2026', 0, 63_750_000],
    ['3101', 'Inbreng aset oleh pemilik', 0, 116_250_000],
  ]));
  // Chiller baru dari supplier; sewa ruko dibayar di muka; paket kelas Oriental Learn dibayar di muka.
  const chillerBill = doc('in_invoice', 'frozen-sulawesi', '2026-10-25', 14, 'FS/INV/1041', [['Chiller display 2 pintu', '1503', 1, 24_000_000, TAX_PPN]]);
  const sewaBill = doc('in_invoice', 'pemilik-ruko', '2026-10-31', 0, 'Sewa Nov 2026–Okt 2027', [['Sewa ruko toko 12 bulan', '1403', 1, 36_000_000, TAX_NONE]]);
  const kelas = doc('out_invoice', 'daeng', '2026-10-20', 14, 'Learn-UKM-06', [['Paket kelas manajemen dapur UKM 6 bulan', '2303', 1, 6_000_000, TAX_PPN]]);
  pay('outbound', 'frozen-sulawesi', '2026-10-30', 'BNK', 5_000_000, 'Pembayaran sebagian PT Frozen Sulawesi');

  // November
  const gula = doc('out_invoice', 'kopi-bone', '2026-11-01', 14, '', [['Gula pasir 50 kg', '4102', 2, 780_000, TAX_EXEMPT]]);
  pay('inbound', 'kopi-bone', '2026-11-02', 'BNK', 1_560_000, 'Pelunasan gula November', gula);
  doc('in_invoice', 'tepung-makmur', '2026-11-02', 30, 'TM-2026-0877', [
    ['Tepung terigu 25 kg', '1301', 100, 285_000, TAX_PPN],
    ['Minyak goreng 18 L', '1301', 60, 275_000, TAX_PPN],
  ], true, { supplierTaxInvoiceNumber: '04002600000008770', supplierTaxInvoiceDate: '2026-11-02' });
  doc('in_invoice', 'tani-bone', '2026-11-03', 7, 'NOTA-341', [['Beras premium 25 kg', '1301', 40, 310_000, TAX_EXEMPT]]);
  doc('out_invoice', 'sinar-jaya', '2026-11-03', 30, 'PO-SJ-77', [
    ['Tepung terigu 25 kg', '4103', 40, 310_000, TAX_PPN],
    ['Gula pasir 50 kg', '4103', 10, 780_000, TAX_EXEMPT],
  ]);
  // Rekap penjualan eceran (digunggung): harga sudah termasuk PPN, dipisah DPP & PPN otomatis.
  const recap = (date: string, cash: number, nonCash: number, exemptGross: number) => {
    const r = postRetailRecap({ date, cashJournalId: journalId('KAS'), cash, nonCash, exemptGross, notes: '' }, data, opts);
    data.retailRecaps.push(r.recap);
    data.entries.push(r.entry);
  };
  recap('2026-11-02', 0, 5_000_000, 0);
  recap('2026-11-03', 6_750_000, 0, 1_200_000);
  entry(draft('BNK', '2026-11-04', 'Pembayaran listrik gudang & chiller', [
    ['6202', 'Tagihan listrik Oktober', 3_200_000, 0],
    ['1111', 'Transfer bank', 0, 3_200_000],
  ]));
  data.entries.push(
    transferFunds(
      { fromJournalId: journalId('KAS'), toJournalId: journalId('BNK'), date: '2026-11-03', amount: 2_500_000, memo: 'Setoran kas toko ke BCA' },
      data,
      opts,
    ),
  );

  // Mutasi BCA 1–4 Nov (belum dicocokkan — coba di layar Rekonsiliasi).
  const parsed = parseBcaCsv(DEMO_BCA_CSV);
  const plan = planImport(parsed, journalId('BNK'), data);
  const importId = newId();
  data.statementImports.push({
    id: importId,
    journalId: journalId('BNK'),
    fileName: 'mutasi-bca-nov-2026.csv',
    format: 'bca',
    periodStart: parsed.periodStart,
    periodEnd: parsed.periodEnd,
    openingBalance: parsed.openingBalance,
    closingBalance: parsed.closingBalance,
    importedCount: plan.newLines.length,
    duplicateCount: plan.duplicateCount,
    importedAt: now,
  });
  data.statementLines.push(...toStatementLines(plan.newLines, journalId('BNK'), importId, now, newId));
  data.journals = data.journals.map((j) => (j.id === journalId('BNK') ? { ...j, reconcileFrom: parsed.periodStart ?? undefined } : j));

  // Draft
  doc('out_invoice', 'sinar-jaya', '2026-11-04', 30, 'PO-SJ-81', [['Minyak goreng 18 L', '4103', 20, 300_000, TAX_PPN]], false);
  data.entries.push(draft('UMUM', '2026-11-04', 'Penghapusan stok frozen kedaluwarsa', [
    ['5201', 'Nugget & sosis lewat tanggal', 850_000, 0],
    ['1302', 'Pengurangan persediaan frozen', 0, 850_000],
  ]));

  // Register aset & penangguhan contoh.
  data.assets.push(
    {
      id: 'ast-truk-01', code: 'KND-001', name: 'Truk distribusi engkel', categoryId: catId('kendaraan'), serial: 'DD 8xxx XX',
      acquisitionDate: '2024-01-10', inServiceDate: '2024-01-15', cost: 180_000_000, salvage: 0, usefulLifeMonths: 96,
      fiscalGroup: 'G2', fiscalMethod: 'SL', analytic: { 'aa-P3': 70, 'aa-P2': 30, 'aa-L3': 100 }, status: 'running',
      openingAccumulated: 63_750_000, openingDate: '2026-10-31', improvements: [], createdAt: now,
    },
    {
      id: 'ast-chiller-01', code: 'PRL-001', name: 'Chiller display 2 pintu', categoryId: catId('peralatan'), serial: '',
      acquisitionDate: '2026-10-25', inServiceDate: '2026-11-01', cost: 24_000_000, salvage: 0, usefulLifeMonths: 48,
      fiscalGroup: 'G1', fiscalMethod: 'SL', analytic: { 'aa-P1': 100, 'aa-L1': 100 }, status: 'running',
      openingAccumulated: 0, improvements: [], sourceInvoiceId: chillerBill.id, sourceLineId: chillerBill.lines[0].id, createdAt: now,
    },
  );
  data.deferrals.push(
    {
      id: 'def-sewa-01', kind: 'expense', name: 'Sewa ruko toko Nov 2026–Okt 2027', partnerId: partnerId('pemilik-ruko'),
      startMonth: '2026-11', months: 12, total: 36_000_000, deferralAccountId: accountId('1403'), recognitionAccountId: accountId('6201'),
      analytic: { 'aa-P1': 100, 'aa-L1': 100 }, openingRecognized: 0, status: 'running', sourceInvoiceId: sewaBill.id, sourceLineId: sewaBill.lines[0].id, createdAt: now,
    },
    {
      id: 'def-learn-01', kind: 'revenue', name: 'Paket kelas UKM 6 bulan — Warung Makan Daeng', partnerId: partnerId('daeng'),
      startMonth: '2026-11', months: 6, total: 6_000_000, deferralAccountId: accountId('2303'), recognitionAccountId: accountId('4105'),
      openingRecognized: 0, status: 'running', sourceInvoiceId: kelas.id, sourceLineId: kelas.lines[0].id, createdAt: now,
    },
  );

  // Lengkapi distribusi analitik semua entri contoh (pilar otomatis, model distribusi, outlet kas).
  data.entries = data.entries.map((e) => (e.status === 'posted' || e.status === 'reversed' ? withAnalyticDefaults(e, data) : e));
  data.budgets = [seedBudget()];
  return data;
}
