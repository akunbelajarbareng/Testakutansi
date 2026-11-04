import { useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useLocation, useNavigate } from 'react-router-dom';
import { invoiceFormSchema, type InvoiceFormValues } from '../../domain/schemas';
import {
  DEFAULT_PURCHASE_ACCOUNT,
  INCOME_ACCOUNT_BY_TIER,
  KIND_LABEL,
  addDays,
  creditCheck,
  invoiceTotals,
  isPeriodLocked,
  isRefund,
  lineSubtotal,
  type Invoice,
  type InvoiceKind,
} from '../../domain';
import { formatAmount, formatDate, formatRupiah, todayISO } from '../../lib/format';
import { newId } from '../../lib/id';
import { docPath } from '../../lib/paths';
import { useLedger, useLedgerData } from '../../store/ledgerStore';
import { MoneyInput } from '../../components/MoneyInput';
import { DistributionCell } from '../../components/DistributionEditor';
import { Alert, Button, DocBadge, Field, PageHeader, Panel, errorMessage, inputClass, th, thNum } from '../../components/ui';
import { AccountSelect } from '../entries/AccountSelect';
import { InvoiceTotalsBox } from './InvoiceTotalsBox';

type Line = InvoiceFormValues['lines'][number];

export function InvoiceForm({ side, invoice }: { side: 'sale' | 'purchase'; invoice?: Invoice }) {
  const data = useLedgerData();
  const { saveInvoiceDraft, postInvoice, deleteInvoiceDraft } = useLedger();
  const navigate = useNavigate();
  const navState = useLocation().state as { notice?: string; error?: string } | null;

  const sale = side === 'sale';
  const kind: InvoiceKind = invoice?.kind ?? (sale ? 'out_invoice' : 'in_invoice');
  const refund = isRefund(kind);
  const origin = invoice?.refundOfId ? data.invoices.find((i) => i.id === invoice.refundOfId) : undefined;
  const base = sale ? '/faktur' : '/tagihan';

  const [error, setError] = useState<string | null>(navState?.error ?? null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const accountByCode = (code: string) => data.accounts.find((a) => a.code === code)?.id ?? '';
  const partners = data.partners.filter((p) => (p.active || p.id === invoice?.partnerId) && (sale ? p.kind !== 'supplier' : p.kind !== 'customer'));
  const defaultTax = data.taxes.find((t) => t.active)?.id ?? '';
  const defaultAccountFor = (partnerId: string) => {
    if (!sale) return accountByCode(DEFAULT_PURCHASE_ACCOUNT);
    const tier = data.partners.find((p) => p.id === partnerId)?.tier ?? 'retail';
    return accountByCode(INCOME_ACCOUNT_BY_TIER[tier]);
  };
  const blankLine = (partnerId: string): Line => ({ id: newId(), description: '', accountId: defaultAccountFor(partnerId), quantity: 1, unitPrice: 0, taxId: defaultTax });

  const today = todayISO();
  const form = useForm<InvoiceFormValues>({
    resolver: zodResolver(invoiceFormSchema),
    defaultValues: invoice
      ? { partnerId: invoice.partnerId, date: invoice.date, dueDate: invoice.dueDate, reference: invoice.reference, notes: invoice.notes, lines: invoice.lines }
      : { partnerId: '', date: today, dueDate: today, reference: '', notes: '', lines: [blankLine('')] },
  });
  const { control, register, handleSubmit, watch, setValue, getValues, formState } = form;
  const { fields, append, remove } = useFieldArray({ control, name: 'lines', keyName: 'key' });

  const values = watch();
  const totals = invoiceTotals({ lines: values.lines }, data.taxes);
  const partner = data.partners.find((p) => p.id === values.partnerId);
  const credit = sale && !refund && partner ? creditCheck(partner, data, totals.total, invoice?.id) : null;
  const locked = isPeriodLocked(values.date, data.company.lockDate);
  const incomeDefaults = new Set(Object.values(INCOME_ACCOUNT_BY_TIER).map(accountByCode));

  const onPartnerChange = (id: string) => {
    setValue('partnerId', id, { shouldValidate: true });
    if (refund) return;
    const p = data.partners.find((x) => x.id === id);
    if (p) setValue('dueDate', addDays(getValues('date'), p.paymentTermDays));
    // Akun pendapatan bawaan mengikuti tier pelanggan, kecuali sudah diubah manual.
    if (sale) {
      getValues('lines').forEach((l, i) => {
        if (!l.accountId || incomeDefaults.has(l.accountId)) setValue(`lines.${i}.accountId`, defaultAccountFor(id));
      });
    }
  };
  const onDateChange = (date: string) => {
    setValue('date', date);
    if (refund) setValue('dueDate', date);
    else if (partner) setValue('dueDate', addDays(date, partner.paymentTermDays));
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

  const [fp, setFp] = useState({ n: invoice?.supplierTaxInvoiceNumber ?? '', d: invoice?.supplierTaxInvoiceDate ?? '' });
  const toInput = (v: InvoiceFormValues) => ({
    id: invoice?.id,
    kind,
    refundOfId: invoice?.refundOfId,
    ...v,
    ...(kind === 'in_invoice' ? { supplierTaxInvoiceNumber: fp.n.trim() || undefined, supplierTaxInvoiceDate: fp.d || undefined } : {}),
  });

  const onSave = handleSubmit((v) =>
    run(async () => {
      const saved = await saveInvoiceDraft(toInput(v));
      navigate(docPath(saved), { replace: !invoice, state: { notice: 'Draft disimpan.' } });
    }),
  );

  const onPost = handleSubmit((v) =>
    run(async () => {
      const saved = await saveInvoiceDraft(toInput(v));
      try {
        const posted = await postInvoice(saved.id);
        navigate(docPath(posted), { replace: true, state: { notice: `${KIND_LABEL[kind]} ${posted.number} diposting dan dijurnal.` } });
      } catch (e) {
        if (!invoice) {
          navigate(docPath(saved), { replace: true, state: { error: `Disimpan sebagai draft. ${errorMessage(e)}` } });
          return;
        }
        throw e;
      }
    }),
  );

  const onDelete = () =>
    run(async () => {
      if (!invoice) return;
      await deleteInvoiceDraft(invoice.id);
      navigate(origin ? docPath(origin) : base, { replace: true });
    });

  const lineErr = (i: number, f: keyof Line) => formState.errors.lines?.[i]?.[f]?.message;
  const taxes = data.taxes.filter((t) => t.active && (!sale || !t.purchaseOnly));

  return (
    <form onSubmit={(e) => e.preventDefault()} noValidate>
      <PageHeader
        back={origin ? { to: docPath(origin), label: origin.number ?? 'Dokumen asal' } : { to: base, label: sale ? 'Faktur Penjualan' : 'Tagihan Vendor' }}
        title={invoice ? `Draft ${KIND_LABEL[kind].toLowerCase()}` : sale ? 'Faktur penjualan baru' : 'Tagihan vendor baru'}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <DocBadge state="draft" />
            {origin ? `Koreksi atas ${origin.number}. Nilainya mengurangi sisa tagihan dokumen asal.` : 'Nomor dan jurnal dibuat otomatis saat diposting.'}
          </span>
        }
        actions={
          <>
            {invoice &&
              (confirmDelete ? (
                <>
                  <Button variant="danger" onClick={onDelete} disabled={busy}>Ya, hapus draft</Button>
                  <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Batal</Button>
                </>
              ) : (
                <Button variant="ghost" onClick={() => setConfirmDelete(true)}>Hapus draft</Button>
              ))}
            <Button onClick={onSave} disabled={busy}>Simpan draft</Button>
            <Button variant="primary" onClick={onPost} disabled={busy}>Posting</Button>
          </>
        }
      />

      <div className="space-y-4">
        {navState?.notice && !error && <Alert tone="ok">{navState.notice}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}
        {locked && <Alert tone="warn">Tanggal ini masuk periode terkunci (sampai {formatDate(data.company.lockDate!)}). Draft bisa disimpan, tapi tidak bisa diposting.</Alert>}
        {credit?.exceeded && (
          <Alert tone="warn">
            Piutang {partner!.name} akan menjadi {formatRupiah(credit.exposure)}, melewati batas kredit {formatRupiah(credit.limit)}. Posting tetap bisa dilakukan; pastikan sudah disetujui.
          </Alert>
        )}

        <Panel className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={sale ? 'Pelanggan' : 'Supplier'} error={formState.errors.partnerId?.message}>
            <select className={inputClass} value={values.partnerId} disabled={refund} onChange={(e) => onPartnerChange(e.target.value)}>
              <option value="">Pilih…</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Tanggal" error={formState.errors.date?.message}>
            <input type="date" className={inputClass} value={values.date} onChange={(e) => onDateChange(e.target.value)} />
          </Field>
          <Field
            label="Jatuh tempo"
            error={formState.errors.dueDate?.message}
            hint={partner && !refund ? `Termin ${partner.paymentTermDays === 0 ? 'tunai' : `${partner.paymentTermDays} hari`}` : undefined}
          >
            <input type="date" className={inputClass} disabled={refund} {...register('dueDate')} />
          </Field>
          <Field label={sale ? 'No. PO pelanggan' : 'No. faktur supplier'} error={formState.errors.reference?.message}>
            <input className={inputClass} {...register('reference')} />
          </Field>
          {kind === 'in_invoice' && (
            <>
              <Field label="No. Faktur Pajak supplier" hint="Untuk pengkreditan PPN Masukan">
                <input className={`${inputClass} num`} value={fp.n} onChange={(e) => setFp({ ...fp, n: e.target.value })} />
              </Field>
              <Field label="Tanggal Faktur Pajak">
                <input type="date" className={inputClass} value={fp.d} onChange={(e) => setFp({ ...fp, d: e.target.value })} />
              </Field>
            </>
          )}
        </Panel>

        <Panel>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1220px] border-collapse">
              <thead>
                <tr>
                  <th className={th}>Barang / jasa</th>
                  <th className={`${th} w-56`}>Akun</th>
                  <th className={`${thNum} w-24`}>Kuantitas</th>
                  <th className={`${thNum} w-36`}>Harga satuan</th>
                  <th className={`${th} w-60`}>Pajak</th>
                  <th className={`${thNum} w-36`}>Subtotal</th>
                  <th className={`${th} w-44`}>Analitik</th>
                  <th className={`${th} w-10`}><span className="sr-only">Hapus</span></th>
                </tr>
              </thead>
              <tbody>
                {fields.map((f, i) => (
                  <tr key={f.key} className="align-top">
                    <td className="border-b border-line px-3 py-2">
                      <input className={`${inputClass} ${lineErr(i, 'description') ? 'border-bad' : ''}`} placeholder="mis. Tepung terigu 25 kg" aria-label={`Deskripsi baris ${i + 1}`} {...register(`lines.${i}.description`)} />
                    </td>
                    <td className="border-b border-line px-3 py-2">
                      <Controller
                        control={control}
                        name={`lines.${i}.accountId`}
                        render={({ field }) => <AccountSelect accounts={data.accounts} value={field.value} onChange={field.onChange} invalid={!!lineErr(i, 'accountId')} aria-label={`Akun baris ${i + 1}`} />}
                      />
                    </td>
                    <td className="border-b border-line px-3 py-2">
                      <input
                        type="number"
                        step="0.001"
                        min="0"
                        inputMode="decimal"
                        className={`${inputClass} num text-right ${lineErr(i, 'quantity') ? 'border-bad' : ''}`}
                        aria-label={`Kuantitas baris ${i + 1}`}
                        {...register(`lines.${i}.quantity`, { valueAsNumber: true })}
                      />
                    </td>
                    <td className="border-b border-line px-3 py-2">
                      <Controller
                        control={control}
                        name={`lines.${i}.unitPrice`}
                        render={({ field }) => <MoneyInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} aria-label={`Harga baris ${i + 1}`} />}
                      />
                    </td>
                    <td className="border-b border-line px-3 py-2">
                      <select className={inputClass} aria-label={`Pajak baris ${i + 1}`} {...register(`lines.${i}.taxId`)}>
                        {taxes.map((t) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="num border-b border-line px-3 py-4 text-right text-sm">
                      {formatAmount(Number.isFinite(values.lines[i]?.quantity) ? lineSubtotal(values.lines[i]) : 0)}
                    </td>
                    <td className="border-b border-line px-3 py-2">
                      <Controller
                        control={control}
                        name={`lines.${i}.analytic`}
                        render={({ field }) => <DistributionCell value={field.value} onChange={field.onChange} account={data.accounts.find((a) => a.id === values.lines[i]?.accountId)} />}
                      />
                    </td>
                    <td className="border-b border-line px-1 py-2 text-center">
                      <button
                        type="button"
                        className="rounded px-2 py-1.5 text-ink-soft hover:bg-bad-100 hover:text-bad disabled:opacity-30"
                        onClick={() => remove(i)}
                        disabled={fields.length <= 1}
                        aria-label={`Hapus baris ${i + 1}`}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-start justify-between gap-6 p-4">
            <div className="flex-1 space-y-3">
              <Button variant="ghost" onClick={() => append(blankLine(values.partnerId))}>+ Tambah baris</Button>
              <Field label="Catatan untuk dokumen">
                <textarea rows={2} className={`${inputClass} max-w-md`} {...register('notes')} />
              </Field>
            </div>
            <InvoiceTotalsBox totals={Number.isFinite(totals.total) ? totals : { untaxed: 0, taxes: [], tax: 0, total: 0 }} />
          </div>
        </Panel>
      </div>
    </form>
  );
}
