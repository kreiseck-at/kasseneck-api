import { KasseneckValidationError } from './errors.js';
import type { ApiCall, InternerTransport } from './aufrufe.js';

/**
 * Kartenterminal am Handy (nur unter `/v3`): Kasseneck verwaltet die Zugaenge
 * der Terminal-App, die Terminal-IDs (TID) je Betrieb und den Code, den der
 * Anbieter beim Umzug einer TID auf ein anderes Geraet per E-Mail schickt.
 * Die App holt sich Zugang, TID und Code von hier; am Geraet tippt niemand
 * E-Mail, Passwort oder TID.
 *
 * **Anmeldung:** der `api_key` des Betriebs als Bearer. Ein `cashregister-token`
 * (wie ihn `apiKeyAuth` mitsendet) stoert nicht, wird aber nicht gebraucht; eine
 * App ohne Kasse nimmt eine Anmeldung nur mit dem Schluessel (etwa
 * `inventoryKeyAuth` aus `./inventory`). Das Geraet weist sich zusaetzlich mit
 * `deviceId` + `deviceSecret` aus, die es einmal mit [registerTerminalDevice]
 * bekommt. Am Kassenweg gibt es die Aufrufe noch nicht.
 *
 * **Geheimnisse:** `deviceSecret`, `password` und `code` stehen nur in den
 * Antworten bzw. Anfragen. Das Paket schreibt sie in kein Log und in keinen
 * Fehler (das Geraetegeheimnis geht als `secretParams` an den Transport); die
 * App darf sie ebenfalls nie loggen und speichert `deviceSecret` im sicheren
 * Speicher des Geraets.
 *
 * Geprueft wird hier nur die Form; was der Server nicht annimmt, lehnt er mit
 * einem Code aus [TERMINAL_ERROR_CODES] ab.
 */

/** Plattform des Geraets. */
export const TERMINAL_PLATFORMS = Object.freeze(['android', 'ios'] as const);
export type TerminalPlatform = (typeof TERMINAL_PLATFORMS)[number];

/**
 * Einrichtungsstand der Terminal-App am Geraet: TID zugewiesen, wartet auf den
 * Code, wird eingerichtet, bereit, fehlgeschlagen.
 */
export const TERMINAL_SETUP_STATES = Object.freeze(['assigned', 'waiting_for_code', 'setting_up', 'ready', 'failed'] as const);
export type TerminalSetupState = (typeof TERMINAL_SETUP_STATES)[number];

/**
 * Stand einer Code-Anfrage: keine Anfrage, sucht, gefunden, zugestellt,
 * unklar (mehrere Geraete warteten gleichzeitig), kein Code gefunden,
 * abgelaufen.
 */
export const TERMINAL_CODE_STATUSES = Object.freeze(['none', 'searching', 'found', 'delivered', 'unclear', 'no_code', 'expired'] as const);
export type TerminalCodeStatus = (typeof TERMINAL_CODE_STATUSES)[number];

/** Woher ein Code kam: aus dem Postfach oder vom Support eingetragen. */
export const TERMINAL_CODE_SOURCES = Object.freeze(['mailbox', 'support'] as const);
export type TerminalCodeSource = (typeof TERMINAL_CODE_SOURCES)[number];

/**
 * Fehlercodes der sieben Aufrufe (`code` des [KasseneckApiError]) wie im
 * Vertrag des Backends (`errorCodes.terminal` in `fixtures/v3/v3-vokabular.json`),
 * in dessen Reihenfolge; dazu kommen die gemeinsamen Codes von Anmeldung und
 * Rand. Ein Code ausserhalb bleibt ueber `KasseneckApiError.code` lesbar.
 */
export const TERMINAL_ERROR_CODES = Object.freeze([
  'terminal_not_enabled', // dem Betrieb ist keine aktive TID zugeordnet
  'terminal_test_environment', // nur in der Live-Umgebung (kein kr_test_-Schluessel)
  'terminal_device_unknown', // deviceId oder deviceSecret falsch (gleiche Antwort fuer beides)
  'terminal_device_blocked', // das Geraet ist gesperrt
  'invalid_terminal_device', // Angaben zum Geraet unvollstaendig oder ungueltig
  'too_many_terminal_devices', // Obergrenze der Geraete je Betrieb oder der Anmeldungen je Tag erreicht
  'terminal_not_in_business', // die TID gibt es nicht oder sie gehoert einem anderen Betrieb (gleiche Antwort)
  'terminal_code_manual', // Konto ohne Postfach: die App fragt nach dem Code
  'terminal_code_rate_limited', // hoechstens 6 Code-Anfragen je Geraet und Stunde
  'terminal_not_assigned', // dem Geraet ist keine TID zugeordnet: zuerst getTerminalAccess
  'terminal_fixed', // die TID gehoert fest einem anderen Geraet
  'terminal_device_fixed', // dem Geraet ist eine TID fest zugeordnet: Wechsel nur ueber den Support
  'server_error',
] as const);
export type TerminalErrorCode = (typeof TERMINAL_ERROR_CODES)[number];

