/**
 * ESC/POS-Bytefolgen fuer Bondrucker — Zwilling von
 * `kasseneck_api/lib/src/printing/escpos/` (Flutter).
 *
 * Dieses Modul erzeugt **nur Bytes**. Es kennt keinen Transport: kein
 * Bluetooth, kein WLAN, kein USB, keine Verbindung. Wer die Bytes wohin
 * schickt, entscheidet der Aufrufer.
 *
 * Die Steuerbefehle sind wortwoertlich aus `commands.dart`, `generator.dart`
 * und `qrcode.dart` uebernommen. Bei ESC/POS zaehlt jedes Byte: ein
 * "ungefaehr richtiger" Befehl druckt Unsinn oder gar nichts. Reihenfolge und
 * Bytefolge deshalb nicht anpassen, ohne die Erwartungswerte in
 * `test/escpos.test.ts` gegen das Flutter-Vorbild neu abzugleichen.
 *
 * **Zeichenkodierung.** Bondrucker sprechen kein UTF-8, sondern eine
 * Codepage. Dieses Modul kodiert Text wie das Vorbild nach Latin-1 (ein Byte
 * je Zeichen) und meldet dem Drucker dazu die passende Codepage ueber
 * `ESC t n`. Vorgabe ist CP1252: dort stehen alle deutschen Umlaute an
 * denselben Stellen wie in Latin-1, "ä" ist also genau 0xE4 — ein Byte, nicht
 * zwei. Waeren es zwei (UTF-8), verschoeben sich zusaetzlich alle
 * Spaltenbreiten, weil die Spaltenrechnung mit Byte-Laengen arbeitet.
 * CP437 ist ebenfalls waehlbar — manche (Bluetooth-)Drucker ignorieren
 * `ESC t 16` und bleiben in CP437; dann werden die Umlaute auf ihre
 * CP437-Plaetze umkodiert (ä = 0x84, ü = 0x81, ß = 0xE1, ...). Zeichen ohne
 * CP437-Platz werden zu `?` — weiterhin ein Byte je Zeichen.
 *
 * Nicht enthalten (bewusst): Rasterbilder/Logos, Capability-Profile einzelner
 * Druckermodelle, Kassenlade, 1D-Barcodes.
 */

// ------------------------------------------------------------------- Typen

/** Papierbreite der Bonrolle. */
export type PosPaperSize = 'mm58' | 'mm80';

/** Ausrichtung einer Textzeile bzw. innerhalb einer Spalte. */
export type PosAlign = 'left' | 'center' | 'right';

/** Druckerschrift: A ist breiter, B schmaler (mehr Zeichen je Zeile). */
export type PosFont = 'fontA' | 'fontB';

/** Voller oder teilweiser Papierschnitt. */
export type PosCutMode = 'full' | 'partial';

/** Vom Drucker zu verwendende Codepage. */
export type PosCodeTable = 'CP437' | 'CP1252';

/** Zeichenvergroesserung (1 = einfach, 2 = doppelt, ... bis 8). */
export type PosTextSize = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** Modulgroesse des QR-Codes (Punkte je Modul). */
export type QrSize = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** Fehlerkorrekturstufe des QR-Codes. */
export type QrCorrection = 'L' | 'M' | 'Q' | 'H';

/** Textstil. Fehlende Felder gelten als Vorgabewert (nicht als "unveraendert"). */
export interface PosStyles {
  bold?: boolean;
  reverse?: boolean;
  underline?: boolean;
  turn90?: boolean;
  align?: PosAlign;
  height?: PosTextSize;
  width?: PosTextSize;
  fontType?: PosFont;
  codeTable?: PosCodeTable;
}

/**
 * Eine Spalte einer Zeile. `width` ist ein Zwoelftel-Anteil (1..12), die
 * Breiten aller Spalten einer Zeile muessen zusammen 12 ergeben.
 * Entweder `text` **oder** `textEncoded` angeben, nicht beides.
 */
export interface PosColumn {
  text?: string;
  textEncoded?: Uint8Array;
  width: number;
  styles?: PosStyles;
}

export interface EscPosOptions {
  /** Papierbreite, Vorgabe `mm58`. */
  paperSize?: PosPaperSize;
  /** Globale Codepage, Vorgabe `CP1252`; `null` laesst die des Druckers stehen. */
  codeTable?: PosCodeTable | null;
  /** Abstand zwischen Spalten in Punkten, Vorgabe 5. */
  spaceBetweenRows?: number;
}

export interface EscPosTextOptions {
  styles?: PosStyles;
  /** Zusaetzliche Leerzeilen nach dem Text (der eine Zeilenumbruch kommt immer). */
  linesAfter?: number;
}

export interface EscPosHrOptions {
  /** Fuellzeichen, Vorgabe `-`. */
  ch?: string;
  /** Laenge in Zeichen; ohne Angabe die volle Zeilenbreite. */
  len?: number;
  linesAfter?: number;
}

