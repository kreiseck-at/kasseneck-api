import { KasseneckApiError } from '../client/errors.js';

/**
 * Fehler der Kassen-Aufrufe um den Verkauf herum (Einstellungen, Logo,
 * Artikel, Drucker, Trinkgeld-Empfaenger) auswerten: am `code`, nie am Text.
 * Belege, Storno und Belegmail haben eigene Listen (`RECEIPT_ERROR_CODES`,
 * `CANCELLATION_ERROR_CODES`, `RECEIPT_EMAIL_ERROR_CODES`), die Anmeldung
 * `REGISTER_ERROR_CODES` im Unterpfad `./register`.
 *
 * Abgeleitet aus dem Vertrags-Export (Fehlerfaelle dieser zehn Endpunkte in
 * `fixtures/v3/antworten/kasse.json` und ihre Handler-Codes); ein Test haelt
 * die Liste deckungsgleich. `validation` traegt `data.errors[]` mit dem
 * aeusseren Feldpfad (`business.theme`, `device.shortcuts.splitPayment`).
 * Dazu kommen die Codes, die der Rand auf jedem Kassen-Endpunkt erzeugen kann:
 * die Anmelde- und Pruefcodes (`errorCodes.auth` ohne die sieben des
 * Partner-Zugangs, z. B. `register_user_not_found`, wenn der Chef einen
 * angemeldeten Benutzer loescht) und die des Rands selbst (`errorCodes.edge`:
 * `validation`, `not_found`, `internal_translation_error`, `dialect_mismatch`,
 * `response_translation_failed`). Ein Code, der in keiner Liste steht, bleibt
 * ueber `KasseneckApiError.code` lesbar; die Kasse braucht dafuer einen
 * Rueckfallzweig.
 */
export const POS_ERROR_CODES = Object.freeze([
  'account_not_found',
  'admin_required',
  'cashregister_not_assigned',
  'cashregister_not_found',
  'cashregister_token_invalid',
  'cashregister_token_missing',
  'device_not_found',
  'dialect_mismatch',
  'internal_translation_error',
  'live_not_enabled',
  'logo_invalid',
  'logo_invalid_type',
  'logo_too_large',
  'method_not_allowed',
  'mfa_required',
  'module_inactive',
  'not_found',
  'not_permitted',
  'print_job_not_found',
  'print_layout_failed',
  'printer_not_found',
  'register_user_no_business',
  'register_user_not_allowed',
  'register_user_not_found',
  'response_translation_failed',
  'session_expired',
  'session_other_cashregister',
  'unauthorized',
  'user_disabled',
  'user_verification_failed',
  'validation'
] as const);
export type PosErrorCode = typeof POS_ERROR_CODES[number];

const BEKANNT: ReadonlySet<string> = new Set(POS_ERROR_CODES);

export function isPosErrorCode(value: unknown): value is PosErrorCode {
  return typeof value === 'string' && BEKANNT.has(value);
}

/** Der Code eines geworfenen Fehlers, wenn er in [POS_ERROR_CODES] steht; sonst `undefined`. */
export function posErrorCode(error: unknown): PosErrorCode | undefined {
  if (!(error instanceof KasseneckApiError)) return undefined;
  return isPosErrorCode(error.code) ? error.code : undefined;
}

/** Kurzform fuer `catch (e) { if (isPosError(e, 'logo_too_large')) … }`. */
export function isPosError(error: unknown, code?: PosErrorCode): error is KasseneckApiError {
  const gefunden = posErrorCode(error);
  return gefunden !== undefined && (code === undefined || gefunden === code);
}

/** Ein Feldfehler aus `data.errors[]` einer `validation`-Antwort. */
export interface PosFieldError {
  /** Aeusserer Feldpfad, z. B. `business.vatRates` oder `device.shortcuts.cash`. */
  field: string;
  message: string;
}

/** Die Feldfehler einer `validation`-Antwort; leer, wenn es keine sind. */
export function posFieldErrors(error: unknown): PosFieldError[] {
  if (!(error instanceof KasseneckApiError)) return [];
  const roh = error.details['errors'];
  if (!Array.isArray(roh)) return [];
  const raus: PosFieldError[] = [];
  for (const eintrag of roh) {
    if (eintrag === null || typeof eintrag !== 'object') continue;
    const { field, message } = eintrag as { field?: unknown; message?: unknown };
    if (typeof field === 'string' && typeof message === 'string') raus.push({ field, message });
  }
  return raus;
}
