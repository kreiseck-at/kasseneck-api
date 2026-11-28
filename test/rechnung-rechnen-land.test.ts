import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { RechenFehler, rechnungRechnen, type RechenPosition } from '../src/rechnung/rechnen.js';

// Spec 2026-11-27-ust-ausland-design.md § 7.2: gerundet und gruppiert wird je
// (Land, Satz, Befreiung). Rechnungen nur mit AT muessen genau so rechnen wie
// vor dem Umbau -- die Prueffaelle unten sind vor dem Umbau entstanden.

interface KernFall {
  name: string;
  priceMode: 'net' | 'gross';
  taxScheme?: string;
  positionen: RechenPosition[];
  erwartet: ReturnType<typeof rechnungRechnen>;
}

const lade = (datei: string): KernFall[] =>
  (JSON.parse(readFileSync(new URL(`../../fixtures/${datei}`, import.meta.url), 'utf8')) as { faelle: KernFall[] }).faelle;

const eur = (euro: number, cent = 0): number => euro * 1_000_000 + cent * 10_000;

test('Nur AT: ausdruecklich `steuerLand: AT` rechnet byte-gleich wie ohne Angabe', () => {
  const faelle = [...lade('rechnung-rechnen.json'), ...lade('rechnung-rechnen-zufall.json')];
  assert.ok(faelle.length >= 300);
  for (const f of faelle) {
    const mitAT = f.positionen.map((p) => ({ ...p, steuerLand: 'AT' }));
    const ergebnis = rechnungRechnen(mitAT, { priceMode: f.priceMode, taxScheme: f.taxScheme as never });
    assert.deepEqual(ergebnis, f.erwartet, f.name);
    assert.equal(JSON.stringify(ergebnis), JSON.stringify(f.erwartet), `${f.name}: Schluessel oder Reihenfolge weichen ab`);
  }
});

test('AT 10 % und DE 19 % brutto (20,69 / 279,31): zwei Gruppen, Land nur an DE, Summe 300,00', () => {
  const s = rechnungRechnen(
    [
      { unitPriceMicros: eur(20, 69), quantityMilli: 1000, vatRateBp: 1000 },
      { unitPriceMicros: eur(279, 31), quantityMilli: 1000, vatRateBp: 1900, steuerLand: 'DE' },
    ],
    { priceMode: 'gross' },
  );
  assert.deepEqual(s.byRate, [
    { rateBp: 1000, netCents: 1881, vatCents: 188, grossCents: 2069 },
    { rateBp: 1900, netCents: 23471, vatCents: 4460, grossCents: 27931, land: 'DE' },
  ]);
  assert.equal('land' in s.byRate[0]!, false);
  assert.equal(s.grossCents, 30000);
  assert.equal(s.netCents, 1881 + 23471);
  assert.equal(s.vatCents, 188 + 4460);
  assert.deepEqual(s.lines, [
    { netCents: 1881, grossCents: 2069, rateBp: 1000 },
    { netCents: 23471, grossCents: 27931, rateBp: 1900, land: 'DE' },
  ]);
});

test('AT 0 % und DE 0 % small_business: zwei Gruppen, nie verschmolzen', () => {
  const s = rechnungRechnen(
    [
      { unitPriceMicros: eur(10, 0), quantityMilli: 1000, vatRateBp: 0 },
      { unitPriceMicros: eur(40, 0), quantityMilli: 1000, vatRateBp: 0, steuerLand: 'DE', befreiung: 'small_business' },
    ],
    { priceMode: 'net' },
  );
  assert.deepEqual(s.byRate, [
    { rateBp: 0, netCents: 1000, vatCents: 0, grossCents: 1000 },
    { rateBp: 0, netCents: 4000, vatCents: 0, grossCents: 4000, land: 'DE', befreiung: 'small_business' },
  ]);
  assert.deepEqual(s.lines[1], { netCents: 4000, grossCents: 4000, rateBp: 0, land: 'DE', befreiung: 'small_business' });
  assert.equal(s.grossCents, 5000);
});

test('Reihenfolge: AT absteigend wie bisher, danach fremde Laender nach Code, je Land absteigend', () => {
  const zeile = (vatRateBp: number, steuerLand?: string, befreiung?: string): RechenPosition => ({
    unitPriceMicros: eur(10, 0), quantityMilli: 1000, vatRateBp,
    ...(steuerLand ? { steuerLand } : {}), ...(befreiung ? { befreiung } : {}),
  });
  const s = rechnungRechnen(
    [zeile(700, 'DE'), zeile(1000), zeile(2000, 'FR'), zeile(0, 'DE', 'small_business'), zeile(2000), zeile(1900, 'DE'), zeile(0, 'DE')],
    { priceMode: 'net' },
  );
  assert.deepEqual(
    s.byRate.map((r) => `${r.land ?? 'AT'} ${r.rateBp} ${r.befreiung ?? '-'}`),
    ['AT 2000 -', 'AT 1000 -', 'DE 1900 -', 'DE 700 -', 'DE 0 -', 'DE 0 small_business', 'FR 2000 -'],
  );
});

test('Gleicher Satz in zwei Laendern: jede Gruppe rundet fuer sich', () => {
  // Je 0,05 € netto zu 10 %: einzeln 0,5 Cent USt -> je 1 Cent. Zusammen
  // gerundet waeren es 1 Cent; getrennt sind es 2.
  const s = rechnungRechnen(
    [
      { unitPriceMicros: eur(0, 5), quantityMilli: 1000, vatRateBp: 1000 },
      { unitPriceMicros: eur(0, 5), quantityMilli: 1000, vatRateBp: 1000, steuerLand: 'DE' },
    ],
    { priceMode: 'net' },
  );
  assert.deepEqual(s.byRate, [
    { rateBp: 1000, netCents: 5, vatCents: 1, grossCents: 6 },
    { rateBp: 1000, netCents: 5, vatCents: 1, grossCents: 6, land: 'DE' },
  ]);
  assert.equal(s.vatCents, 2);
});

