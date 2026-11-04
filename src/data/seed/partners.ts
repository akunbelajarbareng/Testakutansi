import type { CustomerTier, Partner, PartnerKind } from '../../domain/types';
import { accountId } from './coa';

export const partnerId = (slug: string) => `ptn-${slug}`;

/** Akun piutang bawaan per tier: Grosir → 1201, UKM Kuliner → 1202, Retail → 1201. */
export const RECEIVABLE_BY_TIER: Record<CustomerTier, string> = { grosir: '1201', ukm: '1202', retail: '1201' };

export function makePartner(p: {
  id: string;
  name: string;
  kind: PartnerKind;
  tier?: CustomerTier | null;
  paymentTermDays?: number;
  creditLimit?: number;
  address?: string;
  phone?: string;
  npwp?: string;
}): Partner {
  const tier = p.kind === 'supplier' ? null : (p.tier ?? 'retail');
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    tier,
    paymentTermDays: p.paymentTermDays ?? 0,
    creditLimit: p.creditLimit ?? 0,
    receivableAccountId: accountId(RECEIVABLE_BY_TIER[tier ?? 'retail']),
    payableAccountId: accountId('2101'),
    address: p.address ?? '',
    phone: p.phone ?? '',
    npwp: p.npwp ?? '',
    taxIdType: 'TIN',
    nitku: '',
    active: true,
  };
}

/** Kontak contoh — nama fiktif. */
export function seedPartners(): Partner[] {
  return [
    makePartner({ id: partnerId('sinar-jaya'), name: 'Toko Sinar Jaya', kind: 'customer', tier: 'grosir', paymentTermDays: 30, creditLimit: 25_000_000, address: 'Jl. Sudirman, Watampone', npwp: '0987654321098765' }),
    makePartner({ id: partnerId('daeng'), name: 'Warung Makan Daeng', kind: 'customer', tier: 'ukm', paymentTermDays: 14, creditLimit: 10_000_000 }),
    makePartner({ id: partnerId('kopi-bone'), name: 'Kafe Kopi Bone', kind: 'customer', tier: 'ukm', paymentTermDays: 14, creditLimit: 5_000_000, address: 'Jl. Ahmad Yani, Watampone', npwp: '0876543210987654' }),
    makePartner({ id: partnerId('umum'), name: 'Pelanggan Umum', kind: 'customer', tier: 'retail' }),
    makePartner({ id: partnerId('tepung-makmur'), name: 'CV Tepung Makmur', kind: 'supplier', paymentTermDays: 30, npwp: '0765432109876543' }),
    makePartner({ id: partnerId('frozen-sulawesi'), name: 'PT Frozen Sulawesi', kind: 'supplier', paymentTermDays: 14, npwp: '0654321098765432' }),
    makePartner({ id: partnerId('tani-bone'), name: 'UD Tani Bone', kind: 'supplier', paymentTermDays: 7 }),
    makePartner({ id: partnerId('pemilik-ruko'), name: 'Pemilik Ruko Jl. Sudirman', kind: 'supplier', paymentTermDays: 0 }),
  ];
}
