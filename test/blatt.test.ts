import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { ReceiptLayout } from '../src/receipt/layout.js';
import { renderReceiptGrid } from '../src/receipt/grid.js';
import { LOGO_MAX_PIXELS, SHEET_LOGO_SIZES, receiptSheet, logoDimensions, isLogoPixelSizeAllowed, logoRasterSize, paperSizeForChars, qrSheetWidthFraction } from '../src/receipt/blatt.js';

/**
 * Das Blatt ist die vollstaendige Folge dessen, was auf dem Papier steht.
 * Jeder Zeichner setzt nur noch das Blatt um -- darum stehen Reihenfolge,
 * Abstaende und Groessen hier und nirgends sonst.
 */
const QR = '_R1-AT1_KASSE1_AT0-KASSE1-42_2026-08-13T00:30:00_5,00_2,70_0,00_0,00_0,00_UMSATZ_VORGAENGER_6F0404F0_SIGNATUR';
const TESTKASSE: ReceiptLayout = { paperSize: 'mm80', ruleset: 2, lines: [
  { kind: 'banner', text: 'TESTKASSE — kein gültiger Beleg', tone: 'warning' },
  { kind: 'text', text: 'Bäckerei Muster', align: 'center', bold: true },
  { kind: 'space', lines: 1 },
  { kind: 'qr', data: QR },
  { kind: 'banner', text: 'TESTKASSE — kein gültiger Beleg', tone: 'warning' },
] };

test('ohne Logo und Marke: das Blatt ist genau das Raster (QR als eigener Block)', () => {
  const blatt = receiptSheet(TESTKASSE);
  const grid = renderReceiptGrid(TESTKASSE);
  assert.equal(blatt.charsPerLine, 48);
  assert.equal(blatt.blocks.length, grid.lines.length);
  grid.lines.forEach((z, i) => {
    const b = blatt.blocks[i]!;
    if (z.kind === 'qr') { assert.equal(b.kind, 'qr'); return; }
    assert.deepEqual(b, { kind: 'line', text: z.text, bold: z.bold, blank: z.kind === 'space' });
  });
});

test('Logo steht nach dem fuehrenden Rahmen, mit je einer Leerzeile davor und danach', () => {
  const blatt = receiptSheet(TESTKASSE, { logo: { size: 'M', pixelWidth: 300, pixelHeight: 120 } });
  const arten = blatt.blocks.map((b) => (b.kind === 'line' ? (b.blank ? 'leer' : b.text.trim().slice(0, 4)) : b.kind));
  assert.deepEqual(arten.slice(0, 7), ['====', 'TEST', '====', 'leer', 'logo', 'leer', 'Bäck']);
  // am Ende steht der untere Rahmen unveraendert
  assert.deepEqual(arten.slice(-3), ['====', 'TEST', '====']);
});

test('ohne fuehrenden Rahmen beginnt das Blatt mit dem Logo (keine Leerzeile davor)', () => {
  const ohne: ReceiptLayout = { ...TESTKASSE, lines: TESTKASSE.lines.slice(1, 4) };
  const blatt = receiptSheet(ohne, { logo: { size: 'S', pixelWidth: 100, pixelHeight: 100 } });
  assert.equal(blatt.blocks[0]!.kind, 'logo');
  assert.deepEqual(blatt.blocks[1], { kind: 'line', text: ' '.repeat(48), bold: false, blank: true });
});

test('mit Marke steht am Ende ein Markenblock, keine Textzeile', () => {
  const blatt = receiptSheet(TESTKASSE, { charsPerLine: 32, brandMark: true });
  const letzter = blatt.blocks[blatt.blocks.length - 1];
  assert.equal(letzter?.kind, 'brandMark');
  const alsText = blatt.blocks.map((b) => (b.kind === 'line' ? b.text : '')).join('\n');
  assert.ok(!alsText.includes('erstellt mit Kasseneck'), 'die Textzeile ist ersetzt, nicht ergaenzt');
});

test('ohne Marke entsteht kein Markenblock', () => {
  const blatt = receiptSheet(TESTKASSE, { charsPerLine: 32, brandMark: false });
  assert.ok(!blatt.blocks.some((b) => b.kind === 'brandMark'));
});

test('logoDimensions: in den Kasten eingepasst, nie hochgerechnet', () => {
  // 80 mm = 576 Punkte; M-Kasten 0,62*576 = 357,12 breit, 8*24 = 192 hoch
  const breit = logoDimensions({ size: 'M', pixelWidth: 1000, pixelHeight: 200 }, 48);
  assert.ok(Math.abs(breit.widthFraction - 0.62) < 1e-12);
  assert.ok(Math.abs(breit.heightLines - (200 * (357.12 / 1000)) / 24) < 1e-12);
  const hoch = logoDimensions({ size: 'M', pixelWidth: 200, pixelHeight: 1000 }, 48);
  assert.ok(Math.abs(hoch.heightLines - 8) < 1e-12);
  const klein = logoDimensions({ size: 'XL', pixelWidth: 100, pixelHeight: 50 }, 48);
  assert.ok(Math.abs(klein.widthFraction - 100 / 576) < 1e-12, 'kleines Logo bleibt 1 Pixel = 1 Punkt');
  assert.ok(Math.abs(klein.heightLines - 50 / 24) < 1e-12);
  assert.throws(() => logoDimensions({ size: 'M', pixelWidth: 0, pixelHeight: 10 }, 48), /Pixelmass/);
  assert.deepEqual(Object.keys(SHEET_LOGO_SIZES), ['S', 'M', 'L', 'XL']);
});