test('Steuerfreier Fall gilt fuer die oesterreichischen Zeilen, die fremde Zeile behaelt ihren Satz', () => {
  // Kleinunternehmer in Oesterreich, in Deutschland regulaer erfasst: AT-Zeilen
  // nach § 6 Abs. 1 Z 27 UStG zu 0 %, die deutsche Zeile mit deutscher Steuer.
  const s = rechnungRechnen(
    [
      { unitPriceMicros: eur(20, 69), quantityMilli: 1000, vatRateBp: 1000 },
      { unitPriceMicros: eur(279, 31), quantityMilli: 1000, vatRateBp: 1900, steuerLand: 'DE' },
    ],
    { priceMode: 'gross', taxScheme: 'smallBusiness' },
  );
  assert.deepEqual(s.byRate, [
    { rateBp: 0, netCents: 2069, vatCents: 0, grossCents: 2069 },
    { rateBp: 1900, netCents: 23471, vatCents: 4460, grossCents: 27931, land: 'DE' },
  ]);
});

test('Befreiung an einer AT-Zeile aendert nichts: AT gruppiert wie bisher nur nach Satz', () => {
  const ohne = rechnungRechnen(
    [{ unitPriceMicros: eur(10, 0), quantityMilli: 1000, vatRateBp: 0 }, { unitPriceMicros: eur(5, 0), quantityMilli: 1000, vatRateBp: 0 }],
    { priceMode: 'net' },
  );
  const mit = rechnungRechnen(
    [
      { unitPriceMicros: eur(10, 0), quantityMilli: 1000, vatRateBp: 0, steuerLand: 'AT', befreiung: 'small_business' },
      { unitPriceMicros: eur(5, 0), quantityMilli: 1000, vatRateBp: 0 },
    ],
    { priceMode: 'net' },
  );
  assert.deepEqual(mit, ohne);
});

test('Eingabepruefung: Land nur als zwei Grossbuchstaben, Befreiung nur als Text', () => {
  const fehler = (position: Record<string, unknown>): RechenFehler => {
    try {
      rechnungRechnen([{ unitPriceMicros: 1000, quantityMilli: 1000, ...position } as never], { priceMode: 'net' });
    } catch (e) {
      return e as RechenFehler;
    }
    throw new Error('kein Fehler geworfen');
  };
  for (const land of ['de', 'DEU', 'D', '', 49]) {
    const f = fehler({ steuerLand: land });
    assert.equal(f.code, 'ungueltig', String(land));
    assert.equal(f.feld, 'steuerLand');
    assert.equal(f.index, 0);
  }
  for (const befreiung of ['', 7, {}]) {
    const f = fehler({ steuerLand: 'DE', befreiung });
    assert.equal(f.code, 'ungueltig', JSON.stringify(befreiung));
    assert.equal(f.feld, 'befreiung');
  }
  // null steht fuer „keine Angabe“, wie ein fehlendes Feld.
  assert.doesNotThrow(() => rechnungRechnen([{ unitPriceMicros: 1000, quantityMilli: 1000, steuerLand: null, befreiung: null } as never], { priceMode: 'net' }));
});

test('Eigenschaft: auch mit Laendern gehen Zeilen je Gruppe genau auf', () => {
  let x = 20_261_128;
  const r = (): number => {
    x = (x * 1_103_515_245 + 12_345) % 2_147_483_648;
    return x / 2_147_483_648;
  };
  const varianten: Pick<RechenPosition, 'vatRateBp' | 'steuerLand' | 'befreiung'>[] = [
    { vatRateBp: 2000 }, { vatRateBp: 1000 }, { vatRateBp: 0 },
    { vatRateBp: 1900, steuerLand: 'DE' }, { vatRateBp: 700, steuerLand: 'DE' },
    { vatRateBp: 0, steuerLand: 'DE', befreiung: 'small_business' },
  ];
  const schluessel = (z: { rateBp: number; land?: string; befreiung?: string }): string =>
    `${z.land ?? 'AT'}|${z.rateBp}|${z.befreiung ?? ''}`;
  for (let lauf = 0; lauf < 2000; lauf++) {
    const positionen: RechenPosition[] = Array.from({ length: 1 + Math.floor(r() * 6) }, () => ({
      unitPriceMicros: Math.floor(r() * 50_000_000),
      quantityMilli: Math.floor(r() * 20_000) - 2000,
      discountBp: Math.floor(r() * 10_001),
      ...varianten[Math.floor(r() * varianten.length)]!,
    }));
    const s = rechnungRechnen(positionen, { priceMode: r() < 0.5 ? 'net' : 'gross' });
    assert.equal(new Set(s.byRate.map(schluessel)).size, s.byRate.length, 'Gruppe doppelt');
    for (const gruppe of s.byRate) {
      const zeilen = s.lines.filter((l) => schluessel(l) === schluessel(gruppe));
      assert.ok(zeilen.length > 0);
      assert.equal(zeilen.reduce((a, l) => a + l.netCents, 0), gruppe.netCents);
      assert.equal(zeilen.reduce((a, l) => a + l.grossCents, 0), gruppe.grossCents);
    }
    assert.equal(s.netCents + s.vatCents, s.grossCents);
  }
});
