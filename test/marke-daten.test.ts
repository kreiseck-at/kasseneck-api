import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markeBild } from '../src/receipt/marke.js';
import { MARKE_PFADE } from '../src/receipt/marke-daten.js';

/**
 * Das Raster entsteht beim Bauen (`scripts/marke-raster.mjs`), nicht zur
 * Laufzeit -- diese Tests pruefen nur das Ergebnis, nicht den Erzeuger.
 */

test('die Marke hat je Papierbreite genau ein Mass', () => {
  assert.equal(markeBild('mm80').breite, 352);
  assert.equal(markeBild('mm58').breite, 234);
});

test('das Raster ist ein Punkt je Byte und traegt Schwarz', () => {
  for (const papier of ['mm58', 'mm80'] as const) {
    const bild = markeBild(papier);
    assert.equal(bild.punkte.length, bild.breite * bild.hoehe);
    const schwarz = bild.punkte.reduce((s, p) => s + p, 0);
    // Die Marke fuellt einen nennenswerten Teil ihres Kastens; ein leeres oder
    // volles Bild waere ein Erzeugerfehler, den man sonst erst am Papier saehe.
    assert.ok(schwarz > bild.punkte.length * 0.05, `${papier}: zu wenig gesetzt`);
    assert.ok(schwarz < bild.punkte.length * 0.6, `${papier}: zu viel gesetzt`);
  }
});

test('die Pfade kommen aus demselben Kasten wie die Markendatei', () => {
  assert.equal(MARKE_PFADE.breite, 332);
  assert.equal(MARKE_PFADE.hoehe, 48);
  assert.ok(MARKE_PFADE.pfade.length >= 3, 'Rahmen, Ecke und Schriftzug');
});
