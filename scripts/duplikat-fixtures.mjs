// Gemeinsame Prueffaelle des Belegduplikats (markAsDuplicate) fuer den
// Dart-Zwilling: je Fall das Eingabe-Layout (ein Golden unter expected/ oder
// eine eigene Eingabe), wie oft die Funktion angewandt wird, und das
// erwartete Layout. Fuer die Faelle mit `print` dazu die ESC/POS-Bytes des
// Nachdrucks (Druckoptionen: alles Vorgabe) unter
// expected/duplicate.<fall>.hex.
// Aufruf: `npm run fixtures:duplikat` (bewusst, nie automatisch). Nach dem
// Erzeugen von Hand pruefen: erste Zeile „DUPLIKAT“, der Rest wie der Golden.
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { escPosLayoutBytes, markAsDuplicate } from '../dist/esm/receipt/index.js';

const expected = new URL('../fixtures/expected/', import.meta.url);
const hex = (bytes) => {
  const teile = [];
  for (let i = 0; i < bytes.length; i += 32) teile.push(Array.from(bytes.subarray(i, i + 32), (b) => b.toString(16).padStart(2, '0')).join(''));
  return teile.join('\n') + '\n';
};

const faelle = [
  { name: 'sale-cash', receipt: 'sale-cash', print: true },
  { name: 'cancellation-full', receipt: 'cancellation-full', print: true },
  { name: 'training', receipt: 'training' },
  { name: 'zero-start', receipt: 'zero-start', print: true },
  { name: 'zero-monthly', receipt: 'zero-monthly' },
  { name: 'test-cashregister-sale', receipt: 'test-cashregister-sale' },
  { name: 'voucher-multi-purpose-redeem', receipt: 'voucher-multi-purpose-redeem', print: true },
  { name: 'voucher-single-purpose-sale', receipt: 'voucher-single-purpose-sale' },
  { name: 'voucher-payout', receipt: 'voucher-payout' },
  { name: 'shift-close', receipt: 'shift-close' },
  { name: 'cash-movement', receipt: 'cash-movement' },
  // Idempotenz: dreimal angewandt wie einmal.
  { name: 'sale-cash-three-times', receipt: 'sale-cash', times: 3 },
  { name: 'empty', input: { lines: [], paperSize: 'mm80', ruleset: 2 } },
  // Erkennung ohne Ton: ein DUPLIKAT-Rahmen im Ton warning gilt als schon gekennzeichnet.
  {
    name: 'already-marked-warning-tone',
    input: {
      lines: [
        { kind: 'banner', text: 'DUPLIKAT', tone: 'warning' },
        { kind: 'text', text: 'Bäckerei Kornblum', align: 'center', bold: true },
      ],
      paperSize: 'mm80',
      ruleset: 2,
    },
  },
];

const golden = (name) => JSON.parse(readFileSync(new URL(`${name}.lines.json`, expected), 'utf8'));

// Alte Hex-Dateien zuerst weg, damit ein gestrichener Fall nicht als Leiche liegen bleibt.
for (const datei of readdirSync(expected)) if (datei.startsWith('duplicate.')) rmSync(new URL(datei, expected));

const cases = faelle.map((f) => {
  const times = f.times ?? 1;
  let layout = f.receipt !== undefined ? golden(f.receipt) : f.input;
  for (let i = 0; i < times; i += 1) layout = markAsDuplicate(layout);
  if (f.print) writeFileSync(new URL(`duplicate.${f.name}.hex`, expected), hex(escPosLayoutBytes(layout)));
  return {
    name: f.name,
    ...(f.receipt !== undefined ? { receipt: f.receipt } : { input: f.input }),
    times,
    print: f.print === true,
    expected: layout,
  };
});

const datei = {
  version: 1,
  _note:
    'Reprint marked as a duplicate (markAsDuplicate, Erlass BMF-AV Nr. 2/2026, section 4.5.6). A case names a golden layout under expected/<receipt>.lines.json or carries its own input; the function is applied `times` times and must return `expected` exactly. For cases with `print`, expected/duplicate.<name>.hex holds the ESC/POS bytes of that duplicate with default print options (escPosLayoutBytes(layout); 32 bytes per line). Written by `npm run fixtures:duplikat`.',
  text: 'DUPLIKAT',
  cases,
};
writeFileSync(new URL('../fixtures/duplicate-cases.json', import.meta.url), JSON.stringify(datei, null, 2) + '\n');
console.log(`Duplikat-Prueffaelle geschrieben: ${cases.length} Faelle, ${cases.filter((c) => c.print).length} Hex-Dateien`);
