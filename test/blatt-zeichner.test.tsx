import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';

import { QR_PRINT_WIDTH_DOTS, QR_QUIET_ZONE_MODULES, qrSizingFor } from '../src/printing/index.js';
import { eposPrintXmlResult, logoDimensions, logoRasterSize, paperSizeForChars, type ReceiptSheet, type PrintLogo, type ReceiptLayout } from '../src/receipt/index.js';
import { ReceiptSheetLines } from '../src/react/index.js';

/**
 * Jeder Zeichner gegen JEDES Blatt-Golden: der ePOS-Druckweg und die
 * React-Ansicht muessen Zeile fuer Zeile die Folge aus
 * `fixtures/erwartet/<name>.blatt<zeichen>.json` setzen.
 *
 * Die Erwartung ist die Golden-Datei selbst -- `receiptSheet` wird hier bewusst
 * NICHT noch einmal gerechnet. Sonst pruefte der Test nur, dass zwei Aufrufe
 * derselben Funktion uebereinstimmen, und ein Fehler im Blatt fiele an beiden
 * Seiten gleich aus.
 */

// test-dist liegt eine Ebene tiefer (test-dist/test/...): die Fixtures liegen im Repo-Wurzelverzeichnis.
const wurzel = new URL('../../fixtures/', import.meta.url);
const namen = readdirSync(new URL('belege/', wurzel)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();

const layoutVon = (name: string): ReceiptLayout => JSON.parse(readFileSync(new URL(`erwartet/${name}.lines.json`, wurzel), 'utf8')) as ReceiptLayout;
const goldenBlatt = (name: string, zeichen: number): ReceiptSheet =>
  JSON.parse(readFileSync(new URL(`erwartet/${name}.blatt${zeichen}.json`, wurzel), 'utf8')) as ReceiptSheet;

/** Dasselbe Probe-Logo, mit dem die Goldens erzeugt wurden (`scripts/belege-fixtures.mjs`). */
const PROBE = { size: 'M', pixelWidth: 300, pixelHeight: 120 } as const;
function probeLogo(zeichen: number): PrintLogo {
  const { width: breite, height: hoehe } = logoRasterSize(logoDimensions(PROBE, zeichen), zeichen);
  return { ...PROBE, raster: { width: breite, height: hoehe, dots: new Uint8Array(breite * hoehe) } };
}

const xmlText = (s: string): string =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const htmlText = (s: string): string =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');

/** Was der ePOS-Strom in dieser Reihenfolge setzt -- in der Sprache des Blatts. */
type Gesetzt =
  | { art: 'line'; text: string; fett: boolean }
  | { art: 'leer' }
  | { art: 'logo' }
  | { art: 'qr'; nutzlast: string; breite: number };

function eposFolge(xml: string): Gesetzt[] {
  const folge: Gesetzt[] = [];
  const muster = /<text( em="true")?>([^<]*)&#10;<\/text>|<feed line="1"\/>|<image\b[^>]*>[^<]*<\/image>|<symbol\b[^>]*\bwidth="(\d+)"[^>]*>([^<]*)<\/symbol>/g;
  for (const m of xml.matchAll(muster)) {
    if (m[0].startsWith('<text')) folge.push({ art: 'line', text: xmlText(m[2]!), fett: m[1] !== undefined });
    else if (m[0].startsWith('<feed')) folge.push({ art: 'leer' });
    else if (m[0].startsWith('<image')) folge.push({ art: 'logo' });
    else folge.push({ art: 'qr', nutzlast: xmlText(m[4]!), breite: Number(m[3]) });
  }
  return folge;
}

test('Blatt-Zeichner: alle Golden-Belege liegen vor', () => {
  assert.equal(namen.length, 40);
});

for (const name of namen) {
  test(`Blatt-Zeichner ${name}: ePOS setzt Zeile fuer Zeile das Golden-Blatt (32 und 48 Zeichen)`, () => {
    const layout = layoutVon(name);
    for (const zeichen of [32, 48] as const) {
      const soll = goldenBlatt(name, zeichen);
      const { xml, qrError: qrFehler } = eposPrintXmlResult(layout, { charsPerLine: zeichen, logo: probeLogo(zeichen), brandMark: true, cut: false });
      assert.equal(qrFehler, null, `${name}/${zeichen}: QR fiel aus`);
      const ist = eposFolge(xml);
      assert.equal(ist.length, soll.blocks.length, `${name}/${zeichen}: Anzahl der gesetzten Bloecke`);
      // Firmenlogo UND Marke sind je ein <image>-Befehl -- die Zuordnung, welches
      // welches ist, uebernimmt die Reihenfolge weiter unten (Blockart aus dem Golden).
      const bildBloecke = soll.blocks.filter((b) => b.kind === 'logo' || b.kind === 'brandMark').length;
      assert.equal(xml.split('<image').length - 1, bildBloecke, `${name}/${zeichen}: Anzahl der Bilder`);
      const papier = paperSizeForChars(zeichen, layout.paperSize);
      soll.blocks.forEach((b, i) => {
        const g = ist[i]!;
        const wo = `${name}/${zeichen} Block ${i}`;
        switch (b.kind) {
          case 'line':
            // Jede Zeile ist genau so breit wie das Raster; eine Leerzeile traegt nur Leerzeichen --
            // sonst stuende am Schirm etwas, wo der Drucker nur Papier vorschiebt.
            assert.equal(b.text.length, zeichen, `${wo}: Zeilenbreite`);
            if (b.blank) {
              assert.equal(b.text, ' '.repeat(zeichen), `${wo}: Leerzeile mit Inhalt`);
              assert.deepEqual(g, { art: 'leer' }, wo);
            } else {
              assert.deepEqual(g, { art: 'line', text: b.text, fett: b.bold }, wo);
            }
            break;
          case 'logo':
            assert.deepEqual(g, { art: 'logo' }, wo);
            break;
          case 'brandMark':
            // Der Parser unterscheidet Bildbefehle nicht nach Inhalt -- ein
            // <image> ist ein <image>, ob Firmenlogo oder Marke.
            assert.deepEqual(g, { art: 'logo' }, wo);
            break;
          case 'qr': {
            assert.equal(g.art, 'qr', wo);
            if (g.art !== 'qr') break;
            assert.equal(g.nutzlast, b.payload, wo);
            // Der Kasten am Blatt ist die gedruckte Breite samt Ruhezone: Modulgroesse am Epson * (Module + 8) / Kopfbreite.
            if (b.payload !== '') {
              const module = qrSizingFor({ payload: b.payload, paperWidthDots: QR_PRINT_WIDTH_DOTS[papier] }).modules;
              assert.equal(((module + 2 * QR_QUIET_ZONE_MODULES) * g.breite) / QR_PRINT_WIDTH_DOTS[papier], b.widthFraction, `${wo}: QR-Anteil`);
            }
            break;
          }
        }
      });
    }
  });

  test(`Blatt-Zeichner ${name}: React zeigt Zeile fuer Zeile das Golden-Blatt (32 und 48 Zeichen)`, () => {
    for (const zeichen of [32, 48] as const) {
      const soll = goldenBlatt(name, zeichen);
      const html = renderToStaticMarkup(<ReceiptSheetLines sheet={soll} />);
      const zeilen = Array.from(html.matchAll(/<div class="keck-blatt-zeile"[^>]*>([^<]*)<\/div>/g), (m) => htmlText(m[1]!));
      const texte = soll.blocks.filter((b) => b.kind === 'line').map((b) => (b as { text: string }).text);
      assert.deepEqual(zeilen, texte, `${name}/${zeichen}`);
      assert.equal(html.split('keck-blatt-logo').length - 1, soll.blocks.filter((b) => b.kind === 'logo').length, `${name}/${zeichen}: Logo-Block`);
    }
  });
}
