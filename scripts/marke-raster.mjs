#!/usr/bin/env node
// Macht aus der Marken-SVG die Daten, die das Paket zur Laufzeit braucht:
// ein 1-Bit-Raster je Druckbreite (fuer den Bondruck) und die Pfade (fuer PDF
// und Bildschirm). Laeuft selten -- nur wenn sich die Marke aendert.
//
//   npm run fixtures:marke -- [pfad/zur/kasseneck-logo.svg]
//   node scripts/marke-raster.mjs [pfad/zur/kasseneck-logo.svg]
//
// Braucht ImageMagick (`magick`) im Pfad. Das ist eine Werkbank-Abhaengigkeit,
// keine des Pakets: das Ergebnis wird committet, zur Laufzeit rastert niemand.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const hierDir = dirname(fileURLToPath(import.meta.url));

// Druckbreiten in Punkten -- am Papier entschieden (352 auf 80 mm, 234 auf
// 58 mm, je 61 % der Druckbreite; siehe
// docs/specs/2026-09-21-marke-einheitlich-design.md, § 2).
const PAPIERE = { mm80: 352, mm58: 234 };

// Harte Schwelle, kein Dithering (Spec § 3.3): ein Flaechenmittel mit
// Fehlerstreuung ist fuer Fotos richtig und fuer eine Wortmarke falsch -- es
// wuerde die Binnenraeume der Buchstaben zusetzen.
const SCHWELLE = 160;

const svgPfad = resolve(process.argv[2] ?? join(hierDir, '../../design/brand/kasseneck-logo.svg'));
const svg = readFileSync(svgPfad, 'utf8');
const svgHash = createHash('sha256').update(svg).digest('hex');

/** Liest ein binaeres PGM (P5), ohne Kommentare in Bilddaten des Erzeugers. */
function pgmLesen(datei) {
  const buf = readFileSync(datei);
  if (buf[0] !== 0x50 || buf[1] !== 0x35) throw new Error(`${datei}: kein binaeres PGM (P5)`);
  let i = 2;
  const werte = [];
  const istLeerraum = (b) => b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d;
  while (werte.length < 3) {
    while (istLeerraum(buf[i])) i += 1;
    if (buf[i] === 0x23) {
      while (buf[i] !== 0x0a) i += 1;
      continue;
    }
    const start = i;
    while (!istLeerraum(buf[i])) i += 1;
    werte.push(Number(buf.subarray(start, i).toString('ascii')));
  }
  i += 1; // das eine Leerraumzeichen nach dem Maxwert
  const [breite, hoehe] = werte;
  const pixel = buf.subarray(i, i + breite * hoehe);
  if (pixel.length !== breite * hoehe) throw new Error(`${datei}: PGM-Daten unvollstaendig`);
  return { breite, hoehe, pixel };
}

/** Rastert die SVG auf die gegebene Breite und packt sie zu MSB-ersten Bits. */
function rastern(breite) {
  const tmp = mkdtempSync(join(tmpdir(), 'marke-raster-'));
  const pgmPfad = join(tmp, 'marke.pgm');
  try {
    execFileSync('magick', [
      '-background', 'white',
      '-density', '600',
      svgPfad,
      '-resize', `${breite}x`,
      '-flatten',
      '-colorspace', 'gray',
      '-depth', '8',
      pgmPfad,
    ]);
    const { breite: gelesenBreite, hoehe, pixel } = pgmLesen(pgmPfad);
    if (gelesenBreite !== breite) {
      throw new Error(`ImageMagick lieferte Breite ${gelesenBreite} statt ${breite}`);
    }
    const byteJeZeile = Math.ceil(breite / 8);
    const bits = Buffer.alloc(byteJeZeile * hoehe);
    for (let y = 0; y < hoehe; y++) {
      for (let x = 0; x < breite; x++) {
        const grau = pixel[y * breite + x];
        if (grau >= SCHWELLE) continue; // hell bleibt 0 (weiss), das Byte ist vorbelegt
        const idx = y * byteJeZeile + (x >> 3);
        bits[idx] |= 0x80 >> (x & 7);
      }
    }
    return { breite, hoehe, bits: bits.toString('base64') };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Zieht viewBox und Pfade (`<path d="…">`) aus der SVG, in Dokumentreihenfolge. */
function pfadeAusSvg(quelle) {
  const viewBoxMatch = quelle.match(/viewBox="([\d.\s-]+)"/);
  if (!viewBoxMatch) throw new Error('SVG ohne viewBox');
  const [, , breite, hoehe] = viewBoxMatch[1].trim().split(/\s+/).map(Number);
  const pfade = [...quelle.matchAll(/<path\b[^>]*\sd="([^"]*)"/g)].map((m) => m[1]);
  if (pfade.length === 0) throw new Error('SVG ohne Pfade');
  return { breite, hoehe, pfade };
}

const mm80 = rastern(PAPIERE.mm80);
const mm58 = rastern(PAPIERE.mm58);
const { breite: pfadBreite, hoehe: pfadHoehe, pfade } = pfadeAusSvg(svg);

const pfadeListe = pfade.map((p) => `    ${JSON.stringify(p)}`).join(',\n');

const ausgabe = `// Erzeugt von scripts/marke-raster.mjs -- nicht von Hand aendern.
// Quelle: kreiseck/design/brand/kasseneck-logo.svg (sha256 ${svgHash})
import type { PosPaperSize } from '../printing/escpos.js';

export interface MarkeRasterDaten {
  readonly breite: number;
  readonly hoehe: number;
  /** Rasterzeilen als Bits, MSB zuerst, je Zeile auf volle Bytes aufgefuellt; base64. */
  readonly bits: string;
}

export const MARKE_RASTER: Readonly<Record<PosPaperSize, MarkeRasterDaten>> = {
  mm80: { breite: ${mm80.breite}, hoehe: ${mm80.hoehe}, bits: ${JSON.stringify(mm80.bits)} },
  mm58: { breite: ${mm58.breite}, hoehe: ${mm58.hoehe}, bits: ${JSON.stringify(mm58.bits)} },
};

/** Die Marke als Pfade (fuer PDF und Bildschirm), im Kasten der Markendatei. */
export const MARKE_PFADE: { readonly breite: number; readonly hoehe: number; readonly pfade: readonly string[] } = {
  breite: ${pfadBreite},
  hoehe: ${pfadHoehe},
  pfade: [
${pfadeListe}
  ],
};
`;

const zielPfad = join(hierDir, '../src/receipt/marke-daten.ts');
writeFileSync(zielPfad, ausgabe);
console.log('geschrieben:', zielPfad);
console.log(`mm80: ${mm80.breite} x ${mm80.hoehe}   mm58: ${mm58.breite} x ${mm58.hoehe}`);
console.log('Pfade:', pfade.length, ' Kasten:', pfadBreite, 'x', pfadHoehe);
