import { useState } from 'react';
import { buyerTaxIssues, type CustomerTier, type Partner, type PartnerKind, type TaxIdType } from '../../domain';
import { newId } from '../../lib/id';
import { useLedger, useLedgerData } from '../../store/ledgerStore';
import { RECEIVABLE_BY_TIER } from '../../data/seed/partners';
import { MoneyInput } from '../../components/MoneyInput';
import { Alert, Button, Field, Panel, errorMessage, inputClass } from '../../components/ui';

const TIER_LABEL: Record<CustomerTier, string> = { retail: 'Retail', ukm: 'UKM Kuliner', grosir: 'Grosir' };
export { TIER_LABEL };

export function PartnerForm({ partner, onDone }: { partner?: Partner; onDone: () => void }) {
  const data = useLedgerData();
  const savePartner = useLedger((s) => s.savePartner);
  const acc = (code: string) => data.accounts.find((a) => a.code === code)?.id ?? '';
  const [p, setP] = useState<Partner>(
    partner ?? {
      id: newId(),
      name: '',
      kind: 'customer',
      tier: 'ukm',
      paymentTermDays: 14,
      creditLimit: 0,
      receivableAccountId: acc(RECEIVABLE_BY_TIER.ukm),
      payableAccountId: acc('2101'),
      npwp: '',
      address: '',
      phone: '',
      active: true,
    },
  );
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Partner>(k: K, v: Partner[K]) => setP((x) => ({ ...x, [k]: v }));
  const isCustomer = p.kind !== 'supplier';
  const receivables = data.accounts.filter((a) => a.code.startsWith('12') && a.active);
  const payables = data.accounts.filter((a) => a.code.startsWith('21') && a.active);

  const save = async (active = p.active) => {
    setError(null);
    try {
      await savePartner({ ...p, active, tier: isCustomer ? (p.tier ?? 'retail') : null });
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Panel className="mb-4 p-5">
      <h2 className="mb-4 text-base font-semibold text-navy">{partner ? `Ubah ${partner.name}` : 'Kontak baru'}</h2>
      {error && <div className="mb-4"><Alert tone="error">{error}</Alert></div>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">
          <Field label="Nama"><input className={inputClass} value={p.name} onChange={(e) => set('name', e.target.value)} /></Field>
        </div>
        <Field label="Jenis">
          <select className={inputClass} value={p.kind} onChange={(e) => set('kind', e.target.value as PartnerKind)}>
            <option value="customer">Pelanggan</option>
            <option value="supplier">Supplier</option>
            <option value="both">Pelanggan & supplier</option>
          </select>
        </Field>
        {isCustomer && (
          <Field label="Tier member" hint="Menentukan akun pendapatan & piutang bawaan">
            <select
              className={inputClass}
              value={p.tier ?? 'retail'}
              onChange={(e) => {
                const tier = e.target.value as CustomerTier;
                setP((x) => ({ ...x, tier, receivableAccountId: acc(RECEIVABLE_BY_TIER[tier]) }));
              }}
            >
              {Object.entries(TIER_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
        )}
        <Field label="Termin pembayaran (hari)" hint="0 = tunai">
          <input type="number" min={0} className={`${inputClass} num`} value={p.paymentTermDays} onChange={(e) => set('paymentTermDays', Math.max(0, Number.parseInt(e.target.value || '0', 10)))} />
        </Field>
        {isCustomer && (
          <Field label="Batas kredit" hint="Kosongkan bila tanpa batas">
            <MoneyInput value={p.creditLimit} onChange={(v) => set('creditLimit', v)} aria-label="Batas kredit" />
          </Field>
        )}
        {isCustomer && (
          <Field label="Akun piutang">
            <select className={inputClass} value={p.receivableAccountId} onChange={(e) => set('receivableAccountId', e.target.value)}>
              {receivables.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
            </select>
          </Field>
        )}
        {p.kind !== 'customer' && (
          <Field label="Akun utang">
            <select className={inputClass} value={p.payableAccountId} onChange={(e) => set('payableAccountId', e.target.value)}>
              {payables.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Jenis identitas pajak">
          <select className={inputClass} value={p.taxIdType ?? 'TIN'} onChange={(e) => set('taxIdType', e.target.value as TaxIdType)}>
            <option value="TIN">NPWP (16 digit)</option>
            <option value="NIK">NIK</option>
            <option value="PASSPORT">Paspor</option>
            <option value="OTHER">Lainnya</option>
          </select>
        </Field>
        <Field label={(p.taxIdType ?? 'TIN') === 'NIK' ? 'NIK' : 'NPWP / nomor identitas'}><input className={`${inputClass} num`} value={p.npwp ?? ''} onChange={(e) => set('npwp', e.target.value)} /></Field>
        {(p.taxIdType ?? 'TIN') === 'TIN' && (
          <Field label="ID TKU" hint="Kosongkan bila kantor pusat (NPWP + 000000)"><input className={`${inputClass} num`} value={p.nitku ?? ''} onChange={(e) => set('nitku', e.target.value)} /></Field>
        )}
        <Field label="Email"><input type="email" className={inputClass} value={p.email ?? ''} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="Telepon"><input className={inputClass} value={p.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></Field>
        <div className="sm:col-span-2">
          <Field label="Alamat"><input className={inputClass} value={p.address ?? ''} onChange={(e) => set('address', e.target.value)} /></Field>
        </div>
      </div>
      {isCustomer && buyerTaxIssues(p).length > 0 && (
        <p className="mt-3 text-xs text-orange-600">Belum siap untuk Faktur Pajak: {buyerTaxIssues(p).join(' ')}</p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => save()}>Simpan kontak</Button>
        {partner && <Button variant={p.active ? 'danger' : 'secondary'} onClick={() => save(!p.active)}>{p.active ? 'Nonaktifkan' : 'Aktifkan kembali'}</Button>}
        <Button variant="ghost" onClick={onDone}>Batal</Button>
      </div>
    </Panel>
  );
}
