/**
 * Die fuenf Fehlerarten des Kasseneck-Clients — bewusst getrennt, weil ein
 * Aufrufer auf jede anders reagieren muss:
 *
 * - `KasseneckValidationError` — die **Form** stimmt nicht: entweder ging
 *   mangels brauchbarer Eingabe gar keine Anfrage raus, oder die Antwort war
 *   nicht verwertbar. `scope` trennt die beiden Richtungen. `'request'`: die
 *   Eingabe des Aufrufers verletzt eine Regel, die dieses Paket schon vor dem
 *   Senden kennt (Beleg ohne Positionen, unmoegliche Gutscheinkombination) —
 *   das ist ein Programmierfehler im Aufrufer, kein Betriebszustand.
 *   `'response'`: das Backend meldete Erfolg, die Nutzlast enthielt aber
 *   nicht, was der Aufruf zusagt.
 *
 * - `KasseneckApiError`: **fachlicher** Fehler mit `code`. Das Backend legt
 *   Erfolg/Misserfolg in den Rumpf (`{status:'success'|'error', message,
 *   code, data}`, siehe `successResponse`/`errorResponse` im Backend), meist
 *   unter HTTP 200, unter `/v3` bei unbekanntem Endpunkt auch unter HTTP 404
 *   (`not_found`). Dazu kommen drei Codes des Pakets selbst:
 *   `route_missing` (HTTP 200 mit HTML: die Auffangregel der
 *   Single-Page-App hat geantwortet, der Aufruf kam nie an),
 *   `dialect_mismatch` (Antwort ohne Kennzeichen `Kasseneck-Api-Version: v3`:
 *   ein Rand ohne `/v3` hat geantwortet, **Ausgang unklar**) und
 *   `response_unreadable` (ein Aufruf mit Wirkung meldete Erfolg, die
 *   Antwort traegt aber nicht, was er zusagt: **Ausgang unklar**).
 *   **Entscheidend ist `outcome`:** `'rejected'` heisst abgelehnt, nichts
 *   geschehen, Wiederholen hilft nicht. `'unknown'` heisst: der Vorgang kann
 *   ausgefuehrt sein (bei `createReceipt` ein signierter Beleg). Dann **nie
 *   wiederholen**, sondern das Ergebnis nachlesen (Belegliste, `getReceipt`).
 * - `KasseneckHttpError` — die Antwort war **keine** verwertbare Huelle:
 *   HTTP 500/404 ohne Huelle, leerer Rumpf oder Text statt JSON. Beim
 *   Bericht-Download gelten dieselben Gruende fuer alles, was kein PDF ist.
 *   `reason` trennt die Faelle maschinenlesbar. Auf einem Aufruf mit
 *   Wirkung (signierend oder geldbewegend) hat HTTP 5xx
 *   `outcome: 'unknown'`, ebenso HTTP 200 mit Kennzeichen, aber leerem oder
 *   unlesbarem Rumpf.
 * - `KasseneckNetworkError` — die Antwort kam gar nicht: Netz weg, DNS,
 *   abgebrochene Verbindung oder Zeitueberschreitung (`timedOut`). Auch hier
 *   gilt `outcome`: war die Anfrage schon unterwegs und ist der Aufruf einer
 *   mit Wirkung (signierend: `createReceipt`, `cancelReceipt`,
 *   `financeWebService`; geldbewegend: `hobexPayApi`, `hobexRefundApi`,
 *   `stripeCaptureIntent`), ist er `'unknown'`.
 * - `KasseneckAuthError` — es kam nicht einmal zur Anfrage, weil die Anmeldung
 *   scheiterte (fehlende Zugangsdaten, oder der Token-/Sitzungsgeber warf).
 *   In der Browser-Kasse mit ihrer 90-Sekunden-Sitzung ist das Alltag, kein
 *   Sonderfall.
 *
 * [isOutcomeUnknown] fasst das fuer jede Fehlerart zusammen.
 *
 * **Geheimnisse gehoeren in keinen dieser Fehler.** Fehlermeldungen landen in
 * Protokollen und Fehlerdiensten; weder `api_key`, Kassen-Token, ID-
 * ID-Token noch Sitzungsbezeichner duerfen dorthin. Deshalb tragen die Fehler
 * ausschliesslich Funktionsname, HTTP-Status/Inhaltstyp, den vom Paket
 * formulierten Grund und die vom Backend formulierte Meldung — nie Kopfzeilen,
 * nie den gesendeten Rumpf und auch nicht den empfangenen Rumpf (der koennte
 * bei einem fremden Proxy alles Moegliche zurueckspiegeln).
 *
 * Aus demselben Grund haengt **keine fremde Ursache** als `cause` an diesen
 * Fehlern: `console.error(err)` und `util.inspect` drucken die Ursachenkette
 * mit, und fremde HTTP-Bibliotheken haengen ihre Anfrage an ihre Fehler (axios
 * `config.headers`, got `options.headers`) — mit dem Bearer-Schluessel darin.
 * Statt der Ursache selbst traegt `KasseneckNetworkError` ihre **verdichtete**
 * Form: `causeName`/`causeCode`, beide nur, wenn sie wie ein Bezeichner
 * aussehen **und** mit keinem der gesendeten Geheimnisse ueberlappen (siehe
 * `causeDigest`).
 *
 * Der Formfilter allein traegt diese Zusage naemlich nicht: der
 * Sitzungsbezeichner der Browser-Kasse ist selbst bezeichner-foermig und kaeme
 * durch. Verdichtet werden darf nur, wo die gesendeten Geheimnisse bekannt
 * sind — also nach dem Bauen der Anfrage. `KasseneckAuthError` traegt darum
 * **gar keine** Ursachen-Verdichtung: dort ist noch nichts gesendet, es gibt
 * keine Liste zum Abgleichen, und Diagnose ist an dieser Stelle weniger wert
 * als die Zusage.
 */

