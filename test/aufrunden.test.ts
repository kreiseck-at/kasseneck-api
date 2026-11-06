import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { roundUpSuggestions } from '../src/pos/index.js';

interface Faelle { cases: { baseCents: number; totals: number[] }[] }
const faelle = JSON.parse(readFileSync(new URL('../../fixtures/tip-round-up-cases.json', import.meta.url), 'utf8')) as Faelle;

test('Pruefaelle: Aufrunden-Vorschlaege', () => {
  for (const f of faelle.cases) assert.deepEqual(roundUpSuggestions(f.baseCents), f.totals, String(f.baseCents));
});

test('negativ und keine Ganzzahl: leer', () => {
  assert.deepEqual(roundUpSuggestions(-5), []);
  assert.deepEqual(roundUpSuggestions(840.5), []);
});

test('immer drei aufsteigende Ganzzahlen ueber dem Betrag', () => {
  for (let t = 1; t <= 100000; t += 37) {
    const r = roundUpSuggestions(t);
    assert.equal(r.length, 3, String(t));
    assert.ok(r[0]! < r[1]! && r[1]! < r[2]!, String(t));
    const lo = Math.max(Math.ceil((t * 102) / 100), t + 20);
    for (const k of r) assert.ok(Number.isInteger(k) && k > t && k >= lo, `${t}: ${k}`);
  }
});
