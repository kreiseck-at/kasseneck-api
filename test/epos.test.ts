import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { ReceiptLayout } from '../src/receipt/layout.js';
import { eposPrintXml, eposXmlEscape, ZEICHEN_JE_PAPIER } from '../src/receipt/index.js';

/**
 * ePOS-Print XML (Epson TM, Server Direct Print / ePOS-Print): aus dem
 * Zeichenraster -- jede Rasterzeile eine <text>-Zeile, Aufdrucke doppelt
 * hoch/invers, QR als <symbol>, Schnitt. Kein eigenes Setzen: was das Raster
 * zeigt, druckt der Epson Zeile fuer Zeile.
 */
const QR = '_R1-AT1_KASSE1_AT0-KASSE1-42_2026-08-13T00:30:00_5,00_2,70_0,00_0,00_0,00_UMSATZ_VORGAENGER_6F0404F0_SIGNATUR';
const LAYOUT: ReceiptLayout = { paperSize: 'mm80', regelwerk: 2, lines: [
  { kind: 'banner', text: 'TESTSIGNATUR — kein gültiger Beleg', ton: 'warnung' },
  { kind: 'text', text: 'Bäckerei <Muster> & Söhne', align: 'center', bold: true },
  { kind: 'columns', columns: [{ text: 'Gesamt:', width: 6, align: 'left' }, { text: '5,96 €', width: 6, align: 'right' }] },
  { kind: 'rule', char: '-' },
  { kind: 'space', lines: 2 },
  { kind: 'qr', data: QR },
] };

test('eposPrintXml: Namensraum, lang de, eine <text> je Rasterzeile mit exakt N Zeichen, Sonderzeichen escaped, QR-Symbol, Schnitt', () => {
  const xml = eposPrintXml(LAYOUT);
  assert.ok(xml.startsWith('<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">'));
  assert.ok(xml.includes('<text lang="de"/>'));
  // Firmenzeile: escaped, zentriert aufgefuellt auf 48 Zeichen, fett
  const firma = /<text em="true">([^<]*)&#10;<\/text>/.exec(xml);
  assert.ok(firma, xml);
  assert.equal(firma![1]!.length, 48 + ('&lt;'.length - 1) + ('&gt;'.length - 1) + ('&amp;'.length - 1));
  assert.ok(firma![1]!.includes('Bäckerei &lt;Muster&gt; &amp; Söhne'));
  // Warnrahmen: doppelt hoch + invers, wortweise auf 48 -> eine Zeile
  assert.ok(/<text width="1" height="2" reverse="true" em="true"> *TESTSIGNATUR — kein gültiger Beleg *&#10;<\/text>/.test(xml), xml);
  // Gesamt-Zeile: 48 Zeichen, Preis am Ende
  assert.ok(/<text>Gesamt: +5,96 €&#10;<\/text>/.test(xml), xml);
  // Linie, Leerraum, QR, Schnitt
  assert.ok(xml.includes(`<text>${'-'.repeat(48)}&#10;</text>`));
  assert.ok((xml.match(/<feed line="1"\/>/g) ?? []).length >= 2);
  assert.ok(xml.includes(`<symbol type="qrcode_model_2" level="level_m" width="6" height="0" size="0">${QR}</symbol>`));
  assert.ok(/<cut type="feed"\/>\s*<\/epos-print>\s*$/.test(xml));
  // 58 mm: 32 Zeichen
  const xml58 = eposPrintXml({ ...LAYOUT, paperSize: 'mm58' });
  assert.ok(xml58.includes(`<text>${'-'.repeat(ZEICHEN_JE_PAPIER.mm58)}&#10;</text>`));
});

test('eposXmlEscape und Zeilen ohne Text; jede Textzeile hat einen Zeilenumbruch (Epson druckt sonst nicht um)', () => {
  assert.equal(eposXmlEscape('a<b>&"\''), 'a&lt;b&gt;&amp;&quot;&apos;');
  const xml = eposPrintXml({ paperSize: 'mm58', regelwerk: 2, lines: [{ kind: 'text', text: 'Zeile', align: 'left', bold: false }] });
  assert.ok(/<text>Zeile {27}&#10;<\/text>/.test(xml), xml);
});
