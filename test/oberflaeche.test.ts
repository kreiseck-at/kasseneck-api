import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AUFRUFE } from '../src/client/aufrufe.js';
import * as kasse from '../src/kasse/index.js';
import { TASTEN_AKTIONEN } from '../src/kasse/index.js';
import { REGISTER_PERMS } from '../src/register/index.js';

const vertrag = JSON.parse(
  readFileSync(new URL('../../fixtures/oberflaeche.json', import.meta.url), 'utf8'),
);

const veraltet = 'fixtures/oberflaeche.json ist veraltet — `npm run fixtures:oberflaeche` ausfuehren';

/*
 * Dieselbe Ableitung wie im Erzeuger: jede exportierte Konstante in
 * GROSSSCHRIFT, deren Wert eine Liste aus Text oder Zahlen ist, gehoert in den
 * Vertrag. So faellt ein neu angelegtes Enum schon in `npm test` auf und nicht
 * erst im Waechter der CI.
 */
const schluessel = (name: string) => name.toLowerCase().replace(/_(.)/g, (_, z: string) => z.toUpperCase());
const namensraum = kasse as unknown as Record<string, unknown>;
const enumListen = new Map<string, readonly (string | number)[]>();
const gesehen = new Set<unknown>();
for (const name of Object.keys(namensraum).sort()) {
  const wert = namensraum[name];
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) continue;
  if (!Array.isArray(wert)) continue;
  if (!wert.every((eintrag) => typeof eintrag === 'string' || typeof eintrag === 'number')) continue;
  // Die Tasten-Aktionen tragen einen eigenen Schluessel, nicht `enums`;
  // Alias-Paare derselben Liste stehen nur einmal im Vertrag.
  if (wert === (TASTEN_AKTIONEN as readonly string[])) continue;
  if (gesehen.has(wert)) continue;
  gesehen.add(wert);
  enumListen.set(schluessel(name), wert as readonly (string | number)[]);
}

test('Golden: die Oberflaeche steht in fixtures/oberflaeche.json', () => {
  assert.deepEqual(vertrag.aufrufe, [...AUFRUFE], veraltet);
  assert.deepEqual(vertrag.rechte, [...REGISTER_PERMS], veraltet);
  assert.deepEqual(vertrag.tastenAktionen, [...TASTEN_AKTIONEN], veraltet);
});

test('Golden: der Vertrag fuehrt JEDE Enum-Liste des Pakets, keine mehr und keine weniger', () => {
  assert.deepEqual(Object.keys(vertrag.enums).sort(), [...enumListen.keys()].sort(), veraltet);
  for (const [name, liste] of enumListen) {
    assert.deepEqual(vertrag.enums[name], [...liste], `${veraltet} (enums.${name})`);
  }
});

test('Die Vertragsdatei nennt die Paketversion', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(vertrag.version, pkg.version, veraltet);
});
