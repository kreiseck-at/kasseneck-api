import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  receiptSheet,
  escPosLayoutBytes,
  eposPrintXml,
  gridToText,
  logoDimensions,
  rasterizeLogo,
  logoRasterSize,
  renderReceiptGrid,
  type PrintLogo,
  type ReceiptSheet,
  type SheetBlock,
  type ReceiptLayout,
} from '../src/receipt/index.js';
import { ReceiptSheetLines, ReceiptLayoutView } from '../src/react/index.js';

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

function druckLogo(zeichen: number): PrintLogo {
  const blattLogo = { size: 'M' as const, pixelWidth: 300, pixelHeight: 120 };
  const mass = logoDimensions(blattLogo, zeichen);
  const raster = rasterizeLogo(verlauf(300, 120), 300, 120, mass, zeichen);
  const soll = logoRasterSize(mass, zeichen);
  if (raster.width !== soll.width || raster.height !== soll.height) throw new Error('Probe-Logo passt nicht');
  return { ...blattLogo, raster };
}

// Deterministische QR-Matrix fuer den Bildweg (das Paket rechnet keine QR-Codes).
function qrMatrix(nutzlast: string): boolean[][] {
  const h = createHash('sha256').update(nutzlast).digest();
  const n = 25;
  return Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => ((h[(y * n + x) % 32]! >> ((x + y) % 8)) & 1) === 1));
}

/**
 * Das Blatt in der Form, in der die Goldens aufgenommen wurden (vor 1.0 hiessen
 * die Felder deutsch: `zeichen`, `bloecke`, `art`, `fett`, `leer`, `nutzlast`,
 * `breiteAnteil`, `hoeheZeilen`, `breite`, `hoehe`; die Arten `zeile` und
 * `marke`). Die Zuordnung ist eins zu eins und behaelt die Reihenfolge der
 * Felder: der Hash vergleicht damit Werte und Aufbau, nicht die Namen. Aendert
 * sich am Blatt mehr als ein Name, schlaegt der Golden weiterhin an.
 */
function blattWieAufgenommen(blatt: ReceiptSheet): unknown {
  const block = (b: SheetBlock): unknown => {
    switch (b.kind) {
      case 'line': return { art: 'zeile', text: b.text, fett: b.bold, leer: b.blank };
      case 'logo': return { art: 'logo', breiteAnteil: b.widthFraction, hoeheZeilen: b.heightLines };
      case 'qr': return { art: 'qr', nutzlast: b.payload, breiteAnteil: b.widthFraction };
      case 'brandMark': return { art: 'marke', breite: b.width, hoehe: b.height };
    }
  };
  return { zeichen: blatt.charsPerLine, bloecke: blatt.blocks.map(block) };
}

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

export function druckAusgaben(layout: ReceiptLayout): Record<string, string> {
  const aus: Record<string, string> = {};
  for (const paperSize of ['mm58', 'mm80'] as const) {
    const zeichen = paperSize === 'mm58' ? 32 : 48;
    const logo = druckLogo(zeichen);
    aus[`escpos.${paperSize}`] = hex(escPosLayoutBytes(layout, { paperSize }));
    aus[`escpos.${paperSize}.marke`] = hex(escPosLayoutBytes(layout, { paperSize, brandMark: true }));
    aus[`escpos.${paperSize}.logo`] = hex(escPosLayoutBytes(layout, { paperSize, logo, brandMark: true }));
    aus[`escpos.${paperSize}.bild`] = hex(escPosLayoutBytes(layout, { paperSize, qrMode: 'imageRaster', qrMatrix, cut: 'partial' }));
    aus[`escpos.${paperSize}.model1`] = hex(escPosLayoutBytes(layout, { paperSize, qrMode: 'nativeModel1', codeTable: null }));
    aus[`epos.${zeichen}`] = eposPrintXml(layout, { charsPerLine: zeichen });
    aus[`epos.${zeichen}.logo`] = eposPrintXml(layout, { charsPerLine: zeichen, logo, brandMark: true, cut: false });
    aus[`grid.${zeichen}`] = gridToText(renderReceiptGrid(layout, { charsPerLine: zeichen }));
    const blatt = receiptSheet(layout, { charsPerLine: zeichen, logo: { size: 'M', pixelWidth: 300, pixelHeight: 120 }, brandMark: true });
    aus[`blatt.${zeichen}`] = JSON.stringify(blattWieAufgenommen(blatt));
    aus[`html.blatt.${zeichen}`] = renderToStaticMarkup(createElement(ReceiptSheetLines, { sheet: blatt, logoUrl: 'https://example.invalid/logo.png' }));
    aus[`html.blatt.${zeichen}.verdeckt`] = renderToStaticMarkup(createElement(ReceiptSheetLines, { sheet: receiptSheet(layout, { charsPerLine: zeichen }), qrHidden: true }));
  }
  aus['html.layout'] = renderToStaticMarkup(createElement(ReceiptLayoutView, { layout }));
  aus['html.layout.verdeckt'] = renderToStaticMarkup(createElement(ReceiptLayoutView, { layout, qrHidden: true, className: 'x' }));
  return aus;
}

export const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
