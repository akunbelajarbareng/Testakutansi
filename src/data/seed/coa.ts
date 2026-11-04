/**
 * Bagan Akun (COA) Oriental — distribusi & ritel F&B. DRAF v0.1.
 * Pendapatan & HPP dipisah per pilar bisnis agar margin per pilar terbaca langsung.
 * Wajib ditinjau akuntan/konsultan pajak sebelum dipakai untuk pembukuan riil.
 */
import type { Account, AccountGroup, AccountType } from '../../domain/types';

type Row = [code: string, name: string, type: AccountType, group: AccountGroup, flags?: { contra?: boolean; liquidity?: boolean }];

const ROWS: Row[] = [
  // 1 — Aset Lancar
  ['1101', 'Kas Toko', 'asset', 'Aset Lancar', { liquidity: true }],
  ['1102', 'Kas Kecil', 'asset', 'Aset Lancar', { liquidity: true }],
  ['1103', 'Dana dalam Perjalanan', 'asset', 'Aset Lancar'],
  ['1111', 'Bank Operasional', 'asset', 'Aset Lancar', { liquidity: true }],
  ['1112', 'Dana Settlement QRIS/EDC', 'asset', 'Aset Lancar'],
  ['1201', 'Piutang Usaha Grosir', 'asset', 'Aset Lancar'],
  ['1202', 'Piutang Usaha UKM Kuliner', 'asset', 'Aset Lancar'],
  ['1301', 'Persediaan Barang Kering', 'asset', 'Aset Lancar'],
  ['1302', 'Persediaan Chiller/Frozen', 'asset', 'Aset Lancar'],
  ['1303', 'Persediaan White Label', 'asset', 'Aset Lancar'],
  ['1304', 'Persediaan Kemasan', 'asset', 'Aset Lancar'],
  ['1401', 'PPN Masukan', 'asset', 'Aset Lancar'],
  ['1402', 'Uang Muka Pembelian', 'asset', 'Aset Lancar'],
  ['1404', 'PPN Lebih Bayar', 'asset', 'Aset Lancar'],
  ['1403', 'Biaya Dibayar di Muka', 'asset', 'Aset Lancar'],
  // 1 — Aset Tetap
  ['1501', 'Kendaraan Distribusi', 'asset', 'Aset Tetap'],
  ['1502', 'Akumulasi Penyusutan Kendaraan', 'asset', 'Aset Tetap', { contra: true }],
  ['1503', 'Peralatan Toko & Chiller', 'asset', 'Aset Tetap'],
  ['1504', 'Akumulasi Penyusutan Peralatan', 'asset', 'Aset Tetap', { contra: true }],
  ['1505', 'Inventaris Kantor & Komputer', 'asset', 'Aset Tetap'],
  ['1506', 'Akumulasi Penyusutan Inventaris', 'asset', 'Aset Tetap', { contra: true }],
  ['1507', 'Bangunan', 'asset', 'Aset Tetap'],
  ['1508', 'Akumulasi Penyusutan Bangunan', 'asset', 'Aset Tetap', { contra: true }],
  // 2 — Kewajiban
  ['2101', 'Utang Usaha Supplier', 'liability', 'Kewajiban'],
  ['2201', 'PPN Keluaran', 'liability', 'Kewajiban'],
  ['2202', 'Utang PPh 21', 'liability', 'Kewajiban'],
  ['2203', 'Utang PPh 23', 'liability', 'Kewajiban'],
  ['2204', 'Utang PPN', 'liability', 'Kewajiban'],
  ['2301', 'Deposit/Uang Muka Pelanggan', 'liability', 'Kewajiban'],
  ['2302', 'Liabilitas Poin Member', 'liability', 'Kewajiban'],
  ['2303', 'Pendapatan Diterima di Muka', 'liability', 'Kewajiban'],
  ['2401', 'Biaya Masih Harus Dibayar', 'liability', 'Kewajiban'],
  ['2501', 'Utang Bank', 'liability', 'Kewajiban'],
  // 3 — Ekuitas
  ['3101', 'Modal Disetor', 'equity', 'Ekuitas'],
  ['3201', 'Laba Ditahan', 'equity', 'Ekuitas'],
  ['3301', 'Laba Tahun Berjalan', 'equity', 'Ekuitas'],
  ['3401', 'Prive', 'equity', 'Ekuitas', { contra: true }],
  // 4 — Pendapatan
  ['4101', 'Penjualan Retail', 'income', 'Pendapatan'],
  ['4102', 'Penjualan Supply Chain UKM', 'income', 'Pendapatan'],
  ['4103', 'Penjualan Grosir', 'income', 'Pendapatan'],
  ['4104', 'Penjualan White Label', 'income', 'Pendapatan'],
  ['4105', 'Pendapatan Oriental Learn', 'income', 'Pendapatan'],
  ['4106', 'Pendapatan Waste Responsibility', 'income', 'Pendapatan'],
  ['4201', 'Retur & Potongan Penjualan', 'income', 'Pendapatan', { contra: true }],
  // 5 — HPP
  ['5101', 'HPP Retail', 'expense', 'Harga Pokok Penjualan'],
  ['5102', 'HPP Supply Chain UKM', 'expense', 'Harga Pokok Penjualan'],
  ['5103', 'HPP Grosir', 'expense', 'Harga Pokok Penjualan'],
  ['5104', 'HPP White Label', 'expense', 'Harga Pokok Penjualan'],
  ['5201', 'Barang Rusak/Kedaluwarsa', 'expense', 'Harga Pokok Penjualan'],
  ['5202', 'Ongkos Angkut Pembelian', 'expense', 'Harga Pokok Penjualan'],
  // 6 — Beban Operasional
  ['6101', 'Gaji & Tunjangan', 'expense', 'Beban Operasional'],
  ['6102', 'BPJS', 'expense', 'Beban Operasional'],
  ['6201', 'Sewa', 'expense', 'Beban Operasional'],
  ['6202', 'Listrik & Air', 'expense', 'Beban Operasional'],
  ['6203', 'BBM & Perawatan Armada', 'expense', 'Beban Operasional'],
  ['6204', 'Perlengkapan Toko', 'expense', 'Beban Operasional'],
  ['6205', 'Biaya MDR/Admin Bank', 'expense', 'Beban Operasional'],
  ['6206', 'Promosi & Pemasaran', 'expense', 'Beban Operasional'],
  ['6301', 'Beban Penyusutan', 'expense', 'Beban Operasional'],
  // 7–8 — Lain-lain
  ['7101', 'Pendapatan Bunga', 'income', 'Pendapatan & Beban Lain'],
  ['7102', 'Selisih Kas Lebih', 'income', 'Pendapatan & Beban Lain'],
  ['7103', 'Laba Pelepasan Aset', 'income', 'Pendapatan & Beban Lain'],
  ['7201', 'Beban Bunga', 'expense', 'Pendapatan & Beban Lain'],
  ['7202', 'Selisih Kas Kurang', 'expense', 'Pendapatan & Beban Lain'],
  ['7203', 'Rugi Pelepasan Aset', 'expense', 'Pendapatan & Beban Lain'],
  ['8101', 'Beban Pajak Penghasilan', 'expense', 'Pajak Penghasilan'],
];

/** ID akun seed dibuat stabil ('acc-1101') agar data contoh & tes bisa merujuknya. */
export const accountId = (code: string) => `acc-${code}`;

export function seedAccounts(): Account[] {
  return ROWS.map(([code, name, type, group, flags]) => ({
    id: accountId(code),
    code,
    name,
    type,
    group,
    contra: flags?.contra ?? false,
    liquidity: flags?.liquidity ?? false,
    active: true,
  }));
}
