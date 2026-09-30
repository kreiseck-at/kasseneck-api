// Gemeinsame Prueffaelle des Zeichensatz-Testblatts fuer den Dart-Zwilling:
// die Zeilen (Bildschirm) und die ESC/POS-Bytes fuer 58 und 80 mm.
// Aufruf: `npm run fixtures:zeichensatz` (bewusst, nie automatisch). Nach dem
// Erzeugen von Hand gegen die Spec pruefen (Aufbau, ESC t je Zeile, GS L).
import { writeFileSync } from 'node:fs';
import { codeTableTestSheet, codeTableTestSheetBytes } from '../dist/esm/receipt/index.js';

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
