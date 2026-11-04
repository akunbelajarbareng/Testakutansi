import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  invoiceResidual,
  reconciliationReport,
  suggestMatches,
  unreconciledBookLines,
  type LineRef,
  type StatementLine,
  type Suggestion,
} from '../../domain';
import { formatAmount, formatDate, formatRupiah, todayISO } from '../../lib/format';
import { useLedger, useLedgerData } from '../../store/ledgerStore';
import { Alert, Button, EmptyState, Field, LinkButton, PageHeader, Panel, errorMessage, inputClass } from '../../components/ui';
import { AccountSelect } from '../entries/AccountSelect';
import { JournalPicker, liquidityJournals } from './JournalPicker';

const refKey = (r: LineRef) => `${r.entryId}:${r.lineId}`;

function confidence(score: number) {
  if (score >= 85) return { label: 'Sangat cocok', cls: 'bg-ok-100 text-ok' };
  if (score >= 70) return { label: 'Cocok', cls: 'bg-navy-100 text-navy' };
  return { label: 'Mungkin', cls: 'bg-paper text-ink-soft border border-line' };
}

export function ReconcilePage() {
  const data = useLedgerData();
  const store = useLedger();
  const banks = liquidityJournals(data.journals, 'bank');
  const [params, setParams] = useSearchParams();
  const journalId = params.get('rekening') ?? banks[0]?.id ?? '';
  const today = todayISO();

  const openLines = useMemo(
    () => data.statementLines.filter((l) => l.journalId === journalId && l.status === 'open').sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt)),
    [data.statementLines, journalId],
  );
  const doneLines = data.statementLines.filter((l) => l.journalId === journalId && l.status === 'reconciled').sort((a, b) => b.date.localeCompare(a.date));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = openLines.find((l) => l.id === selectedId) ?? openLines[0];
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [showDone, setShowDone] = useState(false);

  const report = journalId ? reconciliationReport(data, journalId, today) : null;

  const run = async (fn: () => Promise<void>, ok: string) => {
    setMessage(null);
    try {
      await fn();
      setMessage({ tone: 'ok', text: ok });
      setSelectedId(null);
    } catch (e) {
      setMessage({ tone: 'error', text: errorMessage(e) });
    }
  };

  if (!journalId) return <EmptyState title="Belum ada rekening bank." />;

  return (
    <>
      <PageHeader
        title="Rekonsiliasi Bank"
        subtitle="Cocokkan setiap mutasi bank dengan catatan di buku."
        actions={
          <>
            <JournalPicker journals={banks} value={journalId} onChange={(id) => setParams({ rekening: id })} />
            <LinkButton to={`/rekonsiliasi/laporan?rekening=${journalId}`}>Laporan</LinkButton>
          </>
        }
      />

      {report && (
        <Panel className="mb-4 grid gap-4 p-5 text-sm sm:grid-cols-4">
          <Stat label="Saldo menurut bank" value={report.statementBalance === null ? '-' : formatRupiah(report.statementBalance)} />
          <Stat label="Saldo buku" value={formatRupiah(report.bookBalance)} />
          <Stat label="Mutasi bank belum cocok" value={`${report.bankOnly.length} mutasi`} tone={report.bankOnly.length ? 'text-orange-600' : 'text-ok'} />
          <Stat label="Catatan buku belum muncul di bank" value={`${report.bookOnly.length} baris`} tone={report.bookOnly.length ? 'text-orange-600' : 'text-ok'} />
        </Panel>
      )}

      {message && <div className="mb-4"><Alert tone={message.tone}>{message.text}</Alert></div>}

      {openLines.length === 0 ? (
        <Panel>
          <EmptyState
            title={data.statementLines.some((l) => l.journalId === journalId) ? 'Semua mutasi sudah dicocokkan.' : 'Belum ada mutasi untuk rekening ini.'}
            action={<LinkButton to={`/mutasi?rekening=${journalId}`} variant="primary">Impor mutasi</LinkButton>}
          />
        </Panel>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <Panel className="max-h-[70vh] overflow-y-auto">
            <ul className="divide-y divide-line">
              {openLines.map((l) => {
                const active = l.id === selected?.id;
                return (
                  <li key={l.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(l.id)}
                      aria-current={active || undefined}
                      className={`flex w-full items-start justify-between gap-3 border-l-[3px] px-4 py-3 text-left text-sm ${active ? 'border-orange bg-orange-100/40' : 'border-transparent hover:bg-navy-100/40'}`}
                    >
                      <span className="min-w-0">
                        <span className="block text-xs text-ink-soft">{formatDate(l.date)}</span>
                        <span className="block break-words text-ink">{l.description}</span>
                      </span>
                      <span className={`num whitespace-nowrap font-semibold ${l.amount > 0 ? 'text-ok' : 'text-ink'}`}>
                        {l.amount > 0 ? '+' : '−'}
                        {formatAmount(Math.abs(l.amount))}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Panel>

          {selected && <MatchPanel key={selected.id} line={selected} run={run} />}
        </div>
      )}

      {doneLines.length > 0 && (
        <div className="mt-6">
          <Button variant="ghost" onClick={() => setShowDone((s) => !s)}>
            {showDone ? 'Sembunyikan' : 'Tampilkan'} {doneLines.length} mutasi yang sudah cocok
          </Button>
          {showDone && (
            <Panel className="mt-2">
              <ul className="divide-y divide-line text-sm">
                {doneLines.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2">
                    <span className="min-w-0">
                      <span className="text-ink-soft">{formatDate(l.date)}</span> {l.description}
                      <span className="ml-2 text-xs text-ink-soft">
                        {l.reconciliation?.bankLineRefs.map((r) => {
                          const e = data.entries.find((x) => x.id === r.entryId);
                          return e ? (
                            <Link key={refKey(r)} className="mr-2 text-navy-600 hover:underline" to={`/entri/${e.id}`}>{e.number}</Link>
                          ) : null;
                        })}
                      </span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="num">{l.amount > 0 ? '+' : '−'}{formatAmount(Math.abs(l.amount))}</span>
                      <Button variant="ghost" onClick={() => run(() => store.unreconcile(l.id, today), 'Rekonsiliasi dibatalkan. Jurnal/pembayaran yang dibuat sudah dibalik.')}>Batalkan</Button>
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      )}
    </>
  );
}

function Stat({ label, value, tone = 'text-ink' }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="text-xs text-ink-soft">{label}</div>
      <div className={`num mt-0.5 text-base font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

type Manual = 'invoice' | 'account' | 'book';

function MatchPanel({ line, run }: { line: StatementLine; run: (fn: () => Promise<void>, ok: string) => Promise<void> }) {
  const data = useLedgerData();
  const store = useLedger();
  const suggestions = suggestMatches(line, data);
  const incoming = line.amount > 0;
  const [manual, setManual] = useState<Manual | null>(suggestions.length ? null : 'invoice');

  const apply = (s: Suggestion) => {
    switch (s.kind) {
      case 'book':
        return run(() => store.reconcileBook(line.id, s.refs), 'Dicocokkan dengan catatan yang sudah ada.');
      case 'invoice':
        return run(() => store.reconcileInvoices(line.id, s.partnerId, s.invoiceIds), 'Pembayaran dibuat dan mutasi dicocokkan.');
      case 'settlement':
        return run(() => store.reconcileSettlement(line.id, s.refs), `Pencairan dicatat, MDR ${formatRupiah(s.fee)} dibukukan ke biaya.`);
      case 'transit':
        return run(() => store.reconcileTransit(line.id, s.refs), 'Dana dalam perjalanan diterima.');
      case 'rule':
        return run(() => store.reconcileAccount(line.id, s.accountId, s.label), 'Dijurnal sesuai aturan dan dicocokkan.');
    }
  };

  return (
    <Panel className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-ink-soft">{formatDate(line.date)}</div>
          <p className="break-words font-medium text-ink">{line.description}</p>
        </div>
        <div className={`num text-2xl font-semibold ${incoming ? 'text-ok' : 'text-ink'}`}>
          {incoming ? '+' : '−'}
          {formatRupiah(Math.abs(line.amount))}
        </div>
      </div>

      <h3 className="mb-2 mt-5 text-sm font-semibold text-ink">Saran pasangan</h3>
      {suggestions.length === 0 ? (
        <p className="text-sm text-ink-soft">Tidak ada saran otomatis. Cocokkan manual di bawah.</p>
      ) : (
        <ul className="space-y-2">
          {suggestions.map((s, i) => {
            const c = confidence(s.score);
            return (
              <li key={i} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line p-3">
                <div className="min-w-0 flex-1">
                  <span className={`mr-2 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${c.cls}`}>{c.label}</span>
                  <span className="text-sm font-medium text-ink">{s.title}</span>
                  <p className="mt-0.5 text-xs text-ink-soft">{s.detail}</p>
                </div>
                <Button variant={i === 0 ? 'primary' : 'secondary'} onClick={() => apply(s)}>Cocokkan</Button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-6 border-t border-line pt-4">
        <h3 className="mb-2 text-sm font-semibold text-ink">Cocokkan manual</h3>
        <div className="flex flex-wrap gap-1" role="tablist">
          {(
            [
              ['invoice', incoming ? 'Pelunasan faktur' : 'Bayar tagihan'],
              ['account', 'Langsung ke akun'],
              ['book', 'Catatan buku'],
            ] as [Manual, string][]
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={manual === k}
              onClick={() => setManual(k)}
              className={`rounded-md px-3 py-1.5 text-sm ${manual === k ? 'bg-navy text-white' : 'text-ink-soft hover:bg-navy-100'}`}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="mt-3">
          {manual === 'invoice' && <ManualInvoice line={line} run={run} />}
          {manual === 'account' && <ManualAccount line={line} run={run} />}
          {manual === 'book' && <ManualBook line={line} run={run} />}
        </div>
      </div>
    </Panel>
  );
}

function ManualInvoice({ line, run }: { line: StatementLine; run: (fn: () => Promise<void>, ok: string) => Promise<void> }) {
  const data = useLedgerData();
  const store = useLedger();
  const incoming = line.amount > 0;
  const partners = data.partners.filter((p) => p.active && (incoming ? p.kind !== 'supplier' : p.kind !== 'customer'));
  const [partnerId, setPartnerId] = useState('');
  const docs = data.invoices
    .filter((i) => i.partnerId === partnerId && i.status === 'posted' && i.kind === (incoming ? 'out_invoice' : 'in_invoice'))
    .map((i) => ({ i, residual: invoiceResidual(i, data) }))
    .filter((x) => x.residual > 0)
    .sort((a, b) => a.i.dueDate.localeCompare(b.i.dueDate));
  const totalOpen = docs.reduce((s, d) => s + d.residual, 0);
  const abs = Math.abs(line.amount);

  return (
    <div className="space-y-3 text-sm">
      <Field label={incoming ? 'Pelanggan' : 'Supplier'}>
        <select className={inputClass} value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
          <option value="">Pilih…</option>
          {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Field>
      {partnerId && (
        <>
          {docs.length === 0 ? (
            <p className="text-ink-soft">Tidak ada dokumen terbuka; seluruh jumlah dicatat sebagai {incoming ? 'deposit pelanggan' : 'uang muka pembelian'}.</p>
          ) : (
            <ul className="text-ink-soft">
              {docs.map(({ i, residual }) => (
                <li key={i.id}>{i.number}: sisa {formatAmount(residual)}, jatuh tempo {formatDate(i.dueDate)}</li>
              ))}
            </ul>
          )}
          <p className="text-ink">
            Dana {formatRupiah(abs)} dialokasikan ke dokumen dengan jatuh tempo terlama lebih dulu.
            {abs > totalOpen && ` Kelebihan ${formatRupiah(abs - totalOpen)} menjadi ${incoming ? 'deposit pelanggan' : 'uang muka pembelian'}.`}
          </p>
          <Button variant="primary" onClick={() => run(() => store.reconcileInvoices(line.id, partnerId, []), 'Pembayaran dibuat dan mutasi dicocokkan.')}>
            Catat pembayaran & cocokkan
          </Button>
        </>
      )}
    </div>
  );
}

function ManualAccount({ line, run }: { line: StatementLine; run: (fn: () => Promise<void>, ok: string) => Promise<void> }) {
  const data = useLedgerData();
  const store = useLedger();
  const journal = data.journals.find((j) => j.id === line.journalId);
  const [accountId, setAccountId] = useState('');
  const [label, setLabel] = useState(line.description);
  return (
    <div className="grid gap-3 text-sm sm:grid-cols-2">
      <Field label="Akun lawan">
        <AccountSelect accounts={data.accounts.filter((a) => a.id !== journal?.defaultAccountId)} value={accountId} onChange={setAccountId} />
      </Field>
      <Field label="Keterangan jurnal"><input className={inputClass} value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
      <div className="sm:col-span-2">
        <Button variant="primary" disabled={!accountId} onClick={() => run(() => store.reconcileAccount(line.id, accountId, label), 'Dijurnal dan dicocokkan.')}>
          Jurnal & cocokkan
        </Button>
      </div>
    </div>
  );
}

function ManualBook({ line, run }: { line: StatementLine; run: (fn: () => Promise<void>, ok: string) => Promise<void> }) {
  const data = useLedgerData();
  const store = useLedger();
  const candidates = unreconciledBookLines(data, line.journalId).filter((b) => Math.sign(b.amount) === Math.sign(line.amount));
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const sum = candidates.filter((b) => picked.has(refKey(b.ref))).reduce((s, b) => s + b.amount, 0);

  if (!candidates.length) return <p className="text-sm text-ink-soft">Tidak ada catatan buku di rekening ini yang belum dicocokkan.</p>;
  return (
    <div className="space-y-3 text-sm">
      <ul className="max-h-64 divide-y divide-line overflow-y-auto rounded-md border border-line">
        {candidates.map((b) => {
          const k = refKey(b.ref);
          return (
            <li key={k}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-navy-100/40">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-navy"
                  checked={picked.has(k)}
                  onChange={(e) => {
                    const next = new Set(picked);
                    if (e.target.checked) next.add(k);
                    else next.delete(k);
                    setPicked(next);
                  }}
                />
                <span className="flex-1">
                  <span className="font-medium">{b.entry.number}</span> <span className="text-ink-soft">{formatDate(b.date)}, {b.label}</span>
                </span>
                <span className="num">{formatAmount(b.amount)}</span>
              </label>
            </li>
          );
        })}
      </ul>
      <p className={sum === line.amount ? 'text-ok' : 'text-ink-soft'}>
        Terpilih {formatRupiah(sum)} dari {formatRupiah(line.amount)}
        {sum !== line.amount && sum !== 0 && `, selisih ${formatRupiah(line.amount - sum)}`}
      </p>
      <Button
        variant="primary"
        disabled={sum !== line.amount}
        onClick={() => run(() => store.reconcileBook(line.id, candidates.filter((b) => picked.has(refKey(b.ref))).map((b) => b.ref)), 'Dicocokkan dengan catatan buku.')}
      >
        Cocokkan
      </Button>
    </div>
  );
}
