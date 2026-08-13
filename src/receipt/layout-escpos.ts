import {
  createEscPosDocument,
  escPosBytes,
  escPosCut,
  escPosFeed,
  escPosHr,
  escPosPrintableText,
  escPosQrCode,
  escPosReset,
  escPosRow,
  escPosText,
  type EscPosOptions,
  type EscPosQrOptions,
  type PosCodeTable,
  type PosColumn,
  type PosCutMode,
  type PosPaperSize,
  type QrCorrection,
  type QrSize,
} from '../printing/index.js';
import type { ReceiptLayout } from './layout.js';

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

export function escPosLayoutBytes(layout: ReceiptLayout, options: EscPosLayoutOptions = {}): Uint8Array {
  const dokumentOptionen: EscPosOptions = { paperSize: options.paperSize ?? layout.paperSize };
  if (options.codeTable !== undefined) {
    dokumentOptionen.codeTable = options.codeTable;
  }
  const doc = createEscPosDocument(dokumentOptionen);
  escPosReset(doc);

  const qrOptionen: EscPosQrOptions = { align: 'center' };
  if (options.qrSize !== undefined) qrOptionen.size = options.qrSize;
  if (options.qrCorrection !== undefined) qrOptionen.correction = options.qrCorrection;

  for (const zeile of layout.lines) {
    switch (zeile.kind) {
      case 'text':
        escPosText(doc, escPosPrintableText(zeile.text), { styles: { align: zeile.align, bold: zeile.bold } });
        break;
      case 'columns': {
        const spalten: PosColumn[] = zeile.columns.map((spalte) => ({
          text: escPosPrintableText(spalte.text),
          width: spalte.width,
          styles: { align: spalte.align },
        }));
        escPosRow(doc, spalten);
        break;
      }
      case 'rule':
        escPosHr(doc, { ch: escPosPrintableText(zeile.char) || '-' });
        break;
      case 'space':
        escPosFeed(doc, zeile.lines);
        break;
      case 'qr':
        escPosQrCode(doc, zeile.data, qrOptionen);
        break;
    }
  }

  if (options.cut !== false) {
    escPosCut(doc, options.cut === 'partial' ? 'partial' : 'full');
  }
  return escPosBytes(doc);
}
