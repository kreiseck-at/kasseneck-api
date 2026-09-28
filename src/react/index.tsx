import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { LayoutAlign, LayoutBannerTone, LayoutLine, ReceiptLayout } from '../receipt/layout.js';
import { receiptSheet, isLogoPixelSizeAllowed, DOTS_PER_CHAR, type ReceiptSheet, type ReceiptSheetOptions, type SheetLogoSize } from '../receipt/blatt.js';
import { BRAND_MARK_PATHS } from '../receipt/marke-daten.js';
import type { QrModuleSize } from '../printing/qr-groesse.js';

/**
 * Struktureller Ersatz fuer `HTMLImageElement`: `tsconfig.json` fuehrt kein
 * `"DOM"` in `lib` (der Kern soll nicht versehentlich Browser-API nutzen), darum
 * kompiliert `new Image()` hier nicht. Die Laufzeit stellt den Konstruktor
 * trotzdem bereit -- nur der Typ fehlt.
 */
interface HTMLImageElementLike {
  naturalWidth: number;
  naturalHeight: number;
  onload: (() => void) | null;
  src: string;
}

/**
 * React-Adapter: zeichnet ein Beleg-Layout (siehe ../receipt/layout.ts).
 *
 * Eigener Einstiegspunkt `@kreiseck/kasseneck-api/react`. **React ist eine
 * Peer-Abhaengigkeit**: wer nur Belege erzeugt, Bytes druckt oder ein Layout
 * baut, soll React weder installieren noch laden muessen. Der Kern des Pakets
 * ruehrt diese Datei deshalb nirgends an — ein Test haelt das fest.
 *
 * Der Adapter bringt bewusst kein Aussehen mit: Struktur, Ausrichtung und
 * Betonung stehen im Markup, alles Weitere (Schriftart, Breite, Farben) macht
 * das Stylesheet des Verbrauchers ueber die `keck-receipt-*`-Klassen. Ein
 * Bon ist einspaltig und schmal; er sieht in jeder Anwendung anders aus.
 *
 * Der QR-Code wird **nicht** gezeichnet — dafuer braucht es einen QR-Erzeuger,
 * und welchen, entscheidet die Anwendung. Vorgabe ist ein leeres Element, das
 * die Nutzlast als `data-qr` traegt; ueber [ReceiptLayoutViewProps.renderQr]
 * setzt der Aufrufer seinen eigenen Zeichner ein.
 */

export interface ReceiptLayoutViewProps {
  layout: ReceiptLayout;
  /** Zusaetzliche Klasse am aeusseren Element. */
  className?: string;
  /** Zeichnet den RKSV-QR-Code; ohne Angabe erscheint ein Platzhalter mit `data-qr`. */
  renderQr?: (data: string) => ReactNode;
  /**
   * QR zunaechst verdeckt (weichgezeichnet) zeigen; ein Tipp macht ihn lesbar.
   * Fuer Bildschirme, auf denen der Beleg nur zur Kontrolle steht -- der
   * Signatur-QR gehoert dem Kunden und wird erst auf Verlangen freigegeben.
   */
  qrHidden?: boolean;
  /** Text auf dem verdeckten QR (Vorgabe „Antippen zum Anzeigen“). */
  qrHiddenText?: string;
}

/**
 * CSS-Klasse je Ton. Die Klassennamen bleiben die von 0.x
 * (`keck-receipt-banner--belegart`/`--warnung`): Stylesheets der Verbraucher
 * haengen daran, und das HTML soll durch die englischen Werte kein Byte
 * anders werden.
 */
const BANNER_KLASSE: Readonly<Record<LayoutBannerTone, string>> = {
  receipt_type: 'belegart',
  warning: 'warnung',
};

const AUSRICHTUNG: Readonly<Record<LayoutAlign, CSSProperties['textAlign']>> = {
  left: 'left',
  center: 'center',
  right: 'right',
};

/**
 * @deprecated Seit 0.14.0: [ReceiptSheetView] setzt den Beleg zeichengleich zu
 * Bon und PDF (Raster, Logo, Marke). Diese Ansicht rechnet Spalten mit Flex
 * und bricht darum anders um als das Papier.
 */
