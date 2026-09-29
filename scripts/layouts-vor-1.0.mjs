// Friert die Zeilenmodelle der Goldens in der Form 0.31.0 ein (innere Form:
// `regelwerk`, Bannerzeilen mit `ton`), genau wie 0.31.0 sie ausgegeben und
// in fixtures/erwartet/*.lines.json festgeschrieben hat. Daran prueft
// test/stored-layout.test.ts fromStoredLayout/toStoredLayout gegen die
// heutigen Goldens in fixtures/expected/.
//
// Quelle ist git (Stand der veroeffentlichten 0.31.0), Paare ueber
// fixtures/renames-1.0.json. Einmalig:
//   node scripts/layouts-vor-1.0.mjs [ref]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const ref = process.argv[2] ?? 'e4b2887';
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 << 20 });
const version = JSON.parse(git('show', `${ref}:package.json`)).version;
const umbenannt = JSON.parse(readFileSync(new URL('../fixtures/renames-1.0.json', import.meta.url), 'utf8')).files;
const paare = git('ls-tree', '-r', '--name-only', ref, 'fixtures/erwartet')
  .split('\n')
  .filter((p) => p.endsWith('.lines.json'))
  .map((p) => {
    const alt = p.slice('fixtures/'.length);
    const neu = umbenannt[alt];
    if (!neu) throw new Error(`${alt}: kein Eintrag in renames-1.0.json`);
    return { before: alt, after: neu, layout: JSON.parse(git('show', `${ref}:${p}`)) };
  });
const datei = { ref, version, pairs: paare };
writeFileSync(new URL('../test/fixtures/vor-1.0/layouts-0.31.json', import.meta.url), JSON.stringify(datei) + '\n');
console.log(`Zeilenmodelle ${version} (${ref}):`, paare.length, 'Paare');
