// Gemeinsame Prueffaelle des Belegduplikats (markAsDuplicate) fuer den
// Dart-Zwilling: je Fall das Eingabe-Layout (ein Golden unter expected/,
// wahlweise mit anderer Papierbreite, oder eine eigene Eingabe), die
// Zeitpunkte der Nachdrucke (einer je Anwendung), die erwartete Wiener
// Anzeige der letzten Zeit und das erwartete Layout. Fuer die Faelle mit
// `print` dazu die ESC/POS-Bytes des Nachdrucks (Druckoptionen: alles
// Vorgabe, mit `logo` das Probe-Logo) unter expected/duplicate.<fall>.hex.
// Aufruf: `npm run fixtures:duplikat` (bewusst, nie automatisch). Nach dem
// Erzeugen von Hand pruefen: die Zeile „Duplikat am:“ direkt unter
// „Beleg-ID:“, der Rest wie der Golden.
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { escPosLayoutBytes, logoDimensions, logoRasterSize, markAsDuplicate } from '../dist/esm/receipt/index.js';

const expected = new URL('../fixtures/expected/', import.meta.url);
const hex = (bytes) => {
  const teile = [];
  for (let i = 0; i < bytes.length; i += 32) teile.push(Array.from(bytes.subarray(i, i + 32), (b) => b.toString(16).padStart(2, '0')).join(''));
  return teile.join('\n') + '\n';
};

/** Probe-Logo: Stufe M, 300x120 px, jeder Punkt schwarz, Raster in der Groesse des Blatts. */
const probeLogo = (zeichen) => {
  const { width, height } = logoRasterSize(logoDimensions({ size: 'M', pixelWidth: 300, pixelHeight: 120 }, zeichen), zeichen);
  return { size: 'M', pixelWidth: 300, pixelHeight: 120, raster: { width, height, dots: new Uint8Array(width * height).fill(1) } };
};

// 24.10.2026 14:10:05 in Wien (Sommerzeit).
const NACHDRUCK = '2026-10-24T12:10:05Z';
const faelle = [
  { name: 'sale-cash', receipt: 'sale-cash', printedAt: [NACHDRUCK], display: '24.10.2026 14:10:05', print: true },
  { name: 'sale-cash-mm58', receipt: 'sale-cash', paperSize: 'mm58', printedAt: [NACHDRUCK], display: '24.10.2026 14:10:05', print: true },
  { name: 'cancellation-full', receipt: 'cancellation-full', printedAt: [NACHDRUCK], display: '24.10.2026 14:10:05', print: true },
  { name: 'cancellation-partial', receipt: 'cancellation-partial', printedAt: [NACHDRUCK], display: '24.10.2026 14:10:05', print: true },
  { name: 'training', receipt: 'training', printedAt: [NACHDRUCK], display: '24.10.2026 14:10:05' },
  { name: 'zero-start', receipt: 'zero-start', printedAt: [NACHDRUCK], display: '24.10.2026 14:10:05', print: true },
  { name: 'zero-monthly', receipt: 'zero-monthly', printedAt: [NACHDRUCK], display: '24.10.2026 14:10:05' },
  // Mit Logo: Testkasse (fuehrender Rahmen ueber dem Logo) auf 80 mm, Dienstleistungsgutschein auf 58 mm.
  { name: 'test-cashregister-sale-logo', receipt: 'test-cashregister-sale', printedAt: [NACHDRUCK], display: '24.10.2026 14:10:05', print: true, logo: true },
  { name: 'voucher-multi-purpose-redeem', receipt: 'voucher-multi-purpose-redeem', printedAt: [NACHDRUCK], display: '24.10.2026 14:10:05', print: true },
  { name: 'voucher-service-redeem-logo', receipt: 'voucher-service-redeem', printedAt: [NACHDRUCK], display: '24.10.2026 14:10:05', print: true, logo: true },
  { name: 'voucher-single-purpose-sale', receipt: 'voucher-single-purpose-sale', printedAt: [NACHDRUCK], display: '24.10.2026 14:10:05' },
  { name: 'voucher-payout', receipt: 'voucher-payout', printedAt: [NACHDRUCK], display: '24.10.2026 14:10:05' },
  // Ohne Spaltenzeile „Beleg-ID:“: die Zeile steht ganz oben.
  { name: 'shift-close', receipt: 'shift-close', printedAt: [NACHDRUCK], display: '24.10.2026 14:10:05', print: true },
  { name: 'cash-movement', receipt: 'cash-movement', printedAt: [NACHDRUCK], display: '24.10.2026 14:10:05' },
  { name: 'empty', input: { lines: [], paperSize: 'mm80', ruleset: 2 }, printedAt: [NACHDRUCK], display: '24.10.2026 14:10:05' },
  // Zweimal nachgedruckt: eine Zeile, die spaetere Zeit.
  { name: 'sale-cash-twice', receipt: 'sale-cash', printedAt: [NACHDRUCK, '2026-10-24T13:45:00Z'], display: '24.10.2026 15:45:00', print: true },
  // Umstellungen: Ende der Sommerzeit (03:00 MESZ -> 02:00 MEZ), Beginn (02:00 MEZ -> 03:00 MESZ).
  { name: 'summer-time-last-second', receipt: 'sale-cash', paperSize: 'mm58', printedAt: ['2026-10-25T00:59:59Z'], display: '25.10.2026 02:59:59', print: true },
  { name: 'winter-time-first-second', receipt: 'sale-cash', paperSize: 'mm58', printedAt: ['2026-10-25T01:00:00Z'], display: '25.10.2026 02:00:00', print: true },
  { name: 'summer-time-start', receipt: 'sale-cash', printedAt: ['2026-03-29T01:00:00Z'], display: '29.03.2026 03:00:00', print: true },
  // Eine Wiener Uhrzeit, die es in New York nicht gibt (dort Sommerzeitbeginn am 08.03.2026 02:00).
  { name: 'vienna-time-in-new-york-gap', receipt: 'zero-start', printedAt: ['2026-03-08T01:30:00Z'], display: '08.03.2026 02:30:00' },
  // Bruchteile werden abgeschnitten, nicht gerundet.
  { name: 'milliseconds-cut', receipt: 'sale-cash', printedAt: ['2026-10-24T12:10:05.999Z'], display: '24.10.2026 14:10:05' },
];

