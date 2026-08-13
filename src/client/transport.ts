import type { AuthCredentials, KasseneckAuth } from './auth.js';
import {
  KasseneckApiError,
  KasseneckAuthError,
  KasseneckHttpError,
  KasseneckNetworkError,
  causeDigest,
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
 */
export type KasseneckTransport = <T = unknown>(functionName: string, params?: Record<string, unknown>) => Promise<T>;

export function createTransport(options: TransportOptions): KasseneckTransport {
  const basis = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const zeitlimitMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const holen = options.fetch ?? globalesFetch();

  return async function aufrufen<T>(functionName: string, params: Record<string, unknown> = {}): Promise<T> {
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
        anmeldung = await Promise.race([Promise.resolve(options.auth()), abbruchAlsAblehnung(abbruch.signal)]);
      } catch (ursache) {
        if (abbruch.signal.aborted) {
          throw new KasseneckNetworkError(functionName, true, zeitlimitMs, causeDigest(ursache));
        }
        // Eigene Pruefungen tragen ihren geheimnisfreien Grund weiter; eine
        // fremde Meldung (Firebase & Co.) bleibt draussen.
        const grund = ursache instanceof KasseneckAuthError ? ursache.reason : 'Anmeldung fehlgeschlagen';
        throw new KasseneckAuthError(grund, { functionName, cause: causeDigest(ursache) });
      }

      // Was wir gleich senden, darf spaeter in keiner Fehlermeldung auftauchen.
      const geheimnisse = Object.values(anmeldung.headers);
      const url = `${basis}/${encodeURIComponent(functionName)}`;
      const rumpf = JSON.stringify({ params: nutzlast(anmeldung.params, params) });

      let antwort: HttpResponseLike;
      let text: string;
      try {
        antwort = await holen(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...anmeldung.headers },
          body: rumpf,
          signal: abbruch.signal,
        });
        text = await antwort.text();
      } catch (ursache) {
        // Bis hierher kam keine verwertbare Antwort: Netz weg oder Zeitlimit.
        throw new KasseneckNetworkError(
          functionName,
          abbruch.signal.aborted,
          zeitlimitMs,
          causeDigest(ursache, geheimnisse),
        );
      }

      const inhaltstyp = antwort.headers.get('content-type') ?? undefined;
      // Das Backend antwortet auf jeden fachlichen Ausgang mit HTTP 200; alles
      // andere kommt nicht von ihm (Proxy, Rewrite-Luecke, Infrastruktur).
      if (antwort.status !== 200) {
        throw new KasseneckHttpError(functionName, antwort.status, inhaltstyp, 'server-error');
      }
      if (!text.trim()) {
        throw new KasseneckHttpError(functionName, antwort.status, inhaltstyp, 'empty-body');
      }

      let huelle: unknown;
      try {
        huelle = JSON.parse(text);
      } catch {
        // Typischer Fall: der Aufruf landete mangels Rewrite auf der HTML-Seite
        // der Single-Page-App — HTTP 200, aber kein JSON.
        throw new KasseneckHttpError(functionName, antwort.status, inhaltstyp, 'not-json');
      }
      if (typeof huelle !== 'object' || huelle === null || !('status' in huelle)) {
        throw new KasseneckHttpError(functionName, antwort.status, inhaltstyp, 'missing-status');
      }

      const { status, message, data } = huelle as { status: unknown; message?: unknown; data?: unknown };
      if (status === 'success') {
        return data as T;
      }
      // Alles, was nicht ausdruecklich Erfolg ist, gilt als fachlicher Fehler —
      // ein unbekannter Statuswert darf nie stillschweigend als Erfolg durchgehen.
      const meldung = typeof message === 'string' && message.trim() ? message : 'Unbekannter Fehler';
      throw new KasseneckApiError(functionName, meldung);
    } finally {
      // Ohne Abraeumen haelt der Wecker den Node-Prozess bis zum Zeitlimit wach.
      clearTimeout(wecker);
    }
  };
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
