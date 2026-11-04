import type { Journal } from '../../domain/types';
import { accountId } from './coa';

export const journalId = (code: string) => `jrn-${code}`;

export function seedJournals(): Journal[] {
  return [
    { id: journalId('PJ'), code: 'PJ', name: 'Penjualan', type: 'sale' },
    { id: journalId('PB'), code: 'PB', name: 'Pembelian', type: 'purchase' },
    {
      id: journalId('BNK'),
      code: 'BNK',
      name: 'Bank BCA',
      type: 'bank',
      defaultAccountId: accountId('1111'),
      bankName: 'BCA',
      accountNumber: '0123456789',
      statementFormat: 'bca',
    },
    { id: journalId('KAS'), code: 'KAS', name: 'Kas Toko', type: 'cash', defaultAccountId: accountId('1101'), defaultAnalytic: { 'aa-L1': 100 } },
    { id: journalId('KK'), code: 'KK', name: 'Kas Kecil', type: 'cash', defaultAccountId: accountId('1102'), defaultAnalytic: { 'aa-L4': 100 } },
    { id: journalId('UMUM'), code: 'UMUM', name: 'Umum', type: 'general' },
  ];
}
