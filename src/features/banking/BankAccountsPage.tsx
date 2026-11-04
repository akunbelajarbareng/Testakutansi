import { useState } from 'react';
import { Link } from 'react-router-dom';
import { accountNetBalances, statementBalanceAt } from '../../domain';
import { formatDate, formatRupiah, todayISO } from '../../lib/format';
import { useLedger, useLedgerData, type NewBankAccountInput } from '../../store/ledgerStore';
import { MoneyInput } from '../../components/MoneyInput';
import { Alert, Button, Field, PageHeader, Panel, errorMessage, inputClass } from '../../components/ui';
import { liquidityJournals } from './JournalPicker';

export function BankAccountsPage() {
  const data = useLedgerData();
  const { createBankAccount, transfer } = useLedger();
  const [mode, setMode] = useState<'new' | 'transfer' | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const today = todayISO();
  const net = accountNetBalances(data);
  const journals = liquidityJournals(data.journals);

  const [acc, setAcc] = useState<NewBankAccountInput>({ type: 'bank', name: '', code: '', bankName: 'BCA', accountNumber: '' });
  const [tr, setTr] = useState({ fromJournalId: journals.find((j) => j.type === 'cash')?.id ?? '', toJournalId: journals.find((j) => j.type === 'bank')?.id ?? '', date: today, amount: 0, memo: '' });

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      setMessage({ tone: 'ok', text: ok });
      setMode(null);
    } catch (e) {
      setMessage({ tone: 'error', text: errorMessage(e) });
    }
  };

  const toBank = data.journals.find((j) => j.id === tr.toJournalId)?.type === 'bank';

  return (
    <>
      <PageHeader
        title="Rekening Bank & Kas"
        subtitle="Saldo menurut buku dibanding saldo menurut mutasi bank yang terakhir diimpor."
        actions={
          <>
            <Button onClick={() => setMode('transfer')}>Transfer / setoran</Button>
            <Button variant="primary" onClick={() => setMode('new')}>Rekening baru</Button>
          </>
        }
      />
      <div className="space-y-4">
        {message && <Alert tone={message.tone}>{message.text}</Alert>}

        {mode === 'new' && (
          <Panel className="p-5">
            <h2 className="mb-4 text-base font-semibold text-navy">Rekening baru</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <Field label="Jenis">
                <select className={inputClass} value={acc.type} onChange={(e) => setAcc({ ...acc, type: e.target.value as 'bank' | 'cash' })}>
                  <option value="bank">Rekening bank</option>
                  <option value="cash">Kas (toko/outlet)</option>
                </select>
              </Field>
              <Field label="Nama" hint={acc.type === 'bank' ? 'mis. Bank BCA Payroll' : 'mis. Kas Outlet 2'}>
                <input className={inputClass} value={acc.name} onChange={(e) => setAcc({ ...acc, name: e.target.value })} />
              </Field>
              <Field label="Kode jurnal" hint="Awalan nomor, mis. BNK2">
                <input className={`${inputClass} uppercase`} maxLength={6} value={acc.code} onChange={(e) => setAcc({ ...acc, code: e.target.value })} />
              </Field>
              {acc.type === 'bank' && (
                <>
                  <Field label="Bank"><input className={inputClass} value={acc.bankName} onChange={(e) => setAcc({ ...acc, bankName: e.target.value })} /></Field>
                  <Field label="No. rekening"><input className={`${inputClass} num`} value={acc.accountNumber} onChange={(e) => setAcc({ ...acc, accountNumber: e.target.value })} /></Field>
                </>
              )}
            </div>
            <p className="mt-3 text-xs text-ink-soft">Akun buku besar dibuat otomatis: bank di 1113–1119, kas di 1104–1109.</p>
            <div className="mt-4 flex gap-2">
              <Button variant="primary" onClick={() => run(() => createBankAccount(acc), `Rekening ${acc.name} dibuat.`)}>Buat rekening</Button>
              <Button variant="ghost" onClick={() => setMode(null)}>Batal</Button>
            </div>
          </Panel>
        )}

        {mode === 'transfer' && (
          <Panel className="p-5">
            <h2 className="mb-4 text-base font-semibold text-navy">Transfer antar rekening / setoran kas</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <Field label="Dari">
                <select className={inputClass} value={tr.fromJournalId} onChange={(e) => setTr({ ...tr, fromJournalId: e.target.value })}>
                  {journals.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
                </select>
              </Field>
              <Field label="Ke">
                <select className={inputClass} value={tr.toJournalId} onChange={(e) => setTr({ ...tr, toJournalId: e.target.value })}>
                  {journals.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
                </select>
              </Field>
              <Field label="Tanggal"><input type="date" className={inputClass} value={tr.date} onChange={(e) => setTr({ ...tr, date: e.target.value })} /></Field>
              <Field label="Jumlah"><MoneyInput value={tr.amount} onChange={(v) => setTr({ ...tr, amount: v })} aria-label="Jumlah transfer" /></Field>
              <Field label="Keterangan"><input className={inputClass} value={tr.memo} onChange={(e) => setTr({ ...tr, memo: e.target.value })} /></Field>
            </div>
            <p className="mt-3 text-sm text-ink-soft">
              {toBank
                ? 'Tujuan bank: dana dicatat di 1103 Dana dalam Perjalanan sampai mutasinya muncul di bank dan dicocokkan di Rekonsiliasi.'
                : 'Tujuan kas: saldo kas langsung bertambah.'}
            </p>
            <div className="mt-4 flex gap-2">
              <Button variant="primary" onClick={() => run(() => transfer(tr), 'Transfer dicatat.')}>Catat transfer</Button>
              <Button variant="ghost" onClick={() => setMode(null)}>Batal</Button>
            </div>
          </Panel>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          {journals.map((j) => {
            const book = net.get(j.defaultAccountId!) ?? 0;
            const stmt = j.type === 'bank' ? statementBalanceAt(data, j.id, today) : null;
            const open = data.statementLines.filter((l) => l.journalId === j.id && l.status === 'open').length;
            const lastClose = data.cashSessions.filter((s) => s.journalId === j.id).sort((a, b) => b.date.localeCompare(a.date))[0];
            const account = data.accounts.find((a) => a.id === j.defaultAccountId);
            return (
              <Panel key={j.id} className="flex flex-col p-5">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-base font-semibold text-ink">{j.name}</h2>
                  <span className="text-xs text-ink-soft">{j.code}, akun {account?.code}</span>
                </div>
                <p className="text-sm text-ink-soft">{j.type === 'bank' ? `${j.bankName ?? 'Bank'} ${j.accountNumber ?? ''}` : 'Kas tunai'}</p>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-ink-soft">Saldo buku</dt>
                    <dd className="num text-lg font-semibold text-navy">{formatRupiah(book)}</dd>
                  </div>
                  {j.type === 'bank' ? (
                    <div>
                      <dt className="text-xs text-ink-soft">Saldo menurut bank</dt>
                      <dd className="num text-lg font-semibold text-ink">{stmt === null ? 'Belum ada mutasi' : formatRupiah(stmt)}</dd>
                    </div>
                  ) : (
                    <div>
                      <dt className="text-xs text-ink-soft">Tutup kas terakhir</dt>
                      <dd className="text-ink">{lastClose ? `${formatDate(lastClose.date)}, selisih ${formatRupiah(lastClose.difference)}` : 'Belum pernah'}</dd>
                    </div>
                  )}
                </dl>
                <div className="mt-4 flex flex-wrap gap-3 border-t border-line pt-3 text-sm">
                  {j.type === 'bank' ? (
                    <>
                      <Link className={open ? 'font-medium text-orange-600 hover:underline' : 'text-navy-600 hover:underline'} to={`/rekonsiliasi?rekening=${j.id}`}>
                        {open ? `${open} mutasi belum dicocokkan` : 'Semua mutasi sudah cocok'}
                      </Link>
                      <Link className="text-navy-600 hover:underline" to={`/mutasi?rekening=${j.id}`}>Impor mutasi</Link>
                    </>
                  ) : (
                    <Link className="text-navy-600 hover:underline" to={`/kas-harian?rekening=${j.id}`}>Tutup kas harian</Link>
                  )}
                  <Link className="text-navy-600 hover:underline" to={`/buku-besar?akun=${j.defaultAccountId}`}>Buku besar</Link>
                </div>
              </Panel>
            );
          })}
        </div>
      </div>
    </>
  );
}
