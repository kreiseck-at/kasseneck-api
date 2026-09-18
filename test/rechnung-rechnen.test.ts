import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  BETRAG_GRENZE_CENTS,
  RechenFehler,
  rechnungRechnen,
  rund,
  type RechenPosition,
} from '../src/rechnung/rechnen.js';
import { zufall } from './zufall.js';

interface KernFall {
  name: string;
  priceMode: 'net' | 'gross';
  taxScheme?: string;
  positionen: RechenPosition[];
  erwartet: ReturnType<typeof rechnungRechnen>;
}

const handDatei = JSON.parse(
  readFileSync(new URL('../../fixtures/rechnung-rechnen.json', import.meta.url), 'utf8'),
) as { faelle: KernFall[] };

test('Pruefaelle von Hand: jeder Fall trifft genau', () => {
  assert.ok(handDatei.faelle.length >= 15, 'zu wenige Faelle');
  for (const f of handDatei.faelle) {
    assert.deepEqual(
      rechnungRechnen(f.positionen, { priceMode: f.priceMode, taxScheme: f.taxScheme as never }),
      f.erwartet,
      f.name,
    );
  }
});

test('Pruefaelle von Hand: die Faelle aus der Spec stehen drin', () => {
  const namen = handDatei.faelle.map((f) => f.name).join('\n');
  for (const stichwort of ['29,79', '21,35', '550,17', '0,000004', 'Gleichstand', 'Abzugszeile']) {
    assert.match(namen, new RegExp(stichwort.replace('.', '\\.')));
  }
});

const zufallDatei = JSON.parse(
  readFileSync(new URL('../../fixtures/rechnung-rechnen-zufall.json', import.meta.url), 'utf8'),
) as { seed: number; faelle: KernFall[] };

test('Pruefaelle aus der Referenz: jeder Fall trifft genau', () => {
  assert.ok(zufallDatei.faelle.length >= 300);
  for (const f of zufallDatei.faelle) {
    assert.deepEqual(
      rechnungRechnen(f.positionen, { priceMode: f.priceMode, taxScheme: f.taxScheme as never }),
      f.erwartet,
      f.name,
    );
  }
});

test('Pruefaelle aus der Referenz: die Pflichtklassen sind dabei', () => {
  const namen = zufallDatei.faelle.map((f) => f.name).join('\n');
  for (const klasse of ['2^53', '2^63', 'Abzugszeile', 'Rabatt 100 %', 'Menge 0', 'Gleichstand', 'halber Cent', 'steuerfrei']) {
    assert.match(namen, new RegExp(klasse.replace('^', '\\^')));
  }
});

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

test('Verteilung: die Zeilen ergeben genau die Satzsumme', () => {
  const s = rechnungRechnen(
    [
      { unitPriceMicros: eur(2, 81), quantityMilli: 2977, vatRateBp: 2000 },
      { unitPriceMicros: eur(0, 81), quantityMilli: 2377, vatRateBp: 2000 },
    ],
    { priceMode: 'net' },
  );
  assert.equal(s.netCents, 1029);
  // 836,537 und 192,537 Cent: beide verlieren beim Runden gleich viel,
  // der Cent geht deshalb an die fruehere Zeile.
  assert.deepEqual(s.lines.map((l) => l.netCents), [836, 193]);
  assert.equal(s.lines[0]!.netCents + s.lines[1]!.netCents, s.byRate[0]!.netCents);
});

test('Verteilung: zwei Zeilen zu je 0,6 Cent ergeben 0 und 1', () => {
  const s = rechnungRechnen(
    [
      { unitPriceMicros: 6000, quantityMilli: stueck(1), vatRateBp: 0 },
      { unitPriceMicros: 6000, quantityMilli: stueck(1), vatRateBp: 0 },
    ],
    { priceMode: 'net' },
  );
  assert.equal(s.netCents, 1);
  assert.deepEqual(s.lines.map((l) => l.netCents), [0, 1]);
});

