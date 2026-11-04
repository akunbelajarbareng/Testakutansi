/**
 * ASET TETAP, PENYUSUTAN, DAN PENANGGUHAN (biaya dibayar di muka / pendapatan diterima di muka).
 *
 * Komersial: garis lurus per bulan, mulai bulan aset siap dipakai, dijurnal lewat run bulanan.
 * Fiskal: kelompok PMK 72/2023, dihitung per tahun pajak, TIDAK dijurnal (bahan koreksi fiskal).
 */
import { LedgerError } from './errors';
import { assertNotLocked, isValidDate, nextEntryNumber, reverseEntry } from './rules';
import { monthEnd, shiftMonth } from './financials';
import { lineSubtotal } from './invoicing';
import type {
  Asset,
  AssetImprovement,
  Deferral,
  DepreciationRun,
  DepreciationRunItem,
  FiscalGroup,
  FiscalMethod,
  ISODate,
  JournalEntry,
  LedgerData,
  Money,
} from './types';
import { formatRupiah } from '../lib/format';

interface Opts {
  now: string;
  newId: () => string;
}

/** Masa manfaat (tahun) & tarif (%) per kelompok fiskal, PMK 72/2023. */
export const FISCAL_GROUPS: Record<FiscalGroup, { label: string; years: number; sl: number; db: number | null }> = {
  G1: { label: 'Kelompok 1 (4 tahun)', years: 4, sl: 25, db: 50 },
  G2: { label: 'Kelompok 2 (8 tahun)', years: 8, sl: 12.5, db: 25 },
  G3: { label: 'Kelompok 3 (16 tahun)', years: 16, sl: 6.25, db: 12.5 },
  G4: { label: 'Kelompok 4 (20 tahun)', years: 20, sl: 5, db: 10 },
  BP: { label: 'Bangunan permanen (20 tahun)', years: 20, sl: 5, db: null },
  BT: { label: 'Bangunan tidak permanen (10 tahun)', years: 10, sl: 10, db: null },
};

const ym = (d: ISODate) => d.slice(0, 7);
const monthsBetween = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));

// ── Jadwal komersial ─────────────────────────────────────────────────

export interface ScheduleRow {
  period: string; // 'YYYY-MM'
  depreciation: Money;
  accumulated: Money;
  bookValue: Money;
}

/**
 * Jadwal penyusutan komersial garis lurus per bulan. Perbaikan dikapitalisasi menambah nilai buku
 * (dan opsional masa manfaat) mulai bulan perbaikan; sisa dibagi rata ke sisa bulan.
 * Pembulatan per rupiah; bulan terakhir menghabiskan sisa sehingga nilai buku akhir = nilai sisa.
 * Tidak ada penyusutan di bulan pelepasan dan sesudahnya.
 */
export function assetSchedule(asset: Asset): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  let start = ym(asset.inServiceDate);
  let remaining = asset.usefulLifeMonths;
  let accumulated = 0;
  let bookValue = asset.cost;
  if (asset.openingDate && asset.openingAccumulated > 0) {
    const elapsed = monthsBetween(start, ym(asset.openingDate)) + 1;
    remaining = Math.max(0, asset.usefulLifeMonths - elapsed);
    accumulated = asset.openingAccumulated;
    bookValue = asset.cost - accumulated;
    start = shiftMonth(ym(asset.openingDate), 1);
  }
  const stop = asset.disposal ? ym(asset.disposal.date) : null;
  const improvements = [...asset.improvements].sort((a, b) => a.date.localeCompare(b.date));
  for (let period = start, guard = 0; guard < 1200; period = shiftMonth(period, 1), guard++) {
    if (stop && period >= stop) break;
    for (const imp of improvements.filter((i) => ym(i.date) === period)) {
      bookValue += imp.amount;
      remaining += imp.extraMonths;
    }
    if (remaining <= 0) {
      if (improvements.some((i) => ym(i.date) > period)) continue;
      break;
    }
    const depreciable = bookValue - asset.salvage;
    const dep = remaining === 1 ? depreciable : Math.round(depreciable / remaining);
    accumulated += dep;
    bookValue -= dep;
    remaining -= 1;
    rows.push({ period, depreciation: dep, accumulated, bookValue });
  }
  return rows;
}

