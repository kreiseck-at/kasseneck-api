import { KasseneckApiError } from '../client/errors.js';
import { bekannterCode, feldfehlerVon } from '../client/fehlercodes.js';

/*
 * Ausgaben eines Belegs: auf welchem Weg ein Beleg den Betrieb verlassen hat
 * (Erstdruck, Duplikat, E-Mail, Link oder PDF geteilt, vom Kunden geoeffnet).
 * Registrierkassen-Erlass BMF-AV Nr. 2/2026, Abschnitt 4.2: die Art der
 * Belegerteilung ist zu dokumentieren. Das Protokoll fuehrt das Backend neben
 * dem Beleg (nie am Beleg, nie im DEP); die Kasse meldet ihre Drucke und das
 * Teilen mit `logReceiptOutputs`, `getReceipt` liefert unter `/v3` die
 * neuesten 20 Eintraege als `outputs`.
 */

/**
 * Die Arten einer Ausgabe (Katalog `AUSGABE_ART`): `print` Erstdruck,
 * `reprint` Duplikat, `email` Belegmail, `link_shared` Link geteilt,
 * `pdf_shared` PDF geteilt, `opened` vom Kunden geoeffnet (Abrufe je Stunde).
 */
export const RECEIPT_OUTPUT_KINDS = Object.freeze(['print', 'reprint', 'email', 'link_shared', 'pdf_shared', 'opened'] as const);
export type ReceiptOutputKind = (typeof RECEIPT_OUTPUT_KINDS)[number];

/**
 * Die Arten, die eine Kasse selbst meldet. `email` und `opened` schreibt das
 * Backend selbst (beim Versand bzw. beim Abruf des Links); meldet eine Kasse
 * sie, lehnt der Server genau diesen Eintrag ab (`invalid_output_kind`).
 */
export const RECEIPT_OUTPUT_LOG_KINDS = Object.freeze(['print', 'reprint', 'link_shared', 'pdf_shared'] as const);
export type ReceiptOutputLogKind = (typeof RECEIPT_OUTPUT_LOG_KINDS)[number];

/** Ergebnis einer Ausgabe (Katalog `AUSGABE_ERGEBNIS`); Mail und Abruf sind immer `ok`. */
export const RECEIPT_OUTPUT_RESULTS = Object.freeze(['ok', 'failed', 'unclear'] as const);
export type ReceiptOutputResult = (typeof RECEIPT_OUTPUT_RESULTS)[number];

/** Hoechstens so viele Eintraege je Aufruf von `logReceiptOutputs`. */
export const RECEIPT_OUTPUT_ENTRIES_MAX = 50;

/** Wer die Ausgabe ausloeste: Kassen-Benutzer, bzw. beim Geraet mit api_key das Konto (`name: null`). */
export interface ReceiptOutputActor {
  id: string;
  name: string | null;
}

/**
 * Ein Eintrag aus `outputs` einer `getReceipt`-Antwort (`/v3`). Eine Art oder
 * ein Ergebnis, das dieses Paket noch nicht kennt (neuerer Server), bleibt
 * lesbar stehen; die Kasse zeigt es ohne Beschriftung.
 */
export interface ReceiptOutput {
  kind: ReceiptOutputKind | (string & {});
  /** Zeitpunkt, ISO 8601 mit Wiener Zonenoffset; bei Kassenmeldungen der Zeitpunkt am Geraet, beim Abruf der letzte der Stunde. */
  at: string;
  result: ReceiptOutputResult | (string & {});
  /** `null` beim Abruf durch den Kunden. */
  by: ReceiptOutputActor | null;
  /** Nur bei `opened`: Zahl der Abrufe in dieser Stunde. */
  count?: number;
}

/**
 * Liest `data.outputs` nachsichtig: das Protokoll ist eine Auskunft neben dem
 * Beleg und darf das Lesen, Anzeigen und Nachdrucken des Belegs nie scheitern
 * lassen. Keine Liste: `undefined` (Antwort ohne Protokoll, etwa `/api` oder
 * `createReceipt`). Ein Eintrag ohne lesbare Art, Zeit oder Ergebnis faellt
 * weg; ein Handelnder ohne Kennung gilt als `null`, eine Anzahl, die keine
 * ganze Zahl ab 0 ist, fehlt. Paketintern.
 */
export function receiptOutputsFromWire(roh: unknown): ReceiptOutput[] | undefined {
  if (!Array.isArray(roh)) return undefined;
  const raus: ReceiptOutput[] = [];
  for (const e of roh) {
    if (e === null || typeof e !== 'object' || Array.isArray(e)) continue;
    const { kind, at, result, by, count } = e as Record<string, unknown>;
    if (typeof kind !== 'string' || kind === '' || typeof at !== 'string' || at === '' || typeof result !== 'string' || result === '') continue;
    const eintrag: ReceiptOutput = { kind, at, result, by: handelnder(by) };
    if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0) eintrag.count = count;
    raus.push(eintrag);
  }
  return raus;
}

