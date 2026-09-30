import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  CODE_TABLES,
  codeTableById,
  codeTableFromSetting,
  createEscPosDocument,
  encodeEscPosText,
  encodeForCodeTable,
  escPosBytes,
  escPosReset,
  escPosRow,
  escPosText,
  type CodeTableId,
} from '../src/printing/index.js';

/**
 * Katalog der Code-Tabellen gegen den gemeinsamen Prueffall
 * `fixtures/code-tables.json` (der Dart-Zwilling liest dieselbe Datei). Die
 * Bytes stammen aus den Zeichentabellen der Hersteller, nicht aus dieser
 * Umsetzung.
 */

interface Fixture {
  version: number;
  characters: string[];
  tables: Array<{ id: CodeTableId; number: number; escT: number; bytes: Record<string, string> }>;
}

const fixture = JSON.parse(
  readFileSync(new URL('../../fixtures/code-tables.json', import.meta.url), 'utf8'),
) as Fixture;

/** Was ZEICHEN_ERSATZ vor jeder Tabelle aus diesen Zeichen macht. */
const ZEICHEN_ERSATZ_ERWARTET: Record<string, string> = { '’': '27', '´': '27', '•': '2A' };

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join('');

test('Code-Tabellen: Reihenfolge, Nummern und ESC t wie im Katalog', () => {
  assert.equal(fixture.version, 1);
  assert.deepEqual(CODE_TABLES.map((t) => t.id), fixture.tables.map((t) => t.id));
  assert.deepEqual(CODE_TABLES.map((t) => t.number), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(CODE_TABLES.map((t) => t.escT), [16, 19, 2, 0, 40, 0]);
  for (const t of fixture.tables) {
    assert.equal(codeTableById(t.id).number, t.number);
    assert.equal(codeTableById(t.id).escT, t.escT);
  }
});

for (const tabelle of fixture.tables) {
  test(`Code-Tabellen: ${tabelle.id} setzt die zehn Zeichen wie der Prueffall`, () => {
    assert.deepEqual(Object.keys(tabelle.bytes), fixture.characters);
    for (const zeichen of fixture.characters) {
      assert.equal(hex(encodeForCodeTable(zeichen, tabelle.id)), tabelle.bytes[zeichen], `${tabelle.id} ${zeichen}`);
    }
    // Fehlend = Zeichen, fuer das die Tabelle Ersatzbuchstaben druckt.
    const fehlend = fixture.characters.filter((z) => (tabelle.bytes[z] ?? '').length > 2);
    assert.deepEqual([...codeTableById(tabelle.id).missing], fehlend);
    // Nie ein Fragezeichen fuer die zehn Zeichen.
    for (const zeichen of fixture.characters) {
      assert.ok(!encodeForCodeTable(zeichen, tabelle.id).includes(0x3f), `${tabelle.id} ${zeichen} ergab ?`);
    }
  });

  test(`Code-Tabellen: ${tabelle.id} laesst ASCII unveraendert`, () => {
    const ascii = 'Semmel 1,20';
    assert.deepEqual(Array.from(encodeForCodeTable(ascii, tabelle.id)), Array.from(ascii, (c) => c.charCodeAt(0)));
  });
}

test('Code-Tabellen: ein ganzer Satz wird Zeichen fuer Zeichen umgewandelt', () => {
  assert.equal(hex(encodeForCodeTable('Grüße 5 €', 'pc437')), hex(new TextEncoder().encode('Gr')) + '81E1' + hex(new TextEncoder().encode('e 5 EUR')));
  assert.equal(hex(encodeForCodeTable('Grüße 5 €', 'replacement')), hex(new TextEncoder().encode('Gruesse 5 EUR')));
});

test('Code-Tabellen: uebrige Zeichen ab 0x80 je Tabelle', () => {
  // Latin-1 wie bisher
  assert.equal(hex(encodeForCodeTable('é«»', 'wpc1252')), 'E9ABBB');
  // PC850/PC858: westeuropaeische Akzente aus der Latin-1-Abbildung
  assert.equal(hex(encodeForCodeTable('éàçñÅÉøØ', 'pc850')), '828587A48F909B9D');
  assert.equal(hex(encodeForCodeTable('ñÅÉøØÐ', 'pc858')), 'A48F909B9DD1');
  assert.equal(hex(encodeForCodeTable('ñÅÉøØÐ', 'pc850')), 'A48F909B9DD1');
  // PC437 wie bisher (CP437_AUS_LATIN1): Ð hat keinen Platz
  assert.equal(hex(encodeForCodeTable('éÐ', 'pc437')), '823F');
  // Ersatztabelle: nur ASCII
  assert.equal(hex(encodeForCodeTable('é', 'replacement')), '3F');
  // Unbekannt: erst die vorhandenen Ersetzungen, dann ?
  for (const t of CODE_TABLES) {
    assert.equal(hex(encodeForCodeTable('a’b•c', t.id)), '6127622A63', t.id);
    assert.equal(hex(encodeForCodeTable('あ', t.id)), '3F', t.id);
    assert.equal(hex(encodeForCodeTable('x\u{1F600}y', t.id)), '783F79', `${t.id}: ein Zeichen ausserhalb der BMP ist ein Byte`);
  }
});

/**
 * Wahrheit je Tabelle aus dem Dekoder der Laufzeit (WHATWG-Kodierungen, gegen
 * Pythons `codecs` gegengeprueft): Byte -> Zeichen, umgedreht zu Zeichen -> Byte.
 */
function nachDekoder(kodierung: string, von: number, bis: number): Map<string, number> {
  const dekoder = new TextDecoder(kodierung);
  const karte = new Map<string, number>();
  for (let b = von; b <= bis; b++) {
    const zeichen = dekoder.decode(Uint8Array.of(b));
    const cp = zeichen.codePointAt(0) as number;
    if (cp >= 0x80 && cp < 0xa0) continue; // nicht belegte Stelle (C1-Steuerzeichen)
    karte.set(zeichen, b);
  }
  return karte;
}

test('Code-Tabellen: iso8859_15 setzt jedes Zeichen der Tabelle auf sein Byte, fehlende ueber Ersatz', () => {
  const iso = nachDekoder('iso-8859-15', 0xa0, 0xff);
  // Alle Latin-1-Zeichen 0xA0-0xFF plus die acht neuen der 8859-15
  const kandidaten = [...Array.from({ length: 0x60 }, (_, i) => String.fromCharCode(0xa0 + i)), 'Š', 'š', 'Ž', 'ž', 'Œ', 'œ', 'Ÿ', '€'];
  for (const zeichen of kandidaten) {
    const ist = hex(encodeForCodeTable(zeichen, 'iso8859_15'));
    const byte = iso.get(zeichen);
    if (byte !== undefined) {
      assert.equal(ist, byte.toString(16).toUpperCase().padStart(2, '0'), `iso8859_15 ${zeichen}`);
    } else if (zeichen === '´') {
      assert.equal(ist, '27', 'Akut ueber die vorhandene Ersetzung');
    } else {
      assert.ok(!fixture.characters.includes(zeichen), `${zeichen} gehoert zu den zehn`);
      assert.equal(ist, '3F', `iso8859_15 ${zeichen} fehlt in der Tabelle`);
    }
  }
  assert.equal(hex(encodeForCodeTable('½¼¾¤¦¨¸', 'iso8859_15')), '3F3F3F3F3F3F3F');
  assert.equal(hex(encodeForCodeTable('œŠšŽžŒŸ', 'iso8859_15')), 'BDA6A8B4B8BCBE');
  assert.equal(hex(encodeForCodeTable('\u0080\u0085\u009f', 'iso8859_15')), '3F3F3F', 'C1-Steuerzeichen nie roh');
});

test('Code-Tabellen: wpc1252 setzt die Windows-Zeichen 0x80-0x9F, C1-Steuerzeichen nie roh', () => {
  const cp1252 = nachDekoder('windows-1252', 0x80, 0xff);
  for (const [zeichen, byte] of cp1252) {
    const ist = hex(encodeForCodeTable(zeichen, 'wpc1252'));
    // ’ und • laufen vorher ueber ZEICHEN_ERSATZ (eine Antwort auf jedem Ausgabeweg), ´ ebenso.
    const vorher = ZEICHEN_ERSATZ_ERWARTET[zeichen];
    const soll = vorher ?? byte.toString(16).toUpperCase().padStart(2, '0');
    assert.equal(ist, soll, `wpc1252 ${zeichen}`);
  }
  assert.equal(hex(encodeForCodeTable('„Kaffee“ – 2…', 'wpc1252')), '844B6166666565932096203285');
  for (let cp = 0x80; cp < 0xa0; cp++) {
    assert.equal(hex(encodeForCodeTable(String.fromCharCode(cp), 'wpc1252')), '3F', `U+${cp.toString(16)}`);
  }
});

test('Code-Tabellen: codeTableFromSetting bildet die gespeicherte Einstellung ab', () => {
  assert.equal(codeTableFromSetting('cp437'), 'pc437');
  assert.equal(codeTableFromSetting('cp1252'), 'wpc1252');
  assert.equal(codeTableFromSetting(null), 'wpc1252');
  assert.equal(codeTableFromSetting(undefined), 'wpc1252');
});

test('Code-Tabellen: unbekannte id wird gemeldet', () => {
  assert.throws(() => codeTableById('cp999' as CodeTableId), /cp999/);
  assert.throws(() => encodeForCodeTable('a', 'cp999' as CodeTableId), /cp999/);
});

test('Code-Tabellen: die alten Namen bleiben, wie sie waren', () => {
  // CP1252 = wpc1252, CP437 = pc437, aber weiter streng: ausserhalb Latin-1 wirft.
  assert.equal(hex(encodeEscPosText('äöüÄÖÜß§°')), hex(encodeForCodeTable('äöüÄÖÜß§°', 'wpc1252')));
  assert.equal(hex(encodeEscPosText('äöüÄÖÜßé', 'CP437')), hex(encodeForCodeTable('äöüÄÖÜßé', 'pc437')));
  assert.throws(() => encodeEscPosText('5 €'), /€/);
  assert.throws(() => encodeEscPosText('5 €', 'CP437'), /€/);
  // CP1252 gibt ein C1-Steuerzeichen wie bisher roh aus (byte-gleich), wpc1252 nicht.
  assert.equal(hex(encodeEscPosText('\u0085')), '85');
  assert.equal(hex(encodeForCodeTable('\u0085', 'wpc1252')), '3F');
  // Die neuen ids werfen nicht, sie wandeln um.
  assert.equal(hex(encodeEscPosText('5 €', 'pc858')), '3520D5');
});

test('Code-Tabellen: das Dokument sendet ESC t der gewaehlten Tabelle', () => {
  for (const t of CODE_TABLES) {
    const doc = createEscPosDocument({ codeTable: t.id });
    escPosReset(doc);
    escPosText(doc, 'ä');
    const bytes = Array.from(escPosBytes(doc));
    const umlaut = Array.from(encodeForCodeTable('ä', t.id));
    // FS . ESC t n, dann der Text
    const folge = [28, 46, 27, 116, t.escT, ...umlaut, 10];
    assert.deepEqual(bytes.slice(-folge.length), folge, t.id);
  }
});

test('Code-Tabellen: ohne Wahl bleibt der Bon byte-gleich zu CP1252 (Tabelle 16)', () => {
  const baue = (codeTable?: 'CP1252' | 'wpc1252'): number[] => {
    const doc = codeTable === undefined ? createEscPosDocument() : createEscPosDocument({ codeTable });
    escPosReset(doc);
    escPosText(doc, 'Grüße Öl § 20°');
    escPosRow(doc, [{ text: 'Bäckerei', width: 8 }, { text: '1,20', width: 4, styles: { align: 'right' } }]);
    return Array.from(escPosBytes(doc));
  };
  assert.deepEqual(baue(), baue('CP1252'));
  assert.deepEqual(baue('wpc1252'), baue('CP1252'));
});

test('Code-Tabellen: Spaltenbreite -- € auf pc437 wird EUR, der Betrag bleibt rechtsbuendig', () => {
  const zeile = (text: string): number[] => {
    const doc = createEscPosDocument({ codeTable: 'pc437' });
    escPosReset(doc);
    escPosRow(doc, [{ text: 'Kaffee', width: 8 }, { text, width: 4, styles: { align: 'right' } }]);
    return Array.from(escPosBytes(doc));
  };
  // Gemessen wird nach der Umwandlung: "2,50 €" steht exakt so wie "2,50 EUR".
  assert.deepEqual(zeile('2,50 €'), zeile('2,50 EUR'));
  // Gegenprobe: mit einem Byte fuer € stuende der Betrag drei Punkte-Zeichen weiter rechts.
  assert.notDeepEqual(zeile('2,50 €'), zeile('2,50 E'));

  // Eine volle 32er-Zeile: rechter Rand in Spalte 32.
  const doc = createEscPosDocument({ codeTable: 'pc437' });
  escPosReset(doc);
  const links = 'Kaffee';
  const rechts = '2,50 €';
  const breite = 32 - links.length - encodeForCodeTable(rechts, 'pc437').length;
  escPosText(doc, links + ' '.repeat(breite) + rechts);
  const bytes = Array.from(escPosBytes(doc));
  const ende = bytes.lastIndexOf(10);
  const text = bytes.slice(bytes.lastIndexOf(0) + 1, ende);
  assert.equal(text.length, 32);
  assert.deepEqual(text.slice(-8), Array.from('2,50 EUR', (c) => c.charCodeAt(0)));
});
