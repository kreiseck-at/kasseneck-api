/**
 * Ereignisse der Klaerung — Zwilling von `HpsEventKind`/`HpsObserver`
 * (`kasseneck_api/lib/src/hobex_hps/observer.dart`), hier nur fuer die
 * Klaerungsphase in `payments.ts` (kein eigenes Ereignis je HTTP-Aufruf an
 * Connect — die stehen bereits, mit Begruendung, in `HpsPaymentResult.steps`).
 */
export type HpsPaymentEventKind =
  /** Der Ausgang ist nach der direkten Antwort offen, die Klaerung laeuft. */
  | 'resolving'
  /** Der Ausgang steht fest. */
  | 'resolved'
  /** Ein Fehler beim Auswerten der Antwort, der KEIN erwarteter Connect-Fehler ist. */
  | 'unexpectedError';

/** Ein Ereignis der Klaerung. Bewusst schlank und ohne Kartendaten. */
export interface HpsPaymentEvent {
  readonly kind: HpsPaymentEventKind;
  readonly message: string;
  readonly transactionId: string;
  readonly error?: unknown;
}

/** Empfaenger der Ereignisse — die App legt ihn typischerweise auf ihr Protokoll. */
export type HpsPaymentObserver = (event: HpsPaymentEvent) => void;
