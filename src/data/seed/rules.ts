/**
 * Aturan rekonsiliasi bawaan. Kata kunci QRIS/EDC/MERCHANT adalah perkiraan; sesuaikan dengan
 * keterangan yang benar-benar muncul di mutasi BCA Oriental (bisa diubah di Pengaturan).
 */
import type { ReconcileRule } from '../../domain/types';
import { accountId } from './coa';

export function seedRules(): ReconcileRule[] {
  return [
    { id: 'rule-pajak-bunga', keyword: 'PAJAK BUNGA', direction: 'out', action: 'account', accountId: accountId('8101'), label: 'Pajak atas bunga rekening', active: true },
    { id: 'rule-bunga', keyword: 'BUNGA', direction: 'in', action: 'account', accountId: accountId('7101'), label: 'Bunga rekening', active: true },
    { id: 'rule-adm', keyword: 'BIAYA ADM', direction: 'out', action: 'account', accountId: accountId('6205'), label: 'Biaya administrasi bank', active: true },
    { id: 'rule-qris', keyword: 'QRIS', direction: 'in', action: 'settlement', label: 'QRIS', active: true },
    { id: 'rule-edc', keyword: 'EDC', direction: 'in', action: 'settlement', label: 'EDC', active: true },
    { id: 'rule-merchant', keyword: 'MERCHANT', direction: 'in', action: 'settlement', label: 'Merchant', active: true },
  ];
}
