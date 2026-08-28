import { TERMINAL_BUSY_HTTP_STATUS } from './transaction-response.js';

/**
 * Fehlerarten auf dem Weg ueber **Kasseneck Connect** zum hobex-HPS-Terminal.
 *
 * Drei Arten, bewusst getrennt, weil `payments.ts` auf jede anders reagiert —
 * das ist die wichtigste Unterscheidung in diesem ganzen Vorhaben:
 *
 * - [HpsPreflightError] — es ist NACHWEISLICH nichts gesendet worden. Entweder
 *   die Kennung selbst war unbrauchbar (siehe `connect-client.ts`), oder
 *   Connect hat die Anfrage VOR dem Terminal-Kontakt abgelehnt (falscher
 *   Host, keine Kopplung, ...). Wird von `payments.ts` unveraendert
 *   weitergeworfen, niemals in einen Ausgang uebersetzt — Zwilling von
 *   Dart's `ArgumentError`-Sonderfall in `HpsPayments.pay()`.
 * - [HpsConnectTerminalError] — die Anfrage GING RAUS (oder der Versuch dazu
 *   scheiterte am Transport), aber es kam keine schluessige Antwort. Das
 *   umfasst ausdruecklich auch [isTerminalBusy]: HTTP `409` ist die einzige
 *   dieser Lagen, die als [isTerminalBusy] eine POSITIVE Aussage traegt,
 *   siehe dort.
 * - [HpsConnectTransportError] — Connect selbst war nicht erreichbar oder
 *   antwortete nicht in der erwarteten Form (kein JSON, keine Huelle).
 *
 * Beide letzteren werden von `payments.ts` in die Klaerung (Abbruch + Polling)
 * geschickt, NIE in `declined` uebersetzt — mit der einen, gemessenen
 * Ausnahme [isTerminalBusy].
 */
export abstract class HpsConnectException extends Error {}

/**
 * Nichts ist gesendet worden. `reason` ist deutscher Klartext, `connectCode`
 * gesetzt, wenn die Ablehnung von Connect kam (statt von der lokalen
 * Kennungspruefung).
 */
export class HpsPreflightError extends HpsConnectException {
  override readonly name: string = 'HpsPreflightError';
  readonly connectCode: string | undefined;

  constructor(reason: string, connectCode?: string) {
    super(reason);
    this.connectCode = connectCode;
  }
}

/**
 * Die Transaktionskennung ist unbrauchbar (nicht rein numerisch, leer, oder
 * laenger als 18 Stellen) — geprueft BEVOR irgendetwas an Connect geht, wie
 * bei `HpsClient._checkTransactionId` im Dart-Zwilling.
 *
 * Eigene Klasse (statt nur [HpsPreflightError]) macht die Unterscheidung
 * `instanceof`-pruefbar, ohne sich auf einen Text zu verlassen.
 */
export class HpsTransactionIdError extends HpsPreflightError {
  override readonly name = 'HpsTransactionIdError';
  readonly value: string;

  constructor(value: string) {
    super(
      `Transaktionskennung "${value}" ist unbrauchbar -- HPS erlaubt 1 bis 18 `
        + 'Ziffern, rein numerisch',
    );
    this.value = value;
  }
}

/**
 * Bekannte Connect-Fehlercodes, die VOR jedem Terminal-Kontakt entstehen (aus
 * `kasseneck-connect/lib/src/api/{auth,responses,routes_terminal}.dart`):
 * Middleware (Herkunft, Token, Pfad, Rumpfgroesse) oder die Feldpruefung in
 * `_ziel`/`_handlePayment`/`_mitTransaktion` laufen alle, BEVOR die Bruecke
 * `HpsBridge` das Terminal ueberhaupt anspricht.
 *
 * Bewusst eine Positivliste: nur ein hier benannter Code gilt als "beweisbar
 * nichts gesendet". Ein Code, den diese Liste nicht kennt, wird in
 * `connect-client.ts` NICHT als [HpsPreflightError] gelesen, sondern als
 * [HpsConnectTerminalError] — die sichere Richtung, falls Connect einmal um
 * einen Fehlercode erweitert wird, der doch am Terminal entsteht.
 */
export const PREFLIGHT_CONNECT_CODES: ReadonlySet<string> = new Set([
  'bad_request',
  'unauthorized',
  'origin_forbidden',
  'not_found',
  'body_too_large',
]);

/**
 * Die Anfrage ging (oder der Versuch dazu) in Richtung Terminal, aber es kam
 * keine schluessige Antwort — Connect meldete `terminal_error`, `timeout`
 * oder `terminal_offline` (`kasseneck-connect/lib/src/terminal/hps.dart`),
 * oder einen Fehlercode, den dieses Paket nicht kennt.
 */
export class HpsConnectTerminalError extends HpsConnectException {
  override readonly name = 'HpsConnectTerminalError';
  /** Fehlercode von Connect, z. B. `terminal_error`, `timeout`, `terminal_offline`. */
  readonly connectCode: string;

  constructor(connectCode: string, message: string) {
    super(message);
    this.connectCode = connectCode;
  }

  /**
   * `true`, wenn dies der gemessene "Terminal beschaeftigt"-Fall ist: HTTP
   * `409`, gefaltet in Connects `terminal_error`-Meldung (`_call` in
   * `kasseneck-connect/lib/src/terminal/hps.dart` schreibt wortgleich
   * `'Terminal meldet (HTTP ${response.statusCode}): ...'`).
   *
   * **Bekannte Zerbrechlichkeit:** Connect exponiert den rohen HTTP-Status
   * NICHT als eigenes Feld, nur in diesem Text — "Kasseneck Connect nicht
   * anfassen" heisst, dieses Paket kann sich nicht gegen eine spaetere
   * Formulierungsaenderung dort absichern. Bricht das Muster, faellt diese
   * Erkennung auf `false` zurueck — die sichere Richtung: aus einem
   * `409` wuerde dann `unresolved` statt des beweisbaren `declined`, niemals
   * umgekehrt.
   */
  get isTerminalBusy(): boolean {
    return this.connectCode === 'terminal_error' && new RegExp(`\\(HTTP ${TERMINAL_BUSY_HTTP_STATUS}\\)`).test(this.message);
  }
}

/**
 * Connect selbst war nicht erreichbar, oder die Antwort hatte nicht die
 * erwartete Form (kein JSON, keine `{ok, ...}`-Huelle, unerwarteter
 * HTTP-Status ohne diese Huelle).
 */
export class HpsConnectTransportError extends HpsConnectException {
  override readonly name = 'HpsConnectTransportError';

  constructor(message: string) {
    super(message);
  }
}

/**
 * Das Klaerbudget ist aufgebraucht, WAEHREND ein einzelner Abruf (Abbruch
 * oder Statusabfrage) noch lief. Wird in `payments.ts` wie jeder andere
 * Transportfehler behandelt — siehe `withinBudget`.
 */
export class HpsClarifyTimeoutError extends HpsConnectException {
  override readonly name = 'HpsClarifyTimeoutError';

  constructor(budgetMs: number) {
    super(`Klaerbudget ueberschritten (${budgetMs} ms)`);
  }
}
