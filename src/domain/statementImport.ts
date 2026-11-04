/**
 * IMPOR MUTASI REKENING — parser CSV murni (tanpa DOM), bisa dipakai juga di backend.
 *
 * Format BCA (ekspor mutasi KlikBCA), contoh:
 *   No. rekening : 0123456789
 *   Periode : 01/11/2026 - 04/11/2026
 *   Tanggal Transaksi,Keterangan,Cabang,Jumlah,,Saldo
 *   '02/11,TRSF E-BANKING CR KAFE KOPI BONE,'0000,1560000.00,CR,496560000.00
 *   Saldo Awal,=,495000000.00
 *   Saldo Akhir,=,524377000.00
 * Baris berstatus PEND (tertunda) dilewati.
 *
 * Format umum (cadangan): header `tanggal,keterangan,jumlah[,saldo]`,
 * tanggal YYYY-MM-DD atau DD/MM/YYYY, jumlah bertanda (negatif = keluar).
 */
import { isValidDate } from './rules';
import type { ISODate, LedgerData, Money, StatementFormat, StatementLine } from './types';

export interface ParsedLine {
  date: ISODate;
  description: string;
  amount: Money;
  balance: Money | null;
}

export interface ParsedStatement {
  format: StatementFormat;
  accountNumber: string | null;
  periodStart: ISODate | null;
  periodEnd: ISODate | null;
  openingBalance: Money | null;
  closingBalance: Money | null;
  lines: ParsedLine[];
  skippedPending: number;
  errors: string[];
}

