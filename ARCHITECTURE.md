# Arsitektur — panduan untuk tim pengembang / vendor

## Prinsip

**Aturan akuntansi terpisah total dari tampilan.** Semua aturan ada di `src/domain/` sebagai fungsi murni
(tanpa React, tanpa penyimpanan). Layar hanya memanggil aksi di store; store memanggil domain lalu repository.

```
Layar (features/*)  →  Store (store/ledgerStore.ts)  →  Domain (domain/rules.ts)   ← sumber kebenaran
                                                   →  Repository (data/*)         ← bisa diganti backend
```

## Struktur folder

```
src/
├── domain/
│   ├── types.ts          Model data (Account, Journal, JournalEntry, JournalLine, Company)
│   ├── accounting.ts     Saldo normal, akun kontra
│   ├── rules.ts          validateEntry, postEntry, reverseEntry, nextEntryNumber, validateAccount
│   ├── reports.ts        generalLedger, trialBalance, accountNetBalances, journalSummaries
│   ├── invoicing.ts      invoiceTotals (PPN), postInvoice, createRefundDraft, invoiceResidual, creditCheck, agingReport
│   ├── payments.ts       validatePayment, autoAllocate, postPayment, cancelPayment
│   ├── statementImport.ts  parseBcaCsv, parseGenericCsv, planImport (duplikat & cek saldo)
│   ├── banking.ts        suggestMatches, reconcileWith*, unreconcile, reconciliationReport, transferFunds, closeCashDay
│   ├── financials.ts     profitAndLoss, pillarMargins, balanceSheet, comparePeriod
│   ├── assets.ts         assetSchedule, fiscalSchedule, fiscalComparison, deferralSchedule, postDepreciationRun, disposeAsset, sourceCandidates, registerVsLedger
│   ├── analytics.ts      withAnalyticDefaults, validateDistribution, allocate, setDistribution, dimensionalPnl, budgetVsActual, budgetFromActual
│   ├── tax.ts            outputTaxGroups, exportIssues, recordTaxNumber, postRetailRecap, inputTaxRows, matchCoretaxInput, ppnSummary, settlePpnPeriod, payPpn
│   ├── closing.ts        hppWorksheet, proportionalAllocation, postHppAdjustment, closingChecklist, closePeriod, reopenPeriod, buildClosingEntry
│   ├── schemas.ts        Skema Zod untuk form (validasi struktur input)
│   └── errors.ts         LedgerError dengan kode stabil
├── data/
│   ├── repository.ts     Kontrak akses data (interface) + ChangeSet atomik
│   ├── localStorageRepository.ts   Implementasi prototipe
│   └── seed/             COA, jurnal, pajak, kontak, data contoh
├── store/ledgerStore.ts  Aksi aplikasi (Zustand)
├── features/             Satu folder per layar
├── components/           Komponen UI bersama, MoneyInput, Layout
└── lib/                  Format Rupiah/tanggal, ID
tests/ledger.test.ts      Skenario uji aturan bisnis
```

## Pemetaan ke skema database (mengikuti pola Odoo)

| Tipe TS | Tabel usulan | Padanan Odoo |
|---|---|---|
| `Company` | `companies` | `res.company` |
| `Account` | `accounts` (unique: company_id + code) | `account.account` |
| `Journal` | `journals` (unique: company_id + code) | `account.journal` |
| `JournalEntry` | `journal_entries` (unique: number) | `account.move` |
| `JournalLine` | `journal_lines` (FK entry_id, account_id) | `account.move.line` |
| `JournalEntry.source` | `journal_entries.source_type`, `source_id` | `account.move` (dokumen & entri satu rekaman di Odoo) |
| `Partner` | `partners` | `res.partner` |
| `Tax` | `taxes` | `account.tax` |
| `Invoice` | `invoices` (FK partner_id, entry_id, refund_of_id) | `account.move` (move_type) |
| `InvoiceLine` | `invoice_lines` | `account.move.line` (baris produk) |
| `Payment` | `payments` (FK entry_id, cancel_entry_id) | `account.payment` |
| `PaymentAllocation` | `payment_allocations` (payment_id, invoice_id, amount) | `account.partial.reconcile` |
| `StatementLine` | `bank_statement_lines` (journal_id, import_id, status) | `account.bank.statement.line` |
| `Reconciliation` | `bank_reconciliations` + `bank_reconciliation_lines` (statement_line_id, entry_line_id, role: bank/cleared) | `account.partial.reconcile` |
| `StatementImport` | `bank_statement_imports` | `account.bank.statement` |
| `ReconcileRule` | `reconcile_rules` | `account.reconcile.model` |
| `CashSession` | `cash_sessions` (unique: journal_id + date) | `pos.session` (kontrol kas) |
| `HppAdjustment` | `hpp_adjustments` (unique aktif: period_end) + `hpp_adjustment_lines` | — (Odoo memakai valuasi stok) |
| `PeriodClose` | `period_closes` (snapshot JSON, alasan buka kembali) | `account.lock_date` + log |
| `TaxInvoice` | `tax_invoices` (unique aktif: invoice_id + transaction_code; unique: tax_number) | `l10n_id_efaktur` |
| `RetailRecap` | `retail_recaps` (unique aktif: cash_journal_id + date) | `pos.session` (rekap) |
| `PpnPeriod` | `ppn_periods` (unique aktif: period) | `account.return` |
| `AnalyticPlan` / `AnalyticAccount` | `analytic_plans`, `analytic_accounts` (parent_id) | `account.analytic.plan`, `account.analytic.account` |
| `JournalLine.analytic` | `journal_lines.analytic_distribution` (JSONB) atau tabel `analytic_lines` | `analytic_distribution` (JSON) |
| `DistributionModel` | `distribution_models` | `account.analytic.distribution.model` |
| `AssetCategory` / `Asset` | `asset_categories`, `assets` (+ `asset_improvements`) | `account.asset` (model kategori) |
| `Deferral` | `deferrals` | `account.asset` (deferred revenue/expense) |
| `DepreciationRun` | `depreciation_runs` + `depreciation_run_items` (unique aktif: period) | `account.move` per aset |
| `Budget` / `BudgetLine` | `budgets`, `budget_lines` (12 kolom bulan atau baris per bulan) | `budget.analytic` |

