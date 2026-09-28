import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  belegBlatt,
  escPosLayoutBytes,
  eposPrintXml,
  gridAlsText,
  logoMass,
  logoRaster,
  logoRasterMass,
  renderReceiptGrid,
  type DruckLogo,
  type ReceiptLayout,
} from '../src/receipt/index.js';
import { BelegBlattZeilen, ReceiptLayoutView } from '../src/react/index.js';

/**
 * Alle Ausgaben eines Layouts, die am Papier oder am Schirm landen: der
 * ESC/POS-Bytestrom, das ePOS-XML, das Blatt (Bildschirm/PDF), das
 * Zeichenraster und das HTML beider React-Ansichten, je in den Varianten,
 * die im Feld vorkommen (58/80 mm, Logo, Marke, QR als Bild).
 *
 * Nimmt nur das fertige Layout: die Namen der Bau-Optionen kommen hier nicht
 * vor. So vergleicht `druck-goldens.test.ts` den Stand vor und nach der
 * Umbenennung der Layout-Schluessel auf dieselben Bytes.
 */

// Deterministisches Probe-Logo: dieselbe Verlaufsformel wie im Golden-Test.
function verlauf(b: number, h: number): Uint8Array {
  const rgba = new Uint8Array(b * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < b; x++) {
    const i = (y * b + x) * 4;
    const g = Math.floor((x * 255) / (b - 1));
    rgba[i] = g; rgba[i + 1] = (g * 3) % 256; rgba[i + 2] = 255 - g; rgba[i + 3] = y < 10 ? 0 : 255;
  }
  return rgba;
}

function druckLogo(zeichen: number): DruckLogo {
  const blattLogo = { stufe: 'M' as const, pxBreite: 300, pxHoehe: 120 };
  const mass = logoMass(blattLogo, zeichen);
  const raster = logoRaster(verlauf(300, 120), 300, 120, mass, zeichen);
  const soll = logoRasterMass(mass, zeichen);
  if (raster.breite !== soll.breite || raster.hoehe !== soll.hoehe) throw new Error('Probe-Logo passt nicht');
  return { ...blattLogo, raster };
}

// Deterministische QR-Matrix fuer den Bildweg (das Paket rechnet keine QR-Codes).
function qrMatrix(nutzlast: string): boolean[][] {
  const h = createHash('sha256').update(nutzlast).digest();
  const n = 25;
  return Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => ((h[(y * n + x) % 32]! >> ((x + y) % 8)) & 1) === 1));
}

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

export function druckAusgaben(layout: ReceiptLayout): Record<string, string> {
  const aus: Record<string, string> = {};
  for (const paperSize of ['mm58', 'mm80'] as const) {
    const zeichen = paperSize === 'mm58' ? 32 : 48;
    const logo = druckLogo(zeichen);
    aus[`escpos.${paperSize}`] = hex(escPosLayoutBytes(layout, { paperSize }));
    aus[`escpos.${paperSize}.marke`] = hex(escPosLayoutBytes(layout, { paperSize, marke: true }));
    aus[`escpos.${paperSize}.logo`] = hex(escPosLayoutBytes(layout, { paperSize, logo, marke: true }));
    aus[`escpos.${paperSize}.bild`] = hex(escPosLayoutBytes(layout, { paperSize, qrModus: 'imageRaster', qrMatrix, cut: 'partial' }));
    aus[`escpos.${paperSize}.model1`] = hex(escPosLayoutBytes(layout, { paperSize, qrModus: 'nativeModel1', codeTable: null }));
    aus[`epos.${zeichen}`] = eposPrintXml(layout, { zeichen });
    aus[`epos.${zeichen}.logo`] = eposPrintXml(layout, { zeichen, logo, marke: true, cut: false });
    aus[`grid.${zeichen}`] = gridAlsText(renderReceiptGrid(layout, { zeichen }));
    const blatt = belegBlatt(layout, { zeichen, logo: { stufe: 'M', pxBreite: 300, pxHoehe: 120 }, marke: true });
    aus[`blatt.${zeichen}`] = JSON.stringify(blatt);
    aus[`html.blatt.${zeichen}`] = renderToStaticMarkup(createElement(BelegBlattZeilen, { blatt, logoUrl: 'https://example.invalid/logo.png' }));
    aus[`html.blatt.${zeichen}.verdeckt`] = renderToStaticMarkup(createElement(BelegBlattZeilen, { blatt: belegBlatt(layout, { zeichen }), qrVerdeckt: true }));
  }
  aus['html.layout'] = renderToStaticMarkup(createElement(ReceiptLayoutView, { layout }));
  aus['html.layout.verdeckt'] = renderToStaticMarkup(createElement(ReceiptLayoutView, { layout, qrVerdeckt: true, className: 'x' }));
  return aus;
}

export const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
