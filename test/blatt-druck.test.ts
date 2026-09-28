import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { ReceiptLayout } from '../src/receipt/layout.js';
import { receiptSheet, eposPrintXml, escPosLayoutBytes, escPosLayoutResult, logoDimensions, logoRasterSize, type PrintLogo } from '../src/receipt/index.js';
import { eposPrintXmlResult } from '../src/receipt/epos.js';
import { blattFuerDruck } from '../src/receipt/layout-escpos.js';

/**
 * Die Druckwege setzen das Blatt: Logo nach dem fuehrenden Rahmen, Marke am
 * Ende, und ein Rasterbild, dessen Groesse nicht zum Blatt passt, wird
 * abgewiesen statt verzerrt gedruckt.
 */
const LAYOUT: ReceiptLayout = { paperSize: 'mm80', ruleset: 2, lines: [
  { kind: 'banner', text: 'TESTKASSE — kein gültiger Beleg', tone: 'warning' },
  { kind: 'text', text: 'Bäckerei Muster', align: 'center', bold: true },
] };

function probeLogo(zeichen: number): PrintLogo {
  const mass = logoDimensions({ size: 'S', pixelWidth: 40, pixelHeight: 20 }, zeichen);
  const { width: breite, height: hoehe } = logoRasterSize(mass, zeichen);
  return { size: 'S', pixelWidth: 40, pixelHeight: 20, raster: { width: breite, height: hoehe, dots: new Uint8Array(breite * hoehe).fill(1) } };
}

const latin1 = (b: Uint8Array): string => Array.from(b, (v) => String.fromCharCode(v)).join('');

test('ESC/POS: Rahmen, dann Bild, dann Firmenname, dann die Marke als eigenes Rasterbild am Ende', () => {
  const text = latin1(escPosLayoutBytes(LAYOUT, { cut: false, logo: probeLogo(48), brandMark: true }));
  const rahmenEnde = text.indexOf('='.repeat(48), text.indexOf('TESTKASSE'));
  const bild = text.indexOf('\x1dv0');
  const firma = text.indexOf('Bäckerei Muster'.replace('ä', '\xe4'));
  const markenbild = text.lastIndexOf('\x1dv0');
  assert.ok(rahmenEnde > 0 && bild > rahmenEnde && firma > bild, `Reihenfolge: ${rahmenEnde} ${bild} ${firma}`);
  assert.ok(markenbild > firma, 'die Marke steht als eigenes Rasterbild nach dem Firmennamen');
  assert.notEqual(bild, markenbild, 'Firmenlogo und Marke sind zwei verschiedene Bildbefehle');
});

test('ESC/POS: ohne Logo-Option und ohne Marke kein Bild (Bestand unveraendert)', () => {
  const text = latin1(escPosLayoutBytes(LAYOUT, { cut: false }));
  assert.equal(text.indexOf('\x1dv0'), -1);
});

test('ESC/POS und ePOS: Rasterbild in falscher Groesse wird abgewiesen', () => {
  const falsch: PrintLogo = { ...probeLogo(48), raster: { width: 3, height: 3, dots: new Uint8Array(9) } };
  assert.throws(() => escPosLayoutBytes(LAYOUT, { logo: falsch }), /Logo-Raster/);
  assert.throws(() => eposPrintXml(LAYOUT, { logo: falsch }), /Logo-Raster/);
});

