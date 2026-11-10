import { KasseneckValidationError } from './errors.js';
import type { InternerTransport } from './aufrufe.js';

/**
 * EWP-Meldung (Einwegpfand-Meldung, Pfand Teil 5): die Monatsmeldung der
 * Einweg-Verpackungen je GTIN, die ein Abfuellbetrieb dem Pfandsystem meldet
 * (Faelligkeit der 5. des Folgemonats). Nur unter `/v3`, API-Schluessel, nur
 * Betriebe mit der Rolle Abfueller (sonst `filler_role_required`).
 *
 * Die Meldung entsteht aus drei Quellen (`sources`): den Belegen der Kassen,
 * den Rechnungen und den Lieferscheinen, dazu die Zusatzmengen, die das
 * Fremdsystem selbst nachtraegt (Haustrunk, Muster, Spende ...). Der laufende
 * Monat ist vorlaeufig (`provisional`).
 *
 * Mengen sind ganze Stueck. `downloadEwpReport` liefert die CSV fuer den Upload
 * beim Pfandsystem; erst der Abruf eines abgeschlossenen Monats wird als
 * heruntergeladen vermerkt (`downloadedAt`).
 */

/** Gruende einer Zusatzmenge, in der Reihenfolge des Backends. */
export const EWP_REASONS = Object.freeze([
  'own_consumption',
  'sampling',
  'donation',
  'theft',
  'free_goods',
  'stocktake',
  'return',
  'external_system',
  'other',
] as const);
export type EwpReason = (typeof EWP_REASONS)[number];

/** Warnungen der Meldung; welche Angaben eine Warnung traegt, steht an [EwpWarning]. */
export const EWP_WARNING_CODES = Object.freeze([
  'gtin_not_registered',
  'foreign_not_reportable',
  'master_data_missing',
  'negative_quantity',
  'invalid_posting',
] as const);
export type EwpWarningCode = (typeof EWP_WARNING_CODES)[number];

/** Stammdaten einer GTIN fuer die Meldung; fehlende Angaben kommen als leerer Text. */
export interface EwpMasterData {
  barcodeType: string;
  productOrigin: string;
  depositFee: string;
  producerFee: string;
  ecoImpact: string;
  intBarcodeUsage: string;
}

/** Woher die Menge einer Zeile kommt (Stueck): Kasse, Rechnungen, Lieferscheine, Zusatzmengen. */
export interface EwpLineSources {
  register: number;
  invoices: number;
  deliveryNotes: number;
  extra: number;
}

/** Eine Zeile der Meldung: eine registrierte GTIN mit ihren Mengen im Inland und Ausland. */
export interface EwpLine {
  gtin: string;
  name: string;
  masterData?: EwpMasterData;
  domestic: number;
  foreign: number;
  sources: EwpLineSources;
}

/**
 * Eine Warnung zur Meldung; sie sperrt nichts. Welche Angaben dabei stehen:
 * - `gtin_not_registered`: `gtin`, `quantity` (die GTIN ist nicht registriert, ihre Menge steht nicht in `lines`)
 * - `foreign_not_reportable`: `gtin`, `country`, `quantity` (Auslandsmenge einer oesterreichischen GTIN, nicht meldepflichtig)
 * - `master_data_missing`: `gtin`, `fields` (die fehlenden Stammdaten)
 * - `negative_quantity`: `gtin`, `column` (`domestic` oder `foreign`), `amount`
 * - `invalid_posting`: `count` (nicht lesbare Posten)
 */
export interface EwpWarning {
  code: EwpWarningCode;
  gtin?: string;
  country?: string;
  quantity?: number;
  fields?: string[];
  count?: number;
  column?: 'domestic' | 'foreign';
  amount?: number;
}

/** Eine Zusatzmenge, wie die Meldung sie fuehrt. */
export interface EwpExtraQuantity {
  gtin: string;
  domestic: number;
  foreign: number;
  reason: EwpReason;
  text: string | null;
  /** Zeitpunkt des Eintrags (Millisekunden). */
  at: number;
  /** Kennung des Absenders: die uid der Anmeldung im Panel, `'api'` fuer einen API-Schluessel; bei Altbestand `null`. */
  by: string | null;
}

