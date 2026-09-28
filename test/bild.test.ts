import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createEscPosDocument, escPosBytes, escPosRasterImage, rasterRowsBytes, rasterRowsBase64, type RasterImage } from '../src/printing/index.js';
import { eposImageXml, rasterizeLogo } from '../src/receipt/index.js';

/** RGBA-Muster wie `ImageData.data`: waagrechter Verlauf schwarz->weiss, die oberste Zeile durchsichtig. */
function verlauf(b: number, h: number): Uint8Array {
  const rgba = new Uint8Array(b * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < b; x++) {
    const i = (y * b + x) * 4; const g = Math.floor((x * 255) / Math.max(1, b - 1));
    rgba[i] = g; rgba[i + 1] = g; rgba[i + 2] = g; rgba[i + 3] = y === 0 ? 0 : 255;
  }
  return rgba;
}

test('rasterizeLogo: Groesse aus dem Mass, Transparenz wird Papier, dunkel wird Punkt', () => {
  const bild = rasterizeLogo(verlauf(24, 4), 24, 4, { widthFraction: 24 / 576, heightLines: 4 / 24 }, 48);
  assert.equal(bild.width, 24); assert.equal(bild.height, 4);
  assert.equal(bild.dots.length, 96);
  for (let x = 0; x < 24; x++) assert.equal(bild.dots[x], 0, 'durchsichtige Zeile bleibt weiss');
  assert.equal(bild.dots[24], 1, 'links schwarz');
  assert.equal(bild.dots[24 + 23], 0, 'rechts weiss');
  const schwarz = Array.from(bild.dots.slice(24)).filter((p) => p === 1).length;
  assert.ok(schwarz > 24 && schwarz < 48, `Verlauf gerastert (Floyd-Steinberg): ${schwarz} von 72`);
});

test('rasterizeLogo: verkleinert per Flaechenmittel und ist deterministisch', () => {
  const a = rasterizeLogo(verlauf(300, 100), 300, 100, { widthFraction: 150 / 576, heightLines: 50 / 24 }, 48);
  const b = rasterizeLogo(verlauf(300, 100), 300, 100, { widthFraction: 150 / 576, heightLines: 50 / 24 }, 48);
  assert.equal(a.width, 150); assert.equal(a.height, 50);
  assert.deepEqual(a.dots, b.dots);
  assert.throws(() => rasterizeLogo(new Uint8Array(3), 1, 1, { widthFraction: 1 / 576, heightLines: 1 / 24 }, 48), /RGBA/);
});

test('rasterizeLogo: ein deckendes schwarzes Pixel wird genau ein Punkt', () => {
  const bild = rasterizeLogo(Uint8Array.from([0, 0, 0, 255]), 1, 1, { widthFraction: 1 / 576, heightLines: 1 / 24 }, 48);
  assert.deepEqual([bild.width, bild.height, Array.from(bild.dots)], [1, 1, [1]]);
});

test('rasterizeLogo: ein ganz durchsichtiges Bild bleibt Papier -- kein einziger Punkt', () => {
  // Schwarz, aber Deckung 0: Durchsichtiges wird Papierweiss, nicht die Farbe darunter.
  const bild = rasterizeLogo(new Uint8Array(40 * 20 * 4), 40, 20, { widthFraction: 20 / 576, heightLines: 10 / 24 }, 48);
  assert.equal(bild.dots.length, 200);
  assert.equal(Array.from(bild.dots).filter((p) => p === 1).length, 0);
});

test('rasterizeLogo: Quellmass gleich Zielmass (keine Verkleinerung) -- Schachbrett bleibt Schachbrett', () => {
  const b = 8, h = 6;
  const rgba = new Uint8Array(b * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < b; x++) {
    const i = (y * b + x) * 4; const v = (x + y) % 2 === 0 ? 0 : 255;
    rgba[i] = v; rgba[i + 1] = v; rgba[i + 2] = v; rgba[i + 3] = 255;
  }
  const mass = { widthFraction: b / 576, heightLines: h / 24 };
  const a = rasterizeLogo(rgba, b, h, mass, 48);
  assert.deepEqual([a.width, a.height], [b, h]);
  // Reines Schwarz/Weiss hat keinen Rundungsfehler: Floyd-Steinberg verteilt nichts, jedes schwarze Feld ist ein Punkt.
  assert.equal(Array.from(a.dots).filter((p) => p === 1).length, (b * h) / 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < b; x++) assert.equal(a.dots[y * b + x], (x + y) % 2 === 0 ? 1 : 0, `Punkt ${x},${y}`);
  assert.deepEqual(rasterizeLogo(rgba, b, h, mass, 48).dots, a.dots, 'deterministisch');
});

