import { isRegisterUserAuth, type AuthCredentials, type KasseneckAuth } from './auth.js';
import { isPosCall, isPosOnlyCall } from './aufrufe.js';
import { PACKAGE_VERSION } from '../version.js';
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
 * einzelne Backend-Funktion und keine Details der Infrastruktur.
 *
 * Es gibt **zwei Einstiegspunkte** auf demselben Kern: [createTransport] fuer
 * die JSON-Aufrufe und [createBinaryTransport] fuer die beiden Bericht-
 * Downloads, die ein PDF liefern. Anmeldung, Zeitlimit, Rumpfaufbau und die
 * Fehlerarten sind bei beiden dieselben; sie unterscheiden sich nur darin, wie
 * der Antwortrumpf gelesen und ausgewertet wird.
 *
 * **Nur `/v3`, fail closed.** Jede Antwort muss das Kennzeichen
 * `Kasseneck-Api-Version: v3` tragen; fehlt es, wirft der Transport
 * `dialect_mismatch`, **bevor** er den Rumpf liest, und tut nichts weiter
 * (Nachtrag §5.4, Risiko R1: eine Route auf eine Function mit altem Rand
 * haette die englischen Parameter deutsch gedeutet). Eine HTML-Antwort ist
 * `route_missing`: die Hosting-Auffangregel hat den Aufruf abgefangen, bevor
 * ihn eine Function sah.
 *
 * **Kasseneck-Kopfzeilen nur an Kasseneck-Basen** (Nachtrag §6, Risiko R3):
 * `Kasseneck-Api-Version: v3` und `Kasseneck-Client: <produkt>/<version>`
 * setzt der Transport selbst, abhaengig von der Basis, und nie ueber die
 * `fetch`-Umsetzung. Dieselbe Umsetzung darf darum auch Connect, ePOS-Drucker
 * und Terminals bedienen, ohne dass dort eine fremde Kopfzeile den Vorflug
 * scheitern laesst.
 *
 * **Kein Wiederholen fehlgeschlagener Aufrufe.** Ein Beleg ist nicht folgenlos
 * wiederholbar; ohne entschiedene Idempotenz waere ein automatischer zweiter
 * Versuch ein zweiter Beleg.
 */

/** Basis-URL der oeffentlichen API (Produktion). */
export const DEFAULT_BASE_URL = 'https://api.kasseneck.at/v3';

/**
 * Basis-URL des Kassenwegs (Kanal `app`, Nachtrag §5.2). Die Web-Kasse ruft
 * denselben Weg im gleichen Ursprung als `/api/v3`.
 */
export const KASSE_BASE_URL = 'https://kasse.kasseneck.at/api/v3';

/** Kennzeichen der `/v3`-Antworten und -Anfragen. */
const VERSION_KOPF = 'Kasseneck-Api-Version';
const CLIENT_KOPF = 'Kasseneck-Client';
const VERSION_WERT = 'v3';

/**
 * Hosts, die als Kasseneck-Basis gelten, nur ueber https und ohne eigenen
 * Port. Alles andere (Proxys, Emulator, `127.0.0.1` fuer Connect) bekommt die
 * Kasseneck-Kopfzeilen nicht.
 */
const KASSENECK_HOSTS: ReadonlySet<string> = new Set(['api.kasseneck.at', 'kasse.kasseneck.at']);

/** Die 1.x-Linie spricht nur `/v3`: jede Basis endet so (`/v3` oder `/api/v3`). */
const V3_ENDE = /\/v3$/;

/**
 * Aufrufe, die signieren bzw. bei FinanzOnline etwas ausloesen. Ein Netzfehler,
 * nachdem die Anfrage unterwegs war, laesst ihren Ausgang offen.
 */
const SIGNIERENDE_AUFRUFE: ReadonlySet<string> = new Set(['createReceipt', 'cancelReceipt', 'financeWebService']);

/**
 * Produkte, die das Backend in `Kasseneck-Client` zaehlt (Positivliste,
 * Nachtrag §6); alles andere zaehlte dort als `ungueltig`. Das Paket weist
 * es darum schon beim Anlegen des Transports ab.
 */
