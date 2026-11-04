import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import type { EntryStatus } from '../domain';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-orange text-white border-orange hover:bg-orange-600 hover:border-orange-600',
  secondary: 'bg-white text-ink border-line hover:border-navy-600',
  danger: 'bg-white text-bad border-line hover:bg-bad-100 hover:border-bad',
  ghost: 'bg-transparent text-ink-soft border-transparent hover:text-ink hover:bg-navy-100',
};
const BASE =
  'inline-flex items-center justify-center gap-2 rounded-md border px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50';

export function Button({
  variant = 'secondary',
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type={type} className={`${BASE} ${VARIANT[variant]} ${className}`} {...props} />;
}

export function LinkButton({ variant = 'secondary', className = '', ...props }: LinkProps & { variant?: Variant }) {
  return <Link className={`${BASE} ${VARIANT[variant]} ${className}`} {...props} />;
}

export const inputClass =
  'w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-soft/70 focus:border-navy-600 focus:outline-none focus:ring-2 focus:ring-navy-100 disabled:bg-paper';

export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-ink">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-bad">{error}</span> : hint ? <span className="mt-1 block text-xs text-ink-soft">{hint}</span> : null}
    </label>
  );
}

const STATUS: Record<EntryStatus, { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'bg-navy-100 text-navy' },
  posted: { label: 'Diposting', cls: 'bg-ok-100 text-ok' },
  reversed: { label: 'Dibalik', cls: 'bg-paper text-ink-soft border border-line' },
};

export function StatusBadge({ status }: { status: EntryStatus }) {
  const s = STATUS[status];
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>;
}

export function PageHeader({ title, subtitle, actions, back }: { title: string; subtitle?: ReactNode; actions?: ReactNode; back?: { to: string; label: string } }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {back && (
          <Link to={back.to} className="mb-1 inline-block text-sm text-navy-600 hover:underline">
            ← {back.label}
          </Link>
        )}
        <h1 className="text-2xl font-semibold tracking-tight text-navy">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-soft">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-lg border border-line bg-white ${className}`}>{children}</section>;
}

const ALERT = {
  error: 'border-bad/30 bg-bad-100 text-bad',
  warn: 'border-orange/30 bg-orange-100 text-orange-600',
  info: 'border-navy-600/20 bg-navy-100 text-navy',
  ok: 'border-ok/30 bg-ok-100 text-ok',
};

export function Alert({ tone = 'info', children }: { tone?: keyof typeof ALERT; children: ReactNode }) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-md border px-4 py-3 text-sm ${ALERT[tone]}`}>
      {children}
    </div>
  );
}

export function EmptyState({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <p className="text-sm text-ink-soft">{title}</p>
      {action}
    </div>
  );
}

/** Kelas tabel bersama — tabel dibungkus overflow-x-auto agar aman di HP. */
export const th = 'border-b border-line bg-paper px-3 py-2 text-left text-xs font-semibold text-ink-soft';
export const thNum = `${th} text-right`;
export const td = 'border-b border-line px-3 py-2 text-sm';
export const tdNum = `${td} num text-right whitespace-nowrap`;

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Terjadi kesalahan.';
}

const DOC_STATE: Record<string, { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'bg-navy-100 text-navy' },
  unpaid: { label: 'Belum dibayar', cls: 'bg-orange-100 text-orange-600' },
  partial: { label: 'Dibayar sebagian', cls: 'bg-orange-100 text-orange-600' },
  paid: { label: 'Lunas', cls: 'bg-ok-100 text-ok' },
  applied: { label: 'Diterapkan', cls: 'bg-paper text-ink-soft border border-line' },
  overdue: { label: 'Lewat jatuh tempo', cls: 'bg-bad-100 text-bad' },
  cancelled: { label: 'Dibatalkan', cls: 'bg-paper text-ink-soft border border-line' },
  posted: { label: 'Diposting', cls: 'bg-ok-100 text-ok' },
  matched: { label: 'Cocok', cls: 'bg-ok-100 text-ok' },
  unmatched: { label: 'Belum cocok', cls: 'bg-orange-100 text-orange-600' },
};

/** Badge status dokumen AR/AP & pembayaran. */
export function DocBadge({ state }: { state: keyof typeof DOC_STATE }) {
  const s = DOC_STATE[state];
  return <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>;
}
