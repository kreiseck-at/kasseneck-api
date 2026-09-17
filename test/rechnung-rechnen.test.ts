import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BETRAG_GRENZE_CENTS,
  RechenFehler,
  rechnungRechnen,
  rund,
} from '../src/rechnung/rechnen.js';

test('rund: halbe Einheit vom Nullpunkt weg, auf dem Bruch', () => {
  assert.equal(rund(5n, 2n), 3n); // 2,5 -> 3
  assert.equal(rund(-5n, 2n), -3n); // -2,5 -> -3
  assert.equal(rund(4n, 2n), 2n);
  assert.equal(rund(1n, 3n), 0n); // 0,333 -> 0
  assert.equal(rund(2n, 3n), 1n); // 0,666 -> 1
  assert.equal(rund(0n, 7n), 0n);
});

test('Grenze: 999.999.999,99 Euro sind 99.999.999.999 Cent', () => {
  assert.equal(BETRAG_GRENZE_CENTS, 99_999_999_999);
});

test('Leere Rechnung: alles null, keine Saetze, keine Zeilen', () => {
  assert.deepEqual(rechnungRechnen([], { priceMode: 'net' }), {
    netCents: 0,
    vatCents: 0,
    grossCents: 0,
    byRate: [],
    lines: [],
  });
});

test('Eingabepruefung: krumme oder unmoegliche Werte fliegen mit Feld und Index', () => {
  const fehler = (position: unknown): RechenFehler => {
    try {
      rechnungRechnen([position as never], { priceMode: 'net' });
    } catch (e) {
      return e as RechenFehler;
    }
    throw new Error('kein Fehler geworfen');
  };

  const krumm = fehler({ unitPriceMicros: 1.5, quantityMilli: 1000 });
  assert.equal(krumm.code, 'kein_ganzzahlwert');
  assert.equal(krumm.feld, 'unitPriceMicros');
  assert.equal(krumm.index, 0);

  assert.equal(fehler({ unitPriceMicros: -1, quantityMilli: 1000 }).code, 'ausserhalb');
  assert.equal(fehler({ unitPriceMicros: 1000, quantityMilli: 1000, discountBp: 10_001 }).code, 'ausserhalb');
  assert.equal(fehler({ unitPriceMicros: 1000, quantityMilli: 1000, vatRateBp: -1 }).code, 'ausserhalb');
  assert.equal(fehler({ quantityMilli: 1000 }).code, 'kein_ganzzahlwert');
});
