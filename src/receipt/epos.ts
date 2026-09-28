import type { ReceiptLayout } from './layout.js';
import type { PosPaperSize } from '../printing/escpos.js';
import {
  QR_PRINT_WIDTH_DOTS,
  QR_MIN_MODULE_DOTS,
  QR_MODULE_SIZE_CAP,
  qrSizingFor,
  qrFitsInVersion,
  rasterRowsBase64,
  type QrModuleSize,
  type RasterImage,
} from '../printing/index.js';
import { CHARS_PER_PAPER_SIZE } from './grid.js';
import { paperSizeForChars } from './blatt.js';
import { blattFuerDruck, type PrintLogo } from './layout-escpos.js';
import { brandMarkImage } from './marke.js';

/**
 * ePOS-Print XML (Epson TM-Drucker: Server Direct Print, ePOS-Print ueber
 * HTTP) -- **aus dem Zeichenraster**: jede Rasterzeile wird eine <text>-Zeile
 * mit exakt N Zeichen und Zeilenumbruch, Aufdrucke als Rahmen aus
 * Rasterzeilen, QR als <symbol>, Leerraum als <feed>, am Ende Schnitt. Kein
 * eigenes Setzen -- was Bildschirm, ESC/POS und PDF zeigen, druckt der Epson
 * Zeile fuer Zeile genauso.
 *
 * Nur der Inhalt <epos-print …>…</epos-print>; die Huelle (PrintRequestInfo
 * fuer Server Direct Print bzw. SOAP fuer ePOS-Print) baut der Aufrufer.
 */
export interface EposPrintXmlOptions {
  /** Zeichen je Zeile; Vorgabe nach `layout.paperSize` (32/48). */
  charsPerLine?: number;
  /**
   * **Feste** QR-Modulgroesse (Epson `width` 3..16). Gesetzt schaltet sie die
   * Rechnung ab -- dann passt der Aufrufer selbst auf, dass das Symbol samt
   * Ruhezone auf die Rolle geht.
   */
  qrWidth?: number;
  /**
   * Deckel fuer die gerechnete QR-Modulgroesse; Vorgabe `auto` (hoechstens 6
   * Punkte je Modul) -- wie ESC/POS, Blatt und der Flutter-Zwilling.
   *
   * Bis 0.13 stand hier `mittel` (heute `medium`), weil `auto` damals beim ESC/POS-Wert 4
   * deckelte und dieser Weg seit jeher mit 6 druckt. Seit `auto` ueberall 6
   * heisst, ist das derselbe Wert: ohne Wahl kommt kein Byte anders heraus.
   */
  qrModuleSize?: QrModuleSize;
  /** Papierschnitt am Ende, Vorgabe true. */
  cut?: boolean;
  /** Firmenlogo; ohne Angabe kein Logo. */
  logo?: PrintLogo | null;
  /** Das Kasseneck-Logo am Ende (Konto-Flag `kreiseck_logo`). */
  brandMark?: boolean;
}

/**
 * Das XML **samt** dem, was dem QR unterwegs zugestossen ist -- dieselbe
 * Buchfuehrung wie `EscPosLayoutResult` am ESC/POS-Weg.
 */
export interface EposPrintResult {
  xml: string;
  /** Der Beleg ging ohne QR hinaus; das Symbol passt auch mit 3 Punkten nicht. */
  qrError: string | null;
  /** Der QR steht da, aber unter der Mindest-Modulgroesse. */
  qrFallback: string | null;
}

export function eposXmlEscape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Ein Rasterbild als ePOS-`<image>` (einfarbig, Punktmass, Rasterzeilen Base64). */
export function eposImageXml(image: RasterImage): string {
  return `<image width="${image.width}" height="${image.height}" color="color_1" mode="mono">${rasterRowsBase64(image)}</image>`;
}

const NS = 'http://www.epson-pos.com/schemas/2011/03/epos-print';

