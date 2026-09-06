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
  /**
   * Die Antwort des Terminals, die den Ausgang FESTGESCHRIEBEN hat -- nur
   * bei `approved` und `declined`. Bei `unresolved` fehlt sie: eine
   * Nicht-Aussage darf nicht als Beleg mitgegeben werden. Was das Terminal
   * zuletzt gesagt hat, steht dann in [lastResponse].
   */
  readonly response?: HpsTransactionResponse;
  /**
   * Die letzte Antwort des Terminals bei `unresolved`, sofern ueberhaupt
   * eine ankam -- auch wenn sie nichts entschied (9027, 9900, ein
   * unbekannter Code). NIE ein Beleg, sondern Material fuer Anzeige und
   * Katalog: am 02.09.2026 sah der Bediener bei einer Antwort `55`
   * "PIN falsch" nur "Ausgang unklar", musste raten und buchte eine
   * abgelehnte Zahlung als bezahlt. Der Klartext des Terminals haette die
   * Entscheidung getragen. Bei schluessigem Ausgang nicht gesetzt.
   */
  readonly lastResponse?: HpsTransactionResponse;
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
