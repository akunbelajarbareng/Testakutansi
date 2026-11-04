/**
 * Pajak bawaan (Oriental berstatus PKP).
 * - PPN 12% DPP 11/12: BKP/JKP nonmewah (PMK 131/2024) → tarif efektif 11%.
 * - Dibebaskan: barang kebutuhan pokok yang dibebaskan PPN.
 * Klasifikasi per barang wajib dikonfirmasi konsultan pajak.
 */
import type { Tax } from '../../domain/types';
import { accountId } from './coa';

export const TAX_PPN = 'tax-ppn-1112';
export const TAX_EXEMPT = 'tax-bebas';
export const TAX_NONE = 'tax-non-pkp';

export function seedTaxes(): Tax[] {
  return [
    {
      id: TAX_PPN,
      name: 'PPN 12% (DPP 11/12)',
      rate: 12,
      dppNumerator: 11,
      dppDenominator: 12,
      salesAccountId: accountId('2201'),
      purchaseAccountId: accountId('1401'),
      active: true,
      coretaxCode: '04',
    },
    {
      id: TAX_EXEMPT,
      name: 'Dibebaskan PPN',
      rate: 0,
      dppNumerator: 1,
      dppDenominator: 1,
      salesAccountId: accountId('2201'),
      purchaseAccountId: accountId('1401'),
      active: true,
      coretaxCode: '08',
      coretaxAdditionalInfo: '',
    },
    {
      id: TAX_NONE,
      name: 'Tanpa PPN (penjual non-PKP)',
      rate: 0,
      dppNumerator: 1,
      dppDenominator: 1,
      salesAccountId: accountId('2201'),
      purchaseAccountId: accountId('1401'),
      active: true,
      purchaseOnly: true,
    },
  ];
}
