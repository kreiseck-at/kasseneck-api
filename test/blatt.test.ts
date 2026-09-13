import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { ReceiptLayout } from '../src/receipt/layout.js';
import { renderReceiptGrid } from '../src/receipt/grid.js';
import { LOGO_STUFEN, MARKE_TEXT, belegBlatt, logoMass, logoRasterMass, papierFuerZeichen, qrBlattAnteil } from '../src/receipt/blatt.js';

/**
 * Das Blatt ist die vollstaendige Folge dessen, was auf dem Papier steht.
 * Jeder Zeichner setzt nur noch das Blatt um -- darum stehen Reihenfolge,
 * Abstaende und Groessen hier und nirgends sonst.
 */
const QR = '_R1-AT1_KASSE1_AT0-KASSE1-42_2026-08-13T00:30:00_5,00_2,70_0,00_0,00_0,00_UMSATZ_VORGAENGER_6F0404F0_SIGNATUR';
const TESTKASSE: ReceiptLayout = { paperSize: 'mm80', regelwerk: 2, lines: [
  { kind: 'banner', text: 'TESTKASSE — kein gültiger Beleg', ton: 'warnung' },
  { kind: 'text', text: 'Bäckerei Muster', align: 'center', bold: true },
  { kind: 'space', lines: 1 },
  { kind: 'qr', data: QR },
  { kind: 'banner', text: 'TESTKASSE — kein gültiger Beleg', ton: 'warnung' },
] };

test('ohne Logo und Marke: das Blatt ist genau das Raster (QR als eigener Block)', () => {
  const blatt = belegBlatt(TESTKASSE);
  const grid = renderReceiptGrid(TESTKASSE);
  assert.equal(blatt.zeichen, 48);
  assert.equal(blatt.bloecke.length, grid.lines.length);
  grid.lines.forEach((z, i) => {
    const b = blatt.bloecke[i]!;
    if (z.kind === 'qr') { assert.equal(b.art, 'qr'); return; }
    assert.deepEqual(b, { art: 'zeile', text: z.text, fett: z.bold, leer: z.kind === 'space' });
  });
});

test('Logo steht nach dem fuehrenden Rahmen, mit je einer Leerzeile davor und danach', () => {
  const blatt = belegBlatt(TESTKASSE, { logo: { stufe: 'M', pxBreite: 300, pxHoehe: 120 } });
  const arten = blatt.bloecke.map((b) => (b.art === 'zeile' ? (b.leer ? 'leer' : b.text.trim().slice(0, 4)) : b.art));
  assert.deepEqual(arten.slice(0, 7), ['====', 'TEST', '====', 'leer', 'logo', 'leer', 'Bäck']);
  // am Ende steht der untere Rahmen unveraendert
  assert.deepEqual(arten.slice(-3), ['====', 'TEST', '====']);
});

test('ohne fuehrenden Rahmen beginnt das Blatt mit dem Logo (keine Leerzeile davor)', () => {
  const ohne: ReceiptLayout = { ...TESTKASSE, lines: TESTKASSE.lines.slice(1, 4) };
  const blatt = belegBlatt(ohne, { logo: { stufe: 'S', pxBreite: 100, pxHoehe: 100 } });
  assert.equal(blatt.bloecke[0]!.art, 'logo');
  assert.deepEqual(blatt.bloecke[1], { art: 'zeile', text: ' '.repeat(48), fett: false, leer: true });
});

test('Marke: Leerzeile und zentriert "erstellt mit Kasseneck" ganz am Ende', () => {
  const blatt = belegBlatt(TESTKASSE, { marke: true, zeichen: 32 });
  const letzte = blatt.bloecke.slice(-2);
  assert.deepEqual(letzte[0], { art: 'zeile', text: ' '.repeat(32), fett: false, leer: true });
  assert.deepEqual(letzte[1], { art: 'zeile', text: '     erstellt mit Kasseneck     ', fett: false, leer: false });
  assert.equal(MARKE_TEXT, 'erstellt mit Kasseneck');
});

test('logoMass: in den Kasten eingepasst, nie hochgerechnet', () => {
  // 80 mm = 576 Punkte; M-Kasten 0,62*576 = 357,12 breit, 8*24 = 192 hoch
  const breit = logoMass({ stufe: 'M', pxBreite: 1000, pxHoehe: 200 }, 48);
  assert.ok(Math.abs(breit.breiteAnteil - 0.62) < 1e-12);
  assert.ok(Math.abs(breit.hoeheZeilen - (200 * (357.12 / 1000)) / 24) < 1e-12);
  const hoch = logoMass({ stufe: 'M', pxBreite: 200, pxHoehe: 1000 }, 48);
  assert.ok(Math.abs(hoch.hoeheZeilen - 8) < 1e-12);
  const klein = logoMass({ stufe: 'XL', pxBreite: 100, pxHoehe: 50 }, 48);
  assert.ok(Math.abs(klein.breiteAnteil - 100 / 576) < 1e-12, 'kleines Logo bleibt 1 Pixel = 1 Punkt');
  assert.ok(Math.abs(klein.hoeheZeilen - 50 / 24) < 1e-12);
  assert.throws(() => logoMass({ stufe: 'M', pxBreite: 0, pxHoehe: 10 }, 48), /Pixelmass/);
  assert.deepEqual(Object.keys(LOGO_STUFEN), ['S', 'M', 'L', 'XL']);
});

test('logoRasterMass: gerundete Druckpunkte aus dem Mass', () => {
  assert.deepEqual(logoRasterMass({ breiteAnteil: 100 / 576, hoeheZeilen: 50 / 24 }, 48), { breite: 100, hoehe: 50 });
});

test('qrBlattAnteil: die Breite, die der Drucker fuer diese Nutzlast druckt, geteilt durch die Kopfbreite', () => {
  // 109 Byte -> Version 7 = 45 Module + 8 Ruhezone = 53; 80 mm auto: min(floor(576/53)=10, Deckel 6) = 6 -> 318/576
  // Ruling 11: auto deckelt wie im Dart-Zwilling bei 6 (vorher 4 -> 212/576).
  const anteil80 = qrBlattAnteil(QR, 'mm80');
  assert.equal(anteil80, (53 * 6) / 576);
  assert.equal(qrBlattAnteil(QR, 'mm80', 'mittel'), (53 * 6) / 576);
  assert.equal(qrBlattAnteil('', 'mm58'), 0);
  assert.equal(papierFuerZeichen(32, 'mm80'), 'mm58');
  assert.equal(papierFuerZeichen(40, 'mm80'), 'mm80');
  const blatt = belegBlatt(TESTKASSE);
  const qr = blatt.bloecke.find((b) => b.art === 'qr');
  assert.deepEqual(qr, { art: 'qr', nutzlast: QR, breiteAnteil: anteil80 });
});
