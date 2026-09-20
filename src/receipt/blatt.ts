import type { PosPaperSize } from '../printing/escpos.js';
import {
  QR_DRUCK_PUNKTE,
  QR_RUHEZONE_MODULE,
  qrGroesseFuer,
  qrPasstInVersion,
  qrRasterPunkte,
  type QrModulGroesse,
} from '../printing/index.js';
import type { ReceiptLayout } from './layout.js';
import { renderReceiptGrid, ZEICHEN_JE_PAPIER, type GridLine } from './grid.js';
import { MARKE_RASTER } from './marke-daten.js';

/**
 * Das Beleg-Blatt: die vollstaendige Folge dessen, was auf dem Papier steht --
 * Rasterzeilen, Firmenlogo, QR und Marke, mit Groessen als Anteil der
 * Blattbreite und in Zeilen.
 *
 * Bis 0.13 setzte jeder Zeichner das Raster selbst zusammen und entschied
 * Logo-Ort, Logo-Groesse, Rahmen und QR-Groesse fuer sich. Heraus kamen
 * fuenf verschiedene Belege (Panel: Logo ueber dem Testkassen-Rahmen, PDF:
 * Logo auf dem Rahmen, App: kein Logo). Hier steht das jetzt einmal.
 *
 * Masseinheit ist der Druckkopf (Epson Font A, 203 dpi): ein Zeichen ist 12
 * Punkte breit, eine Zeile 24 Punkte hoch. Am Bildschirm ist eine Zeile `2ch`,
 * im PDF zwei Zeichenbreiten.
 */

export type LogoStufe = 'S' | 'M' | 'L' | 'XL';

/** Kasten je Stufe: Anteil der Blattbreite und Hoehe in Zeilen (Werte der Web-Kasse). */
export const LOGO_STUFEN: Readonly<Record<LogoStufe, { readonly breiteAnteil: number; readonly hoeheZeilen: number }>> = {
  S: { breiteAnteil: 0.42, hoeheZeilen: 5 },
  M: { breiteAnteil: 0.62, hoeheZeilen: 8 },
  L: { breiteAnteil: 0.8, hoeheZeilen: 12 },
  XL: { breiteAnteil: 0.94, hoeheZeilen: 16 },
};

export const PUNKTE_JE_ZEICHEN = 12;
export const PUNKTE_JE_ZEILE = 24;

export interface BlattLogo {
  stufe: LogoStufe;
  /** Pixelmass des Originalbilds -- ohne das laesst sich nicht einpassen. */
  pxBreite: number;
  pxHoehe: number;
}

export interface LogoMass {
  /** Anteil der Blattbreite (0..1). */
  breiteAnteil: number;
  /** Hoehe in Zeilen (nicht ganzzahlig). */
  hoeheZeilen: number;
}

export type BlattBlock =
  | { readonly art: 'zeile'; readonly text: string; readonly fett: boolean; readonly leer: boolean }
  | { readonly art: 'logo'; readonly breiteAnteil: number; readonly hoeheZeilen: number }
  | { readonly art: 'qr'; readonly nutzlast: string; readonly breiteAnteil: number }
  | { readonly art: 'marke'; readonly breite: number; readonly hoehe: number };

export interface BelegBlatt {
  readonly zeichen: number;
  readonly bloecke: readonly BlattBlock[];
}

export interface BelegBlattOptionen {
  /** Zeichen je Zeile; Vorgabe nach `layout.paperSize` (32/48). */
  zeichen?: number;
  /** Firmenlogo; ohne Angabe kein Logo-Block. */
  logo?: BlattLogo | null;
  /** Das Kasseneck-Logo am Ende (Konto-Flag `kreiseck_logo`). */
  marke?: boolean;
  /** Geraete-Einstellung fuer die QR-Modulgroesse; Vorgabe `auto` (hoechstens 6 Punkte je Modul) — wie die Druckwege. */
  qrGroesse?: QrModulGroesse;
}