/** Verdichtete, geheimnisfreie Form einer fremden Fehlerursache. */
export interface CauseDigest {
  causeName?: string | undefined;
  causeCode?: string | undefined;
}

// Bezeichner-artig: Buchstabe vorn, danach nur Bezeichnerzeichen, hoechstens
// 64 Zeichen. Das laesst `TypeError`, `ECONNREFUSED` und `auth/internal-error`
// durch, aber keinen Freitext und kein ID-Token (~900 Zeichen).
const BEZEICHNER = /^[A-Za-z][A-Za-z0-9_./-]{0,63}$/;

/**
 * Reduziert eine fremde Ursache auf Name und Code — und verwirft beides, wenn
 * es kein Bezeichner ist oder mit einem der uebergebenen Geheimnisse
 * ueberlappt (ein Sitzungsbezeichner sieht durchaus bezeichner-artig aus).
 *
 * `geheimnisse` hat bewusst **keinen** Vorgabewert: eine Verdichtung ohne
 * Abgleichliste waere nur ein Formfilter und damit keine Zusage. Wo die
 * gesendeten Werte nicht bekannt sind, wird gar nicht verdichtet.
 */
export function causeDigest(ursache: unknown, geheimnisse: readonly string[]): CauseDigest {
  const roh = ursache as { name?: unknown; code?: unknown } | null | undefined;
  return {
    causeName: unbedenklich(roh?.name, geheimnisse),
    causeCode: unbedenklich(roh?.code, geheimnisse),
  };
}

function unbedenklich(wert: unknown, geheimnisse: readonly string[]): string | undefined {
  if (typeof wert !== 'string' || !BEZEICHNER.test(wert)) {
    return undefined;
  }
  for (const geheim of geheimnisse) {
    if (geheim && (geheim.includes(wert) || wert.includes(geheim))) {
      return undefined;
    }
  }
  return wert;
}

