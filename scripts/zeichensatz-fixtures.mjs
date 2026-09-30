// Gemeinsame Prueffaelle des Zeichensatz-Testblatts fuer den Dart-Zwilling:
// die Zeilen (Bildschirm) und die ESC/POS-Bytes fuer 58 und 80 mm. Dazu die
// Bons je Code-Tabelle: jeder Fall aus fixtures/code-table-receipts.json mit
// jeder Tabelle als ESC/POS-Bytes.
// Aufruf: `npm run fixtures:zeichensatz` (bewusst, nie automatisch). Nach dem
// Erzeugen von Hand gegen die Spec pruefen (Aufbau, ESC t je Zeile, GS L).
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { codeTableTestSheet, codeTableTestSheetBytes, escPosLayoutBytes } from '../dist/esm/receipt/index.js';
import { ladeFixture, zeilenFuer } from './belege-fixtures.mjs';

const eingabe = { cashregisterLabel: 'Kasse KECK-1', time: new Date('2026-09-30T12:05:00Z') };
const hex = (bytes) => {
  const teile = [];
  for (let i = 0; i < bytes.length; i += 32) teile.push(Array.from(bytes.subarray(i, i + 32), (b) => b.toString(16).padStart(2, '0')).join(''));
  return teile.join('\n') + '\n';
};
const ziel = (name) => new URL(`../fixtures/expected/code-table-test-sheet.${name}`, import.meta.url);

const fall = {
  input: { cashregisterLabel: eingabe.cashregisterLabel, time: eingabe.time.toISOString() },
  sheet: codeTableTestSheet({ ...eingabe, paper: 'mm58' }),
};
writeFileSync(ziel('lines.json'), JSON.stringify(fall, null, 2) + '\n');
for (const paper of ['mm58', 'mm80']) writeFileSync(ziel(`${paper}.hex`), hex(codeTableTestSheetBytes({ ...eingabe, paper })));
console.log('Testblatt-Prueffaelle geschrieben: lines.json, mm58.hex, mm80.hex');

// Bons je Code-Tabelle. Alte Dateien zuerst weg, damit ein gestrichener Fall
// nicht als Leiche liegen bleibt.
const expected = new URL('../fixtures/expected/', import.meta.url);
for (const datei of readdirSync(expected)) if (datei.startsWith('code-table-receipt.')) rmSync(new URL(datei, expected));
const belege = JSON.parse(readFileSync(new URL('../fixtures/code-table-receipts.json', import.meta.url), 'utf8'));
let anzahl = 0;
for (const fall of belege.cases) {
  const layout = zeilenFuer(fall.input ?? ladeFixture(fall.receipt));
  for (const tabelle of belege.tables) {
    writeFileSync(new URL(`code-table-receipt.${fall.name}.${tabelle}.hex`, expected), hex(escPosLayoutBytes(layout, { codeTable: tabelle })));
    anzahl += 1;
  }
}
console.log(`Bons je Code-Tabelle geschrieben: ${anzahl} Dateien`);
