import {
  type Receipt,
  type ReceiptCompany,
  type ReceiptCompanyPayload,
  type ReceiptPayloadRead,
  type ReportMonth,
  fromReceiptCompanyPayload,
  fromReceiptPayload,
} from '../models/index.js';
import { toViennaWallClock } from '../vienna-time.js';
import { KasseneckValidationError } from './errors.js';
import type { InternerBinaerTransport, InternerTransport } from './aufrufe.js';

/**
 * Bericht-Downloads — Zwilling von `getCashregisterReport`,
 * `downloadDailyReport` und `downloadMonthlyReport` in
 * kasseneck_api/lib/kasseneck_api.dart.
 *
 * **Alle drei liefern ein PDF, also Binaerdaten.** `response.text()` waere hier
 * falsch: es deutet die Bytes als UTF-8 und ersetzt jedes Byte ueber 0x7F
 * durch U+FFFD, ein so "heruntergeladener" Bericht liesse sich in keinem
 * Betrachter oeffnen. Gelesen wird `arrayBuffer()`, geliefert `Uint8Array`;
 * eine Ablehnung mit HTTP 200 und Huelle (`period_not_closed`) wird zum Fehler
 * (siehe [createBinaryTransport] in transport.ts). Der Dart-Zwilling reichte
 * sie bis 11.8.0 als PDF durch und prueft seit 11.8.1 ebenso die ersten Bytes.
 *
 * **Kassen-Benutzer-Weg (`registerUserAuth`, Browser-Kasse):** Keiner der
 * beiden Download-Endpunkte setzt `allowRegisterUser`; sie funktionieren nur
 * mit `apiKeyAuth`. Dieses Paket bildet das **nicht** nach; wer darf,
 * entscheidet allein das Backend. Der Hinweis steht hier, damit ein Leser
 * nicht raten muss.
 */

/**
 * Tagesbericht als PDF.
 *
 * Der Kalendertag wird nach **Wiener** Wanduhrzeit bestimmt, nicht nach der
 * Zeitzone des ausfuehrenden Rechners: der Geschaeftstag ist ein
 * oesterreichischer Kalenderwert. Ein Zeitpunkt vom 1. Maerz 00:30 Wiener Zeit
 * gehoert in den Tagesbericht vom 1. Maerz — die eingebauten
 * `getDate()`/`getMonth()` wuerden auf einer UTC-Maschine den Bericht des
 * Vortags holen (das Dart-Vorbild nimmt hier die Geraetezeit, was auf einer
 * oesterreichischen Kasse zufaellig stimmt).
 *
 * @deprecated Since 1.10.0: use getCashregisterReport(...). The old endpoint keeps working
 * (closed periods as v2, current month / today as before) until it is switched off.
 */
// `async`, damit auch die Eingabepruefung als abgelehntes Versprechen ankommt
// und nicht als synchroner Wurf am `await` des Aufrufers vorbei.
export async function downloadDailyReport(transport: InternerBinaerTransport, date: Date): Promise<Uint8Array> {
  let wanduhr;
  try {
    wanduhr = toViennaWallClock(date);
  } catch {
    // Ein Invalid Date ergaebe sonst `{year: null, month: null, day: null}` im
    // Rumpf (JSON.stringify macht aus NaN null) und einen ratlosen Serverfehler.
    throw eingabefehler('downloadDailyReport', 'Uebergebener Zeitpunkt ist unbrauchbar (Invalid Date)');
  }
  return transport('downloadDailyReport', { year: wanduhr.year, month: wanduhr.month, day: wanduhr.day });
}

/**
 * Monatsbericht als PDF.
 *
 * **Der Endpunkt heisst `downloadReport`**, nicht `downloadMonthlyReport` —
 * Methodenname und Endpunktname fallen hier auseinander (so im Dart-Vorbild und
 * so im Backend, `report-endpoints.js`).
 *
 * `month` geht als **Zahl 1-12** raus (im Flutter-Paket `reportMonth.month.id`,
 * wo `KeckMonth.january.id === 1` ist) — kein Name, kein nullbasierter Index.
 *
 * @deprecated Since 1.10.0: use getCashregisterReport(...). The old endpoint keeps working
 * (closed periods as v2, current month / today as before) until it is switched off.
 */

export async function downloadMonthlyReport(
  transport: InternerBinaerTransport,
  reportMonth: ReportMonth,
): Promise<Uint8Array> {
  const { month, year } = reportMonth;
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw eingabefehler('downloadReport', `Berichtsmonat: month muss 1-12 sein, war "${month}"`);
  }
  if (!Number.isInteger(year)) {
    throw eingabefehler('downloadReport', `Berichtsmonat: year muss eine ganze Zahl sein, war "${year}"`);
  }
  return transport('downloadReport', { month, year });
}

/** Zeitraum fuer [getCashregisterReport]: genau eine der drei Formen. */
export type CashregisterReportPeriod =
  | { year: number; month: number }
  | { year: number; month: number; day: number }
  | { start: string; end: string };