/**
 * Grenzen fuer die gesiebte Fehler-Nutzlast (siehe [fehlerDetails]). Sie stehen
 * als benannte Konstanten hier, weil ein Test sie namentlich prueft — eine
 * spaeter heraufgesetzte Grenze soll auffallen und nicht als Zahl im Code
 * untergehen.
 */
const DETAIL_TIEFE = 4;
const DETAIL_EINTRAEGE = 50;
const DETAIL_TEXT_MAX = 300;
/** Schluessel eines Detail-Objekts: bezeichner-foermig, sonst faellt der Eintrag weg. */
const DETAIL_SCHLUESSEL = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/**
 * Siebt das `data` einer Fehlerantwort zu einer Form, die man gefahrlos an
 * einem Fehler mitfuehren kann.
 *
 * **Warum ueberhaupt:** die Partner-API legt ihre Entscheidung nicht in den
 * Text, sondern in `data.code` (`vertrag_offen`, `signature_not_ready`,
 * `activation_failed` samt `data.schritt`). Ohne diese Felder muesste ein
 * Aufrufer die deutsche `message` nach Zeichenketten durchsuchen — genau die
 * Kopplung, die beim naechsten Formulierungsschliff still bricht.
 *
 * **Warum gesiebt und nicht durchgereicht:** siehe Modulkommentar. Der Rumpf
 * kommt ueber fremde Proxys, und ein Fehler landet in Protokollen. Deshalb
 * ueberlebt nur, was flach, klein und bezeichner-foermig benannt ist — und
 * kein Wert, der mit einem der gesendeten Geheimnisse ueberlappt. Damit gilt
 * hier dieselbe Zusage wie fuer [causeDigest], und `geheimnisse` hat aus
 * demselben Grund **keinen** Vorgabewert.
 */
export function fehlerDetails(daten: unknown, geheimnisse: readonly string[]): Record<string, unknown> {
  const gesiebt = sieben(daten, geheimnisse, 0);
  return gesiebt !== null && typeof gesiebt === 'object' && !Array.isArray(gesiebt)
    ? (gesiebt as Record<string, unknown>)
    : {};
}

function sieben(wert: unknown, geheimnisse: readonly string[], tiefe: number): unknown {
  if (wert === null || typeof wert === 'boolean') return wert;
  // Nur endliche Zahlen: NaN und Infinity ueberstehen JSON.stringify nicht und
  // staenden in einem Fehlerbericht als `null` ohne jede Aussage.
  if (typeof wert === 'number') return Number.isFinite(wert) ? wert : undefined;
  if (typeof wert === 'string') {
    if (wert.length > DETAIL_TEXT_MAX) return undefined;
    for (const geheim of geheimnisse) {
      if (geheim && (geheim.includes(wert) || wert.includes(geheim))) return undefined;
    }
    return wert;
  }
  if (tiefe >= DETAIL_TIEFE) return undefined;
  if (Array.isArray(wert)) {
    const liste: unknown[] = [];
    for (const eintrag of wert.slice(0, DETAIL_EINTRAEGE)) {
      const s = sieben(eintrag, geheimnisse, tiefe + 1);
      if (s !== undefined) liste.push(s);
    }
    return liste;
  }
  if (typeof wert !== 'object') return undefined;
  const raus: Record<string, unknown> = {};
  let gezaehlt = 0;
  for (const [schluessel, eintrag] of Object.entries(wert as Record<string, unknown>)) {
    if (gezaehlt >= DETAIL_EINTRAEGE) break;
    if (!DETAIL_SCHLUESSEL.test(schluessel)) continue;
    const s = sieben(eintrag, geheimnisse, tiefe + 1);
    if (s === undefined) continue;
    raus[schluessel] = s;
    gezaehlt += 1;
  }
  return raus;
}

