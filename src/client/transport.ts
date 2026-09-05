import type { AuthCredentials, KasseneckAuth } from './auth.js';
import {
  KasseneckApiError,
  KasseneckAuthError,
  KasseneckHttpError,
  KasseneckNetworkError,
  KasseneckValidationError,
  causeDigest,
  fehlerDetails,
} from './errors.js';

/**
 * Transport zum Kasseneck-Backend: ein Aufruf ist ein POST an
 * `<basis>/<funktionsname>` mit dem JSON-Rumpf `{ "params": { … } }` — wie im
 * Flutter-Zwilling `kasseneck_api`.
 *
 * Der Transport macht drei Dinge und sonst nichts: Anfrage bauen (Kopfzeilen
 * von der Anmeldung, Nutzlast aus Auth-Parametern und Aufruferparametern),
 * Zeitlimit ueberwachen, und die Antworthuelle aufloesen. Er kennt keine
 * einzelne Backend-Funktion und keine Firebase-Details.
 *
 * Es gibt **zwei Einstiegspunkte** auf demselben Kern: [createTransport] fuer
 * die JSON-Aufrufe und [createBinaryTransport] fuer die beiden Bericht-
 * Downloads, die ein PDF liefern. Anmeldung, Zeitlimit, Rumpfaufbau und die
 * Fehlerarten sind bei beiden dieselben; sie unterscheiden sich nur darin, wie
 * der Antwortrumpf gelesen und ausgewertet wird.
 *
 * **Kein Wiederholen fehlgeschlagener Aufrufe.** Ein Beleg ist nicht folgenlos
 * wiederholbar; ohne entschiedene Idempotenz waere ein automatischer zweiter
 * Versuch ein zweiter Beleg.
 */

/** Basis-URL der Produktion. */
export const DEFAULT_BASE_URL = 'https://api.kasseneck.at/v1';

/**
 * Zeitlimit je Aufruf (wie im Flutter-Zwilling). Ohne Zeitlimit bleibt eine
 * haengende Anfrage fuer immer offen — der Aufrufer bekaeme weder Ergebnis
 * noch Fehler.
 */
export const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Der Teil einer `fetch`-Antwort, den dieser Transport braucht. Bewusst
 * minimal, damit Tests ohne echtes Netz eine Antwort stellen koennen; das
 * globale `fetch` erfuellt diese Form.
 */
