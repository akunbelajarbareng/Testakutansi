import { Fragment, useMemo, useState } from 'react';
import { accountNetBalances, normalSide, toNormalBalance, type Account, type AccountGroup } from '../../domain';
import { formatAmount } from '../../lib/format';
import { useLedgerData } from '../../store/ledgerStore';
import { Button, PageHeader, Panel, inputClass, td, tdNum, th, thNum } from '../../components/ui';
import { AccountForm } from './AccountForm';

export function AccountsPage() {
  const data = useLedgerData();
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const [q, setQ] = useState('');

  const net = useMemo(() => accountNetBalances(data), [data]);
  const used = useMemo(() => new Set(data.entries.flatMap((e) => e.lines.map((l) => l.accountId))), [data.entries]);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const map = new Map<AccountGroup, Account[]>();
    [...data.accounts]
      .sort((a, b) => a.code.localeCompare(b.code))
      .filter((a) => !needle || `${a.code} ${a.name}`.toLowerCase().includes(needle))
      .forEach((a) => map.set(a.group, [...(map.get(a.group) ?? []), a]));
    return [...map.entries()];
  }, [data.accounts, q]);

  return (
    <>
      <PageHeader
        title="Bagan Akun"
        subtitle={`${data.accounts.length} akun. Pendapatan dan HPP dipisah per pilar bisnis.`}
        actions={<Button variant="primary" onClick={() => setEditing('new')}>Akun baru</Button>}
      />

      {editing && (
        <AccountForm
          key={editing === 'new' ? 'new' : editing.id}
          account={editing === 'new' ? undefined : editing}
          inUse={editing !== 'new' && used.has(editing.id)}
          onDone={() => setEditing(null)}
        />
      )}

      <input className={`${inputClass} mb-4 sm:max-w-sm`} placeholder="Cari kode atau nama akun" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari akun" />

      <Panel>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr>
                <th className={`${th} w-20`}>Kode</th>
                <th className={th}>Nama</th>
                <th className={th}>Saldo normal</th>
                <th className={thNum}>Saldo</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(([group, accounts]) => (
                <Fragment key={group}>
                  <tr>
                    <td colSpan={4} className="border-b border-line bg-navy-100/50 px-3 py-1.5 text-xs font-semibold text-navy">{group}</td>
                  </tr>
                  {accounts.map((a) => (
                    <tr
                      key={a.id}
                      tabIndex={0}
                      className={`cursor-pointer hover:bg-navy-100/40 ${a.active ? '' : 'text-ink-soft'}`}
                      onClick={() => setEditing(a)}
                      onKeyDown={(e) => e.key === 'Enter' && setEditing(a)}
                    >
                      <td className={`${td} num font-medium`}>{a.code}</td>
                      <td className={td}>
                        {a.name}
                        {a.contra && <span className="ml-2 text-xs text-ink-soft">kontra</span>}
                        {!a.active && <span className="ml-2 rounded bg-paper px-1.5 py-0.5 text-xs">nonaktif</span>}
                      </td>
                      <td className={`${td} text-ink-soft`}>{normalSide(a) === 'debit' ? 'Debit' : 'Kredit'}</td>
                      <td className={tdNum}>{formatAmount(toNormalBalance(a, net.get(a.id) ?? 0), true)}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
