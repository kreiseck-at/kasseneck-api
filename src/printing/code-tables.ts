/**
 * Katalog der Code-Tabellen fuer Bondrucker und die Umwandlung von Text in
 * Bytes je Tabelle.
 *
 * Warum ein Katalog: `ESC t n` waehlt die Zeichentabelle, aber die Nummer n
 * ist nicht einheitlich. Epson legt WPC1252 auf 16, viele guenstige Drucker
 * nummerieren anders oder kennen die Tabelle gar nicht. Wer am Testblatt
 * sieht, welche Nummer seine Umlaute richtig druckt, waehlt hier die
 * passende Tabelle. Gemeinsamer Prueffall mit dem Dart-Zwilling:
 * `fixtures/code-tables.json`.
 *
 * Jede Tabelle setzt die zehn deutschen Zeichen (Umlaute, ß, €, §, °) auf
 * ein Byte oder, wo die Tabelle das Zeichen nicht hat, auf Ersatzbuchstaben
 * (`€` -> `EUR`). Fuer diese zehn Zeichen kommt nie `?` heraus.
 */

/** Kennung einer Code-Tabelle. */
export type CodeTableId = 'wpc1252' | 'pc858' | 'pc850' | 'pc437' | 'iso8859_15' | 'replacement';

/** Eine Code-Tabelle des Katalogs. */
export interface CodeTable {
  /** Kennung. */
  id: CodeTableId;
  /** Nummer auf dem Testblatt (1-6). */
  number: 1 | 2 | 3 | 4 | 5 | 6;
  /** n fuer `ESC t n`. */
  escT: number;
  /** Zeichen der zehn, die diese Tabelle nicht hat und durch Ersatzbuchstaben druckt. */
  missing: readonly string[];
}

/** Die zehn Zeichen, fuer die jede Tabelle eine feste Antwort hat. */
const ZEHN_ZEICHEN = ['ä', 'ö', 'ü', 'Ä', 'Ö', 'Ü', 'ß', '€', '§', '°'] as const;

/** Ersatzbuchstaben, wenn die Tabelle das Zeichen nicht hat. */
const ERSATZ_BUCHSTABEN: Readonly<Record<string, string>> = {
  'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'Ä': 'Ae', 'Ö': 'Oe', 'Ü': 'Ue', 'ß': 'ss', '€': 'EUR', '§': 'Par.', '°': 'Grad',
};

/**
 * Byte je Zeichen und Tabelle; fehlt ein Zeichen, gilt der Ersatz. Werte aus
 * den Zeichentabellen (Windows-1252, IBM 858/850/437, ISO 8859-15).
 */
const BYTES_JE_TABELLE: Readonly<Record<CodeTableId, Readonly<Record<string, number>>>> = {
  wpc1252: { 'ä': 0xe4, 'ö': 0xf6, 'ü': 0xfc, 'Ä': 0xc4, 'Ö': 0xd6, 'Ü': 0xdc, 'ß': 0xdf, '€': 0x80, '§': 0xa7, '°': 0xb0 },
  pc858: { 'ä': 0x84, 'ö': 0x94, 'ü': 0x81, 'Ä': 0x8e, 'Ö': 0x99, 'Ü': 0x9a, 'ß': 0xe1, '€': 0xd5, '§': 0xf5, '°': 0xf8 },
  pc850: { 'ä': 0x84, 'ö': 0x94, 'ü': 0x81, 'Ä': 0x8e, 'Ö': 0x99, 'Ü': 0x9a, 'ß': 0xe1, '§': 0xf5, '°': 0xf8 },
  pc437: { 'ä': 0x84, 'ö': 0x94, 'ü': 0x81, 'Ä': 0x8e, 'Ö': 0x99, 'Ü': 0x9a, 'ß': 0xe1, '°': 0xf8 },
  iso8859_15: { 'ä': 0xe4, 'ö': 0xf6, 'ü': 0xfc, 'Ä': 0xc4, 'Ö': 0xd6, 'Ü': 0xdc, 'ß': 0xdf, '€': 0xa4, '§': 0xa7, '°': 0xb0 },
  replacement: {},
};

function tabelle(id: CodeTableId, number: CodeTable['number'], escT: number): CodeTable {
  const bytes = BYTES_JE_TABELLE[id];
  return Object.freeze({ id, number, escT, missing: Object.freeze(ZEHN_ZEICHEN.filter((z) => bytes[z] === undefined)) });
}

