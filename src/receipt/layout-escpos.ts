import {
  createEscPosDocument,
  escPosBytes,
  escPosCut,
  escPosFeed,
  escPosPrintableText,
  escPosQrCode,
  escPosQrRaster,
  escPosRasterImage,
  escPosReset,
  escPosText,
  type EscPosOptions,
  type EscPosQrOptions,
  type PosCodeTable,
  type PosCutMode,
  type PosPaperSize,
  type QrCorrection,
  type QrMatrix,
  type QrModuleSize,
  type QrSize,
  type RasterImage,
  QR_PRINT_WIDTH_DOTS,
  qrSizingFor,
  qrFitsInVersion,
} from '../printing/index.js';
import type { ReceiptLayout } from './layout.js';
import { receiptSheet, logoRasterSize, type ReceiptSheet, type ReceiptSheetOptions, type SheetLogoSize, type LogoDimensions } from './blatt.js';
import { CHARS_PER_PAPER_SIZE } from './grid.js';
import { brandMarkImage } from './marke.js';

/**
 * Bruecke vom Layout-Modell zu ESC/POS-Bytes — der Bondrucker-Ausgabeweg.
 *
 * Hier, und nur hier, wird der Belegtext **druckbar gemacht**
 * ([escPosPrintableText]): Bondrucker sprechen eine Ein-Byte-Codepage, ein
 * „€" oder ein Emoji im Artikelnamen laesst die Kodierung werfen und den
 * gesamten Ausdruck ausfallen. Das Layout selbst fuehrt weiterhin echten Text
 * — auf dem Bildschirm soll „€" stehen und nicht „EUR".
 *
 * Ausgenommen ist der QR-Inhalt: er ist maschinenlesbar (RKSV) und wird
 * unveraendert uebergeben. Eine Zeichenersetzung machte den Code ungueltig;
 * ein unerwartetes Zeichen darin soll darum auffallen und nicht still
 * verfaelscht werden.
 */

/**
 * Wie der Beleg-QR auf das Papier kommt — Zwilling von `QrPrintMode`
 * (kasseneck_api/lib/enums/qr_print_mode.dart).
 *
 * - `native`      — der Druckbefehl `GS ( k`; der Drucker zeichnet selbst.
 *                   Ohne Modellbefehl, also byteidentisch zum Bestand.
 * - `nativeModel1` — derselbe Befehl mit ausdruecklicher Wahl von **Modell 1**
 *                   (`GS ( k 04 00 31 41 31 00`). Fuer guenstige Geraete, die
 *                   nur diesen aelteren Symboltyp beherrschen; belegt ist
 *                   eines, das bei Modell 2 unter dem Code eine "0" ausgibt.
 * - `imageRaster` — der QR als Rasterbild. Braucht ein Raster vom Aufrufer
 *                   (`qrMatrix`), weil dieses Paket keine QR-Codes rechnet.
 */
export type QrPrintMode = 'native' | 'nativeModel1' | 'imageRaster';

/** Firmenlogo fuer den Druck: Stufe, Pixelmass des Originals und das fertige Rasterbild (`rasterizeLogo`). */
export interface PrintLogo {
  size: SheetLogoSize;
  pixelWidth: number;
  pixelHeight: number;
  raster: RasterImage;
}

/** Das Rasterbild muss genau so gross sein, wie das Blatt das Logo setzt -- sonst stuende am Bon ein anderes Logo als am Schirm. */
export function assertLogoRaster(logo: PrintLogo, dimensions: LogoDimensions, chars: number): void {
  const soll = logoRasterSize(dimensions, chars);
  if (logo.raster.width !== soll.width || logo.raster.height !== soll.height) {
    throw new Error(`Logo-Raster ${logo.raster.width}x${logo.raster.height} passt nicht zum Blatt (${soll.width}x${soll.height})`);
  }
}

/**
 * Baut das Blatt fuer einen Druckweg (ESC/POS, ePOS) an EINER Stelle: die
 * Zuordnung `PrintLogo` -> `SheetLogo` und die Groessenpruefung des mitgebrachten
 * Rasterbilds teilen sich beide Wege -- ohne das muesste eine Aenderung daran an
 * zwei Stellen nachgezogen werden. Wirft VOR jeder Ausgabe (also bevor der
 * Aufrufer auch nur ein Byte/Zeichen geschrieben hat), wenn das Rasterbild nicht
 * zur Logo-Stufe passt.
 */
export function blattFuerDruck(
  layout: ReceiptLayout,
  optionen: { zeichen: number; logo?: PrintLogo | null; marke?: boolean; qrGroesse: QrModuleSize },
): ReceiptSheet {
  const blattOptionen: ReceiptSheetOptions = {
    charsPerLine: optionen.zeichen,
    brandMark: optionen.marke === true,
    qrModuleSize: optionen.qrGroesse,
  };
  if (optionen.logo) blattOptionen.logo = { size: optionen.logo.size, pixelWidth: optionen.logo.pixelWidth, pixelHeight: optionen.logo.pixelHeight };
  const blatt = receiptSheet(layout, blattOptionen);
  const logoBlock = blatt.blocks.find((b) => b.kind === 'logo');
  if (optionen.logo && logoBlock && logoBlock.kind === 'logo') assertLogoRaster(optionen.logo, logoBlock, blatt.charsPerLine);
  return blatt;
}

