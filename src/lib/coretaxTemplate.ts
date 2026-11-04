/**
 * PEMETAAN EKSPOR KE TEMPLATE EXCEL CORETAX.
 *
 * ⚠️ BELUM DIVERIFIKASI. Struktur di bawah disusun dari bentuk umum template "Faktur Pajak
 * Keluaran" Coretax (sheet Faktur & DetailFaktur). DJP memperbarui template secara berkala
 * (paket ConverterEfakturCoretax v1.6, 23/01/2026). Sebelum dipakai untuk faktur sungguhan:
 *   1. Unduh template terbaru di pajak.go.id/reformdjp/coretax/template-xml-dan-converter-excel-ke-xml
 *   2. Cocokkan urutan & nama kolom di FAKTUR_COLUMNS / DETAIL_COLUMNS, kode satuan ukur, format tanggal
 *   3. Uji: Excel hasil ekspor → converter resmi DJP → impor ke Coretax (gunakan 1 faktur dulu)
 *   4. Setelah berhasil, tandai "Template sudah diverifikasi" di Pengaturan → Pajak
 * Cukup file ini yang diubah; logika pajak di src/domain/tax.ts tidak terpengaruh.
 */
import type { Company, Partner } from '../domain';

export const TEMPLATE_VERSION_ASSUMED = 'Coretax Faktur Keluaran (struktur umum, perkiraan v1.x)';

export const FAKTUR_COLUMNS = [
  'Baris',
  'Tanggal Faktur',
  'Jenis Faktur',
  'Kode Transaksi',
  'Keterangan Tambahan',
  'Dokumen Pendukung',
  'Referensi',
  'Cap Fasilitas',
  'ID TKU Penjual',
  'NPWP/NIK Pembeli',
  'Jenis ID Pembeli',
  'Negara Pembeli',
  'Nomor Dokumen Pembeli',
  'Nama Pembeli',
  'Alamat Pembeli',
  'Email Pembeli',
  'ID TKU Pembeli',
] as const;

export const DETAIL_COLUMNS = [
  'Baris',
  'Barang/Jasa',
  'Kode Barang Jasa',
  'Nama Barang/Jasa',
  'Nama Satuan Ukur',
  'Harga Satuan',
  'Jumlah Barang Jasa',
  'Total Diskon',
  'DPP',
  'DPP Nilai Lain',
  'Tarif PPN',
  'PPN',
  'Tarif PPnBM',
  'PPnBM',
] as const;

/** Nilai bawaan yang perlu dikonfirmasi dengan template resmi. */
export const DEFAULTS = {
  jenisFaktur: 'Normal',
  barangJasa: 'A', // A = barang, B = jasa
  kodeBarangJasa: '000000', // kode barang/jasa 6 digit (tidak wajib menurut referensi DJP)
  satuanUkur: 'UM.0018', // PERLU DIKONFIRMASI: kode satuan "unit/pcs" di referensi DJP
  negara: 'IDN',
  dateFormat: (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`,
};

const ID_TYPE_LABEL: Record<NonNullable<Partner['taxIdType']>, string> = {
  TIN: 'TIN',
  NIK: 'National ID',
  PASSPORT: 'Passport',
  OTHER: 'Other',
};

export const buyerIdType = (p: Partner) => ID_TYPE_LABEL[p.taxIdType ?? 'TIN'];
export const digitsOnly = (s?: string) => (s ?? '').replace(/\D/g, '');
export const sellerNitku = (c: Company) => digitsOnly(c.nitku) || `${digitsOnly(c.npwp)}000000`;
export const buyerNitku = (p: Partner) => digitsOnly(p.nitku) || ((p.taxIdType ?? 'TIN') === 'TIN' ? `${digitsOnly(p.npwp)}000000` : '000000');
