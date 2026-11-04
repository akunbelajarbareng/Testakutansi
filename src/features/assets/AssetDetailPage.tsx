import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  FISCAL_GROUPS,
  assetCostTotal,
  assetSchedule,
  commercialForYear,
  fiscalSchedule,
  hasPostedDepreciation,
  postedAccumulated,
  type Asset,
  type FiscalGroup,
} from '../../domain';
import { formatAmount, formatDate, todayISO } from '../../lib/format';
import { newId } from '../../lib/id';
import { docPath } from '../../lib/paths';
import { useLedger, useLedgerData } from '../../store/ledgerStore';
import { MoneyInput } from '../../components/MoneyInput';
import { DistributionEditor } from '../../components/DistributionEditor';
import { Alert, Button, EmptyState, Field, PageHeader, Panel, errorMessage, inputClass, td, tdNum, th, thNum } from '../../components/ui';

export function AssetDetailPage() {
  const { id } = useParams();
  const data = useLedgerData();
  const existing = id ? data.assets.find((a) => a.id === id) : undefined;
  if (id && !existing) return <EmptyState title="Aset tidak ditemukan." />;
  return <AssetEditor key={existing?.id ?? 'new'} asset={existing} />;
}

function blank(categoryId: string, group: FiscalGroup): Asset {
  const t = todayISO();
  return {
    id: newId(), code: '', name: '', categoryId, serial: '', acquisitionDate: t, inServiceDate: t, cost: 0, salvage: 0,
    usefulLifeMonths: FISCAL_GROUPS[group].years * 12, fiscalGroup: group, fiscalMethod: 'SL', status: 'draft',
    openingAccumulated: 0, improvements: [], createdAt: new Date().toISOString(),
  };
}

