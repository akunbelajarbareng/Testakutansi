import { useEffect, useState } from 'react';
import { formatAmount, parseRupiah } from '../lib/format';
import { inputClass } from './ui';

interface Props {
  value: number;
  onChange: (value: number) => void;
  onBlur?: () => void;
  disabled?: boolean;
  'aria-label'?: string;
  invalid?: boolean;
}

/** Input Rupiah: menampilkan pemisah ribuan, menyimpan bilangan bulat. Nol ditampilkan kosong. */
export function MoneyInput({ value, onChange, onBlur, disabled, invalid, ...rest }: Props) {
  const [text, setText] = useState(formatAmount(value, true));

  useEffect(() => {
    if (parseRupiah(text) !== value) setText(formatAmount(value, true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      inputMode="numeric"
      autoComplete="off"
      disabled={disabled}
      aria-label={rest['aria-label']}
      aria-invalid={invalid || undefined}
      className={`${inputClass} num text-right ${invalid ? 'border-bad' : ''}`}
      value={text}
      placeholder="0"
      onChange={(e) => {
        const n = parseRupiah(e.target.value);
        setText(n ? formatAmount(n) : '');
        onChange(n);
      }}
      onBlur={onBlur}
    />
  );
}
