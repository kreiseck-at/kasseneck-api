/**
 * Deutsch erkennen: Sperrliste deutscher Teilwoerter und Wortstaemme, geteilt
 * vom Waechter ueber die Exportnamen (`export-namen.test.ts`) und dem
 * Waechter ueber die Draht-Fixtures (`fixtures-v3.test.ts`).
 */

/** Ganze Teilwoerter (nach camelCase/`_` getrennt), die deutsch sind. */
export const WOERTER = new Set([
  'als', 'alt', 'anteil', 'art', 'aufruf', 'aus', 'aufrufe', 'ausweich', 'betrieb', 'bild', 'blatt', 'bloecke',
  'breite', 'breiten', 'deckel', 'druck', 'fall', 'faelle', 'fehler', 'fehlerart', 'fehlercode',
  'fehlerregeln', 'feld', 'fett', 'fuer', 'geraet', 'gilt', 'grund', 'hoehe', 'ist', 'je', 'kasse',
  'kein', 'klein', 'komma', 'leer', 'marke', 'mass', 'meldung', 'meldungen', 'mit', 'mittel', 'modell', 'modul',
  'neu', 'nur', 'oder', 'ohne', 'papier', 'passt', 'platzhalter', 'preis', 'punkte', 'rabatt',
  'rechnen', 'rechnung', 'rund', 'satz', 'schluessel', 'schritt', 'seite', 'spalten', 'stufe', 'stufen',
  'summe', 'summen', 'und', 'verhalten', 'vorhanden', 'zeichen', 'zeile', 'zeilen',
]);

/**
 * Wortstaemme, die auch mitten in einem Teilwort deutsch sind
 * (`Beschriftungs`, `Zulaessig`, `Umwandlungs` …).
 */
export const STAEMME = [
  'ausnahme', 'beleg', 'berechn', 'beschrift', 'betrag', 'darstell', 'ergebnis', 'fehler',
  'groesse', 'grenze', 'hoechst', 'mindest', 'nutzlast', 'optionen', 'pruef', 'rechen',
  'ruhezone', 'steuer', 'storno', 'umwandl', 'verdeckt', 'verteil', 'wort', 'zahlung', 'zulaessig',
  'anzahl', 'zeilenanfang',
];

export const UMLAUT = /[äöüÄÖÜß]/;

/**
 * Feste Begriffe aus BMF/RKSV, die deutsch bleiben, obwohl ein Stamm oben sie
 * trifft. Teilwort -> Grund. Leer: auch der Startbeleg heisst an der
 * Oberflaeche und am Draht /v3 englisch (`startReceipt`, `start_receipt_*`).
 */
export const FACHBEGRIFFE: Record<string, string> = {};

/** Teilwoerter eines Bezeichners: camelCase, GROSS_SCHRIFT, Ziffern, Pfadtrenner. */
export function teile(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_./\-*]+|(?<=\D)(?=\d)|(?<=\d)(?=\D)/)
    .filter(Boolean)
    .map((t) => t.toLowerCase());
}

/**
 * Warum ein Name deutsch ist, oder `null`. `weitere`: zusaetzliche ganze
 * Teilwoerter (etwa die Katalogwerte der inneren Form fuer die Fixtures).
 */
export function deutschIn(name: string, weitere: ReadonlySet<string> = new Set()): string | null {
  if (UMLAUT.test(name)) return 'Umlaut';
  for (const t of teile(name)) {
    if (t in FACHBEGRIFFE) continue;
    if (WOERTER.has(t) || weitere.has(t)) return `Wort "${t}"`;
    for (const s of STAEMME) if (t.includes(s)) return `Stamm "${s}"`;
  }
  return null;
}