export interface EscPosLayoutOptions {
  /** Papierbreite; Vorgabe ist die des Layouts (dessen Spaltenbreiten daran haengen). */
  paperSize?: PosPaperSize;
  /** Codepage des Druckers, Vorgabe `CP1252`; `null` laesst die des Geraets stehen. */
  codeTable?: PosCodeTable | null;
  /** Papierschnitt am Ende: `true` (voll), `'partial'` oder `false`. Vorgabe `true`. */
  cut?: boolean | PosCutMode;
  /**
   * Feste Modulgroesse des QR-Codes. Gesetzt schaltet sie die Rechnung ab —
   * dann passt der Aufrufer selbst auf, dass das Symbol aufs Papier geht.
   */
  qrSize?: QrSize;
  /** Fehlerkorrekturstufe des QR-Codes; Vorgabe `M` (wie ePOS, Bildweg und Blatt). */
  qrCorrection?: QrCorrection;
  /** Deckel fuer die gerechnete Modulgroesse; Vorgabe `auto` (hoechstens 6 Punkte je Modul). */
  qrModuleSize?: QrModuleSize;
  /** Druckweg des QR; Vorgabe `native` (der Bestandsweg). */
  qrMode?: QrPrintMode;
  /**
   * Raster fuer den Bildweg — ohne das gibt es keinen Notausgang.
   *
   * Dieses Paket rechnet keine QR-Codes und verarbeitet keine Bilder (siehe
   * Kopf von `layout.ts`); der Aufrufer bringt das fertige Raster mit, etwa
   * aus der QR-Bibliothek, die er ohnehin fuer den Bildschirm benutzt.
   */
  qrMatrix?: (payload: string) => QrMatrix;
  /** Firmenlogo; ohne Angabe kein Logo (Bestand). */
  logo?: PrintLogo | null;
  /** Das Kasseneck-Logo am Ende (Konto-Flag `kreiseck_logo`). */
  brandMark?: boolean;
}

/**
 * Der Bytestrom **samt** dem, was dem QR unterwegs zugestossen ist.
 *
 * Zwilling von `KeckPrintResult`: `qrError` heisst "Beleg ohne QR,
 * nachdrucken oder elektronisch ausgeben", `qrFallback` heisst "gedruckt,
 * aber der eingestellte Weg taugt fuer dieses Geraet nicht" — das eine gehoert
 * dem Kunden gesagt, das andere dem Chef.
 */
export interface EscPosLayoutResult {
  bytes: Uint8Array;
  qrError: string | null;
  qrFallback: string | null;
}

/**
 * Druckbar gemachtes Layout: Texte durch [escPosPrintableText] (Codepage,
 * "EUR" statt "€", Striche), damit das Raster mit den Zeichen rechnet, die
 * wirklich aufs Papier gehen. Der QR-Inhalt bleibt unveraendert.
 */
function druckbaresLayout(layout: ReceiptLayout): ReceiptLayout {
  return {
    ...layout,
    lines: layout.lines.map((z) => {
      switch (z.kind) {
        case 'text': return { ...z, text: escPosPrintableText(z.text) };
        case 'banner': return { ...z, text: escPosPrintableText(z.text) };
        case 'columns': return { ...z, columns: z.columns.map((c) => ({ ...c, text: escPosPrintableText(c.text) })) };
        case 'rule': return { ...z, char: escPosPrintableText(z.char) || '-' };
        default: return z;
      }
    }),
  };
}

/**
 * Bytes fuer den Bondrucker -- **aus dem Zeichenraster** ([renderReceiptGrid]):
 * jede Rasterzeile geht als fertige, exakt N Zeichen breite Textzeile raus.
 * Keine eigene Spaltenrechnung, keine `ESC $`-Positionierung: was das Raster
 * zeigt, druckt der Drucker (Monospace, Font A: 32/48 Zeichen).
 */
export function escPosLayoutBytes(layout: ReceiptLayout, options: EscPosLayoutOptions = {}): Uint8Array {
  return escPosLayoutResult(layout, options).bytes;
}

/**
 * Wie [escPosLayoutBytes], gibt aber zusaetzlich zurueck, was dem QR
 * zugestossen ist. Die Bytes sind dieselben; wer die Meldungen braucht, nimmt
 * diesen Weg.
 */
