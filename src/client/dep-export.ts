import { KasseneckApiError, KasseneckHttpError, KasseneckNetworkError, KasseneckValidationError } from './errors.js';
import type { InternerDateiOderDatenTransport, InternerTransport } from './aufrufe.js';
import type { FetchLike } from './transport.js';

/**
 * DEP-Export fuer die Kassennachschau (nur unter `/v3`): ein Export des
 * Datenerfassungsprotokolls fuer einen vom Pruefungsorgan vorgegebenen
 * Zeitraum (§ 19 Abs. 2 RKSV), Dateien zum Abholen und ein Pruefer-Link mit
 * Code, ueber den das Pruefungsorgan die Dateien ohne Anmeldung laedt.
 *
 * **Anmeldung wie `listReceipts`:** API-Schluessel plus `cashregister-token`;
 * die Kasse kommt aus dem Token, nie aus einem Parameter. Ein Export einer
 * anderen Kasse ist `export_not_found`.
 *
 * **Ablauf:** `createDepExport` stellt den Export ein und antwortet sofort
 * (`status: 'running'`; eine Wiederholung mit derselben `requestId` nennt den
 * aktuellen Stand); er laeuft im Hintergrund. `waitForDepExport` fragt bis zum
 * Ende, `getDepExportFile` holt eine Datei, `createDepHandoverLink` erzeugt den
 * Link fuer das Pruefungsorgan.
 */

/** Zustand eines Exports: in Arbeit, fertig oder fehlgeschlagen. */
export const DEP_EXPORT_STATUSES = Object.freeze(['running', 'done', 'failed'] as const);
export type DepExportStatus = (typeof DEP_EXPORT_STATUSES)[number];

/** Die Dateien eines Exports: DEP-JSON, Protokoll (PDF), Positionen (CSV) und alles zusammen als ZIP. */
export const DEP_EXPORT_FILES = Object.freeze(['dep', 'protocol', 'items', 'zip'] as const);
export type DepExportFileKind = (typeof DEP_EXPORT_FILES)[number];

/**
 * Fehlercodes der fuenf Aufrufe (`code` des [KasseneckApiError]) wie im
 * Vertrag des Backends (`errorCodes.depExport` in `fixtures/v3/v3-vokabular.json`,
 * Katalog `dep_nachschau`), in dessen Reihenfolge; dazu kommen die gemeinsamen
 * Codes von Anmeldung und Rand. Ein Code ausserhalb bleibt ueber
 * `KasseneckApiError.code` lesbar.
 */
export const DEP_EXPORT_ERROR_CODES = Object.freeze([
  'validation', // ungueltige requestId (Details in den Feldfehlern)
  'invalid_period', // from/to kein Datum JJJJ-MM-TT, from in der Zukunft oder to vor from
  'idempotency_conflict', // dieselbe requestId gehoert zu einem Export mit anderem Zeitraum
  'export_running', // fuer diese Kasse laeuft schon ein Export (`details.exportId` nennt ihn)
  'too_many_exports', // Tagesgrenze der Exporte erreicht
  'export_not_found', // unbekannt oder einer anderen Kasse
  'export_not_ready', // Datei oder Link nur zu einem fertigen Export
  'export_failed', // der Export ist fehlgeschlagen
  'invalid_file', // keine der Dateien dep, protocol, items, zip
  'file_not_available', // diese Datei gibt es zu diesem Export nicht (etwa Positionen bei einem alten Export)
  'too_many_links', // Grenze der aktiven Links je Export oder der neuen Links je Tag erreicht
  'link_not_found', // unbekannt oder einer anderen Kasse (ein schon widerrufener Link ist kein Fehler: der Widerruf ist wiederholbar)
  'manager_only', // Kassenweg: nur der Chef (Inhaber oder Recht layout) exportiert; ein Kassier sieht den Hinweis
  'server_error',
] as const);

/**
 * Warum ein Export fehlgeschlagen ist (`DepExport.error`): die Werte des
 * Katalogs `DEP_EXPORT_FEHLER` im Vertrag. `export_stalled` = nach 35 Minuten
 * nicht fertig.
 */
export const DEP_EXPORT_FAILURES = Object.freeze(['export_failed', 'export_stalled'] as const);
export type DepExportFailure = (typeof DEP_EXPORT_FAILURES)[number];

/**
 * Codes, die die DEP-Aufrufe als `KasseneckApiError.code` werfen:
 * [DEP_EXPORT_ERROR_CODES] und, aus [waitForDepExport], die Gruende eines
 * fehlgeschlagenen Exports ([DEP_EXPORT_FAILURES], also auch `export_stalled`).
 */