/** Laengen der Texte, die der Server annimmt (nach Abzug von Leerraum am Rand). */
export const TERMINAL_LABEL_MAX = 60;
export const TERMINAL_APP_MAX = 40;
export const TERMINAL_REQUESTED_BY_MAX = 80;

/** Ausweis des Geraets, aus [registerTerminalDevice]. */
export interface TerminalDeviceCredentials {
  deviceId: string;
  /** Geheimnis des Geraets: nur im sicheren Speicher ablegen, nie loggen. */
  deviceSecret: string;
}

/** Eingabe von [registerTerminalDevice]. */
export interface RegisterTerminalDeviceOptions {
  /** Anzeige des Geraets, 1 bis 60 Zeichen (etwa Modell und Fahrer). */
  label: string;
  platform: TerminalPlatform;
  /** App und Version, 1 bis 40 Zeichen, z. B. `karteck/1.6.21`. */
  app: string;
  /** Wer das Geraet anmeldet, hoechstens 80 Zeichen; steht im Protokoll. */
  requestedBy?: string;
}

/** Antwort von [registerTerminalDevice]. `deviceSecret` kommt nur in dieser Antwort, danach nie wieder. */
export type RegisteredTerminalDevice = TerminalDeviceCredentials;

/** Eingabe von [getTerminalAccess]: Ausweis, dazu optional neue Anzeigewerte des Geraets. */
export interface GetTerminalAccessOptions extends TerminalDeviceCredentials {
  platform?: TerminalPlatform;
  /** App und Version, 1 bis 40 Zeichen. */
  app?: string;
  /** Anzeige des Geraets, 1 bis 60 Zeichen. */
  label?: string;
}

/** Eingabe von [claimTerminal]. */
export interface ClaimTerminalOptions extends TerminalDeviceCredentials {
  /** TID aus `TerminalAccessUnavailable.terminals`. */
  terminalId: string;
  /** Anzeige des Geraets, 1 bis 60 Zeichen. */
  label?: string;
}

/** Eingabe von [requestTerminalCode]. */
export interface RequestTerminalCodeOptions extends TerminalDeviceCredentials {
  platform: TerminalPlatform;
  /** Wer den Code anfragt, hoechstens 80 Zeichen; steht im Protokoll. */
  requestedBy?: string;
}

/** Eingabe von [reportTerminalLogin]. */
export interface ReportTerminalLoginOptions extends TerminalDeviceCredentials {
  /** TID, mit der sich die Terminal-App angemeldet hat. */
  terminalId: string;
  success: boolean;
  /** Erste Anmeldung dieser TID auf diesem Geraet. */
  newOnDevice: boolean;
}

/** Einrichtungsstand mit Zeitpunkt (ISO 8601, UTC). Ein spaeter ergaenzter Stand kommt unveraendert an. */
export interface TerminalSetup {
  state: TerminalSetupState | (string & {});
  since: string | null;
}

/** Wie die App einen eingefuegten Code prueft: Laenge und Bezeichnungen vor dem Code in der Mail. */
export interface TerminalCodeFormat {
  length: number;
  labels: string[];
}

/** Zugang fuer die Terminal-App ([getTerminalAccess], [claimTerminal]). */
export interface TerminalAccess {
  available: true;
  /** Login der Terminal-App. */
  username: string;
  /** Passwort der Terminal-App: nie loggen, nie dauerhaft ausserhalb des sicheren Speichers ablegen. */
  password: string;
  terminalId: string;
  terminalName: string | null;
  accountId: string;
  /** `true`: der Code kommt automatisch ([requestTerminalCode]); sonst fragt die App den Menschen danach. */
  autoCode: boolean;
  codeFormat: TerminalCodeFormat;
  setup: TerminalSetup;
  /** Letzte Aenderung von Konto oder Zuordnung (ISO 8601), `null` unbekannt. */
  updatedAt: string | null;
}