/** Fachlicher Fehler: HTTP 200, aber `status: 'error'` im Rumpf. */
/**
 * Die Feldfehler einer Pruefantwort (`errors: [{ field, message }]`) als
 * Anhang der Fehlermeldung — sonst stuende im Log nur „Bitte Eingaben
 * pruefen." und niemand wuesste, welches Feld gemeint ist. Hoechstens fuenf;
 * vollstaendig bleiben sie in `details.errors`.
 */
function feldHinweis(details: Record<string, unknown>): string {
  const roh = details['errors'];
  if (!Array.isArray(roh)) return '';
  const teile: string[] = [];
  for (const e of roh) {
    if (e === null || typeof e !== 'object') continue;
    const { field, message } = e as { field?: unknown; message?: unknown };
    if (typeof field === 'string' && typeof message === 'string') teile.push(`${field}: ${message}`);
  }
  if (!teile.length) return '';
  const mehr = teile.length > 5 ? ` (+${teile.length - 5} weitere)` : '';
  return ` [${teile.slice(0, 5).join('; ')}${mehr}]`;
}

/**
 * Ausgang eines gescheiterten Aufrufs. `'rejected'`: nichts geschehen.
 * `'unknown'`: der Vorgang kann ausgefuehrt sein; nie wiederholen, sondern
 * das Ergebnis nachlesen.
 */
export type ErrorOutcome = 'unknown' | 'rejected';

/**
 * Codes, deren Ausgang unklar ist. `response_translation_failed` nur, wenn
 * der Rand nicht ausdruecklich `handled: false` meldet (Handler lief und
 * lehnte ab); `handled: true` oder `null` heisst ausgefuehrt bzw. unbekannt.
 */
const AUSGANG_UNKLAR_CODES: ReadonlySet<string> = new Set([
  'dialect_mismatch',
  'receipt_outcome_unknown',
  'cancellation_outcome_unknown',
  'response_unreadable',
]);

/**
 * Aufrufe, die Geld bewegen: `hobexPayApi` belastet eine Karte,
 * `hobexRefundApi` erstattet, `stripeCaptureIntent` zieht eine vorgemerkte
 * Zahlung ein. Ihre Handler antworten auch NACH dem Anbieteraufruf mit einer
 * Fehlerhuelle ohne Code ("Error hobex details", "Fehler beim Capturing");
 * dort gilt darum umgekehrt: Ausgang unklar, ausser der Code belegt, dass der
 * Anbieter nie gerufen wurde.
 */
const GELDWEGE: ReadonlySet<string> = new Set(['hobexPayApi', 'hobexRefundApi', 'stripeCaptureIntent']);

/**
 * Codes, die auf einem Geldweg `outcome: 'rejected'` ergeben; jeder andere
 * Code und eine Huelle ohne Code sind dort `'unknown'`. Aufgenommen ist nur,
 * was entsteht, bevor das Backend den Zahlungsanbieter anspricht (Vertrag
 * v3, `errorCodes`; dieselbe Liste wie `paymentCallRejectedCodes` im
 * Dart-Zwilling):
 *
 * - `errorCodes.auth` ohne die sieben des Partner-Zugangs (18 Codes):
 *   Anmeldung und Pruefung in `checkRequest` laufen vor jeder Zeile des
 *   Handlers; `validation` heisst dort Pflichtfeld fehlt oder falscher Typ.
 *   Der Partner-Zugang trifft diese `api_key`-Aufrufe mit Kassen-Token nie.
 * - aus `errorCodes.edge`: `not_found` (unbekannter Endpunkt, HTTP 404) und
 *   `internal_translation_error` (die Anfrage liess sich nicht uebersetzen,
 *   es wurde nichts ausgefuehrt); `validation` des Rands (unbekannte Felder,
 *   Rumpf ohne Objekt) steht schon oben.
 * - `module_inactive` und `not_permitted`: das Modul- bzw. Rechte-Tor steht
 *   ebenfalls vor dem Anbieter.
 * - `route_missing` (vergibt das Paket): HTML ohne `/v3`-Kennzeichen, keine
 *   Function hat den Aufruf gesehen.
 *
 * Nicht darin: `dialect_mismatch` (das Paket vergibt ihn auch, wenn ein Rand
 * ohne `/v3` geantwortet hat, dessen Handler gelaufen sein kann) und
 * `response_translation_failed` (der Handler lief; auch `handled: false`
 * heisst nur, dass seine Antwort ein Fehler war, und der kann hinter dem
 * Anbieteraufruf entstanden sein). Der Sammelfang der Handler ("Error hobex
 * details", "Fehler beim Capturing") antwortet ohne Code.
 */
