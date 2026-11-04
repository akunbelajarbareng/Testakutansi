import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { allocate, analyticItems, isDescendant, splitByPlan, type AnalyticDistribution } from '../../domain';
import { firstDayOfMonth, formatAmount, formatDate, todayISO } from '../../lib/format';
import { useLedger, useLedgerData } from '../../store/ledgerStore';
import { DistributionEditor, DistributionSummary } from '../../components/DistributionEditor';
import { AccountSelect } from '../entries/AccountSelect';
import { Alert, Button, EmptyState, Field, PageHeader, Panel, errorMessage, inputClass, td, tdNum, th, thNum } from '../../components/ui';

export function AnalyticItemsPage() {
  const data = useLedgerData();
  const setDistribution = useLedger((s) => s.setDistribution);
  const [params, setParams] = useSearchParams();
  const today = todayISO();
  const from = params.get('dari') ?? firstDayOfMonth(today);
  const to = params.get('sampai') ?? today;
  const accountId = params.get('akun') ?? '';
  const aa = params.get('aa') ?? '';
  const missingParam = params.get('belum'); // '1' = dimensi mana pun, atau id dimensi
  const [planId, setPlanId] = useState(data.analyticPlans[0]?.id ?? '');
  const [dist, setDist] = useState<AnalyticDistribution>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const lock = data.company.lockDate;

  const update = (patch: Record<string, string | null>) => {
    const n = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k)));
    setParams(n, { replace: true });
    setSelected(new Set());
  };

  const items = useMemo(() => {
    const target = aa ? data.analyticAccounts.find((a) => a.id === aa) : undefined;
    return analyticItems(data, { from, to })
      .filter((i) => !accountId || i.account.id === accountId)
      .filter((i) => !missingParam || (missingParam === '1' ? i.missingPlans.length > 0 : !splitByPlan(i.analytic, data).has(missingParam)))
      .filter((i) => !target || Object.keys(splitByPlan(i.analytic, data).get(target.planId) ?? {}).some((id) => isDescendant(id, target.id, data)))
      .map((i) => {
        if (!target) return { ...i, shown: i.amount };
        const parts = allocate(i.amount, splitByPlan(i.analytic, data).get(target.planId)!);
        return { ...i, shown: Object.entries(parts).filter(([id]) => isDescendant(id, target.id, data)).reduce((s, [, v]) => s + v, 0) };
      });
  }, [data, from, to, accountId, aa, missingParam]);

  const key = (i: (typeof items)[number]) => `${i.ref.entryId}:${i.ref.lineId}`;
  const editable = items.filter((i) => !lock || i.date > lock);
  const chosen = items.filter((i) => selected.has(key(i)));

  const apply = async (clear: boolean) => {
    setMessage(null);
    try {
      const n = await setDistribution(chosen.map((i) => i.ref), planId, clear ? null : dist);
      setMessage({ tone: 'ok', text: `${n} baris diperbarui. Saldo akun tidak berubah.` });
      setSelected(new Set());
    } catch (e) {
      setMessage({ tone: 'error', text: errorMessage(e) });
    }
  };

  return (
    <>
      <PageHeader title="Edit Analitik" subtitle="Baris pendapatan & beban beserta distribusinya. Pilih beberapa baris untuk memasang distribusi sekaligus." />
      <div className="space-y-4">
        {message && <Alert tone={message.tone}>{message.text}</Alert>}
        <Panel className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Dari"><input type="date" className={inputClass} value={from} onChange={(e) => update({ dari: e.target.value })} /></Field>
          <Field label="Sampai"><input type="date" className={inputClass} value={to} onChange={(e) => update({ sampai: e.target.value })} /></Field>
          <div className="lg:col-span-2">
            <Field label="Akun">
              <AccountSelect accounts={data.accounts.filter((a) => a.type === 'income' || a.type === 'expense')} value={accountId} onChange={(v) => update({ akun: v || null })} />
            </Field>
          </div>
          <Field label="Tampilkan">
            <select className={inputClass} value={missingParam ?? ''} onChange={(e) => update({ belum: e.target.value || null, aa: null })}>
              <option value="">Semua baris</option>
              <option value="1">Belum lengkap (dimensi disarankan)</option>
              {data.analyticPlans.map((p) => <option key={p.id} value={p.id}>Belum ada {p.name}</option>)}
            </select>
          </Field>
        </Panel>
        {aa && (
          <Alert tone="info">
            Difilter ke {data.analyticAccounts.find((a) => a.id === aa)?.name}; kolom jumlah menunjukkan porsi untuknya. <button type="button" className="underline" onClick={() => update({ aa: null })}>Hapus filter</button>
          </Alert>
        )}

        {chosen.length > 0 && (
          <Panel className="border-orange/40 p-5">
            <h2 className="mb-3 text-base font-semibold text-navy">Pasang distribusi ke {chosen.length} baris</h2>
            <div className="grid gap-4 md:grid-cols-[200px_1fr]">
              <Field label="Dimensi">
                <select className={inputClass} value={planId} onChange={(e) => { setPlanId(e.target.value); setDist({}); }}>
                  {data.analyticPlans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
              <DistributionEditor value={dist} onChange={setDist} planId={planId} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="primary" disabled={!Object.keys(dist).length} onClick={() => apply(false)}>Pasang ke {chosen.length} baris</Button>
              <Button variant="ghost" onClick={() => apply(true)}>Kosongkan dimensi ini</Button>
            </div>
            <p className="mt-2 text-xs text-ink-soft">Hanya dimensi terpilih yang diganti; dimensi lain di baris itu tetap.</p>
          </Panel>
        )}

        <Panel>
          {items.length === 0 ? (
            <EmptyState title="Tidak ada baris yang cocok dengan filter." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse">
                <thead>
                  <tr>
                    <th className={`${th} w-10`}>
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-navy"
                        checked={editable.length > 0 && selected.size === editable.length}
                        onChange={() => setSelected(selected.size === editable.length ? new Set() : new Set(editable.map(key)))}
                        aria-label="Pilih semua"
                      />
                    </th>
                    <th className={th}>Tanggal</th>
                    <th className={th}>Entri</th>
                    <th className={th}>Akun</th>
                    <th className={thNum}>Jumlah</th>
                    <th className={th}>Distribusi</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => {
                    const locked = !!lock && i.date <= lock;
                    return (
                      <tr key={key(i)} className={locked ? 'text-ink-soft' : ''}>
                        <td className={td}>
                          {!locked && (
                            <input
                              type="checkbox"
                              className="h-4 w-4 accent-navy"
                              checked={selected.has(key(i))}
                              onChange={(e) => {
                                const n = new Set(selected);
                                if (e.target.checked) n.add(key(i));
                                else n.delete(key(i));
                                setSelected(n);
                              }}
                              aria-label={`Pilih ${i.entry.number} ${i.account.code}`}
                            />
                          )}
                        </td>
                        <td className={`${td} whitespace-nowrap`}>{formatDate(i.date)}</td>
                        <td className={td}>
                          <Link className="text-navy-600 hover:underline" to={`/entri/${i.entry.id}`}>{i.entry.number}</Link>
                          <div className="max-w-xs truncate text-xs text-ink-soft">{i.label}</div>
                        </td>
                        <td className={td}><span className="num text-ink-soft">{i.account.code}</span> {i.account.name}</td>
                        <td className={tdNum}>{formatAmount(i.shown)}</td>
                        <td className={`${td} text-xs`}>
                          <DistributionSummary value={i.analytic} />
                          {i.missingPlans.length > 0 && (
                            <span className="ml-2 rounded-full bg-orange-100 px-2 py-0.5 text-orange-600">
                              belum: {i.missingPlans.map((p) => data.analyticPlans.find((x) => x.id === p)?.name).join(', ')}
                            </span>
                          )}
                          {locked && <span className="ml-2 text-ink-soft">(periode ditutup)</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <p className="text-xs text-ink-soft">{items.length} baris. Jumlah bertanda laba: pendapatan positif, beban negatif.</p>
      </div>
    </>
  );
}