export interface EscPosQrOptions {
  align?: PosAlign;
  size?: QrSize;
  correction?: QrCorrection;
}

/** Interner Stilzustand — immer vollstaendig, nie teilbefuellt. */
interface AktuelleStile {
  bold: boolean;
  reverse: boolean;
  underline: boolean;
  turn90: boolean;
  align: PosAlign;
  height: PosTextSize;
  width: PosTextSize;
  fontType: PosFont | null;
  codeTable: PosCodeTable | null;
}

/**
 * Aufbauender Puffer. Die Felder ausser `paperSize`/`spaceBetweenRows` sind
 * interner Zustand des Bytestroms — nicht von aussen aendern, sondern ueber
 * die `escPos*`-Funktionen.
 */
export interface EscPosDocument {
  readonly paperSize: PosPaperSize;
  readonly spaceBetweenRows: number;
  /** intern: bisher erzeugte Bytes */
  readonly bytes: number[];
  /** intern: global gesetzte Codepage (ueberlebt `escPosReset`) */
  globalCodeTable: PosCodeTable | null;
  /** intern: global gesetzte Schrift (ueberlebt `escPosReset`) */
  globalFont: PosFont | null;
  /** intern: Zeichen je Zeile aus der globalen Schrift */
  maxCharsPerLine: number | null;
  /** intern: zuletzt an den Drucker gesendeter Stil */
  styles: AktuelleStile;
}

// -------------------------------------------------------------- Befehlsbytes
// Wortwoertlich aus commands.dart. Die Zahlen sind ASCII-Codes der dortigen
// Zeichenketten: cCutFull = '$gs' + 'V0' ist GS 0x56 0x30 — die Ziffer '0',
// nicht der Nullwert.

const ESC = 0x1b;
const GS = 0x1d;
const FS = 0x1c;

const C_INIT = [ESC, 0x40] as const; // ESC @
const C_CUT_FULL = [GS, 0x56, 0x30] as const; // GS V '0'
const C_CUT_PART = [GS, 0x56, 0x31] as const; // GS V '1'
const C_REVERSE_ON = [GS, 0x42, 0x01] as const; // GS B 1
const C_REVERSE_OFF = [GS, 0x42, 0x00] as const; // GS B 0
const C_SIZE = [GS, 0x21] as const; // GS ! n
const C_UNDERLINE_OFF = [ESC, 0x2d, 0x00] as const; // ESC - 0
const C_UNDERLINE_1DOT = [ESC, 0x2d, 0x01] as const; // ESC - 1
const C_BOLD_ON = [ESC, 0x45, 0x01] as const; // ESC E 1
const C_BOLD_OFF = [ESC, 0x45, 0x00] as const; // ESC E 0
const C_FONT_A = [ESC, 0x4d, 0x00] as const; // ESC M 0
const C_FONT_B = [ESC, 0x4d, 0x01] as const; // ESC M 1
const C_TURN90_ON = [ESC, 0x56, 0x01] as const; // ESC V 1
const C_TURN90_OFF = [ESC, 0x56, 0x00] as const; // ESC V 0
const C_CODE_TABLE = [ESC, 0x74] as const; // ESC t n
const C_KANJI_OFF = [FS, 0x2e] as const; // FS .
const C_ALIGN_LEFT = [ESC, 0x61, 0x30] as const; // ESC a '0'
const C_ALIGN_CENTER = [ESC, 0x61, 0x31] as const; // ESC a '1'
const C_ALIGN_RIGHT = [ESC, 0x61, 0x32] as const; // ESC a '2'
const C_POS = [ESC, 0x24] as const; // ESC $ nL nH
const C_FEED_N = [ESC, 0x64] as const; // ESC d n
const C_QR_HEADER = [GS, 0x28, 0x6b] as const; // GS ( k
const ZEILENUMBRUCH = 0x0a;

/** Codepage-Nummern fuer `ESC t n` — aus capability_profile.dart. */
const CODEPAGE_ID: Readonly<Record<PosCodeTable, number>> = { CP437: 0, CP1252: 16 };

/** Korrekturstufen fuer GS ( k Funktion 169 — aus qrcode.dart. */
const QR_KORREKTUR: Readonly<Record<QrCorrection, number>> = { L: 48, M: 49, Q: 50, H: 51 };

/** Druckbreite in Punkten je Papierformat — aus enums.dart (EscPaperSize.width). */
const PAPIER_BREITE: Readonly<Record<PosPaperSize, number>> = { mm58: 372, mm80: 558 };

/** Zeichen je Zeile nach Papier und Schrift — aus generator.dart. */
const ZEICHEN_JE_ZEILE: Readonly<Record<PosPaperSize, Readonly<Record<PosFont, number>>>> = {
  mm58: { fontA: 32, fontB: 42 },
  mm80: { fontA: 48, fontB: 64 },
};

