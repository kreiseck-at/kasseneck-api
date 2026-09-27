/**
 * Mehrere Zahlungen je Beleg: Fehlercodes unter `/v3` (Vokabular
 * `errorCodes.payments`, gleiche Codes, gleiche Reihenfolge).
 *
 * `createReceipt` und `cancelReceipt` legen sie bei jedem Fehler rund um
 * `payments` als `code` neben die Meldung; das Paket reicht sie als
 * [KasseneckApiError.code] durch. **Entscheide am Code, nie am Text:** die
 * deutsche Meldung darf sich aendern, der Code nicht.
 *
 * `payments_sum_mismatch` traegt den Zahlbetrag des Servers in
 * `details.expectedCents` (siehe [paymentsExpectedCents]). Der Fehler
 * verbraucht keine Belegnummer; das Paket wiederholt trotzdem nie selbst,
 * denn eine Kartenzahlung ist schon belastet.
 */
export const PAYMENT_ERROR_CODES = Object.freeze([
  'payments_invalid',             // payments ist keine Liste oder hat mehr als 20 Eintraege
  'payment_method_invalid',       // Zahlart unbekannt oder mixed
  'payment_amount_invalid',       // amountCents keine Ganzzahl, 0 oder falsches Vorzeichen
  'payment_tendered_invalid',     // tenderedCents an Nicht-Bar-Zahlung, zu klein oder doppelt
  'payment_provider_invalid',     // Karte ohne/mit unbekanntem provider, providerPaymentId fehlt
  'payment_provider_not_allowed', // Anbieterfelder an einer Zahlung, die weder Karte noch online ist
  'payments_sum_mismatch',        // Summe != Zahlbetrag (details.expectedCents)
  'payments_due_negative',        // Zahlbetrag < 0 (Wertgutschein groesser als der Beleg)
  'payments_not_allowed',         // Null-/Startbeleg mit Zahlungen
  'payments_conflict',            // payments zusammen mit paymentMethod oder Kartenfeldern
  'payments_required',            // ohne payments
  'payment_method_not_supported', // paymentMethod/Kartenfelder am Beleg
  'tip_payment_method_invalid',   // Trinkgeld-Zahlart kommt in payments nicht vor
  'tip_payment_method_required',  // mehrere Zahlarten, tip.paymentMethod fehlt
  'tip_exceeds_payment',          // Trinkgeld uebersteigt die Zahlungen seiner Zahlart
  'payment_refund_not_allowed',   // refundOf ausserhalb eines Stornos oder kein String
  'payment_tip_invalid',          // tipCents keine Ganzzahl, <= 0, > amountCents oder nicht am Verkauf
  'tip_conflict',                 // tip und payments[].tipCents zugleich
] as const);

export type PaymentErrorCode = (typeof PAYMENT_ERROR_CODES)[number];

/** Erkennt einen Code aus [PAYMENT_ERROR_CODES], exakt (klein, wie unter `/v3`). */
export function isPaymentErrorCode(value: unknown): value is PaymentErrorCode {
  return typeof value === 'string' && (PAYMENT_ERROR_CODES as readonly string[]).includes(value);
}