const CLIENT_PRODUKTE: ReadonlySet<string> = new Set(['kasse-web', 'kasse-app', 'kasseneck-api', 'kasseneck_api']);
const CLIENT_VERSION = /^[0-9A-Za-z.+-]{1,40}$/;
const CLIENT_MAX = 64;

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
  /**
   * Abweichende Basis der **oeffentlichen** Aufrufe (Vorgabe
   * [DEFAULT_BASE_URL]): alles ausser den 25 Aufrufen des Kassenwegs, und die
   * sechs oeffentlichen davon nur, wenn nicht mit `registerUserAuth`
   * angemeldet. Muss auf `/v3` enden (eigene Proxys erlaubt), sonst wirft das
   * Anlegen; `/v1` oder `/api` gibt es in der 1.x-Linie nicht.
   */
  baseUrl?: string;
  /**
   * Abweichende Basis des **Kassenwegs** (Vorgabe [KASSE_BASE_URL]): die 19
   * reinen Kassenaufrufe (Kopplung, Anmeldung, Einstellungen, Artikel,
   * Drucker, ...) und mit `registerUserAuth` alle 25 Aufrufe des Kassenwegs.
   * Die Web-Kasse gibt `'/api/v3'` (gleicher Ursprung). Muss auf `/v3` enden
   * (in der Regel `/api/v3`), sonst wirft das Anlegen.
   */
  kasseBaseUrl?: string;
  /** Zeitlimit je Aufruf in Millisekunden. */
  timeoutMs?: number;
  /** Eigene `fetch`-Umsetzung (Tests, Proxys). */
  fetch?: FetchLike;
  /**
   * Wert der Kopfzeile `Kasseneck-Client`, Vorgabe `kasseneck-api/<version>`.
   * Eine App nennt sich selbst (`kasse-web/<build>`, `kasse-app/<version+build>`).
   * Erlaubt sind nur die Produkte `kasse-web`, `kasse-app`, `kasseneck-api`,
   * `kasseneck_api` mit einer Version aus `[0-9A-Za-z.+-]` (hoechstens 40
   * Zeichen, gesamt hoechstens 64); sonst wirft das Anlegen.
   */
  clientHeader?: string;
  /**
   * `true` laesst `Kasseneck-Api-Version` und `Kasseneck-Client` auch an
   * Kasseneck-Basen weg. Fuer Browser, die die oeffentliche API von einem
   * fremden Ursprung aus rufen: solange der Vorflug unter `/v3` die beiden
   * Kopfzeilen nicht erlaubt, scheiterte sonst jeder Aufruf schon dort. Die
   * Pruefung des Kennzeichens in der **Antwort** bleibt unberuehrt; es entfaellt
   * nur die Gegenpruefung des Rands (`createReceipt`/`cancelReceipt` weisen
   * eine als v3 gekennzeichnete Anfrage auf einem Nicht-v3-Pfad ab).
   */
  omitKasseneckHeaders?: boolean;
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
  const oeffentlicheBasis = v3Basis('baseUrl', options.baseUrl) ?? DEFAULT_BASE_URL;
  const kassenBasis = v3Basis('kasseBaseUrl', options.kasseBaseUrl) ?? KASSE_BASE_URL;
  const kassenweg = isRegisterUserAuth(options.auth);
  const zeitlimitMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const holen = options.fetch ?? globalesFetch();
  const kennung = options.clientHeader ?? `kasseneck-api/${PACKAGE_VERSION}`;
  pruefeKennung(kennung);
  const kopfzeilenSenden = options.omitKasseneckHeaders !== true;

  /**
   * Basis je Aufruf. Die 19 reinen Kassenaufrufe gehen immer an den
   * Kassenweg (unter der oeffentlichen Basis gibt es sie nicht), und die
   * Kassen-Anmeldung ruft alle 25 Aufrufe des Kassenwegs dort, auch die sechs
   * oeffentlichen (Kanal `app`). Was der Kassenweg gar nicht fuehrt
   * (Berichte, Zahlungen, FinanzOnline), geht an die oeffentliche Basis.
   */
  const basisFuer = (functionName: string): string =>
    isPosOnlyCall(functionName) || (kassenweg && isPosCall(functionName)) ? kassenBasis : oeffentlicheBasis;

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
        // fremden Ursache bleibt nichts uebrig — weder Meldung
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
      // Bis zur ersten Antwort (bzw. beim Lesen des Rumpfs) ist alles Scheitern
      // Netz oder Zeitlimit.
      const netzfehler = (ursache: unknown): Error => {
        // Ein Formfehler des Pakets ist kein Netzfehler und behaelt seine Art
        // (der Binaerweg wirft ihn, wenn die fetch-Antwort keine Bytes liefert).
        if (ursache instanceof KasseneckValidationError) {
          return ursache;
        }
        // Bis hierher kam keine verwertbare Antwort: Netz weg oder Zeitlimit.
        // Die Anfrage war schon unterwegs: bei einem signierenden Aufruf kann
        // der Beleg entstanden sein (Ausgang unklar, nachlesen).
        return new KasseneckNetworkError(
          fehlerName,
          abbruch.signal.aborted,
          zeitlimitMs,
          causeDigest(ursache, geheimnisse),
          SIGNIERENDE_AUFRUFE.has(functionName) ? 'unknown' : 'rejected',
        );
      };
      const basis = basisFuer(functionName);
      const url = `${basis}/${encodeURIComponent(functionName)}`;
      // `params` steht ZULETZT: so kann kein Zusatzfeld die Nutzlast (und mit
      // ihr die Kassenbindung aus der Anmeldung) verdraengen — auch nicht von
      // einem Verbraucher, der ohne Typen an TransportBodyFields vorbeikommt.
      const rumpf = JSON.stringify({ ...extraBodyFields, params: nutzlast(anmeldung.params, params) });

      let antwort: HttpResponseLike;
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
            headers: {
              'Content-Type': 'application/json',
              ...ohneKasseneckKopfzeilen(anmeldung.headers),
              ...(kopfzeilenSenden && istKasseneckBasis(basis)
                ? { [VERSION_KOPF]: VERSION_WERT, [CLIENT_KOPF]: kennung }
                : {}),
            },
            body: rumpf,
            signal: abbruch.signal,
          }),
          abbruchAlsAblehnung(abbruch.signal),
        ]);
      } catch (ursache) {
        throw netzfehler(ursache);
      }

      // Alles Folgende entscheidet an den Kopfzeilen, **bevor** der Rumpf
      // gelesen wird: was nicht vom `/v3`-Rand kommt, wird nicht gedeutet.
      const inhaltstyp = antwort.headers.get('content-type') ?? undefined;
      // Das Backend antwortet auf jeden fachlichen Ausgang mit HTTP 200; alles
      // andere kommt nicht von ihm (Proxy, Rewrite-Luecke, Infrastruktur). Das
      // steht VOR der HTML-Pruefung: eine 500er-Fehlerseite ist auch HTML, aber
      // dort kann eine Function gelaufen sein; `route_missing` sagt das Gegenteil.
      if (antwort.status !== 200) {
        // Ausnahme: der `/v3`-Rand antwortet auf einen unbekannten Endpunkt mit
        // HTTP 404, Kennzeichen und Huelle samt Code (`not_found`). Nur mit
        // Kennzeichen wird dieser Rumpf gelesen.
        if (antwort.status === 404 && traegtKennzeichen(antwort)) {
          const fehler = await randFehler404(antwort, fehlerName, geheimnisse, abbruch.signal);
          if (fehler) throw fehler;
        }
        throw new KasseneckHttpError(fehlerName, antwort.status, inhaltstyp, 'server-error');
      }
      // HTTP 200 mit HTML: die Auffangregel der Single-Page-App hat den Aufruf
      // bedient, keine Function hat ihn gesehen (Nachtrag §5.4, R15).
      if (inhaltstyp !== undefined && /^\s*text\/html\b/i.test(inhaltstyp)) {
        throw new KasseneckApiError(
          fehlerName,
          'Route fehlt: die Antwort ist eine HTML-Seite statt des Backends',
          {},
          'route_missing',
        );
      }
      if (!traegtKennzeichen(antwort)) {
        throw new KasseneckApiError(
          fehlerName,
          'Server spricht nicht /v3 (Kennzeichen Kasseneck-Api-Version fehlt); Antwort verworfen',
          {},
          'dialect_mismatch',
        );
      }

      let koerper: R;
      try {
        koerper = await Promise.race([lesen(antwort, fehlerName), abbruchAlsAblehnung(abbruch.signal)]);
      } catch (ursache) {
        throw netzfehler(ursache);
      }

      return auswerten(koerper, fehlerName, antwort.status, inhaltstyp, geheimnisse);
    } finally {
      // Ohne Abraeumen haelt der Wecker den Node-Prozess bis zum Zeitlimit wach.
      clearTimeout(wecker);
    }
  };
}

