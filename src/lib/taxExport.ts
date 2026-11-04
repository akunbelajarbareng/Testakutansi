/** Ekspor Faktur Pajak Keluaran & rekap digunggung ke Excel (exceljs dimuat lazy). */
import { invoiceTotals, lineSubtotal, retailSummary, type LedgerData, type TaxInvoiceGroup } from '../domain';
import { DEFAULTS, DETAIL_COLUMNS, FAKTUR_COLUMNS, buyerIdType, buyerNitku, digitsOnly, sellerNitku } from './coretaxTemplate';

async function download(wb: import('exceljs').Workbook, name: string) {
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Baris detail per Faktur Pajak. DPP nilai lain & PPN dihitung per baris lalu baris terakhir
 * disesuaikan agar totalnya sama persis dengan faktur di aplikasi (selisih pembulatan ≤ Rp1).
 */
export function detailRows(group: TaxInvoiceGroup, data: LedgerData) {
  const taxIds = new Set(group.taxes.map((t) => t.id));
  const lines = group.invoice.lines.filter((l) => taxIds.has(l.taxId));
  let dppOtherSum = 0;
  let ppnSum = 0;
  return lines.map((l, i) => {
    const tax = data.taxes.find((t) => t.id === l.taxId)!;
    const dpp = lineSubtotal(l);
    let dppOther = Math.round((dpp * tax.dppNumerator) / tax.dppDenominator);
    let ppn = Math.round((dppOther * tax.rate) / 100);
    if (i === lines.length - 1) {
      dppOther = group.dppOther - dppOtherSum;
      ppn = group.ppn - ppnSum;
    }
    dppOtherSum += dppOther;
    ppnSum += ppn;
    return { line: l, dpp, dppOther, ppn, rate: tax.rate };
  });
}

export async function exportCoretaxFaktur(groups: TaxInvoiceGroup[], data: LedgerData, period: string) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const c = data.company;

  const f = wb.addWorksheet('Faktur');
  f.addRow(['NPWP Penjual', digitsOnly(c.npwp)]);
  f.addRow([]);
  f.addRow([...FAKTUR_COLUMNS]).font = { bold: true };
  const d = wb.addWorksheet('DetailFaktur');
  d.addRow([...DETAIL_COLUMNS]).font = { bold: true };

  groups.forEach((g, idx) => {
    const n = idx + 1;
    const p = g.partner!;
    const tax = g.taxes[0];
    const additional = g.code === '07' || g.code === '08' ? (tax.coretaxAdditionalInfo ?? '') : '';
    f.addRow([
      n,
      DEFAULTS.dateFormat(g.invoice.date),
      DEFAULTS.jenisFaktur,
      g.code,
      additional,
      '',
      g.invoice.number ?? '',
      '', // Cap Fasilitas — PERLU DIKONFIRMASI dengan template resmi (kosong sampai diverifikasi)
      sellerNitku(c),
      digitsOnly(p.npwp),
      buyerIdType(p),
      DEFAULTS.negara,
      (p.taxIdType ?? 'TIN') === 'TIN' ? '-' : (p.npwp ?? ''),
      p.name,
      p.address ?? '',
      p.email ?? '',
      buyerNitku(p),
    ]);
    for (const r of detailRows(g, data)) {
      d.addRow([n, DEFAULTS.barangJasa, DEFAULTS.kodeBarangJasa, r.line.description, DEFAULTS.satuanUkur, r.line.unitPrice, r.line.quantity, 0, r.dpp, r.dppOther, r.rate, r.ppn, 0, 0]);
    }
  });
  f.addRow(['END']);
  d.addRow(['END']);
  [f, d].forEach((ws) => ws.columns.forEach((col) => (col.width = 18)));
  void invoiceTotals;
  await download(wb, `Coretax-FakturKeluaran-${period}.xlsx`);
}

/** Rekap penjualan eceran digunggung per masa (bahan pengisian template "Retail (Digunggung)" DJP). */
export async function exportRetailRecap(data: LedgerData, period: string) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const s = retailSummary(data, period);
  const ws = wb.addWorksheet('Rekap Digunggung');
  ws.addRow([`${data.company.name} — Rekap penjualan eceran digunggung masa ${period}`]).font = { bold: true };
  ws.addRow(['Belum dalam format template resmi DJP; salin angkanya ke template "Retail (Digunggung)" dari pajak.go.id.']).font = { italic: true };
  ws.addRow([]);
  ws.addRow(['Tanggal', 'Penjualan tunai', 'Penjualan QRIS/EDC', 'Bebas PPN', 'DPP (kena PPN)', 'PPN']).font = { bold: true };
  for (const r of s.rows.sort((a, b) => a.date.localeCompare(b.date))) ws.addRow([r.date, r.cash, r.nonCash, r.exemptGross, r.dpp, r.ppn]);
  const t = ws.addRow(['Total', s.rows.reduce((a, r) => a + r.cash, 0), s.rows.reduce((a, r) => a + r.nonCash, 0), s.exempt, s.dpp, s.ppn]);
  t.font = { bold: true };
  ws.columns.forEach((col, i) => {
    col.width = i === 0 ? 14 : 20;
    if (i > 0) col.numFmt = '#,##0';
  });
  await download(wb, `Rekap-Digunggung-${period}.xlsx`);
}
