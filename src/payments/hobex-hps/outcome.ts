import { isHostUncertainReason, type HpsCodeReason, type HpsTransactionResponse } from './transaction-response.js';

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
   * Worauf die Kasse reagiert -- der Grund hinter dem Ausgang, mit dem Satz
   * fuer den Bediener in `HPS_REASON_HINTS`.
   *
   * Gesetzt an der Stelle, die den Ausgang entschieden hat, nicht aus
   * [response] abgeleitet: ein bestaetigter Abbruch antwortet `'0'` und ist
   * trotzdem `'aborted'`, und wenn die Zwei-9027-Regel eine Zahlung als
   * abgelehnt klaert, zaehlt der Code der ZAHLUNG, nicht das `9027` danach.
   * Fehlt, wenn kein Code etwas erklaert (die Leitung riss ab, bevor das
   * Terminal etwas sagte) und bei einer Aufhebung, die nicht gegriffen hat.
   */
  readonly reason?: HpsCodeReason;
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

/**
 * `true`, wenn der Ausgang offen ist, weil das Terminal eine Stoerung beim
 * oder nach dem hobex-Host meldete (`effect: 'hostUncertain'`). Wichtig fuer
 * jede SPAETERE Nachfrage: antwortet die Statusabfrage dann `9027`, heisst das
 * hier NICHT "nichts belastet".
 */
export function isHostUncertainResult(result: Pick<HpsPaymentResult, 'outcome' | 'reason'>): boolean {
  return result.outcome === 'unresolved' && isHostUncertainReason(result.reason);
}