function handelnder(w: unknown): ReceiptOutputActor | null {
  if (w === null || typeof w !== 'object' || Array.isArray(w)) return null;
  const { id, name } = w as Record<string, unknown>;
  if (typeof id !== 'string' || id === '') return null;
  return { id, name: typeof name === 'string' ? name : null };
}

/**
 * Codes je Eintrag in `rejected[].code` einer Antwort von
 * `logReceiptOutputs`: der Eintrag ist dauerhaft abgelehnt (aus dem Puffer
 * nehmen, nicht noch einmal senden). `validation` heisst hier: ein Druck ohne
 * oder mit unbekanntem Ergebnis.
 */
export const RECEIPT_OUTPUT_ENTRY_ERROR_CODES = Object.freeze([
  'receipt_not_found',        // Beleg gibt es nicht ODER er liegt in einer anderen Kasse
  'invalid_output_kind',      // Art, die die Kasse nicht meldet (email, opened)
  'output_time_out_of_range', // vor der Belegzeit (1 min Spielraum), mehr als 5 min nach Eingang, oder ohne Zone
  'idempotency_key_required', // Schluessel fehlt oder hat nicht 8-64 Zeichen [A-Za-z0-9_-]
  'validation',               // Druck ohne bzw. mit unbekanntem Ergebnis
] as const);
export type ReceiptOutputEntryErrorCode = (typeof RECEIPT_OUTPUT_ENTRY_ERROR_CODES)[number];

/**
 * Fehlercodes von `logReceiptOutputs`, wenn die ganze Anfrage scheitert
 * (Vokabular `errorCodes.registerHandlersByEndpoint.logReceiptOutputs`),
 * dahinter die Codes, die Anmeldung und Rand auf diesem Endpunkt erzeugen
 * koennen (`errorCodes.auth` ohne die sieben des Partner-Zugangs,
 * `errorCodes.edge`), zuletzt `route_missing` (Code des Pakets). Ein Code
 * ausserhalb bleibt ueber `KasseneckApiError.code` lesbar.
 */
export const RECEIPT_OUTPUT_ERROR_CODES = Object.freeze([
  'idempotency_key_required',
  'invalid_output_kind',
  'output_time_out_of_range',
  'receipt_not_found',
  'server_error',
  'validation',
  // Anmeldung und Rand (errorCodes.auth ohne Partner-Zugang, errorCodes.edge)
  'account_not_found',
  'action_confirmation_required',
  'admin_required',
  'api_not_approved',
  'app_check_invalid',
  'app_check_missing',
  'cashregister_not_assigned',
  'cashregister_not_found',
  'cashregister_token_invalid',
  'cashregister_token_missing',
  'dialect_mismatch',
  'internal_translation_error',
  'live_not_enabled',
  'method_not_allowed',
  'mfa_required',
  'not_found',
  'password_change_required',
  'register_user_no_business',
  'register_user_not_allowed',
  'register_user_not_found',
  'response_translation_failed',
  'second_factor_required',
  'session_expired',
  'session_other_cashregister',
  'unauthorized',
  'user_disabled',
  'user_verification_failed',
  // Code des Pakets (CLIENT_ERROR_CODES)
  'route_missing',
] as const);
export type ReceiptOutputErrorCode = (typeof RECEIPT_OUTPUT_ERROR_CODES)[number];

export function isReceiptOutputErrorCode(value: unknown): value is ReceiptOutputErrorCode {
  return typeof value === 'string' && (RECEIPT_OUTPUT_ERROR_CODES as readonly string[]).includes(value);
}

const BEKANNT: ReadonlySet<string> = new Set(RECEIPT_OUTPUT_ERROR_CODES);

/** Der Code eines geworfenen Fehlers, wenn er in [RECEIPT_OUTPUT_ERROR_CODES] steht; sonst `undefined`. */
export function receiptOutputErrorCode(error: unknown): ReceiptOutputErrorCode | undefined {
  return bekannterCode<ReceiptOutputErrorCode>(error, BEKANNT);
}

/** Ohne `code`: traegt der Fehler ueberhaupt einen Code aus [RECEIPT_OUTPUT_ERROR_CODES]? */
export function isReceiptOutputError(error: unknown, code?: ReceiptOutputErrorCode): error is KasseneckApiError {
  const gefunden = receiptOutputErrorCode(error);
  return gefunden !== undefined && (code === undefined || gefunden === code);
}

/** Ein Feldfehler aus `data.errors[]` einer `validation`-Antwort von `logReceiptOutputs`. */
export interface ReceiptOutputFieldError {
  field: string;
  message: string;
}

/** Die Feldfehler einer `validation`-Antwort; leer, wenn es keine sind. */
export function receiptOutputFieldErrors(error: unknown): ReceiptOutputFieldError[] {
  return feldfehlerVon(error);
}
