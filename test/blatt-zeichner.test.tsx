import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';

import { QR_DRUCK_PUNKTE, QR_RUHEZONE_MODULE, qrGroesseFuer } from '../src/printing/index.js';
import { eposPrintXmlErgebnis, logoMass, logoRasterMass, papierFuerZeichen, type BelegBlatt, type DruckLogo, type ReceiptLayout } from '../src/receipt/index.js';
import { BelegBlattZeilen } from '../src/react/index.js';

/**
 * Jeder Zeichner gegen JEDES Blatt-Golden: der ePOS-Druckweg und die
 * React-Ansicht muessen Zeile fuer Zeile die Folge aus
 * `fixtures/erwartet/<name>.blatt<zeichen>.json` setzen.
 *
 * Die Erwartung ist die Golden-Datei selbst -- `belegBlatt` wird hier bewusst
 * NICHT noch einmal gerechnet. Sonst pruefte der Test nur, dass zwei Aufrufe
 * derselben Funktion uebereinstimmen, und ein Fehler im Blatt fiele an beiden
 * Seiten gleich aus.
 */

// test-dist liegt eine Ebene tiefer (test-dist/test/...): die Fixtures liegen im Repo-Wurzelverzeichnis.
const wurzel = new URL('../../fixtures/', import.meta.url);
const namen = readdirSync(new URL('belege/', wurzel)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();

const layoutVon = (name: string): ReceiptLayout => JSON.parse(readFileSync(new URL(`erwartet/${name}.lines.json`, wurzel), 'utf8')) as ReceiptLayout;
const goldenBlatt = (name: string, zeichen: number): BelegBlatt =>
  JSON.parse(readFileSync(new URL(`erwartet/${name}.blatt${zeichen}.json`, wurzel), 'utf8')) as BelegBlatt;

/** Dasselbe Probe-Logo, mit dem die Goldens erzeugt wurden (`scripts/belege-fixtures.mjs`). */
const PROBE = { stufe: 'M', pxBreite: 300, pxHoehe: 120 } as const;
function probeLogo(zeichen: number): DruckLogo {
  const { breite, hoehe } = logoRasterMass(logoMass(PROBE, zeichen), zeichen);
  return { ...PROBE, raster: { breite, hoehe, punkte: new Uint8Array(breite * hoehe) } };
}

const xmlText = (s: string): string =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const htmlText = (s: string): string =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');

/** Was der ePOS-Strom in dieser Reihenfolge setzt -- in der Sprache des Blatts. */
type Gesetzt =
  | { art: 'zeile'; text: string; fett: boolean }
  | { art: 'leer' }
  | { art: 'logo' }
  | { art: 'qr'; nutzlast: string; breite: number };

function eposFolge(xml: string): Gesetzt[] {
  const folge: Gesetzt[] = [];
  const muster = /<text( em="true")?>([^<]*)&#10;<\/text>|<feed line="1"\/>|<image\b[^>]*>[^<]*<\/image>|<symbol\b[^>]*\bwidth="(\d+)"[^>]*>([^<]*)<\/symbol>/g;
  for (const m of xml.matchAll(muster)) {
    if (m[0].startsWith('<text')) folge.push({ art: 'zeile', text: xmlText(m[2]!), fett: m[1] !== undefined });
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
      const { xml, qrFehler } = eposPrintXmlErgebnis(layout, { zeichen, logo: probeLogo(zeichen), marke: true, cut: false });
      assert.equal(qrFehler, null, `${name}/${zeichen}: QR fiel aus`);
      const ist = eposFolge(xml);
      assert.equal(ist.length, soll.bloecke.length, `${name}/${zeichen}: Anzahl der gesetzten Bloecke`);
      // Firmenlogo UND Marke sind je ein <image>-Befehl -- die Zuordnung, welches
      // welches ist, uebernimmt die Reihenfolge weiter unten (Blockart aus dem Golden).
      const bildBloecke = soll.bloecke.filter((b) => b.art === 'logo' || b.art === 'marke').length;
      assert.equal(xml.split('<image').length - 1, bildBloecke, `${name}/${zeichen}: Anzahl der Bilder`);
      const papier = papierFuerZeichen(zeichen, layout.paperSize);
      soll.bloecke.forEach((b, i) => {
        const g = ist[i]!;
        const wo = `${name}/${zeichen} Block ${i}`;
        switch (b.art) {
          case 'zeile':
            // Jede Zeile ist genau so breit wie das Raster; eine Leerzeile traegt nur Leerzeichen --
            // sonst stuende am Schirm etwas, wo der Drucker nur Papier vorschiebt.
            assert.equal(b.text.length, zeichen, `${wo}: Zeilenbreite`);
            if (b.leer) {
              assert.equal(b.text, ' '.repeat(zeichen), `${wo}: Leerzeile mit Inhalt`);
              assert.deepEqual(g, { art: 'leer' }, wo);
            } else {
              assert.deepEqual(g, { art: 'zeile', text: b.text, fett: b.fett }, wo);
            }
            break;
          case 'logo':
            assert.deepEqual(g, { art: 'logo' }, wo);
            break;
          case 'marke':
            // Der Parser unterscheidet Bildbefehle nicht nach Inhalt -- ein
            // <image> ist ein <image>, ob Firmenlogo oder Marke.
            assert.deepEqual(g, { art: 'logo' }, wo);
            break;
          case 'qr': {
            assert.equal(g.art, 'qr', wo);
            if (g.art !== 'qr') break;
            assert.equal(g.nutzlast, b.nutzlast, wo);
            // Der Kasten am Blatt ist die gedruckte Breite samt Ruhezone: Modulgroesse am Epson * (Module + 8) / Kopfbreite.
            if (b.nutzlast !== '') {
              const module = qrGroesseFuer({ nutzlast: b.nutzlast, papierbreitePunkte: QR_DRUCK_PUNKTE[papier] }).module;
              assert.equal(((module + 2 * QR_RUHEZONE_MODULE) * g.breite) / QR_DRUCK_PUNKTE[papier], b.breiteAnteil, `${wo}: QR-Anteil`);
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
      const html = renderToStaticMarkup(<BelegBlattZeilen blatt={soll} />);
      const zeilen = Array.from(html.matchAll(/<div class="keck-blatt-zeile"[^>]*>([^<]*)<\/div>/g), (m) => htmlText(m[1]!));
      const texte = soll.bloecke.filter((b) => b.art === 'zeile').map((b) => (b as { text: string }).text);
      assert.deepEqual(zeilen, texte, `${name}/${zeichen}`);
      assert.equal(html.split('keck-blatt-logo').length - 1, soll.bloecke.filter((b) => b.art === 'logo').length, `${name}/${zeichen}: Logo-Block`);
    }
  });
}
