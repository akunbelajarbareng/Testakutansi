import { nextEntryNumber, type JournalType } from '../../domain';
import { todayISO } from '../../lib/format';
import { useLedgerData } from '../../store/ledgerStore';
import { PageHeader, Panel, td, tdNum, th, thNum } from '../../components/ui';

const TYPE_LABEL: Record<JournalType, string> = {
  sale: 'Penjualan',
  purchase: 'Pembelian',
  bank: 'Bank',
  cash: 'Kas',
  general: 'Umum',
};

export function JournalsPage() {
  const data = useLedgerData();
  const today = todayISO();

  return (
    <>
      <PageHeader
        title="Jurnal"
        subtitle="Buku pencatatan per jenis transaksi. Kode jurnal menjadi awalan nomor entri."
      />
      <Panel>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr>
                <th className={th}>Kode</th>
                <th className={th}>Nama</th>
                <th className={th}>Jenis</th>
                <th className={th}>Nomor berikutnya</th>
                <th className={thNum}>Jumlah entri</th>
              </tr>
            </thead>
            <tbody>
              {data.journals.map((j) => (
                <tr key={j.id}>
                  <td className={`${td} font-medium`}>{j.code}</td>
                  <td className={td}>{j.name}</td>
                  <td className={td}>{TYPE_LABEL[j.type]}</td>
                  <td className={`${td} num text-ink-soft`}>{nextEntryNumber(j, today, data.entries)}</td>
                  <td className={tdNum}>{data.entries.filter((e) => e.journalId === j.id).length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <p className="mt-3 text-xs text-ink-soft">Penambahan jurnal baru (mis. jurnal per rekening bank) masuk iterasi berikutnya bersama modul Bank & Kas.</p>
    </>
  );
}
