import { KasseneckApiError } from './errors.js';

/*
 * Gemeinsame Bausteine der Fehlerhelfer je Teilpfad (Belege, Storno,
 * Zahlungen, Belegmail, Kasse, Anmeldung, Rechnung, Partner). Jeder Teilpfad
 * bietet dieselbe Form: eine Codeliste, `isXErrorCode(wert)`,
 * `xErrorCode(fehler)`, `isXError(fehler, code?)` und die Feldfehler einer
 * `validation`-Antwort. Paketintern, nicht Teil der Oberflaeche.
 */

/** Der Code des Fehlers, wenn er in `bekannt` steht; sonst `undefined`. */
export function bekannterCode<C extends string>(error: unknown, bekannt: ReadonlySet<string>): C | undefined {
  if (!(error instanceof KasseneckApiError)) return undefined;
  const code = error.code;
  return code !== undefined && bekannt.has(code) ? (code as C) : undefined;
}

/** Ein Feldfehler aus `data.errors[]` einer `validation`-Antwort. */
export interface Feldfehler {
  field: string;
  message: string;
}

/** Die Feldfehler einer `validation`-Antwort; leer, wenn es keine sind. */
export function feldfehlerVon(error: unknown): Feldfehler[] {
  if (!(error instanceof KasseneckApiError)) return [];
  const roh = error.details['errors'];
  if (!Array.isArray(roh)) return [];
  const raus: Feldfehler[] = [];
  for (const eintrag of roh) {
    if (eintrag === null || typeof eintrag !== 'object') continue;
    const { field, message } = eintrag as { field?: unknown; message?: unknown };
    if (typeof field === 'string' && typeof message === 'string') raus.push({ field, message });
  }
  return raus;
}
