import { useState, type CSSProperties, type ReactNode } from 'react';
import type { LayoutAlign, LayoutLine, ReceiptLayout } from '../receipt/layout.js';

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
  qrVerdeckt?: boolean;
  /** Text auf dem verdeckten QR (Vorgabe „Antippen zum Anzeigen“). */
  qrVerdecktText?: string;
}

const AUSRICHTUNG: Readonly<Record<LayoutAlign, CSSProperties['textAlign']>> = {
  left: 'left',
  center: 'center',
  right: 'right',
};

export function ReceiptLayoutView({ layout, className, renderQr, qrVerdeckt = false, qrVerdecktText }: ReceiptLayoutViewProps): ReactNode {
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
export function QrVerdeckt({ data, text = 'Antippen zum Anzeigen', children }: { data: string; text?: string; children: ReactNode }): ReactNode {
  const [offen, setOffen] = useState(false);
  return (
    <button
      type="button"
      className={offen ? 'keck-receipt-qr-toggle keck-receipt-qr-toggle--offen' : 'keck-receipt-qr-toggle'}
      aria-pressed={offen}
      aria-label={offen ? 'QR-Code verdecken' : 'QR-Code anzeigen'}
      data-qr={data}
      onClick={() => setOffen((o) => !o)}
      style={{ position: 'relative', display: 'inline-block', border: 'none', background: 'transparent', padding: 0, cursor: 'pointer' }}
    >
      <span style={{ display: 'inline-block', filter: offen ? undefined : 'blur(6px)', transition: 'filter .15s ease' }} aria-hidden={!offen}>{children}</span>
      {!offen && (
        <span className="keck-receipt-qr-toggle-text" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: '0.75em', fontWeight: 700 }}>{text}</span>
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
    case 'qr':
      {
        const bild = renderQr !== undefined ? renderQr(zeile.data) : <div data-qr={zeile.data} aria-label="RKSV-QR-Code" />;
        return (
          <div className="keck-receipt-qr" style={{ textAlign: 'center' }}>
            {qrVerdeckt ? <QrVerdeckt data={zeile.data} text={qrVerdecktText}>{bild}</QrVerdeckt> : bild}
          </div>
        );
      }
  }
}