export const scheduledFor = (asset: Asset, period: string) => assetSchedule(asset).find((r) => r.period === period)?.depreciation ?? 0;

/** Total nilai perolehan termasuk perbaikan yang dikapitalisasi. */
export const assetCostTotal = (asset: Asset) => asset.cost + asset.improvements.reduce((s, i) => s + i.amount, 0);

/** Akumulasi penyusutan yang sudah DIBUKUKAN (saldo awal + run yang diposting). */
export function postedAccumulated(asset: Asset, data: Pick<LedgerData, 'depreciationRuns'>, upToPeriod?: string): Money {
  let sum = asset.openingAccumulated;
  for (const r of data.depreciationRuns) {
    if (r.status !== 'posted' || (upToPeriod && r.period > upToPeriod)) continue;
    for (const it of r.items) if (it.type === 'asset' && it.id === asset.id) sum += it.amount;
  }
  return sum;
}

export function hasPostedDepreciation(assetId: string, data: Pick<LedgerData, 'depreciationRuns'>): boolean {
  return data.depreciationRuns.some((r) => r.status === 'posted' && r.items.some((i) => i.type === 'asset' && i.id === assetId));
}

// ── Jadwal fiskal (per tahun pajak) ──────────────────────────────────

export interface FiscalRow {
  year: string;
  depreciation: Money;
  bookValue: Money;
}

/**
 * Penyusutan fiskal per tahun: mulai bulan perolehan, tahun pertama prorata bulan.
 * Garis lurus: tarif × nilai perolehan. Saldo menurun: tarif × nilai sisa buku fiskal,
 * dan pada tahun terakhir masa manfaat sisa nilai buku disusutkan sekaligus.
 * Perbaikan dikapitalisasi ke nilai sisa buku fiskal (PMK 72/2023 Pasal 7).
 */
export function fiscalSchedule(asset: Asset): FiscalRow[] {
  const g = FISCAL_GROUPS[asset.fiscalGroup];
  const method: FiscalMethod = g.db === null ? 'SL' : asset.fiscalMethod;
  const rows: FiscalRow[] = [];
  const firstYear = Number(asset.acquisitionDate.slice(0, 4));
  const firstMonths = 12 - Number(asset.acquisitionDate.slice(5, 7)) + 1;
  const totalMonths = g.years * 12;
  let used = 0; // bulan masa manfaat terpakai
  let book = asset.cost;
  let slBase = asset.cost;
  let slRemainingMonths = totalMonths;
  const stopYear = asset.disposal ? Number(asset.disposal.date.slice(0, 4)) : null;
  const imps = [...asset.improvements].sort((a, b) => a.date.localeCompare(b.date));

  for (let year = firstYear; used < totalMonths && year < firstYear + g.years + 30; year++) {
    if (stopYear && year > stopYear) break;
    for (const imp of imps.filter((i) => Number(i.date.slice(0, 4)) === year)) {
      book += imp.amount;
      slBase = book;
      slRemainingMonths = Math.min(totalMonths - used + imp.extraMonths, totalMonths);
    }
    const months = Math.min(year === firstYear ? firstMonths : 12, totalMonths - used);
    let dep: number;
    const isLast = used + months >= totalMonths;
    if (method === 'SL') {
      dep = isLast ? book : Math.round((slBase * months) / slRemainingMonths);
      if (!isLast) {
        slBase -= dep;
        slRemainingMonths -= months;
      }
    } else {
      dep = isLast ? book : Math.round((book * (g.db! / 100) * months) / 12);
    }
    if (stopYear && year === stopYear && asset.disposal) dep = 0; // tahun pelepasan: sisa nilai buku menjadi rugi/laba pelepasan
    book -= dep;
    used += months;
    rows.push({ year: String(year), depreciation: dep, bookValue: book });
  }
  return rows;
}

export interface FiscalComparisonRow {
  asset: Asset;
  commercial: Money;
  fiscal: Money;
  /** Koreksi fiskal = komersial − fiskal. Positif = koreksi positif (menambah penghasilan kena pajak). */
  correction: Money;
}

