import {
  createEscPosDocument,
  escPosBytes,
  escPosCut,
  escPosFeed,
  escPosPrintableText,
  escPosQrCode,
  escPosQrRaster,
  escPosRasterBild,
  escPosReset,
  escPosText,
  type EscPosOptions,
  type EscPosQrOptions,
  type PosCodeTable,
  type PosCutMode,
  type PosPaperSize,
  type QrCorrection,
  type QrMatrix,
  type QrModulGroesse,
  type QrSize,
  type RasterBild,
  QR_DRUCK_PUNKTE,
  qrGroesseFuer,
  qrPasstInVersion,
} from '../printing/index.js';
import type { ReceiptLayout } from './layout.js';
import { belegBlatt, logoRasterMass, type BelegBlatt, type BelegBlattOptionen, type LogoStufe, type LogoMass } from './blatt.js';
import { ZEICHEN_JE_PAPIER } from './grid.js';

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

/** Firmenlogo fuer den Druck: Stufe, Pixelmass des Originals und das fertige Rasterbild (`logoRaster`). */
export interface DruckLogo {
  stufe: LogoStufe;
  pxBreite: number;
  pxHoehe: number;
  raster: RasterBild;
}

/** Das Rasterbild muss genau so gross sein, wie das Blatt das Logo setzt -- sonst stuende am Bon ein anderes Logo als am Schirm. */
export function pruefeLogoRaster(logo: DruckLogo, mass: LogoMass, zeichen: number): void {
  const soll = logoRasterMass(mass, zeichen);
  if (logo.raster.breite !== soll.breite || logo.raster.hoehe !== soll.hoehe) {
    throw new Error(`Logo-Raster ${logo.raster.breite}x${logo.raster.hoehe} passt nicht zum Blatt (${soll.breite}x${soll.hoehe})`);
  }
}

/**
 * Baut das Blatt fuer einen Druckweg (ESC/POS, ePOS) an EINER Stelle: die
 * Zuordnung `DruckLogo` -> `BlattLogo` und die Groessenpruefung des mitgebrachten
 * Rasterbilds teilen sich beide Wege -- ohne das muesste eine Aenderung daran an
 * zwei Stellen nachgezogen werden. Wirft VOR jeder Ausgabe (also bevor der
 * Aufrufer auch nur ein Byte/Zeichen geschrieben hat), wenn das Rasterbild nicht
 * zur Logo-Stufe passt.
 */
export function blattFuerDruck(
  layout: ReceiptLayout,
  optionen: { zeichen: number; logo?: DruckLogo | null; marke?: boolean; qrGroesse: QrModulGroesse },
): BelegBlatt {
  const blattOptionen: BelegBlattOptionen = {
    zeichen: optionen.zeichen,
    marke: optionen.marke === true,
    qrGroesse: optionen.qrGroesse,
  };
  if (optionen.logo) blattOptionen.logo = { stufe: optionen.logo.stufe, pxBreite: optionen.logo.pxBreite, pxHoehe: optionen.logo.pxHoehe };
  const blatt = belegBlatt(layout, blattOptionen);
  const logoBlock = blatt.bloecke.find((b) => b.art === 'logo');
  if (optionen.logo && logoBlock && logoBlock.art === 'logo') pruefeLogoRaster(optionen.logo, logoBlock, blatt.zeichen);
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
  qrGroesse?: QrModulGroesse;
  /** Druckweg des QR; Vorgabe `native` (der Bestandsweg). */
  qrModus?: QrPrintMode;
  /**
   * Raster fuer den Bildweg — ohne das gibt es keinen Notausgang.
   *
   * Dieses Paket rechnet keine QR-Codes und verarbeitet keine Bilder (siehe
   * Kopf von `layout.ts`); der Aufrufer bringt das fertige Raster mit, etwa
   * aus der QR-Bibliothek, die er ohnehin fuer den Bildschirm benutzt.
   */
  qrMatrix?: (nutzlast: string) => QrMatrix;
  /** Firmenlogo; ohne Angabe kein Logo (Bestand). */
  logo?: DruckLogo | null;
  /** "erstellt mit Kasseneck" am Ende (Konto-Flag `kreiseck_logo`). */
  marke?: boolean;
}

/**
 * Der Bytestrom **samt** dem, was dem QR unterwegs zugestossen ist.
 *
 * Zwilling von `KeckPrintResult`: `qrFehler` heisst "Beleg ohne QR,
 * nachdrucken oder elektronisch ausgeben", `qrAusweich` heisst "gedruckt,
 * aber der eingestellte Weg taugt fuer dieses Geraet nicht" — das eine gehoert
 * dem Kunden gesagt, das andere dem Chef.
 */
