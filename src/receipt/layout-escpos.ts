import {
  createEscPosDocument,
  escPosBytes,
  escPosCut,
  escPosFeed,
  escPosPrintableText,
  escPosQrCode,
  escPosReset,
  escPosText,
  type EscPosOptions,
  type EscPosQrOptions,
  type PosCodeTable,
  type PosCutMode,
  type PosPaperSize,
  type QrCorrection,
  type QrSize,
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

export interface EscPosLayoutOptions {
  /** Papierbreite; Vorgabe ist die des Layouts (dessen Spaltenbreiten daran haengen). */
  paperSize?: PosPaperSize;
  /** Codepage des Druckers, Vorgabe `CP1252`; `null` laesst die des Geraets stehen. */
  codeTable?: PosCodeTable | null;
  /** Papierschnitt am Ende: `true` (voll), `'partial'` oder `false`. Vorgabe `true`. */
  cut?: boolean | PosCutMode;
  /** Modulgroesse des QR-Codes. */
  qrSize?: QrSize;
  /** Fehlerkorrekturstufe des QR-Codes. */
  qrCorrection?: QrCorrection;
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
  const paperSize = options.paperSize ?? layout.paperSize;
  const dokumentOptionen: EscPosOptions = { paperSize };
  if (options.codeTable !== undefined) {
    dokumentOptionen.codeTable = options.codeTable;
  }
  const doc = createEscPosDocument(dokumentOptionen);
  escPosReset(doc);

  const qrOptionen: EscPosQrOptions = { align: 'center' };
  if (options.qrSize !== undefined) qrOptionen.size = options.qrSize;
  if (options.qrCorrection !== undefined) qrOptionen.correction = options.qrCorrection;

  const grid = renderReceiptGrid(druckbaresLayout(layout), { zeichen: ZEICHEN_JE_PAPIER[paperSize] });
  for (const zeile of grid.lines) {
    switch (zeile.kind) {
      case 'space':
        escPosFeed(doc, 1);
        break;
      case 'qr':
        escPosQrCode(doc, zeile.qr ?? '', qrOptionen);
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
  return escPosBytes(doc);
}
