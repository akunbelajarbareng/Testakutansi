import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { parseStatement, planImport, type ParsedStatement, type StatementFormat } from '../../domain';
import { formatAmount, formatDate, formatRupiah, todayISO } from '../../lib/format';
import { useLedger, useLedgerData } from '../../store/ledgerStore';
import { MoneyInput } from '../../components/MoneyInput';
import { Alert, Button, DocBadge, EmptyState, Field, PageHeader, Panel, errorMessage, inputClass, td, tdNum, th, thNum } from '../../components/ui';
import { JournalPicker, liquidityJournals } from './JournalPicker';

export function StatementPage() {
  const data = useLedgerData();
  const { importStatement, addStatementLine, deleteImport } = useLedger();
  const banks = liquidityJournals(data.journals, 'bank');
  const [params, setParams] = useSearchParams();
  const journalId = params.get('rekening') ?? banks[0]?.id ?? '';
  const journal = data.journals.find((j) => j.id === journalId);

  const [format, setFormat] = useState<StatementFormat>(journal?.statementFormat ?? 'bca');
  const [file, setFile] = useState<{ name: string; parsed: ParsedStatement } | null>(null);
  const [manual, setManual] = useState({ date: todayISO(), description: '', amount: 0, outgoing: false });
  const [showManual, setShowManual] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const plan = useMemo(() => (file ? planImport(file.parsed, journalId, data) : null), [file, journalId, data]);
  const lines = data.statementLines.filter((l) => l.journalId === journalId).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const imports = data.statementImports.filter((i) => i.journalId === journalId).sort((a, b) => b.importedAt.localeCompare(a.importedAt));

  const onFile = async (f: File | undefined) => {
    setMessage(null);
    if (!f) return;
    const text = await f.text();
    setFile({ name: f.name, parsed: parseStatement(text, format) });
  };

  const run = async (fn: () => Promise<string>) => {
    try {
      setMessage({ tone: 'ok', text: await fn() });
    } catch (e) {
      setMessage({ tone: 'error', text: errorMessage(e) });
    }
  };

  if (!journal) return <EmptyState title="Belum ada rekening bank." action={<Link to="/rekening" className="text-navy-600 underline">Buat rekening</Link>} />;

  return (
    <>
      <PageHeader title="Mutasi Bank" subtitle="Impor mutasi dari internet banking, lalu cocokkan di halaman Rekonsiliasi." actions={<JournalPicker journals={banks} value={journalId} onChange={(id) => setParams({ rekening: id })} />} />

      <div className="space-y-4">
        {message && <Alert tone={message.tone}>{message.text}</Alert>}

        <Panel className="p-5">
          <h2 className="text-base font-semibold text-navy">Impor file mutasi</h2>
          <div className="mt-4 flex flex-wrap items-end gap-4">
            <div className="w-56">
              <Field label="Format">
                <select className={inputClass} value={format} onChange={(e) => { setFormat(e.target.value as StatementFormat); setFile(null); }}>
                  <option value="bca">CSV mutasi BCA</option>
                  <option value="generic">CSV umum</option>
                </select>
              </Field>
            </div>
            <Field label="File CSV">
              <input type="file" accept=".csv,text/csv" className="block text-sm file:mr-3 file:rounded-md file:border file:border-line file:bg-white file:px-3 file:py-2 file:text-sm" onChange={(e) => onFile(e.target.files?.[0])} />
            </Field>
            <a className="pb-2 text-sm text-navy-600 hover:underline" href="/contoh-mutasi-bca.csv" download>Unduh contoh file BCA</a>
          </div>
          <p className="mt-2 text-xs text-ink-soft">
            {format === 'bca'
              ? 'Ekspor mutasi rekening dari KlikBCA/myBCA dalam format CSV. Baris tertunda (PEND) dilewati.'
              : 'Header wajib: tanggal, keterangan, jumlah (opsional: saldo). Jumlah negatif untuk uang keluar.'}
          </p>

          {file && plan && (
            <div className="mt-4 space-y-3 rounded-md border border-line bg-paper/60 p-4 text-sm">
              <p className="font-medium text-ink">{file.name}</p>
              {file.parsed.errors.map((e) => <p key={e} className="text-bad">{e}</p>)}
              {file.parsed.accountNumber && journal.accountNumber && file.parsed.accountNumber !== journal.accountNumber.replace(/\D/g, '') && (
                <Alert tone="warn">No. rekening di file ({file.parsed.accountNumber}) berbeda dengan rekening terpilih ({journal.accountNumber}).</Alert>
              )}
              <ul className="space-y-1">
                <li>{file.parsed.lines.length} mutasi terbaca{file.parsed.periodStart && `, periode ${formatDate(file.parsed.periodStart)} sampai ${formatDate(file.parsed.periodEnd!)}`}</li>
                <li><strong>{plan.newLines.length} mutasi baru</strong> akan diimpor{plan.duplicateCount > 0 && `, ${plan.duplicateCount} sudah pernah diimpor dan dilewati`}</li>
                {file.parsed.skippedPending > 0 && <li>{file.parsed.skippedPending} transaksi tertunda (PEND) dilewati</li>}
                {plan.balanceCheck && (
                  <li className={plan.balanceCheck.ok ? 'text-ok' : 'text-bad'}>
                    Saldo awal {formatRupiah(plan.balanceCheck.opening)} + mutasi {formatRupiah(plan.balanceCheck.movement)} {plan.balanceCheck.ok ? '=' : '≠'} saldo akhir {formatRupiah(plan.balanceCheck.closing)}
                  </li>
                )}
                {plan.openingCheck && (
                  <li className={plan.openingCheck.ok ? 'text-ok' : 'text-orange-600'}>
                    {plan.openingCheck.ok
                      ? 'Saldo awal bank sama dengan saldo buku sebelum periode ini.'
                      : `Saldo awal bank ${formatRupiah(plan.openingCheck.statement)} berbeda dengan saldo buku ${formatRupiah(plan.openingCheck.book)}. Periksa transaksi sebelum periode ini.`}
                  </li>
                )}
              </ul>
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  disabled={!plan.newLines.length}
                  onClick={() =>
                    run(async () => {
                      const r = await importStatement(journalId, file.name, format, file.parsed);
                      setFile(null);
                      return `${r.imported} mutasi diimpor${r.duplicates ? `, ${r.duplicates} duplikat dilewati` : ''}.`;
                    })
                  }
                >
                  Impor {plan.newLines.length} mutasi
                </Button>
                <Button variant="ghost" onClick={() => setFile(null)}>Batal</Button>
              </div>
            </div>
          )}

          <div className="mt-4 border-t border-line pt-4">
            {!showManual ? (
              <Button variant="ghost" onClick={() => setShowManual(true)}>+ Input mutasi manual</Button>
            ) : (
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Tanggal"><input type="date" className={inputClass} value={manual.date} onChange={(e) => setManual({ ...manual, date: e.target.value })} /></Field>
                <div className="min-w-[240px] flex-1"><Field label="Keterangan"><input className={inputClass} value={manual.description} onChange={(e) => setManual({ ...manual, description: e.target.value })} /></Field></div>
                <Field label="Arah">
                  <select className={inputClass} value={manual.outgoing ? 'out' : 'in'} onChange={(e) => setManual({ ...manual, outgoing: e.target.value === 'out' })}>
                    <option value="in">Masuk (CR)</option>
                    <option value="out">Keluar (DB)</option>
                  </select>
                </Field>
                <div className="w-40"><Field label="Jumlah"><MoneyInput value={manual.amount} onChange={(v) => setManual({ ...manual, amount: v })} aria-label="Jumlah mutasi" /></Field></div>
                <Button
                  variant="primary"
                  onClick={() =>
                    run(async () => {
                      await addStatementLine({ journalId, date: manual.date, description: manual.description, amount: manual.outgoing ? -manual.amount : manual.amount });
                      setManual({ ...manual, description: '', amount: 0 });
                      return 'Mutasi ditambahkan.';
                    })
                  }
                >
                  Tambah
                </Button>
                <Button variant="ghost" onClick={() => setShowManual(false)}>Tutup</Button>
              </div>
            )}
          </div>
        </Panel>

        <Panel>
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="font-semibold text-navy">Mutasi {journal.name}</h2>
            <Link to={`/rekonsiliasi?rekening=${journalId}`} className="text-sm text-navy-600 hover:underline">Buka rekonsiliasi</Link>
          </div>
          {lines.length === 0 ? (
            <EmptyState title="Belum ada mutasi. Impor file CSV dari internet banking untuk mulai." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse">
                <thead>
                  <tr>
                    <th className={th}>Tanggal</th>
                    <th className={th}>Keterangan</th>
                    <th className={thNum}>Masuk</th>
                    <th className={thNum}>Keluar</th>
                    <th className={thNum}>Saldo bank</th>
                    <th className={th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <td className={`${td} whitespace-nowrap`}>{formatDate(l.date)}</td>
                      <td className={`${td} max-w-md`}>{l.description}</td>
                      <td className={tdNum}>{l.amount > 0 ? formatAmount(l.amount) : ''}</td>
                      <td className={tdNum}>{l.amount < 0 ? formatAmount(-l.amount) : ''}</td>
                      <td className={`${tdNum} text-ink-soft`}>{l.balance !== null ? formatAmount(l.balance) : ''}</td>
                      <td className={td}><DocBadge state={l.status === 'reconciled' ? 'matched' : 'unmatched'} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        {imports.length > 0 && (
          <Panel className="p-5">
            <h2 className="mb-3 text-base font-semibold text-navy">Riwayat impor</h2>
            <ul className="divide-y divide-line text-sm">
              {imports.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <span className="font-medium">{i.fileName}</span>
                    <span className="ml-2 text-ink-soft">
                      {i.importedCount} mutasi{i.duplicateCount ? `, ${i.duplicateCount} duplikat` : ''}
                      {i.periodStart ? `, ${formatDate(i.periodStart)} sampai ${formatDate(i.periodEnd!)}` : ''}
                    </span>
                  </span>
                  <Button variant="ghost" onClick={() => run(async () => { await deleteImport(i.id); return `Impor ${i.fileName} dihapus.`; })}>Hapus impor</Button>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
    </>
  );
}
