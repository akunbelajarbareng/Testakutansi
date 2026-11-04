import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { exportIssues, outputTaxGroups, type TaxInvoiceGroup } from '../../domain';
import { formatAmount, formatDate, todayISO } from '../../lib/format';
import { docPath } from '../../lib/paths';
import { exportCoretaxFaktur } from '../../lib/taxExport';
import { useLedger, useLedgerData } from '../../store/ledgerStore';
import { Alert, Button, EmptyState, PageHeader, Panel, errorMessage, inputClass, td, tdNum, th, thNum } from '../../components/ui';
import { MonthPicker, TemplateWarning } from './common';

const CODE_LABEL: Record<string, string> = { '04': '04 DPP nilai lain', '08': '08 Dibebaskan', '01': '01 Umum', '07': '07 Tidak dipungut' };

function StatusCell({ g }: { g: TaxInvoiceGroup }) {
  if (g.needsCorrection) return <span className="rounded-full bg-bad-100 px-2.5 py-0.5 text-xs font-medium text-bad">Perlu retur/pembetulan</span>;
  if (!g.record) return <span className="rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-600">Belum diekspor</span>;
  if (g.record.status === 'exported') return <span className="rounded-full bg-navy-100 px-2.5 py-0.5 text-xs font-medium text-navy">Diekspor, menunggu nomor</span>;
  return <span className="rounded-full bg-ok-100 px-2.5 py-0.5 text-xs font-medium text-ok">Terbit</span>;
}

