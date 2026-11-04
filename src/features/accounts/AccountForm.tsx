import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { accountFormSchema, type AccountFormValues } from '../../domain/schemas';
import { ACCOUNT_TYPE_LABEL, CODE_PREFIX_TYPE, type Account, type AccountGroup, type AccountType } from '../../domain';
import { newId } from '../../lib/id';
import { useLedger } from '../../store/ledgerStore';
import { Alert, Button, Field, Panel, errorMessage, inputClass } from '../../components/ui';

const GROUPS_BY_TYPE: Record<AccountType, AccountGroup[]> = {
  asset: ['Aset Lancar', 'Aset Tetap'],
  liability: ['Kewajiban'],
  equity: ['Ekuitas'],
  income: ['Pendapatan', 'Pendapatan & Beban Lain'],
  expense: ['Harga Pokok Penjualan', 'Beban Operasional', 'Pendapatan & Beban Lain', 'Pajak Penghasilan'],
};

interface Props {
  account?: Account;
  /** Akun yang sudah dipakai di entri: kode & tipe dikunci agar laporan historis tidak bergeser. */
  inUse: boolean;
  onDone: () => void;
}

export function AccountForm({ account, inUse, onDone }: Props) {
  const saveAccount = useLedger((s) => s.saveAccount);
  const [error, setError] = useState<string | null>(null);

  const { register, handleSubmit, watch, setValue, formState } = useForm<AccountFormValues>({
    resolver: zodResolver(accountFormSchema),
    defaultValues: account
      ? { code: account.code, name: account.name, type: account.type, group: account.group, contra: !!account.contra, liquidity: !!account.liquidity }
      : { code: '', name: '', type: 'asset', group: 'Aset Lancar', contra: false, liquidity: false },
  });

  const code = watch('code');
  const type = watch('type');
  const group = watch('group');

  // Kode menentukan tipe untuk digit 1–6 (konvensi COA).
  useEffect(() => {
    const t = CODE_PREFIX_TYPE[code?.[0] ?? ''];
    if (t && t !== type && !inUse) setValue('type', t);
  }, [code, type, inUse, setValue]);

  useEffect(() => {
    if (!GROUPS_BY_TYPE[type].includes(group)) setValue('group', GROUPS_BY_TYPE[type][0]);
  }, [type, group, setValue]);

  const submit = (active: boolean) =>
    handleSubmit(async (values) => {
      setError(null);
      try {
        await saveAccount({ id: account?.id ?? newId(), ...values, active });
        onDone();
      } catch (e) {
        setError(errorMessage(e));
      }
    });

  const errors = formState.errors;
  return (
    <Panel className="mb-4 p-5">
      <h2 className="mb-4 text-base font-semibold text-navy">{account ? `Ubah akun ${account.code}` : 'Akun baru'}</h2>
      {error && <div className="mb-4"><Alert tone="error">{error}</Alert></div>}
      <form className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(e) => { e.preventDefault(); void submit(account?.active ?? true)(); }} noValidate>
        <Field label="Kode" error={errors.code?.message} hint={inUse ? 'Terkunci karena sudah dipakai di entri' : '4 digit, digit pertama = kelompok'}>
          <input className={`${inputClass} num`} inputMode="numeric" maxLength={4} disabled={inUse} {...register('code')} />
        </Field>
        <Field label="Nama akun" error={errors.name?.message}>
          <input className={inputClass} {...register('name')} />
        </Field>
        <Field label="Tipe" error={errors.type?.message}>
          <select className={inputClass} disabled={inUse} {...register('type')}>
            {Object.entries(ACCOUNT_TYPE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </Field>
        <Field label="Kelompok" error={errors.group?.message}>
          <select className={inputClass} {...register('group')}>
            {GROUPS_BY_TYPE[type].map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </Field>
        <label className="flex items-start gap-2 text-sm sm:col-span-2">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-navy" disabled={inUse} {...register('contra')} />
          <span>
            Akun kontra
            <span className="block text-xs text-ink-soft">Saldo normal berlawanan dengan tipenya, mis. akumulasi penyusutan atau retur penjualan.</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm sm:col-span-2">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-navy" {...register('liquidity')} />
          <span>
            Akun kas/bank
            <span className="block text-xs text-ink-soft">Ditampilkan di ringkasan kas & bank pada dashboard.</span>
          </span>
        </label>
        <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-4">
          <Button type="submit" variant="primary">Simpan akun</Button>
          {account && (
            <Button variant={account.active ? 'danger' : 'secondary'} onClick={() => void submit(!account.active)()}>
              {account.active ? 'Nonaktifkan' : 'Aktifkan kembali'}
            </Button>
          )}
          <Button variant="ghost" onClick={onDone}>Batal</Button>
        </div>
      </form>
    </Panel>
  );
}
