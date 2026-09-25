/**
 * Mehrere Zahlungen je Beleg — Fehlercode-Katalog, Zwilling von
 * `functions/gemeinsam/zahlungen-core.js` ZAHLUNGS_FEHLERCODES (gleiche
 * Codes, gleiche Reihenfolge).
 *
 * `createReceipt` und `cancelReceipt` legen sie bei jedem Fehler rund um
 * `payments` (und bei den Aufrufer-Vorbedingungen wie `PAYMENTS_CONFLICT`)
 * als `code` neben die Meldung; das Paket reicht sie als
 * [KasseneckApiError.code] durch. **Entscheide am Code, nie am Text** — die
 * deutsche Meldung darf sich aendern, der Code nicht.
 *
 * Schreibweise: auf `/v1`, `/v2` und intern kommen die Codes gross
 * (`PAYMENTS_SUM_MISMATCH`), unter `/v3` schreibt der Rand des Backends sie
 * klein (`payments_sum_mismatch`, functions/gemeinsam/api-vokabular-v3.js:
 * jeder dieser Codes 1:1 in Kleinschreibung, anders als die Storno-Codes).
 * [isPaymentErrorCode] erkennt beide; wer selbst vergleicht, vergleicht
 * `code.toUpperCase()`.
 */
export const PAYMENT_ERROR_CODES = Object.freeze([
  'PAYMENTS_INVALID',             // payments ist keine Liste oder hat mehr als 20 Eintraege
  'PAYMENT_METHOD_INVALID',       // Zahlart unbekannt oder mixed
  'PAYMENT_AMOUNT_INVALID',       // amountCents keine Ganzzahl, 0 oder falsches Vorzeichen
  'PAYMENT_TENDERED_INVALID',     // tenderedCents an Nicht-Bar-Zahlung, zu klein oder doppelt
  'PAYMENT_PROVIDER_INVALID',     // Karte ohne/mit unbekanntem provider, providerPaymentId fehlt
  'PAYMENT_PROVIDER_NOT_ALLOWED', // Anbieterfelder an einer Zahlung, die weder Karte noch online ist
  'PAYMENTS_SUM_MISMATCH',        // Summe != Zahlbetrag (Antwort nennt data.expectedCents)
  'PAYMENTS_DUE_NEGATIVE',        // Zahlbetrag < 0 (Wertgutschein groesser als der Beleg)
  'PAYMENTS_NOT_ALLOWED',         // Null-/Startbeleg mit Zahlungen, alter Storno-Weg
  'PAYMENTS_CONFLICT',            // payments zusammen mit paymentMethod oder Kartenfeldern
  'PAYMENTS_REQUIRED',            // /v3 ohne payments
  'PAYMENT_METHOD_NOT_SUPPORTED', // paymentMethod/Kartenfelder unter /v3
  'TIP_PAYMENT_METHOD_INVALID',   // Trinkgeld-Zahlart kommt in payments nicht vor
  'TIP_PAYMENT_METHOD_REQUIRED',  // mehrere Zahlarten, tip.paymentMethod fehlt
  'TIP_EXCEEDS_PAYMENT',          // Trinkgeld uebersteigt die Zahlungen seiner Zahlart
  'PAYMENT_REFUND_NOT_ALLOWED',   // refundOf ausserhalb eines Stornos oder kein String
] as const);

export type PaymentErrorCode = (typeof PAYMENT_ERROR_CODES)[number];

/** Erkennt einen Code aus [PAYMENT_ERROR_CODES] — gross (`/v1`) wie klein (`/v3`). */
export function isPaymentErrorCode(value: unknown): value is PaymentErrorCode | Lowercase<PaymentErrorCode> {
  return typeof value === 'string' && (PAYMENT_ERROR_CODES as readonly string[]).includes(value.toUpperCase());
}
