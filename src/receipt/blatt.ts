import type { PosPaperSize } from '../printing/escpos.js';
import {
  QR_PRINT_WIDTH_DOTS,
  QR_QUIET_ZONE_MODULES,
  qrSizingFor,
  qrFitsInVersion,
  qrRasterDots,
  type QrModuleSize,
} from '../printing/index.js';
import type { ReceiptLayout } from './layout.js';
import { renderReceiptGrid, CHARS_PER_PAPER_SIZE, type GridLine } from './grid.js';
import { BRAND_MARK_RASTERS } from './marke-daten.js';

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

export type SheetLogoSize = 'S' | 'M' | 'L' | 'XL';

/** Kasten je Stufe: Anteil der Blattbreite und Hoehe in Zeilen (Werte der Web-Kasse). */
export const SHEET_LOGO_SIZES: Readonly<Record<SheetLogoSize, { readonly widthFraction: number; readonly heightLines: number }>> = {
  S: { widthFraction: 0.42, heightLines: 5 },
  M: { widthFraction: 0.62, heightLines: 8 },
  L: { widthFraction: 0.8, heightLines: 12 },
  XL: { widthFraction: 0.94, heightLines: 16 },
};

export const DOTS_PER_CHAR = 12;
export const DOTS_PER_LINE = 24;

export interface SheetLogo {
  size: SheetLogoSize;
  /** Pixelmass des Originalbilds -- ohne das laesst sich nicht einpassen. */
  pixelWidth: number;
  pixelHeight: number;
}

export interface LogoDimensions {
  /** Anteil der Blattbreite (0..1). */
  widthFraction: number;
  /** Hoehe in Zeilen (nicht ganzzahlig). */
  heightLines: number;
}

export type SheetBlock =
  | { readonly kind: 'line'; readonly text: string; readonly bold: boolean; readonly blank: boolean }
  | { readonly kind: 'logo'; readonly widthFraction: number; readonly heightLines: number }
  | { readonly kind: 'qr'; readonly payload: string; readonly widthFraction: number }
  | { readonly kind: 'brandMark'; readonly width: number; readonly height: number };

export interface ReceiptSheet {
  readonly charsPerLine: number;
  readonly blocks: readonly SheetBlock[];
}

export interface ReceiptSheetOptions {
  /** Zeichen je Zeile; Vorgabe nach `layout.paperSize` (32/48). */
  charsPerLine?: number;
  /** Firmenlogo; ohne Angabe kein Logo-Block. */
  logo?: SheetLogo | null;
  /** Das Kasseneck-Logo am Ende (Konto-Flag `kreiseck_logo`). */
  brandMark?: boolean;
  /** Geraete-Einstellung fuer die QR-Modulgroesse; Vorgabe `auto` (hoechstens 6 Punkte je Modul) — wie die Druckwege. */
  qrModuleSize?: QrModuleSize;
}

/**
 * 32 Zeichen sind 58 mm, 48 sind 80 mm; andere Breiten behalten das Papier des
 * Layouts. Der QR-Anteil (`qrSheetWidthFraction`) wird dann fuer die Kopfbreite
 * DIESES Papiers gerechnet, nicht fuer die gewaehlte Zeichenzahl.
 */
export function paperSizeForChars(chars: number, fallback: PosPaperSize): PosPaperSize {
  if (chars === CHARS_PER_PAPER_SIZE.mm58) return 'mm58';
  if (chars === CHARS_PER_PAPER_SIZE.mm80) return 'mm80';
  return fallback;
}

/**
 * Obergrenze der Logo-Pixel, die der Bildschirm noch anzeigen darf -- exakt
 * dieselbe Grenze wie im Druck-Kit (`LOGO_MAX_PIXELS` in `druck-logo.ts`):
 * Bon und ePOS lehnen ein Logo ueber 4096x4096px schon beim Rastern ab (ein
 * grosses Bild blockiert das Geraet). Ohne diese Grenze wuerde der
 * Bildschirm ein Logo zeigen, das der Bon nie druckt -- Bildschirm und
 * Papier waeren sich uneins, genau das soll das Beleg-Blatt verhindern.
 */
export const LOGO_MAX_PIXELS = 4096;

/** Reine Pruefung, ob ein Logo dieser Pixelmasse noch angezeigt/gedruckt werden darf. */
export function isLogoPixelSizeAllowed(width: number, height: number): boolean {
  return width > 0 && height > 0 && width <= LOGO_MAX_PIXELS && height <= LOGO_MAX_PIXELS;
}

/**
 * Das Logo in den Kasten seiner Stufe einpassen -- **nie hochrechnen**: ein
 * Bildpixel wird hoechstens ein Druckpunkt. Ein kleines Logo bleibt klein,
 * statt am Bon verwaschen zu werden (so hielten es PDF und Web-Kasse schon).
 */
