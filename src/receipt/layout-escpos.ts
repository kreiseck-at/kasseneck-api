import {
  createEscPosDocument,
  escPosBytes,
  escPosCut,
  escPosFeed,
  escPosPrintableText,
  escPosQrCode,
  escPosQrRaster,
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
  QR_DRUCK_PUNKTE,
  qrGroesseFuer,
} from '../printing/index.js';
import type { ReceiptLayout } from './layout.js';
import { renderReceiptGrid, ZEICHEN_JE_PAPIER } from './grid.js';

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
  /** Fehlerkorrekturstufe des QR-Codes. */
  qrCorrection?: QrCorrection;
  /** Deckel fuer die gerechnete Modulgroesse; Vorgabe `auto`. */
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

  const grid = renderReceiptGrid(druckbaresLayout(layout), { zeichen: ZEICHEN_JE_PAPIER[paperSize] });
  for (const zeile of grid.lines) {
    switch (zeile.kind) {
      case 'space':
        escPosFeed(doc, 1);
        break;
      case 'qr':
        qrZeile(zeile.qr ?? '');
        break;
      case 'banner': {
        // Belegart/Warnung: fett zwischen zwei Volllinien — derselbe Rahmen-
        // Stil wie im Beleg-Viewer und im PDF (frueher druckte der Bon invers
        // weiss-auf-schwarz und sah damit anders aus als jede Anzeige).
        const rahmen = '='.repeat(ZEICHEN_JE_PAPIER[paperSize]);
        escPosText(doc, rahmen, { styles: { align: 'left', bold: true } });
        escPosText(doc, zeile.text.trimEnd(), { styles: { align: 'left', bold: true, height: 2 } });
        escPosText(doc, rahmen, { styles: { align: 'left', bold: true } });
        break;
      }
      default:
        escPosText(doc, zeile.text.trimEnd(), { styles: { align: 'left', bold: zeile.bold } });
        break;
    }
  }

  if (options.cut !== false) {
    escPosCut(doc, options.cut === 'partial' ? 'partial' : 'full');
  }
  return { bytes: escPosBytes(doc), qrFehler: doc.qrFehler, qrAusweich: doc.qrAusweich };
}
