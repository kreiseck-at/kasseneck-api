/**
 * Kachel mit Betrag und Referenz: eine Kachel fragt beim Antippen den Betrag
 * (`askPrice`) und/oder eine Referenz (Honorarnote, Auftragsnummer) ab.
 * Dieselben Regeln rechnen das Backend (`kachel-referenz-core.js`) und das
 * Dart-Paket; der Vertrag sind die Pruefaelle `fixtures/reference-cases.json`.
 */

/** `optional` = darf leer bleiben, `required` = Pflicht. */
export const REFERENCE_MODES = ['optional', 'required'] as const;
export type ReferenceMode = typeof REFERENCE_MODES[number];

/** Einstellung am Artikel (Draht `reference`). */
export interface PosReference {
  mode: ReferenceMode;
  /** Titel des Eingabefelds („Honorarnote Nr.“); steht nie am Beleg. */
  label: string;
  /** Platzhalter/Hilfetext („z. B. 2026/0123“); null = keiner. */
  hint: string | null;
  /** Regulaerer Ausdruck fuer die ganze Eingabe (ohne ^/$); null = keiner. */
  pattern: string | null;
  /** true = falsches Format sperrt, false = nur Warnung. */
  patternStrict: boolean;
}

/** Hoechstlaenge der Eingabe an der Kasse. */
export const REFERENCE_INPUT_MAX = 40;
export const REFERENCE_LABEL_MAX = 30;
export const REFERENCE_HINT_MAX = 60;
export const REFERENCE_PATTERN_MAX = 200;

/** Vorlagen fuer das Musterfeld im Panel. */
export const REFERENCE_PATTERN_TEMPLATES: readonly { key: 'digits' | 'year_number' | 'letters_digits'; pattern: string }[] = [
  { key: 'digits', pattern: '\\d+' },
  { key: 'year_number', pattern: '\\d{4}/\\d{1,6}' },
  { key: 'letters_digits', pattern: '[A-Za-z]{1,4}-?\\d{1,8}' },
];

// Steuer- und unsichtbare Formatzeichen.
// eslint-disable-next-line no-control-regex
const STEUERZEICHEN = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\ufeff]/g;

/** Text NFC, ohne Steuerzeichen, Leerraum zusammengezogen und getrimmt. */
export function cleanReferenceText(text: string): string {
  return text.normalize('NFC').replace(STEUERZEICHEN, '').replace(/\s+/g, ' ').trim();
}

// Konstrukte, die JS und Dart nicht garantiert gleich auswerten.
const GESPERRT = [/\(\?<[=!]/, /\(\?<[A-Za-z]/, /\\[1-9]/, /\\k</, /\(\?[a-zA-Z]/];

/** Ist das Muster erlaubt (kompilierbar, ohne gesperrte Konstrukte)? */
export function isValidReferencePattern(pattern: string | null | undefined): boolean {
  if (typeof pattern !== 'string' || pattern.length < 1 || pattern.length > REFERENCE_PATTERN_MAX) return false;
  if (GESPERRT.some((r) => r.test(pattern))) return false;
  try {
    new RegExp(`^(?:${pattern})$`);
    return true;
  } catch {
    return false;
  }
}

/** Reines Ziffernmuster -> die Kasse zeigt die Zifferntastatur. */
export function isDigitsOnlyPattern(pattern: string | null | undefined): boolean {
  if (typeof pattern !== 'string' || pattern === '' || !isValidReferencePattern(pattern)) return false;
  const rest = pattern
    .replace(/\\d/g, '')
    .replace(/\[0-9\]/g, '')
    .replace(/\{\d+(,\d*)?\}/g, '')
    .replace(/\(\?:/g, '')
    .replace(/[()|?*+^$]/g, '');
  return rest === '';
}

export type ReferenceCheckResult = 'ok' | 'empty' | 'warning' | 'error';

/**
 * Prueft die Eingabe an der Kasse. `empty` und `error` sperren das Uebernehmen,
 * `warning` zeigt den Hinweis und laesst uebernehmen. Ein ungueltiges Muster
 * (Altbestand, fremder Client) gilt wie keines.
 */
export function checkReference(
  input: string | null | undefined,
  reference: Pick<PosReference, 'mode' | 'pattern' | 'patternStrict'> | null | undefined,
): { result: ReferenceCheckResult; value: string } {
  const value = cleanReferenceText(input ?? '').slice(0, REFERENCE_INPUT_MAX);
  if (!reference) return { result: 'ok', value };
  if (value === '') return { result: reference.mode === 'required' ? 'empty' : 'ok', value };
  if (reference.pattern && isValidReferencePattern(reference.pattern)) {
    if (!new RegExp(`^(?:${reference.pattern})$`).test(value)) {
      return { result: reference.patternStrict ? 'error' : 'warning', value };
    }
  }
  return { result: 'ok', value };
}

/** Positionsname am Beleg: Artikelname + Leerzeichen + Referenz (leer = nur der Name). */
export function referenceLineName(articleName: string, value: string | null | undefined): string {
  return value ? `${articleName} ${value}` : articleName;
}

/** Liest `reference` vom Draht; alles Unbrauchbare -> null. */
export function fromReferencePayload(p: unknown): PosReference | null {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const r = p as Record<string, unknown>;
  if (r.mode !== 'optional' && r.mode !== 'required') return null;
  if (typeof r.label !== 'string' || r.label === '') return null;
  const pattern = typeof r.pattern === 'string' && r.pattern !== '' ? r.pattern : null;
  return {
    mode: r.mode,
    label: r.label,
    hint: typeof r.hint === 'string' && r.hint !== '' ? r.hint : null,
    pattern,
    patternStrict: pattern !== null && r.patternStrict === true,
  };
}
