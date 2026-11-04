const rupiah = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });

/** 1500000 → "Rp1.500.000". Negatif → "-Rp1.500.000". */
export function formatRupiah(value: number): string {
  const sign = value < 0 ? '-' : '';
  return `${sign}Rp${rupiah.format(Math.abs(value))}`;
}

/** Angka tanpa simbol untuk kolom tabel: 1500000 → "1.500.000", 0 → "" (opsional). */
export function formatAmount(value: number, blankZero = false): string {
  if (blankZero && value === 0) return '';
  const sign = value < 0 ? '-' : '';
  return sign + rupiah.format(Math.abs(value));
}

/** "1.500.000" / "1500000" / "Rp 1.500.000" → 1500000. Input kosong → 0. */
export function parseRupiah(input: string): number {
  const digits = input.replace(/[^\d]/g, '');
  return digits ? Number.parseInt(digits, 10) : 0;
}

const longDate = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** '2026-11-04' → "4 Nov 2026". */
export function formatDate(iso: string): string {
  if (!iso) return '';
  return longDate.format(new Date(`${iso}T00:00:00Z`));
}

const monthName = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** '2026-11' → "November 2026". */
export function formatMonth(yyyyMm: string): string {
  return monthName.format(new Date(`${yyyyMm}-01T00:00:00Z`));
}

/** Tanggal lokal hari ini dalam format ISO. */
export function todayISO(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function firstDayOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}
