/**
 * Das Testblatt fuer den Zeichensatz: welche Code-Tabelle druckt auf diesem
 * Drucker die Umlaute richtig?
 *
 * Oben steht die Vorlage-Zeile als Rasterbild -- ein Bild druckt jeder
 * Drucker gleich, egal welche Tabelle er gerade hat. Darunter je Tabelle des
 * Katalogs eine Zeile mit ihrer Nummer (gross), umgeschaltet mit `ESC t n`
 * und mit den Bytes dieser Tabelle. Die erste Zeile, die aussieht wie die
 * Vorlage, ist die richtige; Zeile 6 (Ersatzbuchstaben) passt immer.
 *
 * Bildschirm und Papier zeigen dasselbe Blatt: `codeTableTestSheet` liefert
 * es im Zeilenmodell des Beleg-Blatts (`ReceiptSheet`), `codeTableTestSheetBytes`
 * druckt genau diese Zeilen. Das Blatt hat immer 32 Spalten (58 mm); auf
 * 80 mm steht der Block ueber den linken Rand (`GS L`) mittig.
 *
 * Gemeinsamer Prueffall mit dem Dart-Zwilling:
 * `fixtures/expected/code-table-test-sheet.{mm58,mm80}.hex` und `.lines.json`.
 */
import type { ReceiptSheet, SheetBlock } from './blatt.js';
import { entpackeRasterBits } from './marke.js';
import { toViennaWallClock } from '../vienna-time.js';
import { labelText, messageText } from '../pos/texte.js';
import { CODE_TABLES, encodeForCodeTable, type CodeTable, type CodeTableId } from '../printing/code-tables.js';
import { CODE_TABLE_REFERENCE_RASTER } from './code-table-reference-data.js';
import {
  createEscPosDocument,
  escPosBytes,
  escPosCut,
  escPosRasterImage,
  escPosReset,
  escPosSetStyles,
  escPosText,
  wrapText,
  type PosPaperSize,
  type RasterImage,
} from '../printing/escpos.js';

/** Spalten des Testblatts -- immer 58-mm-Format. */
export const CODE_TABLE_TEST_SHEET_CHARS = 32;

export interface CodeTableTestSheetInput {
  /** Kassen-Kennung fuer die Kopfzeile (keine Personendaten). */
  cashregisterLabel: string;
  /** Zeitpunkt des Drucks; die Kopfzeile zeigt ihn in Wiener Zeit. */
  time: Date;
  /** Papier des Druckers; das Blatt bleibt 32 Spalten, auf 80 mm mittig. */
  paper: PosPaperSize;
}

/** Eine Testzeile: Nummer, Tabelle und die Zeichen, die ihr fehlen (fuer „ohne €“ am Bildschirm). */
export interface CodeTableTestSheetRow {
  readonly number: CodeTable['number'];
  readonly codeTable: CodeTableId;
  readonly missing: readonly string[];
}

/** Das Testblatt im Zeilenmodell des Beleg-Blatts, dazu die Testzeilen. */
export interface CodeTableTestSheet extends ReceiptSheet {
  readonly rows: readonly CodeTableTestSheetRow[];
}

/** Die zehn Zeichen der Vorlage, in der Reihenfolge des Katalogs. */
const VORLAGE = ['ä', 'ö', 'ü', 'Ä', 'Ö', 'Ü', 'ß', '€', '§', '°'] as const;
/** Spalte des ersten Zeichens; danach jede zweite. Muss zu scripts/zeichensatz-vorlage.py passen. */
const ERSTE_SPALTE = 5;
/** Breite der Nummernzelle: eine Ziffer doppelt breit. */
const NUMMER_SPALTEN = 2;
const TRENNER = ' | ';

/** Punkte je Blatt-Zeile: 32 Zeichen zu 12 Punkten. */
const BLATT_PUNKTE = CODE_TABLE_TEST_SHEET_CHARS * 12;
/** Linker Rand, der den 32-Spalten-Block auf 80 mm (576 Punkte) mittig setzt. */
const RAND_80 = (576 - BLATT_PUNKTE) / 2;

const GS = 0x1d;

/** Die Vorlage-Zeile als Rasterbild (384 x 24 Punkte), wie sie am Papier steht. */
export function codeTableReferenceImage(): RasterImage {
  const r = CODE_TABLE_REFERENCE_RASTER;
  return entpackeRasterBits(r.bits, r.width, r.height);
}

/** Text in reines ASCII (Ersatzbuchstaben): steht auf jedem Drucker gleich, egal welche Tabelle gilt. */
function nurAscii(text: string): string {
  return String.fromCharCode(...encodeForCodeTable(text, 'replacement'));
}

type Zeile = Extract<SheetBlock, { kind: 'line' }>;

function zeile(text: string, bold = false, ausrichtung: 'left' | 'center' = 'left'): Zeile {
  const rest = CODE_TABLE_TEST_SHEET_CHARS - text.length;
  const links = ausrichtung === 'center' ? Math.floor(rest / 2) : 0;
  return { kind: 'line', text: ' '.repeat(links) + text + ' '.repeat(rest - links), bold, blank: false };
}

function zeilen(text: string, bold = false, ausrichtung: 'left' | 'center' = 'left'): SheetBlock[] {
  return wrapText(nurAscii(text), CODE_TABLE_TEST_SHEET_CHARS).map((t) => zeile(t, bold, ausrichtung));
}

