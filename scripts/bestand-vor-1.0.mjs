// Friert den Bestand der Vertragsdateien der 0.x-Linie ein: welche Dateien
// unter fixtures/ es gab und welche Schluessel jede JSON-Datei trug (alle
// Ebenen, als Menge). Daran prueft test/umbenennung-1.0.test.ts, dass
// fixtures/renames-1.0.json jede Datei und jeden Schluessel nennt, der seit
// 1.0 anders heisst oder fehlt.
//
// Quelle ist git (Stand der veroeffentlichten 0.31.0; 0.30.0 hat dieselben
// Dateien und nur Schluessel, die 0.31.0 auch hat). Einmalig:
//   node scripts/bestand-vor-1.0.mjs [ref]
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const ref = process.argv[2] ?? 'e4b2887';
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 << 20 });
const version = JSON.parse(git('show', `${ref}:package.json`)).version;
const dateien = git('ls-tree', '-r', '--name-only', ref, 'fixtures').split('\n').filter(Boolean).map((p) => p.slice('fixtures/'.length));
const schluessel = (o, s = new Set()) => {
  if (Array.isArray(o)) o.forEach((x) => schluessel(x, s));
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { s.add(k); schluessel(v, s); }
  return s;
};
// Gleiche Mengen nur einmal ablegen (die 80 Blaetter tragen fast dieselben).
const mengen = [];
const index = new Map();
const je = {};
for (const d of dateien.filter((d) => d.endsWith('.json'))) {
  const liste = [...schluessel(JSON.parse(git('show', `${ref}:fixtures/${d}`)))].sort();
  const k = JSON.stringify(liste);
  if (!index.has(k)) { index.set(k, mengen.length); mengen.push(liste); }
  je[d] = index.get(k);
}
writeFileSync(new URL('../test/fixtures/vor-1.0/fixtures-0.x.json', import.meta.url),
  JSON.stringify({ ref, version, dateien, schluesselMengen: mengen, schluesselJeDatei: je }, null, 1) + '\n');
console.log(`${version} (${ref}): ${dateien.length} Dateien, ${mengen.length} Schluesselmengen`);