/**
 * 32 Zeichen sind 58 mm, 48 sind 80 mm; andere Breiten behalten das Papier des
 * Layouts. Der QR-Anteil (`qrBlattAnteil`) wird dann fuer die Kopfbreite
 * DIESES Papiers gerechnet, nicht fuer die gewaehlte Zeichenzahl.
 */
export function papierFuerZeichen(zeichen: number, vorgabe: PosPaperSize): PosPaperSize {
  if (zeichen === ZEICHEN_JE_PAPIER.mm58) return 'mm58';
  if (zeichen === ZEICHEN_JE_PAPIER.mm80) return 'mm80';
  return vorgabe;
}

/**
 * Obergrenze der Logo-Pixel, die der Bildschirm noch anzeigen darf -- exakt
 * dieselbe Grenze wie im Druck-Kit (`LOGO_PIXEL_MAX` in `druck-logo.ts`):
 * Bon und ePOS lehnen ein Logo ueber 4096x4096px schon beim Rastern ab (ein
 * grosses Bild blockiert das Geraet). Ohne diese Grenze wuerde der
 * Bildschirm ein Logo zeigen, das der Bon nie druckt -- Bildschirm und
 * Papier waeren sich uneins, genau das soll das Beleg-Blatt verhindern.
 */
export const LOGO_PIXEL_MAX = 4096;

/** Reine Pruefung, ob ein Logo dieser Pixelmasse noch angezeigt/gedruckt werden darf. */
export function logoPixelZulaessig(breite: number, hoehe: number): boolean {
  return breite > 0 && hoehe > 0 && breite <= LOGO_PIXEL_MAX && hoehe <= LOGO_PIXEL_MAX;
}

/**
 * Das Logo in den Kasten seiner Stufe einpassen -- **nie hochrechnen**: ein
 * Bildpixel wird hoechstens ein Druckpunkt. Ein kleines Logo bleibt klein,
 * statt am Bon verwaschen zu werden (so hielten es PDF und Web-Kasse schon).
 */
export function logoMass(logo: BlattLogo, zeichen: number): LogoMass {
  if (!(logo.pxBreite > 0) || !(logo.pxHoehe > 0)) throw new Error('Logo ohne Pixelmass');
  const stufe = LOGO_STUFEN[logo.stufe];
  if (stufe === undefined) throw new Error(`Unbekannte Logo-Stufe: ${String(logo.stufe)}`);
  const blattPunkte = zeichen * PUNKTE_JE_ZEICHEN;
  const faktor = Math.min((stufe.breiteAnteil * blattPunkte) / logo.pxBreite, (stufe.hoeheZeilen * PUNKTE_JE_ZEILE) / logo.pxHoehe, 1);
  return {
    breiteAnteil: (logo.pxBreite * faktor) / blattPunkte,
    hoeheZeilen: (logo.pxHoehe * faktor) / PUNKTE_JE_ZEILE,
  };
}

/** Das Mass in ganzen Druckpunkten -- so gross muss das Rasterbild fuer den Bon sein. */
export function logoRasterMass(mass: LogoMass, zeichen: number): { breite: number; hoehe: number } {
  return {
    breite: Math.max(1, Math.round(mass.breiteAnteil * zeichen * PUNKTE_JE_ZEICHEN)),
    hoehe: Math.max(1, Math.round(mass.hoeheZeilen * PUNKTE_JE_ZEILE)),
  };
}

/**
 * Anteil der Blattbreite, den der QR am Drucker einnimmt -- dieselbe Rechnung
 * wie der Druckweg (nativ, sonst der Bildweg). Bildschirm und PDF zeigen den
 * QR in genau dieser Groesse. Leere Nutzlast: 0 (kein Symbol).
 *
 * Der Kasten **schliesst die Ruhezone von 4 Modulen je Seite ein** und setzt
 * Fehlerkorrektur M voraus. Ein Zeichner (`renderQr`, PDF) muss das Symbol
 * darum mit Fehlerkorrektur M und einer Ruhezone von 4 Modulen zeichnen, die
 * den Kasten ganz ausfuellt -- sonst stimmt die Modulgroesse nicht mit dem Bon.
 */
