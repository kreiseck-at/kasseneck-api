import type { CSSProperties, ReactNode } from 'react';
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
}

const AUSRICHTUNG: Readonly<Record<LayoutAlign, CSSProperties['textAlign']>> = {
  left: 'left',
  center: 'center',
  right: 'right',
};

export function ReceiptLayoutView({ layout, className, renderQr }: ReceiptLayoutViewProps): ReactNode {
  const klasse = className === undefined ? 'keck-receipt' : `keck-receipt ${className}`;
  return (
    <div className={klasse} data-paper-size={layout.paperSize}>
      {layout.lines.map((zeile, index) => (
        <Zeile key={index} zeile={zeile} renderQr={renderQr} />
      ))}
    </div>
  );
}

function Zeile({ zeile, renderQr }: { zeile: LayoutLine; renderQr?: (data: string) => ReactNode }): ReactNode {
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
      return (
        <div className="keck-receipt-qr" style={{ textAlign: 'center' }}>
          {renderQr !== undefined ? renderQr(zeile.data) : <div data-qr={zeile.data} aria-label="RKSV-QR-Code" />}
        </div>
      );
  }
}
