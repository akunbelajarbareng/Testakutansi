import { useMemo, useState } from 'react';
import { invoiceResidual, type Partner } from '../../domain';
import { formatAmount } from '../../lib/format';
import { useLedgerData } from '../../store/ledgerStore';
import { Button, PageHeader, Panel, inputClass, td, tdNum, th, thNum } from '../../components/ui';
import { PartnerForm, TIER_LABEL } from './PartnerForm';

export function PartnersPage() {
  const data = useLedgerData();
  const [editing, setEditing] = useState<Partner | 'new' | null>(null);
  const [filter, setFilter] = useState<'customer' | 'supplier' | 'all'>('all');
  const [q, setQ] = useState('');

  const balances = useMemo(() => {
    const map = new Map<string, { ar: number; ap: number }>();
    for (const inv of data.invoices) {
      if (inv.status !== 'posted' || (inv.kind !== 'out_invoice' && inv.kind !== 'in_invoice')) continue;
      const b = map.get(inv.partnerId) ?? { ar: 0, ap: 0 };
      const r = Math.max(0, invoiceResidual(inv, data));
      if (inv.kind === 'out_invoice') b.ar += r;
      else b.ap += r;
      map.set(inv.partnerId, b);
    }
    return map;
  }, [data]);

  const rows = data.partners
    .filter((p) => filter === 'all' || p.kind === filter || p.kind === 'both')
    .filter((p) => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <PageHeader title="Kontak" subtitle="Pelanggan dan supplier, termin pembayaran, serta batas kredit." actions={<Button variant="primary" onClick={() => setEditing('new')}>Kontak baru</Button>} />
      {editing && <PartnerForm key={editing === 'new' ? 'new' : editing.id} partner={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />}

      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto]">
        <input className={inputClass} placeholder="Cari nama kontak" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari kontak" />
        <select className={inputClass} value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Filter jenis">
          <option value="all">Semua kontak</option>
          <option value="customer">Pelanggan</option>
          <option value="supplier">Supplier</option>
        </select>
      </div>

      <Panel>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[780px] border-collapse">
            <thead>
              <tr>
                <th className={th}>Nama</th>
                <th className={th}>Tier</th>
                <th className={th}>Termin</th>
                <th className={thNum}>Batas kredit</th>
                <th className={thNum}>Piutang terbuka</th>
                <th className={thNum}>Utang terbuka</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const b = balances.get(p.id) ?? { ar: 0, ap: 0 };
                const over = p.creditLimit > 0 && b.ar > p.creditLimit;
                return (
                  <tr key={p.id} tabIndex={0} className={`cursor-pointer hover:bg-navy-100/40 ${p.active ? '' : 'text-ink-soft'}`} onClick={() => setEditing(p)} onKeyDown={(e) => e.key === 'Enter' && setEditing(p)}>
                    <td className={`${td} font-medium`}>
                      {p.name}
                      <div className="text-xs font-normal text-ink-soft">{p.kind === 'customer' ? 'Pelanggan' : p.kind === 'supplier' ? 'Supplier' : 'Pelanggan & supplier'}{p.active ? '' : ', nonaktif'}</div>
                    </td>
                    <td className={td}>{p.tier ? TIER_LABEL[p.tier] : '-'}</td>
                    <td className={td}>{p.paymentTermDays === 0 ? 'Tunai' : `${p.paymentTermDays} hari`}</td>
                    <td className={tdNum}>{p.creditLimit ? formatAmount(p.creditLimit) : p.kind === 'supplier' ? '' : 'Tanpa batas'}</td>
                    <td className={`${tdNum} ${over ? 'font-semibold text-bad' : ''}`}>{formatAmount(b.ar, true)}</td>
                    <td className={tdNum}>{formatAmount(b.ap, true)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