/** Eine TID des eigenen Betriebs, die gerade ein anderes Geraet nutzt. */
export interface TerminalListEntry {
  terminalId: string;
  name: string | null;
  /** Anzeige des Geraets, das sie zuletzt nutzte. */
  lastUsedBy: string | null;
  lastUsedAt: string | null;
}

/** Keine TID frei: die TIDs des eigenen Betriebs zur Auswahl fuer [claimTerminal]. */
export interface TerminalAccessUnavailable {
  available: false;
  reason: 'no_free_terminal' | (string & {});
  terminals: TerminalListEntry[];
}

/** Antwort von [getTerminalAccess]: Zugang oder Liste. */
export type TerminalAccessResult = TerminalAccess | TerminalAccessUnavailable;

/** Antwort von [requestTerminalCode]. */
export interface TerminalCodeRequest {
  status: TerminalCodeStatus | (string & {});
}

/**
 * Antwort von [getTerminalCode]. `code` (6 Zeichen, Gross-/Kleinschreibung
 * zaehlt) nur bei `found` bzw. auf iOS auch bei `delivered` bis `validUntil`.
 */
export interface TerminalCode {
  status: TerminalCodeStatus | (string & {});
  /** Der Code: nie loggen. */
  code?: string;
  source?: TerminalCodeSource | (string & {});
  validUntil?: string | null;
  setup: TerminalSetup;
}

// ---- Hilfen -------------------------------------------------------------------------------------

function eingabefehler(name: string, grund: string): KasseneckValidationError {
  return new KasseneckValidationError(name, grund, 'request');
}

function antwortfehler(name: string, grund: string): KasseneckValidationError {
  return new KasseneckValidationError(name, grund, 'response');
}

const istObjekt = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const istText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const textOderNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Pflichttext mit Hoechstlaenge (nach Abzug von Leerraum am Rand, wie der Server). */
function pruefeText(name: string, feld: string, wert: unknown, max: number): string {
  if (typeof wert !== 'string' || wert.trim() === '') throw eingabefehler(name, `${feld} fehlt oder ist leer`);
  if (wert.trim().length > max) throw eingabefehler(name, `${feld}: hoechstens ${max} Zeichen`);
  return wert;
}

function pruefePlattform(name: string, wert: unknown): TerminalPlatform {
  if (!(TERMINAL_PLATFORMS as readonly unknown[]).includes(wert)) throw eingabefehler(name, 'platform muss android oder ios sein');
  return wert as TerminalPlatform;
}

/** Ausweis des Geraets pruefen; die Meldung nennt nie das Geheimnis. */
function ausweis(name: string, options: TerminalDeviceCredentials | undefined): { params: Record<string, unknown>; geheim: string } {
  if (!istObjekt(options)) throw eingabefehler(name, 'Anfrage muss ein Objekt sein');
  if (!istText(options.deviceId)) throw eingabefehler(name, 'deviceId fehlt oder ist leer');
  if (!istText(options.deviceSecret)) throw eingabefehler(name, 'deviceSecret fehlt oder ist leer');
  return { params: { deviceId: options.deviceId, deviceSecret: options.deviceSecret }, geheim: options.deviceSecret };
}

/** Optionale Felder nur, wenn gesetzt. */
function optional(
  name: string,
  params: Record<string, unknown>,
  options: { platform?: unknown; app?: unknown; label?: unknown; requestedBy?: unknown },
): void {
  if (options.platform !== undefined) params['platform'] = pruefePlattform(name, options.platform);
  if (options.app !== undefined) params['app'] = pruefeText(name, 'app', options.app, TERMINAL_APP_MAX);
  if (options.label !== undefined) params['label'] = pruefeText(name, 'label', options.label, TERMINAL_LABEL_MAX);
  if (options.requestedBy !== undefined) params['requestedBy'] = pruefeText(name, 'requestedBy', options.requestedBy, TERMINAL_REQUESTED_BY_MAX);
}

function setupAus(name: string, wert: unknown): TerminalSetup {
  if (!istObjekt(wert) || typeof wert['state'] !== 'string') throw antwortfehler(name, 'Antwort ohne setup.state');
  return { state: wert['state'], since: textOderNull(wert['since']) };
}

