import {
  HpsConnectTerminalError,
  HpsConnectTransportError,
  HpsPreflightError,
  HpsTransactionIdError,
  PREFLIGHT_CONNECT_CODES,
} from './errors.js';
import { isValidHpsTransactionId } from './transaction-id.js';
import { type HpsTransactionResponse, parseHpsTransactionResponse } from './transaction-response.js';

/**
 * Client fuer die Terminal-Endpunkte von **Kasseneck Connect** — dem lokalen
 * Geraete-Agenten, der ueber HTTP erreichbar ist und mit dem hobex-HPS
 * spricht (`kasseneck-connect/lib/src/api/routes_terminal.dart`). Connect
 * reicht die Antwort des Terminals ROH durch und ordnet nichts ein; die
 * Einordnung passiert in `transaction-response.ts` und `payments.ts`.
 *
 * **Kein direkter Terminal-Kontakt.** Ein Browser hat keine rohen
 * TCP-Sockets — das ist der Unterschied zum Dart-Zwilling `HpsClient`, der
 * das HPS-Terminal direkt anspricht. Dieser Client spricht ausschliesslich
 * mit Connect, niemals mit dem Terminal selbst.
 *
 * **`payment`/`status`/`abort`/`refund`/`cancel`.** Seit
 * `kasseneck-connect` Commit `1c8a003` traegt Connect auch die Gutschrift
 * (`POST /v1/terminal/refund`) und die Aufhebung (`POST /v1/terminal/cancel`)
 * — beide erben denselben Fehlerpfad wie `payment` (`error.detail.terminalHttpStatus`,
 * siehe `HpsConnectTerminalError.isTerminalBusy`).
 */

/** Adresse des Ziel-Terminals — bei jedem Aufruf mitgegeben, Connect selbst ist zustandslos. */
export interface HpsConnectTarget {
  /** IP oder Hostname des Terminals im Kassen-Netz. */
  host: string;
  /** Vorgabe: `8080` (hobex-HPS-Standardport), siehe Connect. */
  port?: number;
  /** Terminal-ID, wie am Geraet angezeigt (fuehrende Nullen werden toleriert). */
  tid: string;
}

export interface HpsConnectPaymentOptions extends HpsConnectTarget {
  /** Kennung dieser Zahlung — MUSS vor diesem Aufruf feststehen, siehe `transaction-id.ts`. */
  transactionId: string;
  /** Zu belastender Betrag in **Cent** (ohne Trinkgeld). */
  amountCents: number;
  /** Trinkgeld in **Cent**; das Terminal belastet Betrag + Trinkgeld in einem. */
  tipCents?: number;
  reference?: string;
  currency?: string;
  language?: string;
}

export interface HpsConnectTransactionOptions extends HpsConnectTarget {
  transactionId: string;
}

export interface HpsConnectRefundOptions extends HpsConnectTarget {
  /** Kennung der Gutschrift SELBST — eine NEUE, nicht die der erstatteten Zahlung. */
  transactionId: string;
  /** Kennung der erstatteten Zahlung. Verlangt Connect zwingend, siehe `_handleRefund`. */
  originalTransactionId: string;
  /** Zu erstattender Betrag in **Cent**. */
  amountCents: number;
  reference?: string;
  currency?: string;
  language?: string;
}

export interface HpsConnectCancelOptions extends HpsConnectTarget {
  /** Kennung der URSPRUENGLICHEN Zahlung — keine neue. */
  transactionId: string;
  /** Pflicht: das Terminal weist einen Void ohne Betrag mit `400 Missing amount` ab. */
  amountCents: number;
  currency?: string;
  language?: string;
}

/** Austauschbare `fetch`-Umsetzung, minimal genug fuer eine Attrappe im Test. */
export interface HpsConnectFetchResponse {
  status: number;
  text(): Promise<string>;
}
export type HpsConnectFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<HpsConnectFetchResponse>;

export interface HpsConnectClientOptions {
  /** Basisadresse des Agenten. Vorgabe `http://127.0.0.1:27182` (README `kasseneck-connect`). */
  baseUrl?: string;
  /** Kopplungstoken, geht als `Authorization: Bearer <token>` mit. */
  token: string;
  /**
   * Zeitlimit fuer `status`/`abort`/`diagnosis` in ms. Vorgabe 30 s — deutlich
   * ueber Connects eigenem `hpsKurzTimeout` (15 s), damit dieser Client nicht
   * VOR Connect selbst aufgibt und dessen Fehlermeldung verschluckt.
   */
  shortTimeoutMs?: number;
  /**
   * Zeitlimit fuer `payment` in ms. Vorgabe 4,5 Minuten — ueber Connects
   * eigenem `hpsZahlungTimeout` (4 Minuten): eine Zahlung blockiert, bis der
   * Karteninhaber fertig ist, das darf nicht vorzeitig aufgegeben werden.
   */
  paymentTimeoutMs?: number;
  /** Eigene `fetch`-Umsetzung (Tests). Vorgabe: globales `fetch`. */
  fetch?: HpsConnectFetch;
}

