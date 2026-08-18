import type { ReceiptLayout } from './layout.js';
import type { PosPaperSize } from '../printing/escpos.js';
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

// ---------------------------------------------------------- ePOS direkt per IP

/**
 * Epson-Drucker mit ePOS-Print direkt aus dem Browser ansprechen (ohne
 * Server-Umweg): POST an `https://<ip>/cgi-bin/epos/service.cgi`. Der Drucker
 * antwortet mit CORS- und Private-Network-Headern (am TM-T20 nachgemessen);
 * sein selbstsigniertes Zertifikat muss der Browser einmal akzeptiert haben.
 * Modelle ohne Server Direct Print (TM-T20 & Co.) drucken so trotzdem aus
 * Kasse, Panel und Labor.
 */
export interface EposDirectOptions {
  /** IPv4/Hostname des Druckers im lokalen Netz. */
  ip: string;
  /** ePOS Device ID (Druckermenue), Vorgabe `local_printer`. */
  devid?: string;
  /** Papier des Druckers -- bestimmt das Raster; Vorgabe: das des Layouts. */
  papier?: PosPaperSize;
  timeoutMs?: number;
}

export interface EposResponse {
  success: boolean;
  /** Epson-Fehlercode (`EPTR_COVER_OPEN`, `EPTR_REC_EMPTY`, ...), leer bei Erfolg; `keine_antwort` bei unlesbarer Antwort. */
  code: string;
  status: string;
}

const EPOS_DEVID_VORGABE = 'local_printer';

export function eposServiceUrl(ip: string, devid: string = EPOS_DEVID_VORGABE, timeoutMs = 10000): string {
  const adresse = ip.trim();
  if (!adresse || !/^[A-Za-z0-9.\-:]+$/.test(adresse)) throw new Error('Drucker-IP fehlt oder ist ungueltig.');
  const geraet = devid.trim() || EPOS_DEVID_VORGABE;
  return `https://${adresse}/cgi-bin/epos/service.cgi?devid=${encodeURIComponent(geraet)}&timeout=${Math.max(1000, Math.floor(timeoutMs))}`;
}

export function eposSoapEnvelope(innerXml: string): string {
  return '<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>' + innerXml + '</s:Body></s:Envelope>';
}

export function eposParseResponse(text: string): EposResponse {
  const m = /<response\b([^>]*)>/.exec(text);
  if (!m) return { success: false, code: 'keine_antwort', status: '' };
  const attr = (n: string): string => new RegExp(`\\b${n}="([^"]*)"`).exec(m[1] ?? '')?.[1] ?? '';
  return { success: attr('success') === 'true', code: attr('code'), status: attr('status') };
}

async function eposDirectSend(innerXml: string, o: EposDirectOptions, fetchFn: typeof fetch): Promise<EposResponse> {
  const url = eposServiceUrl(o.ip, o.devid ?? EPOS_DEVID_VORGABE, o.timeoutMs ?? 10000);
  let antwort: Response;
  try {
    antwort = await fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '""' }, body: eposSoapEnvelope(innerXml) });
  } catch {
    throw new Error(
      `Drucker nicht erreichbar. Einmal https://${o.ip.trim()} im Browser öffnen und das Zertifikat akzeptieren, ` +
        'Zugriff aufs lokale Netz erlauben, ePOS-Print am Drucker auf Enable.',
    );
  }
  if (!antwort.ok) throw new Error(`Drucker antwortet mit HTTP ${antwort.status}.`);
  return eposParseResponse(await antwort.text());
}

/** Beleg direkt drucken; wirft bei Netz-/Zertifikatsproblemen, sonst die Drucker-Antwort. */
export function eposDirectPrint(layout: ReceiptLayout, o: EposDirectOptions, fetchFn: typeof fetch = fetch): Promise<EposResponse> {
  const papier = o.papier ?? layout.paperSize;
  return eposDirectSend(eposPrintXml({ ...layout, paperSize: papier }, { zeichen: ZEICHEN_JE_PAPIER[papier] }), o, fetchFn);
}

/** Verbindungstest: leeres Dokument, druckt nichts, liefert den Druckerstatus. */
export function eposDirectStatus(o: EposDirectOptions, fetchFn: typeof fetch = fetch): Promise<EposResponse> {
  return eposDirectSend(`<epos-print xmlns="${NS}"/>`, o, fetchFn);
}