Catatan desain: berbeda dari Odoo, dokumen (Invoice) dan entri jurnal dipisah tetapi saling tertaut.
Dokumen menyimpan data bisnis (kontak, termin, barang); entri menyimpan efek akuntansinya.
Sisa tagihan **tidak disimpan**, selalu dihitung dari total − alokasi pembayaran − nota kredit,
sehingga tidak pernah tidak sinkron. Di backend boleh ditambah kolom cache, asalkan diperbarui dalam transaksi yang sama.

Kolom nominal: `BIGINT` (Rupiah bulat) atau `NUMERIC(18,2)` bila nanti multi-currency. Jangan `FLOAT`.

## Menyambungkan ke backend

1. Buat `ApiRepository implements LedgerRepository` (lihat `src/data/repository.ts`). Satu `commit(changeset)` = satu transaksi database.
2. Ganti satu baris di `src/store/ledgerStore.ts`: `const repo = new ApiRepository(...)`.
3. **Wajib di server**: jalankan ulang `postDepreciationRun`, `disposeAsset`, `postRetailRecap`, `settlePpnPeriod`, `payPpn`, `recordTaxNumber`, `postHppAdjustment`, `closePeriod`, `reopenPeriod`, `buildClosingEntry`, `postEntry`, `reverseEntry`, `postInvoice`, `postPayment`, `cancelPayment`, `reconcileWith*`, `unreconcile`, `transferFunds`, `closeCashDay` dari `domain/` sebelum menyimpan.
   Satu baris entri hanya boleh dipasangkan ke satu mutasi: beri unique constraint pada `bank_reconciliation_lines.entry_line_id`.
7. **Sinkronisasi bank otomatis** (fase berikutnya): buat sumber mutasi baru yang menghasilkan `ParsedStatement` (lihat `statementImport.ts`), lalu pakai `planImport` yang sama. Layar rekonsiliasi tidak berubah.
   Validasi di browser hanya untuk kenyamanan pengguna — tidak boleh dipercaya.
4. `saveEntries` harus satu transaksi database (pembalikan menyimpan 2 entri sekaligus).
5. Penomoran harus dikunci di database (row lock atau sequence per jurnal/bulan) agar tidak dobel saat multi-user.
6. Tambahkan `created_by`, `posted_by`, dan audit log saat modul user/hak akses dibuat.

## Analitik

Pengisian distribusi otomatis dilakukan di **satu titik**: `commit()` di `store/ledgerStore.ts` memanggil `withAnalyticDefaults` untuk setiap entri yang baru diposting, lalu `mandatoryIssues`. Di backend, lakukan hal yang sama di layanan posting (satu fungsi untuk semua jenis dokumen). Untuk laporan cepat dengan data besar, pertimbangkan tabel `analytic_lines` (satu baris per akun analitik dengan nominal teralokasi) yang ditulis bersamaan dengan entri.

## Ekspor Coretax

Semua asumsi format template DJP dikumpulkan di `src/lib/coretaxTemplate.ts` (kolom, kode satuan, format tanggal, jenis ID pembeli). Logika pajak (`domain/tax.ts`) tidak bergantung pada format file. Saat DJP memperbarui template, cukup file itu yang diubah. Pengiriman langsung ke API Coretax (via PJAP) bisa ditambahkan sebagai jalur ekspor lain dengan data `TaxInvoiceGroup` yang sama.

## Ekspor Excel

`src/lib/excelExport.ts` memakai exceljs 4.4.0 yang dimuat secara lazy (chunk terpisah, ±270 kB gzip) hanya saat tombol Ekspor ditekan. Di backend, ekspor bisa dipindah ke server memakai fungsi laporan yang sama dari `domain/financials.ts`.

## Konvensi

- Bahasa UI: Indonesia. Nama kode (variabel, fungsi): Inggris.
- Setiap aturan baru di `domain/` wajib punya tes di `tests/`.
- Warna brand di `tailwind.config.js` (navy & oranye) — ubah di satu tempat.

## Roadmap mini app berikutnya

1. ~~Faktur penjualan & tagihan vendor (AR/AP), nota kredit, pembayaran~~ (selesai, Mini App 2)
2. ~~Bank & kas, rekonsiliasi (termasuk settlement QRIS/EDC ke akun 1112)~~ (selesai, Mini App 3)
3. ~~Laporan Laba Rugi & Neraca, penutupan periode~~ (selesai, Mini App 4)
4. ~~Pajak: PPN, e-Faktur~~ (selesai, Mini App 5; PPh 21/23/4(2) menyusul)
5. ~~Analitik & anggaran~~ (selesai, Mini App 6) per pilar/outlet
6. ~~Aset & penyusutan~~ (selesai, Mini App 7, termasuk biaya/pendapatan ditangguhkan)
7. Multi-company & konsolidasi
