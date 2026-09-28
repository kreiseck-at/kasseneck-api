import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';

import type { ReceiptLayout } from '../src/receipt/layout.js';
import { receiptSheet, DOTS_PER_CHAR } from '../src/receipt/index.js';
import { ReceiptSheetView, ReceiptSheetLines } from '../src/react/index.js';
import { isLogoPixelSizeAllowed, BRAND_MARK_PATHS } from '../src/receipt/index.js';

const LAYOUT: ReceiptLayout = { paperSize: 'mm58', ruleset: 2, lines: [
  { kind: 'banner', text: 'TESTKASSE — kein gültiger Beleg', tone: 'warning' },
  { kind: 'columns', columns: [{ text: 'Gesamt:', width: 6, align: 'left' }, { text: '5,96 €', width: 6, align: 'right' }] },
  { kind: 'qr', data: 'QR-INHALT' },
] };

const zeilenAusHtml = (html: string): string[] =>
  Array.from(html.matchAll(/<div class="keck-blatt-zeile"[^>]*>([^<]*)<\/div>/g), (m) => m[1]!.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'"));

test('ReceiptSheetLines: jede Zeile des Blatts steht zeichengleich im DOM, in der Blattbreite', () => {
  const blatt = receiptSheet(LAYOUT, { logo: { size: 'M', pixelWidth: 100, pixelHeight: 50 }, brandMark: true });
  const html = renderToStaticMarkup(<ReceiptSheetLines sheet={blatt} logoUrl="https://x/logo.png" />);
  const soll = blatt.blocks.filter((b) => b.kind === 'line').map((b) => (b as { text: string }).text);
  assert.deepEqual(zeilenAusHtml(html), soll);
  assert.ok(html.includes('data-zeichen="32"'));
  assert.ok(html.includes('width:32ch'), html);
  assert.ok(html.includes('white-space:pre'), html);
});

test('ReceiptSheetLines: Logo in Blattanteil und Zeilen, QR in seinem Anteil, Reihenfolge wie im Blatt', () => {
  const blatt = receiptSheet(LAYOUT, { logo: { size: 'M', pixelWidth: 100, pixelHeight: 50 } });
  const logo = blatt.blocks.find((b) => b.kind === 'logo') as { widthFraction: number; heightLines: number };
  const qr = blatt.blocks.find((b) => b.kind === 'qr') as { widthFraction: number };
  const html = renderToStaticMarkup(<ReceiptSheetLines sheet={blatt} logoUrl="https://x/logo.png" renderQr={(d) => <svg data-inhalt={d} />} />);
  assert.ok(html.includes(`width:${logo.widthFraction * 32}ch`), html);
  assert.ok(html.includes(`height:${logo.heightLines * 2}ch`), html);
  assert.ok(html.includes(`width:${qr.widthFraction * 32}ch`), html);
  const iRahmen = html.lastIndexOf('================================', html.indexOf('keck-blatt-logo'));
  assert.ok(iRahmen >= 0 && iRahmen < html.indexOf('keck-blatt-logo') && html.indexOf('keck-blatt-logo') < html.indexOf('Gesamt:'));
  assert.ok(html.indexOf('keck-blatt-qr') > html.indexOf('Gesamt:'));
  assert.ok(html.includes('data-inhalt="QR-INHALT"'));
});

test('ReceiptSheetLines: mit Marke steht ein SVG aus BRAND_MARK_PATHS, in der Groesse des Markenblocks', () => {
  const blatt = receiptSheet(LAYOUT, { brandMark: true });
  const markeBlock = blatt.blocks.find((b) => b.kind === 'brandMark') as { width: number; height: number };
  const html = renderToStaticMarkup(<ReceiptSheetLines sheet={blatt} />);
  assert.ok(html.includes('keck-blatt-marke'), html);
  assert.ok(html.includes(`viewBox="0 0 ${BRAND_MARK_PATHS.width} ${BRAND_MARK_PATHS.height}"`), html);
  assert.equal((html.match(/<path /g) ?? []).length, BRAND_MARK_PATHS.paths.length, 'jeder Pfad steht im SVG');
  assert.ok(html.includes(`width="${markeBlock.width / DOTS_PER_CHAR}ch"`), html);
  assert.ok(html.includes(`height="${markeBlock.height / DOTS_PER_CHAR}ch"`), html);
});

test('ReceiptSheetLines: ohne Marke kein SVG', () => {
  const blatt = receiptSheet(LAYOUT);
  const html = renderToStaticMarkup(<ReceiptSheetLines sheet={blatt} />);
  assert.ok(!html.includes('keck-blatt-marke'), html);
  assert.ok(!html.includes('<svg'), html);
});

test('ReceiptSheetView ohne geladenes Logo: noch kein Logo-Block (Server-Rendering), Marke und Zeilen stehen', () => {
  const html = renderToStaticMarkup(<ReceiptSheetView layout={LAYOUT} logo={{ url: 'https://x/logo.png', size: 'S' }} brandMark />);
  assert.ok(!html.includes('keck-blatt-logo'));
  assert.deepEqual(zeilenAusHtml(html), receiptSheet(LAYOUT, { brandMark: true }).blocks.filter((b) => b.kind === 'line').map((b) => (b as { text: string }).text));
});

/**
 * Ruling A14: ein Logo ueber 4096x4096px (oder 0) bekommt am Bildschirm
 * keinen Logo-Block -- dieselbe Grenze wie das Druck-Kit beim Rastern fuer
 * den Bon (`LOGO_MAX_PIXELS`, `isLogoPixelSizeAllowed` in `../src/receipt/blatt.js`).
 *
 * `ReceiptSheetView` liest das Pixelmass erst im `useEffect` (`new Image()`,
 * `onload`), nachdem der Browser das Bild geladen hat. Diese Test-Umgebung
 * hat kein DOM (kein `jsdom`, kein `document`) -- `renderToStaticMarkup`
 * fuehrt Effekte grundsaetzlich nicht aus (siehe der Test "ohne geladenes
 * Logo" oben: der Logo-Block bleibt beim Server-Rendering IMMER aus, unabhaengig
 * von der neuen Pixelgrenze). Der Ladeweg selbst laesst sich hier also nicht
 * durchspielen; geprueft wird stattdessen genau die Entscheidungsfunktion, die
 * der `onload`-Handler der Ansicht aufruft (`bild.onload = () => { if (aktiv &&
 * isLogoPixelSizeAllowed(bild.naturalWidth, bild.naturalHeight)) setMass(...) }`).
 */
test('isLogoPixelSizeAllowed: die Entscheidung, die ReceiptSheetView beim Laden trifft -- 5000x1200 verwirft, 400x100 laesst zu', () => {
  assert.equal(isLogoPixelSizeAllowed(5000, 1200), false);
  assert.equal(isLogoPixelSizeAllowed(400, 100), true);
});

test('ReceiptSheetLines: QR mit Anteil 0 (Inhalt passt in keine QR-Version) -- kein Absturz, renderQr bekommt die Nutzlast fuer den Papierbeleg-Hinweis, Zeilen stehen', () => {
  const zuLang: ReceiptLayout = { ...LAYOUT, lines: LAYOUT.lines.map((z) => (z.kind === 'qr' ? { kind: 'qr', data: 'x'.repeat(2332) } : z)) };
  const blatt = receiptSheet(zuLang);
  const gerufen: string[] = [];
  const html = renderToStaticMarkup(<ReceiptSheetLines sheet={blatt} renderQr={(d) => { gerufen.push(d); return <i role="alert">Papierbeleg</i>; }} />);
  assert.deepEqual(gerufen, ['x'.repeat(2332)]);
  assert.ok(html.includes('Papierbeleg'));
  assert.deepEqual(zeilenAusHtml(html), blatt.blocks.filter((b) => b.kind === 'line').map((b) => (b as { text: string }).text));
});

/**
 * Ruling A14, Nachtrag zur Pruefung: der Ladeweg selbst laeuft ohne DOM nicht
 * (siehe oben). Damit ein spaeterer Umbau die Grenze im `onload` nicht still
 * wieder durch eine blosse `> 0`-Pruefung ersetzt, haelt dieser Test fest, dass
 * die Ansicht beim Laden genau `isLogoPixelSizeAllowed` fragt.
 */
test('ReceiptSheetView fragt beim Laden des Logos isLogoPixelSizeAllowed (dieselbe Grenze wie der Bon)', () => {
  const quelle = readFileSync('src/react/index.tsx', 'utf8');
  const onload = quelle.match(/bild\.onload\s*=\s*\(\)\s*=>\s*\{([\s\S]*?)\};/);
  assert.ok(onload, 'onload-Handler in ReceiptSheetView nicht gefunden');
  assert.match(onload[1]!, /isLogoPixelSizeAllowed\(bild\.naturalWidth,\s*bild\.naturalHeight\)/);
});
