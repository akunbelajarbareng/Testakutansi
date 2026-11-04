import { useEffect, useRef, useState } from 'react';
import { levelFor, splitByPlan, validateDistribution, type Account, type AnalyticDistribution } from '../domain';
import { useLedgerData } from '../store/ledgerStore';
import { Button, inputClass } from './ui';

/** Ringkasan distribusi: "Grosir 60% · UKM 30% …" */
export function DistributionSummary({ value, empty = 'Belum diisi' }: { value?: AnalyticDistribution; empty?: string }) {
  const data = useLedgerData();
  const parts = Object.entries(value ?? {}).map(([id, pct]) => {
    const aa = data.analyticAccounts.find((a) => a.id === id);
    return `${aa?.name ?? '?'} ${pct}%`;
  });
  return <span className={parts.length ? 'text-ink' : 'text-ink-soft'}>{parts.length ? parts.join(', ') : empty}</span>;
}

/**
 * Editor distribusi multi-dimensi. Bila `account` diberikan, dimensi yang tidak tersedia untuk
 * akun itu disembunyikan. Bila `planId` diberikan, hanya dimensi itu yang ditampilkan.
 */
export function DistributionEditor({
  value,
  onChange,
  account,
  planId,
}: {
  value: AnalyticDistribution;
  onChange: (v: AnalyticDistribution) => void;
  account?: Pick<Account, 'type' | 'group'>;
  planId?: string;
}) {
  const data = useLedgerData();
  const plans = data.analyticPlans.filter((p) => (!planId || p.id === planId) && (!account || levelFor(p, account) !== 'unavailable'));
  const byPlan = splitByPlan(value, data);
  const setPlan = (pid: string, rows: [string, number][]) => {
    const next = new Map(byPlan);
    const clean = rows.filter(([id]) => id);
    if (clean.length) next.set(pid, Object.fromEntries(clean));
    else next.delete(pid);
    onChange(Object.assign({}, ...next.values()));
  };
  const issues = validateDistribution(value, data);

  if (!plans.length) return <p className="text-xs text-ink-soft">Akun ini tidak memakai dimensi analitik.</p>;
  return (
    <div className="space-y-3">
      {plans.map((p) => {
        const rows = Object.entries(byPlan.get(p.id) ?? {});
        const options = data.analyticAccounts.filter((a) => a.planId === p.id && a.active).sort((a, b) => a.code.localeCompare(b.code));
        const sum = Math.round(rows.reduce((s, [, v]) => s + v, 0) * 100) / 100;
        return (
          <div key={p.id}>
            <div className="mb-1 flex items-center justify-between text-xs font-semibold text-ink-soft">
              <span>
                {p.name}
                {account && levelFor(p, account) === 'mandatory' && <span className="ml-1 text-bad">wajib</span>}
              </span>
              {rows.length > 0 && <span className={sum === 100 ? 'text-ok' : 'text-bad'}>{sum}%</span>}
            </div>
            {rows.map(([id, pct], i) => (
              <div key={i} className="mb-1 flex gap-1.5">
                <select
                  className={`${inputClass} py-1.5`}
                  value={id}
                  onChange={(e) => setPlan(p.id, rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))}
                  aria-label={`Akun ${p.name} ${i + 1}`}
                >
                  <option value="">Pilih…</option>
                  {options.map((o) => (
                    <option key={o.id} value={o.id} disabled={o.id !== id && rows.some((r) => r[0] === o.id)}>
                      {o.parentId ? '— ' : ''}{o.name}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.01}
                  className={`${inputClass} num w-20 py-1.5 text-right`}
                  value={pct}
                  onChange={(e) => setPlan(p.id, rows.map((r, j) => (j === i ? [r[0], Number(e.target.value)] : r)))}
                  aria-label={`Persen ${p.name} ${i + 1}`}
                />
                <button type="button" className="px-1.5 text-ink-soft hover:text-bad" onClick={() => setPlan(p.id, rows.filter((_, j) => j !== i))} aria-label="Hapus">✕</button>
              </div>
            ))}
            <button
              type="button"
              className="text-xs text-navy-600 hover:underline"
              onClick={() => {
                const rest = Math.max(0, Math.round((100 - sum) * 100) / 100);
                const firstFree = options.find((o) => !rows.some((r) => r[0] === o.id));
                if (firstFree) setPlan(p.id, [...rows, [firstFree.id, rest || 100]]);
              }}
            >
              + {p.name}
            </button>
          </div>
        );
      })}
      {issues.length > 0 && <p className="text-xs text-bad">{issues.join(' ')}</p>}
    </div>
  );
}

/** Sel ringkas di tabel baris: ringkasan + popover editor. */
export function DistributionCell({ value, onChange, account }: { value?: AnalyticDistribution; onChange: (v: AnalyticDistribution | undefined) => void; account?: Pick<Account, 'type' | 'group' | 'code'> }) {
  const data = useLedgerData();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<AnalyticDistribution>(value ?? {});
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => setDraft(value ?? {}), [value]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (account && data.analyticPlans.every((p) => levelFor(p, account) === 'unavailable')) return <span className="text-xs text-ink-soft">-</span>;
  const auto = account && data.analyticAccounts.find((a) => a.autoAccountCodes?.includes(account.code));
  return (
    <div className="relative" ref={ref}>
      <button type="button" className="w-full rounded-md border border-dashed border-line px-2 py-1.5 text-left text-xs hover:border-navy-600" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <DistributionSummary value={value} empty={auto ? `Otomatis: ${auto.name}` : 'Otomatis / belum diisi'} />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-80 rounded-lg border border-line bg-white p-3 shadow-lg">
          <DistributionEditor value={draft} onChange={setDraft} account={account} />
          <div className="mt-3 flex gap-2">
            <Button
              variant="primary"
              disabled={validateDistribution(draft, data).length > 0}
              onClick={() => {
                onChange(Object.keys(draft).length ? draft : undefined);
                setOpen(false);
              }}
            >
              Pakai
            </Button>
            <Button variant="ghost" onClick={() => { setDraft({}); onChange(undefined); setOpen(false); }}>Kosongkan</Button>
          </div>
          <p className="mt-2 text-xs text-ink-soft">Kosong = diisi otomatis saat posting (pilar dari akun, model distribusi, atau outlet kas).</p>
        </div>
      )}
    </div>
  );
}