export function logoDimensions(logo: SheetLogo, chars: number): LogoDimensions {
  if (!(logo.pixelWidth > 0) || !(logo.pixelHeight > 0)) throw new Error('Logo ohne Pixelmass');
  const stufe = SHEET_LOGO_SIZES[logo.size];
  if (stufe === undefined) throw new Error(`Unbekannte Logo-Stufe: ${String(logo.size)}`);
  const blattPunkte = chars * DOTS_PER_CHAR;
  const faktor = Math.min((stufe.widthFraction * blattPunkte) / logo.pixelWidth, (stufe.heightLines * DOTS_PER_LINE) / logo.pixelHeight, 1);
  return {
    widthFraction: (logo.pixelWidth * faktor) / blattPunkte,
    heightLines: (logo.pixelHeight * faktor) / DOTS_PER_LINE,
  };
}

/** Das Mass in ganzen Druckpunkten -- so gross muss das Rasterbild fuer den Bon sein. */
export function logoRasterSize(dimensions: LogoDimensions, chars: number): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round(dimensions.widthFraction * chars * DOTS_PER_CHAR)),
    height: Math.max(1, Math.round(dimensions.heightLines * DOTS_PER_LINE)),
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
export function qrSheetWidthFraction(payload: string, paperSize: PosPaperSize, size: QrModuleSize = 'auto'): number {
  if (payload === '') return 0;
  // Ein Inhalt, der in keine QR-Version passt (Fehlerkorrektur M, hoechstens
  // 2331 Byte), wuerde hier `qrSizingFor` -> `qrModuleCount` zum Werfen
  // bringen -- und riss damit jeden Zeichner mit, der das Blatt baut
  // (Bildschirm, Bon, PDF). 0, wie bei leerer Nutzlast: der Beleg steht ohne
  // QR, statt gar nicht zu stehen. `qrModuleCount` selbst wirft weiter -- wer
  // es ausserhalb des Blatts aufruft, soll den Fehler sehen.
  if (!qrFitsInVersion(payload)) return 0;
  const papierPunkte = QR_PRINT_WIDTH_DOTS[paperSize];
  const mass = qrSizingFor({ payload: payload, paperWidthDots: papierPunkte, moduleSize: size });
  if (mass.fits) return mass.widthDots / papierPunkte;
  return ((mass.modules + 2 * QR_QUIET_ZONE_MODULES) * qrRasterDots(paperSize, mass.modules, { moduleSize: size })) / papierPunkte;
}

export function receiptSheet(layout: ReceiptLayout, options: ReceiptSheetOptions = {}): ReceiptSheet {
  const grid = renderReceiptGrid(layout, options.charsPerLine === undefined ? {} : { charsPerLine: options.charsPerLine });
  const zeichen = grid.charsPerLine;
  const papier = paperSizeForChars(zeichen, layout.paperSize);
  const qrGroesse = options.qrModuleSize ?? 'auto';
  const leerzeile: SheetBlock = { kind: 'line', text: ' '.repeat(zeichen), bold: false, blank: true };
  const block = (z: GridLine): SheetBlock =>
    z.kind === 'qr'
      ? { kind: 'qr', payload: z.qr ?? '', widthFraction: qrSheetWidthFraction(z.qr ?? '', papier, qrGroesse) }
      : { kind: 'line', text: z.text, bold: z.bold, blank: z.kind === 'space' };

  const bloecke: SheetBlock[] = [];
  let i = 0;
  if (options.logo) {
    // Fuehrende Aufdrucke (Testkasse, Testsignatur) bleiben ganz oben: wer den
    // Beleg sieht, sieht zuerst, dass er nicht gilt.
    while (i < grid.lines.length && grid.lines[i]!.kind === 'banner') {
      bloecke.push(block(grid.lines[i]!));
      i += 1;
    }
    // Die Leerzeilen gehoeren zum Vertrag: kein Zeichner kann das Logo an einen
    // Rahmen oder an den Firmennamen kleben.
    if (i > 0) bloecke.push(leerzeile);
    bloecke.push({ kind: 'logo', ...logoDimensions(options.logo, zeichen) });
    bloecke.push(leerzeile);
  }
  for (; i < grid.lines.length; i += 1) bloecke.push(block(grid.lines[i]!));
  if (options.brandMark === true) {
    // Das Raster deckt nur die beiden bekannten Papierbreiten ab (`BRAND_MARK_RASTERS`).
    // Faende sich hier eine dritte, faellt die Marke weg statt ein Raster in
    // falscher Groesse zu drucken -- derselbe Grundsatz wie beim Firmenlogo:
    // eine Marke ist Zierde, der Beleg ist Pflicht.
    const raster = BRAND_MARK_RASTERS[papier];
    if (raster) {
      bloecke.push(leerzeile);
      bloecke.push({ kind: 'brandMark', width: raster.width, height: raster.height });
    }
  }
  return { charsPerLine: zeichen, blocks: bloecke };
}