/** Alle Code-Tabellen in der Reihenfolge des Testblatts (Nummer 1-6). */
export const CODE_TABLES: readonly CodeTable[] = Object.freeze([
  tabelle('wpc1252', 1, 16),
  tabelle('pc858', 2, 19),
  tabelle('pc850', 3, 2),
  tabelle('pc437', 4, 0),
  tabelle('iso8859_15', 5, 40),
  tabelle('replacement', 6, 0),
]);

/** Die Tabelle zu einer Kennung; eine unbekannte Kennung wird gemeldet. */
export function codeTableById(id: CodeTableId): CodeTable {
  const gefunden = CODE_TABLES.find((t) => t.id === id);
  if (gefunden === undefined) throw new Error(`Unbekannte Code-Tabelle: ${String(id)}`);
  return gefunden;
}

/**
 * Tabelle aus der gespeicherten Einstellung (`cp1252`/`cp437`). Alles andere,
 * auch keine Einstellung, ist die Vorgabe `wpc1252`.
 */
export function codeTableFromSetting(setting: 'cp1252' | 'cp437' | null | undefined): CodeTableId {
  return setting === 'cp437' ? 'pc437' : 'wpc1252';
}

/**
 * Zeichen, die das Vorbild vor dem Kodieren ersetzt (generator.dart `_encode`).
 *
 * **Eine bewusste Abweichung:** Fuer `•` sagt generator.dart `.`,
 * print_paper.dart (portiert als `escPosPrintableText`) dagegen `*`. In Darts
 * eigener Kette faellt das nie auf, weil print_paper vor dem Erzeuger ersetzt
 * und der Erzeuger den Punkt nie zu sehen bekommt -- die gedruckte Antwort ist
 * dort also `*`. Ein Verbraucher dieses Pakets kann `escPosText` aber auch
 * direkt aufrufen, und dann duerfen nicht zwei Zeichen fuer dasselbe Zeichen
 * herauskommen. Deshalb gilt hier dieselbe Antwort wie dort.
 */
export const ZEICHEN_ERSATZ: ReadonlyArray<readonly [string, string]> = [
  ['’', "'"], // typografisches Apostroph
  ['´', "'"], // Akut
  ['•', '*'], // Aufzaehlungspunkt (siehe Kommentar oben)
];

/**
 * Latin-1-Byte -> CP437-Byte fuer die Zeichen, die CP437 kennt (deutsche
 * Umlaute, ß, westeuropaeische Akzente, Waehrungs-/Sonderzeichen). Alles
 * andere ab 0x80 hat in CP437 keinen Platz und wird zu "?".
 */
export const CP437_AUS_LATIN1: ReadonlyMap<number, number> = new Map<number, number>([
  [0xc7, 0x80], [0xfc, 0x81], [0xe9, 0x82], [0xe2, 0x83], [0xe4, 0x84], [0xe0, 0x85], [0xe5, 0x86], [0xe7, 0x87],
  [0xea, 0x88], [0xeb, 0x89], [0xe8, 0x8a], [0xef, 0x8b], [0xee, 0x8c], [0xec, 0x8d], [0xc4, 0x8e], [0xc5, 0x8f],
  [0xc9, 0x90], [0xe6, 0x91], [0xc6, 0x92], [0xf4, 0x93], [0xf6, 0x94], [0xf2, 0x95], [0xfb, 0x96], [0xf9, 0x97],
  [0xff, 0x98], [0xd6, 0x99], [0xdc, 0x9a], [0xa2, 0x9b], [0xa3, 0x9c], [0xa5, 0x9d], [0xe1, 0xa0], [0xed, 0xa1],
  [0xf3, 0xa2], [0xfa, 0xa3], [0xf1, 0xa4], [0xd1, 0xa5], [0xaa, 0xa6], [0xba, 0xa7], [0xbf, 0xa8], [0xac, 0xaa],
  [0xbd, 0xab], [0xbc, 0xac], [0xa1, 0xad], [0xab, 0xae], [0xbb, 0xaf], [0xdf, 0xe1], [0xb5, 0xe6], [0xb1, 0xf1],
  [0xf7, 0xf6], [0xb0, 0xf8], [0xb7, 0xfa], [0xb2, 0xfd], [0xa0, 0xff],
]);

