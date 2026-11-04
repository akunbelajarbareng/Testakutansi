import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { DataGate } from './components/DataGate';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { EntriesListPage } from './features/entries/EntriesListPage';
import { EntryPage } from './features/entries/EntryPage';
import { AccountsPage } from './features/accounts/AccountsPage';
import { JournalsPage } from './features/journals/JournalsPage';
import { GeneralLedgerPage } from './features/ledger/GeneralLedgerPage';
import { TrialBalancePage } from './features/trial-balance/TrialBalancePage';
import { SettingsPage } from './features/settings/SettingsPage';
import { InvoicesListPage } from './features/invoices/InvoicesListPage';
import { InvoicePage } from './features/invoices/InvoicePage';
import { InvoicePrint } from './features/invoices/InvoicePrint';
import { PaymentsPage } from './features/payments/PaymentsPage';
import { AgingPage } from './features/aging/AgingPage';
import { PartnersPage } from './features/partners/PartnersPage';
import { BankAccountsPage } from './features/banking/BankAccountsPage';
import { StatementPage } from './features/banking/StatementPage';
import { ReconcilePage } from './features/banking/ReconcilePage';
import { ReconcileReportPage } from './features/banking/ReconcileReportPage';
import { CashSessionPage } from './features/banking/CashSessionPage';
import { ProfitLossPage } from './features/reports/ProfitLossPage';
import { BalanceSheetPage } from './features/reports/BalanceSheetPage';
import { ClosingPage } from './features/closing/ClosingPage';
import { HppAdjustmentPage } from './features/closing/HppAdjustmentPage';
import { TaxOverviewPage } from './features/tax/TaxOverviewPage';
import { OutputTaxPage } from './features/tax/OutputTaxPage';
import { RetailPage } from './features/tax/RetailPage';
import { InputTaxPage } from './features/tax/InputTaxPage';
import { DimensionalPnlPage } from './features/analytics/DimensionalPnlPage';
import { AnalyticItemsPage } from './features/analytics/AnalyticItemsPage';
import { AnalyticSettingsPage } from './features/analytics/AnalyticSettingsPage';
import { BudgetPage } from './features/budget/BudgetPage';
import { BudgetVsActualPage } from './features/budget/BudgetVsActualPage';
import { AssetsPage } from './features/assets/AssetsPage';
import { AssetDetailPage } from './features/assets/AssetDetailPage';
import { DepreciationRunPage } from './features/assets/DepreciationRunPage';
import { DeferralsPage } from './features/assets/DeferralsPage';
import { AssetReportPage } from './features/assets/AssetReportPage';

export default function App() {
  return (
    <DataGate>
      <Layout>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/faktur" element={<InvoicesListPage side="sale" />} />
          <Route path="/faktur/baru" element={<InvoicePage side="sale" />} />
          <Route path="/faktur/:id" element={<InvoicePage side="sale" />} />
          <Route path="/tagihan" element={<InvoicesListPage side="purchase" />} />
          <Route path="/tagihan/baru" element={<InvoicePage side="purchase" />} />
          <Route path="/tagihan/:id" element={<InvoicePage side="purchase" />} />
          <Route path="/cetak/:id" element={<InvoicePrint />} />
          <Route path="/pembayaran" element={<PaymentsPage />} />
          <Route path="/umur-piutang" element={<AgingPage />} />
          <Route path="/kontak" element={<PartnersPage />} />
          <Route path="/rekening" element={<BankAccountsPage />} />
          <Route path="/mutasi" element={<StatementPage />} />
          <Route path="/rekonsiliasi" element={<ReconcilePage />} />
          <Route path="/rekonsiliasi/laporan" element={<ReconcileReportPage />} />
          <Route path="/kas-harian" element={<CashSessionPage />} />
          <Route path="/aset" element={<AssetsPage />} />
          <Route path="/aset/baru" element={<AssetDetailPage />} />
          <Route path="/aset/penyusutan" element={<DepreciationRunPage />} />
          <Route path="/aset/ditangguhkan" element={<DeferralsPage />} />
          <Route path="/aset/laporan" element={<AssetReportPage />} />
          <Route path="/aset/:id" element={<AssetDetailPage />} />
          <Route path="/laporan/per-dimensi" element={<DimensionalPnlPage />} />
          <Route path="/analitik/item" element={<AnalyticItemsPage />} />
          <Route path="/analitik/dimensi" element={<AnalyticSettingsPage />} />
          <Route path="/anggaran" element={<BudgetPage />} />
          <Route path="/anggaran/realisasi" element={<BudgetVsActualPage />} />
          <Route path="/pajak" element={<TaxOverviewPage />} />
          <Route path="/pajak/keluaran" element={<OutputTaxPage />} />
          <Route path="/pajak/eceran" element={<RetailPage />} />
          <Route path="/pajak/masukan" element={<InputTaxPage />} />
          <Route path="/laporan/laba-rugi" element={<ProfitLossPage />} />
          <Route path="/laporan/neraca" element={<BalanceSheetPage />} />
          <Route path="/tutup-buku" element={<ClosingPage />} />
          <Route path="/tutup-buku/hpp" element={<HppAdjustmentPage />} />
          <Route path="/entri" element={<EntriesListPage />} />
          <Route path="/entri/baru" element={<EntryPage />} />
          <Route path="/entri/:id" element={<EntryPage />} />
          <Route path="/akun" element={<AccountsPage />} />
          <Route path="/jurnal" element={<JournalsPage />} />
          <Route path="/buku-besar" element={<GeneralLedgerPage />} />
          <Route path="/neraca-saldo" element={<TrialBalancePage />} />
          <Route path="/pengaturan" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </DataGate>
  );
}
