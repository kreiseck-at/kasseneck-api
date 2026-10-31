// Gemeinsame Prueffaelle des Papierschnitts am Bon fuer den Dart-Zwilling:
// je Fall ein Golden-Layout unter expected/ (wahlweise mit anderer
// Papierbreite) und die Option `cut` von escPosLayoutBytes (fehlt = Vorgabe,
// `true`, `'full'`, `'partial'` oder `false`); die Bytes stehen unter
// expected/print-cut.<fall>.hex. Alle anderen Druckoptionen bleiben Vorgabe.
// Die Kassen stellen den Schnitt je Geraet ein (`cut`: partial, full, none);
// ohne Schnitt fehlen am Ende genau die fuenf Leerzeilen und `GS V`.
// Aufruf: `npm run fixtures:schnitt` (bewusst, nie automatisch).
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { escPosLayoutBytes } from '../dist/esm/receipt/index.js';

const expected = new URL('../fixtures/expected/', import.meta.url);
const hex = (bytes) => {
  const teile = [];
  for (let i = 0; i < bytes.length; i += 32) teile.push(Array.from(bytes.subarray(i, i + 32), (b) => b.toString(16).padStart(2, '0')).join(''));
  return teile.join('\n') + '\n';
};

const faelle = [
  { name: 'sale-cash-default', receipt: 'sale-cash' },
  { name: 'sale-cash-true', receipt: 'sale-cash', cut: true },
  { name: 'sale-cash-full', receipt: 'sale-cash', cut: 'full' },
  { name: 'sale-cash-partial', receipt: 'sale-cash', cut: 'partial' },
  { name: 'sale-cash-none', receipt: 'sale-cash', cut: false },
  { name: 'sale-cash-mm58-partial', receipt: 'sale-cash', paperSize: 'mm58', cut: 'partial' },
  { name: 'sale-cash-mm58-none', receipt: 'sale-cash', paperSize: 'mm58', cut: false },
  { name: 'zero-start-none', receipt: 'zero-start', cut: false },
];

const golden = (name) => JSON.parse(readFileSync(new URL(`${name}.lines.json`, expected), 'utf8'));

// Alte Hex-Dateien zuerst weg, damit ein gestrichener Fall nicht als Leiche liegen bleibt.
for (const datei of readdirSync(expected)) if (datei.startsWith('print-cut.')) rmSync(new URL(datei, expected));

for (const f of faelle) {
  let layout = golden(f.receipt);
  if (f.paperSize !== undefined) layout = { ...layout, paperSize: f.paperSize };
  const optionen = f.cut === undefined ? {} : { cut: f.cut };
  writeFileSync(new URL(`print-cut.${f.name}.hex`, expected), hex(escPosLayoutBytes(layout, optionen)));
}

const datei = {
  version: 1,
  _note:
    'Paper cut at the end of a printed receipt (escPosLayoutBytes option `cut`): missing = default = `true` = `"full"` (five empty lines, then GS V 0), `"partial"` (five empty lines, then GS V 1), `false` (neither: the bytes end with the last line of the receipt). A case names a golden layout under expected/<receipt>.lines.json (with `paperSize` replacing its paper size); every other print option is the default. expected/print-cut.<name>.hex holds the bytes (32 bytes per line). Both registers set the cut per device (`cut`: partial, full, none). Written by `npm run fixtures:schnitt`.',
  cases: faelle.map((f) => ({
    name: f.name,
    receipt: f.receipt,
    ...(f.paperSize !== undefined ? { paperSize: f.paperSize } : {}),
    ...(f.cut !== undefined ? { cut: f.cut } : {}),
  })),
};
writeFileSync(new URL('../fixtures/print-cut-cases.json', import.meta.url), JSON.stringify(datei, null, 2) + '\n');
console.log(`Schnitt-Prueffaelle geschrieben: ${faelle.length} Faelle mit Hex-Dateien`);