/**
 * Jadwal komersial lengkap sejak mulai dipakai (mengabaikan saldo awal), untuk perbandingan fiskal per tahun.
 * Untuk aset lama, bulan-bulan sebelum aplikasi dipakai ikut dihitung dengan garis lurus.
 */
export function fullCommercialSchedule(asset: Asset): ScheduleRow[] {
  return assetSchedule({ ...asset, openingAccumulated: 0, openingDate: undefined });
}

export function commercialForYear(asset: Asset, year: string): Money {
  return fullCommercialSchedule(asset).filter((r) => r.period.startsWith(year)).reduce((s, r) => s + r.depreciation, 0);
}

export function fiscalComparison(data: LedgerData, year: string): FiscalComparisonRow[] {
  return data.assets
    .filter((a) => a.status !== 'draft')
    .map((asset) => {
      const commercial = commercialForYear(asset, year);
      const fiscal = fiscalSchedule(asset).find((r) => r.year === year)?.depreciation ?? 0;
      return { asset, commercial, fiscal, correction: commercial - fiscal };
    })
    .filter((r) => r.commercial || r.fiscal);
}

// ── Validasi aset ────────────────────────────────────────────────────

export function validateAsset(asset: Asset, data: LedgerData): string[] {
  const out: string[] = [];
  if (asset.name.trim().length < 3) out.push('Nama aset minimal 3 karakter.');
  if (!asset.code.trim()) out.push('Isi kode aset.');
  if (data.assets.some((a) => a.id !== asset.id && a.code.trim().toUpperCase() === asset.code.trim().toUpperCase())) out.push(`Kode aset ${asset.code} sudah dipakai.`);
  if (!data.assetCategories.some((c) => c.id === asset.categoryId)) out.push('Pilih kategori aset.');
  if (!isValidDate(asset.acquisitionDate) || !isValidDate(asset.inServiceDate)) out.push('Tanggal perolehan/mulai pakai tidak valid.');
  else if (asset.inServiceDate < asset.acquisitionDate) out.push('Tanggal mulai pakai tidak boleh sebelum tanggal perolehan.');
  if (!Number.isInteger(asset.cost) || asset.cost <= 0) out.push('Nilai perolehan harus lebih dari 0.');
  if (!Number.isInteger(asset.salvage) || asset.salvage < 0 || asset.salvage >= asset.cost) out.push('Nilai sisa harus ≥ 0 dan lebih kecil dari nilai perolehan.');
  if (!Number.isInteger(asset.usefulLifeMonths) || asset.usefulLifeMonths < 1 || asset.usefulLifeMonths > 600) out.push('Masa manfaat 1–600 bulan.');
  if (asset.openingAccumulated < 0 || asset.openingAccumulated > asset.cost - asset.salvage) out.push('Akumulasi awal tidak boleh melebihi nilai yang dapat disusutkan.');
  if (asset.openingAccumulated > 0 && (!asset.openingDate || !isValidDate(asset.openingDate))) out.push('Isi tanggal saldo awal akumulasi.');
  if (FISCAL_GROUPS[asset.fiscalGroup].db === null && asset.fiscalMethod === 'DB') out.push('Bangunan hanya boleh disusutkan fiskal dengan garis lurus.');
  return out;
}

/** Field yang tidak boleh berubah setelah penyusutan pertama dibukukan. */
export function lockedFieldChanges(before: Asset, after: Asset): string[] {
  const keys: (keyof Asset)[] = ['cost', 'salvage', 'usefulLifeMonths', 'inServiceDate', 'acquisitionDate', 'openingAccumulated', 'openingDate', 'categoryId'];
  return keys.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])).map(String);
}

export function addImprovement(asset: Asset, imp: Omit<AssetImprovement, 'id'>, data: LedgerData, newId: () => string): Asset {
  if (asset.status !== 'running') throw new LedgerError('INVALID_ASSET', 'Perbaikan hanya untuk aset yang sedang disusutkan.');
  if (!isValidDate(imp.date)) throw new LedgerError('INVALID_DATE', 'Tanggal perbaikan tidak valid.');
  if (!Number.isInteger(imp.amount) || imp.amount <= 0) throw new LedgerError('INVALID_ASSET', 'Nilai perbaikan harus lebih dari 0.');
  if (!Number.isInteger(imp.extraMonths) || imp.extraMonths < 0) throw new LedgerError('INVALID_ASSET', 'Tambahan masa manfaat tidak valid.');
  const last = lastRunPeriod(data);
  if (last && ym(imp.date) <= last) throw new LedgerError('INVALID_ASSET', `Penyusutan sampai ${last} sudah dibukukan; tanggal perbaikan harus setelahnya.`);
  return { ...asset, improvements: [...asset.improvements, { ...imp, id: newId() }] };
}

