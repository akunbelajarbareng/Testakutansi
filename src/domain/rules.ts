/**
 * ATURAN BISNIS AKUNTANSI — fungsi murni, tanpa ketergantungan React/penyimpanan.
 * Saat backend dibangun, file ini dipindah apa adanya ke server dan menjadi
 * satu-satunya sumber kebenaran (frontend hanya menampilkan hasilnya).
 */
import { LedgerError, type LedgerErrorCode } from './errors';
import { CODE_PREFIX_TYPE } from './accounting';
import type { Account, ISODate, Journal, JournalEntry, JournalLine, LedgerData, Money } from './types';
import { formatRupiah } from '../lib/format';

export interface EntryTotals {
  debit: Money;
  credit: Money;
  /** debit - kredit. 0 berarti seimbang. */
  difference: Money;
}

export interface ValidationIssue {
  code: LedgerErrorCode;
  message: string;
  lineIndex?: number;
}

type RefData = Pick<LedgerData, 'accounts' | 'journals'>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(date: string): boolean {
  if (!ISO_DATE.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

/** Baris kosong (tanpa akun dan tanpa nominal) diabaikan, seperti baris kosong di form. */
export function isBlankLine(line: JournalLine): boolean {
  return !line.accountId && !line.debit && !line.credit && !line.label.trim();
}

export function cleanLines(lines: JournalLine[]): JournalLine[] {
  return lines.filter((l) => !isBlankLine(l));
}

export function entryTotals(lines: JournalLine[]): EntryTotals {
  let debit = 0;
  let credit = 0;
  for (const l of lines) {
    debit += l.debit || 0;
    credit += l.credit || 0;
  }
  return { debit, credit, difference: debit - credit };
}

export function isPeriodLocked(date: ISODate, lockDate: ISODate | null): boolean {
  return lockDate !== null && date <= lockDate;
}

/** Validasi struktur + keseimbangan entri. Mengembalikan daftar masalah (kosong = valid untuk diposting). */
export function validateEntry(
  entry: Pick<JournalEntry, 'lines' | 'date' | 'journalId'>,
  data: RefData,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!isValidDate(entry.date)) {
    issues.push({ code: 'INVALID_DATE', message: 'Tanggal entri tidak valid.' });
  }
  if (!data.journals.some((j) => j.id === entry.journalId)) {
    issues.push({ code: 'UNKNOWN_JOURNAL', message: 'Pilih jurnal terlebih dahulu.' });
  }

  const lines = cleanLines(entry.lines);
  lines.forEach((l, i) => {
    const row = `Baris ${i + 1}`;
    const amountsValid =
      Number.isInteger(l.debit) && Number.isInteger(l.credit) && l.debit >= 0 && l.credit >= 0;
    if (!amountsValid) {
      issues.push({ code: 'INVALID_LINE', lineIndex: i, message: `${row}: nominal harus bilangan bulat Rupiah dan tidak negatif.` });
      return;
    }
    if (l.debit > 0 && l.credit > 0) {
      issues.push({ code: 'INVALID_LINE', lineIndex: i, message: `${row}: isi debit atau kredit saja, tidak keduanya.` });
    }
    if (l.debit === 0 && l.credit === 0) {
      issues.push({ code: 'INVALID_LINE', lineIndex: i, message: `${row}: nominal debit atau kredit belum diisi.` });
    }
    const account = data.accounts.find((a) => a.id === l.accountId);
    if (!account) {
      issues.push({ code: 'UNKNOWN_ACCOUNT', lineIndex: i, message: `${row}: pilih akun.` });
    } else if (!account.active) {
      issues.push({ code: 'INACTIVE_ACCOUNT', lineIndex: i, message: `${row}: akun ${account.code} sudah nonaktif.` });
    }
  });

  if (lines.length < 2) {
    issues.push({ code: 'TOO_FEW_LINES', message: 'Entri jurnal minimal terdiri dari 2 baris.' });
  }

  const totals = entryTotals(lines);
  if (totals.difference !== 0) {
    const side = totals.difference > 0 ? 'debit lebih besar' : 'kredit lebih besar';
    issues.push({
      code: 'NOT_BALANCED',
      message: `Entri belum seimbang: ${side} ${formatRupiah(Math.abs(totals.difference))}.`,
    });
  }

  return issues;
}

/** Nomor berikutnya untuk awalan per bulan: AWALAN/YYYY/MM/0001. Sumbernya nomor entri yang sudah ada. */
export function nextSequenceNumber(code: string, date: ISODate, entries: JournalEntry[]): string {
  const prefix = `${code}/${date.slice(0, 4)}/${date.slice(5, 7)}/`;
  let max = 0;
  for (const e of entries) {
    if (e.number && e.number.startsWith(prefix)) {
      const n = Number.parseInt(e.number.slice(prefix.length), 10);
      if (n > max) max = n;
    }
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

/** Nomor berikutnya per jurnal per bulan: KODE/YYYY/MM/0001. Tidak bolong karena hanya diberikan saat posting. */
export function nextEntryNumber(journal: Journal, date: ISODate, entries: JournalEntry[]): string {
  return nextSequenceNumber(journal.code, date, entries);
}

export function assertEditable(entry: JournalEntry): void {
  if (entry.status !== 'draft') {
    throw new LedgerError(
      'NOT_DRAFT',
      'Entri yang sudah diposting tidak bisa diubah atau dihapus. Gunakan "Balik Entri" untuk koreksi.',
    );
  }
}

export function assertNotLocked(date: ISODate, data: LedgerData): void {
  if (isPeriodLocked(date, data.company.lockDate)) {
    throw new LedgerError(
      'PERIOD_LOCKED',
      `Periode sampai ${data.company.lockDate} sudah dikunci. Pakai tanggal setelahnya atau ubah tanggal kunci di Pengaturan.`,
    );
  }
}

/** Posting draft: validasi, cek tanggal kunci, beri nomor. Mengembalikan entri baru (immutable). */
const SOURCE_HINT: Record<NonNullable<JournalEntry['source']>['type'], string> = {
  invoice: 'Entri ini berasal dari faktur/tagihan. Koreksi lewat nota kredit di dokumennya.',
  payment: 'Entri ini berasal dari pembayaran. Batalkan lewat halaman Pembayaran.',
  statement: 'Entri ini dibuat oleh rekonsiliasi bank. Batalkan rekonsiliasinya di halaman Rekonsiliasi.',
  cash_session: 'Entri ini berasal dari penutupan kas harian dan tidak bisa dibalik dari sini.',
  transfer: 'Entri ini berasal dari transfer antar rekening dan tidak bisa dibalik dari sini.',
  hpp_adjustment: 'Entri ini berasal dari penyesuaian HPP stok opname. Batalkan lewat halaman Penyesuaian HPP.',
  closing: 'Ini jurnal penutup tahun. Batalkan lewat halaman Tutup Buku.',
  retail_recap: 'Entri ini berasal dari rekap penjualan eceran. Batalkan lewat halaman Penjualan Eceran.',
  ppn_settlement: 'Ini jurnal kompensasi PPN masa. Batalkan lewat halaman Pajak.',
  ppn_payment: 'Ini setoran PPN. Koreksi lewat halaman Pajak.',
  depreciation: 'Ini jurnal penyusutan & amortisasi bulanan. Batalkan lewat halaman Penyusutan.',
  asset_disposal: 'Ini jurnal pelepasan aset. Kelola lewat kartu aset.',
};

export function postEntry(entry: JournalEntry, data: LedgerData, now: string): JournalEntry {
  assertEditable(entry);
  const issues = validateEntry(entry, data);
  if (issues.length > 0) {
    throw new LedgerError(issues[0].code, issues.map((i) => i.message).join(' '));
  }
  assertNotLocked(entry.date, data);
  const journal = data.journals.find((j) => j.id === entry.journalId)!;
  return {
    ...entry,
    lines: cleanLines(entry.lines),
    status: 'posted',
    number: nextEntryNumber(journal, entry.date, data.entries),
    postedAt: now,
  };
}

export interface ReverseOptions {
  date: ISODate;
  now: string;
  newId: () => string;
  /** Hanya untuk modul dokumen (mis. pembatalan pembayaran) yang membalik entrinya sendiri. */
  allowSourceDocument?: boolean;
}

/**
 * Balik entri yang sudah diposting: buat entri baru dengan debit/kredit ditukar,
 * langsung diposting. Entri asli ditandai 'reversed' dan saling ditautkan.
 */
export function reverseEntry(
  entry: JournalEntry,
  data: LedgerData,
  opts: ReverseOptions,
): { original: JournalEntry; reversal: JournalEntry } {
  if (entry.source && !opts.allowSourceDocument) {
    throw new LedgerError(
      'HAS_SOURCE_DOCUMENT',
      SOURCE_HINT[entry.source.type],
    );
  }
  if (entry.status === 'reversed') {
    throw new LedgerError('ALREADY_REVERSED', `Entri ${entry.number} sudah pernah dibalik.`);
  }
  if (entry.status !== 'posted') {
    throw new LedgerError('NOT_POSTED', 'Hanya entri yang sudah diposting yang bisa dibalik. Draft cukup dihapus atau diubah.');
  }
  if (!isValidDate(opts.date)) {
    throw new LedgerError('INVALID_DATE', 'Tanggal pembalikan tidak valid.');
  }
  assertNotLocked(opts.date, data);

  const journal = data.journals.find((j) => j.id === entry.journalId);
  if (!journal) throw new LedgerError('UNKNOWN_JOURNAL', 'Jurnal entri asli tidak ditemukan.');

  const reversalId = opts.newId();
  const reversal: JournalEntry = {
    id: reversalId,
    journalId: entry.journalId,
    number: nextEntryNumber(journal, opts.date, data.entries),
    date: opts.date,
    reference: `Pembalikan ${entry.number}${entry.reference ? ` — ${entry.reference}` : ''}`,
    status: 'posted',
    lines: entry.lines.map((l) => ({
      id: opts.newId(),
      accountId: l.accountId,
      label: l.label,
      debit: l.credit,
      credit: l.debit,
    })),
    reversalOfId: entry.id,
    createdAt: opts.now,
    postedAt: opts.now,
  };
  const original: JournalEntry = { ...entry, status: 'reversed', reversedById: reversalId };
  return { original, reversal };
}

/** Validasi akun baru/ubahan terhadap konvensi kode COA. */
export function validateAccount(account: Account, accounts: Account[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!/^\d{4}$/.test(account.code)) {
    issues.push({ code: 'INVALID_ACCOUNT', message: 'Kode akun harus 4 digit angka.' });
  } else {
    const expected = CODE_PREFIX_TYPE[account.code[0]];
    if (expected && expected !== account.type) {
      issues.push({
        code: 'INVALID_ACCOUNT',
        message: `Kode berawalan ${account.code[0]} harus bertipe sesuai kelompoknya.`,
      });
    }
  }
  if (accounts.some((a) => a.code === account.code && a.id !== account.id)) {
    issues.push({ code: 'DUPLICATE_CODE', message: `Kode ${account.code} sudah dipakai.` });
  }
  if (account.name.trim().length < 3) {
    issues.push({ code: 'INVALID_ACCOUNT', message: 'Nama akun minimal 3 karakter.' });
  }
  return issues;
}
