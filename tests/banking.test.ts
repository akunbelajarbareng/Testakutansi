/**
 * Mini App 3 — 7 skenario uji Bank & Kas + Rekonsiliasi.
 * Jalankan: npm test
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  LedgerError,
  closeCashDay,
  parseBcaCsv,
  paymentState,
  planImport,
  reconcileSettlement,
  reconcileTransit,
  reconcileWithAccount,
  reconcileWithBook,
  reconcileWithInvoices,
  reconciliationReport,
  suggestMatches,
  transferFunds,
  trialBalance,
  unreconcile,
  type JournalEntry,
  type LedgerData,
  type Payment,
  type StatementLine,
} from '../src/domain';
import { createDemoData, journalId } from '../src/data/seed';
import { DEMO_BCA_CSV } from '../src/data/seed/demoStatement';

const NOW = '2026-11-04T08:00:00.000Z';
let seq = 0;
const opts = { now: NOW, newId: () => `b-${++seq}` };
const BNK = journalId('BNK');

/** Terapkan hasil aksi ke data (meniru store). */
function apply(data: LedgerData, r: { line?: StatementLine; entry?: JournalEntry; entries?: JournalEntry[]; payment?: Payment; payments?: Payment[] }) {
  const upsert = <T extends { id: string }>(list: T[], items: T[]) => {
    const m = new Map(list.map((x) => [x.id, x]));
    items.forEach((i) => m.set(i.id, i));
    return [...m.values()];
  };
  if (r.line) data.statementLines = upsert(data.statementLines, [r.line]);
  data.entries = upsert(data.entries, [...(r.entry ? [r.entry] : []), ...(r.entries ?? [])]);
  data.payments = upsert(data.payments, [...(r.payment ? [r.payment] : []), ...(r.payments ?? [])]);
}

const lineBy = (data: LedgerData, text: string) => data.statementLines.find((l) => l.description.includes(text))!;
const bal = (data: LedgerData, code: string) => {
  const r = trialBalance(data, {}).rows.find((x) => x.account.code === code);
  return r ? r.closing.debit - r.closing.credit : 0;
};

describe('Skenario 1 — impor CSV BCA', () => {
  it('membaca 7 mutasi dan saldo awal + mutasi = saldo akhir', () => {
    const p = parseBcaCsv(DEMO_BCA_CSV);
    expect(p.lines).toHaveLength(7);
    expect(p.periodStart).toBe('2026-11-01');
    expect(p.lines[2]).toMatchObject({ date: '2026-11-03', amount: -15_000 });
    const plan = planImport(p, BNK, { ...createDemoData(), statementLines: [] });
    expect(plan.balanceCheck?.ok).toBe(true);
    expect(plan.openingCheck?.ok).toBe(true);
  });

  it('impor ulang melewati duplikat, baris PEND dilewati', () => {
    const data = createDemoData();
    const p = parseBcaCsv(readFileSync('public/contoh-mutasi-bca.csv', 'utf8'));
    expect(p.skippedPending).toBe(1);
    const plan = planImport(p, BNK, data);
    expect(plan.duplicateCount).toBe(7);
    expect(plan.newLines.map((l) => l.description)).toEqual(['BUNGA', 'PAJAK BUNGA']);
    expect(plan.balanceCheck?.ok).toBe(true);
  });
});

describe('Skenario 2 — transfer pelanggan disarankan ke faktur yang tepat', () => {
  it('membuat pembayaran dan faktur menjadi lunas', () => {
    const data = createDemoData();
    const line = lineBy(data, 'SINAR JAYA');
    const top = suggestMatches(line, data)[0];
    expect(top.kind).toBe('invoice');
    if (top.kind !== 'invoice') return;
    const inv = data.invoices.find((i) => i.id === top.invoiceIds[0])!;
    expect(inv.number).toBe('PJ/2026/11/0002');
    apply(data, reconcileWithInvoices(line, top.partnerId, top.invoiceIds, data, opts));
    expect(paymentState(inv, data)).toBe('paid');
    expect(lineBy(data, 'SINAR JAYA').status).toBe('reconciled');
  });

  it('transfer sebagian dicocokkan ke faktur pelanggan yang namanya muncul', () => {
    const data = createDemoData();
    const line = lineBy(data, 'WARUNG MAKAN DAENG');
    const s = suggestMatches(line, data).find((x) => x.kind === 'invoice');
    expect(s).toBeDefined();
  });
});

describe('Skenario 3 — pembayaran yang sudah dicatat cukup ditandai cocok', () => {
  it('tidak membuat jurnal baru', () => {
    const data = createDemoData();
    const before = data.entries.length;
    const line = lineBy(data, 'KAFE KOPI BONE');
    const top = suggestMatches(line, data)[0];
    expect(top.kind).toBe('book');
    if (top.kind !== 'book') return;
    apply(data, { line: reconcileWithBook(line, top.refs, data, NOW) });
    expect(data.entries.length).toBe(before);
    // Baris buku yang sama tidak boleh dipakai dua kali.
    const other = { ...line, id: 'x', status: 'open' as const, reconciliation: undefined };
    expect(() => reconcileWithBook(other, top.refs, data, NOW)).toThrowError(LedgerError);
  });
});

describe('Skenario 4 — aturan biaya admin', () => {
  it('dikenali dan dijurnal ke 6205', () => {
    const data = createDemoData();
    const line = lineBy(data, 'BIAYA ADM');
    const top = suggestMatches(line, data)[0];
    expect(top.kind).toBe('rule');
    if (top.kind !== 'rule') return;
    apply(data, reconcileWithAccount(line, top.accountId, top.label, data, opts));
    expect(bal(data, '6205')).toBe(15_000);
  });
});

