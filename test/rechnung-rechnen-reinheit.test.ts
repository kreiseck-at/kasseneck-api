import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const quelle = readFileSync(new URL('../../src/rechnung/rechnen.ts', import.meta.url), 'utf8');
const paket = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  exports: Record<string, { import: { types: string; default: string }; require: { types: string; default: string } }>;
};

test('Reinheit: der Kern holt sich nur Typen', () => {
  const importe = [...quelle.matchAll(/^import .*from '(.+)';$/gm)].map((m) => m[1]);
  assert.deepEqual(importe, ['./vertrag.js'], 'der Kern darf nur Typen aus dem Vertrag holen');
  assert.match(quelle, /^import type /m, 'und zwar als reinen Typ-Import');
  for (const verboten of ['fetch(', 'api_key', 'XMLHttpRequest', 'process.env']) {
    assert.equal(quelle.includes(verboten), false, `${verboten} gehoert nicht in den Kern`);
  }
});

test('Unterpfad: ./rechnung/rechnen ist fuer beide Welten eingetragen', () => {
  const eintrag = paket.exports['./rechnung/rechnen'];
  assert.ok(eintrag, 'Unterpfad fehlt in den exports');
  assert.equal(eintrag.import.default, './dist/esm/rechnung/rechnen.js');
  assert.equal(eintrag.import.types, './dist/esm/rechnung/rechnen.d.ts');
  assert.equal(eintrag.require.default, './dist/cjs/rechnung/rechnen.js');
  assert.equal(eintrag.require.types, './dist/cjs/rechnung/rechnen.d.ts');
});

test('Unterpfad: ./rechnung reicht den Kern weiter', async () => {
  const rechnung = await import('../src/rechnung/index.js');
  for (const name of ['rechnungRechnen', 'positionAusEuro', 'anteiligerPreis', 'satzSchluessel', 'preisText', 'satzText']) {
    assert.equal(typeof (rechnung as Record<string, unknown>)[name], 'function', name);
  }
});
