import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';

import type { ReceiptLayout } from '../src/receipt/layout.js';
import { belegBlatt } from '../src/receipt/index.js';
import { BelegBlattView, BelegBlattZeilen } from '../src/react/index.js';
import { logoPixelZulaessig } from '../src/receipt/index.js';

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

/**
 * Ruling A14: ein Logo ueber 4096x4096px (oder 0) bekommt am Bildschirm
 * keinen Logo-Block -- dieselbe Grenze wie das Druck-Kit beim Rastern fuer
 * den Bon (`LOGO_PIXEL_MAX`, `logoPixelZulaessig` in `../src/receipt/blatt.js`).
 *
 * `BelegBlattView` liest das Pixelmass erst im `useEffect` (`new Image()`,
 * `onload`), nachdem der Browser das Bild geladen hat. Diese Test-Umgebung
 * hat kein DOM (kein `jsdom`, kein `document`) -- `renderToStaticMarkup`
 * fuehrt Effekte grundsaetzlich nicht aus (siehe der Test "ohne geladenes
 * Logo" oben: der Logo-Block bleibt beim Server-Rendering IMMER aus, unabhaengig
 * von der neuen Pixelgrenze). Der Ladeweg selbst laesst sich hier also nicht
 * durchspielen; geprueft wird stattdessen genau die Entscheidungsfunktion, die
 * der `onload`-Handler der Ansicht aufruft (`bild.onload = () => { if (aktiv &&
 * logoPixelZulaessig(bild.naturalWidth, bild.naturalHeight)) setMass(...) }`).
 */
test('logoPixelZulaessig: die Entscheidung, die BelegBlattView beim Laden trifft -- 5000x1200 verwirft, 400x100 laesst zu', () => {
  assert.equal(logoPixelZulaessig(5000, 1200), false);
  assert.equal(logoPixelZulaessig(400, 100), true);
});

test('BelegBlattZeilen: QR mit Anteil 0 (Inhalt passt in keine QR-Version) -- kein Absturz, renderQr bekommt die Nutzlast fuer den Papierbeleg-Hinweis, Zeilen stehen', () => {
  const zuLang: ReceiptLayout = { ...LAYOUT, lines: LAYOUT.lines.map((z) => (z.kind === 'qr' ? { kind: 'qr', data: 'x'.repeat(2332) } : z)) };
  const blatt = belegBlatt(zuLang);
  const gerufen: string[] = [];
  const html = renderToStaticMarkup(<BelegBlattZeilen blatt={blatt} renderQr={(d) => { gerufen.push(d); return <i role="alert">Papierbeleg</i>; }} />);
  assert.deepEqual(gerufen, ['x'.repeat(2332)]);
  assert.ok(html.includes('Papierbeleg'));
  assert.deepEqual(zeilenAusHtml(html), blatt.bloecke.filter((b) => b.art === 'zeile').map((b) => (b as { text: string }).text));
});

/**
 * Ruling A14, Nachtrag zur Pruefung: der Ladeweg selbst laeuft ohne DOM nicht
 * (siehe oben). Damit ein spaeterer Umbau die Grenze im `onload` nicht still
 * wieder durch eine blosse `> 0`-Pruefung ersetzt, haelt dieser Test fest, dass
 * die Ansicht beim Laden genau `logoPixelZulaessig` fragt.
 */
test('BelegBlattView fragt beim Laden des Logos logoPixelZulaessig (dieselbe Grenze wie der Bon)', () => {
  const quelle = readFileSync('src/react/index.tsx', 'utf8');
  const onload = quelle.match(/bild\.onload\s*=\s*\(\)\s*=>\s*\{([\s\S]*?)\};/);
  assert.ok(onload, 'onload-Handler in BelegBlattView nicht gefunden');
  assert.match(onload[1]!, /logoPixelZulaessig\(bild\.naturalWidth,\s*bild\.naturalHeight\)/);
});