export const PAYMENT_CALL_REJECTED_CODES: readonly string[] = Object.freeze([
  // errorCodes.auth ohne Partner-Zugang
  'method_not_allowed',
  'validation',
  'cashregister_token_missing',
  'cashregister_token_invalid',
  'cashregister_not_found',
  'account_not_found',
  'live_not_enabled',
  'api_not_approved',   // Live-API ohne Freigabe (Entwicklerbereich): vor dem Handler abgewiesen
  'unauthorized',
  'mfa_required',
  'user_verification_failed',
  'admin_required',
  'register_user_not_allowed',
  'register_user_no_business',
  'register_user_not_found',
  'user_disabled',
  'session_expired',
  'cashregister_not_assigned',
  'session_other_cashregister',
  // errorCodes.edge vor dem Handler (validation steht oben)
  'not_found',
  'internal_translation_error',
  // Modul- und Rechte-Tor
  'module_inactive',
  'not_permitted',
  // vom Paket vergeben
  'route_missing',
]);
const GELDWEG_ABGELEHNT: ReadonlySet<string> = new Set(PAYMENT_CALL_REJECTED_CODES);

function ausgangAusCode(
  functionName: string,
  code: string | undefined,
  details: Record<string, unknown>,
): ErrorOutcome {
  // `functionName` kann den Vorgang tragen (`financeWebService/<method>`).
  if (GELDWEGE.has(functionName.split('/')[0]!)) {
    return code !== undefined && GELDWEG_ABGELEHNT.has(code) ? 'rejected' : 'unknown';
  }
  if (code === undefined) return 'rejected';
  if (AUSGANG_UNKLAR_CODES.has(code)) return 'unknown';
  if (code === 'response_translation_failed' && details['handled'] !== false) return 'unknown';
  return 'rejected';
}

/**
 * Codes, die das Paket selbst vergibt, nicht der Server: `route_missing`
 * (HTML statt Backend, der Aufruf kam nie an) und `response_unreadable`
 * (ein Aufruf mit Wirkung meldete Erfolg, die Antwort ist aber unlesbar;
 * Ausgang unklar). `dialect_mismatch` vergibt das Paket ebenfalls, der Code
 * gehoert aber schon zum Rand des Servers (`errorCodes.edge`).
 */
export const CLIENT_ERROR_CODES = Object.freeze(['route_missing', 'response_unreadable'] as const);
export type ClientErrorCode = (typeof CLIENT_ERROR_CODES)[number];

