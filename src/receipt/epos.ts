import type { ReceiptLayout } from './layout.js';
import type { PosPaperSize } from '../printing/escpos.js';
import {
  QR_DRUCK_PUNKTE,
  QR_MINDEST_PUNKTE,
  QR_MODUL_DECKEL,
  qrGroesseFuer,
  type QrModulGroesse,
} from '../printing/index.js';
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
  /**
   * **Feste** QR-Modulgroesse (Epson `width` 3..16). Gesetzt schaltet sie die
   * Rechnung ab -- dann passt der Aufrufer selbst auf, dass das Symbol samt
   * Ruhezone auf die Rolle geht.
   */
  qrBreite?: number;
  /**
   * Deckel fuer die gerechnete QR-Modulgroesse; Vorgabe `mittel`.
   *
   * Warum `mittel` und nicht `auto`: `auto` deckelt beim Bestandswert des
   * **ESC/POS**-Befehls dieses Pakets (4), dieser Weg druckt aber seit jeher
   * mit 6. Die Vorgabe nennt den Bestandswert dieses Wegs also ausdruecklich,
   * damit ohne Wahl kein Byte anders herauskommt.
   */
  qrGroesse?: QrModulGroesse;
  /** Papierschnitt am Ende, Vorgabe true. */
  cut?: boolean;
}

/**
 * Das XML **samt** dem, was dem QR unterwegs zugestossen ist -- dieselbe
 * Buchfuehrung wie `EscPosLayoutErgebnis` am ESC/POS-Weg.
 */
export interface EposPrintErgebnis {
  xml: string;
  /** Der Beleg ging ohne QR hinaus; das Symbol passt auch mit 3 Punkten nicht. */
  qrFehler: string | null;
  /** Der QR steht da, aber unter der Mindest-Modulgroesse. */
  qrAusweich: string | null;
}

export function eposXmlEscape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

const NS = 'http://www.epson-pos.com/schemas/2011/03/epos-print';

/** Nur das XML; wer die QR-Meldungen braucht, nimmt [eposPrintXmlErgebnis]. */
export function eposPrintXml(layout: ReceiptLayout, options: EposPrintXmlOptions = {}): string {
  return eposPrintXmlErgebnis(layout, options).xml;
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
export function eposPrintXmlErgebnis(
  layout: ReceiptLayout,
  options: EposPrintXmlOptions = {},
): EposPrintErgebnis {
  const grid = renderReceiptGrid(layout, { zeichen: options.zeichen ?? ZEICHEN_JE_PAPIER[layout.paperSize] });
  const deckel = options.qrGroesse ?? 'mittel';
  const fest = options.qrBreite === undefined
    ? null
    : Math.min(16, Math.max(3, Math.floor(options.qrBreite)));
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
    if (nutzlast === '') return QR_MODUL_DECKEL[deckel];
    const mass = qrGroesseFuer({
      nutzlast,
      papierbreitePunkte: QR_DRUCK_PUNKTE[layout.paperSize],
      groesse: deckel,
    });
    if (!mass.passt) {
      qrFehler =
        `QR mit ${mass.module} Modulen ist fuer ${layout.paperSize === 'mm58' ? 58 : 80} mm ` +
        `(${QR_DRUCK_PUNKTE[layout.paperSize]} Punkte) zu breit`;
      return null;
    }
    if (mass.unterMindestmass) {
      qrAusweich =
        `QR mit ${mass.module} Modulen passt nur mit ${String(mass.punkte)} Punkten ` +
        `je Modul -- unter dem Mindestmass von ${QR_MINDEST_PUNKTE}`;
    }
    return mass.punkte;
  };

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
      case 'qr': {
        const breite = qrBreiteFuer(z.qr ?? '');
        if (breite === null) break;
        out.push('<text align="center"/>');
        out.push(`<symbol type="qrcode_model_2" level="level_m" width="${breite}" height="0" size="0">${eposXmlEscape(z.qr ?? '')}</symbol>`);
        out.push('<text align="left"/>');
        break;
      }
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
  return { xml: out.join('\n'), qrFehler, qrAusweich };
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
  /** Feste QR-Modulgroesse; siehe [EposPrintXmlOptions.qrBreite]. */
  qrBreite?: number;
  /** Deckel fuer die gerechnete QR-Modulgroesse; siehe [EposPrintXmlOptions.qrGroesse]. */
  qrGroesse?: QrModulGroesse;
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
  const papier = o.papier ?? layout.paperSize;
  const xmlOptionen: EposPrintXmlOptions = { zeichen: ZEICHEN_JE_PAPIER[papier] };
  if (o.qrBreite !== undefined) xmlOptionen.qrBreite = o.qrBreite;
  if (o.qrGroesse !== undefined) xmlOptionen.qrGroesse = o.qrGroesse;
  return eposDirectSend(eposPrintXml({ ...layout, paperSize: papier }, xmlOptionen), o, fetchFn);
}

/** Verbindungstest: leeres Dokument, druckt nichts, liefert den Druckerstatus. */
export function eposDirectStatus(o: EposDirectOptions, fetchFn: typeof fetch = fetch): Promise<EposResponse> {
  return eposDirectSend(`<epos-print xmlns="${NS}"/>`, o, fetchFn);
}
