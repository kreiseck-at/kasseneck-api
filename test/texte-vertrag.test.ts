import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BELEG_MAIL_FEHLER, FEHLERREGELN, MELDUNGEN, meldung } from '../src/kasse/texte.js';
import type { MeldungsSchluessel } from '../src/kasse/texte.js';

const lies = (name: string) => JSON.parse(readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), 'utf8'));
const veraltet = 'fixtures/kasse-texte.json ist veraltet — `npm run fixtures:texte` ausfuehren';

test('Golden: der Katalog steht in fixtures/kasse-texte.json', () => {
  const vertrag = lies('kasse-texte.json');
  assert.deepEqual(vertrag.meldungen, MELDUNGEN, veraltet);
  assert.deepEqual(vertrag.fehlerregeln, FEHLERREGELN, veraltet);
  // Die App liest die Zuordnung `code` -> Satz aus dieser Datei; fehlt sie
  // dort, entscheidet die App am Satz des Backends und weicht vom Web ab.
  assert.deepEqual(vertrag.belegMailFehler, BELEG_MAIL_FEHLER, veraltet);
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(vertrag.version, pkg.version, veraltet);
});

test('die Faelle decken jede Fehlerart ab und erwarten nur, was der Katalog hergibt', () => {
  const { faelle } = lies('kasse-meldungen-faelle.json') as { faelle: Array<{ name: string; fehler: { art: string }; ersatz: string; erwartet: string | { schluessel: keyof typeof MELDUNGEN; werte?: Record<string, string | number> } }> };
  const arten = new Set(faelle.map((f) => f.fehler.art));
  assert.deepEqual([...arten].sort(), FEHLERREGELN.map((r) => r.art).sort());
  for (const fall of faelle) {
    if (typeof fall.erwartet === 'string') continue;
    // Eigene Variable statt `fall.erwartet` in der Closure: TypeScript verengt
    // eine Eigenschaft nicht ueber Funktionsgrenzen hinweg.
    const erwartet: { schluessel: MeldungsSchluessel; werte?: Record<string, string | number> } = fall.erwartet;
    assert.ok(erwartet.schluessel in MELDUNGEN, fall.name);
    assert.doesNotThrow(() => meldung(erwartet.schluessel, erwartet.werte), fall.name);
  }
});