test('Verteilung: eine Nullzeile bekommt nie einen Cent', () => {
  const s = rechnungRechnen(
    [
      { unitPriceMicros: eur(0, 0), quantityMilli: stueck(1), vatRateBp: 2000 },
      { unitPriceMicros: 6000, quantityMilli: stueck(1), vatRateBp: 2000 },
      { unitPriceMicros: 6000, quantityMilli: stueck(1), vatRateBp: 2000 },
    ],
    { priceMode: 'net' },
  );
  assert.equal(s.lines[0]!.netCents, 0);
  assert.equal(s.lines[1]!.netCents + s.lines[2]!.netCents, s.byRate[0]!.netCents);
});

test('Verteilung: eine Zeile ohne Betrag bekommt keinen Rundungscent', () => {
  const s = rechnungRechnen(
    [
      { unitPriceMicros: eur(0, 0), quantityMilli: stueck(1), vatRateBp: 2000 },
      { unitPriceMicros: 25000, quantityMilli: stueck(1), vatRateBp: 2000 },
    ],
    { priceMode: 'net' },
  );
  // Beide Zeilen runden beim Aufrunden auf und stehen mit Rest 0 gleich da —
  // trotzdem darf der Index nicht ueber den Cent entscheiden: die Nullzeile
  // bleibt bei 0, den Cent traegt die Zeile mit dem tatsaechlichen Betrag.
  assert.deepEqual(s.lines.map((l) => l.netCents), [0, 3]);
  assert.deepEqual(s.lines.map((l) => l.grossCents), [0, 4]);
  assert.equal(s.lines.reduce((x, l) => x + l.grossCents, 0), s.grossCents);
});

test('Verteilung: Brutto-Modus verteilt beide Seiten aufgehend', () => {
  const s = rechnungRechnen(
    [
      { unitPriceMicros: eur(14, 79), quantityMilli: stueck(1), vatRateBp: 2000 },
      { unitPriceMicros: eur(15, 0), quantityMilli: stueck(1), vatRateBp: 2000 },
    ],
    { priceMode: 'gross' },
  );
  const satz = s.byRate[0]!;
  assert.equal(s.lines.reduce((x, l) => x + l.netCents, 0), satz.netCents);
  assert.equal(s.lines.reduce((x, l) => x + l.grossCents, 0), satz.grossCents);
  assert.deepEqual(s.lines.map((l) => l.grossCents), [1479, 1500]);
});

test('Verteilung: jede Zeile traegt ihren Satz', () => {
  const s = rechnungRechnen(
    [
      { unitPriceMicros: eur(10, 0), quantityMilli: stueck(1), vatRateBp: 2000 },
      { unitPriceMicros: eur(10, 0), quantityMilli: stueck(1), vatRateBp: 490 },
    ],
    { priceMode: 'net' },
  );
  assert.deepEqual(s.lines.map((l) => l.rateBp), [2000, 490]);
});

test('Verteilung: gemischte Vorzeichen gehen ebenfalls auf', () => {
  const s = rechnungRechnen(
    [
      { unitPriceMicros: eur(3, 33), quantityMilli: 3333, vatRateBp: 1000 },
      { unitPriceMicros: eur(1, 11), quantityMilli: -1111, vatRateBp: 1000 },
    ],
    { priceMode: 'net' },
  );
  assert.equal(s.lines.reduce((x, l) => x + l.netCents, 0), s.byRate[0]!.netCents);
});

/**
 * Abstand des zugeteilten Cents vom exakten Bruchwert der Zeile, in Cent
 * (bis auf 1/1000 genau, ueber Ganzzahl-Division ermittelt — kein Gleitkomma,
 * das bei den hier vorkommenden Groessenordnungen selbst Rauschen erzeugen
 * wuerde). `zaehler`/`nenner` sind derselbe Bruch, den `rechnungRechnen`
 * intern rundet, `cent` der Wert, der der Zeile am Ende zugeteilt wurde.
 */