describe('Skenario 5 — pencairan QRIS/EDC', () => {
  it('selisih saldo 1112 dan dana masuk dicatat sebagai MDR', () => {
    const data = createDemoData();
    const line = lineBy(data, 'QRIS');
    const s = suggestMatches(line, data).find((x) => x.kind === 'settlement');
    expect(s).toBeDefined();
    if (s?.kind !== 'settlement') return;
    expect(s.fee).toBe(32_000);
    apply(data, reconcileSettlement(line, s.refs, data, opts));
    expect(bal(data, '1112')).toBe(0);
    expect(bal(data, '6205')).toBe(32_000);
    expect(trialBalance(data, {}).balanced).toBe(true);
  });
});

describe('Skenario 6 — laporan rekonsiliasi', () => {
  it('saldo buku ± item belum cocok = saldo bank, sebelum dan sesudah rekonsiliasi', () => {
    const data = createDemoData();
    const before = reconciliationReport(data, BNK, '2026-11-04');
    expect(before.statementBalance).toBe(524_377_000);
    expect(before.unexplained).toBe(0);

    // Cocokkan semua mutasi.
    for (const text of ['KAFE KOPI BONE', 'PLN LISTRIK']) {
      const l = lineBy(data, text);
      const s = suggestMatches(l, data)[0];
      if (s.kind === 'book') apply(data, { line: reconcileWithBook(l, s.refs, data, NOW) });
    }
    for (const text of ['SINAR JAYA', 'WARUNG MAKAN DAENG']) {
      const l = lineBy(data, text);
      const s = suggestMatches(l, data).find((x) => x.kind === 'invoice');
      if (s?.kind === 'invoice') apply(data, reconcileWithInvoices(l, s.partnerId, s.invoiceIds, data, opts));
    }
    const adm = lineBy(data, 'BIAYA ADM');
    const r = suggestMatches(adm, data)[0];
    if (r.kind === 'rule') apply(data, reconcileWithAccount(adm, r.accountId, r.label, data, opts));
    const q = lineBy(data, 'QRIS');
    const qs = suggestMatches(q, data).find((x) => x.kind === 'settlement');
    if (qs?.kind === 'settlement') apply(data, reconcileSettlement(q, qs.refs, data, opts));
    const st = lineBy(data, 'SETORAN TUNAI');
    const ts = suggestMatches(st, data).find((x) => x.kind === 'transit');
    if (ts?.kind === 'transit') apply(data, reconcileTransit(st, ts.refs, data, opts));

    const after = reconciliationReport(data, BNK, '2026-11-04');
    expect(after.bankOnly).toHaveLength(0);
    expect(after.bookOnly).toHaveLength(0);
    expect(after.bookBalance).toBe(524_377_000);
    expect(after.unexplained).toBe(0);
    expect(bal(data, '1103')).toBe(0);
    expect(trialBalance(data, {}).balanced).toBe(true);
  });

  it('batal rekonsiliasi membalik entri yang dibuat dan membuka kembali faktur', () => {
    const data = createDemoData();
    const l = lineBy(data, 'SINAR JAYA');
    const s = suggestMatches(l, data)[0];
    if (s.kind !== 'invoice') throw new Error('harus invoice');
    apply(data, reconcileWithInvoices(l, s.partnerId, s.invoiceIds, data, opts));
    const res = unreconcile(lineBy(data, 'SINAR JAYA'), data, { ...opts, date: '2026-11-05' });
    apply(data, res);
    const inv = data.invoices.find((i) => i.id === s.invoiceIds[0])!;
    expect(paymentState(inv, data)).toBe('unpaid');
    expect(lineBy(data, 'SINAR JAYA').status).toBe('open');
    expect(reconciliationReport(data, BNK, '2026-11-05').unexplained).toBe(0);
  });
});

describe('Skenario 7 — kas harian & transfer', () => {
  it('selisih kurang Rp50.000 dijurnal ke 7202 dan kas tidak bisa ditutup dua kali', () => {
    const data = createDemoData();
    const { session, entry } = closeCashDay({ journalId: journalId('KAS'), date: '2026-11-04', counted: 5_200_000, denominations: {}, notes: '' }, data, opts);
    expect(session.expected).toBe(5_250_000);
    expect(session.difference).toBe(-50_000);
    data.cashSessions.push(session);
    data.entries.push(entry!);
    expect(bal(data, '7202')).toBe(50_000);
    expect(() => closeCashDay({ journalId: journalId('KAS'), date: '2026-11-04', counted: 0, denominations: {}, notes: '' }, data, opts)).toThrowError(/sudah ditutup/);
  });

  it('transfer ke kas langsung, ke bank lewat dana dalam perjalanan', () => {
    const data = createDemoData();
    const toCash = transferFunds({ fromJournalId: BNK, toJournalId: journalId('KK'), date: '2026-11-04', amount: 1_000_000, memo: '' }, data, opts);
    expect(toCash.lines.find((l) => l.debit > 0)!.accountId).toBe('acc-1102');
    const toBank = transferFunds({ fromJournalId: journalId('KAS'), toJournalId: BNK, date: '2026-11-04', amount: 500_000, memo: '' }, data, opts);
    expect(toBank.lines.find((l) => l.debit > 0)!.accountId).toBe('acc-1103');
    expect(() => transferFunds({ fromJournalId: BNK, toJournalId: BNK, date: '2026-11-04', amount: 1, memo: '' }, data, opts)).toThrowError(LedgerError);
  });
});
