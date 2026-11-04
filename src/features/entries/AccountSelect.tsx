import type { Account, AccountGroup } from '../../domain';
import { inputClass } from '../../components/ui';

interface Props {
  accounts: Account[];
  value: string;
  onChange: (id: string) => void;
  invalid?: boolean;
  'aria-label'?: string;
}

/** Pilih akun, dikelompokkan per kelompok COA. Akun nonaktif disembunyikan kecuali sedang terpilih. */
export function AccountSelect({ accounts, value, onChange, invalid, ...rest }: Props) {
  const visible = accounts
    .filter((a) => a.active || a.id === value)
    .sort((a, b) => a.code.localeCompare(b.code));
  const groups = new Map<AccountGroup, Account[]>();
  for (const a of visible) groups.set(a.group, [...(groups.get(a.group) ?? []), a]);

  return (
    <select
      className={`${inputClass} ${invalid ? 'border-bad' : ''}`}
      value={value}
      aria-label={rest['aria-label']}
      aria-invalid={invalid || undefined}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Pilih akun…</option>
      {[...groups.entries()].map(([group, list]) => (
        <optgroup key={group} label={group}>
          {list.map((a) => (
            <option key={a.id} value={a.id}>
              {a.code} {a.name}
              {a.active ? '' : ' (nonaktif)'}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
