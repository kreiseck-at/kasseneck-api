import { wortzeilenText } from '../printing/escpos.js';
import type { LayoutAlign, LayoutLine, ReceiptLayout } from './layout.js';
import type { PosPaperSize } from '../printing/escpos.js';

/**
 * Zeichenraster: der Beleg als Zeilen mit **exakt N Zeichen** -- die einzige
 * Wahrheit fuer Bildschirm, Bondruck und PDF. Kein Ausgabeweg rechnet
 * Spalten selbst; wer das Raster setzt, setzt den Beleg.
 *
 * Regeln (fest, damit ueberall dasselbe herauskommt):
 * - Papier 58 mm = 32 Zeichen, 80 mm = 48 (Font A); andere Breiten per Option.
 * - Spalten in Zwoelfteln -> ganze Zeichen: `floor(N*w/12)`, der Rest an die
 *   letzte Spalte, jede mindestens 1. Zwischen zwei Spalten steht immer
 *   mindestens ein Leerzeichen (letztes Zeichen jeder nicht-letzten Spalte).
 *   Die letzte Spalte endet buendig am rechten Rand.
 * - Text/Aufdruck/Spalteninhalt bricht **wortweise** um (`wortzeilenText`,
 *   dieselbe Regel wie der ESC/POS-Kern); ueberlange Woerter nach einem
 *   Bindestrich, sonst hart; geschuetztes Leerzeichen bricht nie.
 * - Fliessregel: laeuft in einer Spaltenzeile nur eine Spalte ueber die erste
 *   Zeile hinaus, bekommt ihr Rest die volle Breite (lange Artikelnamen auf
 *   58 mm); laufen mehrere weiter, bleibt das Raster.
 * - Trennlinie ueber die volle Breite, Leerraum als Leerzeilen, QR als eigene
 *   Zeile mit Nutzlast (der Zeichner setzt das Bild).
 */

export const ZEICHEN_JE_PAPIER: Readonly<Record<PosPaperSize, number>> = { mm58: 32, mm80: 48 };

export type GridLineKind = 'text' | 'columns' | 'rule' | 'space' | 'qr' | 'banner';

export interface GridLine {
  /** Genau `zeichen` Zeichen (bei `qr`: zentrierter Platzhalter). */
  text: string;
  kind: GridLineKind;
  bold: boolean;
  /** Bei `banner`: `warnung` = invers/auffaellig, `belegart` = Rahmen. */
  ton?: 'belegart' | 'warnung';
  /** Bei `qr`: die Nutzlast. */
  qr?: string;
}

export interface ReceiptGrid {
  lines: GridLine[];
  zeichen: number;
}

export interface RenderReceiptGridOptions {
  /** Zeichen je Zeile; Vorgabe nach `layout.paperSize` (32/48). */
  zeichen?: number;
}

/** Zwoelftel -> Zeichen je Spalte (ganze Zeichen, Rest an die letzte, mindestens 1). */
export function gridSpaltenBreiten(zwoelftel: readonly number[], zeichen: number): number[] {
  const out: number[] = [];
  let vergeben = 0;
  zwoelftel.forEach((w, i) => {
    const letzte = i === zwoelftel.length - 1;
    const b = letzte ? Math.max(1, zeichen - vergeben) : Math.max(1, Math.floor((zeichen * w) / 12));
    out.push(b);
    vergeben += b;
  });
  return out;
}

function ausrichten(text: string, breite: number, align: LayoutAlign): string {
  const t = text.length > breite ? text.slice(0, breite) : text;
  const rest = breite - t.length;
  if (align === 'right') return ' '.repeat(rest) + t;
  if (align === 'center') {
    const links = Math.floor(rest / 2);
    return ' '.repeat(links) + t + ' '.repeat(rest - links);
  }
  return t + ' '.repeat(rest);
}

const QR_PLATZHALTER = '[QR-Code]';