/** Pecah satu baris CSV, mendukung tanda kutip ganda. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** "1,560,000.00" / "1560000.00" / "-25.000" → integer Rupiah (dibulatkan). */
export function parseAmount(raw: string): number | null {
  let s = raw.replace(/^'/, '').replace(/[^\d.,-]/g, '');
  if (!s) return null;
  // Format Indonesia "1.560.000,50" → ganti ke format titik desimal.
  if (/,\d{1,2}$/.test(s) && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function dmyToIso(d: string, m: string, y: string): ISODate {
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

export function parseBcaCsv(text: string): ParsedStatement {
  const res: ParsedStatement = {
    format: 'bca',
    accountNumber: null,
    periodStart: null,
    periodEnd: null,
    openingBalance: null,
    closingBalance: null,
    lines: [],
    skippedPending: 0,
    errors: [],
  };
  const rows = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((r) => r.trim());

  for (const row of rows) {
    const acc = row.match(/No\.?\s*rekening\s*:\s*([\d\s-]+)/i);
    if (acc) res.accountNumber = acc[1].replace(/\D/g, '');
    const per = row.match(/Periode\s*:\s*(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2})\/(\d{2})\/(\d{4})/i);
    if (per) {
      res.periodStart = dmyToIso(per[1], per[2], per[3]);
      res.periodEnd = dmyToIso(per[4], per[5], per[6]);
    }
  }
  const endYear = Number(res.periodEnd?.slice(0, 4) ?? new Date().getFullYear());
  const endMonth = Number(res.periodEnd?.slice(5, 7) ?? 12);

  rows.forEach((row, idx) => {
    const cols = splitCsvLine(row);
    const first = (cols[0] ?? '').replace(/^'/, '');
    if (/^saldo awal/i.test(first)) res.openingBalance = parseAmount(cols[2] ?? cols[1] ?? '');
    else if (/^saldo akhir/i.test(first)) res.closingBalance = parseAmount(cols[2] ?? cols[1] ?? '');
    else if (/^pend/i.test(first)) res.skippedPending++;
    else {
      const dm = first.match(/^(\d{2})\/(\d{2})$/);
      if (!dm) return;
      // Kolom: tanggal, keterangan, cabang, jumlah, CR/DB, saldo
      const amount = parseAmount(cols[3] ?? '');
      const side = (cols[4] ?? '').toUpperCase();
      if (amount === null || (side !== 'CR' && side !== 'DB')) {
        res.errors.push(`Baris ${idx + 1}: jumlah atau kolom CR/DB tidak terbaca.`);
        return;
      }
      const month = Number(dm[2]);
      const year = month > endMonth ? endYear - 1 : endYear; // mutasi Desember pada periode Januari
      res.lines.push({
        date: dmyToIso(dm[1], dm[2], String(year)),
        description: (cols[1] ?? '').replace(/\s+/g, ' ').trim(),
        amount: side === 'CR' ? amount : -amount,
        balance: parseAmount(cols[5] ?? ''),
      });
    }
  });
  if (!res.lines.length && !res.errors.length) res.errors.push('Tidak ada baris mutasi yang dikenali. Pastikan file adalah ekspor mutasi BCA dalam format CSV.');
  return res;
}

export function parseGenericCsv(text: string): ParsedStatement {
  const res: ParsedStatement = {
    format: 'generic',
    accountNumber: null,
    periodStart: null,
    periodEnd: null,
    openingBalance: null,
    closingBalance: null,
    lines: [],
    skippedPending: 0,
    errors: [],
  };
  const rows = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((r) => r.trim());
  if (!rows.length) {
    res.errors.push('File kosong.');
    return res;
  }
  const header = splitCsvLine(rows[0]).map((h) => h.toLowerCase());
  const iDate = header.indexOf('tanggal');
  const iDesc = header.indexOf('keterangan');
  const iAmt = header.indexOf('jumlah');
  const iBal = header.indexOf('saldo');
  if (iDate < 0 || iDesc < 0 || iAmt < 0) {
    res.errors.push('Header wajib: tanggal, keterangan, jumlah (opsional: saldo).');
    return res;
  }
  rows.slice(1).forEach((row, i) => {
    const c = splitCsvLine(row);
    const raw = c[iDate] ?? '';
    const dmy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    const date = dmy ? dmyToIso(dmy[1], dmy[2], dmy[3]) : raw;
    const amount = parseAmount(c[iAmt] ?? '');
    if (!isValidDate(date) || amount === null || amount === 0) {
      res.errors.push(`Baris ${i + 2}: tanggal atau jumlah tidak valid.`);
      return;
    }
    res.lines.push({ date, description: c[iDesc] ?? '', amount, balance: iBal >= 0 ? parseAmount(c[iBal] ?? '') : null });
  });
  return res;
}

export function parseStatement(text: string, format: StatementFormat): ParsedStatement {
  return format === 'bca' ? parseBcaCsv(text) : parseGenericCsv(text);
}

const dupKey = (journalId: string, l: { date: string; amount: number; description: string }) =>
  `${journalId}|${l.date}|${l.amount}|${l.description.toUpperCase().replace(/\s+/g, ' ').trim()}`;

export interface ImportPlan {
  newLines: ParsedLine[];
  duplicateCount: number;
  /** Cek saldo file: saldo awal + total mutasi = saldo akhir. null bila file tidak memuat saldo. */
  balanceCheck: { opening: Money; movement: Money; closing: Money; ok: boolean } | null;
  /** Cek terhadap buku: saldo buku sebelum periode = saldo awal file (hanya untuk impor pertama). */
  openingCheck: { book: Money; statement: Money; ok: boolean } | null;
}

/**
 * Rencana impor: buang mutasi ganda (tanggal + jumlah + keterangan sama, dihitung per kemunculan
 * sehingga dua biaya admin yang identik di hari yang sama tetap terimpor) dan cek saldo.
 */
export function planImport(parsed: ParsedStatement, journalId: string, data: LedgerData): ImportPlan {
  const existing = new Map<string, number>();
  for (const l of data.statementLines) {
    if (l.journalId !== journalId) continue;
    const k = dupKey(journalId, l);
    existing.set(k, (existing.get(k) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  const newLines: ParsedLine[] = [];
  let duplicateCount = 0;
  for (const l of parsed.lines) {
    const k = dupKey(journalId, l);
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    if (n <= (existing.get(k) ?? 0)) duplicateCount++;
    else newLines.push(l);
  }

  const movement = parsed.lines.reduce((s, l) => s + l.amount, 0);
  const balanceCheck =
    parsed.openingBalance !== null && parsed.closingBalance !== null
      ? { opening: parsed.openingBalance, movement, closing: parsed.closingBalance, ok: parsed.openingBalance + movement === parsed.closingBalance }
      : null;

  let openingCheck: ImportPlan['openingCheck'] = null;
  const journal = data.journals.find((j) => j.id === journalId);
  const firstImport = !data.statementLines.some((l) => l.journalId === journalId);
  const start = parsed.periodStart ?? parsed.lines.map((l) => l.date).sort()[0];
  if (journal?.defaultAccountId && firstImport && parsed.openingBalance !== null && start) {
    let book = 0;
    for (const e of data.entries) {
      if (e.status === 'draft' || e.date >= start) continue;
      for (const l of e.lines) if (l.accountId === journal.defaultAccountId) book += l.debit - l.credit;
    }
    openingCheck = { book, statement: parsed.openingBalance, ok: book === parsed.openingBalance };
  }
  return { newLines, duplicateCount, balanceCheck, openingCheck };
}

export function toStatementLines(lines: ParsedLine[], journalId: string, importId: string | null, now: string, newId: () => string): StatementLine[] {
  return lines.map((l) => ({
    id: newId(),
    journalId,
    date: l.date,
    description: l.description,
    amount: l.amount,
    balance: l.balance,
    importId,
    status: 'open',
    createdAt: now,
  }));
}
