// Der Katalog der Kassen-Meldungen als Vertragsdatei: was die Browser-Kasse
// und die Kassen-App dem Kassier sagen, genau einmal. Die App zieht diese
// Datei aus dem Tarball und erzeugt daraus ihre Konstanten; das Web importiert
// die Quelle direkt. Aufruf: `npm run fixtures:texte` (bewusst, nie automatisch).
import { readFileSync, writeFileSync } from 'node:fs';
import { BELEG_MAIL_FEHLER, BESCHRIFTUNGEN, FEHLERREGELN, MELDUNGEN, STORNO_ZAHLUNG_FEHLER } from '../dist/esm/kasse/texte.js';

const paket = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
// Die Zuordnung `code` -> Satz steht mit in der Datei: die App liest sie aus
// dem Tarball und entscheidet damit am Code dasselbe wie das Web, das die
// Quelle direkt importiert.
const vertrag = {
  version: paket.version,
  meldungen: MELDUNGEN,
  fehlerregeln: FEHLERREGELN,
  belegMailFehler: BELEG_MAIL_FEHLER,
  stornoZahlungFehler: STORNO_ZAHLUNG_FEHLER,
  // Knoepfe und Zeilennamen – keine Saetze, darum nicht unter `meldungen`.
  beschriftungen: BESCHRIFTUNGEN,
};
writeFileSync(new URL('../fixtures/kasse-texte.json', import.meta.url), JSON.stringify(vertrag, null, 2) + '\n');
console.log('Kassen-Texte geschrieben:', Object.keys(MELDUNGEN).length, 'Meldungen,', FEHLERREGELN.length, 'Regeln,',
  Object.keys(BELEG_MAIL_FEHLER).length, 'Mail-Fehlercodes,', Object.keys(STORNO_ZAHLUNG_FEHLER).length, 'Storno-Zahlungscodes,',
  Object.keys(BESCHRIFTUNGEN).length, 'Beschriftungen');
