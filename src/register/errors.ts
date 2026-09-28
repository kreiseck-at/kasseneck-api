import { KasseneckApiError } from '../client/errors.js';

/**
 * Fehler der Kassen-Anmeldung (Kopplung, Benutzerliste, PIN-Anmeldung,
 * Sitzung, Entkoppeln) auswerten: **am `code`, nie am Meldungstext.**
 *
 * Bis 0.x verglich die Web-Kasse deutsche Meldungen („Kasse wird gerade auf …
 * verwendet“) und zog Zahlen aus dem Text. Unter `/api/v3` traegt jede
 * Abweisung einen Code (Nachtrag §11.7.4) und ihre Angaben als Daten:
 * `deviceLabel`, `takeoverAllowed`, `retryAfterSec`, `distanceM`,
 * `pairedDevices`, `licenses`. Die `message` bleibt ein deutscher Menschentext
 * zum Anzeigen, sie ist kein Vertrag.
 *
 * Die Liste ist aus dem Vertrags-Export abgeleitet (Fehlerfaelle der acht
 * Anmelde-Endpunkte in `fixtures/v3/antworten/kasse.json` und die
 * Handler-Codes aus `v3-vokabular.json`); ein Test haelt sie deckungsgleich.
 */
export const REGISTER_ERROR_CODES = Object.freeze([
  'cashregister_in_use',
  'cashregister_not_assigned',
  'cashregister_not_found',
  'device_bound_elsewhere',
  'device_not_found',
  'device_not_paired',
  'device_takeover_required',
  'licenses_exhausted',
  'live_not_enabled',
  'location_outside',
  'location_required',
  'login_failed',
  'login_mode_select_user',
  'login_unavailable',
  'method_not_allowed',
  'pairing_code_expired',
  'pairing_code_unknown',
  'pairing_code_used',
  'pairing_failed',
  'register_user_only',
  'session_ended',
  'session_expired',
  'session_not_running',
  'too_many_attempts',
  'unauthorized',
  'user_disabled',
  'validation',
] as const);
export type RegisterErrorCode = typeof REGISTER_ERROR_CODES[number];

const BEKANNT: ReadonlySet<string> = new Set(REGISTER_ERROR_CODES);

export function isRegisterErrorCode(value: unknown): value is RegisterErrorCode {
  return typeof value === 'string' && BEKANNT.has(value);
}

/** Der Code eines geworfenen Fehlers, wenn es einer der Kassen-Anmeldung ist; sonst `undefined`. */
export function registerErrorCode(error: unknown): RegisterErrorCode | undefined {
  if (!(error instanceof KasseneckApiError)) return undefined;
  return isRegisterErrorCode(error.code) ? error.code : undefined;
}

/**
 * Kurzform fuer `catch (e) { if (isRegisterError(e, 'cashregister_in_use')) … }`.
 * Ohne `code`: ist es ueberhaupt ein Fehler der Kassen-Anmeldung?
 */
export function isRegisterError(error: unknown, code?: RegisterErrorCode): error is KasseneckApiError {
  const gefunden = registerErrorCode(error);
  return gefunden !== undefined && (code === undefined || gefunden === code);
}

/**
 * Die Angaben einer Abweisung, soweit sie welche traegt. Was fehlt, ist
 * `null`; `deviceLabel` ist auch dann `null`, wenn das belegende Geraet keinen
 * Namen hat (die Oberflaeche sagt dann „ein anderes Geraet“).
 */
export interface RegisterErrorDetails {
  /** `cashregister_in_use`, `device_takeover_required`: Name des Geraets, das die Kasse haelt. */
  deviceLabel: string | null;
  /** `cashregister_in_use`: darf dieser Benutzer die Kasse uebernehmen (Recht `takeover`)? */
  takeoverAllowed: boolean;
  /** `too_many_attempts`: Sekunden bis zum naechsten Versuch. */
  retryAfterSec: number | null;
  /** `location_outside`: Abstand zum Betrieb in Metern. */
  distanceM: number | null;
  /** `licenses_exhausted`: gekoppelte Geraete und Lizenzen. */
  pairedDevices: number | null;
  licenses: number | null;
}

export function registerErrorDetails(error: unknown): RegisterErrorDetails {
  const d = error instanceof KasseneckApiError ? error.details : {};
  const zahl = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    deviceLabel: typeof d['deviceLabel'] === 'string' && d['deviceLabel'] !== '' ? d['deviceLabel'] : null,
    takeoverAllowed: d['takeoverAllowed'] === true,
    retryAfterSec: zahl(d['retryAfterSec']),
    distanceM: zahl(d['distanceM']),
    pairedDevices: zahl(d['pairedDevices']),
    licenses: zahl(d['licenses']),
  };
}
