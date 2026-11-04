import { useState } from 'react';
import { sellerTaxIssues } from '../../domain';
import { useLedger, useLedgerData } from '../../store/ledgerStore';
import { TEMPLATE_VERSION_ASSUMED } from '../../lib/coretaxTemplate';
import { Alert, Button, Field, Panel, errorMessage, inputClass } from '../../components/ui';

/** Pengaturan pajak perusahaan: identitas penjual, status pedagang eceran, kode Coretax per pajak, status template. */
export function TaxSettingsPanel() {
  const data = useLedgerData();
  const { saveCompany, saveTax } = useLedger();
  const c = data.company;
  const [f, setF] = useState({ npwp: c.npwp ?? '', nitku: c.nitku ?? '', retailTrader: !!c.retailTrader, verified: !!c.coretaxTemplateVerified });
  const [taxInfo, setTaxInfo] = useState<Record<string, { code: string; info: string }>>(
    Object.fromEntries(data.taxes.map((t) => [t.id, { code: t.coretaxCode ?? '', info: t.coretaxAdditionalInfo ?? '' }])),
  );
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const issues = sellerTaxIssues({ ...c, npwp: f.npwp, nitku: f.nitku });

  const save = async () => {
    setMessage(null);
    try {
      await saveCompany({ ...c, npwp: f.npwp.replace(/\D/g, ''), nitku: f.nitku.replace(/\D/g, ''), retailTrader: f.retailTrader, coretaxTemplateVerified: f.verified });
      for (const t of data.taxes) {
        const v = taxInfo[t.id];
        if (v && (v.code !== (t.coretaxCode ?? '') || v.info !== (t.coretaxAdditionalInfo ?? ''))) await saveTax({ ...t, coretaxCode: v.code.trim(), coretaxAdditionalInfo: v.info.trim() });
      }
      setMessage({ tone: 'ok', text: 'Pengaturan pajak disimpan.' });
    } catch (e) {
      setMessage({ tone: 'error', text: errorMessage(e) });
    }
  };

  return (
    <Panel className="mb-4 p-5">
      <h2 className="text-base font-semibold text-navy">Pajak</h2>
      {message && <div className="mt-3"><Alert tone={message.tone}>{message.text}</Alert></div>}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="NPWP perusahaan (16 digit)"><input className={`${inputClass} num`} value={f.npwp} onChange={(e) => setF({ ...f, npwp: e.target.value })} /></Field>
        <Field label="ID TKU penjual" hint="Kosongkan bila kantor pusat (NPWP + 000000)"><input className={`${inputClass} num`} value={f.nitku} onChange={(e) => setF({ ...f, nitku: e.target.value })} /></Field>
      </div>
      {issues.length > 0 && <p className="mt-2 text-xs text-orange-600">{issues.join(' ')}</p>}
      <label className="mt-4 flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-navy" checked={f.retailTrader} onChange={(e) => setF({ ...f, retailTrader: e.target.checked })} />
        <span>Terdaftar sebagai PKP Pedagang Eceran<span className="block text-xs text-ink-soft">Mengaktifkan rekap penjualan eceran digunggung. Jangan aktifkan bila belum terdaftar; pelaporan digunggung oleh PKP yang tidak memenuhi syarat dapat dikenai sanksi.</span></span>
      </label>

      <h3 className="mb-2 mt-5 text-sm font-semibold text-ink">Kode transaksi Coretax per jenis pajak</h3>
      <div className="space-y-3">
        {data.taxes.map((t) => (
          <div key={t.id} className="grid gap-3 sm:grid-cols-[1fr_120px_2fr]">
            <div className="pt-2 text-sm">{t.name}</div>
            <input className={`${inputClass} num`} value={taxInfo[t.id]?.code ?? ''} onChange={(e) => setTaxInfo({ ...taxInfo, [t.id]: { ...taxInfo[t.id], code: e.target.value } })} aria-label={`Kode transaksi ${t.name}`} />
            <input className={inputClass} placeholder={t.coretaxCode === '07' || t.coretaxCode === '08' ? 'Keterangan tambahan/cap fasilitas (wajib, tanya konsultan)' : 'Keterangan tambahan (opsional)'} value={taxInfo[t.id]?.info ?? ''} onChange={(e) => setTaxInfo({ ...taxInfo, [t.id]: { ...taxInfo[t.id], info: e.target.value } })} aria-label={`Keterangan tambahan ${t.name}`} />
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-ink-soft">Default: 04 untuk PPN dengan DPP nilai lain 11/12, 08 untuk penyerahan yang dibebaskan. Konfirmasikan dengan konsultan pajak.</p>

      <label className="mt-5 flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-navy" checked={f.verified} onChange={(e) => setF({ ...f, verified: e.target.checked })} />
        <span>Template ekspor Coretax sudah diverifikasi<span className="block text-xs text-ink-soft">Asumsi saat ini: {TEMPLATE_VERSION_ASSUMED}. Centang hanya setelah file ekspor berhasil dikonversi dengan converter resmi DJP dan diimpor ke Coretax.</span></span>
      </label>
      <Button variant="primary" className="mt-4" onClick={save}>Simpan pengaturan pajak</Button>
    </Panel>
  );
}
