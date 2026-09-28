import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeInvoiceTotals, ZERO_RATED_TAX_SCHEMES, type TotalsItem } from '../src/invoice/summen.js';
import { TAX_SCHEMES, type PriceMode, type TaxScheme } from '../src/invoice/vertrag.js';
import * as rechnung from '../src/invoice/index.js';

interface Fall {
  name: string;
  priceMode: PriceMode;
  taxScheme?: TaxScheme;
  items: TotalsItem[];
  expected: ReturnType<typeof computeInvoiceTotals>;
}

const datei = JSON.parse(readFileSync(new URL('../../fixtures/invoice-totals.json', import.meta.url), 'utf8')) as {
  cases: Fall[];
};

test('Prueffaelle: jeder Fall aus fixtures/invoice-totals.json trifft genau', () => {
  assert.ok(datei.cases.length >= 15);
  for (const f of datei.cases) {
    assert.deepEqual(computeInvoiceTotals(f.items, f.priceMode, f.taxScheme), f.expected, f.name);
  }
});

test('Prueffaelle: die Rueckmeldung des Shops steht drin', () => {
  const namen = datei.cases.map((f) => f.name).join('\n');
  assert.match(namen, /0,03 €/);
  assert.match(namen, /29,79 €/);
});

test('Brutto bleibt Brutto: jeder Betrag bis 100 € zu 10, 13 und 20 %', () => {
  const falsch: string[] = [];
  for (const satz of [10, 13, 20]) {
    for (let c = 1; c <= 10000; c++) {
      const s = computeInvoiceTotals([{ quantity: 1, unitPriceCents: c, vatRate: satz }], 'gross');
      if (s.grossCents !== c || s.netCents + s.vatCents !== c) falsch.push(`${c}@${satz}`);
    }
  }
  assert.deepEqual(falsch, []);
});

test('Brutto: Netto ist B × 100 / (100 + Satz), halber Cent aufwaerts', () => {
  for (let c = 1; c <= 5000; c++) {
    const netto = computeInvoiceTotals([{ quantity: 1, unitPriceCents: c, vatRate: 20 }], 'gross').netCents;
    // In ganzen Zahlen: floor((200·c + 120) / 240) ist round(c·100/120) mit halben Cent aufwaerts.
    assert.equal(netto, Math.floor((200 * c + 120) / 240), `${c} Cent`);
  }
});

test('Steuerfrei: genau die Faelle ohne eigenen Steuerausweis', () => {
  assert.deepEqual([...ZERO_RATED_TAX_SCHEMES].sort(), TAX_SCHEMES.filter((s) => s !== 'normal' && s !== 'oss').sort());
  for (const fall of ZERO_RATED_TAX_SCHEMES) {
    const s = computeInvoiceTotals([{ quantity: 1, unitPriceCents: 1200, vatRate: 20 }], 'gross', fall);
    assert.deepEqual(s.byRate, [{ rate: 0, netCents: 1200, vatCents: 0, grossCents: 1200 }], fall);
  }
});

test('Export: computeInvoiceTotals gehoert zum Unterpfad invoice', () => {
  assert.equal(rechnung.computeInvoiceTotals, computeInvoiceTotals);
});
