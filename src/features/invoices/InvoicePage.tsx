import { useParams } from 'react-router-dom';
import { isSale } from '../../domain';
import { useLedgerData } from '../../store/ledgerStore';
import { EmptyState, LinkButton, PageHeader } from '../../components/ui';
import { InvoiceForm } from './InvoiceForm';
import { InvoiceView } from './InvoiceView';

export function InvoicePage({ side }: { side: 'sale' | 'purchase' }) {
  const { id } = useParams();
  const data = useLedgerData();
  const base = side === 'sale' ? '/faktur' : '/tagihan';

  if (!id) return <InvoiceForm key="new" side={side} />;

  const inv = data.invoices.find((i) => i.id === id && isSale(i.kind) === (side === 'sale'));
  if (!inv) {
    return (
      <>
        <PageHeader title="Dokumen tidak ditemukan" back={{ to: base, label: side === 'sale' ? 'Faktur Penjualan' : 'Tagihan Vendor' }} />
        <EmptyState title="Dokumen ini mungkin sudah dihapus." action={<LinkButton to={base}>Kembali ke daftar</LinkButton>} />
      </>
    );
  }
  return inv.status === 'draft' ? <InvoiceForm key={inv.id} side={side} invoice={inv} /> : <InvoiceView key={inv.id} invoice={inv} />;
}
