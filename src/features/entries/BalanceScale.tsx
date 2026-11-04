import { formatRupiah } from '../../lib/format';

/**
 * Timbangan debit–kredit: balok miring ke sisi yang lebih berat dan
 * kembali datar saat entri seimbang. Indikator utama form entri jurnal.
 */
export function BalanceScale({ debit, credit }: { debit: number; credit: number }) {
  const max = Math.max(debit, credit);
  const diff = debit - credit;
  const balanced = diff === 0 && max > 0;
  const angle = max === 0 ? 0 : Math.max(-9, Math.min(9, ((credit - debit) / max) * 9));
  const tone = balanced ? 'text-ok' : max === 0 ? 'text-ink-soft' : 'text-orange-600';

  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 sm:gap-8" aria-live="polite">
      <div className="text-right">
        <div className="text-xs text-ink-soft">Total debit</div>
        <div className="num text-lg font-semibold text-ink sm:text-xl">{formatRupiah(debit)}</div>
      </div>

      <div className="flex w-28 flex-col items-center sm:w-44" aria-hidden>
        <div
          className="h-1.5 w-full rounded-full transition-transform duration-500 ease-out"
          style={{
            transform: `rotate(${angle}deg)`,
            backgroundColor: balanced ? '#0E7C70' : max === 0 ? '#DCE1E8' : '#E8741A',
          }}
        />
        <div
          className="mt-0.5 h-0 w-0 border-x-[9px] border-b-[14px] border-x-transparent"
          style={{ borderBottomColor: '#13294B' }}
        />
      </div>

      <div>
        <div className="text-xs text-ink-soft">Total kredit</div>
        <div className="num text-lg font-semibold text-ink sm:text-xl">{formatRupiah(credit)}</div>
      </div>

      <p className={`col-span-3 text-center text-sm font-medium ${tone}`}>
        {max === 0
          ? 'Isi nominal di baris jurnal'
          : balanced
            ? 'Seimbang — siap diposting'
            : `Selisih ${formatRupiah(Math.abs(diff))}, ${diff > 0 ? 'debit' : 'kredit'} lebih besar`}
      </p>
    </div>
  );
}
