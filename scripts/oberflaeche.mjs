// Die Oberflaeche des Pakets als Golden-Datei: welche Aufrufe es gibt, welche
// Werte die Enums kennen, welche Rechte es unterscheidet.
//
// Sie ist die Zusage an die Zwillinge (Dart-Paket, Backend): wer einen Eintrag
// nicht hat, muss ihn nachbauen oder als Ausnahme benennen. Anders als die
// Standardwerte-Datei findet sie, was einem Zwilling ganz FEHLT — ein Aufruf,
// den er nicht kennt, faellt bei einem reinen Wertevergleich nie auf.
//
// Die Enums werden bewusst NICHT namentlich aufgezaehlt: eine Namensliste waere
// hier selbst wieder eine von Hand gepflegte Zweitliste, und ein neu angelegtes
// Enum fehlte still im Vertrag — genau der Ausfall, den diese Datei verhindern
// soll. Stattdessen wird der ganze Kassen-Namensraum abgelesen.
//
// Aufruf: `npm run fixtures:oberflaeche` (bewusst, nie automatisch).
import { readFileSync, writeFileSync } from 'node:fs';
import { AUFRUFE } from '../dist/esm/client/aufrufe.js';
import * as kasse from '../dist/esm/kasse/index.js';
import * as partner from '../dist/esm/partner/index.js';
import { REGISTER_PERMS } from '../dist/esm/register/index.js';

/** GROSS_GESCHRIEBEN -> kleinCamel: DRUCKER_ART -> druckerArt, KATPOS -> katpos. */
const schluessel = (name) => name
  .toLowerCase()
  .replace(/_(.)/g, (_, zeichen) => zeichen.toUpperCase());

/** Enum = exportierte Konstante in GROSSSCHRIFT, deren Wert eine Liste aus Text oder Zahlen ist. */
const istEnumListe = (name, wert) => /^[A-Z][A-Z0-9_]*$/.test(name)
  && Array.isArray(wert)
  && wert.every((eintrag) => typeof eintrag === 'string' || typeof eintrag === 'number');

const enums = {};
// Alias-Paare (`TASTEN_AKTIONEN` ist dieselbe Liste wie `KASSE_TASTEN_AKTIONEN`)
// duerfen nicht zweimal im Vertrag stehen; der zuerst gesehene Name gewinnt.
const gesehen = new Set();
// Die Namen sortiert durchgehen, damit die Reihenfolge in der Datei stabil
// bleibt und der byteweise Waechter nicht bei jedem Lauf anschlaegt.
for (const name of Object.keys(kasse).sort()) {
  const wert = kasse[name];
  if (!istEnumListe(name, wert)) continue;
  // Die Tasten-Aktionen tragen einen eigenen Schluessel, nicht `enums`.
  if (wert === kasse.TASTEN_AKTIONEN) continue;
  if (gesehen.has(wert)) continue;
  gesehen.add(wert);
  enums[schluessel(name)] = [...wert];
}

// Dasselbe fuer den Partner-Teil, und aus demselben Grund abgelesen statt
// aufgezaehlt. Er kam sonst als reine Namensliste ueber den Vertrag: die 18
// Aufrufe standen darin, die 27 Fehlercodes, die 15 Webhook-Ereignisse, die
// drei Vertragswege und der Wiederholungsplan dagegen nicht. Genau die sind
// aber das, was ein Zwilling von Hand nachpflegt — und wo er still abweichen
// kann, ohne dass ein Test anschlaegt.
//
// Eigener Schluessel `partner`, nicht `enums`: die Enum-Pruefung des
// Dart-Zwillings schickt jeden Wert durch `KasseSettings.aus` und hat mit
// Fehlercodes nichts zu tun.
const partnerListen = {};
for (const name of Object.keys(partner).sort()) {
  const wert = partner[name];
  if (!istEnumListe(name, wert)) continue;
  partnerListen[schluessel(name)] = [...wert];
}

const paket = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const vertrag = {
  version: paket.version,
  aufrufe: [...AUFRUFE],
  enums,
  rechte: [...REGISTER_PERMS],
  tastenAktionen: [...kasse.TASTEN_AKTIONEN],
  partner: partnerListen,
};

writeFileSync(new URL('../fixtures/oberflaeche.json', import.meta.url), JSON.stringify(vertrag, null, 2) + '\n');
console.log('Oberflaeche geschrieben:', vertrag.aufrufe.length, 'Aufrufe,',
  Object.keys(vertrag.enums).length, 'Enums,', vertrag.rechte.length, 'Rechte,',
  Object.keys(vertrag.partner).length, 'Partner-Listen');