export interface HpsConnectClient {
  payment(options: HpsConnectPaymentOptions): Promise<HpsTransactionResponse>;
  status(options: HpsConnectTransactionOptions): Promise<HpsTransactionResponse>;
  abort(options: HpsConnectTransactionOptions): Promise<HpsTransactionResponse>;
  /** Gutschrift — ein Kartenfluss wie [payment], deshalb dieselbe lange Frist. */
  refund(options: HpsConnectRefundOptions): Promise<HpsTransactionResponse>;
  /** Aufhebung (Storno/Void) — kurzer Aufruf, keine Karteninteraktion. */
  cancel(options: HpsConnectCancelOptions): Promise<HpsTransactionResponse>;
  /** Erreichbarkeits-/Firmware-Check, folgenlos. Rohe Nutzlast, Connect ordnet nichts ein. */
  diagnosis(options: HpsConnectTarget): Promise<Record<string, unknown>>;
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:27182';
const DEFAULT_SHORT_TIMEOUT_MS = 30_000;
const DEFAULT_PAYMENT_TIMEOUT_MS = 4 * 60_000 + 30_000;

export function createHpsConnectClient(options: HpsConnectClientOptions): HpsConnectClient {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const token = options.token;
  const shortTimeoutMs = options.shortTimeoutMs ?? DEFAULT_SHORT_TIMEOUT_MS;
  const paymentTimeoutMs = options.paymentTimeoutMs ?? DEFAULT_PAYMENT_TIMEOUT_MS;
  const holen = options.fetch ?? globalHpsConnectFetch();

  async function rufen(path: string, body: Record<string, unknown>, timeoutMs: number): Promise<Record<string, unknown>> {
    const abbruch = new AbortController();
    const wecker = setTimeout(() => abbruch.abort(), timeoutMs);
    let antwort: HpsConnectFetchResponse;
    let text: string;
    try {
      try {
        antwort = await holen(`${baseUrl}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
          signal: abbruch.signal,
        });
        text = await antwort.text();
      } catch (ursache) {
        // Connect selbst nicht erreichbar (Agent nicht gestartet, falscher
        // Port, Zeitueberschreitung dieses Aufrufs). Kein Terminal-Kontakt
        // versucht -- das entscheidet payments.ts aber nicht hier, sondern
        // ueber die Fehlerart: [HpsConnectTransportError] wird dort wie jeder
        // andere Transportfehler behandelt (klaeren, niemals `declined`).
        const grund = abbruch.signal.aborted ? `Zeitueberschreitung nach ${timeoutMs} ms` : String(ursache);
        throw new HpsConnectTransportError(`Kasseneck Connect nicht erreichbar (${baseUrl}): ${grund}`);
      }
    } finally {
      clearTimeout(wecker);
    }

    let huelle: unknown;
    try {
      huelle = text.trim() === '' ? null : JSON.parse(text);
    } catch {
      throw new HpsConnectTransportError(
        `Antwort von Kasseneck Connect ist kein JSON (HTTP ${antwort.status})`,
      );
    }
    if (huelle === null || typeof huelle !== 'object' || !('ok' in huelle)) {
      throw new HpsConnectTransportError(
        `Antwort von Kasseneck Connect ohne "ok"-Feld (HTTP ${antwort.status})`,
      );
    }
    const h = huelle as {
      ok: unknown;
      hps?: unknown;
      error?: { code?: unknown; message?: unknown; detail?: unknown };
    };
    if (h.ok === true) {
      return (h as Record<string, unknown>);
    }

    const code = typeof h.error?.code === 'string' ? h.error.code : undefined;
    const message = typeof h.error?.message === 'string' && h.error.message.trim() !== ''
      ? h.error.message
      : `Kasseneck Connect meldet einen Fehler (HTTP ${antwort.status})`;

    if (code !== undefined && PREFLIGHT_CONNECT_CODES.has(code)) {
      // Siehe errors.ts: diese Codes entstehen laut `kasseneck-connect`
      // ausnahmslos VOR jedem Terminal-Kontakt -- beweisbar nichts gesendet.
      throw new HpsPreflightError(message, code);
    }
    // terminal_error / timeout / terminal_offline -- oder ein Code, den
    // dieses Paket nicht kennt. Bewusst dieselbe Klasse fuer beide: ein
    // unbekannter Code ist keine bewiesene Nicht-Aussendung, siehe
    // PREFLIGHT_CONNECT_CODES.
    //
    // `error.detail.terminalHttpStatus` reist seit `kasseneck-connect`
    // Commit `0fb6f66` mit, wenn das TERMINAL selbst einen HTTP-Status
    // genannt hat (nie bei einem Transportfehler -- der erfindet keinen
    // Status). Siehe errors.ts, `HpsConnectTerminalError.isTerminalBusy`.
    const detail = h.error?.detail as { terminalHttpStatus?: unknown } | undefined;
    const terminalHttpStatus = typeof detail?.terminalHttpStatus === 'number' ? detail.terminalHttpStatus : undefined;
    throw new HpsConnectTerminalError(code ?? 'unbekannt', message, terminalHttpStatus);
  }

  function checkedTransactionId(value: string): string {
    if (!isValidHpsTransactionId(value)) {
      throw new HpsTransactionIdError(value);
    }
    return value;
  }

  function target(t: HpsConnectTarget): Record<string, unknown> {
    return { host: t.host, port: t.port, tid: t.tid };
  }

  return {
    async payment(o) {
      const transactionId = checkedTransactionId(o.transactionId);
      const antwort = await rufen(
        '/v1/terminal/payment',
        {
          ...target(o),
          transactionId,
          amountCents: o.amountCents,
          tipCents: o.tipCents,
          reference: o.reference,
          currency: o.currency,
          language: o.language,
        },
        paymentTimeoutMs,
      );
      return parseHpsTransactionResponse(antwort['hps']);
    },

    async status(o) {
      const transactionId = checkedTransactionId(o.transactionId);
      const antwort = await rufen('/v1/terminal/status', { ...target(o), transactionId }, shortTimeoutMs);
      return parseHpsTransactionResponse(antwort['hps']);
    },

    async abort(o) {
      const transactionId = checkedTransactionId(o.transactionId);
      const antwort = await rufen('/v1/terminal/abort', { ...target(o), transactionId }, shortTimeoutMs);
      return parseHpsTransactionResponse(antwort['hps']);
    },

    async refund(o) {
      // Beide Kennungen gehen ans Terminal -- beide muessen die
      // Ziffernpruefung bestehen, sonst ist der Vorgang spaeter dauerhaft
      // unauffindbar (siehe HpsClient._checkTransactionId im Dart-Zwilling).
      const transactionId = checkedTransactionId(o.transactionId);
      const originalTransactionId = checkedTransactionId(o.originalTransactionId);
      const antwort = await rufen(
        '/v1/terminal/refund',
        {
          ...target(o),
          transactionId,
          originalTransactionId,
          amountCents: o.amountCents,
          reference: o.reference,
          currency: o.currency,
          language: o.language,
        },
        // Gutschrift ist ein Kartenfluss wie die Zahlung -- dieselbe lange Frist.
        paymentTimeoutMs,
      );
      return parseHpsTransactionResponse(antwort['hps']);
    },

    async cancel(o) {
      // Hier ist [transactionId] die der URSPRUENGLICHEN Zahlung -- die
      // Ziffernpruefung gilt trotzdem unveraendert, sonst liefe die
      // anschliessende Statusabfrage darauf ins Leere.
      const transactionId = checkedTransactionId(o.transactionId);
      const antwort = await rufen(
        '/v1/terminal/cancel',
        {
          ...target(o),
          transactionId,
          amountCents: o.amountCents,
          currency: o.currency,
          language: o.language,
        },
        shortTimeoutMs,
      );
      return parseHpsTransactionResponse(antwort['hps']);
    },

    async diagnosis(o) {
      const antwort = await rufen('/v1/terminal/diagnosis', target(o), shortTimeoutMs);
      const hps = antwort['hps'];
      return hps !== null && typeof hps === 'object' && !Array.isArray(hps) ? (hps as Record<string, unknown>) : {};
    },
  };
}

function globalHpsConnectFetch(): HpsConnectFetch {
  const umgebung = globalThis as { fetch?: HpsConnectFetch };
  if (typeof umgebung.fetch !== 'function') {
    throw new Error(
      'createHpsConnectClient: kein globales fetch vorhanden -- Node >= 20.18 verwenden oder eine fetch-Umsetzung uebergeben',
    );
  }
  return (url, init) => umgebung.fetch!(url, init);
}
