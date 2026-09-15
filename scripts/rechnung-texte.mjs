// Schreibt den Textkatalog der Rechnungen nach fixtures/rechnung-texte.json.
//
// Quelle ist src/rechnung/texte.ts — die Datei hier liest nur ab. Das Backend
// liest den Katalog aus dem vendorierten Paket (PDF, E-Rechnung, Mail), die
// Statusseite im Web aus dem Unterpfad `@kreiseck/kasseneck-api/rechnung`.
//
// Aufruf: `npm run fixtures:rechnungstexte` (bewusst, nie automatisch).
import { readFileSync, writeFileSync } from 'node:fs';
import * as rechnung from '../dist/esm/rechnung/index.js';

const paket = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const datei = {
  version: paket.version,
  sprachen: [...rechnung.INVOICE_LANGUAGES],
  texte: rechnung.RECHNUNG_TEXTE,
  einheiten: rechnung.RECHNUNG_EINHEITEN_CODES,
};

writeFileSync(new URL('../fixtures/rechnung-texte.json', import.meta.url), JSON.stringify(datei, null, 2) + '\n');
console.log('Rechnungstexte geschrieben:', Object.keys(rechnung.RECHNUNG_TEXTE.de).length, 'Schluessel,', datei.sprachen.join('/'));
