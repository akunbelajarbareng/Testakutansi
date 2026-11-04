import { useState } from 'react';
import { formatDate } from '../../lib/format';
import { useLedger, useLedgerData } from '../../store/ledgerStore';
import { Alert, Button, Field, PageHeader, Panel, errorMessage, inputClass } from '../../components/ui';
import { RulesPanel } from '../banking/RulesPanel';
import { TaxSettingsPanel } from '../tax/TaxSettingsPanel';

export function SettingsPage() {
  const data = useLedgerData();
  const { setLockDate, reset, saveCompany } = useLedger();
  const [profile, setProfile] = useState({ name: data.company.name, address: data.company.address ?? '', npwp: data.company.npwp ?? '', phone: data.company.phone ?? '' });
  const [lock, setLock] = useState(data.company.lockDate ?? '');
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [confirm, setConfirm] = useState<'demo' | 'empty' | null>(null);

  const act = async (fn: () => Promise<void>, ok: string) => {
    try {
      await fn();
      setMessage({ tone: 'ok', text: ok });
    } catch (e) {
      setMessage({ tone: 'error', text: errorMessage(e) });
    }
  };

  return (
    <>
      <PageHeader title="Pengaturan" subtitle={data.company.name} />
      {message && <div className="mb-4"><Alert tone={message.tone}>{message.text}</Alert></div>}

      <Panel className="mb-4 p-5">
        <h2 className="text-base font-semibold text-navy">Profil perusahaan</h2>
        <p className="mt-1 text-sm text-ink-soft">Tampil di kop faktur yang dicetak.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Nama perusahaan"><input className={inputClass} value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} /></Field>
          <Field label="NPWP"><input className={`${inputClass} num`} value={profile.npwp} onChange={(e) => setProfile({ ...profile, npwp: e.target.value })} /></Field>
          <Field label="Alamat"><input className={inputClass} value={profile.address} onChange={(e) => setProfile({ ...profile, address: e.target.value })} /></Field>
          <Field label="Telepon"><input className={inputClass} value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} /></Field>
        </div>
        <Button
          variant="primary"
          className="mt-4"
          disabled={profile.name.trim().length < 2}
          onClick={() => act(() => saveCompany({ ...data.company, ...profile, name: profile.name.trim() }), 'Profil perusahaan disimpan.')}
        >
          Simpan profil
        </Button>
      </Panel>

      <Panel className="mb-4 p-5">
        <h2 className="text-base font-semibold text-navy">Tanggal kunci</h2>
        <p className="mt-1 max-w-prose text-sm text-ink-soft">
          Entri bertanggal sampai tanggal ini tidak bisa diposting atau dibalik. Untuk penutupan bulanan yang tercatat (checklist, ringkasan angka, riwayat), gunakan halaman Tutup Buku.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="w-48">
            <Field label="Kunci sampai">
              <input type="date" className={inputClass} value={lock} onChange={(e) => setLock(e.target.value)} />
            </Field>
          </div>
          <Button variant="primary" disabled={!lock} onClick={() => act(() => setLockDate(lock), `Periode sampai ${formatDate(lock)} dikunci.`)}>
            Kunci periode
          </Button>
          {data.company.lockDate && (
            <Button variant="ghost" onClick={() => act(async () => { await setLockDate(null); setLock(''); }, 'Kunci periode dibuka.')}>
              Buka kunci
            </Button>
          )}
        </div>
        <p className="mt-3 text-sm text-ink">
          Status: {data.company.lockDate ? `terkunci sampai ${formatDate(data.company.lockDate)}` : 'tidak ada periode terkunci'}
        </p>
      </Panel>

      <TaxSettingsPanel />

      <RulesPanel />

      <Panel className="p-5">
        <h2 className="text-base font-semibold text-navy">Data prototipe</h2>
        <p className="mt-1 max-w-prose text-sm text-ink-soft">
          Di prototipe ini data tersimpan di browser perangkat ini saja. Bagan akun, jurnal, pajak, dan kontak contoh dikembalikan ke standar.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          {confirm ? (
            <>
              <span className="self-center text-sm text-bad">
                {confirm === 'demo' ? 'Semua data diganti dengan data contoh.' : 'Semua entri, faktur, tagihan, pembayaran, dan mutasi bank dihapus.'} Lanjutkan?
              </span>
              <Button variant="danger" onClick={() => act(async () => { await reset(confirm); setConfirm(null); setLock(''); }, confirm === 'demo' ? 'Data contoh dimuat ulang.' : 'Data dikosongkan.')}>
                Ya, lanjutkan
              </Button>
              <Button variant="ghost" onClick={() => setConfirm(null)}>Batal</Button>
            </>
          ) : (
            <>
              <Button onClick={() => setConfirm('demo')}>Muat ulang data contoh</Button>
              <Button variant="danger" onClick={() => setConfirm('empty')}>Kosongkan semua transaksi</Button>
            </>
          )}
        </div>
      </Panel>
    </>
  );
}