export function ReceiptLayoutView({ layout, className, renderQr, qrHidden: qrVerdeckt = false, qrHiddenText: qrVerdecktText }: ReceiptLayoutViewProps): ReactNode {
  const klasse = className === undefined ? 'keck-receipt' : `keck-receipt ${className}`;
  return (
    <div className={klasse} data-paper-size={layout.paperSize}>
      {layout.lines.map((zeile, index) => (
        <Zeile key={index} zeile={zeile} renderQr={renderQr} qrVerdeckt={qrVerdeckt} qrVerdecktText={qrVerdecktText} />
      ))}
    </div>
  );
}

/**
 * Verdeckter QR: weichgezeichnet und nicht scannbar, bis der Betrachter ihn
 * antippt. Die Nutzlast bleibt trotzdem als `data-qr` am Element -- fuer Tests
 * und Werkzeuge, nicht fuers Auge.
 */
export function HiddenQr({ data, text = 'Antippen zum Anzeigen', children }: { data: string; text?: string; children: ReactNode }): ReactNode {
  const [offen, setOffen] = useState(false);
  return (
    <button
      type="button"
      className={offen ? 'keck-receipt-qr-toggle keck-receipt-qr-toggle--offen' : 'keck-receipt-qr-toggle'}
      aria-pressed={offen}
      aria-label={offen ? 'QR-Code verdecken' : text}
      data-qr={data}
      onClick={() => setOffen((o) => !o)}
      style={{ position: 'relative', display: 'inline-block', border: 'none', background: 'transparent', padding: 0, cursor: 'pointer' }}
    >
      {/* Nur optisch verdeckt: Semantik (QR-Bild, Fehlermeldung) bleibt fuer Hilfsmittel und Tests erreichbar.
          blur(3px): unscannbar, aber als QR erkennbar — staerker sah nach Fehler aus. */}
      <span style={{ display: 'inline-block', filter: offen ? undefined : 'blur(3px)', transition: 'filter .15s ease' }}>{children}</span>
      {!offen && (
        // Tipp-Finger statt Textzeile: versteht jeder, verdeckt fast nichts.
        // Der Text bleibt als aria-label fuer Hilfsmittel. Einfarbige
        // Strichzeichnung statt Emoji — Emojis rendern je Plattform anders
        // und stechen farblich aus dem Beleg heraus.
        <span aria-hidden="true" className="keck-receipt-qr-toggle-text" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
          <span style={{ display: 'grid', placeItems: 'center', width: '2.2em', height: '2.2em', borderRadius: '50%', background: 'rgba(255,255,255,.92)', boxShadow: '0 1px 4px rgba(0,0,0,.25)', color: 'rgba(0,0,0,.72)' }}>
            <svg className="keck-receipt-qr-toggle-finger" width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 9.5V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v10" />
              <path d="M14 10V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v1" />
              <path d="M18 11v-1a2 2 0 0 0-2-2a2 2 0 0 0-2 2" />
              <path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
            </svg>
          </span>
        </span>
      )}
    </button>
  );
}

function Zeile({ zeile, renderQr, qrVerdeckt, qrVerdecktText }: { zeile: LayoutLine; renderQr?: (data: string) => ReactNode; qrVerdeckt?: boolean; qrVerdecktText?: string }): ReactNode {
  switch (zeile.kind) {
    case 'text':
      return (
        <div
          className="keck-receipt-text"
          style={{ textAlign: AUSRICHTUNG[zeile.align], fontWeight: zeile.bold ? 'bold' : 'normal' }}
        >
          {/* Leere Zeilen wuerden ohne Inhalt zusammenfallen. */}
          {zeile.text.length > 0 ? zeile.text : ' '}
        </div>
      );
    case 'columns':
      return (
        <div className="keck-receipt-row" style={{ display: 'flex', width: '100%' }}>
          {zeile.columns.map((spalte, index) => (
            <div
              key={index}
              className="keck-receipt-cell"
              style={{
                // Die Breite ist ein Zwoelftel-Anteil (wie beim Bondrucker);
                // so bleibt die Aufteilung auf allen Ausgabewegen dieselbe.
                flex: `0 0 ${((spalte.width / 12) * 100).toFixed(4)}%`,
                textAlign: AUSRICHTUNG[spalte.align],
                // minWidth 0: Flex-Zellen haben sonst min-content-Breite --
                // ein langes Wort ohne Leerzeichen (Hex-Seriennummer der
                // Signaturkarte) wuerde die Zelle sprengen und abgeschnitten,
                // statt per break-word umzubrechen.
                minWidth: 0,
                overflowWrap: 'break-word',
              }}
            >
              {spalte.text}
            </div>
          ))}
        </div>
      );
    case 'rule':
      // Echte Linie statt einer Reihe Bindestriche: auf dem Bildschirm haengt
      // deren Anzahl sonst an der Schriftbreite.
      return <hr className="keck-receipt-rule" data-char={zeile.char} />;
    case 'space':
      return <div className="keck-receipt-space" style={{ height: `${zeile.lines}em` }} />;
    case 'banner':
      return (
        <div
          className={`keck-receipt-banner keck-receipt-banner--${BANNER_KLASSE[zeile.tone] ?? String(zeile.tone)}`}
          role={zeile.tone === 'warning' ? 'alert' : undefined}
          style={{ textAlign: 'center', fontWeight: 'bold', letterSpacing: '0.06em', padding: '0.2em 0.4em', border: '2px solid currentColor', margin: '0.3em 0' }}
        >
          {zeile.text}
        </div>
      );
    case 'qr':
      {
        const bild = renderQr !== undefined ? renderQr(zeile.data) : <div data-qr={zeile.data} aria-label="RKSV-QR-Code" />;
        return (
          <div className="keck-receipt-qr" style={{ textAlign: 'center' }}>
            {qrVerdeckt ? <HiddenQr data={zeile.data} text={qrVerdecktText}>{bild}</HiddenQr> : bild}
          </div>
        );
      }
  }
}

