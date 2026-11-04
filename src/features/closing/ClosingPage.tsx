import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { activeClosingEntry, closingChecklist, monthEnd, netProfit, shiftMonth, snapshotChanges } from '../../domain';
import { formatAmount, formatDate, formatMonth, formatRupiah, todayISO } from '../../lib/format';
import { useLedger, useLedgerData } from '../../store/ledgerStore';
import { Alert, Button, Field, LinkButton, PageHeader, Panel, errorMessage, inputClass } from '../../components/ui';

export function ClosingPage() {
  const data = useLedgerData();
  const store = useLedger();
  const today = todayISO();
  const lock = data.company.lockDate;

  const months = useMemo(() => {
    const first = [...data.entries].filter((e) => e.status !== 'draft').map((e) => e.date).sort()[0]?.slice(0, 7) ?? today.slice(0, 7);
    const out: string[] = [];
    for (let m = first; m <= today.slice(0, 7); m = shiftMonth(m, 1)) out.push(m);
    return out.reverse();
  }, [data.entries, today]);

  const firstOpen = [...months].reverse().find((m) => !lock || monthEnd(m) > lock) ?? months[0];
  const [selected, setSelected] = useState(firstOpen);
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const periodEnd = monthEnd(selected);
  const isLocked = !!lock && periodEnd <= lock;
  const closeRec = data.periodCloses.filter((p) => p.periodEnd === periodEnd).sort((a, b) => b.closedAt.localeCompare(a.closedAt))[0];
  const checks = useMemo(() => closingChecklist(data, periodEnd), [data, periodEnd]);
  const requiredOk = checks.filter((c) => c.level === 'required').every((c) => c.ok);
  const warnings = checks.filter((c) => c.level === 'warning' && !c.ok);
  const isDecember = selected.endsWith('-12');
  const year = selected.slice(0, 4);
  const closingEntry = activeClosingEntry(data, year);
  const changes = closeRec?.status === 'closed' ? snapshotChanges(closeRec, data) : [];

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMessage(null);
    try {
      await fn();
      setMessage({ tone: 'ok', text: ok });
      setNotes('');
      setReason('');
    } catch (e) {
      setMessage({ tone: 'error', text: errorMessage(e) });
    }
  };

  return (
    <>
      <PageHeader
        title="Tutup Buku"
        subtitle={lock ? `Periode terkunci sampai ${formatDate(lock)}.` : 'Belum ada periode yang ditutup.'}
        actions={<LinkButton to="/tutup-buku/hpp">Penyesuaian HPP</LinkButton>}
      />
      {message && <div className="mb-4"><Alert tone={message.tone}>{message.text}</Alert></div>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Panel className="max-h-[75vh] overflow-y-auto">
          <ul className="divide-y divide-line">
            {months.map((m) => {
              const end = monthEnd(m);
              const locked = !!lock && end <= lock;
              const active = m === selected;
              return (
                <li key={m}>
                  <button
                    type="button"
                    onClick={() => { setSelected(m); setMessage(null); }}
                    aria-current={active || undefined}
                    className={`flex w-full items-center justify-between gap-3 border-l-[3px] px-4 py-3 text-left text-sm ${active ? 'border-orange bg-orange-100/40' : 'border-transparent hover:bg-navy-100/40'}`}
                  >
                    <span>
                      <span className="block font-medium text-ink">{formatMonth(m)}</span>
                      <span className="num text-xs text-ink-soft">Laba bersih {formatAmount(netProfit(data, { from: `${m}-01`, to: end }))}</span>
                    </span>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${locked ? 'bg-navy text-white' : 'bg-paper text-ink-soft ring-1 ring-line'}`}>{locked ? 'Ditutup' : 'Terbuka'}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Panel>

        <div className="space-y-4">
          <Panel className="p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold text-navy">{formatMonth(selected)}</h2>
              <Link className="text-sm text-navy-600 hover:underline" to="/laporan/laba-rugi">Lihat laba rugi</Link>
            </div>

            {isLocked ? (
              <div className="mt-3 space-y-3 text-sm">
                {closeRec ? (
                  <>
                    <p>
                      Ditutup {new Date(closeRec.closedAt).toLocaleString('id-ID')}.
                      {closeRec.notes && <span className="text-ink-soft"> Catatan: {closeRec.notes}</span>}
                    </p>
                    {closeRec.warningsAtClose.length > 0 && <p className="text-ink-soft">Peringatan yang dilewati: {closeRec.warningsAtClose.join('; ')}.</p>}
                    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      <Snap label="Pendapatan" v={closeRec.snapshot.revenue} />
                      <Snap label="Laba bersih" v={closeRec.snapshot.netProfit} />
                      <Snap label="Total aset" v={closeRec.snapshot.totalAssets} />
                    </dl>
                    {changes.length > 0 ? (
                      <Alert tone="error">
                        Angka berubah sejak ditutup: {changes.map((c) => `${c.label} ${formatRupiah(c.before)} → ${formatRupiah(c.after)}`).join('; ')}.
                      </Alert>
                    ) : (
                      <Alert tone="ok">Angka tidak berubah sejak periode ditutup.</Alert>
                    )}
                    {lock === periodEnd && closeRec.status === 'closed' && (
                      <div className="border-t border-line pt-3">
                        <Field label="Alasan membuka kembali" hint="Wajib, minimal 10 karakter. Tercatat di riwayat.">
                          <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />
                        </Field>
                        <Button variant="danger" className="mt-2" onClick={() => run(() => store.reopenPeriod(closeRec.id, reason), `${formatMonth(selected)} dibuka kembali.`)}>
                          Buka kembali periode
                        </Button>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-ink-soft">Periode ini terkunci lewat tanggal kunci di Pengaturan (tanpa proses tutup buku).</p>
                )}
              </div>
            ) : (
              <>
                <h3 className="mb-2 mt-4 text-sm font-semibold text-ink">Checklist penutupan</h3>
                <ul className="space-y-2">
                  {checks.map((c) => (
                    <li key={c.id} className="flex items-start gap-3 rounded-md border border-line p-3 text-sm">
                      <span
                        aria-hidden
                        className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-xs font-bold text-white ${c.ok ? 'bg-ok' : c.level === 'required' ? 'bg-bad' : 'bg-orange'}`}
                      >
                        {c.ok ? '✓' : '!'}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="font-medium text-ink">{c.label}</span>
                        <span className="ml-2 text-xs text-ink-soft">{c.level === 'required' ? 'wajib' : 'peringatan'}</span>
                        <span className="block text-ink-soft">{c.detail}</span>
                      </span>
                      {!c.ok && c.link && <Link className="whitespace-nowrap text-navy-600 hover:underline" to={c.link}>Bereskan</Link>}
                    </li>
                  ))}
                </ul>

                {isDecember && (
                  <div className="mt-4 rounded-md border border-navy-600/30 bg-navy-100/40 p-4 text-sm">
                    <h3 className="font-semibold text-navy">Tutup tahun buku {year}</h3>
                    {closingEntry ? (
                      <p className="mt-1">
                        Jurnal penutup sudah dibuat: <Link className="text-navy-600 underline" to={`/entri/${closingEntry.id}`}>{closingEntry.number}</Link>.
                        <Button variant="ghost" className="ml-2" onClick={() => run(() => store.cancelClosingEntry(year), 'Jurnal penutup dibatalkan.')}>Batalkan jurnal penutup</Button>
                      </p>
                    ) : (
                      <>
                        <p className="mt-1 text-ink-soft">Saldo semua akun pendapatan dan beban tahun {year} dinolkan ke 3201 Laba Ditahan. Buat setelah semua transaksi Desember (termasuk HPP) selesai.</p>
                        <Button variant="primary" className="mt-2" onClick={() => run(() => store.createClosingEntry(year), `Jurnal penutup tahun ${year} dibuat.`)}>Buat jurnal penutup</Button>
                      </>
                    )}
                  </div>
                )}

                <div className="mt-4 border-t border-line pt-4">
                  <Field label={warnings.length ? 'Alasan melewati peringatan' : 'Catatan penutupan'} hint={warnings.length ? 'Wajib karena ada peringatan, minimal 10 karakter.' : 'Opsional.'}>
                    <textarea rows={2} className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
                  </Field>
                  {lock && periodEnd > lock && shiftMonth(lock.slice(0, 7), 1) !== selected && (
                    <p className="mt-2 text-sm text-orange-600">Bulan-bulan di antara {formatDate(lock)} dan {formatDate(periodEnd)} ikut terkunci.</p>
                  )}
                  {!lock && months.indexOf(selected) < months.length - 1 && (
                    <p className="mt-2 text-sm text-orange-600">Semua bulan sebelum {formatMonth(selected)} ikut terkunci. Bila ingin memeriksa checklist per bulan, tutup dari bulan paling awal.</p>
                  )}
                  <Button variant="primary" className="mt-3" disabled={!requiredOk} onClick={() => run(() => store.closePeriod(periodEnd, notes), `${formatMonth(selected)} ditutup. Tanggal kunci maju ke ${formatDate(periodEnd)}.`)}>
                    Tutup {formatMonth(selected)}
                  </Button>
                  {!requiredOk && <p className="mt-2 text-sm text-bad">Bereskan item wajib dulu.</p>}
                </div>
              </>
            )}
          </Panel>

          {data.periodCloses.length > 0 && (
            <Panel className="p-5">
              <h3 className="mb-2 text-sm font-semibold text-ink">Riwayat penutupan</h3>
              <ul className="divide-y divide-line text-sm">
                {[...data.periodCloses].sort((a, b) => b.closedAt.localeCompare(a.closedAt)).map((p) => (
                  <li key={p.id} className="py-2">
                    <span className="font-medium">{formatMonth(p.periodEnd.slice(0, 7))}</span>
                    <span className="ml-2 text-ink-soft">ditutup {new Date(p.closedAt).toLocaleDateString('id-ID')}</span>
                    {p.status === 'reopened' && (
                      <span className="block text-orange-600">Dibuka kembali {p.reopenedAt ? new Date(p.reopenedAt).toLocaleDateString('id-ID') : ''}: {p.reopenReason}</span>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}

function Snap({ label, v }: { label: string; v: number }) {
  return (
    <div>
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className="num font-semibold">{formatAmount(v)}</dd>
    </div>
  );
}