/**
 * Zeichen, die das Vorbild vor dem Kodieren ersetzt (generator.dart `_encode`).
 *
 * **Eine bewusste Abweichung:** Fuer `•` sagt generator.dart `.`,
 * print_paper.dart (portiert als `escPosPrintableText`) dagegen `*`. In Darts
 * eigener Kette faellt das nie auf, weil print_paper vor dem Erzeuger ersetzt
 * und der Erzeuger den Punkt nie zu sehen bekommt — die gedruckte Antwort ist
 * dort also `*`. Ein Verbraucher dieses Pakets kann `escPosText` aber auch
 * direkt aufrufen, und dann duerfen nicht zwei Zeichen fuer dasselbe Zeichen
 * herauskommen. Deshalb gilt hier dieselbe Antwort wie dort.
 */
const ZEICHEN_ERSATZ: ReadonlyArray<readonly [string, string]> = [
  ['’', "'"], // typografisches Apostroph
  ['´', "'"], // Akut
  ['•', '*'], // Aufzaehlungspunkt (siehe Kommentar oben)
];

// ------------------------------------------------------------------ Helfer

function anhaengen(doc: EscPosDocument, bytes: ArrayLike<number>): void {
  const ziel = doc.bytes;
  for (let i = 0; i < bytes.length; i++) {
    ziel.push(bytes[i] as number);
  }
}

/** Dart rundet .5 vom Nullpunkt weg; JS rundet dort Richtung +unendlich. */
function runden(wert: number): number {
  return wert < 0 ? -Math.round(-wert) : Math.round(wert);
}

function istGanzzahl(wert: unknown): wert is number {
  return typeof wert === 'number' && Number.isInteger(wert);
}

/** Latin-1 ohne Ersetzungen — so kodiert qrcode.dart die QR-Nutzlast. */
function latin1(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0xff) {
      const stelle = code.toString(16).toUpperCase().padStart(4, '0');
      throw new Error(
        `Zeichen "${text.charAt(i)}" (U+${stelle}) an Position ${i} laesst sich nicht ` +
          'in Latin-1 drucken. Text vor der Ausgabe ersetzen ' +
          '(Bondrucker koennen nur eine Ein-Byte-Codepage).',
      );
    }
    bytes[i] = code;
  }
  return bytes;
}

/**
 * Kodiert Text so, wie ihn der Drucker erwartet: ein Byte je Zeichen nach
 * Latin-1, vorher die vier Zeichenersetzungen des Vorbilds. Ein Umlaut wird
 * damit zu genau einem Byte — Voraussetzung dafuer, dass die Spaltenrechnung
 * stimmt.
 */
export function encodeEscPosText(text: string, codeTable: PosCodeTable = 'CP1252'): Uint8Array {
  let aufbereitet = text;
  for (const [von, nach] of ZEICHEN_ERSATZ) {
    aufbereitet = aufbereitet.split(von).join(nach);
  }
  const bytes = latin1(aufbereitet);
  if (codeTable !== 'CP437') return bytes;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] ?? 0;
    if (b >= 0x80) bytes[i] = CP437_AUS_LATIN1.get(b) ?? 0x3f;
  }
  return bytes;
}

/**
 * Latin-1-Byte -> CP437-Byte fuer die Zeichen, die CP437 kennt (deutsche
 * Umlaute, ß, westeuropaeische Akzente, Waehrungs-/Sonderzeichen). Alles
 * andere ab 0x80 hat in CP437 keinen Platz und wird zu "?".
 */
const CP437_AUS_LATIN1: ReadonlyMap<number, number> = new Map<number, number>([
  [0xc7, 0x80], [0xfc, 0x81], [0xe9, 0x82], [0xe2, 0x83], [0xe4, 0x84], [0xe0, 0x85], [0xe5, 0x86], [0xe7, 0x87],
  [0xea, 0x88], [0xeb, 0x89], [0xe8, 0x8a], [0xef, 0x8b], [0xee, 0x8c], [0xec, 0x8d], [0xc4, 0x8e], [0xc5, 0x8f],
  [0xc9, 0x90], [0xe6, 0x91], [0xc6, 0x92], [0xf4, 0x93], [0xf6, 0x94], [0xf2, 0x95], [0xfb, 0x96], [0xf9, 0x97],
  [0xff, 0x98], [0xd6, 0x99], [0xdc, 0x9a], [0xa2, 0x9b], [0xa3, 0x9c], [0xa5, 0x9d], [0xe1, 0xa0], [0xed, 0xa1],
  [0xf3, 0xa2], [0xfa, 0xa3], [0xf1, 0xa4], [0xd1, 0xa5], [0xaa, 0xa6], [0xba, 0xa7], [0xbf, 0xa8], [0xac, 0xaa],
  [0xbd, 0xab], [0xbc, 0xac], [0xa1, 0xad], [0xab, 0xae], [0xbb, 0xaf], [0xdf, 0xe1], [0xb5, 0xe6], [0xb1, 0xf1],
  [0xf7, 0xf6], [0xb0, 0xf8], [0xb7, 0xfa], [0xb2, 0xfd], [0xa0, 0xff],
]);

