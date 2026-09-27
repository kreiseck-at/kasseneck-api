/**
 * Fehlercodes von `createReceipt` und `getReceipt` unter `/v3` (Vokabular
 * `errorCodes.receiptMessagesByEndpoint`); dazu kommen die Zahlungscodes aus
 * [PAYMENT_ERROR_CODES] und die des Rands (`validation`, `dialect_mismatch`, …).
 *
 * `receipt_outcome_unknown` heisst: der Beleg ist moeglicherweise signiert
 * (`outcome: 'unknown'`). Nie wiederholen, sondern die Belegliste nachlesen.
 */
export const RECEIPT_ERROR_CODES = Object.freeze([
  'cancellation_reference_unavailable',
  'cashregister_closed',
  'cashregister_decommissioned',
  'final_receipt_expired',
  'final_receipt_not_allowed',
  'module_inactive',
  'not_permitted',
  'receipt_limit_exceeded',
  'receipt_not_found',
  'receipt_outcome_unknown',
  'receipt_type_invalid',
  'signature_incomplete',
  'signature_missing',
  'signing_failed',
  'small_business_vat_not_allowed',
  'tip_invalid',
  'tip_not_allowed',
  'tip_recipient_unknown',
  'validation',
] as const);

export type ReceiptErrorCode = (typeof RECEIPT_ERROR_CODES)[number];

export function isReceiptErrorCode(value: unknown): value is ReceiptErrorCode {
  return typeof value === 'string' && (RECEIPT_ERROR_CODES as readonly string[]).includes(value);
}