export class KasseneckApiError extends Error {
  readonly name = 'KasseneckApiError';
  /** Aufgerufene Backend-Funktion, z. B. `createReceipt`. */
  readonly functionName: string;
  /** Meldung des Backends, unveraendert (`message` aus der Huelle). */
  readonly serverMessage: string;
  /**
   * Stabiler, maschinenlesbarer Fehlercode des Backends, wenn der Endpunkt
   * einen legt. Zwei Ablageorte kommen vor und beide zaehlen: das Feld `code`
   * neben `message` (cancelReceipt, siehe CANCELLATION_ERROR_CODES) und
   * `data.code` (Partner-API: `vertrag_offen`, `rate_limited`, …). Nur
   * Bezeichner gelten — ein Freitext waere kein Code. Die aelteren Endpunkte
   * antworten ohne Code — dann `undefined`. **Daran entscheiden, nie an
   * [serverMessage]:** der Text darf sich aendern, der Code nicht.
   */
  readonly code: string | undefined;
  /**
   * Die uebrige Fehler-Nutzlast, gesiebt (siehe [fehlerDetails]): `schritt`,
   * `rc`, `retryAfterSec`, `errors[]` und was der jeweilige Endpunkt sonst
   * beilegt. Immer ein Objekt, notfalls ein leeres.
   */
  readonly details: Record<string, unknown>;
  /**
   * `'unknown'` bei `dialect_mismatch`, `receipt_outcome_unknown`,
   * `cancellation_outcome_unknown`, `response_unreadable` (Erfolg gemeldet,
   * Antwort eines Aufrufs mit Wirkung aber unlesbar) und
   * `response_translation_failed` (ausser mit `details.handled === false`);
   * sonst `'rejected'`. Auf den Geldwegen (`hobexPayApi`, `hobexRefundApi`,
   * `stripeCaptureIntent`) umgekehrt: `'rejected'` nur mit einem Code aus
   * [PAYMENT_CALL_REJECTED_CODES], ohne Code und mit jedem anderen Code
   * `'unknown'`. Bei `'unknown'` nie wiederholen, sondern nachlesen.
   */
  readonly outcome: ErrorOutcome;

  constructor(functionName: string, serverMessage: string, details: Record<string, unknown> = {}, code?: string) {
    super(`${functionName} fehlgeschlagen: ${serverMessage}${feldHinweis(details)}`);
    this.functionName = functionName;
    this.serverMessage = serverMessage;
    this.details = details;
    // Der Code neben `message` hat Vorrang; fehlt er, gilt `data.code` aus
    // den Details. So bleibt die Klasse fuer beide Ablageorte dieselbe.
    const kandidat = code !== undefined ? code : details['code'];
    this.code = typeof kandidat === 'string' && BEZEICHNER.test(kandidat) ? kandidat : undefined;
    this.outcome = ausgangAusCode(functionName, this.code, details);
  }
}

/** Warum die Antwort keine verwertbare Huelle war. */
export type HttpFailureReason = 'server-error' | 'empty-body' | 'not-json' | 'missing-status';

const GRUND_TEXT: Record<HttpFailureReason, string> = {
  'server-error': 'Server-Fehler',
  'empty-body': 'leere Antwort',
  'not-json': 'Antwort ist kein JSON',
  'missing-status': 'Antwort ohne Statusfeld',
};

/** Antwort ohne verwertbare Huelle (HTTP-Fehler ohne Huelle, leerer Rumpf, Text statt JSON). */
export class KasseneckHttpError extends Error {
  readonly name = 'KasseneckHttpError';
  readonly functionName: string;
  /** HTTP-Statuscode der Antwort (bei Text statt JSON durchaus 200). */
  readonly statusCode: number;
  /** Inhaltstyp der Antwort, falls die Gegenstelle einen gesetzt hat. */
  readonly contentType: string | undefined;
  /** Maschinenlesbarer Grund — trennt den Rewrite-Fall vom 500er ohne Textparsen. */
  readonly reason: HttpFailureReason;
  /**
   * `'unknown'` auf einem Aufruf mit Wirkung (`createReceipt`,
   * `cancelReceipt`, `financeWebService`, `hobexPayApi`, `hobexRefundApi`,
   * `stripeCaptureIntent`) bei HTTP 5xx und bei HTTP 200 mit
   * Kennzeichen, aber unlesbarem Rumpf (`empty-body`, `not-json` auch bei
   * `text/html`, `missing-status`): der Handler kann gelaufen sein, nie wiederholen,
   * sondern nachlesen. Sonst `'rejected'` (auch 4xx).
   */
  readonly outcome: ErrorOutcome;

