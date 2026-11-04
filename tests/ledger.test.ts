/**
 * 5 skenario uji dari dokumen planning + beberapa aturan tambahan.
 * Jalankan: npm test
 */
import { describe, expect, it } from 'vitest';
import {
  LedgerError,
  generalLedger,
  nextEntryNumber,
  normalSide,
  postEntry,
  reverseEntry,
  trialBalance,
  validateEntry,
  type JournalEntry,
  type LedgerData,
} from '../src/domain';
import { accountId, createDemoData, createEmptyData, journalId } from '../src/data/seed';

const NOW = '2026-11-04T08:00:00.000Z';
let seq = 0;
const id = () => `id-${++seq}`;

function draft(date: string, lines: [code: string, debit: number, credit: number][], journal = 'UMUM'): JournalEntry {
  return {
    id: id(),
    journalId: journalId(journal),
    number: null,
    date,
    reference: 'tes',
    status: 'draft',
    lines: lines.map(([code, debit, credit]) => ({ id: id(), accountId: accountId(code), label: '', debit, credit })),
    createdAt: NOW,
  };
}

function post(data: LedgerData, entry: JournalEntry): JournalEntry {
  const posted = postEntry(entry, data, NOW);
  data.entries.push(posted);
  return posted;
}

function expectLedgerError(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(LedgerError);
    expect((e as LedgerError).code).toBe(code);
    return;
  }
  throw new Error(`Seharusnya melempar ${code}`);
}

describe('Skenario 1 — setoran modal diposting, neraca saldo seimbang', () => {
  it('memposting entri seimbang dan memberi nomor', () => {
    const data = createEmptyData();
    const posted = post(data, draft('2026-11-01', [['1101', 100_000_000, 0], ['3101', 0, 100_000_000]]));
    expect(posted.status).toBe('posted');
    expect(posted.number).toBe('UMUM/2026/11/0001');

    const tb = trialBalance(data, { from: '2026-11-01', to: '2026-11-30' });
    expect(tb.balanced).toBe(true);
    expect(tb.totals.closing.debit).toBe(100_000_000);
  });
});

describe('Skenario 2 — entri tidak seimbang ditolak', () => {
  it('menolak dan menyebut selisihnya', () => {
    const data = createEmptyData();
    const bad = draft('2026-11-01', [['1101', 100_000_000, 0], ['3101', 0, 90_000_000]]);
    const issues = validateEntry(bad, data);
    expect(issues.map((i) => i.code)).toContain('NOT_BALANCED');
    expect(issues.find((i) => i.code === 'NOT_BALANCED')!.message).toContain('10.000.000');
    expectLedgerError(() => postEntry(bad, data, NOW), 'NOT_BALANCED');
  });

  it('menolak entri satu baris dan baris berisi debit sekaligus kredit', () => {
    const data = createEmptyData();
    expectLedgerError(() => postEntry(draft('2026-11-01', [['1101', 0, 0]]), data, NOW), 'INVALID_LINE');
    const both = validateEntry(draft('2026-11-01', [['1101', 5, 5], ['3101', 0, 0]]), data);
    expect(both.some((i) => i.message.includes('tidak keduanya'))).toBe(true);
  });
});

describe('Skenario 3 — entri diposting tidak bisa diedit, koreksi lewat pembalikan', () => {
  it('menolak posting ulang dan membuat entri pembalik bernomor baru', () => {
    const data = createEmptyData();
    const posted = post(data, draft('2026-11-01', [['1101', 2_000_000, 0], ['4101', 0, 2_000_000]]));
    expectLedgerError(() => postEntry(posted, data, NOW), 'NOT_DRAFT');

    const { original, reversal } = reverseEntry(posted, data, { date: '2026-11-02', now: NOW, newId: id });
    expect(original.status).toBe('reversed');
    expect(original.reversedById).toBe(reversal.id);
    expect(reversal.number).toBe('UMUM/2026/11/0002');
    expect(reversal.lines[0]).toMatchObject({ debit: 0, credit: 2_000_000 });

    data.entries = data.entries.map((e) => (e.id === original.id ? original : e)).concat(reversal);
    const kas = generalLedger(accountId('1101'), data, {})!;
    expect(kas.closing).toBe(0);
    expectLedgerError(() => reverseEntry(original, data, { date: '2026-11-03', now: NOW, newId: id }), 'ALREADY_REVERSED');
  });
});

describe('Skenario 4 — tanggal kunci', () => {
  it('menolak posting dan pembalikan di periode terkunci', () => {
    const data = createEmptyData();
    const october = post(data, draft('2026-10-10', [['1101', 1_000, 0], ['3101', 0, 1_000]]));
    data.company.lockDate = '2026-10-31';
    expectLedgerError(() => postEntry(draft('2026-10-15', [['1101', 500, 0], ['3101', 0, 500]]), data, NOW), 'PERIOD_LOCKED');
    expectLedgerError(() => reverseEntry(october, data, { date: '2026-10-31', now: NOW, newId: id }), 'PERIOD_LOCKED');
    expect(() => postEntry(draft('2026-11-01', [['1101', 500, 0], ['3101', 0, 500]]), data, NOW)).not.toThrow();
  });
});

describe('Skenario 5 — Buku Besar cocok dengan Neraca Saldo', () => {
  it('saldo akhir kas di buku besar = saldo akhir di neraca saldo', () => {
    const data = createDemoData();
    const period = { from: '2026-11-01', to: '2026-11-30' };
    const bank = generalLedger(accountId('1111'), data, period)!;
    // 500 jt modal − 5 jt bayar supplier (Okt) → +1,56 jt pelunasan − 3,2 jt listrik (Nov)
    expect(bank.opening).toBe(495_000_000);
    expect(bank.closing).toBe(493_360_000);

    const tb = trialBalance(data, period);
    expect(tb.balanced).toBe(true);
    const row = tb.rows.find((r) => r.account.code === '1111')!;
    expect(row.closing.debit).toBe(bank.closing);
  });
});

describe('Aturan tambahan', () => {
  it('penomoran per jurnal per bulan, tidak terpengaruh draft', () => {
    const data = createDemoData();
    const umum = data.journals.find((j) => j.code === 'UMUM')!;
    expect(nextEntryNumber(umum, '2026-11-20', data.entries)).toBe('UMUM/2026/11/0001');
    // Oktober: setoran modal + saldo awal aset tetap → berikutnya 0003.
    expect(nextEntryNumber(umum, '2026-10-20', data.entries)).toBe('UMUM/2026/10/0003');
  });

  it('akun kontra bersaldo normal berlawanan', () => {
    expect(normalSide({ type: 'asset' })).toBe('debit');
    expect(normalSide({ type: 'asset', contra: true })).toBe('credit');
    expect(normalSide({ type: 'income', contra: true })).toBe('debit');
  });

  it('draft tidak memengaruhi saldo', () => {
    const data = createDemoData();
    const expired = generalLedger(accountId('5201'), data, {})!;
    expect(expired.rows).toHaveLength(0);
  });
});