export function OutputTaxPage() {
  const data = useLedgerData();
  const store = useLedger();
  const today = todayISO();
  const [period, setPeriod] = useState(today.slice(0, 7));
  const groups = useMemo(() => outputTaxGroups(data, period), [data, period]);
  const pending = groups.filter((g) => !g.record);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [numbers, setNumbers] = useState<Record<string, { n: string; d: string }>>({});
  const [message, setMessage] = useState<{ tone: 'ok' | 'error' | 'warn'; text: string; list?: string[] } | null>(null);

  const chosen = pending.filter((g) => selected.has(g.key));
  const toggleAll = () => setSelected(selected.size === pending.length ? new Set() : new Set(pending.map((g) => g.key)));

  const onExport = async () => {
    setMessage(null);
    const issues = exportIssues(chosen, data);
    if (issues.length) {
      setMessage({ tone: 'error', text: 'Lengkapi data berikut sebelum ekspor:', list: issues.map((i) => i.message) });
      return;
    }
    try {
      await exportCoretaxFaktur(chosen, data, period);
      await store.markTaxExported(chosen);
      setSelected(new Set());
      setMessage({ tone: 'ok', text: `${chosen.length} Faktur Pajak diekspor. Konversi dengan converter resmi DJP, impor ke Coretax, lalu catat nomor Faktur Pajak yang terbit di tabel ini.` });
    } catch (e) {
      setMessage({ tone: 'error', text: errorMessage(e) });
    }
  };

  const run = async (fn: () => Promise<void>, ok: string) => {
    setMessage(null);
    try {
      await fn();
      setMessage({ tone: 'ok', text: ok });
    } catch (e) {
      setMessage({ tone: 'error', text: errorMessage(e) });
    }
  };

  return (
    <>
      <PageHeader title="Faktur Pajak Keluaran" subtitle="Satu faktur penjualan dipecah per kode transaksi. Ekspor ke template Coretax, lalu catat nomor yang terbit." />
      <div className="space-y-4">
        <TemplateWarning />
        <Panel className="flex flex-wrap items-end justify-between gap-4 p-5">
          <MonthPicker value={period} onChange={(v) => { setPeriod(v); setSelected(new Set()); }} />
          <Button variant="primary" disabled={!chosen.length} onClick={onExport}>Ekspor {chosen.length || ''} ke Excel Coretax</Button>
        </Panel>
        {message && (
          <Alert tone={message.tone}>
            {message.text}
            {message.list && <ul className="mt-1 list-disc pl-5">{message.list.map((m) => <li key={m}>{m}</li>)}</ul>}
          </Alert>
        )}

        <Panel>
          {groups.length === 0 ? (
            <EmptyState title="Tidak ada faktur penjualan diposting di masa ini." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] border-collapse">
                <thead>
                  <tr>
                    <th className={`${th} w-10`}>
                      <input type="checkbox" className="h-4 w-4 accent-navy" checked={pending.length > 0 && selected.size === pending.length} onChange={toggleAll} aria-label="Pilih semua yang belum diekspor" />
                    </th>
                    <th className={th}>Faktur</th>
                    <th className={th}>Pembeli</th>
                    <th className={th}>Kode</th>
                    <th className={thNum}>DPP</th>
                    <th className={thNum}>DPP nilai lain</th>
                    <th className={thNum}>PPN</th>
                    <th className={th}>Status</th>
                    <th className={th}>Nomor Faktur Pajak</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.key} className="align-top">
                      <td className={td}>
                        {!g.record && (
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-navy"
                            checked={selected.has(g.key)}
                            onChange={(e) => {
                              const n = new Set(selected);
                              if (e.target.checked) n.add(g.key);
                              else n.delete(g.key);
                              setSelected(n);
                            }}
                            aria-label={`Pilih ${g.invoice.number} kode ${g.code}`}
                          />
                        )}
                      </td>
                      <td className={`${td} whitespace-nowrap`}>
                        <Link className="font-medium text-navy-600 hover:underline" to={docPath(g.invoice)}>{g.invoice.number}</Link>
                        <div className="text-xs text-ink-soft">{formatDate(g.invoice.date)}</div>
                      </td>
                      <td className={td}>
                        {g.partner?.name}
                        <div className="num text-xs text-ink-soft">{g.partner?.npwp || 'NPWP/NIK belum diisi'}</div>
                      </td>
                      <td className={`${td} whitespace-nowrap text-sm`}>{CODE_LABEL[g.code] ?? g.code}</td>
                      <td className={tdNum}>{formatAmount(g.dpp)}</td>
                      <td className={tdNum}>{formatAmount(g.dppOther)}</td>
                      <td className={tdNum}>{formatAmount(g.ppn)}</td>
                      <td className={td}><StatusCell g={g} /></td>
                      <td className={`${td} min-w-[260px]`}>
                        {g.record?.status === 'issued' && (
                          <span className="num text-sm">
                            {g.record.taxNumber}
                            <span className="block text-xs text-ink-soft">terbit {formatDate(g.record.issuedDate!)}</span>
                          </span>
                        )}
                        {g.record?.status === 'exported' && (
                          <div className="flex flex-col gap-1.5">
                            <input
                              className={`${inputClass} num`}
                              placeholder="Nomor dari Coretax"
                              value={numbers[g.record.id]?.n ?? ''}
                              onChange={(e) => setNumbers({ ...numbers, [g.record!.id]: { n: e.target.value, d: numbers[g.record!.id]?.d ?? g.invoice.date } })}
                              aria-label={`Nomor Faktur Pajak ${g.invoice.number}`}
                            />
                            <div className="flex gap-1.5">
                              <input
                                type="date"
                                className={inputClass}
                                value={numbers[g.record.id]?.d ?? g.invoice.date}
                                onChange={(e) => setNumbers({ ...numbers, [g.record!.id]: { n: numbers[g.record!.id]?.n ?? '', d: e.target.value } })}
                                aria-label="Tanggal terbit"
                              />
                              <Button
                                variant="primary"
                                aria-label={`Simpan nomor Faktur Pajak ${g.invoice.number} kode ${g.code}`}
                                onClick={() => run(() => store.recordTaxNumber(g.record!.id, numbers[g.record!.id]?.n ?? '', numbers[g.record!.id]?.d ?? g.invoice.date), `Nomor Faktur Pajak ${g.invoice.number} dicatat.`)}
                              >
                                Simpan
                              </Button>
                            </div>
                            <button type="button" className="self-start text-xs text-ink-soft underline" onClick={() => run(() => store.cancelTaxInvoice(g.record!.id), 'Ekspor dibatalkan; faktur bisa diekspor ulang.')}>
                              Batalkan ekspor
                            </button>
                          </div>
                        )}
                        {g.needsCorrection && <p className="mt-1 text-xs text-bad">Ada nota kredit setelah terbit. Buat retur/pembetulan di Coretax.</p>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <p className="text-xs text-ink-soft">Alur: centang → ekspor Excel → buka converter resmi DJP → hasil XML diimpor di Coretax (e-Faktur → Pajak Keluaran → Impor Data) → nomor yang terbit dicatat di sini.</p>
      </div>
    </>
  );
}
