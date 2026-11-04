import { isSale, type Invoice } from '../domain';

export const docPath = (inv: Pick<Invoice, 'id' | 'kind'>) => `${isSale(inv.kind) ? '/faktur' : '/tagihan'}/${inv.id}`;
