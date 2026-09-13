import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createEscPosDocument, escPosBytes, escPosRasterBild, rasterZeilenBytes, type RasterBild } from '../src/printing/index.js';
import { eposBildXml, logoRaster } from '../src/receipt/index.js';

/** RGBA-Muster wie `ImageData.data`: waagrechter Verlauf schwarz->weiss, die oberste Zeile durchsichtig. */
function verlauf(b: number, h: number): Uint8Array {
  const rgba = new Uint8Array(b * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < b; x++) {
    const i = (y * b + x) * 4; const g = Math.floor((x * 255) / Math.max(1, b - 1));
    rgba[i] = g; rgba[i + 1] = g; rgba[i + 2] = g; rgba[i + 3] = y === 0 ? 0 : 255;
  }
  return rgba;
}

test('logoRaster: Groesse aus dem Mass, Transparenz wird Papier, dunkel wird Punkt', () => {
  const bild = logoRaster(verlauf(24, 4), 24, 4, { breiteAnteil: 24 / 576, hoeheZeilen: 4 / 24 }, 48);
  assert.equal(bild.breite, 24); assert.equal(bild.hoehe, 4);
  assert.equal(bild.punkte.length, 96);
  for (let x = 0; x < 24; x++) assert.equal(bild.punkte[x], 0, 'durchsichtige Zeile bleibt weiss');
  assert.equal(bild.punkte[24], 1, 'links schwarz');
  assert.equal(bild.punkte[24 + 23], 0, 'rechts weiss');
  const schwarz = Array.from(bild.punkte.slice(24)).filter((p) => p === 1).length;
  assert.ok(schwarz > 24 && schwarz < 48, `Verlauf gerastert (Floyd-Steinberg): ${schwarz} von 72`);
});

test('logoRaster: verkleinert per Flaechenmittel und ist deterministisch', () => {
  const a = logoRaster(verlauf(300, 100), 300, 100, { breiteAnteil: 150 / 576, hoeheZeilen: 50 / 24 }, 48);
  const b = logoRaster(verlauf(300, 100), 300, 100, { breiteAnteil: 150 / 576, hoeheZeilen: 50 / 24 }, 48);
  assert.equal(a.breite, 150); assert.equal(a.hoehe, 50);
  assert.deepEqual(a.punkte, b.punkte);
  assert.throws(() => logoRaster(new Uint8Array(3), 1, 1, { breiteAnteil: 1 / 576, hoeheZeilen: 1 / 24 }, 48), /RGBA/);
});

test('rasterZeilenBytes: MSB zuerst, Zeilen auf volle Bytes aufgefuellt', () => {
  const bild: RasterBild = { breite: 10, hoehe: 2, punkte: Uint8Array.from([1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0]) };
  assert.deepEqual(Array.from(rasterZeilenBytes(bild)), [0x80, 0x40, 0x00, 0x80]);
});

test('escPosRasterBild: GS v 0 mit Byte-Breite und Hoehe, zentriert, ohne Zeilenvorschub danach', () => {
  const doc = createEscPosDocument({ paperSize: 'mm80' });
  const bild: RasterBild = { breite: 10, hoehe: 2, punkte: new Uint8Array(20).fill(1) };
  escPosRasterBild(doc, bild);
  const bytes = Array.from(escPosBytes(doc));
  const start = bytes.findIndex((v, i) => v === 0x1d && bytes[i + 1] === 0x76 && bytes[i + 2] === 0x30);
  assert.ok(start >= 0, 'GS v 0 fehlt');
  assert.deepEqual(bytes.slice(start, start + 8), [0x1d, 0x76, 0x30, 0x00, 2, 0, 2, 0]);
  assert.deepEqual(bytes.slice(start + 8, start + 12), [0xff, 0xc0, 0xff, 0xc0]);
  assert.ok(!bytes.slice(start + 12).includes(0x0a), 'kein LF: das Bild schiebt das Papier selbst');
  assert.throws(() => escPosRasterBild(createEscPosDocument({ paperSize: 'mm58' }), { breite: 385, hoehe: 1, punkte: new Uint8Array(385) }), /breiter/);
  assert.throws(() => escPosRasterBild(doc, { breite: 2, hoehe: 2, punkte: new Uint8Array(3) }), /Punkte/);
});

test('eposBildXml: mono, Punktmass, Base64 der Rasterzeilen', () => {
  const bild: RasterBild = { breite: 10, hoehe: 2, punkte: new Uint8Array(20).fill(1) };
  assert.equal(eposBildXml(bild), '<image width="10" height="2" color="color_1" mode="mono">/8D/wA==</image>');
});