export type DepExportErrorCode = (typeof DEP_EXPORT_ERROR_CODES)[number] | DepExportFailure;

/** Eingabe von [createDepExport]. Ohne `from`/`to` der ganze Bestand. */
export interface CreateDepExportOptions {
  /** Erster Tag (inklusive), `YYYY-MM-DD`, nicht in der Zukunft. */
  from?: string;
  /** Letzter Tag (inklusive), `YYYY-MM-DD`, nicht vor `from`. */
  to?: string;
  /**
   * Wiederholungsschutz je Kasse: derselbe Wert mit demselben Zeitraum
   * liefert denselben Export (mit seinem aktuellen Stand) statt eines zweiten;
   * mit anderem Zeitraum `idempotency_conflict`. Hoechstens 64 Zeichen aus
   * `A-Z a-z 0-9 _ -`. Bei unklarem Ausgang (Zeitlimit) mit **demselben** Wert
   * und demselben Zeitraum wiederholen.
   */
  requestId?: string;
}

/** Antwort von [createDepExport]: Kennung und Zustand (bei einer wiederholten `requestId` auch `done`). */
export interface CreateDepExportResult {
  exportId: string;
  status: DepExportStatus;
  from: string | null;
  to: string | null;
}

/** Eine Luecke in der Belegnummerierung: Zaehler von bis (einschliesslich). */
export interface DepExportGap {
  from: number;
  to: number;
}

/** Erster Bruch der Signaturkette: am Zaehler `counter` erwartet, aber gefunden. */
export interface DepExportChainBreak {
  counter: number | null;
  expected: unknown;
  found: unknown;
}

/** Befund der Pruefung des Exports (`DepExport.findings`). */
export interface DepExportFindings {
  receiptCount: number | null;
  counterFrom: number | null;
  counterTo: number | null;
  /** Fehlende Belegnummern als zusammenhaengende Bereiche. */
  gaps: DepExportGap[];
  /** Hoechstens ein Eintrag: der erste Bruch der Kette. */
  chainBreaks: DepExportChainBreak[];
  /** `receiptId` der Belege ohne Zaehler. */
  withoutCounter: string[];
  /** `receiptId` der Belege ohne Signatur. */
  withoutSignature: string[];
}

/** Die Positionsdatei (CSV) eines Exports; `null` bei Exporten aus der Zeit davor. */
export interface DepExportItems {
  rowCount: number;
  sha256: string;
  size: number;
}

/** Ein Pruefer-Link, wie ihn der Export auffuehrt (ohne Adresse und Code). */
export interface DepHandoverLinkInfo {
  linkId: string;
  createdAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  firstAccessAt: string | null;
  accessCount: number;
}

/** Ein Export mit Zustand, Kennzahlen, Befund und Links (`getDepExport`). Zeiten ISO 8601 (UTC). */
export interface DepExport {
  exportId: string;
  status: DepExportStatus;
  from: string | null;
  to: string | null;
  createdAt: string | null;
  finishedAt: string | null;
  receiptCount: number | null;
  counterFrom: number | null;
  counterTo: number | null;
  /** SHA-256 (hex) der DEP-JSON-Datei. */
  sha256: string | null;
  /** Groesse der DEP-JSON-Datei in Byte. */
  size: number | null;
  findings: DepExportFindings | null;
  items: DepExportItems | null;
  handoverLinks: DepHandoverLinkInfo[];
  /** Nur bei `status: 'failed'`: `export_stalled` (haengend) oder `export_failed`. */
  error?: DepExportFailure;
}

/** Eingabe von [waitForDepExport]. */
export interface WaitForDepExportOptions {
  exportId: string;
  /** Hoechstdauer in Millisekunden (Vorgabe 600.000 = 10 Minuten). */
  timeoutMs?: number;
}

/** Eingabe von [getDepExportFile]. */
export interface GetDepExportFileOptions {
  exportId: string;
  file: DepExportFileKind;
  /**
   * Bekannte SHA-256-Pruefsumme (hex) der Datei, etwa `DepExport.sha256` fuer
   * `dep` oder `DepExport.items.sha256` fuer `items`. Weicht die geladene Datei
   * ab, wirft der Aufruf. Bei einem Lese-Link prueft der Aufruf ausserdem immer
   * gegen die Pruefsumme, die der Server mit dem Link nennt.
   */
  sha256?: string;
  /**
   * Zeitlimit in Millisekunden (Vorgabe 600.000), je fuer den Aufruf selbst und
   * fuer das Laden ueber einen Lese-Link. Der Aufruf liefert eine Datei bis
   * 9 MiB direkt und braucht dafuer mehr als das allgemeine Zeitlimit des
   * Transports (`timeoutMs`, Vorgabe 30 s); es gilt hier nicht.
   */
  downloadTimeoutMs?: number;
}