export interface ReceiptSheetLinesProps {
  sheet: ReceiptSheet;
  /** Adresse des Firmenlogos; ohne sie bleibt der Logo-Block leer (Platz bleibt). */
  logoUrl?: string;
  /**
   * Zeichnet den QR in seinen Kasten (`qrSheetWidthFraction`). Der Kasten schliesst
   * die Ruhezone von 4 Modulen je Seite ein und setzt Fehlerkorrektur M
   * voraus: das Symbol also mit Korrektur M und 4 Modulen Ruhezone zeichnen
   * und den Kasten ganz ausfuellen -- dann ist ein Modul so gross wie am Bon.
   */
  renderQr?: (data: string) => ReactNode;
  qrHidden?: boolean;
  qrHiddenText?: string;
  className?: string;
}

/**
 * Das Blatt am Bildschirm -- Zeile fuer Zeile dieselben Zeichen wie am Bon und
 * im PDF. Masse in `ch`: eine Zeichenbreite ist `1ch`, eine Zeile `2ch`, das
 * Blatt `charsPerLine`ch breit. Der Verbraucher bestimmt nur Schrift (monospace,
 * Vorgabe ueber `--keck-blatt-schrift`) und Schriftgroesse; alles andere steht
 * im Blatt.
 */
export function ReceiptSheetLines({ sheet: blatt, logoUrl, renderQr, qrHidden: qrVerdeckt = false, qrHiddenText: qrVerdecktText, className }: ReceiptSheetLinesProps): ReactNode {
  const z = blatt.charsPerLine;
  const klasse = className === undefined ? 'keck-blatt' : `keck-blatt ${className}`;
  const blattStil: CSSProperties = {
    width: `${z}ch`,
    fontFamily: 'var(--keck-blatt-schrift, "DM Mono", ui-monospace, Menlo, Consolas, monospace)',
    fontVariantLigatures: 'none',
  };
  return (
    <div className={klasse} data-zeichen={z} style={blattStil}>
      {blatt.blocks.map((b, i) => {
        switch (b.kind) {
          case 'line':
            return (
              <div key={i} className="keck-blatt-zeile" style={{ whiteSpace: 'pre', height: '2ch', lineHeight: '2ch', overflow: 'hidden', fontWeight: b.bold ? 'bold' : 'normal' }}>
                {b.text}
              </div>
            );
          case 'logo':
            return (
              <div key={i} className="keck-blatt-logo" style={{ height: `${b.heightLines * 2}ch`, display: 'flex', justifyContent: 'center' }}>
                {logoUrl === undefined ? null : (
                  <img src={logoUrl} alt="" aria-hidden="true" style={{ width: `${b.widthFraction * z}ch`, height: `${b.heightLines * 2}ch`, objectFit: 'contain' }} />
                )}
              </div>
            );
          case 'brandMark':
            // Kein Rasterbild wie am Bon: Dieses Paket hat bewusst keine
            // Abhaengigkeiten, und die Pfade liegen ohnehin schon vor (PDF
            // zeichnet dieselben). Ein SVG bleibt in jeder Aufloesung scharf.
            return (
              <div key={i} className="keck-blatt-marke" style={{ height: `${b.height / DOTS_PER_CHAR}ch`, display: 'flex', justifyContent: 'center' }}>
                <svg viewBox={`0 0 ${BRAND_MARK_PATHS.width} ${BRAND_MARK_PATHS.height}`} width={`${b.width / DOTS_PER_CHAR}ch`} height={`${b.height / DOTS_PER_CHAR}ch`} role="img" aria-label="Kasseneck" fill="currentColor">
                  {BRAND_MARK_PATHS.paths.map((d, j) => <path key={j} d={d} />)}
                </svg>
              </div>
            );
          case 'qr': {
            // Auch beim Anteil 0 (leer oder in keine Version passend) bekommt
            // `renderQr` die Nutzlast: die Oberflaeche muss sagen koennen, dass
            // der QR fehlt und ein Papierbeleg noetig ist. Bon und PDF lassen
            // den QR dann weg und melden es ueber `qrError`.
            const bild = renderQr !== undefined ? renderQr(b.payload) : <div data-qr={b.payload} aria-label="RKSV-QR-Code" />;
            return (
              <div key={i} className="keck-blatt-qr" style={{ display: 'flex', justifyContent: 'center' }}>
                <div style={{ width: `${b.widthFraction * z}ch`, aspectRatio: '1 / 1' }}>
                  {qrVerdeckt ? <HiddenQr data={b.payload} text={qrVerdecktText}>{bild}</HiddenQr> : bild}
                </div>
              </div>
            );
          }
        }
      })}
    </div>
  );
}