/** Zeichen je Zeile fuer Papier und Schrift (`fontA`, wenn nichts gesetzt ist). */
export function escPosMaxCharsPerLine(paperSize: PosPaperSize, font?: PosFont | null): number {
  const breiten = ZEICHEN_JE_ZEILE[paperSize];
  if (breiten === undefined) {
    throw new Error(`Unbekannte Papierbreite: ${String(paperSize)}`);
  }
  return font === 'fontB' ? breiten.fontB : breiten.fontA;
}

function vollstaendigeStile(styles: PosStyles = {}): AktuelleStile {
  return {
    bold: styles.bold ?? false,
    reverse: styles.reverse ?? false,
    underline: styles.underline ?? false,
    turn90: styles.turn90 ?? false,
    align: styles.align ?? 'left',
    height: styles.height ?? 1,
    width: styles.width ?? 1,
    fontType: styles.fontType ?? null,
    codeTable: styles.codeTable ?? null,
  };
}

/** GS ! n: obere vier Bit = Breite, untere vier = Hoehe (enums.dart decSize). */
function groessenByte(height: PosTextSize, width: PosTextSize): number {
  return 16 * (width - 1) + (height - 1);
}

function zeichenProZeile(doc: EscPosDocument, stile: AktuelleStile): number {
  if (stile.fontType !== null) return escPosMaxCharsPerLine(doc.paperSize, stile.fontType);
  return doc.maxCharsPerLine ?? escPosMaxCharsPerLine(doc.paperSize, doc.styles.fontType);
}

/** Breite eines Zeichens in Punkten, inklusive Vergroesserungsfaktor. */
function zeichenBreite(doc: EscPosDocument, stile: AktuelleStile): number {
  const proZeile = zeichenProZeile(doc, stile);
  return (PAPIER_BREITE[doc.paperSize] / proZeile) * stile.width;
}

/** Linker Rand eines Zwoelftel-Rasterindex in Punkten. */
function spaltenPosition(doc: EscPosDocument, spaltenIndex: number): number {
  const breite = PAPIER_BREITE[doc.paperSize];
  return spaltenIndex === 0 ? 0 : (breite * spaltenIndex) / 12 - 1;
}

// ------------------------------------------------------------- oeffentlich

/** Legt einen leeren Bytepuffer an. Der erste Befehl ist ueblicherweise `escPosReset`. */
export function createEscPosDocument(options: EscPosOptions = {}): EscPosDocument {
  const paperSize = options.paperSize ?? 'mm58';
  if (PAPIER_BREITE[paperSize] === undefined) {
    throw new Error(`Unbekannte Papierbreite: ${String(paperSize)}`);
  }
  const codeTable = options.codeTable === undefined ? 'CP1252' : options.codeTable;
  if (codeTable !== null && CODEPAGE_ID[codeTable] === undefined) {
    throw new Error(`Unbekannte Codepage: ${String(codeTable)}`);
  }
  const spaceBetweenRows = options.spaceBetweenRows ?? 5;
  if (!istGanzzahl(spaceBetweenRows) || spaceBetweenRows < 0) {
    throw new Error('spaceBetweenRows muss eine Ganzzahl >= 0 sein');
  }
  return {
    paperSize,
    spaceBetweenRows,
    bytes: [],
    globalCodeTable: codeTable,
    globalFont: null,
    maxCharsPerLine: null,
    styles: vollstaendigeStile(),
    };
}

/** Die bisher erzeugten Bytes als Kopie. */
export function escPosBytes(doc: EscPosDocument): Uint8Array {
  return Uint8Array.from(doc.bytes);
}

/**
 * `ESC @`: Drucker initialisieren und den gemerkten Stil verwerfen. Danach
 * werden globale Codepage und Schrift erneut gesendet — der Drucker vergisst
 * sie beim Initialisieren.
 */
export function escPosReset(doc: EscPosDocument): void {
  anhaengen(doc, C_INIT);
  doc.styles = vollstaendigeStile();
  escPosSetGlobalCodeTable(doc, doc.globalCodeTable);
  escPosSetGlobalFont(doc, doc.globalFont);
}

/**
 * `ESC t n`: Codepage waehlen. Sie gilt bis zum naechsten `escPosReset` und
 * wird von diesem erneut gesendet. `null` schaltet die Vorgabe ab; dann
 * bleibt die Codepage des Druckers stehen und Umlaute werden unlesbar.
 */