/** Zugang aus der Antwort; die Meldungen nennen nie Login, Passwort oder TID. */
function zugangAus(name: string, d: Record<string, unknown>): TerminalAccess {
  if (!istText(d['username']) || !istText(d['password']) || !istText(d['terminalId']) || typeof d['accountId'] !== 'string') {
    throw antwortfehler(name, 'Zugang unvollstaendig (username, password, terminalId, accountId)');
  }
  if (typeof d['autoCode'] !== 'boolean') throw antwortfehler(name, 'Antwort ohne autoCode');
  const format = d['codeFormat'];
  if (
    !istObjekt(format) || !(typeof format['length'] === 'number' && Number.isSafeInteger(format['length']) && format['length'] > 0) ||
    !Array.isArray(format['labels']) || !format['labels'].every((l) => typeof l === 'string')
  ) {
    throw antwortfehler(name, 'Antwort ohne gueltiges codeFormat (length, labels)');
  }
  return {
    available: true,
    username: d['username'],
    password: d['password'],
    terminalId: d['terminalId'],
    terminalName: textOderNull(d['terminalName']),
    accountId: d['accountId'],
    autoCode: d['autoCode'],
    codeFormat: { length: format['length'], labels: [...(format['labels'] as string[])] },
    setup: setupAus(name, d['setup']),
    updatedAt: textOderNull(d['updatedAt']),
  };
}

function listeAus(name: string, d: Record<string, unknown>): TerminalAccessUnavailable {
  const roh = d['terminals'];
  if (typeof d['reason'] !== 'string' || !Array.isArray(roh)) throw antwortfehler(name, 'Antwort ohne reason oder terminals');
  const terminals: TerminalListEntry[] = [];
  for (const t of roh) {
    if (!istObjekt(t) || !istText(t['terminalId'])) throw antwortfehler(name, 'Eintrag in terminals ohne terminalId');
    terminals.push({
      terminalId: t['terminalId'],
      name: textOderNull(t['name']),
      lastUsedBy: textOderNull(t['lastUsedBy']),
      lastUsedAt: textOderNull(t['lastUsedAt']),
    });
  }
  return { available: false, reason: d['reason'], terminals };
}

async function zugangRufen(transport: InternerTransport, name: ApiCall, params: Record<string, unknown>, geheim: string): Promise<TerminalAccessResult> {
  const daten = await transport<unknown>(name, params, undefined, [geheim]);
  if (!istObjekt(daten) || typeof daten['available'] !== 'boolean') throw antwortfehler(name, 'Antwort ohne available');
  return daten['available'] ? zugangAus(name, daten) : listeAus(name, daten);
}

// ---- Aufrufe ------------------------------------------------------------------------------------

/**
 * Meldet ein Geraet einmal an (`registerTerminalDevice`) und liefert seinen
 * Ausweis. `deviceSecret` steht nur in dieser Antwort: im sicheren Speicher
 * ablegen, nie loggen. Hoechstens 20 Geraete je Betrieb und 10 Anmeldungen je
 * Tag (`too_many_terminal_devices`). Eine Wiederholung nach unklarem Ausgang
 * legt ein weiteres Geraet an.
 */
export async function registerTerminalDevice(transport: InternerTransport, options: RegisterTerminalDeviceOptions): Promise<RegisteredTerminalDevice> {
  const name = 'registerTerminalDevice';
  if (!istObjekt(options)) throw eingabefehler(name, 'Anfrage muss ein Objekt sein');
  const params: Record<string, unknown> = {
    label: pruefeText(name, 'label', options.label, TERMINAL_LABEL_MAX),
    platform: pruefePlattform(name, options.platform),
    app: pruefeText(name, 'app', options.app, TERMINAL_APP_MAX),
  };
  optional(name, params, { requestedBy: options.requestedBy });
  const daten = await transport<unknown>(name, params);
  if (!istObjekt(daten) || !istText(daten['deviceId']) || !istText(daten['deviceSecret'])) {
    throw antwortfehler(name, 'Antwort ohne deviceId oder deviceSecret');
  }
  return { deviceId: daten['deviceId'], deviceSecret: daten['deviceSecret'] };
}

/**
 * Zugang und TID fuer dieses Geraet (`getTerminalAccess`). Das Geraet behaelt
 * seine TID; ohne eine bekommt es eine freie seines Betriebs. Ist keine frei,
 * kommt `available: false` mit den TIDs des eigenen Betriebs zur Auswahl fuer
 * [claimTerminal]. Die App ruft das bei jedem Start und mindestens einmal am
 * Tag. `password` nie loggen.
 */
export async function getTerminalAccess(transport: InternerTransport, options: GetTerminalAccessOptions): Promise<TerminalAccessResult> {
  const name = 'getTerminalAccess';
  const { params, geheim } = ausweis(name, options);
  optional(name, params, { platform: options.platform, app: options.app, label: options.label });
  return zugangRufen(transport, name, params, geheim);
}

