// Schreibt den Textkatalog der Rechnungen nach fixtures/invoice-texts.json.
//
// Quelle ist src/invoice/texte.ts – die Datei hier liest nur ab. Das Backend
// liest den Katalog aus dem vendorierten Paket (PDF, E-Rechnung, Mail), die
// Statusseite im Web aus dem Unterpfad `@kreiseck/kasseneck-api/invoice`.
//
// Aufruf: `npm run fixtures:rechnungstexte` (bewusst, nie automatisch).
import { readFileSync, writeFileSync } from 'node:fs';
import * as rechnung from '../dist/esm/invoice/index.js';

const paket = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// Strukturschluessel englisch seit 1.0 (unter 0.x: sprachen, texte, einheiten).
const datei = {
  version: paket.version,
  languages: [...rechnung.INVOICE_LANGUAGES],
  texts: rechnung.INVOICE_TEXTS,
  units: rechnung.INVOICE_UNIT_CODES,
};

writeFileSync(new URL('../fixtures/invoice-texts.json', import.meta.url), JSON.stringify(datei, null, 2) + '\n');
console.log('Rechnungstexte geschrieben:', Object.keys(rechnung.INVOICE_TEXTS.de).length, 'Schluessel,', datei.languages.join('/'));
