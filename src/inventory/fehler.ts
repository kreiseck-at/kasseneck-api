/**
 * Fehler der Lager-API auswerten: am Code, nie am Text.
 *
 * Es zaehlen die Codes der Lager-Endpunkte ([INVENTORY_ERROR_CODES]) und die,
 * die Anmeldung und Rand auf jedem Aufruf erzeugen koennen
 * ([INVENTORY_REQUEST_ERROR_CODES]). Ein fremder Code ist fuer diese Helfer
 * kein Lager-Fehler: wer darauf verzweigt, tut es bewusst ueber
 * `KasseneckApiError.code`.
 */

import type { KasseneckApiError } from '../client/errors.js';
import { bekannterCode, feldfehlerVon } from '../client/fehlercodes.js';
import { fehlmengen } from './lesen.js';
import type { InventoryShortfall } from './typen.js';
import {
  INVENTORY_ERROR_CODES,
  INVENTORY_REQUEST_ERROR_CODES,
  INVENTORY_WARNING_CODES,
  type InventoryErrorCode,
  type InventoryRequestErrorCode,
  type InventoryWarningCode,
} from './vertrag.js';

/** Ein Code, den ein Lager-Aufruf liefern kann. */
export type InventoryApiErrorCode = InventoryErrorCode | InventoryRequestErrorCode;

const BEKANNT: ReadonlySet<string> = new Set<string>([...INVENTORY_ERROR_CODES, ...INVENTORY_REQUEST_ERROR_CODES]);

export function isInventoryErrorCode(value: unknown): value is InventoryApiErrorCode {
  return typeof value === 'string' && BEKANNT.has(value);
}

/** Der Fehlercode eines geworfenen Fehlers; `undefined`, wenn es keiner der Lager-API ist. */
export function inventoryErrorCode(error: unknown): InventoryApiErrorCode | undefined {
  return bekannterCode<InventoryApiErrorCode>(error, BEKANNT);
}

/** Kurzform fuer `catch (e) { if (isInventoryError(e, 'article_not_found')) … }`. */
export function isInventoryError(error: unknown, code?: InventoryApiErrorCode): error is KasseneckApiError {
  const gefunden = inventoryErrorCode(error);
  return gefunden !== undefined && (code === undefined || gefunden === code);
}

/** Ein Feldfehler aus `data.errors[]` einer `validation`-Antwort. */
export interface InventoryFieldError {
  /** Feld der gesendeten Anfrage, z. B. `limit` oder `events`. */
  field: string;
  message: string;
}

/** Die Feldfehler einer `validation`-Antwort; leer, wenn es keine sind. */
export function inventoryFieldErrors(error: unknown): InventoryFieldError[] {
  return feldfehlerVon(error);
}

/**
 * Wie lange `rate_limited` noch gilt, in Sekunden (`data.retryAfterSec`,
 * dasselbe wie die Kopfzeile `Retry-After`). `undefined`, wenn der Fehler kein
 * `rate_limited` ist oder der Server keine Angabe macht. Die Grenze gilt je
 * Konto (etwa 20 Anfragen je Sekunde, kurze Spitzen bis 40).
 */
export function inventoryRetryAfterSec(error: unknown): number | undefined {
  if (inventoryErrorCode(error) !== 'rate_limited') return undefined;
  const wert = (error as KasseneckApiError).details['retryAfterSec'];
  return typeof wert === 'number' && Number.isFinite(wert) && wert >= 0 ? wert : undefined;
}

/**
 * Die Positionen, fuer die beim Reservieren der verfuegbare Bestand nicht
 * reicht (`insufficient_available`, `data.details[]`): je Artikel und Standort
 * angefragt und verfuegbar, in Tausendstel. Leer, wenn der Fehler ein anderer
 * ist. Es fehlen nur diese Positionen; reserviert wurde nichts.
 */
export function inventoryShortfalls(error: unknown): InventoryShortfall[] {
  if (inventoryErrorCode(error) !== 'insufficient_available') return [];
  return fehlmengen((error as KasseneckApiError).details['details']);
}

const HINWEISE: ReadonlySet<string> = new Set<string>(INVENTORY_WARNING_CODES);

/** `true` fuer einen Hinweis-Code einer Buchung (`warnings[].code`); Hinweise sind nie Fehler. */
export function isInventoryWarningCode(value: unknown): value is InventoryWarningCode {
  return typeof value === 'string' && HINWEISE.has(value);
}

/**
 * Die Inventur, die einen Standort belegt (`stocktake_location_busy`,
 * `data.stocktakeId`): weiterzaehlen statt neu anlegen. `undefined`, wenn der
 * Fehler ein anderer ist oder der Server keine Kennung nennt.
 */
export function inventoryBusyStocktakeId(error: unknown): string | undefined {
  if (inventoryErrorCode(error) !== 'stocktake_location_busy') return undefined;
  const wert = (error as KasseneckApiError).details['stocktakeId'];
  return typeof wert === 'string' && wert !== '' ? wert : undefined;
}
