import type { HpsTransactionResponse } from './transaction-response.js';

/**
 * Ausgang eines Kartenzahlvorgangs — die einzige Frage, die ein Aufrufer
 * wirklich hat: darf ich es nochmal versuchen?
 *
 * Drei Werte, nicht zwei: ein `boolean` oder ein `null` als Ergebnis einer
 * Zahlung waere ein Fehler, kein Stil (Zwilling: `CardPaymentOutcome` in
 * `kasseneck_api/lib/src/payments/card_payment_outcome.dart`).
 */
export type CardPaymentOutcome = 'approved' | 'declined' | 'unresolved';

/**
 * Ergebnis einer Kartenzahlung samt Kennung und Klaerungsverlauf.
 *
 * [transactionId] ist IMMER gesetzt, auch bei `outcome: 'unresolved'` — ohne
 * sie sind Statusabfrage und weitere Klaerung unerreichbar, und genau daran
 * ist der Vorfall vom 24.08.2026 gescheitert.
 */
export interface HpsPaymentResult {
  readonly outcome: CardPaymentOutcome;
  readonly transactionId: string;
  /** Die letzte Antwort des Terminals, sofern eine schluessige ankam. */
  readonly response?: HpsTransactionResponse;
  /**
   * Verlauf der Klaerung, in Reihenfolge — der Nachweis, der im
   * Belastungsstreit gelesen wird. Behauptet nie eine Ursache, die nicht
   * feststeht.
   */
  readonly steps: readonly string[];
}

/** Nur bei `'declined'` steht fest, dass nichts belastet wurde. */
export function mayRetrySafely(result: Pick<HpsPaymentResult, 'outcome'>): boolean {
  return result.outcome === 'declined';
}