/**
 * Latin-1-Byte -> PC850-Byte (IBM 850, gleich fuer 858 bis auf das €, das
 * die zehn Zeichen oben schon setzen). PC850 hat fuer jedes Latin-1-Zeichen
 * ab 0xA0 einen Platz; die Steuerzeichen 0x80-0x9F werden zu "?".
 */
const PC850_AUS_LATIN1: ReadonlyMap<number, number> = new Map<number, number>([
  [0xa0, 0xff], [0xa1, 0xad], [0xa2, 0xbd], [0xa3, 0x9c], [0xa4, 0xcf], [0xa5, 0xbe], [0xa6, 0xdd], [0xa7, 0xf5],
  [0xa8, 0xf9], [0xa9, 0xb8], [0xaa, 0xa6], [0xab, 0xae], [0xac, 0xaa], [0xad, 0xf0], [0xae, 0xa9], [0xaf, 0xee],
  [0xb0, 0xf8], [0xb1, 0xf1], [0xb2, 0xfd], [0xb3, 0xfc], [0xb4, 0xef], [0xb5, 0xe6], [0xb6, 0xf4], [0xb7, 0xfa],
  [0xb8, 0xf7], [0xb9, 0xfb], [0xba, 0xa7], [0xbb, 0xaf], [0xbc, 0xac], [0xbd, 0xab], [0xbe, 0xf3], [0xbf, 0xa8],
  [0xc0, 0xb7], [0xc1, 0xb5], [0xc2, 0xb6], [0xc3, 0xc7], [0xc4, 0x8e], [0xc5, 0x8f], [0xc6, 0x92], [0xc7, 0x80],
  [0xc8, 0xd4], [0xc9, 0x90], [0xca, 0xd2], [0xcb, 0xd3], [0xcc, 0xde], [0xcd, 0xd6], [0xce, 0xd7], [0xcf, 0xd8],
  [0xd0, 0xd1], [0xd1, 0xa5], [0xd2, 0xe3], [0xd3, 0xe0], [0xd4, 0xe2], [0xd5, 0xe5], [0xd6, 0x99], [0xd7, 0x9e],
  [0xd8, 0x9d], [0xd9, 0xeb], [0xda, 0xe9], [0xdb, 0xea], [0xdc, 0x9a], [0xdd, 0xed], [0xde, 0xe8], [0xdf, 0xe1],
  [0xe0, 0x85], [0xe1, 0xa0], [0xe2, 0x83], [0xe3, 0xc6], [0xe4, 0x84], [0xe5, 0x86], [0xe6, 0x91], [0xe7, 0x87],
  [0xe8, 0x8a], [0xe9, 0x82], [0xea, 0x88], [0xeb, 0x89], [0xec, 0x8d], [0xed, 0xa1], [0xee, 0x8c], [0xef, 0x8b],
  [0xf0, 0xd0], [0xf1, 0xa4], [0xf2, 0x95], [0xf3, 0xa2], [0xf4, 0x93], [0xf5, 0xe4], [0xf6, 0x94], [0xf7, 0xf6],
  [0xf8, 0x9b], [0xf9, 0x97], [0xfa, 0xa3], [0xfb, 0x96], [0xfc, 0x81], [0xfd, 0xec], [0xfe, 0xe7], [0xff, 0x98],
]);

const FRAGEZEICHEN = 0x3f;

/**
 * Windows-1252 belegt 0x80-0x9F mit eigenen Zeichen (Latin-1 hat dort nur
 * Steuerzeichen). € setzen die zehn Zeichen, ’ und • ersetzt ZEICHEN_ERSATZ
 * vorher (eine Antwort auf jedem Ausgabeweg); der Rest steht hier.
 */
