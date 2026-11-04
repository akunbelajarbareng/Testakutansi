/**
 * Ekspor laporan ke Excel (.xlsx). exceljs dimuat hanya saat tombol ekspor ditekan
 * agar tidak menambah ukuran halaman awal.
 */
import { balanceSheet, pillarMargins, profitAndLoss, trialBalance, type DateRange, type LedgerData } from '../domain';
import { formatDate } from './format';

const MONEY = '#,##0;[Red]-#,##0';

export async function exportFinancialsXlsx(data: LedgerData, range: DateRange, asOf: string) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = `${data.company.name} — Oriental Accounting`;
  wb.created = new Date();
  const periodText = `${formatDate(range.from)} sampai ${formatDate(range.to)}`;

  const heading = (ws: import('exceljs').Worksheet, title: string, sub: string) => {
    ws.addRow([data.company.name]).font = { bold: true, size: 14 };
    ws.addRow([title]).font = { bold: true, size: 12 };
    ws.addRow([sub]).font = { italic: true, color: { argb: 'FF5B6677' } };
    ws.addRow([]);
  };
  const money = (row: import('exceljs').Row, cols: number[]) => cols.forEach((c) => (row.getCell(c).numFmt = MONEY));
  const bold = (row: import('exceljs').Row) => (row.font = { bold: true });

  // Laba Rugi
  const pnl = profitAndLoss(data, range);
  const ws1 = wb.addWorksheet('Laba Rugi');
  ws1.columns = [{ width: 10 }, { width: 44 }, { width: 20 }];
  heading(ws1, 'Laporan Laba Rugi', periodText);
  const subtotal = (label: string, v: number) => {
    const r = ws1.addRow(['', label, v]);
    bold(r);
    money(r, [3]);
    r.getCell(3).border = { top: { style: 'thin' } };
  };
  for (const s of pnl.sections) {
    bold(ws1.addRow([s.title]));
    for (const l of s.lines) money(ws1.addRow([l.account.code, l.account.name, l.amount]), [3]);
    const t = ws1.addRow(['', `Total ${s.title}`, s.total]);
    money(t, [3]);
    t.font = { italic: true };
    if (s.key === 'cogs') subtotal('Laba Kotor', pnl.grossProfit);
    if (s.key === 'opex') subtotal('Laba Usaha', pnl.operatingProfit);
    if (s.key === 'other') subtotal('Laba Sebelum Pajak', pnl.profitBeforeTax);
    ws1.addRow([]);
  }
  subtotal('LABA BERSIH', pnl.netProfit);

  const pm = pillarMargins(data, range);
  ws1.addRow([]);
  bold(ws1.addRow(['Laba kotor per pilar' + (pm.estimated ? ' (HPP estimasi proporsional)' : '')]));
  bold(ws1.addRow(['', 'Pilar', 'Pendapatan', 'HPP', 'Laba kotor', 'Margin']));
  ws1.getColumn(4).width = 18;
  ws1.getColumn(5).width = 18;
  for (const r of pm.rows) {
    const row = ws1.addRow(['', r.name, r.revenue, r.cogs, r.grossProfit, r.margin === null ? '' : r.margin / 100]);
    money(row, [3, 4, 5]);
    row.getCell(6).numFmt = '0.0%';
  }

  // Neraca
  const bs = balanceSheet(data, asOf);
  const ws2 = wb.addWorksheet('Neraca');
  ws2.columns = [{ width: 10 }, { width: 44 }, { width: 20 }];
  heading(ws2, 'Neraca', `Per ${formatDate(asOf)}`);
  const block = (title: string, groups: typeof bs.assets, total: number) => {
    bold(ws2.addRow([title.toUpperCase()]));
    for (const g of groups) {
      bold(ws2.addRow([g.title]));
      for (const l of g.lines) money(ws2.addRow([l.account?.code ?? '', l.label, l.amount]), [3]);
      const t = ws2.addRow(['', `Total ${g.title}`, g.total]);
      money(t, [3]);
      t.font = { italic: true };
    }
    if (groups.length > 1) {
      const r = ws2.addRow(['', `TOTAL ${title.toUpperCase()}`, total]);
      bold(r);
      money(r, [3]);
    }
    ws2.addRow([]);
  };
  block('Aset', bs.assets, bs.totalAssets);
  block('Kewajiban', bs.liabilities, bs.totalLiabilities);
  block('Ekuitas', bs.equity, bs.totalEquity);
  const tle = ws2.addRow(['', 'TOTAL KEWAJIBAN + EKUITAS', bs.totalLiabilities + bs.totalEquity]);
  bold(tle);
  money(tle, [3]);

  // Neraca Saldo
  const tb = trialBalance(data, range);
  const ws3 = wb.addWorksheet('Neraca Saldo');
  ws3.columns = [{ width: 10 }, { width: 40 }, ...Array(6).fill({ width: 16 })];
  heading(ws3, 'Neraca Saldo', periodText);
  bold(ws3.addRow(['Kode', 'Akun', 'Saldo awal D', 'Saldo awal K', 'Mutasi D', 'Mutasi K', 'Saldo akhir D', 'Saldo akhir K']));
  for (const r of tb.rows) {
    money(ws3.addRow([r.account.code, r.account.name, r.opening.debit, r.opening.credit, r.movement.debit, r.movement.credit, r.closing.debit, r.closing.credit]), [3, 4, 5, 6, 7, 8]);
  }
  const tr = ws3.addRow(['', 'Total', tb.totals.opening.debit, tb.totals.opening.credit, tb.totals.movement.debit, tb.totals.movement.credit, tb.totals.closing.debit, tb.totals.closing.credit]);
  bold(tr);
  money(tr, [3, 4, 5, 6, 7, 8]);

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Laporan-Keuangan-${data.company.name}-${range.from}_${range.to}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Ekspor Laba Rugi per dimensi & anggaran vs realisasi. */
export async function exportDimensionalXlsx(
  data: LedgerData,
  title: string,
  periodText: string,
  columns: { id: string; name: string }[],
  sections: { title: string; lines: { account: { code: string; name: string }; values: Record<string, number>; total: number }[]; totals: Record<string, number> }[],
  subtotals: { label: string; values: Record<string, number> }[],
) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Per dimensi');
  ws.addRow([data.company.name]).font = { bold: true, size: 14 };
  ws.addRow([title]).font = { bold: true };
  ws.addRow([periodText]).font = { italic: true };
  ws.addRow([]);
  const head = ws.addRow(['Kode', 'Akun', ...columns.map((c) => c.name), 'Total']);
  head.font = { bold: true };
  const fmt = (r: import('exceljs').Row) => {
    for (let i = 3; i <= columns.length + 3; i++) r.getCell(i).numFmt = '#,##0;[Red]-#,##0';
  };
  for (const s of sections) {
    ws.addRow([s.title]).font = { bold: true };
    for (const l of s.lines) fmt(ws.addRow([l.account.code, l.account.name, ...columns.map((c) => l.values[c.id] ?? 0), l.total]));
    const t = ws.addRow(['', `Total ${s.title}`, ...columns.map((c) => s.totals[c.id] ?? 0), Object.values(s.totals).reduce((a, b) => a + b, 0)]);
    t.font = { italic: true };
    fmt(t);
  }
  ws.addRow([]);
  for (const st of subtotals) {
    const r = ws.addRow(['', st.label, ...columns.map((c) => st.values[c.id] ?? 0), Object.values(st.values).reduce((a, b) => a + b, 0)]);
    r.font = { bold: true };
    fmt(r);
  }
  ws.columns.forEach((c, i) => (c.width = i === 1 ? 36 : i === 0 ? 8 : 18));
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title.replace(/\s+/g, '-')}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
