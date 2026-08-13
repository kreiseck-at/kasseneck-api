/**
 * Die drei Fehlerarten des Kasseneck-Clients — bewusst getrennt, weil ein
 * Aufrufer auf jede anders reagieren muss:
 *
 * - `KasseneckApiError` — **fachlicher** Fehler. Das Backend antwortet immer
 *   mit HTTP 200 und legt Erfolg/Misserfolg in den Rumpf
 *   (`{status:'success'|'error', message, data}`, siehe `successResponse`/
 *   `errorResponse` im Backend). Ein `status:'error'` heisst: die Anfrage kam
 *   an und wurde abgelehnt (gesperrte Kasse, fehlendes Modul, ungueltiger
 *   Parameter). Wiederholen hilft nicht.
 * - `KasseneckHttpError` — die Antwort war **keine** verwertbare Huelle:
 *   HTTP 500/404, leerer Rumpf, oder HTTP 200 mit HTML statt JSON (typisch,
 *   wenn ein Aufruf mangels Rewrite auf der Single-Page-App landet).
 * - `KasseneckNetworkError` — die Antwort kam gar nicht: Netz weg, DNS,
 *   abgebrochene Verbindung oder Zeitueberschreitung (`timedOut`).
 *
 * **Geheimnisse gehoeren in keine dieser Meldungen.** Fehlermeldungen landen in
 * Protokollen und Fehlerdiensten; weder `api_key`, Kassen-Token, Firebase-
 * ID-Token noch Sitzungsbezeichner duerfen dorthin. Deshalb tragen die Fehler
 * ausschliesslich Funktionsname, HTTP-Status/Inhaltstyp und die vom Backend
 * formulierte Meldung — nie Kopfzeilen, nie den gesendeten Rumpf und auch
 * nicht den empfangenen Rumpf (der koennte bei einem fremden Proxy alles
 * Moegliche zurueckspiegeln).
 */

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

/** Antwort ohne verwertbare Huelle (HTTP-Fehler, leerer Rumpf, HTML statt JSON). */
export class KasseneckHttpError extends Error {
  readonly name = 'KasseneckHttpError';
  readonly functionName: string;
  /** HTTP-Statuscode der Antwort (bei HTML-statt-JSON durchaus 200). */
  readonly statusCode: number;
  /** Inhaltstyp der Antwort, falls die Gegenstelle einen gesetzt hat. */
  readonly contentType: string | undefined;

  constructor(functionName: string, statusCode: number, contentType: string | undefined, grund: string) {
    const typHinweis = contentType ? `, Inhaltstyp ${contentType}` : '';
    super(`${functionName} fehlgeschlagen: ${grund} (HTTP ${statusCode}${typHinweis})`);
    this.functionName = functionName;
    this.statusCode = statusCode;
    this.contentType = contentType;
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

  constructor(functionName: string, timedOut: boolean, timeoutMs: number, ursache: unknown) {
    // Die Meldung der Ursache bleibt bewusst draussen: sie stammt aus einer
    // fremden fetch-Umsetzung und koennte die Anfrage samt Kopfzeilen
    // wiedergeben. Die Ursache haengt als `cause` dran (nicht aufzaehlbar,
    // taucht also in JSON.stringify nicht auf) und bleibt so debugbar.
    const grund = timedOut ? `Zeitueberschreitung nach ${timeoutMs} ms` : 'Netzwerkfehler';
    super(`${functionName} fehlgeschlagen: ${grund}`, { cause: ursache });
    this.functionName = functionName;
    this.timedOut = timedOut;
    this.timeoutMs = timeoutMs;
  }
}

/** Alle Fehler, die dieses Paket wirft. */
export type KasseneckError = KasseneckApiError | KasseneckHttpError | KasseneckNetworkError;

export function isKasseneckApiError(fehler: unknown): fehler is KasseneckApiError {
  return fehler instanceof KasseneckApiError;
}

export function isKasseneckHttpError(fehler: unknown): fehler is KasseneckHttpError {
  return fehler instanceof KasseneckHttpError;
}

export function isKasseneckNetworkError(fehler: unknown): fehler is KasseneckNetworkError {
  return fehler instanceof KasseneckNetworkError;
}
