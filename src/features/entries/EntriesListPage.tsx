import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { EntryStatus } from '../../domain';
import { formatAmount, formatDate } from '../../lib/format';
import { useLedgerData } from '../../store/ledgerStore';
import { EmptyState, LinkButton, PageHeader, Panel, StatusBadge, inputClass, td, tdNum, th, thNum } from '../../components/ui';

type StatusFilter = 'all' | EntryStatus;

export function EntriesListPage() {
  const data = useLedgerData();
  const navigate = useNavigate();
  const [status, setStatus] = useState<StatusFilter>('all');
  const [journalId, setJournalId] = useState('');
  const [q, setQ] = useState('');

  const journals = useMemo(() => new Map(data.journals.map((j) => [j.id, j])), [data.journals]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.entries
      .filter((e) => status === 'all' || e.status === status)
      .filter((e) => !journalId || e.journalId === journalId)
      .filter((e) => !needle || `${e.number ?? ''} ${e.reference}`.toLowerCase().includes(needle))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }, [data.entries, status, journalId, q]);

  return (
    <>
      <PageHeader
        title="Entri Jurnal"
        subtitle="Semua pencatatan debit–kredit. Draft belum memengaruhi saldo sampai diposting."
        actions={<LinkButton to="/entri/baru" variant="primary">Entri baru</LinkButton>}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <input className={inputClass} placeholder="Cari nomor atau referensi" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari entri" />
        <select className={inputClass} value={journalId} onChange={(e) => setJournalId(e.target.value)} aria-label="Filter jurnal">
          <option value="">Semua jurnal</option>
          {data.journals.map((j) => (
            <option key={j.id} value={j.id}>{j.name}</option>
          ))}
        </select>
        <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} aria-label="Filter status">
          <option value="all">Semua status</option>
          <option value="draft">Draft</option>
          <option value="posted">Diposting</option>
          <option value="reversed">Dibalik</option>
        </select>
      </div>

      <Panel>
        {rows.length === 0 ? (
          <EmptyState
            title={data.entries.length === 0 ? 'Belum ada entri jurnal. Mulai dengan mencatat saldo awal atau setoran modal.' : 'Tidak ada entri yang cocok dengan filter.'}
            action={data.entries.length === 0 ? <LinkButton to="/entri/baru" variant="primary">Entri baru</LinkButton> : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr>
                  <th className={th}>Tanggal</th>
                  <th className={th}>Nomor</th>
                  <th className={th}>Jurnal</th>
                  <th className={th}>Referensi</th>
                  <th className={thNum}>Total</th>
                  <th className={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr
                    key={e.id}
                    tabIndex={0}
                    className="cursor-pointer hover:bg-navy-100/40 focus:bg-navy-100/40"
                    onClick={() => navigate(`/entri/${e.id}`)}
                    onKeyDown={(ev) => ev.key === 'Enter' && navigate(`/entri/${e.id}`)}
                  >
                    <td className={`${td} whitespace-nowrap`}>{formatDate(e.date)}</td>
                    <td className={`${td} whitespace-nowrap font-medium`}>{e.number ?? <span className="text-ink-soft">Belum bernomor</span>}</td>
                    <td className={td}>{journals.get(e.journalId)?.name}</td>
                    <td className={`${td} max-w-xs truncate`}>{e.reference}</td>
                    <td className={tdNum}>{formatAmount(e.lines.reduce((s, l) => s + l.debit, 0))}</td>
                    <td className={td}><StatusBadge status={e.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <p className="mt-3 text-xs text-ink-soft">{rows.length} entri ditampilkan</p>
    </>
  );
}