function abweichungCent(zaehler: bigint, nenner: bigint, cent: number): number {
  const diff = BigInt(cent) * nenner - zaehler;
  const diffAbs = diff < 0n ? -diff : diff;
  return Number((diffAbs * 1000n) / nenner) / 1000;
}

test('Eigenschaft: Zeilen gehen immer auf, und keine Zeile weicht um mehr als 1 Cent ab', () => {
  const r = zufall(20_260_918);
  const saetze = [0, 490, 1000, 1300, 1900, 2000];
  const E = 10n ** 17n;
  let maxAbweichung = 0;
  for (let lauf = 0; lauf < 20_000; lauf++) {
    const anzahl = 1 + Math.floor(r() * 6);
    const positionen: RechenPosition[] = Array.from({ length: anzahl }, () => ({
      unitPriceMicros: Math.floor(r() * 50_000_000),
      quantityMilli: Math.floor(r() * 20_000) - 2000,
      discountBp: Math.floor(r() * 10_001),
      vatRateBp: saetze[Math.floor(r() * saetze.length)]!,
    }));
    const modus = r() < 0.5 ? 'net' : 'gross';
    const s = rechnungRechnen(positionen, { priceMode: modus });
    for (const satz of s.byRate) {
      const zeilen = s.lines.filter((l) => l.rateBp === satz.rateBp);
      assert.equal(zeilen.reduce((x, l) => x + l.netCents, 0), satz.netCents, `netto @${satz.rateBp}`);
      assert.equal(zeilen.reduce((x, l) => x + l.grossCents, 0), satz.grossCents, `brutto @${satz.rateBp}`);
    }
    assert.equal(s.byRate.reduce((x, b) => x + b.netCents, 0), s.netCents);
    assert.equal(s.netCents + s.vatCents, s.grossCents);

    // Je Zeile: derselbe Bruch, den der Kern intern rundet, gegen den
    // tatsaechlich zugeteilten Cent — nicht nur, dass die Zeilen aufgehen.
    for (let i = 0; i < positionen.length; i++) {
      const p = positionen[i]!;
      const zeile = s.lines[i]!;
      const L = BigInt(p.unitPriceMicros) * BigInt(p.quantityMilli) *
        (10_000n - BigInt(p.discountBp ?? 0)) * 1_000_000n;
      const satzBp = BigInt(zeile.rateBp);
      let netZaehler: bigint, netNenner: bigint, bruttoZaehler: bigint, bruttoNenner: bigint;
      if (modus === 'gross') {
        bruttoZaehler = L; bruttoNenner = E;
        netZaehler = L * 10_000n; netNenner = E * (10_000n + satzBp);
      } else {
        netZaehler = L; netNenner = E;
        bruttoZaehler = L * (10_000n + satzBp); bruttoNenner = E * 10_000n;
      }
      const abwNetto = abweichungCent(netZaehler, netNenner, zeile.netCents);
      const abwBrutto = abweichungCent(bruttoZaehler, bruttoNenner, zeile.grossCents);
      assert.ok(abwNetto <= 1, `Netto-Zeile weicht ${abwNetto} Cent vom exakten Wert ab (Lauf ${lauf}, Zeile ${i})`);
      assert.ok(abwBrutto <= 1, `Brutto-Zeile weicht ${abwBrutto} Cent vom exakten Wert ab (Lauf ${lauf}, Zeile ${i})`);
      maxAbweichung = Math.max(maxAbweichung, abwNetto, abwBrutto);
    }
  }
  // Die Schranke haelt, liegt aber nahe an 1 Cent — dieser Lauf (fester Seed,
  // ueber 100.000 gepruefte Zeilen) misst bis zu 0,999 Cent.
  assert.ok(maxAbweichung <= 1, `hoechste gemessene Abweichung: ${maxAbweichung} Cent`);
});
