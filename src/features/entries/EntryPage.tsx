import { useParams } from 'react-router-dom';
import { useLedgerData } from '../../store/ledgerStore';
import { EmptyState, LinkButton, PageHeader } from '../../components/ui';
import { EntryForm } from './EntryForm';
import { EntryView } from './EntryView';

/** /entri/baru → form kosong. /entri/:id → form (draft) atau tampilan baca-saja (diposting/dibalik). */
export function EntryPage() {
  const { id } = useParams();
  const data = useLedgerData();

  if (!id) return <EntryForm key="new" />;

  const entry = data.entries.find((e) => e.id === id);
  if (!entry) {
    return (
      <>
        <PageHeader title="Entri tidak ditemukan" back={{ to: '/entri', label: 'Entri Jurnal' }} />
        <EmptyState title="Entri ini mungkin sudah dihapus." action={<LinkButton to="/entri">Kembali ke daftar</LinkButton>} />
      </>
    );
  }
  return entry.status === 'draft' ? <EntryForm key={entry.id} entry={entry} /> : <EntryView key={entry.id} entry={entry} />;
}