const golden = (name) => JSON.parse(readFileSync(new URL(`${name}.lines.json`, expected), 'utf8'));

// Alte Hex-Dateien zuerst weg, damit ein gestrichener Fall nicht als Leiche liegen bleibt.
for (const datei of readdirSync(expected)) if (datei.startsWith('duplicate.')) rmSync(new URL(datei, expected));

const cases = faelle.map((f) => {
  let layout = f.receipt !== undefined ? golden(f.receipt) : f.input;
  if (f.paperSize !== undefined) layout = { ...layout, paperSize: f.paperSize };
  for (const iso of f.printedAt) layout = markAsDuplicate(layout, new Date(iso));
  const zeile = layout.lines.find((z) => z.kind === 'columns' && z.columns[0]?.text === 'Duplikat am:');
  if (zeile?.columns[1]?.text !== f.display) throw new Error(`${f.name}: Anzeige ${zeile?.columns[1]?.text}, erwartet ${f.display}`);
  if (f.print) {
    const logo = f.logo ? probeLogo(layout.paperSize === 'mm58' ? 32 : 48) : null;
    writeFileSync(new URL(`duplicate.${f.name}.hex`, expected), hex(escPosLayoutBytes(layout, { logo })));
  }
  return {
    name: f.name,
    ...(f.receipt !== undefined ? { receipt: f.receipt } : { input: f.input }),
    ...(f.paperSize !== undefined ? { paperSize: f.paperSize } : {}),
    printedAt: f.printedAt,
    display: f.display,
    print: f.print === true,
    logo: f.logo === true,
    expected: layout,
  };
});

const datei = {
  version: 2,
  _note:
    'Reprint marked as a duplicate (markAsDuplicate, Erlass BMF-AV Nr. 2/2026, section 4.5.6): one plain two-column line "Duplikat am:" with the reprint time in Europe/Vienna (DD.MM.YYYY HH:MM:SS), right after the first columns line whose first column is "Beleg-ID:", else as the first line; a second reprint replaces the time. A case names a golden layout under expected/<receipt>.lines.json (with `paperSize` replacing its paper size) or carries its own input; markAsDuplicate is applied once per instant in `printedAt`, in order, and must return `expected` exactly; `display` is the expected time text. For cases with `print`, expected/duplicate.<name>.hex holds the ESC/POS bytes of the result with default print options (escPosLayoutBytes(layout, { logo }); 32 bytes per line); with `logo` the probe logo is size M, 300x120 px, every dot black, raster sized by logoDimensions/logoRasterSize at the paper width. Written by `npm run fixtures:duplikat`.',
  label: 'Duplikat am:',
  cases,
};
writeFileSync(new URL('../fixtures/duplicate-cases.json', import.meta.url), JSON.stringify(datei, null, 2) + '\n');
console.log(`Duplikat-Prueffaelle geschrieben: ${cases.length} Faelle, ${cases.filter((c) => c.print).length} Hex-Dateien`);
