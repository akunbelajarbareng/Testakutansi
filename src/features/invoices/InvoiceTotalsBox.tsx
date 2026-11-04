import type { ReactNode } from 'react';
import type { InvoiceTotals } from '../../domain';
import { formatAmount } from '../../lib/format';

/** Ringkasan total dokumen: subtotal, DPP & PPN per jenis pajak, total, dan baris tambahan (dibayar, sisa). */
export function InvoiceTotalsBox({ totals, extra }: { totals: InvoiceTotals; extra?: { label: string; value: number; strong?: boolean; tone?: string }[] }) {
  return (
    <dl className="w-full max-w-sm text-sm">
      <Row label="Subtotal" value={formatAmount(totals.untaxed)} />
      {totals.taxes
        .filter((t) => t.tax.rate > 0)
        .map((t) => (
          <div key={t.tax.id}>
            {t.dpp !== t.base && <Row label={<span className="text-ink-soft">DPP nilai lain ({t.tax.dppNumerator}/{t.tax.dppDenominator})</span>} value={<span className="text-ink-soft">{formatAmount(t.dpp)}</span>} />}
            <Row label={t.tax.name} value={formatAmount(t.amount)} />
          </div>
        ))}
      <div className="mt-1 border-t border-line pt-1">
        <Row label={<span className="font-semibold">Total</span>} value={<span className="text-base font-semibold text-navy">{formatAmount(totals.total)}</span>} />
      </div>
      {extra?.filter((x) => x.strong || x.value !== 0).map((x) => (
        <Row
          key={x.label}
          label={<span className={x.strong ? 'font-semibold' : ''}>{x.label}</span>}
          value={<span className={`${x.strong ? 'font-semibold' : ''} ${x.tone ?? ''}`}>{formatAmount(x.value)}</span>}
        />
      ))}
    </dl>
  );
}

function Row({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-6 py-1">
      <dt>{label}</dt>
      <dd className="num text-right">{value}</dd>
    </div>
  );
}