/** Nur das XML; wer die QR-Meldungen braucht, nimmt [eposPrintXmlResult]. */
export function eposPrintXml(layout: ReceiptLayout, options: EposPrintXmlOptions = {}): string {
  return eposPrintXmlResult(layout, options).xml;
}

/**
 * Wie [eposPrintXml], gibt aber zusaetzlich zurueck, was dem QR zugestossen
 * ist.
 *
 * **Die QR-Modulgroesse wird gerechnet.** Vorher stand hier fest 6, unabhaengig
 * von der Papierbreite: ein Beleg-QR mit realer RKSV-Nutzlast hat 57 Module,
 * mit Ruhezone 65, bei sechs Punkten also 390 Druckpunkte -- und ein
 * 58-mm-Kopf hat 384. Der Epson schneidet ein zu breites Symbol nicht ab, er
 * laesst es weg; genau daran fehlte am echten Beleg der QR.
 */
export function eposPrintXmlResult(
  layout: ReceiptLayout,
  options: EposPrintXmlOptions = {},
): EposPrintResult {
  const zeichen = options.charsPerLine ?? CHARS_PER_PAPER_SIZE[layout.paperSize];
  const papier = paperSizeForChars(zeichen, layout.paperSize);
  const deckel = options.qrModuleSize ?? 'auto';
  const blatt = blattFuerDruck(layout, { zeichen, logo: options.logo, marke: options.brandMark, qrGroesse: deckel });
  const fest = options.qrWidth === undefined
    ? null
    : Math.min(16, Math.max(3, Math.floor(options.qrWidth)));
  let qrFehler: string | null = null;
  let qrAusweich: string | null = null;

  /**
   * Die Breite fuer eine QR-Zeile, oder `null` -- dann geht **kein** Symbol
   * hinaus: ein Element, von dem man weiss, dass der Drucker es weglaesst,
   * taeuscht nur einen Ausdruck vor.
   *
   * Eine leere Nutzlast geht unveraendert den Bestandsweg (Deckel), wie am
   * ESC/POS-Befehl: sie ist ein Datenfehler, kein Papierfehler.
   */
  const qrBreiteFuer = (nutzlast: string): number | null => {
    if (fest !== null) return fest;
    if (nutzlast === '') return QR_MODULE_SIZE_CAP[deckel];
    // Passt der Inhalt in keine QR-Version, gibt es kein Symbol, das der
    // Drucker setzen koennte -- wie beim Blatt (Anteil 0) geht der Beleg ohne QR.
    if (!qrFitsInVersion(nutzlast)) {
      qrFehler = 'QR-Inhalt passt in keine QR-Version -- Beleg ohne QR';
      return null;
    }
    const mass = qrSizingFor({
      payload: nutzlast,
      paperWidthDots: QR_PRINT_WIDTH_DOTS[layout.paperSize],
      moduleSize: deckel,
    });
    if (!mass.fits) {
      qrFehler =
        `QR mit ${mass.modules} Modulen ist fuer ${layout.paperSize === 'mm58' ? 58 : 80} mm ` +
        `(${QR_PRINT_WIDTH_DOTS[layout.paperSize]} Punkte) zu breit`;
      return null;
    }
    if (mass.belowMinimum) {
      qrAusweich =
        `QR mit ${mass.modules} Modulen passt nur mit ${String(mass.moduleDots)} Punkten ` +
        `je Modul -- unter dem Mindestmass von ${QR_MIN_MODULE_DOTS}`;
    }
    return mass.moduleDots;
  };

  const out: string[] = [];
  out.push(`<epos-print xmlns="${NS}">`);
  out.push('<text lang="de"/>');
  out.push('<text font="font_a"/>');
  out.push('<text align="left"/>');
  out.push('<text width="1" height="1" reverse="false" em="false"/>');
  for (const block of blatt.blocks) {
    switch (block.kind) {
      case 'line':
        if (block.blank) out.push('<feed line="1"/>');
        else if (block.bold) { out.push(`<text em="true">${eposXmlEscape(block.text)}&#10;</text>`); out.push('<text em="false"/>'); }
        else out.push(`<text>${eposXmlEscape(block.text)}&#10;</text>`);
        break;
      case 'logo':
        if (options.logo) {
          out.push('<text align="center"/>');
          out.push(eposImageXml(options.logo.raster));
          out.push('<text align="left"/>');
        }
        break;
      case 'brandMark':
        out.push('<text align="center"/>');
        out.push(eposImageXml(brandMarkImage(papier)));
        out.push('<text align="left"/>');
        break;
      case 'qr': {
        const breite = qrBreiteFuer(block.payload);
        if (breite === null) break;
        out.push('<text align="center"/>');
        out.push(`<symbol type="qrcode_model_2" level="level_m" width="${breite}" height="0" size="0">${eposXmlEscape(block.payload)}</symbol>`);
        out.push('<text align="left"/>');
        break;
      }
    }
  }
  if (options.cut !== false) {
    out.push('<feed line="2"/>');
    out.push('<cut type="feed"/>');
  }
  out.push('</epos-print>');
  return { xml: out.join('\n'), qrError: qrFehler, qrFallback: qrAusweich };
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
  paperSize?: PosPaperSize;
  /** Feste QR-Modulgroesse; siehe [EposPrintXmlOptions.qrWidth]. */
  qrWidth?: number;
  /** Deckel fuer die gerechnete QR-Modulgroesse; siehe [EposPrintXmlOptions.qrModuleSize]. */
  qrModuleSize?: QrModuleSize;
  /** Firmenlogo; ohne Angabe kein Logo. */
  logo?: PrintLogo | null;
  /** Das Kasseneck-Logo am Ende (Konto-Flag `kreiseck_logo`). */
  brandMark?: boolean;
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

/**
 * Ob ein Aufruf an [eposDirectSend] an einem ZEITABLAUF scheiterte oder an
 * einer sonst abgelehnten/nie zustande gekommenen Verbindung -- ein Aufrufer
 * muss das unterscheiden koennen. Ein Zeitablauf heisst "der Drucker koennte
 * noch antworten, spaeter nochmal versuchen"; eine Ablehnung heisst "unter
 * dieser Adresse ist niemand" (falsche IP, Kabel raus, Zertifikat nicht
 * akzeptiert). Vor dieser Klasse trug die eine Fehlermeldung fuer beide
 * Faelle keine maschinenlesbare Unterscheidung -- ein Aufrufer haette sie nur
 * am Text erraten koennen, und genau diese Art von Kopplung an einen Text hat
 * sich an anderer Stelle in diesem Vorhaben schon als brueckig erwiesen.
 */
export class EposConnectionError extends Error {
  override readonly name = 'EposConnectionError';
  readonly ip: string;
  /** `true`, wenn das Zeitlimit ablief, BEVOR eine Antwort da war. */
  readonly timedOut: boolean;

  constructor(ip: string, timedOut: boolean) {
    const grund = timedOut ? 'antwortet nicht (Zeitlimit überschritten)' : 'nicht erreichbar';
    super(
      `Drucker ${grund}. Einmal https://${ip.trim()} im Browser öffnen und das Zertifikat akzeptieren, ` +
        'Zugriff aufs lokale Netz erlauben, ePOS-Print am Drucker auf Enable.',
    );
    this.ip = ip;
    this.timedOut = timedOut;
  }
}

/** Lehnt ab, sobald [signal] abbricht -- die Naht fuer die Frist in [eposDirectSend]. */
function alsAbbruchAbgelehnt(signal: AbortSignal): Promise<never> {
  return new Promise((_erfuellen, ablehnen) => {
    if (signal.aborted) {
      ablehnen(new Error('abgebrochen'));
      return;
    }
    signal.addEventListener('abort', () => ablehnen(new Error('abgebrochen')), { once: true });
  });
}

async function eposDirectSend(innerXml: string, o: EposDirectOptions, fetchFn: typeof fetch): Promise<EposResponse> {
  const zeitlimitMs = o.timeoutMs ?? 10000;
  const url = eposServiceUrl(o.ip, o.devid ?? EPOS_DEVID_VORGABE, zeitlimitMs);

  // `zeitlimitMs` geht zweifach ein -- als `timeout=`-Parameter in der URL
  // (ein Hinweis FUER DEN DRUCKER, wie lange ER intern auf den Kartenfluss/
  // Druckvorgang wartet) UND als AbortController-Frist HIER (die Grenze fuer
  // DIESEN Aufruf). Das ist keine Dopplung, sondern zwei verschiedene Dinge,
  // die zufaellig denselben Wert teilen: ohne die zweite Haelfte begrenzt
  // NICHTS den `fetch()`-Aufruf selbst. Ein Drucker, der die TCP-Verbindung
  // annimmt und nie antwortet (ein reales Fehlerbild bei einem eingebetteten
  // HTTP-Server), liesse den Aufruf dann NIE zurueckkehren und NIE werfen --
  // genau dieses Muster hat im Flutter-Paket einen ganzen Verkauf angehalten:
  // der Beleg stand in der Signaturkette, der Bildschirm zeigte nichts, und
  // ein Neustart mit erneutem Kassieren erzeugte einen zweiten Umsatz.
  const abbruch = new AbortController();
  const wecker = setTimeout(() => abbruch.abort(), zeitlimitMs);
  let antwort: Response;
  let text: string;
  try {
    try {
      antwort = await Promise.race([
        fetchFn(url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '""' },
          body: eposSoapEnvelope(innerXml),
          signal: abbruch.signal,
        }),
        alsAbbruchAbgelehnt(abbruch.signal),
      ]);
      // Die Frist deckt auch das Auslesen des Rumpfes, nicht nur den
      // Antwortkopf -- ein Drucker, der den Kopf schickt und den Rumpf offen
      // laesst, haelt den Aufruf sonst trotzdem unbegrenzt fest (dasselbe
      // Muster wie `client/transport.ts`).
      text = await Promise.race([antwort.text(), alsAbbruchAbgelehnt(abbruch.signal)]);
    } catch {
      // `abbruch.signal.aborted` ist hier zuverlaessig: der EINZIGE Ausloeser
      // fuer den Abbruch in dieser Funktion ist der `wecker` oben -- jeder
      // andere Fehlschlag (Netz weg, Zertifikat abgelehnt, DNS) laesst das
      // Signal unangetastet.
      throw new EposConnectionError(o.ip, abbruch.signal.aborted);
    }
  } finally {
    clearTimeout(wecker);
  }
  if (!antwort.ok) throw new Error(`Drucker antwortet mit HTTP ${antwort.status}.`);
  return eposParseResponse(text);
}

