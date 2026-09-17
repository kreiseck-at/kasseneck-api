import { test } from 'node:test';
import assert from 'node:assert/strict';

import { anteiligerPreis, preisText, satzSchluessel, satzText } from '../src/rechnung/rechnen.js';

test('anteiligerPreis: 7 von 12 Monaten aus 100,00 € sind 58,33 €', () => {
  assert.equal(anteiligerPreis(100_000_000, 7, 12), 58_330_000);
});

test('anteiligerPreis: ein Mikropreis bleibt fein', () => {
  assert.equal(anteiligerPreis(250_000, 7, 12), 145_833);
});

test('satzSchluessel: derselbe Text wie String(satz) — die Statistik haengt daran', () => {
  assert.equal(satzSchluessel(2000), '20');
  assert.equal(satzSchluessel(490), '4.9');
  assert.equal(satzSchluessel(0), '0');
  for (let bp = 0; bp <= 10_000; bp++) {
    assert.equal(satzSchluessel(bp), String(bp / 100), `bp ${bp}`);
  }
});

test('satzText: oesterreichisch mit Komma, ohne unnoetige Nullen', () => {
  assert.equal(satzText(2000), '20');
  assert.equal(satzText(490), '4,9');
  assert.equal(satzText(1250), '12,5');
  assert.equal(satzText(2550), '25,5');
  assert.equal(satzText(0), '0');
});

test('preisText: mindestens zwei, hoechstens sechs Stellen, Tausenderpunkt', () => {
  assert.equal(preisText(14_790_000), '14,79');
  assert.equal(preisText(1_000_000), '1,00');
  assert.equal(preisText(4), '0,000004');
  assert.equal(preisText(12_491_667), '12,491667');
  assert.equal(preisText(1_234_560_000), '1.234,56');
  assert.equal(preisText(0), '0,00');
});
