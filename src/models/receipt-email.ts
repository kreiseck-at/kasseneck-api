import { KasseneckApiError } from '../client/errors.js';
import { bekannterCode } from '../client/fehlercodes.js';

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
 * Zuletzt `route_missing` (Code des Pakets).
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
  // Code des Pakets (CLIENT_ERROR_CODES; response_unreadable nur an signierenden Aufrufen)
  'route_missing',
] as const);

export type ReceiptEmailErrorCode = (typeof RECEIPT_EMAIL_ERROR_CODES)[number];

export function isReceiptEmailErrorCode(value: unknown): value is ReceiptEmailErrorCode {
  return typeof value === 'string' && (RECEIPT_EMAIL_ERROR_CODES as readonly string[]).includes(value);
}

const RECEIPTEMAIL_BEKANNT: ReadonlySet<string> = new Set(RECEIPT_EMAIL_ERROR_CODES);

/** Der Code eines geworfenen Fehlers, wenn er in [RECEIPT_EMAIL_ERROR_CODES] steht; sonst `undefined`. */
export function receiptEmailErrorCode(error: unknown): ReceiptEmailErrorCode | undefined {
  return bekannterCode<ReceiptEmailErrorCode>(error, RECEIPTEMAIL_BEKANNT);
}

/**
 * Kurzform fuer `catch (e) { if (isReceiptEmailError(e, 'too_many_requests')) … }`.
 * Ohne `code`: traegt der Fehler ueberhaupt einen Code aus [RECEIPT_EMAIL_ERROR_CODES]?
 */
export function isReceiptEmailError(error: unknown, code?: ReceiptEmailErrorCode): error is KasseneckApiError {
  const gefunden = receiptEmailErrorCode(error);
  return gefunden !== undefined && (code === undefined || gefunden === code);
}

/**
 * Versandweg der Belegmail (Katalog `MAILWEG`): Postfach des Betriebs,
 * Plattform, oder Plattform als Rueckfall, weil das eigene Postfach scheiterte.
 */
export const RECEIPT_EMAIL_VIAS = Object.freeze(['own', 'platform', 'platform_fallback'] as const);

export type ReceiptEmailVia = (typeof RECEIPT_EMAIL_VIAS)[number];