/** Text hinter der ersten Umbruchzeile (die ist ein Praefix des Textes, ohne Endleerzeichen). */
function restNach(text: string, erste: string): string {
  let i = erste.length;
  while (i < text.length && text[i] === ' ') i += 1;
  return text.slice(i);
}

export function renderReceiptGrid(layout: ReceiptLayout, options: RenderReceiptGridOptions = {}): ReceiptGrid {
  const zeichen = Math.max(8, Math.floor(options.zeichen ?? ZEICHEN_JE_PAPIER[layout.paperSize] ?? 32));
  const leer = ' '.repeat(zeichen);
  const lines: GridLine[] = [];
  for (const z of layout.lines as LayoutLine[]) {
    switch (z.kind) {
      case 'text':
        for (const t of wortzeilenText(z.text, zeichen)) lines.push({ text: ausrichten(t, zeichen, z.align), kind: 'text', bold: z.bold });
        break;
      case 'banner':
        for (const t of wortzeilenText(z.text, zeichen)) lines.push({ text: ausrichten(t, zeichen, 'center'), kind: 'banner', bold: true, ton: z.ton });
        break;
      case 'rule':
        lines.push({ text: (z.char || '-').charAt(0).repeat(zeichen), kind: 'rule', bold: false });
        break;
      case 'space':
        for (let i = 0; i < Math.max(0, z.lines); i += 1) lines.push({ text: leer, kind: 'space', bold: false });
        break;
      case 'qr':
        lines.push({ text: ausrichten(QR_PLATZHALTER, zeichen, 'center'), kind: 'qr', bold: false, qr: z.data });
        break;
      case 'columns': {
        const breiten = gridSpaltenBreiten(z.columns.map((c) => c.width), zeichen);
        // Inhalt jeder nicht-letzten Spalte um 1 Zeichen schmaler: garantierter Abstand.
        const inhalt = breiten.map((b, i) => (i < breiten.length - 1 ? Math.max(1, b - 1) : b));
        const teile = z.columns.map((c, i) => wortzeilenText(c.text, inhalt[i]!));
        // Fliessregel: laeuft nach der ersten Zeile nur noch EINE Spalte weiter (die anderen sind
        // fertig), bekommt ihr Rest die volle Breite -- auf 58 mm sonst 18-Zeichen-Schnipsel.
        // Laufen mehrere weiter, bleibt das Raster (sonst verschoeben sich die Nachbarn).
        const weiterlaufend = teile.map((t, i) => (t.length > 1 ? i : -1)).filter((i) => i >= 0);
        const fliesst = weiterlaufend.length === 1 && z.columns.length > 1;
        const zeilen = fliesst ? 1 : Math.max(1, ...teile.map((t) => t.length));
        for (let r = 0; r < zeilen; r += 1) {
          let text = '';
          z.columns.forEach((c, i) => {
            const zelle = ausrichten(teile[i]![r] ?? '', inhalt[i]!, c.align);
            text += i < breiten.length - 1 ? zelle + ' '.repeat(breiten[i]! - inhalt[i]!) : zelle;
          });
          lines.push({ text: text.length === zeichen ? text : ausrichten(text, zeichen, 'left'), kind: 'columns', bold: false });
        }
        if (fliesst) {
          const i = weiterlaufend[0]!;
          // Rest aus dem Originaltext (nicht aus den schmal umbrochenen Stuecken), damit
          // Bindestrich-/Hartbrueche der schmalen Spalte nicht als Leerzeichen zurueckbleiben.
          const rest = restNach(z.columns[i]!.text, teile[i]![0]!);
          for (const t of wortzeilenText(rest, zeichen)) lines.push({ text: ausrichten(t, zeichen, z.columns[i]!.align), kind: 'columns', bold: false });
        }
        break;
      }
      default:
        break;
    }
  }
  return { lines, zeichen };
}

/** Klartext (eine Zeile je Rasterzeile) -- fuer Golden-Dateien und Logs. QR als Platzhalter. */
export function gridAlsText(grid: ReceiptGrid): string {
  return grid.lines.map((z) => z.text).join('\n');
}
