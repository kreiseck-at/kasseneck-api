import type { ReportMonth } from '../models/index.js';
import { toViennaWallClock } from '../vienna-time.js';
import { KasseneckValidationError } from './errors.js';
import type { KasseneckBinaryTransport } from './transport.js';

/**
 * Bericht-Downloads — Zwilling von `downloadDailyReport`/`downloadMonthlyReport`
 * in kasseneck_api/lib/kasseneck_api.dart (Zeilen 113-128).
 *
 * **Beide liefern ein PDF, also Binaerdaten.** Das Flutter-Vorbild liest die
 * Antwort als Zeichenkette und nimmt davon `codeUnits`; in JavaScript waere das
 * schlicht falsch — `response.text()` deutet die Bytes als UTF-8 und ersetzt
 * jedes Byte ueber 0x7F durch U+FFFD. Ein so "heruntergeladener" Tagesbericht
 * liesse sich in keinem Betrachter oeffnen. Dieses Paket weicht daher bewusst
 * ab: es liest `arrayBuffer()` und liefert `Uint8Array` (siehe
 * [createBinaryTransport] in transport.ts).
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
 */
// `async`, damit auch die Eingabepruefung als abgelehntes Versprechen ankommt
// und nicht als synchroner Wurf am `await` des Aufrufers vorbei.
export async function downloadDailyReport(rufen: KasseneckBinaryTransport, date: Date): Promise<Uint8Array> {
  let wanduhr;
  try {
    wanduhr = toViennaWallClock(date);
  } catch {
    // Ein Invalid Date ergaebe sonst `{year: null, month: null, day: null}` im
    // Rumpf (JSON.stringify macht aus NaN null) und einen ratlosen Serverfehler.
    throw eingabefehler('downloadDailyReport', 'Uebergebener Zeitpunkt ist unbrauchbar (Invalid Date)');
  }
  return rufen('downloadDailyReport', { year: wanduhr.year, month: wanduhr.month, day: wanduhr.day });
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
 */
export async function downloadMonthlyReport(
  rufen: KasseneckBinaryTransport,
  reportMonth: ReportMonth,
): Promise<Uint8Array> {
  const { month, year } = reportMonth;
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw eingabefehler('downloadReport', `Berichtsmonat: month muss 1-12 sein, war "${month}"`);
  }
  if (!Number.isInteger(year)) {
    throw eingabefehler('downloadReport', `Berichtsmonat: year muss eine ganze Zahl sein, war "${year}"`);
  }
  return rufen('downloadReport', { month, year });
}

/** Fehler in der Eingabe des Aufrufers — es geht keine Anfrage raus. */
function eingabefehler(functionName: string, grund: string): KasseneckValidationError {
  return new KasseneckValidationError(functionName, grund, 'request');
}