export function escPosSetGlobalCodeTable(
  doc: EscPosDocument,
  codeTable: PosCodeTable | null,
): void {
  if (codeTable !== null && CODEPAGE_ID[codeTable] === undefined) {
    throw new Error(`Unbekannte Codepage: ${String(codeTable)}`);
  }
  doc.globalCodeTable = codeTable;
  if (codeTable !== null) {
    anhaengen(doc, [...C_CODE_TABLE, CODEPAGE_ID[codeTable]]);
    doc.styles.codeTable = codeTable;
  }
}

/**
 * `ESC M n`: Schrift waehlen. Die Schrift bestimmt auch, wie viele Zeichen in
 * eine Zeile passen (32/42 bei 58 mm, 48/64 bei 80 mm).
 */
export function escPosSetGlobalFont(
  doc: EscPosDocument,
  font: PosFont | null,
  options: { maxCharsPerLine?: number } = {},
): void {
  doc.globalFont = font;
  if (font === null) return;
  const grenze = options.maxCharsPerLine ?? escPosMaxCharsPerLine(doc.paperSize, font);
  if (!istGanzzahl(grenze) || grenze < 1) {
    throw new Error('maxCharsPerLine muss eine Ganzzahl >= 1 sein');
  }
  doc.maxCharsPerLine = grenze;
  anhaengen(doc, font === 'fontB' ? C_FONT_B : C_FONT_A);
  doc.styles.fontType = font;
}

/**
 * Sendet die Stilbefehle, die sich gegenueber dem zuletzt gesendeten Stand
 * geaendert haben. Fehlende Felder in [styles] gelten als Vorgabe: wer fett
 * weglaesst, schaltet fett also ab.
 */
export function escPosSetStyles(doc: EscPosDocument, styles: PosStyles = {}): void {
  const neu = vollstaendigeStile(styles);
  const alt = doc.styles;

  if (neu.align !== alt.align) {
    anhaengen(
      doc,
      neu.align === 'left' ? C_ALIGN_LEFT : neu.align === 'center' ? C_ALIGN_CENTER : C_ALIGN_RIGHT,
    );
    alt.align = neu.align;
  }
  if (neu.bold !== alt.bold) {
    anhaengen(doc, neu.bold ? C_BOLD_ON : C_BOLD_OFF);
    alt.bold = neu.bold;
  }
  if (neu.turn90 !== alt.turn90) {
    anhaengen(doc, neu.turn90 ? C_TURN90_ON : C_TURN90_OFF);
    alt.turn90 = neu.turn90;
  }
  if (neu.reverse !== alt.reverse) {
    anhaengen(doc, neu.reverse ? C_REVERSE_ON : C_REVERSE_OFF);
    alt.reverse = neu.reverse;
  }
  if (neu.underline !== alt.underline) {
    anhaengen(doc, neu.underline ? C_UNDERLINE_1DOT : C_UNDERLINE_OFF);
    alt.underline = neu.underline;
  }

  if (neu.fontType !== null && neu.fontType !== alt.fontType) {
    anhaengen(doc, neu.fontType === 'fontB' ? C_FONT_B : C_FONT_A);
    alt.fontType = neu.fontType;
  } else if (doc.globalFont !== null && doc.globalFont !== alt.fontType) {
    anhaengen(doc, doc.globalFont === 'fontB' ? C_FONT_B : C_FONT_A);
    alt.fontType = doc.globalFont;
  }

  if (neu.height !== alt.height || neu.width !== alt.width) {
    anhaengen(doc, [...C_SIZE, groessenByte(neu.height, neu.width)]);
    alt.height = neu.height;
    alt.width = neu.width;
  }

  // Kanji-Modus abschalten: sonst deutet der Drucker Byte-Paare als
  // Doppelbyte-Zeichen. Wird bewusst jedes Mal gesendet.
  anhaengen(doc, C_KANJI_OFF);

  const codepage = neu.codeTable ?? doc.globalCodeTable;
  if (codepage !== null) {
    anhaengen(doc, [...C_CODE_TABLE, CODEPAGE_ID[codepage]]);
    alt.codeTable = codepage;
  }
}

/**
 * Interner Textdruck: absolute Position setzen (`ESC $`), Stil senden, Bytes
 * ausgeben. [colInd]/[colWidth] beschreiben die Spalte im Zwoelftel-Raster.
 */
/**
 * Wortweiser Umbruch von (kodierten) Text-Bytes auf hoechstens `max` Zeichen
 * je Zeile: geschnitten wird am letzten Leerzeichen innerhalb der Grenze
 * (das Leerzeichen selbst faellt weg); gibt es keines, hart bei `max` --
 * sonst kaeme die Zeile nie voran. Ein Bondrucker bricht sonst hart mitten
 * im Wort ("Kleinunter|nehmer", "0,7|9"); das soll nie aufs Papier.
 */