// ── Penangguhan ──────────────────────────────────────────────────────

export interface DeferralRow {
  period: string;
  amount: Money;
  remaining: Money;
}

export function deferralSchedule(d: Deferral): DeferralRow[] {
  const rows: DeferralRow[] = [];
  const perMonth = Math.round(d.total / d.months);
  let recognized = 0;
  for (let i = 0; i < d.months; i++) {
    const period = shiftMonth(d.startMonth, i);
    const amount = i === d.months - 1 ? d.total - recognized : perMonth;
    recognized += amount;
    rows.push({ period, amount, remaining: d.total - recognized });
  }
  // Saldo awal yang sudah diakui menghabiskan bulan-bulan pertama.
  if (d.openingRecognized > 0) {
    let skip = d.openingRecognized;
    return rows
      .map((r) => {
        if (skip <= 0) return r;
        const take = Math.min(skip, r.amount);
        skip -= take;
        return { ...r, amount: r.amount - take };
      })
      .filter((r) => r.amount > 0);
  }
  return rows;
}

export function validateDeferral(d: Deferral, data: LedgerData): string[] {
  const out: string[] = [];
  if (d.name.trim().length < 3) out.push('Nama minimal 3 karakter.');
  if (!/^\d{4}-\d{2}$/.test(d.startMonth)) out.push('Bulan mulai tidak valid.');
  if (!Number.isInteger(d.months) || d.months < 1 || d.months > 120) out.push('Jumlah bulan 1–120.');
  if (!Number.isInteger(d.total) || d.total <= 0) out.push('Nilai harus lebih dari 0.');
  if (d.openingRecognized < 0 || d.openingRecognized >= d.total) out.push('Nilai yang sudah diakui harus lebih kecil dari total.');
  const def = data.accounts.find((a) => a.id === d.deferralAccountId);
  const rec = data.accounts.find((a) => a.id === d.recognitionAccountId);
  if (!def || !rec) out.push('Pilih akun penangguhan dan akun pengakuan.');
  else if (d.kind === 'expense' && (def.type !== 'asset' || rec.type !== 'expense')) out.push('Biaya dibayar di muka: akun penangguhan aset (mis. 1403), akun pengakuan beban.');
  else if (d.kind === 'revenue' && (def.type !== 'liability' || rec.type !== 'income')) out.push('Pendapatan diterima di muka: akun penangguhan kewajiban (mis. 2303), akun pengakuan pendapatan.');
  return out;
}

// ── Run bulanan ──────────────────────────────────────────────────────

export function lastRunPeriod(data: Pick<LedgerData, 'depreciationRuns'>): string | null {
  const p = data.depreciationRuns.filter((r) => r.status === 'posted').map((r) => r.period).sort();
  return p.length ? p[p.length - 1] : null;
}

/** Item yang jatuh di periode ini (aset berjalan & penangguhan aktif). */
export function runPreview(data: LedgerData, period: string): DepreciationRunItem[] {
  const items: DepreciationRunItem[] = [];
  for (const a of data.assets) {
    if (a.status === 'draft') continue;
    const amt = scheduledFor(a, period);
    if (amt) items.push({ type: 'asset', id: a.id, amount: amt });
  }
  for (const d of data.deferrals) {
    if (d.status !== 'running') continue;
    const amt = deferralSchedule(d).find((r) => r.period === period)?.amount ?? 0;
    if (amt) items.push({ type: 'deferral', id: d.id, amount: amt });
  }
  return items;
}