export function escPosLayoutResult(
  layout: ReceiptLayout,
  options: EscPosLayoutOptions = {},
): EscPosLayoutResult {
  const paperSize = options.paperSize ?? layout.paperSize;
  const dokumentOptionen: EscPosOptions = { paperSize };
  if (options.codeTable !== undefined) {
    dokumentOptionen.codeTable = options.codeTable;
  }
  const doc = createEscPosDocument(dokumentOptionen);
  escPosReset(doc);

  const modus: QrPrintMode = options.qrMode ?? 'native';
  const qrOptionen: EscPosQrOptions = { align: 'center' };
  if (options.qrSize !== undefined) qrOptionen.size = options.qrSize;
  if (options.qrCorrection !== undefined) qrOptionen.correction = options.qrCorrection;
  if (options.qrModuleSize !== undefined) qrOptionen.moduleSize = options.qrModuleSize;
  if (modus === 'nativeModel1') qrOptionen.model1 = true;
  if (modus === 'imageRaster' && options.qrMatrix === undefined) {
    throw new Error("qrModus 'imageRaster' braucht ein qrMatrix -- dieses Paket rastert nicht selbst");
  }
  const rasterOptionen: Parameters<typeof escPosQrRaster>[2] = { align: 'center' };
  if (options.qrModuleSize !== undefined) rasterOptionen.moduleSize = options.qrModuleSize;

  /**
   * Eine QR-Zeile des Rasters. Hier sitzt der **Notausgang**: passt das Symbol
   * nativ auch mit der Ausnahmegroesse nicht aufs Papier, druckt der Drucker
   * es GAR NICHT -- er schneidet nicht ab, er laesst weg. Ein Pflichtbeleg
   * ohne QR ist der schlechteste aller Ausgaenge, also geht der QR dann als
   * Bild hinaus, und der Aufrufer erfaehrt es ueber `qrFallback`.
   *
   * Ohne `qrMatrix` gibt es diesen Weg nicht -- dann bleibt nur die Meldung
   * `qrError` aus `escPosQrCode`, und der Beleg geht ohne QR hinaus.
   */
  const qrZeile = (nutzlast: string): void => {
    // Ein Inhalt, der in keine QR-Version passt, laesst sich weder als Befehl
    // noch als Bild drucken -- beide Wege wuerfen. Der Beleg geht ohne QR
    // hinaus und sagt es ueber `qrError`, wie das Blatt (Anteil 0).
    if (nutzlast !== '' && !qrFitsInVersion(nutzlast)) {
      doc.qrError = 'QR-Inhalt passt in keine QR-Version -- Beleg ohne QR';
      return;
    }
    const raster = options.qrMatrix;
    if (nutzlast !== '' && raster !== undefined) {
      if (modus === 'imageRaster') {
        escPosQrRaster(doc, raster(nutzlast), rasterOptionen);
        return;
      }
      // Feste `qrSize` heisst: der Aufrufer weiss, was er tut -- dann wird
      // weder gerechnet noch ausgewichen.
      if (options.qrSize === undefined) {
        const mass = qrSizingFor({
          payload: nutzlast,
          paperWidthDots: QR_PRINT_WIDTH_DOTS[paperSize],
          moduleSize: options.qrModuleSize ?? 'auto',
        });
        if (!mass.fits) {
          doc.qrFallback =
            `QR mit ${mass.modules} Modulen passt nativ nicht auf ` +
            `${paperSize === 'mm58' ? 58 : 80} mm (${QR_PRINT_WIDTH_DOTS[paperSize]} Punkte) ` +
            `-- als Bild gedruckt`;
          escPosQrRaster(doc, raster(nutzlast), rasterOptionen);
          return;
        }
      }
    }
    escPosQrCode(doc, nutzlast, qrOptionen);
  };

  // `blattFuerDruck` prueft das Logo-Raster bereits VOR der Rueckgabe -- die
  // Schleife unten schreibt darum nie ein Byte auf ein falsch grosses Logo.
  const blatt = blattFuerDruck(druckbaresLayout(layout), {
    zeichen: CHARS_PER_PAPER_SIZE[paperSize],
    logo: options.logo,
    marke: options.brandMark,
    qrGroesse: options.qrModuleSize ?? 'auto',
  });
  for (const block of blatt.blocks) {
    switch (block.kind) {
      case 'qr':
        qrZeile(block.payload);
        break;
      case 'logo':
        if (options.logo) escPosRasterImage(doc, options.logo.raster, { align: 'center' });
        break;
      case 'brandMark':
        escPosRasterImage(doc, brandMarkImage(paperSize), { align: 'center' });
        break;
      case 'line':
        if (block.blank) escPosFeed(doc, 1);
        else escPosText(doc, block.text.trimEnd(), { styles: { align: 'left', bold: block.bold } });
        break;
    }
  }

  if (options.cut !== false) {
    escPosCut(doc, options.cut === 'partial' ? 'partial' : 'full');
  }
  return { bytes: escPosBytes(doc), qrError: doc.qrError, qrFallback: doc.qrFallback };
}