/**
 * Kassenbericht als PDF (v2) fuer einen abgeschlossenen Monat, einen
 * abgeschlossenen Tag (gestern oder frueher) oder einen Zeitraum (`end`
 * ausschliesslich, hoechstens 366 Tage). Laufender Monat und heutiger Tag
 * liefern `period_not_closed`, die Zukunft `period_in_future`. Nachfolger von [downloadMonthlyReport] und
 * [downloadDailyReport].
 */
export async function getCashregisterReport(
  transport: InternerBinaerTransport,
  options: CashregisterReportPeriod,
): Promise<Uint8Array> {
  // Genau eine Form; Misch- und Teilformen werfen vor dem Transport (wie im Dart-Paket).
  const o = options as unknown as Record<string, unknown>;
  const da = (k: string) => o[k] !== undefined && o[k] !== null;
  const felder = ['year', 'month', 'day', 'start', 'end'].filter(da).sort().join(',');
  if (felder !== 'month,year' && felder !== 'day,month,year' && felder !== 'end,start') {
    throw eingabefehler('getCashregisterReport', 'genau eine Form angeben: year+month, year+month+day oder start+end');
  }
  if (felder === 'end,start') {
    const { start, end } = options as { start: string; end: string };
    for (const [feld, wert] of [['start', start], ['end', end]] as const) {
      if (typeof wert !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(wert)) {
        throw eingabefehler('getCashregisterReport', `${feld} muss YYYY-MM-DD sein, war "${String(wert)}"`);
      }
    }
    return transport('getCashregisterReport', { start, end });
  }
  const { year, month } = options as { year: number; month: number };
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw eingabefehler('getCashregisterReport', `month muss 1-12 sein, war "${month}"`);
  }
  if (!Number.isInteger(year)) {
    throw eingabefehler('getCashregisterReport', `year muss eine ganze Zahl sein, war "${year}"`);
  }
  if ('day' in options) {
    const day = (options as { day: number }).day;
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      throw eingabefehler('getCashregisterReport', `day muss 1-31 sein, war "${day}"`);
    }
    return transport('getCashregisterReport', { year, month, day });
  }
  return transport('getCashregisterReport', { year, month });
}

/** Zeitfenster von [getReportV2]: Wiener Wanduhr, `YYYY-MM-DD` oder voller Zeitstempel, `end` ausschliesslich. */
export interface ReportV2Options {
  start: string;
  end: string;
}

/** Firmendaten des Berichts: die Beleg-Firmendaten plus die Bezeichnung der Kasse. */
export interface ReportV2Metadata extends ReceiptCompany {
  /** Bezeichnung der Kasse; leer, wenn keine gepflegt ist. */
  label: string;
}

export interface ReportV2 {
  /** Alle Belege der angemeldeten Kasse mit `start <= timeStamp < end`. */
  receipts: Receipt[];
  metadata: ReportV2Metadata;
}

/**
 * Rohdaten eines Zeitraums (`getReportV2`): alle Belege der Kasse und die
 * Firmendaten fuer Kopf und Fuss. Der Server vergleicht die Zeitstempel als
 * Text (`start <= timeStamp < end`), darum Wiener Wanduhr im Serverformat.
 * Nur ueber den API-Schluessel-Weg (Kasse aus dem `cashregister-token`).
 */
export async function getReportV2(transport: InternerTransport, options: ReportV2Options): Promise<ReportV2> {
  for (const feld of ['start', 'end'] as const) {
    const wert = options?.[feld];
    if (typeof wert !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(wert)) {
      throw eingabefehler('getReportV2', `${feld} muss mit YYYY-MM-DD beginnen, war "${String(wert)}"`);
    }
  }
  if (options.start >= options.end) {
    throw eingabefehler('getReportV2', 'end muss nach start liegen (end ist ausschliesslich)');
  }
  const daten = await transport<{ receipts?: unknown; metadata?: unknown }>('getReportV2', { start: options.start, end: options.end });
  const liste = daten?.receipts;
  if (!Array.isArray(liste) || liste.some((b) => b == null || typeof b !== 'object' || Array.isArray(b))) {
    throw new KasseneckValidationError('getReportV2', 'Antwort enthaelt keine Belegliste (data.receipts fehlt)', 'response');
  }
  const meta = daten.metadata;
  if (meta == null || typeof meta !== 'object' || Array.isArray(meta)) {
    throw new KasseneckValidationError('getReportV2', 'Antwort enthaelt keine Firmendaten (data.metadata fehlt)', 'response');
  }
  const label = (meta as { label?: unknown }).label;
  return {
    receipts: liste.map((b) => fromReceiptPayload(b as ReceiptPayloadRead)),
    metadata: { ...fromReceiptCompanyPayload(meta as ReceiptCompanyPayload), label: typeof label === 'string' ? label : '' },
  };
}

/** Fehler in der Eingabe des Aufrufers — es geht keine Anfrage raus. */
function eingabefehler(functionName: string, grund: string): KasseneckValidationError {
  return new KasseneckValidationError(functionName, grund, 'request');
}
