import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FISCAL_GROUPS, assetCostTotal, postedAccumulated, sourceCandidates, type SourceCandidate } from '../../domain';
import { formatAmount, formatDate } from '../../lib/format';
import { newId } from '../../lib/id';
import { docPath } from '../../lib/paths';
import { useLedger, useLedgerData } from '../../store/ledgerStore';
import { Alert, Button, EmptyState, LinkButton, PageHeader, Panel, errorMessage, inputClass, td, tdNum, th, thNum } from '../../components/ui';

const STATUS = { draft: ['Draft', 'bg-navy-100 text-navy'], running: ['Disusutkan', 'bg-ok-100 text-ok'], disposed: ['Dilepas', 'bg-paper text-ink-soft border border-line'] } as const;

export function AssetsPage() {
  const data = useLedgerData();
  const store = useLedger();
  const navigate = useNavigate();
  const [cat, setCat] = useState('');
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const rows = useMemo(
    () =>
      data.assets
        .filter((a) => !cat || a.categoryId === cat)
        .map((a) => {
          const cost = assetCostTotal(a);
          const acc = postedAccumulated(a, data);
          return { a, cost, acc, nbv: a.status === 'disposed' ? 0 : cost - acc };
        })
        .sort((x, y) => x.a.code.localeCompare(y.a.code)),
    [data, cat],
  );
  const live = rows.filter((r) => r.a.status === 'running');
  const candidates = sourceCandidates(data);

  const fromCandidate = async (c: SourceCandidate) => {
    setMessage(null);
    const partner = data.partners.find((p) => p.id === c.partnerId)?.name ?? '';
    try {
      if (c.target === 'asset') {
        const category = data.assetCategories.find((x) => x.assetAccountId === c.accountId)!;
        const prefix = category.name.slice(0, 3).toUpperCase();
        const n = data.assets.filter((a) => a.code.startsWith(prefix)).length + 1;
        const id = newId();
        await store.saveAsset({
          id,
          code: `${prefix}-${String(n).padStart(3, '0')}`,
          name: c.description,
          categoryId: category.id,
          serial: '',
          acquisitionDate: c.date,
          inServiceDate: c.date,
          cost: c.amount,
          salvage: 0,
          usefulLifeMonths: FISCAL_GROUPS[category.defaultFiscalGroup].years * 12,
          fiscalGroup: category.defaultFiscalGroup,
          fiscalMethod: 'SL',
          status: 'draft',
          openingAccumulated: 0,
          improvements: [],
          sourceInvoiceId: c.invoiceId,
          sourceLineId: c.lineId,
          createdAt: new Date().toISOString(),
        });
        navigate(`/aset/${id}`, { state: { notice: 'Draft aset dibuat dari tagihan. Lengkapi masa manfaat, kelompok fiskal, dan pemakai, lalu aktifkan.' } });
      } else {
        navigate('/aset/ditangguhkan', { state: { candidate: c, partner } });
      }
    } catch (e) {
      setMessage({ tone: 'error', text: errorMessage(e) });
    }
  };

  return (
    <>
      <PageHeader
        title="Register Aset"
        subtitle="Aset tetap per unit beserta nilai bukunya. Penyusutan dibukukan lewat Penyusutan Bulanan."
        actions={
          <>
            <LinkButton to="/aset/penyusutan">Penyusutan bulanan</LinkButton>
            <LinkButton to="/aset/baru" variant="primary">Aset baru</LinkButton>
          </>
        }
      />
      <div className="space-y-4">
        {message && <Alert tone={message.tone}>{message.text}</Alert>}
        {candidates.length > 0 && (
          <Panel className="border-orange/40 p-5">
            <h2 className="text-base font-semibold text-navy">Dari tagihan & faktur, belum punya kartu</h2>
            <ul className="mt-2 divide-y divide-line text-sm">
              {candidates.map((c) => (
                <li key={c.lineId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <Link className="font-medium text-navy-600 hover:underline" to={docPath({ id: c.invoiceId, kind: c.target === 'revenue_deferral' ? 'out_invoice' : 'in_invoice' })}>{c.number}</Link>
                    <span className="ml-2">{c.description}</span>
                    <span className="num ml-2 text-ink-soft">{formatAmount(c.amount)}</span>
                  </span>
                  <Button onClick={() => fromCandidate(c)}>
                    {c.target === 'asset' ? 'Buat kartu aset' : c.target === 'expense_deferral' ? 'Buat biaya ditangguhkan' : 'Buat pendapatan ditangguhkan'}
                  </Button>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        <Panel className="grid gap-4 p-5 sm:grid-cols-4">
          <Stat label="Aset aktif" value={String(live.length)} />
          <Stat label="Nilai perolehan" value={formatAmount(live.reduce((s, r) => s + r.cost, 0))} />
          <Stat label="Akumulasi dibukukan" value={formatAmount(live.reduce((s, r) => s + r.acc, 0))} />
          <Stat label="Nilai buku" value={formatAmount(live.reduce((s, r) => s + r.nbv, 0))} strong />
        </Panel>

        <select className={`${inputClass} sm:max-w-xs`} value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Filter kategori">
          <option value="">Semua kategori</option>
          {data.assetCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        <Panel>
          {rows.length === 0 ? (
            <EmptyState title="Belum ada aset." action={<LinkButton to="/aset/baru" variant="primary">Aset baru</LinkButton>} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse">
                <thead>
                  <tr><th className={th}>Kode</th><th className={th}>Aset</th><th className={th}>Mulai pakai</th><th className={thNum}>Perolehan</th><th className={thNum}>Akumulasi</th><th className={thNum}>Nilai buku</th><th className={th}>Status</th></tr>
                </thead>
                <tbody>
                  {rows.map(({ a, cost, acc, nbv }) => (
                    <tr key={a.id} tabIndex={0} className="cursor-pointer hover:bg-navy-100/40" onClick={() => navigate(`/aset/${a.id}`)} onKeyDown={(e) => e.key === 'Enter' && navigate(`/aset/${a.id}`)}>
                      <td className={`${td} num font-medium`}>{a.code}</td>
                      <td className={td}>{a.name}<div className="text-xs text-ink-soft">{data.assetCategories.find((c) => c.id === a.categoryId)?.name}{a.serial ? `, ${a.serial}` : ''}</div></td>
                      <td className={`${td} whitespace-nowrap`}>{formatDate(a.inServiceDate)}</td>
                      <td className={tdNum}>{formatAmount(cost)}</td>
                      <td className={tdNum}>{formatAmount(acc)}</td>
                      <td className={`${tdNum} font-medium`}>{formatAmount(nbv)}</td>
                      <td className={td}><span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS[a.status][1]}`}>{STATUS[a.status][0]}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <div className="text-xs text-ink-soft">{label}</div>
      <div className={`num mt-1 ${strong ? 'text-xl font-semibold text-navy' : 'text-lg text-ink'}`}>{value}</div>
    </div>
  );
}
