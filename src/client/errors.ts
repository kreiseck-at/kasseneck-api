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
 * - `KasseneckApiError` — **fachlicher** Fehler. Das Backend antwortet immer
 *   mit HTTP 200 und legt Erfolg/Misserfolg in den Rumpf
 *   (`{status:'success'|'error', message, data}`, siehe `successResponse`/
 *   `errorResponse` im Backend). Ein `status:'error'` heisst: die Anfrage kam
 *   an und wurde abgelehnt (gesperrte Kasse, fehlendes Modul, ungueltiger
 *   Parameter). Wiederholen hilft nicht.
 * - `KasseneckHttpError` — die Antwort war **keine** verwertbare Huelle:
 *   HTTP 500/404, leerer Rumpf, oder HTTP 200 mit HTML statt JSON (typisch,
 *   wenn ein Aufruf mangels Rewrite auf der Single-Page-App landet). Beim
 *   Bericht-Download gelten dieselben Gruende fuer alles, was kein PDF ist.
 *   `reason` trennt die Faelle maschinenlesbar.
 * - `KasseneckNetworkError` — die Antwort kam gar nicht: Netz weg, DNS,
 *   abgebrochene Verbindung oder Zeitueberschreitung (`timedOut`).
 * - `KasseneckAuthError` — es kam nicht einmal zur Anfrage, weil die Anmeldung
 *   scheiterte (fehlende Zugangsdaten, oder der Token-/Sitzungsgeber warf).
 *   In der Browser-Kasse mit ihrer 90-Sekunden-Sitzung ist das Alltag, kein
 *   Sonderfall.
 *
 * **Geheimnisse gehoeren in keinen dieser Fehler.** Fehlermeldungen landen in
 * Protokollen und Fehlerdiensten; weder `api_key`, Kassen-Token, Firebase-
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
// durch, aber keinen Freitext und kein Firebase-ID-Token (~900 Zeichen).
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

/** Fachlicher Fehler: HTTP 200, aber `status: 'error'` im Rumpf. */
export class KasseneckApiError extends Error {
  readonly name = 'KasseneckApiError';
  /** Aufgerufene Backend-Funktion, z. B. `createReceipt`. */
  readonly functionName: string;
  /** Meldung des Backends, unveraendert (`message` aus der Huelle). */
  readonly serverMessage: string;

  constructor(functionName: string, serverMessage: string) {
    super(`${functionName} fehlgeschlagen: ${serverMessage}`);
    this.functionName = functionName;
    this.serverMessage = serverMessage;
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

/** Antwort ohne verwertbare Huelle (HTTP-Fehler, leerer Rumpf, HTML statt JSON). */
export class KasseneckHttpError extends Error {
  readonly name = 'KasseneckHttpError';
  readonly functionName: string;
  /** HTTP-Statuscode der Antwort (bei HTML-statt-JSON durchaus 200). */
  readonly statusCode: number;
  /** Inhaltstyp der Antwort, falls die Gegenstelle einen gesetzt hat. */
  readonly contentType: string | undefined;
  /** Maschinenlesbarer Grund — trennt den Rewrite-Fall vom 500er ohne Textparsen. */
  readonly reason: HttpFailureReason;

  constructor(functionName: string, statusCode: number, contentType: string | undefined, reason: HttpFailureReason) {
    const typHinweis = contentType ? `, Inhaltstyp ${contentType}` : '';
    super(`${functionName} fehlgeschlagen: ${GRUND_TEXT[reason]} (HTTP ${statusCode}${typHinweis})`);
    this.functionName = functionName;
    this.statusCode = statusCode;
    this.contentType = contentType;
    this.reason = reason;
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

  constructor(functionName: string, timedOut: boolean, timeoutMs: number, ursache: CauseDigest = {}) {
    const grund = timedOut ? `Zeitueberschreitung nach ${timeoutMs} ms` : 'Netzwerkfehler';
    const codeHinweis = ursache.causeCode ? ` (${ursache.causeCode})` : '';
    super(`${functionName} fehlgeschlagen: ${grund}${codeHinweis}`);
    this.functionName = functionName;
    this.timedOut = timedOut;
    this.timeoutMs = timeoutMs;
    this.causeName = ursache.causeName;
    this.causeCode = ursache.causeCode;
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

export function isKasseneckApiError(fehler: unknown): fehler is KasseneckApiError {
  return fehler instanceof KasseneckApiError;
}

export function isKasseneckHttpError(fehler: unknown): fehler is KasseneckHttpError {
  return fehler instanceof KasseneckHttpError;
}

export function isKasseneckNetworkError(fehler: unknown): fehler is KasseneckNetworkError {
  return fehler instanceof KasseneckNetworkError;
}

export function isKasseneckAuthError(fehler: unknown): fehler is KasseneckAuthError {
  return fehler instanceof KasseneckAuthError;
}

export function isKasseneckValidationError(fehler: unknown): fehler is KasseneckValidationError {
  return fehler instanceof KasseneckValidationError;
}
