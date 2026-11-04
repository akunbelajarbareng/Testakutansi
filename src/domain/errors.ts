export type LedgerErrorCode =
  | 'NOT_BALANCED'
  | 'TOO_FEW_LINES'
  | 'INVALID_LINE'
  | 'UNKNOWN_ACCOUNT'
  | 'INACTIVE_ACCOUNT'
  | 'UNKNOWN_JOURNAL'
  | 'PERIOD_LOCKED'
  | 'NOT_DRAFT'
  | 'NOT_POSTED'
  | 'ALREADY_REVERSED'
  | 'INVALID_DATE'
  | 'DUPLICATE_CODE'
  | 'INVALID_ACCOUNT'
  | 'HAS_SOURCE_DOCUMENT'
  | 'INVALID_INVOICE'
  | 'UNKNOWN_PARTNER'
  | 'REFUND_EXCEEDS_RESIDUAL'
  | 'INVALID_PAYMENT'
  | 'ALLOCATION_EXCEEDS_RESIDUAL'
  | 'ALREADY_CANCELLED'
  | 'INVALID_STATEMENT'
  | 'RECONCILE_MISMATCH'
  | 'ALREADY_RECONCILED'
  | 'NOT_RECONCILED'
  | 'CASH_SESSION_CLOSED'
  | 'INVALID_TRANSFER'
  | 'INVALID_HPP'
  | 'CHECKLIST_FAILED'
  | 'INVALID_PERIOD'
  | 'INVALID_TAX_ID'
  | 'INVALID_TAX'
  | 'INVALID_ANALYTIC'
  | 'INVALID_BUDGET'
  | 'INVALID_ASSET';

/** Error domain dengan kode stabil (untuk API/terjemahan) dan pesan Bahasa Indonesia. */
export class LedgerError extends Error {
  constructor(
    public readonly code: LedgerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LedgerError';
  }
}