export function escPosWortzeilen(textBytes: Uint8Array, max: number): Uint8Array[] {
  const grenze = Math.max(1, Math.floor(max));
  const out: Uint8Array[] = [];
  let rest = textBytes;
  while (rest.length > grenze) {
    let schnitt = grenze;
    if (rest[grenze] === 0x20) {
      schnitt = grenze;
    } else {
      let i = grenze - 1;
      while (i > 0 && rest[i] !== 0x20) i -= 1;
      if (i > 0) schnitt = i;
      else {
        let h = grenze - 1;
        while (h > 0 && rest[h] !== 0x2d) h -= 1; // Bindestrich
        if (h > 0) schnitt = h + 1;
      }
    }
    let ende = schnitt;
    while (ende > 0 && rest[ende - 1] === 0x20) ende -= 1; // Leerzeichen am Zeilenende weg
    out.push(ohneNbsp(rest.slice(0, ende)));
    let weiter = schnitt;
    while (weiter < rest.length && rest[weiter] === 0x20) weiter += 1;
    rest = rest.slice(weiter);
  }
  out.push(ohneNbsp(rest));
  return out;
}

/** Geschuetztes Leerzeichen (0xA0, Latin-1) -> normales Leerzeichen fuer die Ausgabe. */
function ohneNbsp(b: Uint8Array): Uint8Array {
  if (!b.some((x) => x === 0xa0)) return b;
  return b.map((x) => (x === 0xa0 ? 0x20 : x));
}

/** Zeilen wieder zu einem Text (mit Leerzeichen) -- fuer den Rest einer Spalte. */
function verketten(teile: Uint8Array[]): Uint8Array {
  const laenge = teile.reduce((n, t) => n + t.length, 0) + Math.max(0, teile.length - 1);
  const out = new Uint8Array(laenge);
  let pos = 0;
  teile.forEach((t, i) => {
    if (i > 0) { out[pos] = 0x20; pos += 1; }
    out.set(t, pos);
    pos += t.length;
  });
  return out;
}

/**
 * Dieselbe Regel fuer Zeichenketten -- fuer Bildschirm-Vorschauen, die das
 * Papier nachstellen, und fuer das Zeichenraster. Zusaetzlich:
 * - geschuetztes Leerzeichen (U+00A0) ist kein Umbruchpunkt ("je 0,79" bleibt
 *   zusammen) und wird als normales Leerzeichen ausgegeben;
 * - ein ueberlanges Wort bricht nach einem Bindestrich, wenn es einen hat
 *   ("Bio-" / "Dinkelvollkornsemmel"), sonst hart.
 */
export function wortzeilenText(text: string, max: number): string[] {
  const grenze = Math.max(1, Math.floor(max));
  const out: string[] = [];
  let rest = text;
  while (rest.length > grenze) {
    let schnitt = grenze;
    if (rest[grenze] !== ' ') {
      let i = grenze - 1;
      while (i > 0 && rest[i] !== ' ') i -= 1;
      if (i > 0) schnitt = i;
      else {
        // kein Leerzeichen: nach dem letzten Bindestrich innerhalb der Grenze brechen
        let h = grenze - 1;
        while (h > 0 && rest[h] !== '-') h -= 1;
        if (h > 0) schnitt = h + 1;
      }
    }
    out.push(rest.slice(0, schnitt).replace(/ +$/, '').replace(/\u00a0/g, ' '));
    let weiter = schnitt;
    while (weiter < rest.length && rest[weiter] === ' ') weiter += 1;
    rest = rest.slice(weiter);
  }
  out.push(rest.replace(/\u00a0/g, ' '));
  return out;
}

function textIntern(
  doc: EscPosDocument,
  textBytes: Uint8Array,
  optionen: {
    styles?: PosStyles;
    colInd?: number;
    colWidth?: number;
  } = {},
): void {
  const stile = vollstaendigeStile(optionen.styles);
  const colInd = optionen.colInd ?? 0;
  const colWidth = optionen.colWidth ?? 12;

  const breiteJeZeichen = zeichenBreite(doc, stile);
  let von = spaltenPosition(doc, colInd);

  if (colWidth !== 12) {
    const bis = spaltenPosition(doc, colInd + colWidth) - doc.spaceBetweenRows;
    const textLaenge = textBytes.length * breiteJeZeichen;
    if (stile.align === 'right') {
      von = bis - textLaenge;
    } else if (stile.align === 'center') {
      von = von + (bis - von) / 2 - textLaenge / 2;
    }
    if (von < 0) von = 0;
  }

  const position = runden(von);
  anhaengen(doc, [...C_POS, position & 0xff, (position >> 8) & 0xff]);
  escPosSetStyles(doc, optionen.styles);
  anhaengen(doc, textBytes);
}

/**
 * Druckt Text und schliesst die Zeile ab. Nach dem Text folgt immer genau ein
 * Zeilenumbruch, `linesAfter` haengt weitere an.
 */