/** Eine geladene, gepruefte Datei. */
export interface DepExportFile {
  bytes: Uint8Array;
  fileName: string;
  contentType: string;
  /** SHA-256 (hex) der Bytes, vom Paket berechnet. */
  sha256: string;
}

/** Ein erzeugter Pruefer-Link (`createDepHandoverLink`). Adresse und Code nur jetzt, danach nie wieder. */
export interface DepHandoverLink {
  linkId: string;
  /** Adresse fuer das Pruefungsorgan (Token im Fragment). */
  url: string;
  /** 6-stelliger Code, getrennt von der Adresse zu uebergeben. */
  code: string;
  expiresAt: string;
}

/** Antwort von [revokeDepHandoverLink]. */
export interface RevokedDepHandoverLink {
  linkId: string;
  revokedAt: string | null;
}

/** Wartezeiten von [waitForDepExport]: 2 s, dann je x1,5, hoechstens 15 s. */
export const DEP_EXPORT_POLL_START_MS = 2_000;
export const DEP_EXPORT_POLL_FACTOR = 1.5;
export const DEP_EXPORT_POLL_MAX_MS = 15_000;
/** Vorgabe fuer `waitForDepExport.timeoutMs`. */
export const DEP_EXPORT_WAIT_TIMEOUT_MS = 600_000;
/** Vorgabe fuer `getDepExportFile.downloadTimeoutMs`: der Aufruf selbst und das Laden ueber einen Lese-Link. */
export const DEP_EXPORT_DOWNLOAD_TIMEOUT_MS = 600_000;

/**
 * [waitForDepExport] gab auf, weil der Export nach `timeoutMs` weder fertig
 * noch fehlgeschlagen war. Der Export laeuft serverseitig weiter: mit
 * `getDepExport` (oder erneutem Warten) nachsehen, nicht neu anstossen.
 */
export class DepExportTimeoutError extends Error {
  readonly name = 'DepExportTimeoutError';
  readonly exportId: string;
  readonly timeoutMs: number;
  /** Zustand bei der letzten Abfrage. */
  readonly lastStatus: DepExportStatus;

  constructor(exportId: string, timeoutMs: number, lastStatus: DepExportStatus) {
    super(`waitForDepExport: Export ${exportId} nach ${timeoutMs} ms nicht fertig (Zustand ${lastStatus})`);
    this.exportId = exportId;
    this.timeoutMs = timeoutMs;
    this.lastStatus = lastStatus;
  }
}

/** Das Ergebnis stimmt nicht mit der Pruefsumme ueberein: die Datei ist nicht zu verwenden. */
export class DepExportChecksumError extends KasseneckValidationError {
  readonly expected: string;
  readonly actual: string;

  constructor(exportId: string, file: DepExportFileKind, expected: string, actual: string) {
    super('getDepExportFile', `Pruefsumme der Datei ${file} von ${exportId} stimmt nicht (erwartet ${expected}, berechnet ${actual})`, 'response');
    this.expected = expected;
    this.actual = actual;
  }
}

// ---- Hilfen -------------------------------------------------------------------------------------

const TAG = /^\d{4}-\d{2}-\d{2}$/;
const ANFRAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SHA256 = /^[0-9a-f]{64}$/i;

const VORGABEN: Record<DepExportFileKind, { fileName: (id: string) => string; contentType: string }> = {
  dep: { fileName: (id) => `${id}.json`, contentType: 'application/json' },
  protocol: { fileName: (id) => `${id}.pdf`, contentType: 'application/pdf' },
  items: { fileName: (id) => `${id}_positionen.csv`, contentType: 'text/csv; charset=utf-8' },
  zip: { fileName: (id) => `${id}.zip`, contentType: 'application/zip' },
};

function eingabefehler(name: string, grund: string): KasseneckValidationError {
  return new KasseneckValidationError(name, grund, 'request');
}

function antwortfehler(name: string, grund: string): KasseneckValidationError {
  return new KasseneckValidationError(name, grund, 'response');
}

