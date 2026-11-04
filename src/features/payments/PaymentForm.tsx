import { useMemo, useState } from 'react';
import { autoAllocate, invoiceResidual, type PaymentDirection, type Payment } from '../../domain';
import { formatAmount, formatDate, formatRupiah, todayISO } from '../../lib/format';
import { useLedger, useLedgerData } from '../../store/ledgerStore';
import { MoneyInput } from '../../components/MoneyInput';
import { Alert, Button, Field, Panel, errorMessage, inputClass } from '../../components/ui';

interface Props {
  direction?: PaymentDirection;
  partnerId?: string;
  /** Bila diisi, alokasi awal hanya ke dokumen ini sebesar sisa tagihannya. */
  invoiceId?: string;
  onDone: (p: Payment) => void;
  onCancel: () => void;
}

/** Catat penerimaan/pembayaran. Alokasi bisa otomatis (jatuh tempo terlama dulu) atau diatur per dokumen. */
export function PaymentForm({ direction: fixedDirection, partnerId: fixedPartner, invoiceId, onDone, onCancel }: Props) {
  const data = useLedgerData();
  const registerPayment = useLedger((s) => s.registerPayment);

  const initialInvoice = invoiceId ? data.invoices.find((i) => i.id === invoiceId) : undefined;
  const initialResidual = initialInvoice ? invoiceResidual(initialInvoice, data) : 0;

  const [direction, setDirection] = useState<PaymentDirection>(fixedDirection ?? 'inbound');
  const [partnerId, setPartnerId] = useState(fixedPartner ?? '');
  const [date, setDate] = useState(todayISO());
  const liquidityJournals = data.journals.filter((j) => (j.type === 'bank' || j.type === 'cash') && j.defaultAccountId);
  const [journalId, setJournalId] = useState(liquidityJournals[0]?.id ?? '');
  const [amount, setAmount] = useState(initialResidual);
  const [memo, setMemo] = useState('');
  const [alloc, setAlloc] = useState<Record<string, number>>(initialInvoice ? { [initialInvoice.id]: initialResidual } : {});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const inbound = direction === 'inbound';
  const partners = data.partners.filter((p) => p.active && (inbound ? p.kind !== 'supplier' : p.kind !== 'customer'));

  const openDocs = useMemo(
    () =>
      data.invoices
        .filter((i) => i.partnerId === partnerId && i.status === 'posted' && i.kind === (inbound ? 'out_invoice' : 'in_invoice'))
        .map((i) => ({ inv: i, residual: invoiceResidual(i, data) }))
        .filter((x) => x.residual > 0)
        .sort((a, b) => a.inv.dueDate.localeCompare(b.inv.dueDate)),
    [data, partnerId, inbound],
  );

  const allocated = Object.values(alloc).reduce((s, v) => s + (v || 0), 0);
  const excess = amount - allocated;

  const runAuto = (amt = amount, pid = partnerId, dir = direction) => {
    const list = autoAllocate({ direction: dir, partnerId: pid, amount: amt }, data);
    setAlloc(Object.fromEntries(list.map((a) => [a.invoiceId, a.amount])));
  };

  /** Jumlah berubah → alokasi ikut menyesuaikan: ke dokumen ini dulu (bila dibuka dari dokumen), lalu jatuh tempo terlama. */
  const onAmountChange = (v: number) => {
    setAmount(v);
    if (initialInvoice) {
      const first = Math.min(v, initialResidual);
      const rest = autoAllocate({ direction, partnerId, amount: v - first }, data).filter((a) => a.invoiceId !== initialInvoice.id);
      setAlloc({ [initialInvoice.id]: first, ...Object.fromEntries(rest.map((a) => [a.invoiceId, a.amount])) });
    } else if (partnerId) {
      runAuto(v);
    }
  };

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const payment = await registerPayment({
        direction,
        partnerId,
        date,
        journalId,
        amount,
        memo,
        allocations: Object.entries(alloc)
          .filter(([, v]) => v > 0)
          .map(([invoiceId, v]) => ({ invoiceId, amount: v })),
      });
      onDone(payment);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel className="border-orange/40 p-5">
      <h2 className="mb-4 text-base font-semibold text-navy">{inbound ? 'Terima pembayaran' : 'Bayar supplier'}</h2>
      {error && <div className="mb-4"><Alert tone="error">{error}</Alert></div>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {!fixedDirection && (
          <Field label="Jenis">
            <select
              className={inputClass}
              value={direction}
              onChange={(e) => {
                setDirection(e.target.value as PaymentDirection);
                setPartnerId('');
                setAlloc({});
              }}
            >
              <option value="inbound">Penerimaan dari pelanggan</option>
              <option value="outbound">Pembayaran ke supplier</option>
            </select>
          </Field>
        )}
        <Field label={inbound ? 'Pelanggan' : 'Supplier'}>
          <select
            className={inputClass}
            value={partnerId}
            disabled={!!fixedPartner}
            onChange={(e) => {
              setPartnerId(e.target.value);
              runAuto(amount, e.target.value);
            }}
          >
            <option value="">Pilih…</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Tanggal">
          <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Lewat">
          <select className={inputClass} value={journalId} onChange={(e) => setJournalId(e.target.value)}>
            {liquidityJournals.map((j) => (
              <option key={j.id} value={j.id}>{j.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Jumlah">
          <MoneyInput value={amount} onChange={onAmountChange} aria-label="Jumlah pembayaran" />
        </Field>
        <div className="sm:col-span-2 lg:col-span-3">
          <Field label="Keterangan">
            <input className={inputClass} value={memo} placeholder={inbound ? 'mis. Transfer BCA pelanggan' : 'mis. Transfer ke rekening supplier'} onChange={(e) => setMemo(e.target.value)} />
          </Field>
        </div>
      </div>

      {partnerId && (
        <div className="mt-5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-ink">Alokasi ke {inbound ? 'faktur' : 'tagihan'} terbuka</h3>
            {openDocs.length > 0 && <Button variant="ghost" onClick={() => runAuto()}>Alokasikan otomatis</Button>}
          </div>
          {openDocs.length === 0 ? (
            <p className="text-sm text-ink-soft">Tidak ada dokumen terbuka. Seluruh jumlah akan dicatat sebagai {inbound ? 'deposit pelanggan' : 'uang muka pembelian'}.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-line">
              <table className="w-full min-w-[560px] border-collapse text-sm">
                <tbody>
                  {openDocs.map(({ inv, residual }) => (
                    <tr key={inv.id} className="border-b border-line last:border-0">
                      <td className="px-3 py-2 font-medium">{inv.number}</td>
                      <td className="px-3 py-2 text-ink-soft">jatuh tempo {formatDate(inv.dueDate)}</td>
                      <td className="num px-3 py-2 text-right text-ink-soft">sisa {formatAmount(residual)}</td>
                      <td className="w-40 px-3 py-2">
                        <MoneyInput value={alloc[inv.id] ?? 0} onChange={(v) => setAlloc((a) => ({ ...a, [inv.id]: v }))} aria-label={`Alokasi ${inv.number}`} invalid={(alloc[inv.id] ?? 0) > residual} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className={`mt-2 text-sm ${excess < 0 ? 'text-bad' : 'text-ink-soft'}`}>
            Dialokasikan {formatRupiah(allocated)} dari {formatRupiah(amount)}.
            {excess > 0 && ` Kelebihan ${formatRupiah(excess)} dicatat sebagai ${inbound ? 'deposit pelanggan (2301)' : 'uang muka pembelian (1402)'}.`}
            {excess < 0 && ' Alokasi melebihi jumlah pembayaran.'}
          </p>
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <Button variant="primary" onClick={submit} disabled={busy || !partnerId || amount <= 0}>
          {inbound ? 'Catat penerimaan' : 'Catat pembayaran'}
        </Button>
        <Button variant="ghost" onClick={onCancel}>Batal</Button>
      </div>
    </Panel>
  );
}
