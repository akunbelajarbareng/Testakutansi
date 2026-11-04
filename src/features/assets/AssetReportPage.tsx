import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { assetCostTotal, fiscalComparison, postedAccumulated, registerVsLedger, FISCAL_GROUPS } from '../../domain';
import { formatAmount, formatDate, todayISO } from '../../lib/format';
import { useLedgerData } from '../../store/ledgerStore';
import { Alert, Button, Field, PageHeader, Panel, errorMessage, inputClass, td, tdNum, th, thNum } from '../../components/ui';

export function AssetReportPage() {
  const data = useLedgerData();
  const [asOf, setAsOf] = useState(todayISO());
  const [year, setYear] = useState(todayISO().slice(0, 4));
  const [error, setError] = useState<string | null>(null);
  const checks = useMemo(() => registerVsLedger(data, asOf), [data, asOf]);
  const fiscal = useMemo(() => fiscalComparison(data, year), [data, year]);
  const totalCorrection = fiscal.reduce((s, r) => s + r.correction, 0);

  const exportXlsx = async () => {
    setError(null);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet(`Penyusutan fiskal ${year}`);
      ws.addRow([`${data.company.name} — Daftar penyusutan fiskal tahun ${year}`]).font = { bold: true };
      ws.addRow(['Bahan pengisian lampiran penyusutan SPT Tahunan Badan (bukan format impor DJP).']).font = { italic: true };
      ws.addRow([]);
      ws.addRow(['Kode', 'Nama harta', 'Kelompok', 'Metode fiskal', 'Tgl perolehan', 'Harga perolehan', 'Penyusutan fiskal', 'Penyusutan komersial', 'Koreksi (komersial − fiskal)']).font = { bold: true };
      for (const r of fiscal) {
        const row = ws.addRow([r.asset.code, r.asset.name, FISCAL_GROUPS[r.asset.fiscalGroup].label, r.asset.fiscalMethod === 'SL' ? 'Garis lurus' : 'Saldo menurun', r.asset.acquisitionDate, assetCostTotal(r.asset), r.fiscal, r.commercial, r.correction]);
        [6, 7, 8, 9].forEach((c) => (row.getCell(c).numFmt = '#,##0;[Red]-#,##0'));
      }
      const t = ws.addRow(['', 'Total', '', '', '', '', fiscal.reduce((s, r) => s + r.fiscal, 0), fiscal.reduce((s, r) => s + r.commercial, 0), totalCorrection]);
      t.font = { bold: true };
      [7, 8, 9].forEach((c) => (t.getCell(c).numFmt = '#,##0;[Red]-#,##0'));
      ws.columns.forEach((c, i) => (c.width = i === 1 ? 34 : 18));
      const buf = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `Penyusutan-Fiskal-${year}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <>
      <PageHeader title="Laporan Aset" subtitle="Kecocokan register dengan buku besar, dan rekap penyusutan komersial vs fiskal." />
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Panel>
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line p-5">
            <h2 className="font-semibold text-navy">Register vs buku besar</h2>
            <div className="w-44"><Field label="Per tanggal"><input type="date" className={inputClass} value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field></div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] border-collapse">
              <thead><tr><th className={th}>Kategori</th><th className={thNum}>Perolehan (register)</th><th className={thNum}>Perolehan (buku)</th><th className={thNum}>Akumulasi (register)</th><th className={thNum}>Akumulasi (buku)</th><th className={th}>Status</th></tr></thead>
              <tbody>
                {checks.map((c) => {
                  const cat = data.assetCategories.find((x) => x.id === c.categoryId)!;
                  const ok = c.registerCost === c.glCost && c.registerAccum === c.glAccum;
                  return (
                    <tr key={c.categoryId}>
                      <td className={td}>{cat.name}</td>
                      <td className={tdNum}>{formatAmount(c.registerCost)}</td>
                      <td className={tdNum}>{formatAmount(c.glCost)}</td>
                      <td className={tdNum}>{formatAmount(c.registerAccum)}</td>
                      <td className={tdNum}>{formatAmount(c.glAccum)}</td>
                      <td className={`${td} text-sm ${ok ? 'text-ok' : 'font-medium text-bad'}`}>{ok ? 'Cocok' : 'Tidak cocok'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="px-5 py-3 text-xs text-ink-soft">Tidak cocok biasanya karena: tagihan aset belum dibuatkan kartu, saldo awal aset lama belum dijurnal, perbaikan belum didaftarkan, atau penyusutan bulan berjalan belum dibukukan.</p>
        </Panel>

        <Panel>
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line p-5">
            <h2 className="font-semibold text-navy">Penyusutan komersial vs fiskal</h2>
            <div className="flex items-end gap-3">
              <div className="w-28"><Field label="Tahun pajak"><input type="number" className={`${inputClass} num`} value={year} onChange={(e) => setYear(e.target.value)} /></Field></div>
              <Button variant="primary" onClick={exportXlsx}>Ekspor Excel</Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] border-collapse">
              <thead><tr><th className={th}>Aset</th><th className={th}>Kelompok fiskal</th><th className={thNum}>Komersial</th><th className={thNum}>Fiskal</th><th className={thNum}>Koreksi</th></tr></thead>
              <tbody>
                {fiscal.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-sm text-ink-soft">Tidak ada penyusutan di tahun {year}.</td></tr>}
                {fiscal.map((r) => (
                  <tr key={r.asset.id}>
                    <td className={td}><Link className="text-navy-600 hover:underline" to={`/aset/${r.asset.id}`}>{r.asset.code}</Link> {r.asset.name}</td>
                    <td className={`${td} text-sm`}>{FISCAL_GROUPS[r.asset.fiscalGroup].label}, {r.asset.fiscalMethod === 'SL' ? 'garis lurus' : 'saldo menurun'}</td>
                    <td className={tdNum}>{formatAmount(r.commercial)}</td>
                    <td className={tdNum}>{formatAmount(r.fiscal)}</td>
                    <td className={`${tdNum} ${r.correction ? 'font-medium text-orange-600' : 'text-ink-soft'}`}>{formatAmount(r.correction)}</td>
                  </tr>
                ))}
                {fiscal.length > 0 && (
                  <tr className="font-semibold">
                    <td className={td} colSpan={4}>Koreksi fiskal {totalCorrection > 0 ? 'positif' : totalCorrection < 0 ? 'negatif' : ''} tahun {year}</td>
                    <td className={tdNum}>{formatAmount(totalCorrection)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="px-5 py-3 text-xs text-ink-soft">Komersial dihitung dari jadwal per {formatDate(`${year}-12-31`)} (termasuk bulan yang belum dibukukan). Kelompok harta per aset mengikuti Lampiran PMK 72/2023 dan sebaiknya dikonfirmasi konsultan.</p>
        </Panel>
        <p className="text-xs text-ink-soft">Akumulasi register = saldo awal + penyusutan yang sudah dibukukan ({data.assets.filter((a) => a.status === 'running').reduce((s, a) => s + postedAccumulated(a, data), 0).toLocaleString('id-ID')} untuk aset aktif).</p>
      </div>
    </>
  );
}
