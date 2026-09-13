import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { ReceiptLayout } from '../src/receipt/layout.js';
import { belegBlatt, blattFuerDruck, eposPrintXml, escPosLayoutBytes, logoMass, logoRasterMass, type DruckLogo } from '../src/receipt/index.js';

/**
 * Die Druckwege setzen das Blatt: Logo nach dem fuehrenden Rahmen, Marke am
 * Ende, und ein Rasterbild, dessen Groesse nicht zum Blatt passt, wird
 * abgewiesen statt verzerrt gedruckt.
 */
const LAYOUT: ReceiptLayout = { paperSize: 'mm80', regelwerk: 2, lines: [
  { kind: 'banner', text: 'TESTKASSE — kein gültiger Beleg', ton: 'warnung' },
  { kind: 'text', text: 'Bäckerei Muster', align: 'center', bold: true },
] };

function probeLogo(zeichen: number): DruckLogo {
  const mass = logoMass({ stufe: 'S', pxBreite: 40, pxHoehe: 20 }, zeichen);
  const { breite, hoehe } = logoRasterMass(mass, zeichen);
  return { stufe: 'S', pxBreite: 40, pxHoehe: 20, raster: { breite, hoehe, punkte: new Uint8Array(breite * hoehe).fill(1) } };
}

const latin1 = (b: Uint8Array): string => Array.from(b, (v) => String.fromCharCode(v)).join('');

test('ESC/POS: Rahmen, dann Bild, dann Firmenname; Marke am Ende', () => {
  const text = latin1(escPosLayoutBytes(LAYOUT, { cut: false, logo: probeLogo(48), marke: true }));
  const rahmenEnde = text.indexOf('='.repeat(48), text.indexOf('TESTKASSE'));
  const bild = text.indexOf('\x1dv0');
  const firma = text.indexOf('Bäckerei Muster'.replace('ä', '\xe4'));
  assert.ok(rahmenEnde > 0 && bild > rahmenEnde && firma > bild, `Reihenfolge: ${rahmenEnde} ${bild} ${firma}`);
  assert.ok(text.lastIndexOf('erstellt mit Kasseneck') > firma);
});

test('ESC/POS: ohne Logo-Option kein Bild, ohne Marke keine Markenzeile (Bestand unveraendert)', () => {
  const text = latin1(escPosLayoutBytes(LAYOUT, { cut: false }));
  assert.equal(text.indexOf('\x1dv0'), -1);
  assert.equal(text.indexOf('erstellt mit'), -1);
});

test('ESC/POS und ePOS: Rasterbild in falscher Groesse wird abgewiesen', () => {
  const falsch: DruckLogo = { ...probeLogo(48), raster: { breite: 3, hoehe: 3, punkte: new Uint8Array(9) } };
  assert.throws(() => escPosLayoutBytes(LAYOUT, { logo: falsch }), /Logo-Raster/);
  assert.throws(() => eposPrintXml(LAYOUT, { logo: falsch }), /Logo-Raster/);
});

test('ePOS: <image> zentriert nach dem Rahmen, Marke als Textzeile, Leerzeilen als feed', () => {
  const xml = eposPrintXml(LAYOUT, { logo: probeLogo(48), marke: true });
  const bild = xml.indexOf('<image ');
  assert.ok(bild > xml.indexOf('TESTKASSE') && bild < xml.indexOf('Bäckerei'), xml);
  assert.ok(xml.slice(0, bild).endsWith('<text align="center"/>\n'), xml);
  assert.ok(xml.slice(bild).includes('</image>\n<text align="left"/>'), xml);
  assert.ok(xml.includes('erstellt mit Kasseneck'));
});

test('blattFuerDruck: teilt sich die Groessenpruefung mit beiden Druckwegen', () => {
  const falsch: DruckLogo = { ...probeLogo(48), raster: { breite: 3, hoehe: 3, punkte: new Uint8Array(9) } };
  assert.throws(() => blattFuerDruck(LAYOUT, { zeichen: 48, logo: falsch, qrGroesse: 'auto' }), /Logo-Raster/);

  const ohneLogo = blattFuerDruck(LAYOUT, { zeichen: 48, marke: true, qrGroesse: 'auto' });
  const vergleich = belegBlatt(LAYOUT, { zeichen: 48, marke: true, qrGroesse: 'auto' });
  assert.deepEqual(ohneLogo, vergleich);
});

test('Druckwege und Blatt zaehlen dieselben Zeilen', () => {
  const blatt = belegBlatt(LAYOUT, { logo: { stufe: 'S', pxBreite: 40, pxHoehe: 20 }, marke: true });
  const xml = eposPrintXml(LAYOUT, { logo: probeLogo(48), marke: true, cut: false });
  const textzeilen = (xml.match(/&#10;<\/text>/g) ?? []).length + (xml.match(/<feed line="1"\/>/g) ?? []).length;
  assert.equal(textzeilen, blatt.bloecke.filter((b) => b.art === 'zeile').length);
});