const istObjekt = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function pruefeKennung(name: string, feld: string, wert: unknown): string {
  if (typeof wert !== 'string' || wert.trim() === '') throw eingabefehler(name, `${feld} fehlt oder ist leer`);
  return wert;
}

/** Ist das ein echter Kalendertag `JJJJ-MM-TT`? (Rechnung ohne Zeitzone.) */
function istKalendertag(text: string): boolean {
  if (!TAG.test(text)) return false;
  const [j, m, t] = text.split('-').map(Number) as [number, number, number];
  const d = new Date(Date.UTC(j, m - 1, t));
  return d.getUTCFullYear() === j && d.getUTCMonth() === m - 1 && d.getUTCDate() === t;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const umgebung = globalThis as { crypto?: { subtle?: { digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer> } } };
  const subtle = umgebung.crypto?.subtle;
  if (!subtle) throw new Error('getDepExportFile: kein globales crypto.subtle vorhanden — Node >= 20.18 verwenden');
  const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

function exportAus(daten: unknown, name: string): DepExport {
  if (!istObjekt(daten)) throw antwortfehler(name, 'Antwort enthaelt keine Daten (data fehlt)');
  const status = daten['status'];
  if (typeof daten['exportId'] !== 'string' || !(DEP_EXPORT_STATUSES as readonly unknown[]).includes(status)) {
    throw antwortfehler(name, 'Antwort ohne exportId oder mit unbekanntem Zustand');
  }
  if (!Array.isArray(daten['handoverLinks'])) throw antwortfehler(name, 'Antwort ohne handoverLinks');
  return daten as unknown as DepExport;
}

// ---- Aufrufe ------------------------------------------------------------------------------------

/**
 * Stellt einen DEP-Export ein (`createDepExport`) und antwortet sofort mit
 * `status: 'running'`. Hoechstens ein laufender Export je Kasse
 * (`export_running`, `details.exportId` nennt ihn). Mit `requestId` ist der
 * Aufruf wiederholbar: dieselbe Kennung mit demselben Zeitraum liefert den
 * bestehenden Export mit seinem aktuellen Stand (auch `done` oder `failed`),
 * mit anderem Zeitraum `idempotency_conflict`.
 */
export async function createDepExport(transport: InternerTransport, options: CreateDepExportOptions = {}): Promise<CreateDepExportResult> {
  const name = 'createDepExport';
  const params: Record<string, unknown> = {};
  for (const feld of ['from', 'to'] as const) {
    const wert = options[feld];
    if (wert === undefined) continue;
    if (typeof wert !== 'string' || !istKalendertag(wert)) throw eingabefehler(name, `${feld} muss ein Datum JJJJ-MM-TT sein`);
    params[feld] = wert;
  }
  if (options.from !== undefined && options.to !== undefined && options.to < options.from) {
    throw eingabefehler(name, 'to liegt vor from');
  }
  if (options.requestId !== undefined) {
    if (typeof options.requestId !== 'string' || !ANFRAGE_ID.test(options.requestId)) {
      throw eingabefehler(name, 'requestId: hoechstens 64 Zeichen aus A-Z, a-z, 0-9, _ und -');
    }
    params['requestId'] = options.requestId;
  }
  const daten = await transport<unknown>(name, params);
  if (!istObjekt(daten) || typeof daten['exportId'] !== 'string' || !(DEP_EXPORT_STATUSES as readonly unknown[]).includes(daten['status'])) {
    throw antwortfehler(name, 'Antwort ohne exportId oder mit unbekanntem Zustand');
  }
  return daten as unknown as CreateDepExportResult;
}

/** Zustand, Kennzahlen, Befund und Links eines Exports (`getDepExport`). */
export async function getDepExport(transport: InternerTransport, options: { exportId: string }): Promise<DepExport> {
  const name = 'getDepExport';
  const exportId = pruefeKennung(name, 'exportId', options?.exportId);
  return exportAus(await transport<unknown>(name, { exportId }), name);
}

/**
 * Wartet, bis der Export fertig ist, und gibt ihn zurueck. Fragt mit
 * [DEP_EXPORT_POLL_START_MS] Abstand, dann je x[DEP_EXPORT_POLL_FACTOR],
 * hoechstens [DEP_EXPORT_POLL_MAX_MS]. Bei `failed` wirft er einen
 * [KasseneckApiError] mit `code` `export_failed` oder `export_stalled`
 * (haengender Export); nach `timeoutMs` einen [DepExportTimeoutError]. Ein
 * Fehler beim Abfragen selbst bricht ab.
 */
export async function waitForDepExport(transport: InternerTransport, options: WaitForDepExportOptions): Promise<DepExport> {
  const name = 'waitForDepExport';
  const exportId = pruefeKennung(name, 'exportId', options?.exportId);
  const timeoutMs = options.timeoutMs ?? DEP_EXPORT_WAIT_TIMEOUT_MS;
  if (!(typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0)) {
    throw eingabefehler(name, 'timeoutMs muss eine positive Zahl sein');
  }
  const ende = Date.now() + timeoutMs;
  let abstand = DEP_EXPORT_POLL_START_MS;
  for (;;) {
    const stand = await getDepExport(transport, { exportId });
    if (stand.status === 'done') return stand;
    if (stand.status === 'failed') {
      throw new KasseneckApiError(
        'getDepExport',
        stand.error === 'export_stalled' ? 'Der Export haengt (Stillstand).' : 'Der Export ist fehlgeschlagen.',
        { exportId, error: stand.error ?? 'export_failed' },
        stand.error ?? 'export_failed',
      );
    }
    const rest = ende - Date.now();
    if (rest <= 0) throw new DepExportTimeoutError(exportId, timeoutMs, stand.status);
    await new Promise<void>((weiter) => setTimeout(weiter, Math.min(abstand, rest)));
    abstand = Math.min(abstand * DEP_EXPORT_POLL_FACTOR, DEP_EXPORT_POLL_MAX_MS);
  }
}

function linkAus(name: string, wert: unknown): { url: string; expiresAt: string; size: number; sha256: string; fileName: string; contentType: string } {
  if (!istObjekt(wert)) throw antwortfehler(name, 'Antwort ist weder eine Datei noch ein Lese-Link (data.download fehlt)');
  const { url, expiresAt, size, sha256, fileName, contentType } = wert;
  if (
    typeof url !== 'string' || typeof expiresAt !== 'string' || typeof fileName !== 'string' || typeof contentType !== 'string' ||
    typeof sha256 !== 'string' || !SHA256.test(sha256) || typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0
  ) {
    throw antwortfehler(name, 'Lese-Link unvollstaendig (url, expiresAt, size, sha256, fileName, contentType)');
  }
  let adresse: URL;
  try {
    adresse = new URL(url);
  } catch {
    throw antwortfehler(name, 'Lese-Link ist keine Adresse');
  }
  const lokal = adresse.hostname === 'localhost' || adresse.hostname === '127.0.0.1' || adresse.hostname === '[::1]';
  if (adresse.protocol !== 'https:' && !(adresse.protocol === 'http:' && lokal)) {
    throw antwortfehler(name, 'Lese-Link ist keine https-Adresse');
  }
  return { url, expiresAt, size, sha256: sha256.toLowerCase(), fileName, contentType };
}

/** Laedt die Bytes hinter einem Lese-Link. Fehlertexte und Fehlerobjekte nennen die Adresse nie (sie traegt die Berechtigung). */
async function ladeLink(fetchFn: FetchLike, url: string, timeoutMs: number): Promise<Uint8Array> {
  const name = 'getDepExportFile';
  const abbruch = new AbortController();
  let abgelaufen = false;
  const wecker = setTimeout(() => {
    abgelaufen = true;
    abbruch.abort();
  }, timeoutMs);
  try {
    // Ein GET ohne Rumpf und ohne eigene Kopfzeilen; FetchLike verlangt formal einen Rumpf, den ein GET nicht tragen darf.
    const antwort = await fetchFn(url, { method: 'GET', headers: {}, signal: abbruch.signal } as unknown as Parameters<FetchLike>[1]);
    if (antwort.status !== 200) {
      throw new KasseneckHttpError(name, antwort.status, antwort.headers.get('content-type') ?? undefined, 'server-error', 'rejected');
    }
    return new Uint8Array(await antwort.arrayBuffer());
  } catch (ursache) {
    if (ursache instanceof KasseneckHttpError) throw ursache;
    throw new KasseneckNetworkError(name, abgelaufen, timeoutMs, {}, 'rejected');
  } finally {
    clearTimeout(wecker);
  }
}

/**
 * Holt eine Datei eines fertigen Exports (`getDepExportFile`). Der Server
 * liefert sie bis 9 MiB selbst, darueber als signierten Lese-Link (15 Minuten);
 * dem Link folgt dieser Aufruf und laedt die Bytes. In beiden Faellen ist das
 * Ergebnis dasselbe. Geprueft wird die SHA-256-Summe: beim Lese-Link immer
 * gegen die Summe des Servers, sonst und zusaetzlich gegen `options.sha256`,
 * wenn sie bekannt ist. Eine Abweichung wirft [DepExportChecksumError].
 */
export async function getDepExportFile(
  transport: InternerDateiOderDatenTransport,
  fetchFn: FetchLike,
  options: GetDepExportFileOptions,
): Promise<DepExportFile> {
  const name = 'getDepExportFile';
  const exportId = pruefeKennung(name, 'exportId', options?.exportId);
  if (!(DEP_EXPORT_FILES as readonly unknown[]).includes(options.file)) {
    throw eingabefehler(name, 'file muss dep, protocol, items oder zip sein');
  }
  if (options.sha256 !== undefined && !(typeof options.sha256 === 'string' && SHA256.test(options.sha256))) {
    throw eingabefehler(name, 'sha256 muss 64 Hexzeichen haben');
  }
  const frist = options.downloadTimeoutMs ?? DEP_EXPORT_DOWNLOAD_TIMEOUT_MS;
  if (!(typeof frist === 'number' && Number.isFinite(frist) && frist > 0)) {
    throw eingabefehler(name, 'downloadTimeoutMs muss eine positive Zahl sein');
  }
  const bekannt = options.sha256?.toLowerCase();
  const vorgabe = VORGABEN[options.file];

  // Eine direkte Datei (bis 9 MiB) kommt im Aufruf selbst: dieselbe Frist wie das Laden ueber den Link, nicht die 30 s
  // des Transports.
  const ergebnis = await transport(name, { exportId, file: options.file }, { timeoutMs: frist });
  let bytes: Uint8Array;
  let fileName: string;
  let contentType: string;
  let vomServer: string | undefined;
  if ('file' in ergebnis) {
    bytes = ergebnis.file.bytes;
    fileName = ergebnis.file.fileName ?? vorgabe.fileName(exportId);
    contentType = ergebnis.file.contentType ?? vorgabe.contentType;
  } else {
    const link = linkAus(name, istObjekt(ergebnis.data) ? ergebnis.data['download'] : undefined);
    bytes = await ladeLink(fetchFn, link.url, frist);
    if (bytes.length !== link.size) {
      throw antwortfehler(name, `Die geladene Datei hat ${bytes.length} Byte, der Server nannte ${link.size}`);
    }
    fileName = link.fileName;
    contentType = link.contentType;
    vomServer = link.sha256;
  }
  const summe = await sha256Hex(bytes);
  for (const erwartet of [vomServer, bekannt]) {
    if (erwartet !== undefined && erwartet !== summe) throw new DepExportChecksumError(exportId, options.file, erwartet, summe);
  }
  return { bytes, fileName, contentType, sha256: summe };
}

/** Erzeugt einen Pruefer-Link zu einem fertigen Export (`createDepHandoverLink`). Gueltig 14 Tage. */
export async function createDepHandoverLink(transport: InternerTransport, options: { exportId: string }): Promise<DepHandoverLink> {
  const name = 'createDepHandoverLink';
  const exportId = pruefeKennung(name, 'exportId', options?.exportId);
  const daten = await transport<unknown>(name, { exportId });
  if (
    !istObjekt(daten) || typeof daten['linkId'] !== 'string' || typeof daten['url'] !== 'string' ||
    typeof daten['code'] !== 'string' || typeof daten['expiresAt'] !== 'string'
  ) {
    throw antwortfehler(name, 'Antwort ohne linkId, url, code oder expiresAt');
  }
  return { linkId: daten['linkId'], url: daten['url'], code: daten['code'], expiresAt: daten['expiresAt'] };
}

/** Widerruft einen Pruefer-Link der eigenen Kasse (`revokeDepHandoverLink`). */
export async function revokeDepHandoverLink(transport: InternerTransport, options: { linkId: string }): Promise<RevokedDepHandoverLink> {
  const name = 'revokeDepHandoverLink';
  const linkId = pruefeKennung(name, 'linkId', options?.linkId);
  const daten = await transport<unknown>(name, { linkId });
  if (!istObjekt(daten) || typeof daten['linkId'] !== 'string') throw antwortfehler(name, 'Antwort ohne linkId');
  return { linkId: daten['linkId'], revokedAt: typeof daten['revokedAt'] === 'string' ? daten['revokedAt'] : null };
}
