import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useLedgerData } from '../store/ledgerStore';

const SECTIONS: { title?: string; items: { to: string; label: string; end?: boolean }[] }[] = [
  { items: [{ to: '/', label: 'Dashboard', end: true }] },
  {
    title: 'Penjualan & pembelian',
    items: [
      { to: '/faktur', label: 'Faktur Penjualan' },
      { to: '/tagihan', label: 'Tagihan Vendor' },
      { to: '/pembayaran', label: 'Pembayaran' },
      { to: '/umur-piutang', label: 'Umur Piutang & Utang' },
      { to: '/kontak', label: 'Kontak' },
    ],
  },
  {
    title: 'Bank & kas',
    items: [
      { to: '/rekening', label: 'Rekening' },
      { to: '/mutasi', label: 'Mutasi Bank' },
      { to: '/rekonsiliasi', label: 'Rekonsiliasi' },
      { to: '/kas-harian', label: 'Kas Harian' },
    ],
  },
  {
    title: 'Aset',
    items: [
      { to: '/aset', label: 'Register Aset', end: true },
      { to: '/aset/penyusutan', label: 'Penyusutan Bulanan' },
      { to: '/aset/ditangguhkan', label: 'Biaya & Pendapatan Ditangguhkan' },
      { to: '/aset/laporan', label: 'Laporan Aset' },
    ],
  },
  {
    title: 'Pajak',
    items: [
      { to: '/pajak', label: 'Ringkasan PPN', end: true },
      { to: '/pajak/keluaran', label: 'Faktur Pajak Keluaran' },
      { to: '/pajak/eceran', label: 'Penjualan Eceran' },
      { to: '/pajak/masukan', label: 'PPN Masukan' },
    ],
  },
  {
    title: 'Analitik & anggaran',
    items: [
      { to: '/laporan/per-dimensi', label: 'Laba Rugi per Pilar' },
      { to: '/anggaran/realisasi', label: 'Anggaran vs Realisasi' },
      { to: '/anggaran', label: 'Anggaran', end: true },
      { to: '/analitik/item', label: 'Edit Analitik' },
      { to: '/analitik/dimensi', label: 'Dimensi & Model' },
    ],
  },
  {
    title: 'Laporan & tutup buku',
    items: [
      { to: '/laporan/laba-rugi', label: 'Laba Rugi' },
      { to: '/laporan/neraca', label: 'Neraca' },
      { to: '/tutup-buku', label: 'Tutup Buku' },
    ],
  },
  {
    title: 'Akuntansi',
    items: [
      { to: '/entri', label: 'Entri Jurnal' },
      { to: '/buku-besar', label: 'Buku Besar' },
      { to: '/neraca-saldo', label: 'Neraca Saldo' },
      { to: '/akun', label: 'Bagan Akun' },
      { to: '/jurnal', label: 'Jurnal' },
    ],
  },
  { items: [{ to: '/pengaturan', label: 'Pengaturan' }] },
];

function Brand() {
  const { company } = useLedgerData();
  return (
    <div className="flex items-center gap-3 px-5 py-5">
      <span aria-hidden className="grid h-9 w-9 place-items-center rounded-md bg-orange text-lg font-bold text-white">
        {company.name.charAt(0)}
      </span>
      <div className="leading-tight">
        <div className="text-base font-semibold text-white">{company.name}</div>
        <div className="text-xs text-navy-100/70">Akuntansi</div>
      </div>
    </div>
  );
}

function Nav() {
  return (
    <nav className="flex flex-col gap-4 px-3 pb-6" aria-label="Menu utama">
      {SECTIONS.map((s, i) => (
        <div key={i} className="flex flex-col gap-0.5">
          {s.title && <div className="px-3 pb-1 text-xs text-navy-100/50">{s.title}</div>}
          {s.items.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `rounded-md border-l-[3px] px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? 'border-orange bg-navy-700 font-medium text-white'
                    : 'border-transparent text-navy-100/80 hover:bg-navy-700/60 hover:text-white'
                }`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <div className="min-h-screen lg:flex">
      <aside className="hidden w-60 shrink-0 bg-navy print:hidden lg:block">
        <div className="sticky top-0 max-h-screen overflow-y-auto">
          <Brand />
          <Nav />
        </div>
      </aside>

      <div className="flex items-center justify-between bg-navy px-4 py-3 print:hidden lg:hidden">
        <span className="font-semibold text-white">Akuntansi</span>
        <button
          type="button"
          className="rounded-md px-3 py-1.5 text-sm text-white ring-1 ring-white/30"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? 'Tutup' : 'Menu'}
        </button>
      </div>
      {open && (
        <div className="bg-navy pt-2 print:hidden lg:hidden">
          <Nav />
        </div>
      )}

      <main className="min-w-0 flex-1 px-4 py-6 print:p-0 sm:px-8 lg:py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