/**
 * Uebernimmt eine TID des eigenen Betriebs (`claimTerminal`); das Geraet, das
 * sie bisher nutzte, verliert sie. Antwort wie [getTerminalAccess] mit
 * Zugang. Eine fremde oder unbekannte TID ist `terminal_not_in_business`.
 */
export async function claimTerminal(transport: InternerTransport, options: ClaimTerminalOptions): Promise<TerminalAccess> {
  const name = 'claimTerminal';
  const { params, geheim } = ausweis(name, options);
  if (!istText(options.terminalId)) throw eingabefehler(name, 'terminalId fehlt oder ist leer');
  params['terminalId'] = options.terminalId;
  optional(name, params, { label: options.label });
  const ergebnis = await zugangRufen(transport, name, params, geheim);
  if (!ergebnis.available) throw antwortfehler(name, 'Antwort ohne Zugang');
  return ergebnis;
}

/**
 * Fragt den Code fuer die TID dieses Geraets an (`requestTerminalCode`); nur
 * bei Konten mit Postfach (`TerminalAccess.autoCode`), sonst
 * `terminal_code_manual`. Eine offene Anfrage juenger als 6 Minuten bleibt
 * (doppeltes Tippen schadet nicht); hoechstens 6 Anfragen je Stunde
 * (`terminal_code_rate_limited`). Den Code holt danach [getTerminalCode].
 */
export async function requestTerminalCode(transport: InternerTransport, options: RequestTerminalCodeOptions): Promise<TerminalCodeRequest> {
  const name = 'requestTerminalCode';
  const { params, geheim } = ausweis(name, options);
  params['platform'] = pruefePlattform(name, options.platform);
  optional(name, params, { requestedBy: options.requestedBy });
  const daten = await transport<unknown>(name, params, undefined, [geheim]);
  if (!istObjekt(daten) || typeof daten['status'] !== 'string') throw antwortfehler(name, 'Antwort ohne status');
  return { status: daten['status'] };
}

/**
 * Stand der Code-Anfrage und der Einrichtung (`getTerminalCode`); ohne Anfrage
 * `status: 'none'`. Bei `found` steht der Code genau in dieser Antwort: auf
 * Android wird er dabei verbraucht (eine verlorene Antwort verliert ihn), auf
 * iOS bleibt er bis `validUntil` lesbar. Den Code nie loggen.
 */
export async function getTerminalCode(transport: InternerTransport, options: TerminalDeviceCredentials): Promise<TerminalCode> {
  const name = 'getTerminalCode';
  const { params, geheim } = ausweis(name, options);
  const daten = await transport<unknown>(name, params, undefined, [geheim]);
  if (!istObjekt(daten) || typeof daten['status'] !== 'string') throw antwortfehler(name, 'Antwort ohne status');
  const ergebnis: TerminalCode = { status: daten['status'], setup: setupAus(name, daten['setup']) };
  if (daten['code'] !== undefined && daten['code'] !== null) {
    if (!istText(daten['code'])) throw antwortfehler(name, 'code ist kein Text');
    ergebnis.code = daten['code'];
    if (typeof daten['source'] === 'string') ergebnis.source = daten['source'];
    ergebnis.validUntil = textOderNull(daten['validUntil']);
  }
  return ergebnis;
}

/**
 * Meldet den Ausgang der Anmeldung in der Terminal-App (`reportTerminalLogin`).
 * Antwort: nichts. Eine andere als die zugewiesene TID schreibt der Server
 * nicht.
 */
export async function reportTerminalLogin(transport: InternerTransport, options: ReportTerminalLoginOptions): Promise<void> {
  const name = 'reportTerminalLogin';
  const { params, geheim } = ausweis(name, options);
  if (!istText(options.terminalId)) throw eingabefehler(name, 'terminalId fehlt oder ist leer');
  if (typeof options.success !== 'boolean') throw eingabefehler(name, 'success muss true oder false sein');
  if (typeof options.newOnDevice !== 'boolean') throw eingabefehler(name, 'newOnDevice muss true oder false sein');
  params['terminalId'] = options.terminalId;
  params['success'] = options.success;
  params['newOnDevice'] = options.newOnDevice;
  await transport<unknown>(name, params, undefined, [geheim]);
}

/** Meldet, dass die Terminal-App fertig eingerichtet ist (`reportTerminalReady`). Antwort: nichts. */
export async function reportTerminalReady(transport: InternerTransport, options: TerminalDeviceCredentials): Promise<void> {
  const name = 'reportTerminalReady';
  const { params, geheim } = ausweis(name, options);
  await transport<unknown>(name, params, undefined, [geheim]);
}
