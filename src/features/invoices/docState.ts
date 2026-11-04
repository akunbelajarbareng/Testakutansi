import { isOverdue, paymentState, type Invoice, type LedgerData } from '../../domain';

/** Status tampilan: status pembayaran, dengan "lewat jatuh tempo" bila belum lunas dan sudah lewat. */
export function displayState(inv: Invoice, data: LedgerData, today: string) {
  if (isOverdue(inv, data, today)) return 'overdue' as const;
  return paymentState(inv, data);
}
