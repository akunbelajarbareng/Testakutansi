import type { Journal } from '../../domain';
import { inputClass } from '../../components/ui';

/** Pilih rekening kas/bank. */
export function JournalPicker({ journals, value, onChange, label = 'Rekening' }: { journals: Journal[]; value: string; onChange: (id: string) => void; label?: string }) {
  return (
    <select className={`${inputClass} sm:w-72`} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      {journals.map((j) => (
        <option key={j.id} value={j.id}>
          {j.name}
          {j.accountNumber ? ` (${j.accountNumber})` : ''}
        </option>
      ))}
    </select>
  );
}

export const liquidityJournals = (journals: Journal[], type?: 'bank' | 'cash') =>
  journals.filter((j) => j.defaultAccountId && (type ? j.type === type : j.type === 'bank' || j.type === 'cash'));
