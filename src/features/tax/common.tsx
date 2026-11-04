import { Link } from 'react-router-dom';
import { useLedgerData } from '../../store/ledgerStore';
import { Alert, inputClass } from '../../components/ui';
import { formatMonth } from '../../lib/format';

export function MonthPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="text-sm">
      <span className="mb-1 block font-medium">Masa pajak</span>
      <input type="month" className={`${inputClass} w-48`} value={value} onChange={(e) => e.target.value && onChange(e.target.value)} aria-label="Masa pajak" />
      <span className="mt-1 block text-xs text-ink-soft">{formatMonth(value)}</span>
    </label>
  );
}

export function TemplateWarning() {
  const { company } = useLedgerData();
  if (company.coretaxTemplateVerified) return null;
  return (
    <Alert tone="warn">
      Format ekspor Coretax belum diverifikasi dengan template resmi DJP terbaru. Jangan impor hasil ekspor ke Coretax untuk faktur sungguhan sebelum diuji.
      Lihat <Link className="underline" to="/pengaturan">Pengaturan → Pajak</Link>.
    </Alert>
  );
}

export const TAX_NAV = [
  { to: '/pajak', label: 'Ringkasan PPN' },
  { to: '/pajak/keluaran', label: 'Faktur Pajak Keluaran' },
  { to: '/pajak/eceran', label: 'Penjualan Eceran' },
  { to: '/pajak/masukan', label: 'PPN Masukan' },
];