/** Bulan paling awal yang masih punya item tetapi belum dibukukan (untuk mencegah lompatan). */
export function firstUnpostedPeriod(data: LedgerData, upTo: string): string | null {
  const starts = [
    ...data.assets.filter((a) => a.status !== 'draft').map((a) => assetSchedule(a)[0]?.period),
    ...data.deferrals.filter((d) => d.status === 'running').map((d) => deferralSchedule(d)[0]?.period),
  ].filter(Boolean) as string[];
  if (!starts.length) return null;
  const last = lastRunPeriod(data);
  let p = last ? shiftMonth(last, 1) : starts.sort()[0];
  for (; p <= upTo; p = shiftMonth(p, 1)) if (runPreview(data, p).length) return p;
  return null;
}

export function postDepreciationRun(period: string, data: LedgerData, opts: Opts): { run: DepreciationRun; entry: JournalEntry } {
  if (!/^\d{4}-\d{2}$/.test(period)) throw new LedgerError('INVALID_PERIOD', 'Periode tidak valid.');
  if (data.depreciationRuns.some((r) => r.status === 'posted' && r.period === period)) {
    throw new LedgerError('INVALID_PERIOD', `Penyusutan & amortisasi ${period} sudah dibukukan.`);
  }
  const last = lastRunPeriod(data);
  if (last && period < last) throw new LedgerError('INVALID_PERIOD', `Penyusutan sampai ${last} sudah dibukukan; tidak bisa membukukan periode sebelumnya.`);
  const pending = firstUnpostedPeriod(data, shiftMonth(period, -1));
  if (pending) throw new LedgerError('INVALID_PERIOD', `Bukukan dulu penyusutan ${pending} (berurutan per bulan).`);
  const items = runPreview(data, period);
  if (!items.length) throw new LedgerError('INVALID_PERIOD', `Tidak ada penyusutan atau amortisasi di ${period}.`);
  const date = monthEnd(period);
  assertNotLocked(date, data);

  const lines: JournalEntry['lines'] = [];
  for (const it of items) {
    if (it.type === 'asset') {
      const a = data.assets.find((x) => x.id === it.id)!;
      const cat = data.assetCategories.find((c) => c.id === a.categoryId)!;
      const label = `Penyusutan ${a.code} ${a.name}`;
      lines.push({ id: opts.newId(), accountId: cat.expenseAccountId, label, debit: it.amount, credit: 0, ...(a.analytic ? { analytic: a.analytic } : {}) });
      lines.push({ id: opts.newId(), accountId: cat.accumAccountId, label, debit: 0, credit: it.amount });
    } else {
      const d = data.deferrals.find((x) => x.id === it.id)!;
      const label = `${d.kind === 'expense' ? 'Amortisasi' : 'Pengakuan pendapatan'}: ${d.name}`;
      const rec = { accountId: d.recognitionAccountId, label, ...(d.analytic ? { analytic: d.analytic } : {}) };
      if (d.kind === 'expense') {
        lines.push({ id: opts.newId(), ...rec, debit: it.amount, credit: 0 });
        lines.push({ id: opts.newId(), accountId: d.deferralAccountId, label, debit: 0, credit: it.amount });
      } else {
        lines.push({ id: opts.newId(), accountId: d.deferralAccountId, label, debit: it.amount, credit: 0 });
        lines.push({ id: opts.newId(), ...rec, debit: 0, credit: it.amount });
      }
    }
  }
  const journal = data.journals.find((j) => j.type === 'general');
  if (!journal) throw new LedgerError('UNKNOWN_JOURNAL', 'Jurnal Umum tidak ditemukan.');
  const runId = opts.newId();
  const entry: JournalEntry = {
    id: opts.newId(),
    journalId: journal.id,
    number: nextEntryNumber(journal, date, data.entries),
    date,
    reference: `Penyusutan & amortisasi ${period}`,
    status: 'posted',
    lines,
    createdAt: opts.now,
    postedAt: opts.now,
    source: { type: 'depreciation', id: runId },
  };
  return { run: { id: runId, period, entryId: entry.id, items, status: 'posted', createdAt: opts.now }, entry };
}

