import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AUFRUFE } from '../src/client/aufrufe.js';
import { DRUCKER_ART, KARTENANBIETER, TASTEN_AKTIONEN } from '../src/kasse/index.js';
import { REGISTER_PERMS } from '../src/register/index.js';

const vertrag = JSON.parse(
  readFileSync(new URL('../../fixtures/oberflaeche.json', import.meta.url), 'utf8'),
);

const veraltet = 'fixtures/oberflaeche.json ist veraltet — `npm run fixtures:oberflaeche` ausfuehren';

test('Golden: die Oberflaeche steht in fixtures/oberflaeche.json', () => {
  assert.deepEqual(vertrag.aufrufe, [...AUFRUFE], veraltet);
  assert.deepEqual(vertrag.rechte, [...REGISTER_PERMS], veraltet);
  assert.deepEqual(vertrag.tastenAktionen, [...TASTEN_AKTIONEN], veraltet);
  assert.deepEqual(vertrag.enums.druckerArt, [...DRUCKER_ART], veraltet);
  assert.deepEqual(vertrag.enums.kartenanbieter, [...KARTENANBIETER], veraltet);
});

test('Die Vertragsdatei nennt die Paketversion', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(vertrag.version, pkg.version, veraltet);
});