function AssetEditor({ asset }: { asset?: Asset }) {
  const data = useLedgerData();
  const store = useLedger();
  const navigate = useNavigate();
  const notice = (useLocation().state as { notice?: string } | null)?.notice;
  const firstCat = data.assetCategories[0];
  const [a, setA] = useState<Asset>(asset ?? blank(firstCat.id, firstCat.defaultFiscalGroup));
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(notice ? { tone: 'ok', text: notice } : null);
  const [showAll, setShowAll] = useState(false);
  const [imp, setImp] = useState({ date: todayISO(), amount: 0, extraMonths: 0, note: '' });
  const [disp, setDisp] = useState({ date: todayISO(), type: 'sale' as 'sale' | 'writeoff', proceeds: 0, journalId: data.journals.find((j) => j.type === 'bank')?.id ?? '', note: '' });
  const [isOpening, setIsOpening] = useState(!!asset?.openingDate);

  const locked = !!asset && hasPostedDepreciation(asset.id, data);
  const disposed = asset?.status === 'disposed';
  const set = <K extends keyof Asset>(k: K, v: Asset[K]) => setA((x) => ({ ...x, [k]: v }));
  const schedule = assetSchedule(a.cost > 0 && a.usefulLifeMonths > 0 ? a : { ...a, cost: 1, usefulLifeMonths: 1 });
  const fiscal = a.cost > 0 ? fiscalSchedule(a) : [];
  const g = FISCAL_GROUPS[a.fiscalGroup];
  const source = a.sourceInvoiceId ? data.invoices.find((i) => i.id === a.sourceInvoiceId) : undefined;

  const run = async (fn: () => Promise<void>, ok: string) => {
    setMessage(null);
    try {
      await fn();
      setMessage({ tone: 'ok', text: ok });
    } catch (e) {
      setMessage({ tone: 'error', text: errorMessage(e) });
    }
  };
  const save = async (status = a.status) => {
    const ok = status === 'running' && a.status === 'draft' ? 'Aset diaktifkan; penyusutan akan ikut run bulanan.' : 'Aset disimpan.';
    const next = { ...a, status, ...(isOpening ? {} : { openingAccumulated: 0, openingDate: undefined }) };
    setMessage(null);
    try {
      await store.saveAsset(next);
      if (!asset) {
        // Halaman pindah ke kartu aset; pesan dibawa lewat state agar tidak hilang.
        navigate(`/aset/${next.id}`, { replace: true, state: { notice: ok } });
        return;
      }
      setA(next);
      setMessage({ tone: 'ok', text: ok });
    } catch (e) {
      setMessage({ tone: 'error', text: errorMessage(e) });
    }
  };

  const live = asset && asset.status === 'running';
  return (
    <>
      <PageHeader
        back={{ to: '/aset', label: 'Register Aset' }}
        title={asset ? `${asset.code} ${asset.name}` : 'Aset baru'}
        subtitle={asset ? `${asset.status === 'draft' ? 'Draft' : asset.status === 'running' ? 'Sedang disusutkan' : 'Sudah dilepas'}` : 'Isi data aset; aktifkan agar mulai disusutkan.'}
        actions={
          !disposed && (
            <>
              {asset?.status === 'draft' && <Button variant="ghost" onClick={() => run(async () => { await store.deleteAsset(asset.id); navigate('/aset'); }, 'Draft dihapus.')}>Hapus draft</Button>}
              <Button onClick={() => save()}>Simpan</Button>
              {a.status === 'draft' && <Button variant="primary" onClick={() => save('running')}>Simpan & aktifkan</Button>}
            </>
          )
        }
      />
      <div className="space-y-4">
        {message && <Alert tone={message.tone}>{message.text}</Alert>}
        {locked && !disposed && <Alert tone="info">Penyusutan aset ini sudah dibukukan; nilai, tanggal, dan masa manfaat terkunci. Gunakan perbaikan dikapitalisasi atau pelepasan.</Alert>}
        {source && <p className="text-sm">Dari tagihan <Link className="text-navy-600 underline" to={docPath(source)}>{source.number}</Link>.</p>}

        <Panel className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Kode"><input className={`${inputClass} uppercase`} value={a.code} disabled={disposed} onChange={(e) => set('code', e.target.value)} /></Field>
          <div className="lg:col-span-2"><Field label="Nama aset"><input className={inputClass} value={a.name} disabled={disposed} onChange={(e) => set('name', e.target.value)} /></Field></div>
          <Field label="No. polisi / seri"><input className={inputClass} value={a.serial} disabled={disposed} onChange={(e) => set('serial', e.target.value)} /></Field>
          <Field label="Kategori">
            <select className={inputClass} value={a.categoryId} disabled={locked || disposed} onChange={(e) => { const c = data.assetCategories.find((x) => x.id === e.target.value)!; setA({ ...a, categoryId: c.id, fiscalGroup: c.defaultFiscalGroup }); }}>
              {data.assetCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Tanggal perolehan"><input type="date" className={inputClass} value={a.acquisitionDate} disabled={locked || disposed} onChange={(e) => set('acquisitionDate', e.target.value)} /></Field>
          <Field label="Mulai dipakai" hint="Penyusutan komersial mulai bulan ini"><input type="date" className={inputClass} value={a.inServiceDate} disabled={locked || disposed} onChange={(e) => set('inServiceDate', e.target.value)} /></Field>
          <Field label="Nilai perolehan (tanpa PPN)"><MoneyInput value={a.cost} disabled={locked || disposed} onChange={(v) => set('cost', v)} aria-label="Nilai perolehan" /></Field>
          <Field label="Nilai sisa"><MoneyInput value={a.salvage} disabled={locked || disposed} onChange={(v) => set('salvage', v)} aria-label="Nilai sisa" /></Field>
          <Field label="Masa manfaat komersial (bulan)" hint={`Default kelompok fiskal: ${g.years * 12} bulan`}>
            <input type="number" min={1} className={`${inputClass} num`} value={a.usefulLifeMonths} disabled={locked || disposed} onChange={(e) => set('usefulLifeMonths', Number.parseInt(e.target.value || '0', 10))} />
          </Field>
          <Field label="Kelompok fiskal" hint="Cek Lampiran PMK 72/2023">
            <select className={inputClass} value={a.fiscalGroup} disabled={disposed} onChange={(e) => { const fg = e.target.value as FiscalGroup; setA({ ...a, fiscalGroup: fg, fiscalMethod: FISCAL_GROUPS[fg].db === null ? 'SL' : a.fiscalMethod, ...(locked ? {} : { usefulLifeMonths: FISCAL_GROUPS[fg].years * 12 }) }); }}>
              {Object.entries(FISCAL_GROUPS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </Field>
          <Field label="Metode fiskal">
            <select className={inputClass} value={a.fiscalMethod} disabled={disposed} onChange={(e) => set('fiscalMethod', e.target.value as Asset['fiscalMethod'])}>
              <option value="SL">Garis lurus ({g.sl}%)</option>
              {g.db !== null && <option value="DB">Saldo menurun ({g.db}%)</option>}
            </select>
          </Field>
          <div className="sm:col-span-2 lg:col-span-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-navy" checked={isOpening} disabled={locked || disposed} onChange={(e) => setIsOpening(e.target.checked)} />
              Aset lama (sudah disusutkan sebelum aplikasi dipakai)
            </label>
            {isOpening && (
              <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Akumulasi penyusutan awal"><MoneyInput value={a.openingAccumulated} disabled={locked || disposed} onChange={(v) => set('openingAccumulated', v)} aria-label="Akumulasi awal" /></Field>
                <Field label="Per tanggal" hint="Akhir bulan terakhir yang sudah disusutkan"><input type="date" className={inputClass} value={a.openingDate ?? ''} disabled={locked || disposed} onChange={(e) => set('openingDate', e.target.value)} /></Field>
                <p className="text-xs text-ink-soft sm:col-span-2">Saldo awal di buku besar (Debit aset, Kredit akumulasi) dicatat terpisah lewat Entri Jurnal. Laporan Aset menunjukkan bila register dan buku besar belum cocok.</p>
              </div>
            )}
          </div>
          <div className="sm:col-span-2">
            <div className="mb-1 text-sm font-medium">Pemakai (pilar/outlet) — untuk beban penyusutan</div>
            <DistributionEditor value={a.analytic ?? {}} onChange={(v) => set('analytic', Object.keys(v).length ? v : undefined)} account={{ type: 'expense', group: 'Beban Operasional' }} />
          </div>
        </Panel>

        {asset && asset.status !== 'draft' && (
          <Panel className="grid gap-4 p-5 sm:grid-cols-4">
            <Stat label="Nilai perolehan + perbaikan" v={assetCostTotal(asset)} />
            <Stat label="Akumulasi dibukukan" v={postedAccumulated(asset, data)} />
            <Stat label="Nilai buku" v={disposed ? 0 : assetCostTotal(asset) - postedAccumulated(asset, data)} strong />
            <Stat label="Beban per bulan saat ini" v={schedule.find((r) => r.period >= todayISO().slice(0, 7))?.depreciation ?? 0} />
          </Panel>
        )}

        <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
          <Panel>
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 className="font-semibold text-navy">Jadwal penyusutan komersial</h2>
              {schedule.length > 12 && <Button variant="ghost" onClick={() => setShowAll((s) => !s)}>{showAll ? 'Ringkas' : `Semua ${schedule.length} bulan`}</Button>}
            </div>
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full border-collapse">
                <thead><tr><th className={th}>Bulan</th><th className={thNum}>Penyusutan</th><th className={thNum}>Akumulasi</th><th className={thNum}>Nilai buku</th><th className={th} /></tr></thead>
                <tbody>
                  {(showAll ? schedule : schedule.slice(0, 12)).map((r) => {
                    const posted = data.depreciationRuns.some((x) => x.status === 'posted' && x.period === r.period && x.items.some((i) => i.id === a.id));
                    return (
                      <tr key={r.period}>
                        <td className={td}>{r.period}</td>
                        <td className={tdNum}>{formatAmount(r.depreciation)}</td>
                        <td className={tdNum}>{formatAmount(r.accumulated)}</td>
                        <td className={tdNum}>{formatAmount(r.bookValue)}</td>
                        <td className={`${td} text-xs`}>{posted && <span className="text-ok">dibukukan</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
          <Panel>
            <h2 className="border-b border-line px-5 py-3 font-semibold text-navy">Penyusutan fiskal per tahun</h2>
            <table className="w-full border-collapse">
              <thead><tr><th className={th}>Tahun</th><th className={thNum}>Fiskal</th><th className={thNum}>Komersial</th><th className={thNum}>Koreksi</th></tr></thead>
              <tbody>
                {fiscal.map((f) => {
                  const com = a.cost > 0 && a.usefulLifeMonths > 0 ? commercialForYear(a, f.year) : 0;
                  return (
                    <tr key={f.year}>
                      <td className={td}>{f.year}</td>
                      <td className={tdNum}>{formatAmount(f.depreciation)}</td>
                      <td className={tdNum}>{formatAmount(com)}</td>
                      <td className={`${tdNum} ${com - f.depreciation ? 'font-medium text-orange-600' : 'text-ink-soft'}`}>{formatAmount(com - f.depreciation)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="px-5 py-3 text-xs text-ink-soft">Koreksi = komersial − fiskal. Positif menambah penghasilan kena pajak di SPT Tahunan. Untuk aset lama, tahun sebelum aplikasi dipakai ikut ditampilkan sebagai acuan.</p>
          </Panel>
        </div>

        {live && (
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel className="p-5">
              <h2 className="text-base font-semibold text-navy">Perbaikan dikapitalisasi</h2>
              <p className="mt-1 text-sm text-ink-soft">Biaya perbaikan yang menambah manfaat lebih dari setahun. Catat biayanya ke akun aset lewat tagihan/entri, lalu daftarkan di sini.</p>
              {asset.improvements.length > 0 && (
                <ul className="mt-2 text-sm">
                  {asset.improvements.map((i) => <li key={i.id}>{formatDate(i.date)}: {formatAmount(i.amount)}{i.extraMonths ? `, +${i.extraMonths} bulan` : ''} — {i.note}</li>)}
                </ul>
              )}
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Tanggal"><input type="date" className={inputClass} value={imp.date} onChange={(e) => setImp({ ...imp, date: e.target.value })} /></Field>
                <Field label="Nilai"><MoneyInput value={imp.amount} onChange={(v) => setImp({ ...imp, amount: v })} aria-label="Nilai perbaikan" /></Field>
                <Field label="Tambahan masa manfaat (bulan)"><input type="number" min={0} className={`${inputClass} num`} value={imp.extraMonths} onChange={(e) => setImp({ ...imp, extraMonths: Number.parseInt(e.target.value || '0', 10) })} /></Field>
                <Field label="Keterangan"><input className={inputClass} value={imp.note} onChange={(e) => setImp({ ...imp, note: e.target.value })} /></Field>
              </div>
              <Button className="mt-3" onClick={() => run(async () => { await store.addImprovement(asset.id, imp); const fresh = useLedger.getState().data!.assets.find((x) => x.id === asset.id)!; setA(fresh); }, 'Perbaikan dicatat; jadwal sisa dihitung ulang.')}>Tambah perbaikan</Button>
            </Panel>
            <Panel className="p-5">
              <h2 className="text-base font-semibold text-navy">Pelepasan</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Jenis">
                  <select className={inputClass} value={disp.type} onChange={(e) => setDisp({ ...disp, type: e.target.value as 'sale' | 'writeoff' })}>
                    <option value="sale">Dijual</option>
                    <option value="writeoff">Dihapus (rusak/hilang)</option>
                  </select>
                </Field>
                <Field label="Tanggal"><input type="date" className={inputClass} value={disp.date} onChange={(e) => setDisp({ ...disp, date: e.target.value })} /></Field>
                {disp.type === 'sale' && (
                  <>
                    <Field label="Harga jual (tanpa PPN)"><MoneyInput value={disp.proceeds} onChange={(v) => setDisp({ ...disp, proceeds: v })} aria-label="Harga jual" /></Field>
                    <Field label="Diterima di">
                      <select className={inputClass} value={disp.journalId} onChange={(e) => setDisp({ ...disp, journalId: e.target.value })}>
                        {data.journals.filter((j) => (j.type === 'bank' || j.type === 'cash') && j.defaultAccountId).map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
                      </select>
                    </Field>
                  </>
                )}
                <div className="sm:col-span-2"><Field label="Keterangan"><input className={inputClass} value={disp.note} onChange={(e) => setDisp({ ...disp, note: e.target.value })} /></Field></div>
              </div>
              {disp.type === 'sale' && <p className="mt-2 text-xs text-orange-600">Penjualan aset oleh PKP dapat terutang PPN. Terbitkan Faktur Pajaknya sesuai arahan konsultan; nilai di sini adalah harga jual tanpa PPN.</p>}
              <Button variant="danger" className="mt-3" onClick={() => run(async () => { await store.disposeAsset(asset.id, disp); setA(useLedger.getState().data!.assets.find((x) => x.id === asset.id)!); }, 'Aset dilepas dan dijurnal.')}>
                Lepas aset
              </Button>
            </Panel>
          </div>
        )}
        {disposed && asset.disposal && (
          <Alert tone="info">
            {asset.disposal.type === 'sale' ? `Dijual ${formatDate(asset.disposal.date)} seharga ${formatAmount(asset.disposal.proceeds)}.` : `Dihapus ${formatDate(asset.disposal.date)}.`}{' '}
            <Link className="underline" to={`/entri/${asset.disposal.entryId}`}>Lihat jurnal pelepasan</Link>
          </Alert>
        )}
      </div>
    </>
  );
}

function Stat({ label, v, strong }: { label: string; v: number; strong?: boolean }) {
  return (
    <div>
      <div className="text-xs text-ink-soft">{label}</div>
      <div className={`num mt-1 ${strong ? 'text-xl font-semibold text-navy' : 'text-lg'}`}>{formatAmount(v)}</div>
    </div>
  );
}
