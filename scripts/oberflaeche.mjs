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
import { ALL_CALLS, POS_CALLS, PUBLIC_CALLS, UNKNOWN_OUTCOME_CALLS, isPosCall, isPosOnlyCall } from '../dist/esm/client/aufrufe.js';
import { DEFAULT_BASE_URL, POS_BASE_URL } from '../dist/esm/client/transport.js';
import * as kasse from '../dist/esm/pos/index.js';
import * as partner from '../dist/esm/partner/index.js';
import * as rechnung from '../dist/esm/invoice/index.js';
import * as lager from '../dist/esm/inventory/index.js';
import { REGISTER_ERROR_CODES, REGISTER_PERMS } from '../dist/esm/register/index.js';

/** GROSS_GESCHRIEBEN -> kleinCamel: PRINTER_TYPE -> printerType, CUT -> cut. */
const schluessel = (name) => name
  .toLowerCase()
  .replace(/_(.)/g, (_, zeichen) => zeichen.toUpperCase());

/** Enum = exportierte Konstante in GROSSSCHRIFT, deren Wert eine Liste aus Text oder Zahlen ist. */
const istEnumListe = (name, wert) => /^[A-Z][A-Z0-9_]*$/.test(name)
  && Array.isArray(wert)
  && wert.every((eintrag) => typeof eintrag === 'string' || typeof eintrag === 'number');

// `enums` fuehrt nur die Wertemengen der Einstellungen, jede unter dem Namen
// ihres Feldes (`TILE_STYLE` -> `tileStyle`): die Enum-Pruefung des
// Dart-Zwillings schickt jeden Wert durch das Einstellungs-Modell. Die
// uebrigen Listen des Kassen-Teils (Fehlercodes, Druckjob-Staende,
// Mengenregeln) stehen unter `pos`.
const einstellungsFelder = new Set([...Object.keys(kasse.POS_BUSINESS_DEFAULTS), ...Object.keys(kasse.POS_DEVICE_DEFAULTS)]);
const enums = {};
const kasseListen = {};
// Die Namen sortiert durchgehen, damit die Reihenfolge in der Datei stabil
// bleibt und der byteweise Waechter nicht bei jedem Lauf anschlaegt.
for (const name of Object.keys(kasse).sort()) {
  const wert = kasse[name];
  if (!istEnumListe(name, wert)) continue;
  // Die Tasten-Aktionen tragen einen eigenen Schluessel.
  if (wert === kasse.POS_SHORTCUT_ACTIONS) continue;
  if (einstellungsFelder.has(schluessel(name))) enums[schluessel(name)] = [...wert];
  else kasseListen[schluessel(name)] = [...wert];
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

// Dasselbe fuer die Rechnungs-API: Fehlercodes, Gutschrift-Gruende und die
// Werte von Steuerschema, Preismodus & Co. Die Feldbeschreibung selbst steht
// nicht hier, sondern im Schema (`npm run fixtures:rechnung`) — hier nur, was
// ein Zwilling als Liste nachpflegt.
const rechnungListen = {};
for (const name of Object.keys(rechnung).sort()) {
  const wert = rechnung[name];
  if (!istEnumListe(name, wert)) continue;
  rechnungListen[schluessel(name)] = [...wert];
}

// Dasselbe fuer die Lager-API: Endpunkte, Kataloge, Ereignisse, Fehlercodes.
const lagerListen = {};
for (const name of Object.keys(lager).sort()) {
  const wert = lager[name];
  if (!istEnumListe(name, wert)) continue;
  lagerListen[schluessel(name)] = [...wert];
}

const paket = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// Schluessel englisch seit 1.0. Unter 0.x: aufrufe (eine Liste), rechte,
// tastenAktionen, kasse, rechnung.
const vertrag = {
  version: paket.version,
  // Die zwei Wege unter /v3: oeffentlich und Kassenweg.
  baseUrls: { public: DEFAULT_BASE_URL, pos: POS_BASE_URL },
  // Die Aufrufe dieses Pakets je Weg. Die sechs Beleg-Aufrufe, die es auf
  // beiden Wegen gibt, stehen in beiden Listen: die Kasse ruft sie ueber den
  // Kassenweg, alle anderen Verbraucher oeffentlich.
  calls: {
    public: ALL_CALLS.filter((name) => !isPosOnlyCall(name)),
    pos: ALL_CALLS.filter((name) => isPosCall(name)),
  },
  // Alle Endpunkte je Weg, wie im Backend-Vertrag fixtures/v3/v3-vokabular.json
  // (endpoints.public mit aeusseren Namen, endpoints.register).
  routes: { public: [...PUBLIC_CALLS], pos: [...POS_CALLS] },
  // Die Aufrufe mit Wirkung (seit 1.5.1), sortiert: scheitert einer nach dem
  // Senden (Netzfehler, Zeitlimit, HTTP 5xx, unlesbare Erfolgsantwort, HTML
  // mit Kennzeichen), ist sein Ausgang `unknown`, sonst `rejected`. Der
  // Dart-Zwilling fuehrt dieselbe Liste.
  unknownOutcomeCalls: [...UNKNOWN_OUTCOME_CALLS].sort(),
  enums,
  registerPerms: [...REGISTER_PERMS],
  registerErrorCodes: [...REGISTER_ERROR_CODES],
  posShortcutActions: [...kasse.POS_SHORTCUT_ACTIONS],
  pos: kasseListen,
  partner: partnerListen,
  invoice: rechnungListen,
  inventory: lagerListen,
};

writeFileSync(new URL('../fixtures/surface.json', import.meta.url), JSON.stringify(vertrag, null, 2) + '\n');
console.log('Oberflaeche geschrieben:', vertrag.calls.public.length, 'oeffentliche und', vertrag.calls.pos.length, 'Kassen-Aufrufe,',
  Object.keys(vertrag.enums).length, 'Enums,', vertrag.registerPerms.length, 'Rechte,',
  Object.keys(vertrag.partner).length, 'Partner-Listen');