const WPC1252_NEU: ReadonlyMap<number, number> = new Map<number, number>([
  [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88],
  [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92],
  [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97], [0x02dc, 0x98], [0x2122, 0x99],
  [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
]);

/**
 * ISO 8859-15 belegt acht Stellen anders als Latin-1: dort stehen € Š š Ž ž
 * Œ œ Ÿ statt ¤ ¦ ¨ ´ ¸ ¼ ½ ¾. Die acht Latin-1-Zeichen fehlen der Tabelle
 * (Ersetzung, sonst `?`), die neuen stehen hier mit ihrem Byte (€ setzen
 * schon die zehn Zeichen). C1-Steuerzeichen (0x80-0x9F) gehen nie roh hinaus.
 */
const ISO8859_15_ANDERS: ReadonlySet<number> = new Set([0xa4, 0xa6, 0xa8, 0xb4, 0xb8, 0xbc, 0xbd, 0xbe]);
const ISO8859_15_NEU: ReadonlyMap<number, number> = new Map<number, number>([
  [0x0160, 0xa6], [0x0161, 0xa8], [0x017d, 0xb4], [0x017e, 0xb8], [0x0152, 0xbc], [0x0153, 0xbd], [0x0178, 0xbe],
]);

/** Byte fuer ein Zeichen ab 0x80, das nicht zu den zehn gehoert. */
function uebrigesZeichen(codepunkt: number, id: CodeTableId): number {
  switch (id) {
    case 'wpc1252':
      if (codepunkt < 0xa0) return FRAGEZEICHEN; // C1-Steuerzeichen
      if (codepunkt <= 0xff) return codepunkt;
      return WPC1252_NEU.get(codepunkt) ?? FRAGEZEICHEN;
    case 'iso8859_15':
      if (codepunkt < 0xa0) return FRAGEZEICHEN; // C1-Steuerzeichen
      if (codepunkt <= 0xff) return ISO8859_15_ANDERS.has(codepunkt) ? FRAGEZEICHEN : codepunkt;
      return ISO8859_15_NEU.get(codepunkt) ?? FRAGEZEICHEN;
    case 'pc437':
      return CP437_AUS_LATIN1.get(codepunkt) ?? FRAGEZEICHEN;
    case 'pc858':
    case 'pc850':
      return PC850_AUS_LATIN1.get(codepunkt) ?? FRAGEZEICHEN;
    case 'replacement':
      return FRAGEZEICHEN;
  }
}

/**
 * Wandelt Text in die Bytes einer Code-Tabelle: erst die vorhandenen
 * Ersetzungen (`ZEICHEN_ERSATZ`), dann die zehn deutschen Zeichen je Tabelle
 * (Byte oder Ersatzbuchstaben), ASCII unveraendert, alles uebrige ueber die
 * Abbildung der Tabelle, sonst `?`. Ein Zeichen, das die Tabelle nicht
 * kennt, ist genau ein Byte; nur die Ersatzbuchstaben machen aus einem
 * Zeichen mehrere. Spalten darum immer an den fertigen Bytes messen.
 */
export function encodeForCodeTable(text: string, table: CodeTableId): Uint8Array {
  return encodeReplaced(replaceKnownCharacters(text), table);
}

/** Wendet `ZEICHEN_ERSATZ` an (paketintern, nicht exportiert ueber den Einstieg). */
export function replaceKnownCharacters(text: string): string {
  let aufbereitet = text;
  for (const [von, nach] of ZEICHEN_ERSATZ) {
    aufbereitet = aufbereitet.split(von).join(nach);
  }
  return aufbereitet;
}

/**
 * Wie `encodeForCodeTable`, aber fuer Text, der `ZEICHEN_ERSATZ` schon hinter
 * sich hat (paketintern: der alte Pfad in `encodeEscPosText` ersetzt vor der
 * Latin-1-Pruefung und soll nicht zweimal ersetzen).
 */
export function encodeReplaced(aufbereitet: string, table: CodeTableId): Uint8Array {
  const bytesDerTabelle = BYTES_JE_TABELLE[table];
  if (bytesDerTabelle === undefined) throw new Error(`Unbekannte Code-Tabelle: ${String(table)}`);
  const bytes: number[] = [];
  for (const zeichen of aufbereitet) {
    const codepunkt = zeichen.codePointAt(0) as number;
    if (codepunkt < 0x80) {
      bytes.push(codepunkt);
      continue;
    }
    const byte = bytesDerTabelle[zeichen];
    if (byte !== undefined) {
      bytes.push(byte);
      continue;
    }
    const ersatz = ERSATZ_BUCHSTABEN[zeichen];
    if (ersatz !== undefined) {
      for (let i = 0; i < ersatz.length; i++) bytes.push(ersatz.charCodeAt(i));
      continue;
    }
    bytes.push(uebrigesZeichen(codepunkt, table));
  }
  return Uint8Array.from(bytes);
}
