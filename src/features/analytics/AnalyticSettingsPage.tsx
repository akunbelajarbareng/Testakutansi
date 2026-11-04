import { useState } from 'react';
import type { AnalyticAccount, AnalyticDistribution, Applicability, ApplicabilityKey, DistributionModel } from '../../domain';
import { newId } from '../../lib/id';
import { useLedger, useLedgerData } from '../../store/ledgerStore';
import { DistributionEditor, DistributionSummary } from '../../components/DistributionEditor';
import { Alert, Button, Field, PageHeader, Panel, errorMessage, inputClass, td, th } from '../../components/ui';

const KEYS: [ApplicabilityKey, string][] = [
  ['revenue', 'Pendapatan'],
  ['cogs', 'HPP'],
  ['opex', 'Beban operasional'],
  ['other', 'Lain-lain'],
  ['tax', 'Pajak penghasilan'],
];
const LEVELS: [Applicability, string][] = [
  ['mandatory', 'Wajib (blokir posting)'],
  ['recommended', 'Disarankan (peringatan)'],
  ['optional', 'Opsional'],
  ['unavailable', 'Tidak tersedia'],
];

export function AnalyticSettingsPage() {
  const data = useLedgerData();
  const store = useLedger();
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [acc, setAcc] = useState<AnalyticAccount | null>(null);
  const [model, setModel] = useState<DistributionModel | null>(null);
  const run = async (fn: () => Promise<void>, ok: string) => {
    setMessage(null);
    try {
      await fn();
      setMessage({ tone: 'ok', text: ok });
    } catch (e) {
      setMessage({ tone: 'error', text: errorMessage(e) });
    }
  };
  const pnlAccounts = data.accounts.filter((a) => (a.type === 'income' || a.type === 'expense') && a.active).sort((a, b) => a.code.localeCompare(b.code));

  return (
    <>
      <PageHeader title="Dimensi & Model Distribusi" subtitle="Atur dimensi analitik, akun analitiknya, aturan kelengkapan, dan model distribusi otomatis." />
      <div className="space-y-4">
        {message && <Alert tone={message.tone}>{message.text}</Alert>}

        <div className="grid gap-4 lg:grid-cols-2">
          {data.analyticPlans.map((plan) => {
            const accounts = data.analyticAccounts.filter((a) => a.planId === plan.id).sort((a, b) => a.code.localeCompare(b.code));
            const roots = accounts.filter((a) => !a.parentId);
            return (
              <Panel key={plan.id} className="p-5">
                <div className="flex items-baseline justify-between">
                  <h2 className="text-base font-semibold text-navy">{plan.name}</h2>
                  <Button variant="ghost" onClick={() => setAcc({ id: newId(), planId: plan.id, code: '', name: '', active: true })}>+ Akun</Button>
                </div>
                <ul className="mt-2 divide-y divide-line text-sm">
                  {roots.map((r) => (
                    <li key={r.id} className="py-1.5">
                      <button type="button" className={`text-left hover:underline ${r.active ? '' : 'text-ink-soft'}`} onClick={() => setAcc(r)}>
                        <span className="num mr-2 text-ink-soft">{r.code}</span>{r.name}
                      </button>
                      {r.autoAccountCodes?.length ? <span className="ml-2 text-xs text-ink-soft">otomatis dari {r.autoAccountCodes.join(', ')}</span> : null}
                      {accounts.filter((c) => c.parentId === r.id).map((c) => (
                        <div key={c.id} className="ml-6 mt-1">
                          <button type="button" className="text-left hover:underline" onClick={() => setAcc(c)}>
                            <span className="num mr-2 text-ink-soft">{c.code}</span>{c.name}
                          </button>
                        </div>
                      ))}
                    </li>
                  ))}
                </ul>

                {acc && acc.planId === plan.id && (
                  <div className="mt-3 grid gap-3 rounded-md border border-line p-3 sm:grid-cols-3">
                    <Field label="Kode"><input className={`${inputClass} uppercase`} value={acc.code} onChange={(e) => setAcc({ ...acc, code: e.target.value })} /></Field>
                    <Field label="Nama"><input className={inputClass} value={acc.name} onChange={(e) => setAcc({ ...acc, name: e.target.value })} /></Field>
                    <Field label="Induk">
                      <select className={inputClass} value={acc.parentId ?? ''} onChange={(e) => setAcc({ ...acc, parentId: e.target.value || undefined })}>
                        <option value="">(tingkat atas)</option>
                        {roots.filter((r) => r.id !== acc.id).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                    </Field>
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-navy" checked={acc.active} onChange={(e) => setAcc({ ...acc, active: e.target.checked })} />Aktif</label>
                    <div className="flex gap-2 sm:col-span-2">
                      <Button variant="primary" onClick={() => run(async () => { await store.saveAnalyticAccount(acc); setAcc(null); }, 'Akun analitik disimpan.')}>Simpan</Button>
                      <Button variant="ghost" onClick={() => setAcc(null)}>Batal</Button>
                    </div>
                  </div>
                )}

                <h3 className="mb-2 mt-4 text-sm font-semibold text-ink">Aturan kelengkapan</h3>
                <table className="w-full text-sm">
                  <tbody>
                    {KEYS.map(([k, label]) => (
                      <tr key={k}>
                        <td className="py-1 pr-2">{label}</td>
                        <td className="py-1">
                          <select
                            className={`${inputClass} py-1.5`}
                            value={plan.applicability[k]}
                            onChange={(e) => run(() => store.savePlan({ ...plan, applicability: { ...plan.applicability, [k]: e.target.value as Applicability } }), `Aturan ${plan.name} diperbarui.`)}
                            aria-label={`${plan.name} untuk ${label}`}
                          >
                            {LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-1 text-xs text-ink-soft">Akun neraca tidak pernah memakai dimensi analitik.</p>
              </Panel>
            );
          })}
        </div>

        <Panel className="p-5">
          <h2 className="text-base font-semibold text-navy">Distribusi bawaan per rekening kas/bank</h2>
          <p className="mt-1 text-sm text-ink-soft">Dipakai untuk baris pendapatan/beban yang dicatat lewat rekening ini, mis. rekap eceran Kas Toko → outlet Toko.</p>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            {data.journals.filter((j) => j.type === 'cash' || j.type === 'bank').map((j) => (
              <JournalDefault key={j.id} name={j.name} value={j.defaultAnalytic} onSave={(d) => run(() => store.setJournalAnalytic(j.id, d), `Distribusi bawaan ${j.name} disimpan.`)} />
            ))}
          </div>
        </Panel>

        <Panel>
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="font-semibold text-navy">Model distribusi</h2>
            <Button variant="primary" onClick={() => setModel({ id: newId(), name: '', accountIds: [], analytic: {}, active: true })}>Model baru</Button>
          </div>
          {model && (
            <div className="grid gap-4 border-b border-line p-5 md:grid-cols-2">
              <div className="space-y-3">
                <Field label="Nama model"><input className={inputClass} value={model.name} onChange={(e) => setModel({ ...model, name: e.target.value })} /></Field>
                <Field label="Berlaku untuk akun" hint="Ctrl/Cmd + klik untuk memilih beberapa">
                  <select multiple className={`${inputClass} h-40`} value={model.accountIds} onChange={(e) => setModel({ ...model, accountIds: [...e.target.selectedOptions].map((o) => o.value) })}>
                    {pnlAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                  </select>
                </Field>
                <Field label="Hanya untuk kontak (opsional)">
                  <select className={inputClass} value={model.partnerId ?? ''} onChange={(e) => setModel({ ...model, partnerId: e.target.value || undefined })}>
                    <option value="">Semua kontak</option>
                    {data.partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </Field>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-navy" checked={model.active} onChange={(e) => setModel({ ...model, active: e.target.checked })} />Aktif</label>
              </div>
              <div>
                <div className="mb-1 text-sm font-medium">Distribusi</div>
                <DistributionEditor value={model.analytic} onChange={(v) => setModel({ ...model, analytic: v })} />
                <div className="mt-4 flex gap-2">
                  <Button variant="primary" onClick={() => run(async () => { await store.saveModel(model); setModel(null); }, 'Model distribusi disimpan.')}>Simpan model</Button>
                  <Button variant="ghost" onClick={() => setModel(null)}>Batal</Button>
                </div>
              </div>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse">
              <thead><tr><th className={th}>Model</th><th className={th}>Akun</th><th className={th}>Distribusi</th><th className={th} /></tr></thead>
              <tbody>
                {data.distributionModels.map((m) => (
                  <tr key={m.id} className={m.active ? '' : 'text-ink-soft'}>
                    <td className={`${td} font-medium`}>
                      {m.name}
                      {m.partnerId && <div className="text-xs font-normal text-ink-soft">khusus {data.partners.find((p) => p.id === m.partnerId)?.name}</div>}
                    </td>
                    <td className={`${td} text-sm`}>{m.accountIds.map((id) => data.accounts.find((a) => a.id === id)?.code).join(', ')}</td>
                    <td className={`${td} text-xs`}><DistributionSummary value={m.analytic} /></td>
                    <td className={`${td} whitespace-nowrap text-right`}>
                      <Button variant="ghost" onClick={() => setModel(m)}>Ubah</Button>
                      <Button variant="ghost" onClick={() => run(() => store.deleteModel(m.id), 'Model dihapus.')}>Hapus</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-5 py-3 text-xs text-ink-soft">Model diterapkan saat entri diposting, hanya untuk dimensi yang belum diisi. Model khusus kontak didahulukan. Mengubah model tidak mengubah entri yang sudah ada; gunakan Edit Analitik untuk itu.</p>
        </Panel>
      </div>
    </>
  );
}

function JournalDefault({ name, value, onSave }: { name: string; value?: AnalyticDistribution; onSave: (d: AnalyticDistribution | undefined) => void }) {
  const [d, setD] = useState<AnalyticDistribution>(value ?? {});
  return (
    <div className="rounded-md border border-line p-3">
      <div className="mb-2 text-sm font-medium">{name}</div>
      <DistributionEditor value={d} onChange={setD} />
      <Button className="mt-2" onClick={() => onSave(Object.keys(d).length ? d : undefined)}>Simpan</Button>
    </div>
  );
}