export interface HttpResponseLike {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  /**
   * Rohe Bytes der Antwort — der Binaerweg ([createBinaryTransport]) liest
   * ausschliesslich sie. Bewusst **verpflichtend**: jede `fetch`-Antwort bringt
   * die Methode mit, betroffen sind nur Attrappen — und eine Attrappe ohne
   * Bytes bringt einen Test dazu, den Binaerweg nie zu erreichen und trotzdem
   * gruen zu melden. Dieser Fehler gehoert an die Bauzeit, nicht in die
   * Laufzeit.
   */
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface HttpRequestInit {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
}

/**
 * Austauschbare `fetch`-Umsetzung. Vorgabe ist das globale `fetch` (Node
 * >= 20.18 und jeder Browser bringen es mit) — dieses Paket haengt an keiner
 * HTTP-Bibliothek.
 */
export type FetchLike = (url: string, init: HttpRequestInit) => Promise<HttpResponseLike>;

export interface TransportOptions {
  /** Anmeldung; wird pro Aufruf befragt. */
  auth: KasseneckAuth;
  /** Abweichende Basis-URL (z. B. eigene Rewrites der Browser-Kasse). */
  baseUrl?: string;
  /** Zeitlimit je Aufruf in Millisekunden. */
  timeoutMs?: number;
  /** Eigene `fetch`-Umsetzung (Tests, Proxys). */
  fetch?: FetchLike;
}

/**
 * Ruft eine Backend-Funktion auf und liefert deren Nutzlast **ohne Huelle**.
 * Ein Verbraucher prueft nie selbst auf `status`: Misserfolg kommt als
 * geworfener Fehler.
 *
 * `extraBodyFields` legt zusaetzliche Felder **neben** `params` auf die oberste
 * Rumpfebene. Genau ein Endpunkt braucht das: `financeWebService` erwartet
 * seine `method` neben `params` und nicht darin (siehe Flutter-Vorbild
 * `_financeWebServicePostRequest`). Fuer alle anderen Aufrufe bleibt der Rumpf
 * unveraendert `{params:{…}}`.
 *
 * `secretParams` nennt Werte, die dieser Aufruf in der **Nutzlast** sendet und
 * die in keinem Fehler auftauchen duerfen. Die gesendeten Kopfzeilen sind
 * ohnehin geschuetzt (siehe unten); PIN, Geraetegeheimnis und Kopplungs-Code
 * der Kassen-Anmeldung reisen dagegen im Rumpf, und ein Geraetegeheimnis ist
 * bezeichner-foermig genug, um durch die Ursachen-Verdichtung zu kommen. Wer
 * ein Geheimnis im Rumpf sendet, nennt es hier — sonst gilt es als
 * unbedenklich.
 *
 * Der Typ nennt darum genau dieses eine Feld und ist kein offener Beutel:
 * ein `params` von aussen wuerde die Nutzlast samt Auth-Parametern
 * ueberschreiben — mit `registerUserAuth` verschwaende dabei still die
 * Kassenbindung. Zusaetzlich setzt der Rumpfaufbau `params` als letztes, damit
 * auch ein Verbraucher ohne Typen nicht daran vorbeikommt.
 */
export interface TransportBodyFields {
  /** Vorgangsart von `financeWebService` (z. B. `status_cashbox`). */
  method?: string;
}

export type KasseneckTransport = <T = unknown>(
  functionName: string,
  params?: Record<string, unknown>,
  extraBodyFields?: TransportBodyFields,
  secretParams?: readonly string[],
) => Promise<T>;

/**
 * Ruft eine Backend-Funktion auf, die **Binaerdaten** liefert (die beiden
 * Bericht-PDFs), und gibt sie als `Uint8Array` zurueck.
 */
export type KasseneckBinaryTransport = (
  functionName: string,
  params?: Record<string, unknown>,
) => Promise<Uint8Array>;

/** Liest den Antwortrumpf in seiner Rohform (Text bzw. Bytes). */
type Koerperleser<R> = (antwort: HttpResponseLike, functionName: string) => Promise<R>;

/** Macht aus dem Rohrumpf das Ergebnis des Aufrufs — oder wirft. */
type Auswertung<R, T> = (
  koerper: R,
  functionName: string,
  statusCode: number,
  contentType: string | undefined,
  /**
   * Die Werte, die dieser Aufruf gesendet hat. Die Auswertung braucht sie, um
   * die Fehler-Nutzlast zu sieben (siehe `fehlerDetails`): ein Wert, der mit
   * einem gesendeten Geheimnis ueberlappt, ueberlebt das Sieb nicht.
   */
  geheimnisse: readonly string[],
) => T;

export function createTransport(options: TransportOptions): KasseneckTransport {
  const kern = createCore(options);
  return <T>(
    functionName: string,
    params?: Record<string, unknown>,
    extraBodyFields?: TransportBodyFields,
    secretParams?: readonly string[],
  ) =>
    kern<string, T>(
      functionName,
      params,
      extraBodyFields,
      secretParams,
      alsText,
      jsonAuswerten as Auswertung<string, T>,
    );
}

/**
 * Zweiter Einstiegspunkt fuer die Bericht-Downloads. Er liest die Antwort als
 * Bytes und **nie** als Zeichenkette: ein PDF ist keine UTF-8-Folge, und eine
 * Textdeutung ersetzt jedes Byte ueber 0x7F durch U+FFFD — die Datei waere
 * kaputt, ohne dass es jemand merkt. (Das Flutter-Vorbild nimmt hier
 * `response.body.codeUnits`; das ist eine bewusste Abweichung, siehe
 * reports.ts.)
 */
export function createBinaryTransport(options: TransportOptions): KasseneckBinaryTransport {
  const kern = createCore(options);
  return (functionName: string, params?: Record<string, unknown>) =>
    kern<Uint8Array, Uint8Array>(functionName, params, undefined, undefined, alsBytes, pdfAuswerten);
}

/**
 * Gemeinsamer Kern beider Einstiegspunkte: Anmeldung, Zeitlimit, Anfrage und
 * HTTP-Status. Was danach mit dem Rumpf geschieht, entscheiden `lesen` und
 * `auswerten`.
 */
function createCore(options: TransportOptions) {
  const basis = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const zeitlimitMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const holen = options.fetch ?? globalesFetch();

  return async function aufrufen<R, T>(
    functionName: string,
    params: Record<string, unknown> = {},
    extraBodyFields: TransportBodyFields | undefined,
    secretParams: readonly string[] | undefined,
    lesen: Koerperleser<R>,
    auswerten: Auswertung<R, T>,
  ): Promise<T> {
    // Die URL nennt die Backend-Funktion, die Fehler nennen den **Vorgang**:
    // `financeWebService` fuehrt ein Dutzend verschiedener Vorgaenge unter einem
    // Endpunkt, und ein Fehler, der nur "financeWebService" sagt, verschweigt
    // dem Aufrufer, welcher davon scheiterte.
    const fehlerName = extraBodyFields?.method ? `${functionName}/${extraBodyFields.method}` : functionName;
    // Das Zeitlimit laeuft ab HIER — es deckt die Anmeldung mit ab. Haengt die
    // Token-Erneuerung auf flauem Netz, haette der Aufruf sonst weder Ergebnis
    // noch Fehler, und die Kasse stuende still.
    const abbruch = new AbortController();
    const wecker = setTimeout(() => abbruch.abort(), zeitlimitMs);
    try {
      // Die Anmeldung wird bei JEDEM Aufruf befragt — nichts wird beim Anlegen
      // des Transports gemerkt (Ablaufzeiten siehe auth.ts).
      let anmeldung: AuthCredentials;
      try {
        const ergebnis = await Promise.race([Promise.resolve(options.auth()), abbruchAlsAblehnung(abbruch.signal)]);
        anmeldung = gepruefteAnmeldung(ergebnis);
      } catch (ursache) {
        if (abbruch.signal.aborted) {
          throw new KasseneckNetworkError(fehlerName, true, zeitlimitMs);
        }
        // Eigene Pruefungen tragen ihren geheimnisfreien Grund weiter; von einer
        // fremden Ursache (Firebase & Co.) bleibt nichts uebrig — weder Meldung
        // noch Verdichtung, siehe Klassenkommentar zu KasseneckAuthError.
        const grund = ursache instanceof KasseneckAuthError ? ursache.reason : 'Anmeldung fehlgeschlagen';
        throw new KasseneckAuthError(grund, { functionName: fehlerName });
      }

      // Was wir gleich senden, darf spaeter in keiner Fehlermeldung auftauchen:
      // die Kopfzeilen der Anmeldung — und die Werte, die dieser Aufruf als
      // Geheimnis der Nutzlast benannt hat (Kassen-Anmeldung: Kopplungs-Code,
      // Geraetegeheimnis, PIN). Ohne die zweite Haelfte greift die Zusage genau
      // dort nicht, wo es gar keine Kopfzeilen gibt.
      const geheimnisse = [...Object.values(anmeldung.headers), ...(secretParams ?? [])];
      const url = `${basis}/${encodeURIComponent(functionName)}`;
      // `params` steht ZULETZT: so kann kein Zusatzfeld die Nutzlast (und mit
      // ihr die Kassenbindung aus der Anmeldung) verdraengen — auch nicht von
      // einem Verbraucher, der ohne Typen an TransportBodyFields vorbeikommt.
      const rumpf = JSON.stringify({ ...extraBodyFields, params: nutzlast(anmeldung.params, params) });

      let antwort: HttpResponseLike;
      let koerper: R;
      try {
        // Auch der Aufruf laeuft gegen den Abbruch — nicht nur die Anmeldung.
        // Das `AbortSignal` geht zwar mit, aber ob eine fetch-Umsetzung es
        // beachtet, ist keine Zusage dieses Pakets: `options.fetch` ist ein
        // dokumentierter Erweiterungspunkt fuer Proxys, und eine Umsetzung,
        // die das Signal ignoriert, liesse den Aufruf sonst fuer immer offen —
        // weder Ergebnis noch Fehler. Das Lesen des Rumpfs haengt genauso mit
        // darunter: eine Gegenstelle kann die Kopfzeilen schicken und den
        // Rumpf offen lassen.
        antwort = await Promise.race([
          holen(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...anmeldung.headers },
            body: rumpf,
            signal: abbruch.signal,
          }),
          abbruchAlsAblehnung(abbruch.signal),
        ]);
        koerper = await Promise.race([lesen(antwort, fehlerName), abbruchAlsAblehnung(abbruch.signal)]);
      } catch (ursache) {
        // Ein Formfehler des Pakets ist kein Netzfehler und behaelt seine Art
        // (der Binaerweg wirft ihn, wenn die fetch-Antwort keine Bytes liefert).
        if (ursache instanceof KasseneckValidationError) {
          throw ursache;
        }
        // Bis hierher kam keine verwertbare Antwort: Netz weg oder Zeitlimit.
        throw new KasseneckNetworkError(
          fehlerName,
          abbruch.signal.aborted,
          zeitlimitMs,
          causeDigest(ursache, geheimnisse),
        );
      }

      const inhaltstyp = antwort.headers.get('content-type') ?? undefined;
      // Das Backend antwortet auf jeden fachlichen Ausgang mit HTTP 200; alles
      // andere kommt nicht von ihm (Proxy, Rewrite-Luecke, Infrastruktur).
      if (antwort.status !== 200) {
        throw new KasseneckHttpError(fehlerName, antwort.status, inhaltstyp, 'server-error');
      }

      return auswerten(koerper, fehlerName, antwort.status, inhaltstyp, geheimnisse);
    } finally {
      // Ohne Abraeumen haelt der Wecker den Node-Prozess bis zum Zeitlimit wach.
      clearTimeout(wecker);
    }
  };
}

