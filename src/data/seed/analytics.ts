/**
 * Dimensi analitik bawaan: Pilar (6 pilar resmi Oriental) dan Outlet/Lokasi (contoh — sesuaikan).
 * Model distribusi dan anggaran di sini adalah data contoh.
 */
import type { AnalyticAccount, AnalyticPlan, Budget, DistributionModel } from '../../domain/types';
import { accountId } from './coa';

export const PLAN_PILAR = 'plan-pilar';
export const PLAN_OUTLET = 'plan-outlet';
export const aaId = (code: string) => `aa-${code}`;

export function seedPlans(): AnalyticPlan[] {
  return [
    {
      id: PLAN_PILAR,
      name: 'Pilar',
      // Tahap awal: "disarankan" (peringatan), bukan "wajib". Naikkan opex ke 'mandatory' setelah model distribusi matang.
      applicability: { revenue: 'recommended', cogs: 'recommended', opex: 'recommended', other: 'optional', tax: 'optional', balance: 'unavailable' },
    },
    {
      id: PLAN_OUTLET,
      name: 'Outlet/Lokasi',
      applicability: { revenue: 'optional', cogs: 'optional', opex: 'optional', other: 'optional', tax: 'unavailable', balance: 'unavailable' },
    },
  ];
}

export function seedAnalyticAccounts(): AnalyticAccount[] {
  const p = (code: string, name: string, auto: string[]): AnalyticAccount => ({ id: aaId(code), planId: PLAN_PILAR, code, name, autoAccountCodes: auto, active: true });
  const o = (code: string, name: string, parent?: string): AnalyticAccount => ({ id: aaId(code), planId: PLAN_OUTLET, code, name, parentId: parent ? aaId(parent) : undefined, active: true });
  return [
    p('P1', 'Oriental Retail', ['4101', '5101']),
    p('P2', 'Supply Chain UKM', ['4102', '5102']),
    p('P3', 'Oriental Grosir', ['4103', '5103']),
    p('P4', 'White Label', ['4104', '5104']),
    p('P5', 'Oriental Learn', ['4105']),
    p('P6', 'Waste Responsibility', ['4106']),
    o('L1', 'Toko Retail Watampone'),
    o('L2', 'Gudang'),
    o('L21', 'Gudang Kering', 'L2'),
    o('L22', 'Gudang Frozen', 'L2'),
    o('L3', 'Armada Distribusi'),
    o('L4', 'Kantor Pusat'),
  ];
}

export function seedDistributionModels(): DistributionModel[] {
  return [
    {
      id: 'dm-listrik',
      name: 'Listrik gudang & chiller',
      accountIds: [accountId('6202')],
      analytic: { [aaId('P3')]: 60, [aaId('P2')]: 30, [aaId('P1')]: 10, [aaId('L21')]: 40, [aaId('L22')]: 60 },
      active: true,
    },
    {
      id: 'dm-bbm',
      name: 'BBM & perawatan armada',
      accountIds: [accountId('6203')],
      analytic: { [aaId('P3')]: 70, [aaId('P2')]: 30, [aaId('L3')]: 100 },
      active: true,
    },
    {
      id: 'dm-mdr',
      name: 'MDR QRIS/EDC & admin bank',
      accountIds: [accountId('6205')],
      analytic: { [aaId('P1')]: 100, [aaId('L1')]: 100 },
      active: true,
    },
    {
      id: 'dm-kemasan',
      name: 'Kemasan',
      accountIds: [accountId('6204')],
      analytic: { [aaId('P1')]: 50, [aaId('P2')]: 50 },
      active: true,
    },
  ];
}

/** Contoh anggaran 2026 (per bulan, sama rata). */
export function seedBudget(): Budget {
  const flat = (v: number) => Array(12).fill(v);
  const line = (id: string, code: string, v: number, pillar?: string) => ({ id, accountId: accountId(code), analyticAccountId: pillar ? aaId(pillar) : undefined, amounts: flat(v) });
  return {
    id: 'budget-2026',
    year: '2026',
    name: 'Anggaran 2026',
    updatedAt: new Date().toISOString(),
    lines: [
      line('bl-1', '4101', 12_000_000),
      line('bl-2', '4102', 4_000_000),
      line('bl-3', '4103', 18_000_000),
      line('bl-4', '6202', 3_000_000),
      line('bl-5', '6203', 1_500_000),
      line('bl-6', '6205', 300_000),
      line('bl-7', '6204', 500_000),
    ],
  };
}
