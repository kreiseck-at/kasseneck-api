// Gemeinsame Prueffaelle der Kasseninfo fuer die Pruefung (Kassennachschau,
// Stufe 2b): `info` ist `data` einer Antwort von getRegisterInspectionInfo, wie
// der Server sie sendet; `rows` ist inspectionInfoRows, `lines` ist
// inspectionInfoLines mit `width` und `printedAt`. Der Dart-Zwilling liest
// `info` mit seinem Modell und muss dieselben Zeilen liefern.
// Gerechnet wird mit dem gebauten Paket (dist/), nie von Hand; den Wortlaut
// des freigegebenen Texts haelt zusaetzlich test/kasseninfo.test.ts fest.
// Aufruf: `npm run fixtures:kasseninfo` (bewusst, nie automatisch).
import { writeFileSync } from 'node:fs';
import { getRegisterInspectionInfo, inspectionInfoLines, inspectionInfoRows } from '../dist/esm/pos/index.js';

// Werte erfunden (Kassen-ID, Inhaber); Hersteller und Kontakt wie im Backend.
const KASSE = {
  cashregisterId: 'KECK-1',
  product: { name: 'Kasseneck', cloudBased: true },
  manufacturer: { name: 'Post Now e.U.', vatId: 'ATU76279224' },
};
const ABSCHLUESSE = { monthlyDay: 1, monthlyTime: '00:05', timeZone: 'Europe/Vienna', annualIsDecember: true };
const KONTAKT = { contactEmail: 'hello@kasseneck.at' };
const KARTE = {
  provider: 'a_trust',
  serialHex: '11c6c7cd',
  serialDecimal: '298239949',
  holder: 'UID ATU12345675',
  issuer: 'A-Trust Registrierkasse.CA',
  validFrom: '2026-10-05T08:00:00.000Z',
  validTo: '2031-10-05T08:00:00.000Z',
  holderChecked: true,
  testCard: false,
  status: 'active',
};
const voll = (signature, mehr = {}) => ({ ...KASSE, signature, closings: ABSCHLUESSE, ...KONTAKT, ...mehr });
// 29.10.2026 14:05 in Wien (Winterzeit, UTC+1).
const GEDRUCKT = '2026-10-29T13:05:00.000Z';

const eingaben = [
  { name: 'echte Karte von A-Trust, Breite 42', info: voll(KARTE), width: 42, printedAt: GEDRUCKT },
  { name: 'echte Karte von A-Trust, Breite 48 (Zeilen wie im freigegebenen Text)', info: voll(KARTE), width: 48, printedAt: GEDRUCKT },
  { name: 'echte Karte von A-Trust, Breite 32', info: voll(KARTE), width: 32, printedAt: GEDRUCKT },
  {
    name: 'Testkarte: Einheit Testkarte, kein Betrieb, nur Seriennummer und Status',
    info: voll({ serialHex: 'abc123', serialDecimal: '11256099', testCard: true, status: 'active' }),
    width: 42,
    printedAt: GEDRUCKT,
  },
  { name: 'ohne Signatureinheit: der Teil Signatur entfaellt', info: voll(null), width: 42, printedAt: GEDRUCKT },
  {
    name: 'Ausfall mit Beginn (Wiener Zeit)',
    info: voll({ ...KARTE, status: 'outage', outageSince: '2026-10-29T13:47:12.000Z' }),
    width: 42,
    printedAt: '2026-10-29T14:10:00.000Z',
  },
  { name: 'Ausfall ohne Beginn', info: voll({ ...KARTE, status: 'outage' }), width: 42, printedAt: GEDRUCKT },
  { name: 'Inhaber nicht abgeglichen: keine Zeile Abgleich', info: voll({ ...KARTE, holderChecked: false }), width: 42, printedAt: GEDRUCKT },
  {
    name: 'fehlende Angaben: jede Zeile ohne Wert entfaellt',
    info: {
      product: { name: 'Kasseneck', cloudBased: false },
      manufacturer: { name: 'Post Now e.U.' },
      signature: { serialDecimal: '298239949', testCard: false },
      closings: { timeZone: 'Europe/Vienna' },
    },
    width: 42,
    printedAt: GEDRUCKT,
  },
  {
    name: 'unbekannter Anbieter, nur Beginn der Gueltigkeit, unbekannter Stand',
    info: voll({ serialHex: '0a1b2c3d', serialDecimal: '169552957', issuer: 'Beispiel-CA', validFrom: '2026-01-15T09:00:00.000Z', testCard: false, status: 'recovering' }),
    width: 42,
    printedAt: GEDRUCKT,
  },
  {
    name: 'nur Ende der Gueltigkeit, Hersteller nur mit UID',
    info: { ...voll({ ...KARTE, validFrom: undefined }), manufacturer: { vatId: 'ATU76279224' } },
    width: 42,
    printedAt: GEDRUCKT,
  },
  {
    name: 'Monatsbeleg am 15., ohne Jahresbeleg-Satz, Breite 48',
    info: voll(KARTE, { closings: { monthlyDay: 15, monthlyTime: '06:30', timeZone: 'Europe/Vienna', annualIsDecember: false } }),
    width: 48,
    printedAt: GEDRUCKT,
  },
  {
    name: 'Sommerzeit: Tageswechsel in Wien, nicht in UTC',
    info: voll({ ...KARTE, validFrom: '2026-07-01T22:30:00.000Z', validTo: '2031-06-30T21:59:00.000Z', status: 'outage', outageSince: '2026-08-14T22:15:00.000Z' }),
    width: 42,
    printedAt: '2026-08-14T22:20:00.000Z',
  },
  {
    name: 'lange Werte brechen hart, Steuerzeichen werden Leerzeichen, Breite 32',
    info: voll({
      ...KARTE,
      serialHex: '4f3a9c0e11d2b7a65c8e0f1a2b3c4d5e6f708192',
      serialDecimal: '452938465093028741093847561029384756102938',
      holder: 'Steuernummer 91-123/4565',
      issuer: '\tA-Trust Registrierkasse.CA\nZweite Zeile\u0085',
    }, { contactEmail: 'pruefung-der-registrierkassen@kasseneck.at' }),
    width: 32,
    printedAt: GEDRUCKT,
  },
];

const cases = [];
for (const e of eingaben) {
  // Wie der Server: ein fehlender Wert steht nicht in der Antwort.
  const info = JSON.parse(JSON.stringify(e.info));
  const gelesen = await getRegisterInspectionInfo(async () => info);
  cases.push({
    name: e.name,
    info,
    width: e.width,
    printedAt: e.printedAt,
    rows: inspectionInfoRows(gelesen),
    lines: inspectionInfoLines(gelesen, { width: e.width, printedAt: new Date(e.printedAt) }),
  });
}

const datei = {
  version: 1,
  note: 'Kasseninfo für die Prüfung (Kassennachschau, Stufe 2b). `info` ist `data` von getRegisterInspectionInfo, wie der Server sie sendet; `rows` ist inspectionInfoRows(info) für den Bildschirm, `lines` ist inspectionInfoLines(info, { width, printedAt }) für den Bondrucker. Fehlt ein Wert, entfällt die Zeile. Datum und Uhrzeit in Wiener Zeit. Web-Kasse, Kassen-App und der Dart-Zwilling liefern dieselben Zeilen.',
  cases,
};
writeFileSync(new URL('../fixtures/inspection-info-cases.json', import.meta.url), JSON.stringify(datei, null, 2) + '\n');
console.log('Kasseninfo-Faelle geschrieben:', cases.length);