/** JSON-Weg: der Rumpf ist Text. */
const alsText: Koerperleser<string> = (antwort) => antwort.text();

/**
 * Binaerweg: der Rumpf sind Bytes. `text()` wird hier bewusst **nicht**
 * angefasst — es wuerde die Bytes als UTF-8 deuten.
 */
const alsBytes: Koerperleser<Uint8Array> = async (antwort, functionName) => {
  if (typeof antwort.arrayBuffer !== 'function') {
    // Der Typ verlangt die Methode; diese Pruefung gilt dem Verbraucher ohne
    // Typen, der eine eigene fetch-Umsetzung mitbringt. Lieber laut scheitern
    // als still auf text() ausweichen — das waere genau der Bytefehler, den
    // dieser Weg verhindern soll.
    throw new KasseneckValidationError(
      functionName,
      'Die fetch-Antwort liefert keine Bytes (arrayBuffer fehlt)',
      'response',
    );
  }
  return new Uint8Array(await antwort.arrayBuffer());
};

/** Auswertung des JSON-Wegs: Huelle aufloesen, Nutzlast zurueckgeben. */
function jsonAuswerten<T>(
  text: string,
  functionName: string,
  statusCode: number,
  inhaltstyp: string | undefined,
  geheimnisse: readonly string[],
): T {
  if (!text.trim()) {
    throw new KasseneckHttpError(functionName, statusCode, inhaltstyp, 'empty-body');
  }
  let roh: unknown;
  try {
    roh = JSON.parse(text);
  } catch {
    // Typischer Fall: der Aufruf landete mangels Rewrite auf der HTML-Seite
    // der Single-Page-App — HTTP 200, aber kein JSON.
    throw new KasseneckHttpError(functionName, statusCode, inhaltstyp, 'not-json');
  }
  const huelle = alsHuelle(roh);
  if (huelle === null) {
    throw new KasseneckHttpError(functionName, statusCode, inhaltstyp, 'missing-status');
  }
  if (huelle.status === 'success') {
    return huelle.data as T;
  }
  // Alles, was nicht ausdruecklich Erfolg ist, gilt als fachlicher Fehler —
  // ein unbekannter Statuswert darf nie stillschweigend als Erfolg durchgehen.
  throw fachfehler(functionName, huelle.message, huelle.data, geheimnisse, huelle.code);
}

