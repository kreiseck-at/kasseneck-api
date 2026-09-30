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
  assert.equal(hex(encodeForCodeTable('é«»', 'iso8859_15')), 'E9ABBB');
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