export interface EscPosLayoutErgebnis {
  bytes: Uint8Array;
  qrFehler: string | null;
  qrAusweich: string | null;
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
  return escPosLayoutErgebnis(layout, options).bytes;
}

/**
 * Wie [escPosLayoutBytes], gibt aber zusaetzlich zurueck, was dem QR
 * zugestossen ist. Die Bytes sind dieselben; wer die Meldungen braucht, nimmt
 * diesen Weg.
 */
export function escPosLayoutErgebnis(
  layout: ReceiptLayout,
  options: EscPosLayoutOptions = {},
): EscPosLayoutErgebnis {
  const paperSize = options.paperSize ?? layout.paperSize;
  const dokumentOptionen: EscPosOptions = { paperSize };
  if (options.codeTable !== undefined) {
    dokumentOptionen.codeTable = options.codeTable;
  }
  const doc = createEscPosDocument(dokumentOptionen);
  escPosReset(doc);

  const modus: QrPrintMode = options.qrModus ?? 'native';
  const qrOptionen: EscPosQrOptions = { align: 'center' };
  if (options.qrSize !== undefined) qrOptionen.size = options.qrSize;
  if (options.qrCorrection !== undefined) qrOptionen.correction = options.qrCorrection;
  if (options.qrGroesse !== undefined) qrOptionen.groesse = options.qrGroesse;
  if (modus === 'nativeModel1') qrOptionen.modell1 = true;
  if (modus === 'imageRaster' && options.qrMatrix === undefined) {
    throw new Error("qrModus 'imageRaster' braucht ein qrMatrix -- dieses Paket rastert nicht selbst");
  }
  const rasterOptionen: Parameters<typeof escPosQrRaster>[2] = { align: 'center' };
  if (options.qrGroesse !== undefined) rasterOptionen.groesse = options.qrGroesse;

  /**
   * Eine QR-Zeile des Rasters. Hier sitzt der **Notausgang**: passt das Symbol
   * nativ auch mit der Ausnahmegroesse nicht aufs Papier, druckt der Drucker
   * es GAR NICHT -- er schneidet nicht ab, er laesst weg. Ein Pflichtbeleg
   * ohne QR ist der schlechteste aller Ausgaenge, also geht der QR dann als
   * Bild hinaus, und der Aufrufer erfaehrt es ueber `qrAusweich`.
   *
   * Ohne `qrMatrix` gibt es diesen Weg nicht -- dann bleibt nur die Meldung
   * `qrFehler` aus `escPosQrCode`, und der Beleg geht ohne QR hinaus.
   */
  const qrZeile = (nutzlast: string): void => {
    // Ein Inhalt, der in keine QR-Version passt, laesst sich weder als Befehl
    // noch als Bild drucken -- beide Wege wuerfen. Der Beleg geht ohne QR
    // hinaus und sagt es ueber `qrFehler`, wie das Blatt (Anteil 0).
    if (nutzlast !== '' && !qrPasstInVersion(nutzlast)) {
      doc.qrFehler = 'QR-Inhalt passt in keine QR-Version -- Beleg ohne QR';
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
        const mass = qrGroesseFuer({
          nutzlast,
          papierbreitePunkte: QR_DRUCK_PUNKTE[paperSize],
          groesse: options.qrGroesse ?? 'auto',
        });
        if (!mass.passt) {
          doc.qrAusweich =
            `QR mit ${mass.module} Modulen passt nativ nicht auf ` +
            `${paperSize === 'mm58' ? 58 : 80} mm (${QR_DRUCK_PUNKTE[paperSize]} Punkte) ` +
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
    zeichen: ZEICHEN_JE_PAPIER[paperSize],
    logo: options.logo,
    marke: options.marke,
    qrGroesse: options.qrGroesse ?? 'auto',
  });
  for (const block of blatt.bloecke) {
    switch (block.art) {
      case 'qr':
        qrZeile(block.nutzlast);
        break;
      case 'logo':
        if (options.logo) escPosRasterBild(doc, options.logo.raster, { align: 'center' });
        break;
      case 'zeile':
        if (block.leer) escPosFeed(doc, 1);
        else escPosText(doc, block.text.trimEnd(), { styles: { align: 'left', bold: block.fett } });
        break;
    }
  }

  if (options.cut !== false) {
    escPosCut(doc, options.cut === 'partial' ? 'partial' : 'full');
  }
  return { bytes: escPosBytes(doc), qrFehler: doc.qrFehler, qrAusweich: doc.qrAusweich };
}