/** Traegt die Antwort das Kennzeichen `Kasseneck-Api-Version: v3`? */
function traegtKennzeichen(antwort: HttpResponseLike): boolean {
  return (antwort.headers.get(VERSION_KOPF) ?? '').trim().toLowerCase() === VERSION_WERT;
}

/**
 * Liest die 404-Huelle des `/v3`-Rands. Liefert den fachlichen Fehler, wenn
 * es eine Fehlerhuelle mit Code ist, sonst `null` (dann bleibt es beim
 * HTTP-Fehler). Ein Lesefehler zaehlt ebenfalls als `null`.
 */
async function randFehler404(
  antwort: HttpResponseLike,
  functionName: string,
  geheimnisse: readonly string[],
  signal: AbortSignal,
): Promise<KasseneckApiError | null> {
  try {
    const text = await Promise.race([antwort.text(), abbruchAlsAblehnung(signal)]);
    const huelle = alsHuelle(JSON.parse(text));
    if (huelle === null || huelle.status === 'success') return null;
    const fehler = fachfehler(functionName, huelle.message, huelle.data, geheimnisse, huelle.code);
    return fehler.code === undefined ? null : fehler;
  } catch {
    return null;
  }
}

/**
 * Prueft eine abweichende Basis beim Anlegen: die 1.x-Linie spricht nur
 * `/v3`. Liefert sie ohne abschliessende Schraegstriche, oder `undefined`
 * ohne Angabe.
 */