/** Beleg direkt drucken; wirft bei Netz-/Zertifikatsproblemen, sonst die Drucker-Antwort. */
export function eposDirectPrint(layout: ReceiptLayout, o: EposDirectOptions, fetchFn: typeof fetch = fetch): Promise<EposResponse> {
  const papier = o.paperSize ?? layout.paperSize;
  const xmlOptionen: EposPrintXmlOptions = { charsPerLine: CHARS_PER_PAPER_SIZE[papier] };
  if (o.qrWidth !== undefined) xmlOptionen.qrWidth = o.qrWidth;
  if (o.qrModuleSize !== undefined) xmlOptionen.qrModuleSize = o.qrModuleSize;
  if (o.logo) xmlOptionen.logo = o.logo;
  if (o.brandMark !== undefined) xmlOptionen.brandMark = o.brandMark;
  return eposDirectSend(eposPrintXml({ ...layout, paperSize: papier }, xmlOptionen), o, fetchFn);
}

/** Verbindungstest: leeres Dokument, druckt nichts, liefert den Druckerstatus. */
export function eposDirectStatus(o: EposDirectOptions, fetchFn: typeof fetch = fetch): Promise<EposResponse> {
  return eposDirectSend(`<epos-print xmlns="${NS}"/>`, o, fetchFn);
}
