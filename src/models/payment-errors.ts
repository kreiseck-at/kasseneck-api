import { KasseneckApiError } from '../client/errors.js';
import { bekannterCode, feldfehlerVon } from '../client/fehlercodes.js';

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
 *
 * Dahinter (ab 1.0) die Codes, die Anmeldung und Rand auf diesem Endpunkt
 * erzeugen koennen: `errorCodes.auth` ohne die sieben des Partner-Zugangs und
 * `errorCodes.edge` (`not_found`, `dialect_mismatch`, `response_translation_failed`
 * ...) und zuletzt `route_missing` (Code des Pakets). Ein Code ausserhalb
 * bleibt ueber `KasseneckApiError.code` lesbar.
 */
export const PAYMENT_ERROR_CODES = Object.freeze([
  'payments_invalid',             // payments ist keine Liste oder hat mehr als 20 Eintraege
  'payment_method_invalid',       // Zahlart unbekannt oder mixed
  'payment_amount_invalid',       // amountCents keine Ganzzahl, 0 oder falsches Vorzeichen
  'payment_tendered_invalid',     // tenderedCents an Nicht-Bar-Zahlung, zu klein oder am Storno
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

export type PaymentErrorCode = (typeof PAYMENT_ERROR_CODES)[number];

/** Erkennt einen Code aus [PAYMENT_ERROR_CODES], exakt (klein, wie unter `/v3`). */
export function isPaymentErrorCode(value: unknown): value is PaymentErrorCode {
  return typeof value === 'string' && (PAYMENT_ERROR_CODES as readonly string[]).includes(value);
}

const PAYMENT_BEKANNT: ReadonlySet<string> = new Set(PAYMENT_ERROR_CODES);

/** Der Code eines geworfenen Fehlers, wenn er in [PAYMENT_ERROR_CODES] steht; sonst `undefined`. */
export function paymentErrorCode(error: unknown): PaymentErrorCode | undefined {
  return bekannterCode<PaymentErrorCode>(error, PAYMENT_BEKANNT);
}

/**
 * Kurzform fuer `catch (e) { if (isPaymentError(e, 'payments_sum_mismatch')) … }`.
 * Ohne `code`: traegt der Fehler ueberhaupt einen Code aus [PAYMENT_ERROR_CODES]?
 */
export function isPaymentError(error: unknown, code?: PaymentErrorCode): error is KasseneckApiError {
  const gefunden = paymentErrorCode(error);
  return gefunden !== undefined && (code === undefined || gefunden === code);
}

/** Ein Feldfehler aus `data.errors[]` einer `validation`-Antwort von `payments[]`. */
export interface PaymentFieldError {
  field: string;
  message: string;
}

/** Die Feldfehler einer `validation`-Antwort; leer, wenn es keine sind. */
export function paymentFieldErrors(error: unknown): PaymentFieldError[] {
  return feldfehlerVon(error);
}
