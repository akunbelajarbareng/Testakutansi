import type { Account, AccountType, JournalEntry } from './types';

export type NormalSide = 'debit' | 'credit';

const DEBIT_NORMAL: AccountType[] = ['asset', 'expense'];

/** Saldo normal akun: Aset & Beban = debit; Kewajiban, Ekuitas, Pendapatan = kredit. Akun kontra dibalik. */
export function normalSide(account: Pick<Account, 'type' | 'contra'>): NormalSide {
  const base: NormalSide = DEBIT_NORMAL.includes(account.type) ? 'debit' : 'credit';
  if (!account.contra) return base;
  return base === 'debit' ? 'credit' : 'debit';
}

/** Ubah selisih (debit - kredit) menjadi saldo bertanda menurut sisi normal akun. Positif = sesuai sisi normal. */
export function toNormalBalance(account: Pick<Account, 'type' | 'contra'>, debitMinusCredit: number): number {
  return normalSide(account) === 'debit' ? debitMinusCredit : -debitMinusCredit;
}

/** Entri yang memengaruhi saldo: semua kecuali draft. Entri yang dibalik tetap dihitung, karena pembaliknya menetralkan. */
export function affectsBalance(entry: Pick<JournalEntry, 'status'>): boolean {
  return entry.status !== 'draft';
}

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  asset: 'Aset',
  liability: 'Kewajiban',
  equity: 'Ekuitas',
  income: 'Pendapatan',
  expense: 'Beban',
};

/** Kelompok akun ditentukan oleh digit pertama kode (konvensi COA Oriental). */
export const CODE_PREFIX_TYPE: Record<string, AccountType> = {
  '1': 'asset',
  '2': 'liability',
  '3': 'equity',
  '4': 'income',
  '5': 'expense',
  '6': 'expense',
};
