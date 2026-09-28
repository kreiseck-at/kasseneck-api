import { test } from 'node:test';
import assert from 'node:assert/strict';

import { proratedPriceMicros, formatUnitPrice, vatRateMapKey, formatVatRate } from '../src/invoice/calc.js';

test('proratedPriceMicros: 7 von 12 Monaten aus 100,00 € sind 58,33 €', () => {
  assert.equal(proratedPriceMicros(100_000_000, 7, 12), 58_330_000);
});

test('proratedPriceMicros: ein Mikropreis bleibt fein', () => {
  // 0,00025 € ist NICHT centgenau (250 µ€), der Anteil bleibt deshalb in µ€:
  // 250 × 7 / 12 = 145,83 -> 146 µ€.
  assert.equal(proratedPriceMicros(250, 7, 12), 146);
});

test('proratedPriceMicros: ein centgenauer Preis bleibt centgenau', () => {
  // 0,25 € sind 250.000 µ€ und centgenau: 0,25 × 7 / 12 = 0,1458… -> 0,15 €.
  assert.equal(proratedPriceMicros(250_000, 7, 12), 150_000);
});

test('vatRateMapKey: derselbe Text wie String(satz) – die Statistik haengt daran', () => {
  assert.equal(vatRateMapKey(2000), '20');
  assert.equal(vatRateMapKey(490), '4.9');
  assert.equal(vatRateMapKey(0), '0');
  for (let bp = 0; bp <= 10_000; bp++) {
    assert.equal(vatRateMapKey(bp), String(bp / 100), `bp ${bp}`);
  }
});

test('formatVatRate: oesterreichisch mit Komma, ohne unnoetige Nullen', () => {
  assert.equal(formatVatRate(2000), '20');
  assert.equal(formatVatRate(490), '4,9');
  assert.equal(formatVatRate(1250), '12,5');
  assert.equal(formatVatRate(2550), '25,5');
  assert.equal(formatVatRate(0), '0');
});

test('formatUnitPrice: mindestens zwei, hoechstens sechs Stellen, Tausenderpunkt', () => {
  assert.equal(formatUnitPrice(14_790_000), '14,79');
  assert.equal(formatUnitPrice(1_000_000), '1,00');
  assert.equal(formatUnitPrice(4), '0,000004');
  assert.equal(formatUnitPrice(12_491_667), '12,491667');
  assert.equal(formatUnitPrice(1_234_560_000), '1.234,56');
  assert.equal(formatUnitPrice(0), '0,00');
});