test('ePOS: Firmenlogo und Marke stehen als eigene <image>-Bloecke, je zentriert', () => {
  const xml = eposPrintXml(LAYOUT, { logo: probeLogo(48), brandMark: true });
  const bilder = [...xml.matchAll(/<image /g)].map((m) => m.index);
  assert.equal(bilder.length, 2, 'Firmenlogo und Marke');
  const [logoBild, brandMarkImage] = bilder as [number, number];
  assert.ok(logoBild > xml.indexOf('TESTKASSE') && logoBild < xml.indexOf('Bäckerei'), xml);
  assert.ok(brandMarkImage > xml.indexOf('Bäckerei'), 'die Marke steht nach dem uebrigen Beleg');
  assert.ok(xml.slice(0, logoBild).endsWith('<text align="center"/>\n'), xml);
  assert.ok(xml.slice(logoBild).includes('</image>\n<text align="left"/>'), xml);
  assert.ok(xml.slice(xml.indexOf('Bäckerei'), brandMarkImage).endsWith('<text align="center"/>\n'), xml);
  assert.ok(xml.slice(brandMarkImage).includes('</image>\n<text align="left"/>'), xml);
});

test('blattFuerDruck: teilt sich die Groessenpruefung mit beiden Druckwegen', () => {
  const falsch: PrintLogo = { ...probeLogo(48), raster: { width: 3, height: 3, dots: new Uint8Array(9) } };
  assert.throws(() => blattFuerDruck(LAYOUT, { zeichen: 48, logo: falsch, qrGroesse: 'auto' }), /Logo-Raster/);

  const ohneLogo = blattFuerDruck(LAYOUT, { zeichen: 48, marke: true, qrGroesse: 'auto' });
  const vergleich = receiptSheet(LAYOUT, { charsPerLine: 48, brandMark: true, qrModuleSize: 'auto' });
  assert.deepEqual(ohneLogo, vergleich);
});

test('Druckwege und Blatt zaehlen dieselben Zeilen', () => {
  const blatt = receiptSheet(LAYOUT, { logo: { size: 'S', pixelWidth: 40, pixelHeight: 20 }, brandMark: true });
  const xml = eposPrintXml(LAYOUT, { logo: probeLogo(48), brandMark: true, cut: false });
  const textzeilen = (xml.match(/&#10;<\/text>/g) ?? []).length + (xml.match(/<feed line="1"\/>/g) ?? []).length;
  assert.equal(textzeilen, blatt.blocks.filter((b) => b.kind === 'line').length);
});

/**
 * Ein QR-Inhalt, der in keine QR-Version passt (Korrektur M, mehr als 2331
 * Byte): kein Druckweg darf daran scheitern. Der Beleg geht ohne QR hinaus und
 * meldet es ueber `qrError` -- wie das Blatt, das dem QR den Anteil 0 gibt.
 */
const ZU_LANG: ReceiptLayout = { paperSize: 'mm80', ruleset: 2, lines: [
  { kind: 'text', text: 'Firma', align: 'center', bold: true },
  { kind: 'qr', data: 'x'.repeat(2332) },
  { kind: 'text', text: 'Danke', align: 'center', bold: false },
] };

for (const qrModus of ['native', 'nativeModel1', 'imageRaster'] as const) {
  test(`ESC/POS ${qrModus}: QR-Inhalt ohne passende Version -- Beleg ohne QR, qrError gesetzt`, () => {
    const r = escPosLayoutResult(ZU_LANG, { cut: false, qrMode: qrModus, qrMatrix: () => { throw new Error('Raster darf gar nicht erst angefragt werden'); } });
    const text = latin1(r.bytes);
    assert.ok(text.includes('Firma') && text.includes('Danke'), 'die Zeilen stehen');
    assert.equal(text.indexOf('\x1d(k'), -1, 'kein QR-Befehl');
    assert.equal(text.indexOf('\x1dv0'), -1, 'kein QR-Bild');
    assert.match(r.qrError ?? '', /keine QR-Version/);
  });
}

test('ePOS: QR-Inhalt ohne passende Version -- kein <symbol>, Zeilen stehen, qrError gesetzt', () => {
  const r = eposPrintXmlResult(ZU_LANG);
  assert.equal(r.xml.includes('<symbol'), false);
  assert.ok(r.xml.includes('Firma') && r.xml.includes('Danke'));
  assert.match(r.qrError ?? '', /keine QR-Version/);
});
