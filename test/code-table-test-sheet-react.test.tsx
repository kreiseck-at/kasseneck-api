import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';

import { codeTableTestSheet } from '../src/receipt/index.js';
import { ReceiptSheetLines } from '../src/react/index.js';

const BLATT = codeTableTestSheet({ cashregisterLabel: 'Kasse KECK-1', time: new Date('2026-09-30T12:05:00Z'), paper: 'mm58' });

test('Testblatt am Bildschirm: ReceiptSheetLines zeichnet es, die Nummer doppelt gross und fett, die Zeile zwei Zeilen hoch', () => {
  const html = renderToStaticMarkup(<ReceiptSheetLines sheet={BLATT} />);
  assert.ok(html.includes('data-zeichen="32"'), html);
  const gross = Array.from(html.matchAll(/<div class="keck-blatt-zeile keck-blatt-zeile--gross"[^>]*><span[^>]*>([^<]*)<\/span><span[^>]*>([^<]*)<\/span><\/div>/g), (m) => [m[1], m[2]]);
  assert.deepEqual(gross.map(([n]) => n), ['1', '2', '3', '4', '5', '6']);
  assert.equal(gross[0]![1], ' | ä ö ü Ä Ö Ü ß € § °'.padEnd(30, ' '));
  assert.match(html, /keck-blatt-zeile--gross" style="[^"]*height:4ch/);
  assert.match(html, /<span style="font-size:2em;width:1ch;line-height:2ch;font-weight:bold[^"]*">1<\/span>/);
  // Die Vorlage-Zeile steht als Text (am Papier ein Bild).
  assert.ok(html.includes('     ä ö ü Ä Ö Ü ß € § °'), html);
});

test('Beleg-Zeilen ohne doubleSizeLead bleiben wie bisher (eine Zeile, kein Span)', () => {
  const html = renderToStaticMarkup(<ReceiptSheetLines sheet={{ charsPerLine: 32, blocks: [{ kind: 'line', text: 'x'.padEnd(32, ' '), bold: false, blank: false }] }} />);
  assert.ok(!html.includes('<span'), html);
  assert.ok(!html.includes('--gross'), html);
});
