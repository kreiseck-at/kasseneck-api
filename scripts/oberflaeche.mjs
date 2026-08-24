// Die Oberflaeche des Pakets als Golden-Datei: welche Aufrufe es gibt, welche
// Werte die Enums kennen, welche Rechte es unterscheidet.
//
// Sie ist die Zusage an die Zwillinge (Dart-Paket, Backend): wer einen Eintrag
// nicht hat, muss ihn nachbauen oder als Ausnahme benennen. Anders als die
// Standardwerte-Datei findet sie, was einem Zwilling ganz FEHLT — ein Aufruf,
// den er nicht kennt, faellt bei einem reinen Wertevergleich nie auf.
//
// Aufruf: `npm run fixtures:oberflaeche` (bewusst, nie automatisch).
import { readFileSync, writeFileSync } from 'node:fs';
import { AUFRUFE } from '../dist/esm/client/aufrufe.js';
import {
  STIL, SCHRIFT, WASSERZEICHEN, MENGE, TG_MODUS, KASSIEREN_MODUS, KARTENANBIETER,
  BELEG_AUSGABE, LAYOUT, KATPOS, HOEHE, DRUCKER_ART, TERMINAL_VIA, TERMINAL_ART,
  PAPIER, ZEICHENSATZ, SCHNITT, LADE_AUTO, TASTEN_AKTIONEN,
} from '../dist/esm/kasse/index.js';
import { REGISTER_PERMS } from '../dist/esm/register/index.js';

const paket = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const vertrag = {
  version: paket.version,
  aufrufe: [...AUFRUFE],
  enums: {
    stil: [...STIL], schrift: [...SCHRIFT], wasserzeichen: [...WASSERZEICHEN],
    menge: [...MENGE], tgModus: [...TG_MODUS], kassierenModus: [...KASSIEREN_MODUS],
    kartenanbieter: [...KARTENANBIETER], belegAusgabe: [...BELEG_AUSGABE],
    layout: [...LAYOUT], katpos: [...KATPOS], hoehe: [...HOEHE],
    druckerArt: [...DRUCKER_ART], terminalVia: [...TERMINAL_VIA], terminalArt: [...TERMINAL_ART],
    papier: [...PAPIER], zeichensatz: [...ZEICHENSATZ], schnitt: [...SCHNITT],
    ladeAuto: [...LADE_AUTO],
  },
  rechte: [...REGISTER_PERMS],
  tastenAktionen: [...TASTEN_AKTIONEN],
};

writeFileSync(new URL('../fixtures/oberflaeche.json', import.meta.url), JSON.stringify(vertrag, null, 2) + '\n');
console.log('Oberflaeche geschrieben:', vertrag.aufrufe.length, 'Aufrufe,',
  Object.keys(vertrag.enums).length, 'Enums,', vertrag.rechte.length, 'Rechte');
