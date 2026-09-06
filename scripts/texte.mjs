// Der Katalog der Kassen-Meldungen als Vertragsdatei: was die Browser-Kasse
// und die Kassen-App dem Kassier sagen, genau einmal. Die App zieht diese
// Datei aus dem Tarball und erzeugt daraus ihre Konstanten; das Web importiert
// die Quelle direkt. Aufruf: `npm run fixtures:texte` (bewusst, nie automatisch).
import { readFileSync, writeFileSync } from 'node:fs';
import { FEHLERREGELN, MELDUNGEN } from '../dist/esm/kasse/texte.js';

const paket = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const vertrag = { version: paket.version, meldungen: MELDUNGEN, fehlerregeln: FEHLERREGELN };
writeFileSync(new URL('../fixtures/kasse-texte.json', import.meta.url), JSON.stringify(vertrag, null, 2) + '\n');
console.log('Kassen-Texte geschrieben:', Object.keys(MELDUNGEN).length, 'Meldungen,', FEHLERREGELN.length, 'Regeln');
