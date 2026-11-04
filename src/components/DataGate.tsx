import { useEffect, type ReactNode } from 'react';
import { useLedger } from '../store/ledgerStore';

/** Memuat data sekali di awal; layar di dalamnya bisa langsung memakai useLedgerData(). */
export function DataGate({ children }: { children: ReactNode }) {
  const { data, loadError, init } = useLedger();
  useEffect(() => {
    void init();
  }, [init]);

  if (loadError) {
    return <p className="p-8 text-bad">Gagal memuat data: {loadError}</p>;
  }
  if (!data) {
    return <p className="p-8 text-ink-soft">Memuat buku besar…</p>;
  }
  return <>{children}</>;
}
