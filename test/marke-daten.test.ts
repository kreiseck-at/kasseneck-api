import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { entpackeRasterBits, brandMarkImage } from '../src/receipt/marke.js';
import { BRAND_MARK_PATHS } from '../src/receipt/marke-daten.js';
import { rasterRowsBytes, type RasterImage } from '../src/printing/escpos.js';

/**
 * Das Raster entsteht beim Bauen (`scripts/marke-raster.mjs`), nicht zur
 * Laufzeit -- diese Tests pruefen nur das Ergebnis, nicht den Erzeuger.
 */

test('die Marke hat je Papierbreite genau ein Mass', () => {
  assert.equal(brandMarkImage('mm80').width, 352);
  assert.equal(brandMarkImage('mm58').width, 234);
});

test('das Raster ist ein Punkt je Byte und traegt Schwarz', () => {
  for (const papier of ['mm58', 'mm80'] as const) {
    const bild = brandMarkImage(papier);
    assert.equal(bild.dots.length, bild.width * bild.height);
    const schwarz = bild.dots.reduce((s, p) => s + p, 0);
    // Die Marke fuellt einen nennenswerten Teil ihres Kastens; ein leeres oder
    // volles Bild waere ein Erzeugerfehler, den man sonst erst am Papier saehe.
    assert.ok(schwarz > bild.dots.length * 0.05, `${papier}: zu wenig gesetzt`);
    assert.ok(schwarz < bild.dots.length * 0.6, `${papier}: zu viel gesetzt`);
  }
});

test('die Pfade kommen aus demselben Kasten wie die Markendatei', () => {
  assert.equal(BRAND_MARK_PATHS.width, 332);
  assert.equal(BRAND_MARK_PATHS.height, 48);
  assert.ok(BRAND_MARK_PATHS.paths.length >= 3, 'Rahmen, Ecke und Schriftzug');
});

/**
 * Der Schwarzanteil-Test oben ist eine Verhaeltnispruefung: ein vertauschter
 * Bit-Index (LSB statt MSB) oder ein Versatz bei `byteJeZeile` ergaebe
 * dieselbe Anzahl gesetzter Punkte, nur an falscher Stelle -- der Test bliebe
 * gruen, das Logo kaeme schief aus dem Drucker. Dieser Test sichert darum die
 * ANORDNUNG: ein bekanntes Bitmuster mit `rasterRowsBytes` packen (derselbe
 * Packer, den auch der Firmenlogo-Weg benutzt) und mit `entpackeRasterBits`
 * (demselben Entpacker, den `brandMarkImage` benutzt) wieder auspacken -- heraus
 * muss bitgenau dasselbe Bild kommen.
 *
 * 234 ist kein Vielfaches von 8: die letzte Spalte einer 234er-Zeile liegt in
 * einem Byte, das danach noch ungenutzte Fuellbits traegt -- genau der Fall,
 * an dem ein Versatz zuerst sichtbar wuerde. 352 ist zum Vergleich ein
 * Vielfaches von 8 (keine Fuellbits) und laeuft aus demselben Grund mit.
 */
test('Rundlauf rasterRowsBytes -> entpackeRasterBits: ein bekanntes Bitmuster bleibt bitgenau erhalten', () => {
  for (const breite of [234, 352]) {
    const hoehe = 3;
    const punkte = new Uint8Array(breite * hoehe);
    // Zeile 0: Bytegrenzen (0, 7, 8, 9, 15, 16) und die letzten beiden Spalten.
    for (const x of [0, 7, 8, 9, 15, 16, breite - 2, breite - 1]) punkte[x] = 1;
    // Zeile 1: jedes achte Bit -- deckt jede Byte-Position innerhalb der Zeile ab.
    for (let x = 0; x < breite; x += 8) punkte[breite + x] = 1;
    // Zeile 2: nur die letzte Spalte -- der von der Pruefung benannte Sonderfall.
    punkte[2 * breite + (breite - 1)] = 1;

    const original: RasterImage = { width: breite, height: hoehe, dots: punkte };
    const gepackt = rasterRowsBytes(original);
    const base64 = Buffer.from(gepackt).toString('base64');
    const entpackt = entpackeRasterBits(base64, breite, hoehe);
    assert.deepEqual(Array.from(entpackt.dots), Array.from(punkte), `Breite ${breite}: Rundlauf muss bitgenau sein`);
  }
});

/**
 * Golden auf das tatsaechlich erzeugte Raster der echten Marke: schlaegt an,
 * sobald sich am Ergebnis von `scripts/marke-raster.mjs` irgendetwas aendert
 * -- beabsichtigt (dann den Hash mit dieser Datei bewusst nachziehen) oder
 * nicht (dann ist es ein Befund). Nur der Hash steht hier, nicht das Bild
 * selbst -- das waere fuer ein Diff ohnehin unlesbar.
 */
test('Golden: das erzeugte Raster der echten Marke aendert sich nicht unbemerkt', () => {
  const hash = (bild: RasterImage): string => createHash('sha256').update(Buffer.from(bild.dots)).digest('hex');
  assert.equal(hash(brandMarkImage('mm80')), 'ce3a6fb81f86cae93a56870d893c437e07d97bafec16114cf63dfa5368d25e7f');
  assert.equal(hash(brandMarkImage('mm58')), '7fb8dcf856622eb204e68abab4a66456500ca4cbdaea17bb1592caa499d70210');
});
