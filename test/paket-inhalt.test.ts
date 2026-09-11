import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Was im Tarball landet — und vor allem, was nicht.
 *
 * Anlass: im Flutter-Zwilling reiste eine gitignorierte Datei mit echten
 * Zugangsdaten in einer Veroeffentlichung mit, weil die Ignorierliste fuers
 * Veroeffentlichen eine andere ist als die fuer git. Dieses Paket hat die
 * Schwaeche nicht — es fuehrt in `package.json` eine **Positivliste**
 * (`files`), keine Ignorierliste. Genau das halten diese Tests fest: die
 * Positivliste bleibt eine, und der einzige Eintrag, der ein ganzes
 * Verzeichnis unbesehen mitnimmt (`fixtures`), traegt nichts Oertliches.
 */

const wurzel = fileURLToPath(new URL('../../', import.meta.url));
const PAKET = JSON.parse(readFileSync(join(wurzel, 'package.json'), 'utf8')) as {
  files: string[];
};

/** Namen, die nie in ein veroeffentlichtes Paket gehoeren. */
const VERDAECHTIG = /(^|[.\-/])(env|local|secret|secrets|credentials|private)([.\-]|$)|\.(key|pem|p12|pfx|tgz)$/i;

test('Paket: die Dateiliste ist eine Positivliste, keine Ignorierliste', () => {
  assert.ok(Array.isArray(PAKET.files) && PAKET.files.length > 0, 'files fehlt');
  assert.deepEqual(
    [...PAKET.files].sort(),
    ['CHANGELOG.md', 'NOTICE', 'README.md', 'dist', 'fixtures'],
    'die Positivliste hat sich geaendert — jeder neue Eintrag nimmt ein ganzes Verzeichnis unbesehen mit',
  );
  assert.equal(
    existsSync(join(wurzel, '.npmignore')),
    false,
    'eine .npmignore neben der Positivliste ist eine zweite, leiser wirkende Wahrheit',
  );
});

test('Paket: im mitgelieferten fixtures/ liegt nichts Oertliches', () => {
  const gefunden: string[] = [];
  const gehe = (pfad: string, rel: string): void => {
    for (const eintrag of readdirSync(pfad)) {
      const voll = join(pfad, eintrag);
      const name = rel ? `${rel}/${eintrag}` : eintrag;
      if (statSync(voll).isDirectory()) gehe(voll, name);
      else if (VERDAECHTIG.test(eintrag)) gefunden.push(name);
    }
  };
  gehe(join(wurzel, 'fixtures'), '');
  assert.deepEqual(gefunden, [], `oertliche Datei in fixtures/: ${gefunden.join(', ')}`);
});
