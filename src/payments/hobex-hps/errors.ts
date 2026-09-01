import { NOT_FOUND_HTTP_STATUS, TERMINAL_BUSY_HTTP_STATUS } from './transaction-response.js';

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
  /**
   * Der rohe HTTP-Status des Terminals, wenn Connect einen genannt hat
   * (`error.detail.terminalHttpStatus`, seit `kasseneck-connect` Commit
   * `0fb6f66`, "fix(terminal): den rohen HTTP-Status des Terminals mitgeben").
   * `undefined` bei einem Transportfehler (Connect erfindet dort keinen) oder
   * bei einer aelteren Connect-Fassung, die das Feld noch nicht sendet.
   */
  readonly terminalHttpStatus: number | undefined;

  constructor(connectCode: string, message: string, terminalHttpStatus?: number) {
    super(message);
    this.connectCode = connectCode;
    this.terminalHttpStatus = terminalHttpStatus;
  }

  /**
   * `true`, wenn dies der gemessene "Terminal beschaeftigt"-Fall ist: das
   * Terminal hat mit HTTP `409` geantwortet.
   *
   * Liest bevorzugt [terminalHttpStatus] — das strukturierte Feld, das
   * Connect seit `0fb6f66` mitgibt. Nur wenn das Feld fehlt (aeltere
   * Connect-Fassung im Feld, die es noch nicht kennt), faellt die Pruefung
   * auf den Meldungstext zurueck (`_call` in
   * `kasseneck-connect/lib/src/terminal/hps.dart` schrieb schon vor `0fb6f66`
   * wortgleich `'Terminal meldet (HTTP ${response.statusCode}): ...'`).
   *
   * **Der Rueckfall ist eine Uebergangsloesung, kein Dauerzustand.** Sobald
   * jede Kasse im Feld gegen einen Connect-Agenten mit `terminalHttpStatus`
   * spricht, kann der Textabgleich entfallen — bis dahin bleibt er die
   * einzige Absicherung fuer eine Installation, die noch nicht aktualisiert
   * hat. Bricht auch das Textmuster (Formulierungsaenderung in Connect),
   * faellt diese Erkennung auf `false` zurueck — die sichere Richtung: aus
   * einem `409` wuerde dann `unresolved` statt des beweisbaren `declined`,
   * niemals umgekehrt.
   */
  get isTerminalBusy(): boolean {
    if (this.terminalHttpStatus !== undefined) {
      return this.terminalHttpStatus === TERMINAL_BUSY_HTTP_STATUS;
    }
    return this.connectCode === 'terminal_error' && new RegExp(`\\(HTTP ${TERMINAL_BUSY_HTTP_STATUS}\\)`).test(this.message);
  }

  /**
   * `true`, wenn dies ein HTTP `404` beim Terminal-Kontakt ist -- Lesart
   * ungemessen, siehe `transaction-response.ts` (`NOT_FOUND_HTTP_STATUS`) und
   * den Dart-Zwilling (`HpsHttpException.isNotFound`): es kann "diesen
   * Vorgang kenne ich nicht" heissen oder "diesen Endpunkt gibt es hier
   * nicht". `payments.ts` benennt beim Abbruch beide Lesarten, statt eine zu
   * behaupten.
   *
   * Liest, wie [isTerminalBusy], bevorzugt [terminalHttpStatus] und faellt
   * nur ohne dieses Feld auf den Meldungstext zurueck.
   */
  get isNotFound(): boolean {
    if (this.terminalHttpStatus !== undefined) {
      return this.terminalHttpStatus === NOT_FOUND_HTTP_STATUS;
    }
    return this.connectCode === 'terminal_error' && new RegExp(`\\(HTTP ${NOT_FOUND_HTTP_STATUS}\\)`).test(this.message);
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