  constructor(
    functionName: string,
    statusCode: number,
    contentType: string | undefined,
    reason: HttpFailureReason,
    outcome: ErrorOutcome = 'rejected',
  ) {
    const typHinweis = contentType ? `, Inhaltstyp ${contentType}` : '';
    super(`${functionName} fehlgeschlagen: ${GRUND_TEXT[reason]} (HTTP ${statusCode}${typHinweis})`);
    this.functionName = functionName;
    this.statusCode = statusCode;
    this.contentType = contentType;
    this.reason = reason;
    this.outcome = outcome;
  }
}

/** Es kam keine Antwort: Netzfehler oder Zeitueberschreitung. */
export class KasseneckNetworkError extends Error {
  readonly name = 'KasseneckNetworkError';
  readonly functionName: string;
  /** true = das Zeitlimit lief ab und die Anfrage wurde abgebrochen. */
  readonly timedOut: boolean;
  /** Das geltende Zeitlimit in Millisekunden. */
  readonly timeoutMs: number;
  /** Name der zugrunde liegenden Ursache, sofern unbedenklich (s. `causeDigest`). */
  readonly causeName: string | undefined;
  /** Code der zugrunde liegenden Ursache, sofern unbedenklich (z. B. `ECONNREFUSED`). */
  readonly causeCode: string | undefined;
  /**
   * `'unknown'`, wenn die Anfrage schon unterwegs war und der Aufruf signiert
   * (`createReceipt`, `cancelReceipt`, `financeWebService`): dann nie
   * wiederholen, sondern nachlesen. Sonst `'rejected'`.
   */
  readonly outcome: ErrorOutcome;

  constructor(
    functionName: string,
    timedOut: boolean,
    timeoutMs: number,
    cause: CauseDigest = {},
    outcome: ErrorOutcome = 'rejected',
  ) {
    const grund = timedOut ? `Zeitueberschreitung nach ${timeoutMs} ms` : 'Netzwerkfehler';
    const codeHinweis = cause.causeCode ? ` (${cause.causeCode})` : '';
    super(`${functionName} fehlgeschlagen: ${grund}${codeHinweis}`);
    this.functionName = functionName;
    this.timedOut = timedOut;
    this.timeoutMs = timeoutMs;
    this.causeName = cause.causeName;
    this.causeCode = cause.causeCode;
    this.outcome = outcome;
  }
}

/**
 * Die Anmeldung scheiterte — es ging keine Anfrage raus.
 *
 * Dieser Fehler traegt **nichts** aus der fremden Ursache: weder ihre Meldung
 * (ein Token-Geber fuehrt gern den Token mit, den er gerade nicht erneuern
 * konnte) noch eine Verdichtung ihres Namens/Codes. Zum Zeitpunkt des
 * Anmeldefehlers ist noch nichts gesendet, es gibt also keine Liste der
 * Geheimnisse, gegen die verdichtete Werte geprueft werden koennten — und ein
 * reiner Formfilter laesst genau die Form durch, die ein Sitzungsbezeichner
 * hat.
 */
export class KasseneckAuthError extends Error {
  readonly name = 'KasseneckAuthError';
  /** Betroffene Backend-Funktion, falls der Fehler bei einem Aufruf entstand. */
  readonly functionName: string | undefined;
  /** Vom Paket formulierter Grund — geheimnisfrei, anders als fremde Meldungen. */
  readonly reason: string;

  constructor(reason: string, options: { functionName?: string } = {}) {
    super(options.functionName ? `${options.functionName} fehlgeschlagen: ${reason}` : reason);
    this.functionName = options.functionName;
    this.reason = reason;
  }
}

/** Woran die Form haengt: an der Eingabe des Aufrufers oder an der Antwort. */
export type ValidationScope = 'request' | 'response';