/** Eine Zusatzmenge beim Setzen. `text` hoechstens 200 Zeichen. */
export interface EwpExtraQuantityInput {
  gtin: string;
  domestic: number;
  foreign: number;
  reason: EwpReason;
  text?: string | null;
}

/** Die Meldung eines Monats (`getEwpReport`). */
export interface EwpReport {
  /** Meldemonat `YYYY-MM`. */
  month: string;
  /** Faelligkeit `YYYY-MM-DD` (der 5. des Folgemonats). */
  dueDate: string;
  /** Der Monat laeuft noch. */
  provisional: boolean;
  /** Die Meldung stammt aus der Test-Umgebung (`kr_test_`-Schluessel). */
  test: boolean;
  lines: EwpLine[];
  warnings: EwpWarning[];
  extraQuantities: EwpExtraQuantity[];
  /** Zeitpunkt (Millisekunden) des letzten CSV-Abrufs eines abgeschlossenen Monats, sonst `null`. */
  downloadedAt: number | null;
}

/** Die CSV der Meldung (`downloadEwpReport`). */
export interface EwpReportFile {
  csv: string;
  filename: string;
  contentType: string;
}

/** Meldung eines Monats lesen (`getEwpReport`). */
export async function getEwpReport(transport: InternerTransport, options: { month: string }): Promise<EwpReport> {
  const month = monat('getEwpReport', options);
  return meldung('getEwpReport', await transport('getEwpReport', { month }));
}

/** CSV der Meldung laden (`getEwpReport` mit `format: 'csv'`). */
export async function downloadEwpReport(transport: InternerTransport, options: { month: string }): Promise<EwpReportFile> {
  const month = monat('downloadEwpReport', options);
  const daten = await transport('getEwpReport', { month, format: 'csv' });
  if (!istObjekt(daten)) throw antwortfehler('downloadEwpReport', 'Antwort ist kein Objekt');
  const { csv, filename, contentType } = daten;
  if (typeof csv !== 'string' || typeof filename !== 'string' || typeof contentType !== 'string') {
    throw antwortfehler('downloadEwpReport', 'Antwort ohne csv, filename und contentType');
  }
  return { csv, filename, contentType };
}

/**
 * Zusatzmengen eines Monats ersetzen (`setEwpExtraQuantities`): die gesendete Liste
 * ist die ganze Liste, eine leere leert sie. Unveraenderte Eintraege behalten
 * `at` und `by`. Antwort ist die neu gerechnete Meldung.
 */
export async function setEwpExtraQuantities(
  transport: InternerTransport,
  options: { month: string; extraQuantities: EwpExtraQuantityInput[] },
): Promise<EwpReport> {
  const month = monat('setEwpExtraQuantities', options);
  if (!Array.isArray(options.extraQuantities)) {
    throw new KasseneckValidationError('setEwpExtraQuantities', 'extraQuantities muss eine Liste sein', 'request');
  }
  return meldung('setEwpExtraQuantities', await transport('setEwpExtraQuantities', { month, extraQuantities: options.extraQuantities }));
}

function monat(aufruf: string, options: { month: string } | null | undefined): string {
  const month = options?.month;
  if (typeof month !== 'string' || month === '') throw new KasseneckValidationError(aufruf, 'month fehlt (Monat als JJJJ-MM)', 'request');
  return month;
}

function istObjekt(wert: unknown): wert is Record<string, unknown> {
  return wert !== null && typeof wert === 'object' && !Array.isArray(wert);
}

function antwortfehler(aufruf: string, grund: string): KasseneckValidationError {
  return new KasseneckValidationError(aufruf, grund, 'response');
}

/** Prueft die Form, die der Aufrufer braucht, und reicht die Antwort sonst unveraendert durch. */
function meldung(aufruf: string, daten: unknown): EwpReport {
  if (!istObjekt(daten)) throw antwortfehler(aufruf, 'Antwort ist kein Objekt');
  if (typeof daten['month'] !== 'string') throw antwortfehler(aufruf, 'Antwort ohne month');
  for (const feld of ['lines', 'warnings', 'extraQuantities']) {
    if (!Array.isArray(daten[feld])) throw antwortfehler(aufruf, `Antwort ohne Liste ${feld}`);
  }
  return daten as unknown as EwpReport;
}