export interface ReceiptSheetViewProps extends Omit<ReceiptSheetLinesProps, 'sheet' | 'logoUrl'> {
  layout: ReceiptLayout;
  charsPerLine?: number;
  /** Firmenlogo und Stufe (`logoSkala`); das Pixelmass liest die Ansicht selbst. */
  logo?: { url: string; size: SheetLogoSize } | null;
  brandMark?: boolean;
  /** Geraete-Einstellung fuer die QR-Modulgroesse; Vorgabe `auto` (hoechstens 6 Punkte je Modul) — wie die Druckwege. */
  qrModuleSize?: QrModuleSize;
}

/**
 * Laedt das Logo (fuer sein Pixelmass), baut das Blatt und zeichnet es. Bis
 * das Bild geladen ist, fehlt der Logo-Block -- die Kasse laedt das Logo ohnehin
 * vorab in den Browser-Cache.
 *
 * Ein Logo ueber [isLogoPixelSizeAllowed] (4096x4096px, dieselbe Grenze wie das
 * Druck-Kit beim Rastern fuer den Bon) bleibt hier ebenso ohne Logo-Block --
 * sonst zeigte der Bildschirm ein Logo, das nie gedruckt wird: Bildschirm und
 * Bon zeigen dasselbe Logo.
 */
export function ReceiptSheetView({ layout, charsPerLine: zeichen, logo, brandMark: marke = false, qrModuleSize: qrGroesse, ...rest }: ReceiptSheetViewProps): ReactNode {
  const [mass, setMass] = useState<{ url: string; breite: number; hoehe: number } | null>(null);
  const url = logo?.url;
  useEffect(() => {
    if (url === undefined) return undefined;
    let aktiv = true;
    const Bild = (globalThis as unknown as { Image?: new () => HTMLImageElementLike }).Image;
    if (Bild === undefined) return undefined;
    const bild = new Bild();
    bild.onload = () => {
      if (aktiv && isLogoPixelSizeAllowed(bild.naturalWidth, bild.naturalHeight)) setMass({ url, breite: bild.naturalWidth, hoehe: bild.naturalHeight });
    };
    bild.src = url;
    return () => {
      aktiv = false;
    };
  }, [url]);
  const optionen: ReceiptSheetOptions = { brandMark: marke };
  if (zeichen !== undefined) optionen.charsPerLine = zeichen;
  if (qrGroesse !== undefined) optionen.qrModuleSize = qrGroesse;
  const geladen = logo != null && mass !== null && mass.url === logo.url;
  if (geladen) optionen.logo = { size: logo.size, pixelWidth: mass.breite, pixelHeight: mass.hoehe };
  const blatt = receiptSheet(layout, optionen);
  return geladen ? <ReceiptSheetLines sheet={blatt} logoUrl={logo.url} {...rest} /> : <ReceiptSheetLines sheet={blatt} {...rest} />;
}
