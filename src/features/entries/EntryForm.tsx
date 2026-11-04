import { useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useLocation, useNavigate } from 'react-router-dom';
import { entryFormSchema, type EntryFormValues } from '../../domain/schemas';
import { entryTotals, isPeriodLocked, type JournalEntry } from '../../domain';
import { formatDate, todayISO } from '../../lib/format';
import { newId } from '../../lib/id';
import { useLedger, useLedgerData } from '../../store/ledgerStore';
import { MoneyInput } from '../../components/MoneyInput';
import { DistributionCell } from '../../components/DistributionEditor';
import { Alert, Button, Field, PageHeader, Panel, StatusBadge, errorMessage, inputClass, th, thNum } from '../../components/ui';
import { AccountSelect } from './AccountSelect';
import { BalanceScale } from './BalanceScale';

type Line = EntryFormValues['lines'][number];
const blankLine = (): Line => ({ id: newId(), accountId: '', label: '', debit: 0, credit: 0 });

export function EntryForm({ entry }: { entry?: JournalEntry }) {
  const data = useLedgerData();
  const { saveDraft, postEntry, deleteDraft } = useLedger();
  const navigate = useNavigate();
  const location = useLocation();
  const navState = location.state as { notice?: string; error?: string } | null;
  const notice = navState?.notice;

  const [error, setError] = useState<string | null>(navState?.error ?? null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const defaultJournal = data.journals.find((j) => j.type === 'general')?.id ?? data.journals[0]?.id ?? '';
  const form = useForm<EntryFormValues>({
    resolver: zodResolver(entryFormSchema),
    defaultValues: entry
      ? {
          journalId: entry.journalId,
          date: entry.date,
          reference: entry.reference,
          lines: entry.lines.length >= 2 ? entry.lines : [...entry.lines, blankLine(), blankLine()].slice(0, 2),
        }
      : { journalId: defaultJournal, date: todayISO(), reference: '', lines: [blankLine(), blankLine()] },
  });
  const { control, register, handleSubmit, watch, formState } = form;
  const { fields, append, remove } = useFieldArray({ control, name: 'lines', keyName: 'key' });

  const lines = watch('lines');
  const date = watch('date');
  const totals = entryTotals(lines);
  const locked = isPeriodLocked(date, data.company.lockDate);

  /** Baris baru otomatis terisi selisih di sisi yang kurang, seperti di Odoo. */
  const addLine = () => {
    const diff = totals.difference;
    const last = lines[lines.length - 1];
    append({ ...blankLine(), label: last?.label ?? '', debit: diff < 0 ? -diff : 0, credit: diff > 0 ? diff : 0 });
  };

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const onSaveDraft = handleSubmit((values) =>
    run(async () => {
      const saved = await saveDraft({ id: entry?.id, ...values });
      navigate(`/entri/${saved.id}`, { replace: !entry, state: { notice: 'Draft disimpan.' } });
    }),
  );

  const onPost = handleSubmit((values) =>
    run(async () => {
      const saved = await saveDraft({ id: entry?.id, ...values });
      try {
        const posted = await postEntry(saved.id);
        navigate(`/entri/${posted.id}`, { replace: true, state: { notice: `Entri diposting sebagai ${posted.number}.` } });
      } catch (e) {
        // Draft tetap tersimpan agar input tidak hilang; alasan gagal posting dibawa ke halaman draft.
        if (!entry) {
          navigate(`/entri/${saved.id}`, { replace: true, state: { error: `Disimpan sebagai draft. ${errorMessage(e)}` } });
          return;
        }
        throw e;
      }
    }),
  );

  const onDelete = () =>
    run(async () => {
      if (!entry) return;
      await deleteDraft(entry.id);
      navigate('/entri', { replace: true });
    });

  const lineError = (i: number, field: keyof Line) => formState.errors.lines?.[i]?.[field]?.message;

  return (
    <form onSubmit={(e) => e.preventDefault()} noValidate>
      <PageHeader
        back={{ to: '/entri', label: 'Entri Jurnal' }}
        title={entry ? 'Draft entri jurnal' : 'Entri jurnal baru'}
        subtitle={
          <span className="inline-flex items-center gap-2">
            <StatusBadge status="draft" /> Nomor diberikan otomatis saat diposting.
          </span>
        }
        actions={
          <>
            {entry &&
              (confirmDelete ? (
                <>
                  <Button variant="danger" onClick={onDelete} disabled={busy}>Ya, hapus draft</Button>
                  <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Batal</Button>
                </>
              ) : (
                <Button variant="ghost" onClick={() => setConfirmDelete(true)}>Hapus draft</Button>
              ))}
            <Button onClick={onSaveDraft} disabled={busy}>Simpan draft</Button>
            <Button variant="primary" onClick={onPost} disabled={busy}>Posting</Button>
          </>
        }
      />

      <div className="space-y-4">
        {notice && !error && <Alert tone="ok">{notice}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}
        {locked && (
          <Alert tone="warn">
            Tanggal ini masuk periode terkunci (sampai {formatDate(data.company.lockDate!)}). Draft tetap bisa disimpan, tapi tidak bisa diposting.
          </Alert>
        )}

        <Panel className="grid gap-4 p-5 sm:grid-cols-3">
          <Field label="Jurnal" error={formState.errors.journalId?.message}>
            <select className={inputClass} {...register('journalId')}>
              {data.journals.map((j) => (
                <option key={j.id} value={j.id}>{j.name} ({j.code})</option>
              ))}
            </select>
          </Field>
          <Field label="Tanggal" error={formState.errors.date?.message}>
            <input type="date" className={inputClass} {...register('date')} />
          </Field>
          <Field label="Referensi" error={formState.errors.reference?.message}>
            <input className={inputClass} placeholder="mis. Penjualan tunai toko" {...register('reference')} />
          </Field>
        </Panel>

        <Panel>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] border-collapse">
              <thead>
                <tr>
                  <th className={`${th} w-[30%]`}>Akun</th>
                  <th className={th}>Keterangan</th>
                  <th className={`${thNum} w-40`}>Debit</th>
                  <th className={`${thNum} w-40`}>Kredit</th>
                  <th className={`${th} w-48`}>Analitik</th>
                  <th className={`${th} w-12`}><span className="sr-only">Hapus</span></th>
                </tr>
              </thead>
              <tbody>
                {fields.map((f, i) => (
                  <tr key={f.key} className="align-top">
                    <td className="border-b border-line px-3 py-2">
                      <Controller
                        control={control}
                        name={`lines.${i}.accountId`}
                        render={({ field }) => (
                          <AccountSelect accounts={data.accounts} value={field.value} onChange={field.onChange} aria-label={`Akun baris ${i + 1}`} />
                        )}
                      />
                    </td>
                    <td className="border-b border-line px-3 py-2">
                      <input className={inputClass} aria-label={`Keterangan baris ${i + 1}`} {...register(`lines.${i}.label`)} />
                    </td>
                    <td className="border-b border-line px-3 py-2">
                      <Controller
                        control={control}
                        name={`lines.${i}.debit`}
                        render={({ field }) => (
                          <MoneyInput
                            value={field.value}
                            onChange={(v) => {
                              field.onChange(v);
                              if (v > 0) form.setValue(`lines.${i}.credit`, 0);
                            }}
                            onBlur={field.onBlur}
                            aria-label={`Debit baris ${i + 1}`}
                            invalid={!!lineError(i, 'debit')}
                          />
                        )}
                      />
                    </td>
                    <td className="border-b border-line px-3 py-2">
                      <Controller
                        control={control}
                        name={`lines.${i}.credit`}
                        render={({ field }) => (
                          <MoneyInput
                            value={field.value}
                            onChange={(v) => {
                              field.onChange(v);
                              if (v > 0) form.setValue(`lines.${i}.debit`, 0);
                            }}
                            onBlur={field.onBlur}
                            aria-label={`Kredit baris ${i + 1}`}
                            invalid={!!lineError(i, 'credit')}
                          />
                        )}
                      />
                    </td>
                    <td className="border-b border-line px-3 py-2">
                      <Controller
                        control={control}
                        name={`lines.${i}.analytic`}
                        render={({ field }) => (
                          <DistributionCell value={field.value} onChange={field.onChange} account={data.accounts.find((a) => a.id === lines[i]?.accountId)} />
                        )}
                      />
                    </td>
                    <td className="border-b border-line px-1 py-2 text-center">
                      <button
                        type="button"
                        className="rounded px-2 py-1.5 text-ink-soft hover:bg-bad-100 hover:text-bad disabled:opacity-30"
                        onClick={() => remove(i)}
                        disabled={fields.length <= 2}
                        aria-label={`Hapus baris ${i + 1}`}
                        title="Hapus baris"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-3 py-3">
            <Button variant="ghost" onClick={addLine}>+ Tambah baris</Button>
          </div>
        </Panel>

        <Panel className="px-5 py-6">
          <BalanceScale debit={totals.debit} credit={totals.credit} />
        </Panel>
      </div>
    </form>
  );
}