function v3Basis(option: 'baseUrl' | 'kasseBaseUrl', basis: string | undefined): string | undefined {
  if (basis === undefined) return undefined;
  const ohne = typeof basis === 'string' ? basis.replace(/\/+$/, '') : '';
  if (!V3_ENDE.test(ohne)) {
    const beispiel = option === 'kasseBaseUrl' ? "'/api/v3' bzw. KASSE_BASE_URL" : 'DEFAULT_BASE_URL';
    throw new KasseneckValidationError(
      'createTransport',
      `${option} muss auf /v3 oder /api/v3 enden (1.x spricht nur /v3; z. B. ${beispiel} statt /api oder /v1)`,
      'request',
    );
  }
  return ohne;
}

/**
 * Ist `basis` eine Kasseneck-Basis? Relativ (gleicher Ursprung) immer,
 * ausser `//host` (fremder Host ohne Schema); absolut nur
 * `https://api.kasseneck.at` bzw. `https://kasse.kasseneck.at` ohne Port und
 * ohne Zugangsdaten.
 */
function istKasseneckBasis(basis: string): boolean {
  if (basis.startsWith('//')) return false;
  let adresse: URL;
  try {
    adresse = new URL(basis);
  } catch {
    // Keine absolute Adresse: relativ zum eigenen Ursprung.
    return true;
  }
  return adresse.protocol === 'https:'
    && adresse.port === ''
    && adresse.username === ''
    && adresse.password === ''
    && KASSENECK_HOSTS.has(adresse.hostname);
}

/**
 * Die beiden Kasseneck-Kopfzeilen setzt allein der Transport. Liefert die
 * Anmeldung sie mit (in beliebiger Schreibweise), fallen sie weg: sonst kaeme
 * ein zweiter Wert daneben, oder eine fremde Basis bekaeme sie doch.
 */
function ohneKasseneckKopfzeilen(kopfzeilen: Record<string, string>): Record<string, string> {
  const gesperrt = new Set([VERSION_KOPF.toLowerCase(), CLIENT_KOPF.toLowerCase()]);
  const ergebnis: Record<string, string> = {};
  for (const [name, wert] of Object.entries(kopfzeilen)) {
    if (!gesperrt.has(name.toLowerCase())) ergebnis[name] = wert;
  }
  return ergebnis;
}

/** Prueft `Kasseneck-Client` gegen Positivliste und Form (Nachtrag §6). */
function pruefeKennung(kennung: unknown): void {
  const text = typeof kennung === 'string' ? kennung : '';
  const trenner = text.indexOf('/');
  const produkt = trenner > 0 ? text.slice(0, trenner) : '';
  const version = trenner > 0 ? text.slice(trenner + 1) : '';
  if (text.length > CLIENT_MAX || !CLIENT_PRODUKTE.has(produkt) || !CLIENT_VERSION.test(version)) {
    throw new KasseneckValidationError(
      'createTransport',
      'clientHeader muss <produkt>/<version> sein (Produkt: kasse-web, kasse-app, kasseneck-api, kasseneck_api)',
      'request',
    );
  }
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
