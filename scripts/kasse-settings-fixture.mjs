// Standardwerte der Kassen-Einstellungen als Golden-Datei.
//
// Sie sind die Zusage an alle Verbraucher: Backend (kasse-settings-core.js),
// Browser-Kasse und die Flutter-Kasse rechnen mit denselben Vorgaben. Ein
// Zwilling, der still andere Standardwerte hat, faellt sonst erst am Tresen auf
// — dort, wo ein Schalter anders steht als im Panel.
//
// Aufruf: `npm run fixtures:kasse` (bewusst, nie automatisch).
import { writeFileSync } from 'node:fs';
import { KASSE_BETRIEB_STANDARD, KASSE_GERAET_STANDARD } from '../dist/esm/kasse/index.js';

const standard = { betrieb: KASSE_BETRIEB_STANDARD, geraet: KASSE_GERAET_STANDARD };
const ziel = new URL('../fixtures/kasse-settings-standard.json', import.meta.url);
writeFileSync(ziel, JSON.stringify(standard, null, 2) + '\n');
console.log('Kassen-Standardwerte geschrieben:', Object.keys(standard.betrieb).length, 'Betriebs- und', Object.keys(standard.geraet).length, 'Geraetefelder');