/**
 * Auswertung des Binaerwegs. Der Kern der Zusage: **ein Aufrufer bekommt nie
 * ein "PDF", das in Wahrheit eine Fehlermeldung ist.** Das Backend antwortet
 * auch im Fehlerfall mit HTTP 200 und schickt dann seine JSON-Huelle statt des
 * PDF; wer die Bytes ungeprueft durchreicht, gibt dem Kassier eine kaputte
 * Datei ohne jeden Hinweis.
 *
 * Entschieden wird an den **ersten Bytes**, nicht am Inhaltstyp: der Inhaltstyp
 * ist die Aussage der Gegenstelle (oder eines Proxys davor) und kann fehlen
 * oder falsch sein, die PDF-Kennung `%PDF` steht dagegen in jeder Datei, die
 * das Backend hier erzeugt (pdf-lib). Alles, was nicht so anfaengt, ist kein
 * Bericht — und wird dann daraufhin angesehen, ob es die Fehlerhuelle ist.
 */
function pdfAuswerten(
  bytes: Uint8Array,
  functionName: string,
  statusCode: number,
  inhaltstyp: string | undefined,
  geheimnisse: readonly string[],
): Uint8Array {
  if (bytes.length === 0) {
    throw new KasseneckHttpError(functionName, statusCode, inhaltstyp, 'empty-body');
  }
  if (istPdf(bytes)) {
    return bytes;
  }
  // Ab hier ist nichts mehr zu retten; die Bytes werden nur noch **zur
  // Fehlerdeutung** als Text gelesen, nie als Ergebnis zurueckgegeben. Die
  // Gruende sind dieselben wie auf dem JSON-Weg und heissen auch so: "kein
  // JSON" ist betrieblich der fehlende Rewrite (die Antwort ist die HTML-Seite
  // der Single-Page-App), "kein Statusfeld" ein geaenderter Backend-Vertrag.
  // Ein eigener Sammelgrund fuer den Binaerweg wuerde die beiden verschmelzen.
  let roh: unknown;
  try {
    roh = JSON.parse(new TextDecoder('utf-8').decode(bytes));
  } catch {
    throw new KasseneckHttpError(functionName, statusCode, inhaltstyp, 'not-json');
  }
  const huelle = alsHuelle(roh);
  if (huelle === null) {
    throw new KasseneckHttpError(functionName, statusCode, inhaltstyp, 'missing-status');
  }
  if (huelle.status === 'success') {
    // Erfolg gemeldet, aber kein PDF geliefert: die Antwort traegt nicht, was
    // der Aufruf zusagt.
    throw new KasseneckValidationError(functionName, 'Antwort ist ein Erfolgsrumpf statt eines PDF', 'response');
  }
  // Derselbe fachliche Fehler wie auf dem JSON-Weg — fuer den Aufrufer macht
  // es keinen Unterschied, ob er ein PDF oder eine Nutzlast erwartet hat.
  throw fachfehler(functionName, huelle.message, huelle.data, geheimnisse, huelle.code);
}

