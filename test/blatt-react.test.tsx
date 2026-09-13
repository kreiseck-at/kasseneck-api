import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';

import type { ReceiptLayout } from '../src/receipt/layout.js';
import { belegBlatt } from '../src/receipt/index.js';
import { BelegBlattView, BelegBlattZeilen } from '../src/react/index.js';

const LAYOUT: ReceiptLayout = { paperSize: 'mm58', regelwerk: 2, lines: [
  { kind: 'banner', text: 'TESTKASSE — kein gültiger Beleg', ton: 'warnung' },
  { kind: 'columns', columns: [{ text: 'Gesamt:', width: 6, align: 'left' }, { text: '5,96 €', width: 6, align: 'right' }] },
  { kind: 'qr', data: 'QR-INHALT' },
] };

const zeilenAusHtml = (html: string): string[] =>
  Array.from(html.matchAll(/<div class="keck-blatt-zeile"[^>]*>([^<]*)<\/div>/g), (m) => m[1]!.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'"));

test('BelegBlattZeilen: jede Zeile des Blatts steht zeichengleich im DOM, in der Blattbreite', () => {
  const blatt = belegBlatt(LAYOUT, { logo: { stufe: 'M', pxBreite: 100, pxHoehe: 50 }, marke: true });
  const html = renderToStaticMarkup(<BelegBlattZeilen blatt={blatt} logoUrl="https://x/logo.png" />);
  const soll = blatt.bloecke.filter((b) => b.art === 'zeile').map((b) => (b as { text: string }).text);
  assert.deepEqual(zeilenAusHtml(html), soll);
  assert.ok(html.includes('data-zeichen="32"'));
  assert.ok(html.includes('width:32ch'), html);
  assert.ok(html.includes('white-space:pre'), html);
});

test('BelegBlattZeilen: Logo in Blattanteil und Zeilen, QR in seinem Anteil, Reihenfolge wie im Blatt', () => {
  const blatt = belegBlatt(LAYOUT, { logo: { stufe: 'M', pxBreite: 100, pxHoehe: 50 } });
  const logo = blatt.bloecke.find((b) => b.art === 'logo') as { breiteAnteil: number; hoeheZeilen: number };
  const qr = blatt.bloecke.find((b) => b.art === 'qr') as { breiteAnteil: number };
  const html = renderToStaticMarkup(<BelegBlattZeilen blatt={blatt} logoUrl="https://x/logo.png" renderQr={(d) => <svg data-inhalt={d} />} />);
  assert.ok(html.includes(`width:${logo.breiteAnteil * 32}ch`), html);
  assert.ok(html.includes(`height:${logo.hoeheZeilen * 2}ch`), html);
  assert.ok(html.includes(`width:${qr.breiteAnteil * 32}ch`), html);
  const iRahmen = html.lastIndexOf('================================', html.indexOf('keck-blatt-logo'));
  assert.ok(iRahmen >= 0 && iRahmen < html.indexOf('keck-blatt-logo') && html.indexOf('keck-blatt-logo') < html.indexOf('Gesamt:'));
  assert.ok(html.indexOf('keck-blatt-qr') > html.indexOf('Gesamt:'));
  assert.ok(html.includes('data-inhalt="QR-INHALT"'));
});

test('BelegBlattView ohne geladenes Logo: noch kein Logo-Block (Server-Rendering), Marke und Zeilen stehen', () => {
  const html = renderToStaticMarkup(<BelegBlattView layout={LAYOUT} logo={{ url: 'https://x/logo.png', stufe: 'S' }} marke />);
  assert.ok(!html.includes('keck-blatt-logo'));
  assert.deepEqual(zeilenAusHtml(html), belegBlatt(LAYOUT, { marke: true }).bloecke.filter((b) => b.art === 'zeile').map((b) => (b as { text: string }).text));
});
