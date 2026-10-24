import { KasseneckValidationError } from '../client/errors.js';
import { toViennaWallClock } from '../vienna-time.js';
import type { LayoutColumnsLine, LayoutLine, ReceiptLayout } from './layout.js';

/** Beschriftung der Duplikat-Zeile; derselbe Text im Dart-Zwilling. */
const DUPLIKAT_AM = 'Duplikat am:';

/**
 * Spaltenbreiten in Zwoelfteln. 5:7 setzt Beschriftung (12 Zeichen) und Zeit
 * (19 Zeichen) auf 32 und 48 Zeichen ohne Umbruch in eine Zeile, den Wert am
 * rechten Rand wie bei `Datum:`: 13 + 19 bzw. 20 + 28 Zeichen. Die Breiten
 * von `Beleg-ID:` (6:6) und `Datum:` (4:8) reichen auf 32 Zeichen nicht.
 */
const LINKS = 5;
const RECHTS = 7;

/** Eigene Kopie einer Zeile: wer am Duplikat dreht, dreht nie am Erstdruck. */
function kopie(zeile: LayoutLine): LayoutLine {
  return zeile.kind === 'columns' ? { ...zeile, columns: zeile.columns.map((c) => ({ ...c })) } : { ...zeile };
}

const istZeile = (z: LayoutLine, beschriftung: string): boolean => z.kind === 'columns' && z.columns[0]?.text === beschriftung;

/** Zeitpunkt als `TT.MM.JJJJ HH:MM:SS` in Wiener Zeit; Bruchteile fallen weg. */
function wienerZeit(zeitpunkt: Date): string {
  const t = toViennaWallClock(zeitpunkt);
  const zwei = (n: number): string => String(n).padStart(2, '0');
  return `${zwei(t.day)}.${zwei(t.month)}.${t.year} ${zwei(t.hour)}:${zwei(t.minute)}:${zwei(t.second)}`;
}

/**
 * Kennzeichnet einen Nachdruck als **Belegduplikat**. Registrierkassen-Erlass
 * BMF-AV Nr. 2/2026, Abschnitt 4.5.6: „Ein Belegduplikat ist als solches zu
 * bezeichnen, nicht nochmals zu signieren, nicht neuerlich im
 * Datenerfassungsprotokoll aufzunehmen und darf zu keiner Veränderung des
 * Umsatzzählers führen.“ Signatur, DEP und Zähler bleiben ohnehin unberührt,
 * weil ein Nachdruck den gespeicherten Beleg druckt; diese Funktion liefert
 * die Bezeichnung.
 *
 * Die Kasse ruft sie bei **jedem** Nachdruck und bei „Kopie drucken“ mit dem
 * Zeitpunkt des Drucks auf, nie beim Erstdruck und nie fuer Mail, Link oder
 * PDF, und gibt das Ergebnis an denselben Druckweg (`escPosLayoutBytes`,
 * `eposPrintXml`, `receiptSheet`, React-Ansicht).
 *
 * Neu ist genau eine Zeile im Kennungsblock, direkt unter `Beleg-ID:`, in
 * der Spaltenform von `Datum:` (nicht fett, Wert rechtsbuendig):
 *
 * ```
 * Beleg-ID:          AT0-KASSE1-42
 * Duplikat am: 24.10.2026 14:10:05
 * ```
 *
 * `printedAt` ist ein Zeitpunkt; gedruckt wird er in Wiener Zeit
 * (Sommerzeit nach EU-Regel), nie in der Zeitzone des Rechners. Ohne
 * Spaltenzeile `Beleg-ID:` (Schicht-Bons) steht die Zeile ganz oben. Alles
 * andere bleibt Zeile fuer Zeile wie beim Erstdruck.
 *
 * Reine Funktion: die Eingabe bleibt unangetastet, das Ergebnis ist eine
 * eigene Kopie. Traegt das Layout schon eine Zeile `Duplikat am:`, bekommt
 * nur sie die neue Zeit (der letzte Nachdruck gilt); es bleibt bei einer
 * Zeile. Ein unbrauchbarer Zeitpunkt wirft `KasseneckValidationError`
 * (`scope: 'request'`).
 */
export function markAsDuplicate(layout: ReceiptLayout, printedAt: Date): ReceiptLayout {
  if (!(printedAt instanceof Date) || Number.isNaN(printedAt.getTime())) {
    throw new KasseneckValidationError('markAsDuplicate', 'printedAt: kein gueltiger Zeitpunkt (Date)', 'request');
  }
  const neu: LayoutColumnsLine = {
    kind: 'columns',
    columns: [
      { text: DUPLIKAT_AM, width: LINKS, align: 'left' },
      { text: wienerZeit(printedAt), width: RECHTS, align: 'right' },
    ],
  };
  const vorhanden = layout.lines.findIndex((z) => istZeile(z, DUPLIKAT_AM));
  const lines = layout.lines.filter((z) => !istZeile(z, DUPLIKAT_AM)).map(kopie);
  const stelle = vorhanden >= 0 ? vorhanden : lines.findIndex((z) => istZeile(z, 'Beleg-ID:')) + 1;
  lines.splice(stelle, 0, neu);
  return { ...layout, lines };
}