export function escPosText(doc: EscPosDocument, text: string, options: EscPosTextOptions = {}): void {
  const zusaetzlich = options.linesAfter ?? 0;
  if (!istGanzzahl(zusaetzlich) || zusaetzlich < 0) {
    throw new Error('linesAfter muss eine Ganzzahl >= 0 sein');
  }
  // Laengere Texte wortweise auf die Zeilenbreite brechen -- der Drucker
  // selbst wuerde hart mitten im Wort umbrechen.
  const stile = vollstaendigeStile(options.styles);
  const zeichenJeZeile = Math.max(1, Math.floor(zeichenProZeile(doc, stile) / (stile.width === 2 ? 2 : 1)));
  const zeilen = escPosWortzeilen(encodeEscPosText(text, doc.globalCodeTable ?? 'CP1252'), zeichenJeZeile);
  zeilen.forEach((z, i) => {
    textIntern(doc, z, { styles: options.styles });
    if (i < zeilen.length - 1) escPosEmptyLines(doc, 1);
  });
  escPosEmptyLines(doc, zusaetzlich + 1);
}

/** [n] Zeilenumbrueche (0x0A) — nicht der Vorschubbefehl, sondern echte Umbrueche. */
export function escPosEmptyLines(doc: EscPosDocument, n: number): void {
  if (!istGanzzahl(n) || n < 0) {
    throw new Error('Zeilenzahl muss eine Ganzzahl >= 0 sein');
  }
  for (let i = 0; i < n; i++) {
    doc.bytes.push(ZEILENUMBRUCH);
  }
}

/** `ESC d n`: Papier um [n] Zeilen vorschieben. */
export function escPosFeed(doc: EscPosDocument, n: number): void {
  if (!istGanzzahl(n) || n < 0 || n > 255) {
    throw new Error('Vorschub muss eine Ganzzahl zwischen 0 und 255 sein');
  }
  anhaengen(doc, [...C_FEED_N, n]);
}

/**
 * Papierschnitt: fuenf Leerzeilen (damit der Text ueber der Schneide steht)
 * und danach `GS V 0` bzw. `GS V 1`.
 */
export function escPosCut(doc: EscPosDocument, mode: PosCutMode = 'full'): void {
  escPosEmptyLines(doc, 5);
  anhaengen(doc, mode === 'partial' ? C_CUT_PART : C_CUT_FULL);
}

/** Trennlinie ueber die volle Zeilenbreite (oder [len] Zeichen). */
export function escPosHr(doc: EscPosDocument, options: EscPosHrOptions = {}): void {
  const zeichen = options.ch ?? '-';
  if (zeichen.length === 0) {
    throw new Error('Fuellzeichen darf nicht leer sein');
  }
  const laenge =
    options.len ?? doc.maxCharsPerLine ?? escPosMaxCharsPerLine(doc.paperSize, doc.styles.fontType);
  if (!istGanzzahl(laenge) || laenge < 0) {
    throw new Error('Laenge der Trennlinie muss eine Ganzzahl >= 0 sein');
  }
  const textOptionen: EscPosTextOptions = {};
  if (options.linesAfter !== undefined) textOptionen.linesAfter = options.linesAfter;
  escPosText(doc, zeichen.charAt(0).repeat(laenge), textOptionen);
}

/**
 * Druckt eine Zeile aus bis zu zwoelf Spalten. Die Breiten (Zwoelftel) muessen
 * zusammen 12 ergeben. Passt der Inhalt einer Spalte nicht, laeuft der Rest in
 * eine Folgezeile.
 */
