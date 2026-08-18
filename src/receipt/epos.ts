import type { ReceiptLayout } from './layout.js';
import { renderReceiptGrid, ZEICHEN_JE_PAPIER } from './grid.js';

/**
 * ePOS-Print XML (Epson TM-Drucker: Server Direct Print, ePOS-Print ueber
 * HTTP) -- **aus dem Zeichenraster**: jede Rasterzeile wird eine <text>-Zeile
 * mit exakt N Zeichen und Zeilenumbruch, Aufdrucke doppelt hoch (Warnungen
 * invers), QR als <symbol>, Leerraum als <feed>, am Ende Schnitt. Kein
 * eigenes Setzen -- was Bildschirm, ESC/POS und PDF zeigen, druckt der Epson
 * Zeile fuer Zeile genauso.
 *
 * Nur der Inhalt <epos-print …>…</epos-print>; die Huelle (PrintRequestInfo
 * fuer Server Direct Print bzw. SOAP fuer ePOS-Print) baut der Aufrufer.
 */
export interface EposPrintXmlOptions {
  /** Zeichen je Zeile; Vorgabe nach `layout.paperSize` (32/48). */
  zeichen?: number;
  /** QR-Modulgroesse (Epson `width` 3..16), Vorgabe 6. */
  qrBreite?: number;
  /** Papierschnitt am Ende, Vorgabe true. */
  cut?: boolean;
}

export function eposXmlEscape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

const NS = 'http://www.epson-pos.com/schemas/2011/03/epos-print';

export function eposPrintXml(layout: ReceiptLayout, options: EposPrintXmlOptions = {}): string {
  const grid = renderReceiptGrid(layout, { zeichen: options.zeichen ?? ZEICHEN_JE_PAPIER[layout.paperSize] });
  const qrBreite = Math.min(16, Math.max(3, Math.floor(options.qrBreite ?? 6)));
  const out: string[] = [];
  out.push(`<epos-print xmlns="${NS}">`);
  out.push('<text lang="de"/>');
  out.push('<text font="font_a"/>');
  out.push('<text align="left"/>');
  out.push('<text width="1" height="1" reverse="false" em="false"/>');
  for (const z of grid.lines) {
    switch (z.kind) {
      case 'space':
        out.push('<feed line="1"/>');
        break;
      case 'qr':
        out.push('<text align="center"/>');
        out.push(`<symbol type="qrcode_model_2" level="level_m" width="${qrBreite}" height="0" size="0">${eposXmlEscape(z.qr ?? '')}</symbol>`);
        out.push('<text align="left"/>');
        break;
      case 'banner':
        out.push(`<text width="1" height="2" reverse="${z.ton === 'warnung' ? 'true' : 'false'}" em="true">${eposXmlEscape(z.text)}&#10;</text>`);
        out.push('<text width="1" height="1" reverse="false" em="false"/>');
        break;
      default:
        if (z.bold) out.push(`<text em="true">${eposXmlEscape(z.text)}&#10;</text>`);
        else out.push(`<text>${eposXmlEscape(z.text)}&#10;</text>`);
        if (z.bold) out.push('<text em="false"/>');
        break;
    }
  }
  if (options.cut !== false) {
    out.push('<feed line="2"/>');
    out.push('<cut type="feed"/>');
  }
  out.push('</epos-print>');
  return out.join('\n');
}
