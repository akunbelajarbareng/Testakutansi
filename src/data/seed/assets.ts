/** Kategori aset bawaan + contoh aset & penangguhan (ilustrasi — sesuaikan dengan aset Oriental). */
import type { AssetCategory } from '../../domain/types';
import { accountId } from './coa';

export const catId = (k: string) => `cat-${k}`;

/**
 * Default kelompok fiskal per kategori hanya titik awal. Kelompok tiap aset wajib dicek terhadap
 * Lampiran PMK 72/2023 oleh konsultan pajak; harta yang tidak tercantum masuk kelompok 3.
 */
export function seedAssetCategories(): AssetCategory[] {
  return [
    { id: catId('kendaraan'), name: 'Kendaraan Distribusi', assetAccountId: accountId('1501'), accumAccountId: accountId('1502'), expenseAccountId: accountId('6301'), defaultFiscalGroup: 'G2', active: true },
    { id: catId('peralatan'), name: 'Peralatan Toko & Chiller', assetAccountId: accountId('1503'), accumAccountId: accountId('1504'), expenseAccountId: accountId('6301'), defaultFiscalGroup: 'G1', active: true },
    { id: catId('inventaris'), name: 'Inventaris Kantor & Komputer', assetAccountId: accountId('1505'), accumAccountId: accountId('1506'), expenseAccountId: accountId('6301'), defaultFiscalGroup: 'G1', active: true },
    { id: catId('bangunan'), name: 'Bangunan', assetAccountId: accountId('1507'), accumAccountId: accountId('1508'), expenseAccountId: accountId('6301'), defaultFiscalGroup: 'BP', active: true },
  ];
}