/**
 * Die Form stimmt nicht — bei `scope: 'request'` ging deshalb keine Anfrage
 * raus, bei `scope: 'response'` kam eine unbrauchbare zurueck.
 *
 * Es gilt dieselbe Zusage wie fuer die uebrigen Fehlerarten: `reason` ist vom
 * Paket formuliert und geheimnisfrei. Bei `'response'` wird insbesondere
 * **nichts aus der Antwort** uebernommen — ein fremder Proxy koennte dort
 * alles Moegliche zurueckspiegeln.
 */
export class KasseneckValidationError extends Error {
  readonly name = 'KasseneckValidationError';
  /**
   * Betroffener Vorgang — meist die Backend-Funktion, bei Pruefungen ohne
   * Aufruf der Name der Paketfunktion (z. B. `buildReceiptLayout`).
   */
  readonly functionName: string;
  /** Vom Paket formulierter Grund. */
  readonly reason: string;
  readonly scope: ValidationScope;

  constructor(functionName: string, reason: string, scope: ValidationScope) {
    super(`${functionName} fehlgeschlagen: ${reason}`);
    this.functionName = functionName;
    this.reason = reason;
    this.scope = scope;
  }
}

/** Alle Fehler, die dieses Paket wirft. */
export type KasseneckError =
  | KasseneckApiError
  | KasseneckHttpError
  | KasseneckNetworkError
  | KasseneckAuthError
  | KasseneckValidationError;

/**
 * Ist der Ausgang dieses Fehlers unklar (`outcome === 'unknown'`)? Dann den
 * Aufruf **nicht wiederholen**, sondern das Ergebnis nachlesen. Gilt fuer
 * jede Fehlerart; nur [KasseneckApiError], [KasseneckHttpError] und
 * [KasseneckNetworkError] koennen `'unknown'` sein.
 */
export function isOutcomeUnknown(error: unknown): boolean {
  return (
    (error instanceof KasseneckApiError || error instanceof KasseneckHttpError || error instanceof KasseneckNetworkError)
    && error.outcome === 'unknown'
  );
}

export function isKasseneckApiError(error: unknown): error is KasseneckApiError {
  return error instanceof KasseneckApiError;
}

export function isKasseneckHttpError(error: unknown): error is KasseneckHttpError {
  return error instanceof KasseneckHttpError;
}

export function isKasseneckNetworkError(error: unknown): error is KasseneckNetworkError {
  return error instanceof KasseneckNetworkError;
}

export function isKasseneckAuthError(error: unknown): error is KasseneckAuthError {
  return error instanceof KasseneckAuthError;
}

export function isKasseneckValidationError(error: unknown): error is KasseneckValidationError {
  return error instanceof KasseneckValidationError;
}

/**
 * Liest die Erfolgsantwort eines Aufrufs **mit Wirkung** (signierend oder
 * geldbewegend). Scheitert das Lesen (fehlender Beleg, fehlender Bezug,
 * unbrauchbares Feld oder ein Laufzeitfehler beim Umwandeln), hat der Server
 * trotzdem Erfolg gemeldet: der Beleg ist signiert und im DEP, die Karte
 * belastet bzw. der Einzug gelaufen. Das darf nie als gewoehnlicher Fehler
 * enden, sonst kassiert die Kasse ein zweites Mal. Darum wird daraus
 * `KasseneckApiError` mit Code `response_unreadable` und `outcome: 'unknown'`.
 * Der Grund stammt vom Paket; aus der Antwort selbst wird nichts uebernommen.
 *
 * Paketintern (receipts.ts, payments/); nicht Teil der Paketoberflaeche.
 */
export function signiertGelesen<T>(functionName: string, lesen: () => T): T {
  try {
    return lesen();
  } catch (ursache) {
    const grund = ursache instanceof KasseneckValidationError ? ursache.reason : 'Antwort nicht lesbar';
    throw new KasseneckApiError(
      functionName,
      `Erfolg gemeldet, Antwort aber unlesbar (${grund}). Der Vorgang kann ausgefuehrt sein: nicht wiederholen, sondern nachlesen.`,
      {},
      'response_unreadable',
    );
  }
}