export function cancelDepreciationRun(run: DepreciationRun, data: LedgerData, opts: Opts) {
  if (run.status !== 'posted') throw new LedgerError('INVALID_PERIOD', 'Run ini sudah dibatalkan.');
  if (lastRunPeriod(data) !== run.period) throw new LedgerError('INVALID_PERIOD', 'Hanya run bulan terakhir yang bisa dibatalkan.');
  if (data.assets.some((a) => a.disposal && ym(a.disposal.date) > run.period && run.items.some((i) => i.id === a.id))) {
    throw new LedgerError('INVALID_PERIOD', 'Ada aset yang sudah dilepas setelah periode ini.');
  }
  const e = data.entries.find((x) => x.id === run.entryId);
  if (!e) throw new LedgerError('INVALID_PERIOD', 'Jurnal penyusutan tidak ditemukan.');
  const { original, reversal } = reverseEntry(e, data, { ...opts, date: e.date, allowSourceDocument: true });
  return { run: { ...run, status: 'cancelled' as const }, original, reversal: { ...reversal, source: e.source } };
}

// ── Pelepasan ────────────────────────────────────────────────────────

export function disposeAsset(
  asset: Asset,
  input: { date: ISODate; type: 'sale' | 'writeoff'; proceeds: Money; journalId?: string; note: string },
  data: LedgerData,
  opts: Opts,
): { asset: Asset; entry: JournalEntry } {
  if (asset.status !== 'running') throw new LedgerError('INVALID_ASSET', 'Hanya aset yang sedang disusutkan yang bisa dilepas.');
  if (!isValidDate(input.date)) throw new LedgerError('INVALID_DATE', 'Tanggal pelepasan tidak valid.');
  if (input.date < asset.acquisitionDate) throw new LedgerError('INVALID_DATE', 'Tanggal pelepasan sebelum tanggal perolehan.');
  assertNotLocked(input.date, data);
  const prev = shiftMonth(ym(input.date), -1);
  const needed = assetSchedule(asset).filter((r) => r.period <= prev).reduce((s, r) => s + r.depreciation, 0) + asset.openingAccumulated;
  const posted = postedAccumulated(asset, data);
  if (posted !== needed) throw new LedgerError('INVALID_ASSET', `Bukukan dulu penyusutan sampai ${prev} sebelum melepas aset.`);
  if (data.depreciationRuns.some((r) => r.status === 'posted' && r.period >= ym(input.date) && r.items.some((i) => i.id === asset.id))) {
    throw new LedgerError('INVALID_ASSET', 'Penyusutan di bulan pelepasan atau sesudahnya sudah dibukukan. Batalkan run tersebut dulu.');
  }
  if (input.type === 'sale' && (!Number.isInteger(input.proceeds) || input.proceeds <= 0)) throw new LedgerError('INVALID_ASSET', 'Isi harga jual (tanpa PPN).');
  const journalCash = input.type === 'sale' ? data.journals.find((j) => j.id === input.journalId && j.defaultAccountId) : undefined;
  if (input.type === 'sale' && !journalCash) throw new LedgerError('UNKNOWN_JOURNAL', 'Pilih rekening penerima hasil penjualan.');

  const cat = data.assetCategories.find((c) => c.id === asset.categoryId)!;
  const cost = assetCostTotal(asset);
  const accumulated = posted;
  const proceeds = input.type === 'sale' ? input.proceeds : 0;
  const result = proceeds - (cost - accumulated); // + laba, − rugi
  const acc = (code: string) => {
    const a = data.accounts.find((x) => x.code === code);
    if (!a) throw new LedgerError('UNKNOWN_ACCOUNT', `Akun ${code} tidak ditemukan.`);
    return a.id;
  };
  const label = `${input.type === 'sale' ? 'Penjualan' : 'Penghapusan'} aset ${asset.code} ${asset.name}`;
  const raw = [
    { accountId: cat.accumAccountId, debit: accumulated, credit: 0 },
    { accountId: journalCash?.defaultAccountId ?? '', debit: proceeds, credit: 0 },
    { accountId: acc('7203'), debit: result < 0 ? -result : 0, credit: 0 },
    { accountId: cat.assetAccountId, debit: 0, credit: cost },
    { accountId: acc('7103'), debit: 0, credit: result > 0 ? result : 0 },
  ].filter((l) => l.debit || l.credit);
  const journal = journalCash ?? data.journals.find((j) => j.type === 'general')!;
  const entry: JournalEntry = {
    id: opts.newId(),
    journalId: journal.id,
    number: nextEntryNumber(journal, input.date, data.entries),
    date: input.date,
    reference: label,
    status: 'posted',
    lines: raw.map((l) => ({ id: opts.newId(), label, ...l, ...(l.accountId === acc('7103') || l.accountId === acc('7203') ? (asset.analytic ? { analytic: asset.analytic } : {}) : {}) })),
    createdAt: opts.now,
    postedAt: opts.now,
    source: { type: 'asset_disposal', id: asset.id },
  };
  return {
    asset: { ...asset, status: 'disposed', disposal: { date: input.date, type: input.type, proceeds, journalId: input.journalId, entryId: entry.id, note: input.note } },
    entry,
  };
}

