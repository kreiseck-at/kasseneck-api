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

const eur = (euro: number, cent = 0): number => euro * 1_000_000 + cent * 10_000;
const stueck = (n: number): number => n * 1000;

test('Brutto bleibt Brutto: 14,79 € + 15,00 € zu 20 % sind 29,79 €', () => {
  const s = rechnungRechnen(
    [
      { unitPriceMicros: eur(14, 79), quantityMilli: stueck(1), vatRateBp: 2000 },
      { unitPriceMicros: eur(15, 0), quantityMilli: stueck(1), vatRateBp: 2000 },
    ],
    { priceMode: 'gross' },
  );
  assert.equal(s.grossCents, 2979);
  assert.equal(s.netCents, 2483);
  assert.equal(s.vatCents, 496);
  assert.deepEqual(s.byRate, [{ rateBp: 2000, netCents: 2483, vatCents: 496, grossCents: 2979 }]);
});

test('Netto: 21,35 € zu 10 % ergibt 2,14 € USt (halber Cent aufwaerts, nicht ab)', () => {
  const s = rechnungRechnen([{ unitPriceMicros: eur(21, 35), quantityMilli: stueck(1), vatRateBp: 1000 }], {
    priceMode: 'net',
  });
  assert.deepEqual({ net: s.netCents, ust: s.vatCents, brutto: s.grossCents }, { net: 2135, ust: 214, brutto: 2349 });
});

test('Netto: 550,17 € × 1,5 zu 13 % ergibt 825,26 € netto', () => {
  const s = rechnungRechnen([{ unitPriceMicros: eur(550, 17), quantityMilli: 1500, vatRateBp: 1300 }], {
    priceMode: 'net',
  });
  assert.equal(s.netCents, 82_526);
});

test('Rabatt: 15,45 € × 5 minus 6 % sind 72,62 €', () => {
  const s = rechnungRechnen(
    [{ unitPriceMicros: eur(15, 45), quantityMilli: stueck(5), discountBp: 600, vatRateBp: 0 }],
    { priceMode: 'net' },
  );
  assert.equal(s.netCents, 7262);
});

test('Mehrere Saetze: byRate steht absteigend', () => {
  const s = rechnungRechnen(
    [
      { unitPriceMicros: eur(10, 0), quantityMilli: stueck(1), vatRateBp: 1000 },
      { unitPriceMicros: eur(10, 0), quantityMilli: stueck(1), vatRateBp: 2000 },
      { unitPriceMicros: eur(10, 0), quantityMilli: stueck(1), vatRateBp: 490 },
    ],
    { priceMode: 'net' },
  );
  assert.deepEqual(s.byRate.map((r) => r.rateBp), [2000, 1000, 490]);
  assert.equal(s.netCents, 3000);
  assert.equal(s.vatCents, 100 + 200 + 49);
});

test('Steuerfrei: jede Zeile zaehlt zu 0 %, auch im Brutto-Modus', () => {
  const s = rechnungRechnen([{ unitPriceMicros: eur(12, 0), quantityMilli: stueck(1), vatRateBp: 2000 }], {
    priceMode: 'gross',
    taxScheme: 'smallBusiness',
  });
  assert.deepEqual(s.byRate, [{ rateBp: 0, netCents: 1200, vatCents: 0, grossCents: 1200 }]);
});

test('Abzugszeile: eine negative Menge zieht ab', () => {
  const s = rechnungRechnen(
    [
      { unitPriceMicros: eur(100, 0), quantityMilli: stueck(1), vatRateBp: 2000 },
      { unitPriceMicros: eur(10, 0), quantityMilli: -stueck(1), vatRateBp: 2000 },
    ],
    { priceMode: 'net' },
  );
  assert.deepEqual({ net: s.netCents, ust: s.vatCents }, { net: 9000, ust: 1800 });
});

test('Menge 0: eine Textzeile aendert nichts', () => {
  const s = rechnungRechnen(
    [
      { unitPriceMicros: eur(5, 0), quantityMilli: 0, vatRateBp: 2000 },
      { unitPriceMicros: eur(5, 0), quantityMilli: stueck(1), vatRateBp: 2000 },
    ],
    { priceMode: 'net' },
  );
  assert.equal(s.netCents, 500);
});

test('Rabatt 100 %: die Zeile zaehlt nicht', () => {
  const s = rechnungRechnen(
    [{ unitPriceMicros: eur(99, 99), quantityMilli: stueck(3), discountBp: 10_000, vatRateBp: 2000 }],
    { priceMode: 'net' },
  );
  assert.deepEqual({ net: s.netCents, ust: s.vatCents }, { net: 0, ust: 0 });
});

test('Grenze: eine einzelne Zeile ueber 999.999.999,99 € fliegt mit Index', () => {
  try {
    rechnungRechnen(
      [{ unitPriceMicros: 1_000_000_000_000, quantityMilli: stueck(2000), vatRateBp: 0 }],
      { priceMode: 'net' },
    );
    throw new Error('kein Fehler geworfen');
  } catch (e) {
    const f = e as RechenFehler;
    assert.equal(f.code, 'amount_too_large');
    assert.equal(f.index, 0);
  }
});

test('Grenze: viele erlaubte Zeilen, deren Summe zu gross wird', () => {
  const eine = { unitPriceMicros: 1_000_000_000_000, quantityMilli: stueck(900), vatRateBp: 0 };
  const positionen = Array.from({ length: 3 }, () => eine);
  try {
    rechnungRechnen(positionen, { priceMode: 'net' });
    throw new Error('kein Fehler geworfen');
  } catch (e) {
    const f = e as RechenFehler;
    assert.equal(f.code, 'amount_too_large');
    assert.equal(f.index, undefined);
  }
});

test('Grenze: genau 999.999.999,99 € gehen noch', () => {
  const s = rechnungRechnen(
    [{ unitPriceMicros: 999_999_999_990, quantityMilli: stueck(1000), vatRateBp: 0 }],
    { priceMode: 'net' },
  );
  assert.equal(s.netCents, BETRAG_GRENZE_CENTS);
});