export function qrBlattAnteil(nutzlast: string, papier: PosPaperSize, groesse: QrModulGroesse = 'auto'): number {
  if (nutzlast === '') return 0;
  // Ein Inhalt, der in keine QR-Version passt (Fehlerkorrektur M, hoechstens
  // 2331 Byte), wuerde hier `qrGroesseFuer` -> `qrModulAnzahl` zum Werfen
  // bringen -- und riss damit jeden Zeichner mit, der das Blatt baut
  // (Bildschirm, Bon, PDF). 0, wie bei leerer Nutzlast: der Beleg steht ohne
  // QR, statt gar nicht zu stehen. `qrModulAnzahl` selbst wirft weiter -- wer
  // es ausserhalb des Blatts aufruft, soll den Fehler sehen.
  if (!qrPasstInVersion(nutzlast)) return 0;
  const papierPunkte = QR_DRUCK_PUNKTE[papier];
  const mass = qrGroesseFuer({ nutzlast, papierbreitePunkte: papierPunkte, groesse });
  if (mass.passt) return mass.breitePunkte / papierPunkte;
  return ((mass.module + 2 * QR_RUHEZONE_MODULE) * qrRasterPunkte(papier, mass.module, { groesse })) / papierPunkte;
}

export function belegBlatt(layout: ReceiptLayout, optionen: BelegBlattOptionen = {}): BelegBlatt {
  const grid = renderReceiptGrid(layout, optionen.zeichen === undefined ? {} : { zeichen: optionen.zeichen });
  const zeichen = grid.zeichen;
  const papier = papierFuerZeichen(zeichen, layout.paperSize);
  const qrGroesse = optionen.qrGroesse ?? 'auto';
  const leerzeile: BlattBlock = { art: 'zeile', text: ' '.repeat(zeichen), fett: false, leer: true };
  const block = (z: GridLine): BlattBlock =>
    z.kind === 'qr'
      ? { art: 'qr', nutzlast: z.qr ?? '', breiteAnteil: qrBlattAnteil(z.qr ?? '', papier, qrGroesse) }
      : { art: 'zeile', text: z.text, fett: z.bold, leer: z.kind === 'space' };

  const bloecke: BlattBlock[] = [];
  let i = 0;
  if (optionen.logo) {
    // Fuehrende Aufdrucke (Testkasse, Testsignatur) bleiben ganz oben: wer den
    // Beleg sieht, sieht zuerst, dass er nicht gilt.
    while (i < grid.lines.length && grid.lines[i]!.kind === 'banner') {
      bloecke.push(block(grid.lines[i]!));
      i += 1;
    }
    // Die Leerzeilen gehoeren zum Vertrag: kein Zeichner kann das Logo an einen
    // Rahmen oder an den Firmennamen kleben.
    if (i > 0) bloecke.push(leerzeile);
    bloecke.push({ art: 'logo', ...logoMass(optionen.logo, zeichen) });
    bloecke.push(leerzeile);
  }
  for (; i < grid.lines.length; i += 1) bloecke.push(block(grid.lines[i]!));
  if (optionen.marke === true) {
    // Das Raster deckt nur die beiden bekannten Papierbreiten ab (`MARKE_RASTER`).
    // Faende sich hier eine dritte, faellt die Marke weg statt ein Raster in
    // falscher Groesse zu drucken -- derselbe Grundsatz wie beim Firmenlogo:
    // eine Marke ist Zierde, der Beleg ist Pflicht.
    const raster = MARKE_RASTER[papier];
    if (raster) {
      bloecke.push(leerzeile);
      bloecke.push({ art: 'marke', breite: raster.breite, hoehe: raster.hoehe });
    }
  }
  return { zeichen, bloecke };
}