// ── Kandidat dari tagihan & kecocokan dengan buku ────────────────────

export interface SourceCandidate {
  invoiceId: string;
  lineId: string;
  number: string;
  date: ISODate;
  partnerId: string;
  description: string;
  accountId: string;
  amount: Money;
  target: 'asset' | 'expense_deferral' | 'revenue_deferral';
}

/** Baris tagihan/faktur yang mengenai akun aset tetap, 1403, atau 2303 dan belum punya kartu. */
export function sourceCandidates(data: LedgerData): SourceCandidate[] {
  const assetAccounts = new Set(data.assetCategories.map((c) => c.assetAccountId));
  const prepaid = data.accounts.find((a) => a.code === '1403')?.id;
  const unearned = data.accounts.find((a) => a.code === '2303')?.id;
  const linked = new Set([...data.assets.map((a) => a.sourceLineId), ...data.deferrals.map((d) => d.sourceLineId)].filter(Boolean));
  const out: SourceCandidate[] = [];
  for (const inv of data.invoices) {
    if (inv.status !== 'posted' || (inv.kind !== 'in_invoice' && inv.kind !== 'out_invoice')) continue;
    for (const l of inv.lines) {
      if (linked.has(l.id)) continue;
      let target: SourceCandidate['target'] | null = null;
      if (inv.kind === 'in_invoice' && assetAccounts.has(l.accountId)) target = 'asset';
      else if (inv.kind === 'in_invoice' && l.accountId === prepaid) target = 'expense_deferral';
      else if (inv.kind === 'out_invoice' && l.accountId === unearned) target = 'revenue_deferral';
      if (target) out.push({ invoiceId: inv.id, lineId: l.id, number: inv.number ?? '', date: inv.date, partnerId: inv.partnerId, description: l.description, accountId: l.accountId, amount: lineSubtotal(l), target });
    }
  }
  return out;
}

export interface RegisterCheck {
  categoryId: string;
  registerCost: Money;
  glCost: Money;
  registerAccum: Money;
  glAccum: Money;
}

/** Cocokkan register aset dengan saldo buku besar per kategori. */
export function registerVsLedger(data: LedgerData, asOf: ISODate): RegisterCheck[] {
  const bal = (accountId: string) => {
    let s = 0;
    for (const e of data.entries) {
      if (e.status === 'draft' || e.date > asOf) continue;
      for (const l of e.lines) if (l.accountId === accountId) s += l.debit - l.credit;
    }
    return s;
  };
  // Run bertanggal akhir bulan: hanya yang tanggal jurnalnya ≤ asOf yang dihitung, sama seperti buku besar.
  const lastPeriod = asOf === monthEnd(ym(asOf)) ? ym(asOf) : shiftMonth(ym(asOf), -1);
  return data.assetCategories.map((c) => {
    const live = data.assets.filter((a) => a.categoryId === c.id && a.status !== 'draft' && (!a.disposal || a.disposal.date > asOf));
    return {
      categoryId: c.id,
      registerCost: live.reduce((s, a) => s + a.cost + a.improvements.filter((i) => i.date <= asOf).reduce((t, i) => t + i.amount, 0), 0),
      glCost: bal(c.assetAccountId),
      registerAccum: live.reduce((s, a) => s + postedAccumulated(a, data, lastPeriod), 0),
      glAccum: -bal(c.accumAccountId),
    };
  });
}

export const describeMoney = formatRupiah;
