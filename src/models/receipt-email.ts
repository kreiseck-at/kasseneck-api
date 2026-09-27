/**
 * Fehlercodes von `sendReceiptEmail` unter `/v3` (Vokabular
 * `errorCodes.receiptEmail`). Das Paket reicht sie als
 * [KasseneckApiError.code] durch und legt keine eigenen an.
 */
export const RECEIPT_EMAIL_ERROR_CODES = Object.freeze([
  'invalid_address',   // Empfaengeradresse unbrauchbar (Pruefung im Backend)
  'receipt_not_found', // Beleg gibt es nicht ODER er gehoert einer anderen Kasse
  'too_many_requests', // Schleuse: 5 Mails je Beleg (24 h), 30 je Kasse und Stunde
  'send_failed',       // die Mail selbst ging nicht hinaus
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
