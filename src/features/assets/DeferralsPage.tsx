import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { deferralSchedule, type Deferral, type SourceCandidate } from '../../domain';
import { formatAmount, todayISO } from '../../lib/format';
import { newId } from '../../lib/id';
import { useLedger, useLedgerData } from '../../store/ledgerStore';
import { MoneyInput } from '../../components/MoneyInput';
import { DistributionEditor } from '../../components/DistributionEditor';
import { AccountSelect } from '../entries/AccountSelect';
import { Alert, Button, Field, PageHeader, Panel, errorMessage, inputClass, td, tdNum, th, thNum } from '../../components/ui';

export function DeferralsPage() {
  const data = useLedgerData();
  const store = useLedger();
  const state = useLocation().state as { candidate?: SourceCandidate; partner?: string } | null;
  const acc = (code: string) => data.accounts.find((a) => a.code === code)?.id ?? '';
  const fromCandidate = (c: SourceCandidate): Deferral => ({
    id: newId(),
    kind: c.target === 'revenue_deferral' ? 'revenue' : 'expense',
    name: `${c.description}${state?.partner ? ` — ${state.partner}` : ''}`,
    partnerId: c.partnerId,
    startMonth: c.date.slice(0, 7),
    months: 12,
    total: c.amount,
    deferralAccountId: c.accountId,
    recognitionAccountId: c.target === 'revenue_deferral' ? acc('4105') : acc('6201'),
    openingRecognized: 0,
    status: 'running',
    sourceInvoiceId: c.invoiceId,
    sourceLineId: c.lineId,
    createdAt: new Date().toISOString(),
  });
  const [edit, setEdit] = useState<Deferral | null>(state?.candidate ? fromCandidate(state.candidate) : null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const run = async (fn: () => Promise<void>, ok: string) => {
    setMessage(null);
    try {
      await fn();
      setMessage({ tone: 'ok', text: ok });
    } catch (e) {
      setMessage({ tone: 'error', text: errorMessage(e) });
    }
  };
  const recognizedSoFar = (d: Deferral) =>
    d.openingRecognized + data.depreciationRuns.filter((r) => r.status === 'posted').flatMap((r) => r.items).filter((i) => i.id === d.id).reduce((s, i) => s + i.amount, 0);
  const newBlank = (kind: Deferral['kind']): Deferral => ({
    id: newId(), kind, name: '', startMonth: todayISO().slice(0, 7), months: 12, total: 0,
    deferralAccountId: kind === 'expense' ? acc('1403') : acc('2303'), recognitionAccountId: kind === 'expense' ? acc('6201') : acc('4105'),
    openingRecognized: 0, status: 'running', createdAt: new Date().toISOString(),
  });

  return (
    <>
      <PageHeader
        title="Biaya & Pendapatan Ditangguhkan"
        subtitle="Biaya dibayar di muka (sewa, asuransi) diamortisasi; pendapatan diterima di muka diakui bertahap. Ikut run bulanan."
        actions={
          <>
            <Button onClick={() => setEdit(newBlank('revenue'))}>Pendapatan diterima di muka</Button>
            <Button variant="primary" onClick={() => setEdit(newBlank('expense'))}>Biaya dibayar di muka</Button>
          </>
        }
      />
      <div className="space-y-4">
        {message && <Alert tone={message.tone}>{message.text}</Alert>}
        {edit && (
          <Panel className="grid gap-4 p-5 lg:grid-cols-[2fr_1fr]">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2"><Field label="Nama"><input className={inputClass} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field></div>
              <Field label="Total"><MoneyInput value={edit.total} onChange={(v) => setEdit({ ...edit, total: v })} aria-label="Total" /></Field>
              <Field label="Bulan pertama"><input type="month" className={inputClass} value={edit.startMonth} onChange={(e) => setEdit({ ...edit, startMonth: e.target.value })} /></Field>
              <Field label="Jumlah bulan"><input type="number" min={1} className={`${inputClass} num`} value={edit.months} onChange={(e) => setEdit({ ...edit, months: Number.parseInt(e.target.value || '0', 10) })} /></Field>
              <Field label="Sudah diakui sebelumnya" hint="Untuk saldo awal"><MoneyInput value={edit.openingRecognized} onChange={(v) => setEdit({ ...edit, openingRecognized: v })} aria-label="Sudah diakui" /></Field>
              <Field label={edit.kind === 'expense' ? 'Akun dibayar di muka' : 'Akun diterima di muka'}>
                <AccountSelect accounts={data.accounts.filter((a) => a.type === (edit.kind === 'expense' ? 'asset' : 'liability'))} value={edit.deferralAccountId} onChange={(v) => setEdit({ ...edit, deferralAccountId: v })} />
              </Field>
              <Field label={edit.kind === 'expense' ? 'Diakui sebagai beban' : 'Diakui sebagai pendapatan'}>
                <AccountSelect accounts={data.accounts.filter((a) => a.type === (edit.kind === 'expense' ? 'expense' : 'income'))} value={edit.recognitionAccountId} onChange={(v) => setEdit({ ...edit, recognitionAccountId: v })} />
              </Field>
              <div className="sm:col-span-2">
                <div className="mb-1 text-sm font-medium">Pilar/outlet</div>
                <DistributionEditor value={edit.analytic ?? {}} onChange={(v) => setEdit({ ...edit, analytic: Object.keys(v).length ? v : undefined })} account={{ type: edit.kind === 'expense' ? 'expense' : 'income', group: edit.kind === 'expense' ? 'Beban Operasional' : 'Pendapatan' }} />
              </div>
              <div className="flex gap-2 sm:col-span-2">
                <Button variant="primary" onClick={() => run(async () => { await store.saveDeferral(edit); setEdit(null); }, 'Penangguhan disimpan.')}>Simpan</Button>
                <Button variant="ghost" onClick={() => setEdit(null)}>Batal</Button>
              </div>
            </div>
            <div>
              <div className="mb-1 text-sm font-medium">Jadwal</div>
              <div className="max-h-80 overflow-auto rounded-md border border-line">
                <table className="w-full text-sm">
                  <tbody>
                    {edit.total > 0 && edit.months > 0 && deferralSchedule(edit).map((r) => (
                      <tr key={r.period} className="border-b border-line"><td className="px-2 py-1">{r.period}</td><td className="num px-2 py-1 text-right">{formatAmount(r.amount)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Panel>
        )}

        <Panel>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse">
              <thead><tr><th className={th}>Jenis</th><th className={th}>Nama</th><th className={th}>Periode</th><th className={thNum}>Total</th><th className={thNum}>Sudah diakui</th><th className={thNum}>Sisa</th><th className={th} /></tr></thead>
              <tbody>
                {data.deferrals.map((d) => {
                  const rec = recognizedSoFar(d);
                  const src = d.sourceInvoiceId ? data.invoices.find((i) => i.id === d.sourceInvoiceId) : undefined;
                  return (
                    <tr key={d.id} className={d.status === 'cancelled' ? 'text-ink-soft' : ''}>
                      <td className={`${td} text-sm`}>{d.kind === 'expense' ? 'Dibayar di muka' : 'Diterima di muka'}</td>
                      <td className={td}>{d.name}{src && <div className="text-xs text-ink-soft">dari {src.number}</div>}</td>
                      <td className={`${td} whitespace-nowrap text-sm`}>{d.startMonth}, {d.months} bulan</td>
                      <td className={tdNum}>{formatAmount(d.total)}</td>
                      <td className={tdNum}>{formatAmount(rec)}</td>
                      <td className={`${tdNum} font-medium`}>{formatAmount(d.total - rec)}</td>
                      <td className={`${td} whitespace-nowrap text-right`}>
                        <Button variant="ghost" onClick={() => setEdit(d)}>Ubah</Button>
                        {d.status === 'running' && <Button variant="ghost" onClick={() => run(() => store.saveDeferral({ ...d, status: 'cancelled' }), 'Penangguhan dihentikan; sisa tidak lagi diakui otomatis.')}>Hentikan</Button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
        <p className="text-xs text-ink-soft">Pembayaran awalnya dicatat ke akun 1403 (biaya dibayar di muka) atau 2303 (pendapatan diterima di muka) lewat tagihan/faktur. <Link className="underline" to="/aset">Register Aset</Link> menampilkan baris tagihan yang belum punya jadwal.</p>
      </div>
    </>
  );
}