/** `%PDF` am Anfang — die Kennung jeder PDF-Datei. */
function istPdf(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

/** Antworthuelle `{status, message, data}` — oder `null`, wenn es keine ist. */
function alsHuelle(wert: unknown): { status: unknown; message?: unknown; data?: unknown; code?: unknown } | null {
  if (typeof wert !== 'object' || wert === null || !('status' in wert)) {
    return null;
  }
  return wert as { status: unknown; message?: unknown; data?: unknown; code?: unknown };
}

function fachfehler(
  functionName: string,
  message: unknown,
  daten: unknown,
  geheimnisse: readonly string[],
  code?: unknown,
): KasseneckApiError {
  const meldung = typeof message === 'string' && message.trim() ? message : 'Unbekannter Fehler';
  // Nur ein Text zaehlt als Code -- alles andere waere ein geratener Vertrag.
  return new KasseneckApiError(functionName, meldung, fehlerDetails(daten, geheimnisse), typeof code === 'string' && code ? code : undefined);
}

/**
 * Nutzlast aus Auth- und Aufruferparametern. Auth-Parameter bilden die
 * Grundlage; ein ausdruecklich gesetzter Aufruferwert sticht (der Server prueft
 * ihn ohnehin gegen die Sitzung). Ein **anwesender, aber undefinierter**
 * Schluessel sticht dagegen nicht: `{ …, cashregisterId: opts.cashregisterId }`
 * ist in der Endpunkt-Schicht das natuerlichste Muster der Welt, und ein reines
 * Spread wuerde die Kassenbindung damit still loeschen (`JSON.stringify` wirft
 * undefined danach weg). `null` bleibt erhalten — das ist eine Aussage.
 */
function nutzlast(authParams: Record<string, unknown>, params: Record<string, unknown>): Record<string, unknown> {
  const zusammen: Record<string, unknown> = { ...authParams };
  for (const [schluessel, wert] of Object.entries(params)) {
    if (wert !== undefined) {
      zusammen[schluessel] = wert;
    }
  }
  return zusammen;
}

/**
 * Prueft, was eine Anmeldung geliefert hat. Die Typen verlangen
 * `{headers, params}` — `auth()` ist aber der Erweiterungspunkt fuer fremden
 * Code, und zur Laufzeit kommt an, was ankommt. Ohne diese Pruefung flogen
 * `undefined`, ein String oder ein Objekt ohne `headers` als roher `TypeError`
 * an allen Fehlerarten dieses Pakets vorbei, waehrend ein fehlendes `params`
 * still durchlief. Der gelieferte Wert selbst taucht in der Meldung **nicht**
 * auf — er kann der api_key sein.
 */
function gepruefteAnmeldung(wert: unknown): AuthCredentials {
  if (typeof wert !== 'object' || wert === null) {
    throw new KasseneckAuthError('Anmeldung lieferte keine Zugangsdaten');
  }
  const { headers, params } = wert as { headers?: unknown; params?: unknown };
  if (!istKopfzeilen(headers)) {
    throw new KasseneckAuthError('Anmeldung lieferte keine brauchbaren Kopfzeilen');
  }
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    throw new KasseneckAuthError('Anmeldung lieferte keine brauchbaren Zusatzparameter');
  }
  return { headers, params: params as Record<string, unknown> };
}