/** Die Zeichen einer Tabelle an ihren Spalten; ein fehlendes Zeichen laesst seine Luecke. */
function zeichenDerTabelle(tabelle: CodeTable): string {
  return VORLAGE.map((z) => (tabelle.missing.includes(z) ? ' ' : z)).join(' ').trimEnd();
}

function nummernZeile(nummer: number, text: string): Zeile {
  const kopf = String(nummer).padStart(NUMMER_SPALTEN, ' ') + TRENNER;
  return { ...zeile(kopf + text), doubleSizeLead: NUMMER_SPALTEN };
}

const zweistellig = (n: number): string => String(n).padStart(2, '0');

/** Das Testblatt im Zeilenmodell des Beleg-Blatts -- dieselben Zeilen wie am Papier. */
export function codeTableTestSheet(options: CodeTableTestSheetInput): CodeTableTestSheet {
  const z = CODE_TABLE_TEST_SHEET_CHARS;
  const uhr = toViennaWallClock(options.time);
  const zeit = `${zweistellig(uhr.day)}.${zweistellig(uhr.month)}. ${zweistellig(uhr.hour)}:${zweistellig(uhr.minute)}`;
  const doppelt = zeile('='.repeat(z));
  const einfach = zeile('-'.repeat(z));
  const einzug = ' '.repeat(ERSTE_SPALTE);

  const bloecke: SheetBlock[] = [
    doppelt,
    ...zeilen(labelText('codetable.title'), true, 'center'),
    ...zeilen(`${options.cashregisterLabel.trim()}  ${zeit}`, false, 'center'),
    doppelt,
    ...zeilen(labelText('codetable.reference')),
    // Am Papier ein Bild (`codeTableReferenceImage`), am Bildschirm Text.
    zeile(einzug + VORLAGE.join(' ')),
    einfach,
  ];
  const ersatz = CODE_TABLES.find((t) => t.id === 'replacement')!;
  for (const t of CODE_TABLES) {
    if (t === ersatz) continue;
    bloecke.push(nummernZeile(t.number, zeichenDerTabelle(t)));
  }
  bloecke.push(einfach);
  const ersatzText = String.fromCharCode(...encodeForCodeTable(VORLAGE.join(' '), 'replacement'));
  const [ersteErsatz = '', ...restErsatz] = wrapText(ersatzText, z - ERSTE_SPALTE);
  bloecke.push(nummernZeile(ersatz.number, ersteErsatz));
  for (const t of restErsatz) bloecke.push(zeile(einzug + t));
  bloecke.push(zeile(einzug + nurAscii(labelText('codetable.replacement_note'))));
  bloecke.push(doppelt);
  bloecke.push(...zeilen(messageText('codetable.instruction')));
  bloecke.push(doppelt);

  return {
    charsPerLine: z,
    blocks: bloecke,
    rows: CODE_TABLES.map((t) => ({ number: t.number, codeTable: t.id, missing: t.missing })),
  };
}

/**
 * Das Testblatt als ESC/POS-Bytes. Jede Testzeile schaltet mit `FS .` +
 * `ESC t n` auf ihre Tabelle und traegt deren Bytes (`encodeForCodeTable`,
 * also das echte €-Byte, wo die Tabelle es hat). Die Nummer steht doppelt
 * breit und hoch (`GS !`), die Vorlage als Rasterbild (`GS v 0`).
 */
export function codeTableTestSheetBytes(options: CodeTableTestSheetInput): Uint8Array {
  const blatt = codeTableTestSheet(options);
  // Das Dokument ist immer 58 mm: 32 Spalten, Druckbereich 384 Punkte.
  const doc = createEscPosDocument({ paperSize: 'mm58', codeTable: null });
  escPosReset(doc);
  if (options.paper === 'mm80') doc.bytes.push(GS, 0x4c, RAND_80 & 0xff, RAND_80 >> 8);

  const vorlage = blatt.blocks[blatt.blocks.findIndex((b) => b.kind === 'line' && b.text.trim() === labelText('codetable.reference')) + 1];
  let tabellen = 0;
  for (const block of blatt.blocks) {
    if (block.kind !== 'line') continue;
    if (block === vorlage) {
      escPosRasterImage(doc, codeTableReferenceImage(), { align: 'left' });
      continue;
    }
    if (block.doubleSizeLead === undefined) {
      escPosText(doc, block.text.trimEnd(), { styles: { align: 'left', bold: block.bold } });
      continue;
    }
    const tabelle = blatt.rows[tabellen]!;
    tabellen += 1;
    const nummer = block.text.slice(0, block.doubleSizeLead).trim();
    escPosSetStyles(doc, { align: 'left', bold: true, width: 2, height: 2, codeTable: tabelle.codeTable });
    doc.bytes.push(...encodeForCodeTable(nummer, tabelle.codeTable));
    escPosSetStyles(doc, { align: 'left', codeTable: tabelle.codeTable });
    doc.bytes.push(...encodeForCodeTable(block.text.slice(block.doubleSizeLead).trimEnd(), tabelle.codeTable), 0x0a);
  }
  escPosCut(doc, 'full');
  return escPosBytes(doc);
}
