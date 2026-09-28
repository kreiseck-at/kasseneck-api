/** Die Codes des Versands selbst (`errorCodes.receiptEmail`); jeder hat einen Satz im Textkatalog. */
export const RECEIPT_EMAIL_SEND_ERROR_CODES = Object.freeze([
  'invalid_address',   // Empfaengeradresse unbrauchbar (Pruefung im Backend)
  'receipt_not_found', // Beleg gibt es nicht ODER er gehoert einer anderen Kasse
  'too_many_requests', // Schleuse: 5 Mails je Beleg (24 h), 30 je Kasse und Stunde
  'send_failed',       // die Mail selbst ging nicht hinaus
] as const);
export type ReceiptEmailSendErrorCode = (typeof RECEIPT_EMAIL_SEND_ERROR_CODES)[number];

/**
 * Fehlercodes von `sendReceiptEmail` unter `/v3`: die Versandcodes
 * ([RECEIPT_EMAIL_SEND_ERROR_CODES]) und dahinter (ab 1.0) die Codes, die
 * Anmeldung und Rand auf diesem Endpunkt erzeugen koennen: `errorCodes.auth`
 * ohne die sieben des Partner-Zugangs und `errorCodes.edge` (`not_found`,
 * `dialect_mismatch`, `response_translation_failed` ...). Das Paket reicht sie
 * als [KasseneckApiError.code] durch; ein Code ausserhalb bleibt dort lesbar.
 */
export const RECEIPT_EMAIL_ERROR_CODES = Object.freeze([
  ...RECEIPT_EMAIL_SEND_ERROR_CODES,
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
  'validation',
] as const);

export type ReceiptEmailErrorCode = (typeof RECEIPT_EMAIL_ERROR_CODES)[number];

export function isReceiptEmailErrorCode(value: unknown): value is ReceiptEmailErrorCode {
  return typeof value === 'string' && (RECEIPT_EMAIL_ERROR_CODES as readonly string[]).includes(value);
}

/**
 * Versandweg der Belegmail (Katalog `MAILWEG`): Postfach des Betriebs,
 * Plattform, oder Plattform als Rueckfall, weil das eigene Postfach scheiterte.
 */
export const RECEIPT_EMAIL_VIAS = Object.freeze(['own', 'platform', 'platform_fallback'] as const);

export type ReceiptEmailVia = (typeof RECEIPT_EMAIL_VIAS)[number];