function istKopfzeilen(wert: unknown): wert is Record<string, string> {
  if (typeof wert !== 'object' || wert === null || Array.isArray(wert)) {
    return false;
  }
  return Object.values(wert).every((eintrag) => typeof eintrag === 'string');
}

/** Lehnt ab, sobald das Zeitlimit die Anfrage abbricht. */
function abbruchAlsAblehnung(signal: AbortSignal): Promise<never> {
  return new Promise((_erfuellen, ablehnen) => {
    if (signal.aborted) {
      ablehnen(new Error('abgebrochen'));
      return;
    }
    signal.addEventListener('abort', () => ablehnen(new Error('abgebrochen')), { once: true });
  });
}

/** Das globale `fetch`; fehlt es, faellt das sofort und deutlich auf. */
function globalesFetch(): FetchLike {
  const umgebung = globalThis as { fetch?: FetchLike };
  if (typeof umgebung.fetch !== 'function') {
    throw new Error('createTransport: kein globales fetch vorhanden — Node >= 20.18 verwenden oder eine fetch-Umsetzung uebergeben');
  }
  // Ueber das Umgebungsobjekt aufrufen: manche Browser verlangen `globalThis`
  // als Empfaenger und werfen bei einem losgeloesten fetch.
  return (url, init) => umgebung.fetch!(url, init);
}