test('isLogoPixelSizeAllowed: dieselbe Grenze wie das Druck-Kit (4096px) -- der Bildschirm darf kein Logo zeigen, das der Bon ablehnt', () => {
  assert.equal(LOGO_MAX_PIXELS, 4096);
  assert.equal(isLogoPixelSizeAllowed(4096, 4096), true);
  assert.equal(isLogoPixelSizeAllowed(4097, 4096), false);
  assert.equal(isLogoPixelSizeAllowed(4096, 4097), false);
  assert.equal(isLogoPixelSizeAllowed(1, 1), true);
  assert.equal(isLogoPixelSizeAllowed(0, 100), false);
  assert.equal(isLogoPixelSizeAllowed(100, 0), false);
  assert.equal(isLogoPixelSizeAllowed(0, 0), false);
});

test('logoRasterSize: gerundete Druckpunkte aus dem Mass', () => {
  assert.deepEqual(logoRasterSize({ widthFraction: 100 / 576, heightLines: 50 / 24 }, 48), { width: 100, height: 50 });
});

test('qrSheetWidthFraction: die Breite, die der Drucker fuer diese Nutzlast druckt, geteilt durch die Kopfbreite', () => {
  // 109 Byte -> Version 7 = 45 Module + 8 Ruhezone = 53; 80 mm auto: min(floor(576/53)=10, Deckel 6) = 6 -> 318/576
  // Ruling 11: auto deckelt wie im Dart-Zwilling bei 6 (vorher 4 -> 212/576).
  const anteil80 = qrSheetWidthFraction(QR, 'mm80');
  assert.equal(anteil80, (53 * 6) / 576);
  assert.equal(qrSheetWidthFraction(QR, 'mm80', 'medium'), (53 * 6) / 576);
  assert.equal(qrSheetWidthFraction('', 'mm58'), 0);
  assert.equal(paperSizeForChars(32, 'mm80'), 'mm58');
  assert.equal(paperSizeForChars(40, 'mm80'), 'mm80');
  const blatt = receiptSheet(TESTKASSE);
  const qr = blatt.blocks.find((b) => b.kind === 'qr');
  assert.deepEqual(qr, { kind: 'qr', payload: QR, widthFraction: anteil80 });
});

test('qrSheetWidthFraction: ein Inhalt, der in keine QR-Version passt, ergibt 0 statt zu werfen', () => {
  assert.equal(qrSheetWidthFraction('x'.repeat(2332), 'mm80'), 0);
  // Grenze: 2331 Byte passen noch (Version 40, Korrektur M) -- Anteil > 0.
  assert.ok(qrSheetWidthFraction('x'.repeat(2331), 'mm80') > 0);
});

test('receiptSheet: ein QR-Inhalt, der in keine Version passt, wirft nicht -- der Block bleibt, nur ohne Breite', () => {
  const zuLang: ReceiptLayout = { ...TESTKASSE, lines: TESTKASSE.lines.map((z) => (z.kind === 'qr' ? { kind: 'qr', data: 'x'.repeat(2332) } : z)) };
  assert.doesNotThrow(() => receiptSheet(zuLang, { charsPerLine: 48 }));
  const ergebnis = receiptSheet(zuLang, { charsPerLine: 48 });
  const qrIndex = ergebnis.blocks.findIndex((b) => b.kind === 'qr');
  assert.ok(qrIndex >= 0, 'der QR-Block bleibt Teil des Blatts');
  assert.deepEqual(ergebnis.blocks[qrIndex], { kind: 'qr', payload: 'x'.repeat(2332), widthFraction: 0 });

  // Dieselben Zeilenbloecke wie beim Layout ganz ohne QR-Zeile -- der QR-Block
  // an seiner Stelle kommt oben schon dazu, sonst aendert sich nichts.
  const ohneQr: ReceiptLayout = { ...TESTKASSE, lines: TESTKASSE.lines.filter((z) => z.kind !== 'qr') };
  const ergebnisOhne = receiptSheet(ohneQr, { charsPerLine: 48 });
  const bloeckeOhneQr = [...ergebnis.blocks.slice(0, qrIndex), ...ergebnis.blocks.slice(qrIndex + 1)];
  assert.deepEqual(bloeckeOhneQr, ergebnisOhne.blocks);
});