export function escPosRow(doc: EscPosDocument, columns: readonly PosColumn[]): void {
  let summe = 0;
  for (const spalte of columns) {
    if (!istGanzzahl(spalte.width) || spalte.width < 1 || spalte.width > 12) {
      throw new Error('Spaltenbreite muss eine Ganzzahl im Bereich 1..12 sein');
    }
    if (
      spalte.text !== undefined &&
      spalte.text.length > 0 &&
      spalte.textEncoded !== undefined &&
      spalte.textEncoded.length > 0
    ) {
      throw new Error('Nur text oder textEncoded angeben, nicht beides');
    }
    summe += spalte.width;
  }
  if (summe !== 12) {
    throw new Error(`Die Spaltenbreiten muessen zusammen 12 ergeben (waren ${summe})`);
  }

  // Schleife statt Rekursion: bei sehr langem Spalteninhalt (und erst recht,
  // wenn die Untergrenze von einem Zeichen je Zeile greift) waeren es sonst
  // ebenso viele Aufrufrahmen wie Folgezeilen.
  let aktuelle: readonly PosColumn[] = columns;
  for (;;) {
    let hatFolgezeile = false;
    const folgezeile: PosColumn[] = [];
    let spaltenIndex = 0;

    for (const spalte of aktuelle) {
      const stile = vollstaendigeStile(spalte.styles);
      const breiteJeZeichen = zeichenBreite(doc, stile);
      const von = spaltenPosition(doc, spaltenIndex);
      const bis = spaltenPosition(doc, spaltenIndex + spalte.width) - doc.spaceBetweenRows;
      // Mindestens ein Zeichen je Zeile, sonst kaeme die Folgezeile nie voran.
      const maxZeichen = Math.max(1, Math.floor((bis - von) / breiteJeZeichen));

      let zuDrucken = spalte.textEncoded ?? encodeEscPosText(spalte.text ?? '', doc.globalCodeTable ?? 'CP1252');
      const folge: PosColumn = { width: spalte.width };
      if (spalte.styles !== undefined) folge.styles = spalte.styles;

      if (zuDrucken.length > maxZeichen) {
        // Wortweise: erste Zeile bis zum letzten Leerzeichen innerhalb der
        // Spalte, der Rest (ohne fuehrende Leerzeichen) in die Folgezeile.
        const [erste, ...weitere] = escPosWortzeilen(zuDrucken, maxZeichen);
        const rest = weitere.length ? verketten(weitere) : new Uint8Array(0);
        folge.textEncoded = rest;
        zuDrucken = erste!;
        hatFolgezeile = rest.length > 0;
      } else {
        folge.text = '';
      }
      folgezeile.push(folge);

      const textOptionen: Parameters<typeof textIntern>[2] = {
        colInd: spaltenIndex,
        colWidth: spalte.width,
      };
      if (spalte.styles !== undefined) textOptionen.styles = spalte.styles;
      textIntern(doc, zuDrucken, textOptionen);

      spaltenIndex += spalte.width;
    }

    escPosEmptyLines(doc, 1);

    if (!hatFolgezeile) return;
    aktuelle = folgezeile;
  }
}

/**
 * Bytes des nativen QR-Befehls (`GS ( k`, Funktionen 167/169/180/182/181) —
 * ohne Ausrichtung, ohne Zeilenumbruch. Der Drucker zeichnet den Code selbst;
 * es wird kein Bild uebertragen.
 *
 * Bei Kasseneck-Belegen steht hier der maschinenlesbare RKSV-Code.
 */
export function qrCodeBytes(
  text: string,
  options: { size?: QrSize; correction?: QrCorrection } = {},
): Uint8Array {
  const size = options.size ?? 4;
  if (!istGanzzahl(size) || size < 1 || size > 8) {
    throw new Error('QR-Modulgroesse muss eine Ganzzahl im Bereich 1..8 sein');
  }
  const correction = options.correction ?? 'L';
  const stufe = QR_KORREKTUR[correction];
  if (stufe === undefined) {
    throw new Error(`Unbekannte QR-Fehlerkorrektur: ${String(correction)}`);
  }

  const daten = latin1(text);
  const laenge = daten.length + 3;
  if (laenge > 0xffff) {
    throw new Error('QR-Inhalt ist zu lang');
  }

  const bytes: number[] = [];
  // Funktion 167: Modulgroesse
  bytes.push(...C_QR_HEADER, 0x03, 0x00, 0x31, 0x43, size);
  // Funktion 169: Fehlerkorrektur
  bytes.push(...C_QR_HEADER, 0x03, 0x00, 0x31, 0x45, stufe);
  // Funktion 180: Daten in den Symbolspeicher; pL/pH = Laenge + 3
  bytes.push(...C_QR_HEADER, laenge & 0xff, (laenge >> 8) & 0xff, 0x31, 0x50, 0x30);
  for (let i = 0; i < daten.length; i++) {
    bytes.push(daten[i] as number);
  }
  // Funktion 182: Groesse der Symboldaten abfragen
  bytes.push(...C_QR_HEADER, 0x03, 0x00, 0x31, 0x52, 0x30);
  // Funktion 181: Symbol drucken
  bytes.push(...C_QR_HEADER, 0x03, 0x00, 0x31, 0x51, 0x30);
  return Uint8Array.from(bytes);
}

/** Setzt die Ausrichtung und haengt den nativen QR-Befehl an. */
export function escPosQrCode(
  doc: EscPosDocument,
  text: string,
  options: EscPosQrOptions = {},
): void {
  escPosSetStyles(doc, { align: options.align ?? 'center' });
  const qrOptionen: Parameters<typeof qrCodeBytes>[1] = {};
  if (options.size !== undefined) qrOptionen.size = options.size;
  if (options.correction !== undefined) qrOptionen.correction = options.correction;
  anhaengen(doc, qrCodeBytes(text, qrOptionen));
  // Ausrichtung SOFORT zuruecksetzen: `ESC a` gilt nur am Zeilenanfang. Die
  // Spalten-Positionierung (`ESC $`) schickt ihren Reset sonst mitten in der
  // Zeile — Epson ignoriert ihn, und alles nach dem QR rueckte nach rechts
  // (belegt am TM-T20, 2026-08-20).
  if ((options.align ?? 'center') !== 'left') {
    escPosSetStyles(doc, { align: 'left' });
  }
}
