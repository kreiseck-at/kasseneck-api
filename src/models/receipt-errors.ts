import { KasseneckApiError } from '../client/errors.js';
import { bekannterCode, feldfehlerVon } from '../client/fehlercodes.js';

/**
 * Fehlercodes von `createReceipt` und `getReceipt` unter `/v3` (Vokabular
 * `errorCodes.receiptMessagesByEndpoint`); dazu kommen die Zahlungscodes aus
 * [PAYMENT_ERROR_CODES] und die des Rands (`validation`, `dialect_mismatch`, …).
 *
 * `receipt_outcome_unknown` heisst: der Beleg ist moeglicherweise signiert
 * (`outcome: 'unknown'`). Nie wiederholen, sondern die Belegliste nachlesen.
 *
 * Dahinter (ab 1.0) die Codes, die Anmeldung und Rand auf diesem Endpunkt
 * erzeugen koennen: `errorCodes.auth` ohne die sieben des Partner-Zugangs und
 * `errorCodes.edge` (`not_found`, `dialect_mismatch`, `response_translation_failed`
 * ...). Zuletzt die Codes des Pakets selbst: `route_missing` und
 * `response_unreadable` (Erfolg gemeldet, Antwort unlesbar, Ausgang unklar).
 * Die Zahlungscodes (`payments_sum_mismatch`, `payment_method_not_supported`
 * ...) stehen in [PAYMENT_ERROR_CODES]. Ein Code ausserhalb bleibt ueber
 * `KasseneckApiError.code` lesbar.
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
  // Anmeldung und Rand (errorCodes.auth ohne Partner-Zugang, errorCodes.edge)
  'account_not_found',
  'admin_required',
  'cashregister_not_assigned',
  'cashregister_not_found',
  'cashregister_token_invalid',
  'cashregister_token_missing',
  'dialect_mismatch',
  'internal_translation_error',
  'live_not_enabled',
  'method_not_allowed',
  'mfa_required',
  'not_found',
  'register_user_no_business',
  'register_user_not_allowed',
  'register_user_not_found',
  'response_translation_failed',
  'session_expired',
  'session_other_cashregister',
  'unauthorized',
  'user_disabled',
  'user_verification_failed',
  // Codes des Pakets (CLIENT_ERROR_CODES)
  'route_missing',
  'response_unreadable',
] as const);

export type ReceiptErrorCode = (typeof RECEIPT_ERROR_CODES)[number];

export function isReceiptErrorCode(value: unknown): value is ReceiptErrorCode {
  return typeof value === 'string' && (RECEIPT_ERROR_CODES as readonly string[]).includes(value);
}

const RECEIPT_BEKANNT: ReadonlySet<string> = new Set(RECEIPT_ERROR_CODES);

/** Der Code eines geworfenen Fehlers, wenn er in [RECEIPT_ERROR_CODES] steht; sonst `undefined`. */
export function receiptErrorCode(error: unknown): ReceiptErrorCode | undefined {
  return bekannterCode<ReceiptErrorCode>(error, RECEIPT_BEKANNT);
}

/**
 * Kurzform fuer `catch (e) { if (isReceiptError(e, 'signing_failed')) … }`.
 * Ohne `code`: traegt der Fehler ueberhaupt einen Code aus [RECEIPT_ERROR_CODES]?
 */
export function isReceiptError(error: unknown, code?: ReceiptErrorCode): error is KasseneckApiError {
  const gefunden = receiptErrorCode(error);
  return gefunden !== undefined && (code === undefined || gefunden === code);
}

/** Ein Feldfehler aus `data.errors[]` einer `validation`-Antwort der Belegwelt. */
export interface ReceiptFieldError {
  /** Feldpfad in der gesendeten Anfrage, z. B. `items.0.vatRate` oder `payments.1.amountCents`. */
  field: string;
  message: string;
}

/**
 * Die Feldfehler einer `validation`-Antwort von `createReceipt`,
 * `cancelReceipt` oder `sendReceiptEmail`; leer, wenn es keine sind.
 */
export function receiptFieldErrors(error: unknown): ReceiptFieldError[] {
  return feldfehlerVon(error);
}