test('rasterRowsBytes: MSB zuerst, Zeilen auf volle Bytes aufgefuellt', () => {
  const bild: RasterImage = { width: 10, height: 2, dots: Uint8Array.from([1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0]) };
  assert.deepEqual(Array.from(rasterRowsBytes(bild)), [0x80, 0x40, 0x00, 0x80]);
});

test('escPosRasterImage: GS v 0 mit Byte-Breite und Hoehe, zentriert, ohne Zeilenvorschub danach', () => {
  const doc = createEscPosDocument({ paperSize: 'mm80' });
  const bild: RasterImage = { width: 10, height: 2, dots: new Uint8Array(20).fill(1) };
  escPosRasterImage(doc, bild);
  const bytes = Array.from(escPosBytes(doc));
  const start = bytes.findIndex((v, i) => v === 0x1d && bytes[i + 1] === 0x76 && bytes[i + 2] === 0x30);
  assert.ok(start >= 0, 'GS v 0 fehlt');
  assert.deepEqual(bytes.slice(start, start + 8), [0x1d, 0x76, 0x30, 0x00, 2, 0, 2, 0]);
  assert.deepEqual(bytes.slice(start + 8, start + 12), [0xff, 0xc0, 0xff, 0xc0]);
  assert.ok(!bytes.slice(start + 12).includes(0x0a), 'kein LF: das Bild schiebt das Papier selbst');
  assert.throws(() => escPosRasterImage(createEscPosDocument({ paperSize: 'mm58' }), { width: 385, height: 1, dots: new Uint8Array(385) }), /breiter/);
  assert.throws(() => escPosRasterImage(doc, { width: 2, height: 2, dots: new Uint8Array(3) }), /Punkte/);
});

test('escPosRasterImage: Masse werden VOR dem Packen geprueft, Hoehe hoechstens 65535 Punkte', () => {
  // GS v 0 traegt die Hoehe in yL/yH: 65536 liefe still auf 0 ueber.
  const doc = createEscPosDocument({ paperSize: 'mm58' });
  assert.throws(() => escPosRasterImage(doc, { width: 1, height: 65536, dots: new Uint8Array(65536) }), /Rasterbild hoeher als 65535 Punkte/);
  // Zu breit wirft, bevor die Punkte ueberhaupt gelesen werden: auch mit falscher Punktlaenge meldet sich die Breite.
  assert.throws(() => escPosRasterImage(doc, { width: 385, height: 1, dots: new Uint8Array(0) }), /breiter als der Druckkopf/);
  assert.equal(escPosBytes(doc).length, escPosBytes(createEscPosDocument({ paperSize: 'mm58' })).length, 'nach dem Wurf steht kein Byte im Dokument');
  // Genau 65535 geht noch.
  const grenz = createEscPosDocument({ paperSize: 'mm58' });
  escPosRasterImage(grenz, { width: 1, height: 65535, dots: new Uint8Array(65535) });
  const bytes = Array.from(escPosBytes(grenz));
  const start = bytes.findIndex((v, i) => v === 0x1d && bytes[i + 1] === 0x76 && bytes[i + 2] === 0x30);
  assert.deepEqual(bytes.slice(start + 4, start + 8), [1, 0, 0xff, 0xff]);
});

test('eposImageXml: mono, Punktmass, Base64 der Rasterzeilen', () => {
  const bild: RasterImage = { width: 10, height: 2, dots: new Uint8Array(20).fill(1) };
  assert.equal(eposImageXml(bild), '<image width="10" height="2" color="color_1" mode="mono">/8D/wA==</image>');
});

test('rasterRowsBase64: dieselben Bytes wie im ePOS-<image>', () => {
  const bild: RasterImage = { width: 10, height: 2, dots: new Uint8Array(20).fill(1) };
  assert.equal(rasterRowsBase64(bild), '/8D/wA==');
  assert.equal(eposImageXml(bild), '<image width="10" height="2" color="color_1" mode="mono">/8D/wA==</image>');
});
