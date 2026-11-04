import { monthEnd, shiftMonth, type DateRange } from '../../domain';
import { todayISO } from '../../lib/format';
import { inputClass } from '../../components/ui';

export type Preset = 'thisMonth' | 'lastMonth' | 'thisQuarter' | 'thisYear' | 'lastYear' | 'custom';

export function presetRange(p: Preset, today = todayISO()): DateRange | null {
  const ym = today.slice(0, 7);
  const y = Number(today.slice(0, 4));
  switch (p) {
    case 'thisMonth':
      return { from: `${ym}-01`, to: monthEnd(ym) };
    case 'lastMonth': {
      const m = shiftMonth(ym, -1);
      return { from: `${m}-01`, to: monthEnd(m) };
    }
    case 'thisQuarter': {
      const q = Math.floor((Number(today.slice(5, 7)) - 1) / 3);
      const start = `${y}-${String(q * 3 + 1).padStart(2, '0')}`;
      return { from: `${start}-01`, to: monthEnd(shiftMonth(start, 2)) };
    }
    case 'thisYear':
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    case 'lastYear':
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    default:
      return null;
  }
}

export const PRESET_LABEL: Record<Preset, string> = {
  thisMonth: 'Bulan ini',
  lastMonth: 'Bulan lalu',
  thisQuarter: 'Kuartal ini',
  thisYear: 'Tahun ini',
  lastYear: 'Tahun lalu',
  custom: 'Pilih tanggal',
};

export function PeriodControls({ preset, range, onChange }: { preset: Preset; range: DateRange; onChange: (preset: Preset, range: DateRange) => void }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-sm">
        <span className="mb-1 block font-medium">Periode</span>
        <select
          className={`${inputClass} w-40`}
          value={preset}
          onChange={(e) => {
            const p = e.target.value as Preset;
            onChange(p, presetRange(p) ?? range);
          }}
        >
          {Object.entries(PRESET_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </label>
      <label className="text-sm">
        <span className="mb-1 block font-medium">Dari</span>
        <input type="date" className={inputClass} value={range.from} onChange={(e) => onChange('custom', { ...range, from: e.target.value })} />
      </label>
      <label className="text-sm">
        <span className="mb-1 block font-medium">Sampai</span>
        <input type="date" className={inputClass} value={range.to} onChange={(e) => onChange('custom', { ...range, to: e.target.value })} />
      </label>
    </div>
  );
}

/** Kop laporan untuk cetak. */
export function ReportHeading({ company, title, subtitle }: { company: string; title: string; subtitle: string }) {
  return (
    <div className="mb-4 hidden border-b-4 border-orange pb-3 print:block">
      <div className="text-lg font-semibold text-navy">{company}</div>
      <div className="text-base font-semibold">{title}</div>
      <div className="text-sm text-ink-soft">{subtitle}</div>
    </div>
  );
}
