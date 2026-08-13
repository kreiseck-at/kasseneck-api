import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import {
  createEscPosDocument,
  escPosBytes,
  escPosCut,
  escPosEmptyLines,
  escPosFeed,
  escPosHr,
  escPosMaxCharsPerLine,
  escPosQrCode,
  escPosReset,
  escPosRow,
  escPosSetGlobalCodeTable,
  escPosSetGlobalFont,
  escPosText,
  encodeEscPosText,
  escPosPrintableText,
  qrCodeBytes,
  type QrSize,
} from '../src/printing/index.js';

/**
 * Alle Erwartungswerte in dieser Datei sind **feste Bytefolgen aus dem
 * Flutter-Vorbild** `kasseneck_api/lib/src/printing/escpos/` — abgegriffen,
 * indem der unveraenderte Dart-Generator (`EscPosGenerator`, `QRCode`) in
 * einem reinen Dart-Programm ausgefuehrt und seine Ausgabe protokolliert
 * wurde. Sie sind bewusst NICHT aus dieser Umsetzung erzeugt: bei ESC/POS
 * zaehlt jedes Byte, und ein Test, der die Umsetzung gegen sich selbst
 * prueft, haelt gar nichts.
 *
 * Der Vorspann jeder Beleg-Folge (`ESC @` + `ESC t 16`) entspricht dem
 * Produktionspfad des Flutter-Pakets: `print_paper.dart` ruft
 * `generator.reset()` und danach `setGlobalCodeTable('CP1252')`.
 */

// Vergleicht Byte fuer Byte und meldet im Fehlerfall Hex.
function gleicheBytes(ist: Uint8Array, soll: readonly number[], hinweis?: string): void {
  assert.deepEqual(Array.from(ist), Array.from(soll), hinweis);
}

// ---------------------------------------------------------------- Grundbefehle

test('reset: ESC @ und danach die globale Codepage CP1252 (ESC t 16)', () => {
  const doc = createEscPosDocument();
  escPosReset(doc);
  gleicheBytes(escPosBytes(doc), [27, 64, 27, 116, 16]);
});

test('reset: mit Codepage CP437 steht 0 hinter ESC t', () => {
  const doc = createEscPosDocument({ codeTable: 'CP437' });
  escPosReset(doc);
  gleicheBytes(escPosBytes(doc), [27, 64, 27, 116, 0]);
});

test('reset: ohne Codepage bleibt es beim blanken ESC @', () => {
  const doc = createEscPosDocument({ codeTable: null });
  escPosReset(doc);
  gleicheBytes(escPosBytes(doc), [27, 64]);
});

test('emptyLines: n Zeilenvorschuebe als reine 0x0A', () => {
  const doc = createEscPosDocument({ codeTable: null });
  escPosEmptyLines(doc, 3);
  gleicheBytes(escPosBytes(doc), [10, 10, 10]);
});

test('feed: ESC d n', () => {
  const doc = createEscPosDocument({ codeTable: null });
  escPosFeed(doc, 4);
  gleicheBytes(escPosBytes(doc), [27, 100, 4]);
});

test('feed: n = 0 erzeugt trotzdem den Befehl (wie im Vorbild)', () => {
  const doc = createEscPosDocument({ codeTable: null });
  escPosFeed(doc, 0);
  gleicheBytes(escPosBytes(doc), [27, 100, 0]);
});

test('cut: voller Schnitt = 5 Leerzeilen + GS V 0x30', () => {
  const doc = createEscPosDocument({ codeTable: null });
  escPosCut(doc);
  gleicheBytes(escPosBytes(doc), [10, 10, 10, 10, 10, 29, 86, 48]);
});

test('cut: Teilschnitt endet auf 0x31, nicht auf 0x01', () => {
  const doc = createEscPosDocument({ codeTable: null });
  escPosCut(doc, 'partial');
  gleicheBytes(escPosBytes(doc), [10, 10, 10, 10, 10, 29, 86, 49]);
});

// ------------------------------------------------------------ Text und Betonung

test('text: Positionierung, Kanji aus, Codepage, Inhalt, Zeilenumbruch', () => {
  const doc = createEscPosDocument();
  escPosReset(doc);
  escPosText(doc, 'Hallo');
  gleicheBytes(escPosBytes(doc), [
    27, 64, 27, 116, 16, // ESC @ / ESC t 16
    27, 36, 0, 0, // ESC $ 0 0 (absolute Position)
    28, 46, // FS . (Kanji aus)
    27, 116, 16, // ESC t 16
    72, 97, 108, 108, 111, // "Hallo"
    10,
  ]);
});

test('text: zentriert und fett setzt ESC a 1 und ESC E 1', () => {
  const doc = createEscPosDocument();
  escPosReset(doc);
  escPosText(doc, 'BELEG', { styles: { align: 'center', bold: true } });
  gleicheBytes(escPosBytes(doc), [
    27, 64, 27, 116, 16,
    27, 36, 0, 0,
    27, 97, 49, // ESC a '1'
    27, 69, 1, // ESC E 1
    28, 46, 27, 116, 16,
    66, 69, 76, 69, 71,
    10,
  ]);
});

test('text: doppelte Hoehe und Breite ergibt GS ! 0x11', () => {
  const doc = createEscPosDocument();
  escPosReset(doc);
  escPosText(doc, 'XL', { styles: { height: 2, width: 2 } });
  gleicheBytes(escPosBytes(doc), [
    27, 64, 27, 116, 16,
    27, 36, 0, 0,
    29, 33, 17, // GS ! 0x11 = 16*(2-1) + (2-1)
    28, 46, 27, 116, 16,
    88, 76,
    10,
  ]);
});

test('text: nur doppelte Hoehe ergibt GS ! 0x01', () => {
  const doc = createEscPosDocument();
  escPosReset(doc);
  escPosText(doc, 'H2', { styles: { height: 2 } });
  gleicheBytes(escPosBytes(doc), [
    27, 64, 27, 116, 16,
    27, 36, 0, 0,
    29, 33, 1,
    28, 46, 27, 116, 16,
    72, 50,
    10,
  ]);
});

test('text: unterstrichen und rechtsbuendig ergibt ESC a 2 und ESC - 1', () => {
  const doc = createEscPosDocument();
  escPosReset(doc);
  escPosText(doc, 'U', { styles: { underline: true, align: 'right' } });
  gleicheBytes(escPosBytes(doc), [
    27, 64, 27, 116, 16,
    27, 36, 0, 0,
    27, 97, 50, // ESC a '2'
    27, 45, 1, // ESC - 1
    28, 46, 27, 116, 16,
    85,
    10,
  ]);
});

test('text: linesAfter haengt zusaetzliche Zeilenvorschuebe an', () => {
  const doc = createEscPosDocument();
  escPosReset(doc);
  escPosText(doc, 'X', { linesAfter: 2 });
  gleicheBytes(escPosBytes(doc), [
    27, 64, 27, 116, 16,
    27, 36, 0, 0,
    28, 46, 27, 116, 16,
    88,
    10, 10, 10,
  ]);
});

test('text: Stile werden nur bei Aenderung gesendet und wieder abgeschaltet', () => {
  const doc = createEscPosDocument();
  escPosReset(doc);
  escPosText(doc, 'A', { styles: { bold: true } });
  escPosText(doc, 'B', { styles: { bold: true } });
  escPosText(doc, 'C');
  gleicheBytes(escPosBytes(doc), [
    27, 64, 27, 116, 16,
    27, 36, 0, 0, 27, 69, 1, 28, 46, 27, 116, 16, 65, 10, // A: fett an
    27, 36, 0, 0, 28, 46, 27, 116, 16, 66, 10, // B: kein zweites ESC E 1
    27, 36, 0, 0, 27, 69, 0, 28, 46, 27, 116, 16, 67, 10, // C: fett aus
  ]);
});

// ------------------------------------------------------------ Zeichenkodierung

test('Kodierung: deutsche Umlaute ergeben je genau ein Byte (Latin-1/CP1252)', () => {
  const doc = createEscPosDocument();
  escPosReset(doc);
  escPosText(doc, 'Grüße Öl');
  gleicheBytes(escPosBytes(doc), [
    27, 64, 27, 116, 16,
    27, 36, 0, 0,
    28, 46, 27, 116, 16,
    71, 114, 252, 223, 101, 32, 214, 108, // G r ü ß e ' ' Ö l
    10,
  ]);
});

test('Kodierung: einzelne Umlaute sind ein Byte, nicht zwei (kein UTF-8)', () => {
  gleicheBytes(encodeEscPosText('ä'), [0xe4]);
  gleicheBytes(encodeEscPosText('ö'), [0xf6]);
  gleicheBytes(encodeEscPosText('ü'), [0xfc]);
  gleicheBytes(encodeEscPosText('ß'), [0xdf]);
  gleicheBytes(encodeEscPosText('Ä'), [0xc4]);
  assert.equal(encodeEscPosText('Grüße').length, 5);
  // Gegenprobe: UTF-8 waere hier laenger — genau das verschoebe die Spalten.
  assert.equal(new TextEncoder().encode('Grüße').length, 7);
});

test('Kodierung: typografische Zeichen werden wie im Vorbild ersetzt', () => {
  const doc = createEscPosDocument();
  escPosReset(doc);
  escPosText(doc, 'a’b´c»d•e');
  gleicheBytes(escPosBytes(doc), [
    27, 64, 27, 116, 16,
    27, 36, 0, 0,
    28, 46, 27, 116, 16,
    97, 39, 98, 39, 99, 34, 100, 42, 101, // a ' b ' c " d * e
    10,
  ]);
});

test('Kodierung: der Aufzaehlungspunkt hat genau eine Antwort — auf jedem Ausgabeweg', () => {
  // Zwei Ports desselben Dart-Pakets sagten hier Verschiedenes: print_paper.dart
  // macht aus `•` ein `*`, generator.dart ein `.`. In Darts eigener Kette
  // kommt der Punkt nie beim Erzeuger an, weil print_paper vorher ersetzt —
  // ein Verbraucher dieses Pakets kann escPosText aber auch direkt aufrufen,
  // und dann duerfen nicht zwei verschiedene Zeichen herauskommen.
  assert.equal(escPosPrintableText('•'), '*');
  gleicheBytes(encodeEscPosText('•'), [0x2a]);
  gleicheBytes(encodeEscPosText(escPosPrintableText('•')), [0x2a]);
});

test('Kodierung: ein Zeichen ausserhalb Latin-1 wird gemeldet statt verstuemmelt', () => {
  assert.throws(() => encodeEscPosText('5 €'), /€/);
});

// ------------------------------------------------------- druckbare Fassung
// Erwartungen aus einem Dart-Lauf der woertlich kopierten Vorlage
// `_printable`/`_isEmojiOrZeroWidth` aus print_paper.dart (Zeilen 53-88).

test('printableText: Gedankenstrich, typografische Anfuehrungszeichen, Euro', () => {
  assert.equal(escPosPrintableText('Kaffee – gross'), 'Kaffee - gross');
  assert.equal(escPosPrintableText('Cafe „Mozart“'), 'Cafe "Mozart"');
  assert.equal(escPosPrintableText('Cola 2,50 €'), 'Cola 2,50 EUR');
});

test('printableText: Umlaute bleiben unveraendert', () => {
  assert.equal(escPosPrintableText('Grüße Öl'), 'Grüße Öl');
});

test('printableText: alle Strichvarianten werden zum Bindestrich', () => {
  assert.equal(escPosPrintableText('a—b‑c−d'), 'a-b-c-d');
});

test('printableText: Apostrophe und einfache Anfuehrungszeichen', () => {
  assert.equal(escPosPrintableText('‘x’ ‚y‘ 3′'), "'x' 'y' 3'");
});

test('printableText: Auslassungspunkte, Haken, Marken- und Waehrungszeichen', () => {
  assert.equal(escPosPrintableText('Espresso…'), 'Espresso...');
  assert.equal(escPosPrintableText('Bio ✓ geprüft'), 'Bio x geprüft');
  assert.equal(escPosPrintableText('Kreiseck™ 5₺'), 'KreiseckTM 5TL');
  assert.equal(escPosPrintableText('• Punkt'), '* Punkt');
});

test('printableText: Emoji und Nullbreiten-Zeichen verschwinden ersatzlos', () => {
  assert.equal(escPosPrintableText('Danke \u{1F600}!'), 'Danke !');
  assert.equal(escPosPrintableText('Set \u{1F468}‍\u{1F469}‍\u{1F466} Familie'), 'Set  Familie');
  assert.equal(escPosPrintableText('a‍b'), 'ab');
  assert.equal(escPosPrintableText('⌚ Uhr ⭐ Stern'), ' Uhr  Stern');
});

test('printableText: sonstiges unbekanntes Zeichen wird zum Fragezeichen', () => {
  assert.equal(escPosPrintableText('あ'), '?');
});

test('printableText: der aufbereitete Text laeuft durch den Erzeuger', () => {
  // Der eigentliche Zweck: was vorher den ganzen Ausdruck verhindert haette,
  // wird jetzt gedruckt.
  for (const roh of ['Kaffee – gross', 'Cafe „Mozart“', 'Cola 2,50 €', 'Danke \u{1F600}!']) {
    assert.throws(() => encodeEscPosText(roh), /U\+/, `${roh} sollte roh noch werfen`);
    const doc = createEscPosDocument();
    escPosReset(doc);
    escPosText(doc, escPosPrintableText(roh));
    assert.ok(escPosBytes(doc).length > 5);
  }
});

test('printableText: Ersetzung aendert die Laenge und damit die Spaltenbreite', () => {
  // "€" wird zu drei Zeichen — deshalb gehoert die Ersetzung vor die
  // Spaltenrechnung und nicht in den Erzeuger.
  assert.equal(escPosPrintableText('2,50 €').length, 8);
  const doc = createEscPosDocument();
  escPosReset(doc);
  escPosRow(doc, [
    { text: 'Cola', width: 6 },
    { text: escPosPrintableText('2,50 €'), width: 6, styles: { align: 'right' } },
  ]);
  gleicheBytes(escPosBytes(doc), [
    27, 64, 27, 116, 16,
    27, 36, 0, 0, 28, 46, 27, 116, 16, 67, 111, 108, 97, // "Cola"
    27, 36, 17, 1, // ESC $ 273 — acht Zeichen rechtsbuendig
    27, 97, 50, 28, 46, 27, 116, 16,
    50, 44, 53, 48, 32, 69, 85, 82, // "2,50 EUR"
    10,
  ]);
});

// ---------------------------------------------------------------- Trennlinien

test('hr: 58 mm fuellt 32 Zeichen', () => {
  const doc = createEscPosDocument();
  escPosReset(doc);
  escPosHr(doc);
  gleicheBytes(escPosBytes(doc), [
    27, 64, 27, 116, 16,
    27, 36, 0, 0,
    28, 46, 27, 116, 16,
    45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45,
    45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45,
    10,
  ]);
});

test('hr: 80 mm fuellt 48 Zeichen', () => {
  const doc = createEscPosDocument({ paperSize: 'mm80' });
  escPosReset(doc);
  escPosHr(doc);
  gleicheBytes(escPosBytes(doc), [
    27, 64, 27, 116, 16,
    27, 36, 0, 0,
    28, 46, 27, 116, 16,
    45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45,
    45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45,
    45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45,
    10,
  ]);
});

test('hr: eigenes Zeichen, eigene Laenge, zusaetzliche Zeile', () => {
  const doc = createEscPosDocument();
  escPosReset(doc);
  escPosHr(doc, { ch: '=', len: 8, linesAfter: 1 });
  gleicheBytes(escPosBytes(doc), [
    27, 64, 27, 116, 16,
    27, 36, 0, 0,
    28, 46, 27, 116, 16,
    61, 61, 61, 61, 61, 61, 61, 61,
    10, 10,
  ]);
});

// --------------------------------------------------------------------- Spalten

test('row: zwei Spalten, rechte Spalte wird ueber ESC $ positioniert', () => {
  const doc = createEscPosDocument();
  escPosReset(doc);
  escPosRow(doc, [
    { text: 'Cola', width: 6 },
    { text: '2,50', width: 6, styles: { align: 'right' } },
  ]);
  gleicheBytes(escPosBytes(doc), [
    27, 64, 27, 116, 16,
    27, 36, 0, 0, 28, 46, 27, 116, 16, 67, 111, 108, 97, // "Cola" ab Position 0
    27, 36, 64, 1, // ESC $ 320
    27, 97, 50, 28, 46, 27, 116, 16, 50, 44, 53, 48, // "2,50"
    10,
  ]);
});

test('row: drei Spalten mit Umlaut behalten die Spaltenpositionen', () => {
  const doc = createEscPosDocument();
  escPosReset(doc);
  escPosRow(doc, [
    { text: '1', width: 2 },
    { text: 'Käse', width: 6 },
    { text: '9,90', width: 4, styles: { align: 'right' } },
  ]);
  gleicheBytes(escPosBytes(doc), [
    27, 64, 27, 116, 16,
    27, 36, 0, 0, 28, 46, 27, 116, 16, 49, // "1"
    27, 36, 61, 0, // ESC $ 61
    28, 46, 27, 116, 16, 75, 228, 115, 101, // "Käse" = 4 Bytes
    27, 36, 64, 1, // ESC $ 320
    27, 97, 50, 28, 46, 27, 116, 16, 57, 44, 57, 48, // "9,90"
    10,
  ]);
});

test('row: rechtsbuendige Spalte rechnet mit Byte-Laenge, nicht mit UTF-8', () => {
  // "Größe" = 5 Zeichen = 5 Bytes -> Startposition 308 (ESC $ 0x34 0x01).
  // Waere der Umlaut zwei Bytes, laege der Start bei 285 — der Text wuerde
  // sichtbar zu weit links stehen.
  const doc = createEscPosDocument();
  escPosReset(doc);
  escPosRow(doc, [
    { text: 'x', width: 6 },
    { text: 'Größe', width: 6, styles: { align: 'right' } },
  ]);
  gleicheBytes(escPosBytes(doc), [
    27, 64, 27, 116, 16,
    27, 36, 0, 0, 28, 46, 27, 116, 16, 120,
    27, 36, 52, 1, // ESC $ 308
    27, 97, 50, 28, 46, 27, 116, 16,
    71, 114, 246, 223, 101, // "Größe"
    10,
  ]);
});

test('row: 15 Umlaut-Zeichen passen in die Spalte (kein Umbruch)', () => {
  const doc = createEscPosDocument();
  escPosReset(doc);
  escPosRow(doc, [
    { text: 'ÄÖÜäöüßÄÖÜäöüßÄ', width: 6 },
    { text: '', width: 6 },
  ]);
  gleicheBytes(escPosBytes(doc), [
    27, 64, 27, 116, 16,
    27, 36, 0, 0, 28, 46, 27, 116, 16,
    196, 214, 220, 228, 246, 252, 223, 196, 214, 220, 228, 246, 252, 223, 196,
    27, 36, 185, 0, 28, 46, 27, 116, 16,
    10,
  ]);
});

test('row: 80 mm, zentrierte Spalte', () => {
  const doc = createEscPosDocument({ paperSize: 'mm80' });
  escPosReset(doc);
  escPosRow(doc, [
    { text: 'A', width: 4, styles: { align: 'center' } },
    { text: 'B', width: 8 },
  ]);
  gleicheBytes(escPosBytes(doc), [
    27, 64, 27, 116, 16,
    27, 36, 84, 0, // ESC $ 84
    27, 97, 49, 28, 46, 27, 116, 16, 65,
    27, 36, 185, 0, // ESC $ 185
    27, 97, 48, 28, 46, 27, 116, 16, 66,
    10,
  ]);
});

test('row: zu langer Spalteninhalt laeuft in eine Folgezeile statt verloren zu gehen', () => {
  // Bewusste Abweichung vom Vorbild: dort wird das Ergebnis des rekursiven
  // row()-Aufrufs verworfen, der Rest ist damit weg. Die erste Zeile ist
  // byte-gleich zum Vorbild, die Fortsetzungszeile ist genau das, was dessen
  // eigener Rekursionsaufruf erzeugt (dort nur nicht angehaengt).
  const doc = createEscPosDocument();
  escPosReset(doc);
  escPosRow(doc, [
    { text: 'Ein sehr langer Artikelname', width: 6 },
    { text: 'X', width: 6 },
  ]);
  gleicheBytes(escPosBytes(doc), [
    27, 64, 27, 116, 16,
    // erste Zeile (byte-gleich zum Vorbild)
    27, 36, 0, 0, 28, 46, 27, 116, 16,
    69, 105, 110, 32, 115, 101, 104, 114, 32, 108, 97, 110, 103, 101, 114, // "Ein sehr langer"
    27, 36, 185, 0, 28, 46, 27, 116, 16, 88,
    10,
    // Fortsetzungszeile
    27, 36, 0, 0, 28, 46, 27, 116, 16,
    32, 65, 114, 116, 105, 107, 101, 108, 110, 97, 109, 101, // " Artikelname"
    27, 36, 185, 0, 28, 46, 27, 116, 16,
    10,
  ]);
});

test('row: sehr viele Folgezeilen sprengen den Aufrufstapel nicht', () => {
  // Passt rechnerisch kein Zeichen in die Spalte, greift die Untergrenze von
  // einem Zeichen je Zeile — hier also 5000 Folgezeilen. Als Rekursion waeren
  // das 5000 Rahmen und ein "Maximum call stack size exceeded".
  const doc = createEscPosDocument();
  escPosReset(doc);
  escPosRow(doc, [
    { text: 'A'.repeat(5000), width: 1, styles: { width: 8 } },
    { text: '', width: 11 },
  ]);
  const bytes = escPosBytes(doc);
  // je Folgezeile genau ein 'A' (0x41)
  assert.equal(bytes.filter((b) => b === 0x41).length, 5000);
  // und genau 5000 Zeilenumbrueche
  assert.equal(bytes.filter((b) => b === 0x0a).length, 5000);
});

test('row: Spaltenbreiten muessen zusammen 12 ergeben', () => {
  const doc = createEscPosDocument();
  assert.throws(
    () => escPosRow(doc, [{ text: 'A', width: 6 }, { text: 'B', width: 5 }]),
    /12/,
  );
});

test('row: Spaltenbreite ausserhalb 1..12 wird abgelehnt', () => {
  const doc = createEscPosDocument();
  assert.throws(() => escPosRow(doc, [{ text: 'A', width: 13 }]), /1\.\.12/);
  assert.throws(
    () => escPosRow(doc, [{ text: 'A', width: 0 }, { text: 'B', width: 12 }]),
    /1\.\.12/,
  );
});

test('row: text und textEncoded zugleich wird abgelehnt', () => {
  const doc = createEscPosDocument();
  assert.throws(
    () =>
      escPosRow(doc, [
        { text: 'A', textEncoded: new Uint8Array([65]), width: 6 },
        { text: 'B', width: 6 },
      ]),
    /textEncoded/,
  );
});

// --------------------------------------------------------------------- QR-Code

test('qrCodeBytes: nativer Befehl ist byte-exakt (FN 167/169/180/182/181)', () => {
  gleicheBytes(qrCodeBytes('ABC', { size: 6, correction: 'L' }), [
    29, 40, 107, 3, 0, 49, 67, 6, // GS ( k 3 0 '1' 'C' 6  -> Modulgroesse
    29, 40, 107, 3, 0, 49, 69, 48, // GS ( k 3 0 '1' 'E' 48 -> Korrektur L
    29, 40, 107, 6, 0, 49, 80, 48, 65, 66, 67, // Daten speichern + "ABC"
    29, 40, 107, 3, 0, 49, 82, 48, // Groesse
    29, 40, 107, 3, 0, 49, 81, 48, // drucken
  ]);
});

test('qrCodeBytes: Umlaut im QR-Inhalt zaehlt als ein Byte in der Laengenangabe', () => {
  gleicheBytes(qrCodeBytes('Gruß', { size: 4, correction: 'M' }), [
    29, 40, 107, 3, 0, 49, 67, 4,
    29, 40, 107, 3, 0, 49, 69, 49, // Korrektur M = 49
    29, 40, 107, 7, 0, 49, 80, 48, 71, 114, 117, 223, // 4 Bytes + 3
    29, 40, 107, 3, 0, 49, 82, 48,
    29, 40, 107, 3, 0, 49, 81, 48,
  ]);
});

test('qrCode: Vorgabe zentriert, Groesse 4, Korrektur L', () => {
  const doc = createEscPosDocument();
  escPosReset(doc);
  escPosQrCode(doc, '_R1-AT1_Demo');
  gleicheBytes(escPosBytes(doc), [
    27, 64, 27, 116, 16,
    27, 97, 49, 28, 46, 27, 116, 16, // Ausrichtung mittig
    29, 40, 107, 3, 0, 49, 67, 4,
    29, 40, 107, 3, 0, 49, 69, 48,
    29, 40, 107, 15, 0, 49, 80, 48,
    95, 82, 49, 45, 65, 84, 49, 95, 68, 101, 109, 111, // "_R1-AT1_Demo"
    29, 40, 107, 3, 0, 49, 82, 48,
    29, 40, 107, 3, 0, 49, 81, 48,
  ]);
});

test('qrCode: linksbuendig, Groesse 8, Korrektur H', () => {
  const doc = createEscPosDocument();
  escPosReset(doc);
  escPosQrCode(doc, 'XY', { align: 'left', size: 8, correction: 'H' });
  gleicheBytes(escPosBytes(doc), [
    27, 64, 27, 116, 16,
    28, 46, 27, 116, 16, // links ist schon aktiv -> kein ESC a
    29, 40, 107, 3, 0, 49, 67, 8,
    29, 40, 107, 3, 0, 49, 69, 51, // Korrektur H = 51
    29, 40, 107, 5, 0, 49, 80, 48, 88, 89,
    29, 40, 107, 3, 0, 49, 82, 48,
    29, 40, 107, 3, 0, 49, 81, 48,
  ]);
});

test('qrCodeBytes: lange Nutzlast setzt pL/pH korrekt (RKSV-Code kann > 252 Byte sein)', () => {
  // Bewusste Abweichung: das Vorbild schreibt die Laenge als einzelnes Byte
  // (`length + 3`) und wuerde ab 253 Nutzbytes eine falsche Laenge senden.
  // GS ( k erwartet pL/pH, also Nieder- und Hochanteil.
  const inhalt = 'A'.repeat(300);
  const bytes = qrCodeBytes(inhalt);
  const kopf = 8 + 8; // Modulgroesse + Korrektur
  gleicheBytes(bytes.slice(kopf, kopf + 8), [
    29, 40, 107,
    47, 1, // pL/pH fuer 300 Nutzbytes + 3
    49, 80, 48,
  ]);
  assert.equal(bytes.length, kopf + 8 + 300 + 8 + 8);
});

test('qrCode: unzulaessige Modulgroesse wird abgelehnt', () => {
  // Der Typ schliesst das schon aus; die Zusicherung gilt JS-Aufrufern ohne
  // Typpruefung, deshalb hier bewusst am Typ vorbei.
  assert.throws(() => qrCodeBytes('X', { size: 9 as QrSize }), /1\.\.8/);
  assert.throws(() => qrCodeBytes('X', { size: 0 as QrSize }), /1\.\.8/);
});

// ------------------------------------------------------------------- Schriften

test('setGlobalFont: Schrift B setzt ESC M 1 und aendert die Zeilenbreite auf 42', () => {
  const doc = createEscPosDocument();
  escPosReset(doc);
  escPosSetGlobalFont(doc, 'fontB');
  escPosText(doc, 'fb');
  escPosHr(doc);
  const erwartet = [
    27, 64, 27, 116, 16,
    27, 77, 1, // ESC M 1
    27, 36, 0, 0, 28, 46, 27, 116, 16, 102, 98, 10, // "fb"
    27, 36, 0, 0, 28, 46, 27, 116, 16,
    ...new Array<number>(42).fill(45), // 42 Striche statt 32
    10,
  ];
  gleicheBytes(escPosBytes(doc), erwartet);
});

test('setGlobalFont: eigene Zeilenbreite wirkt auf die Trennlinie', () => {
  // Anders als die frueher angebotene Angabe an escPosText hat diese hier eine
  // messbare Wirkung: 20 statt der 42 Zeichen von Schrift B.
  const doc = createEscPosDocument();
  escPosReset(doc);
  escPosSetGlobalFont(doc, 'fontB', { maxCharsPerLine: 20 });
  escPosHr(doc);
  gleicheBytes(escPosBytes(doc), [
    27, 64, 27, 116, 16,
    27, 77, 1,
    27, 36, 0, 0, 28, 46, 27, 116, 16,
    ...new Array<number>(20).fill(45),
    10,
  ]);
});

test('Stile: invertiert und um 90 Grad gedreht, danach wieder zurueck', () => {
  const doc = createEscPosDocument();
  escPosReset(doc);
  escPosText(doc, 'INV', { styles: { reverse: true, turn90: true } });
  escPosText(doc, 'normal');
  gleicheBytes(escPosBytes(doc), [
    27, 64, 27, 116, 16,
    27, 36, 0, 0,
    27, 86, 1, // ESC V 1 (90 Grad)
    29, 66, 1, // GS B 1 (invertiert)
    28, 46, 27, 116, 16, 73, 78, 86, 10,
    27, 36, 0, 0,
    27, 86, 0, // ESC V 0
    29, 66, 0, // GS B 0
    28, 46, 27, 116, 16, 110, 111, 114, 109, 97, 108, 10,
  ]);
});

test('reset: globale Codepage und Schrift werden danach erneut gesendet', () => {
  const doc = createEscPosDocument();
  escPosReset(doc);
  escPosSetGlobalFont(doc, 'fontB');
  escPosReset(doc);
  gleicheBytes(escPosBytes(doc), [
    27, 64, 27, 116, 16, 27, 77, 1,
    27, 64, 27, 116, 16, 27, 77, 1,
  ]);
});

test('setGlobalCodeTable: nachtraeglich auf CP437 umschalten sendet ESC t 0', () => {
  const doc = createEscPosDocument({ codeTable: null });
  escPosSetGlobalCodeTable(doc, 'CP437');
  gleicheBytes(escPosBytes(doc), [27, 116, 0]);
});

test('escPosMaxCharsPerLine: 32/42 bei 58 mm, 48/64 bei 80 mm', () => {
  assert.equal(escPosMaxCharsPerLine('mm58'), 32);
  assert.equal(escPosMaxCharsPerLine('mm58', 'fontA'), 32);
  assert.equal(escPosMaxCharsPerLine('mm58', 'fontB'), 42);
  assert.equal(escPosMaxCharsPerLine('mm80'), 48);
  assert.equal(escPosMaxCharsPerLine('mm80', 'fontB'), 64);
});

// -------------------------------------------------------------- Paket-Einbindung

test('package.json: Unterpfad ./printing ist wie der Haupteintrag deklariert', () => {
  const roh = readFileSync(new URL('../../package.json', import.meta.url), 'utf8');
  const paket = JSON.parse(roh) as { exports: Record<string, Record<string, Record<string, string>>> };
  const eintrag = paket.exports['./printing'];
  assert.ok(eintrag, 'exports["./printing"] fehlt');
  // types je Zweig, nicht daneben — siehe scripts/check-build-exports.mjs.
  assert.deepEqual(eintrag, {
    import: { types: './dist/esm/printing/index.d.ts', default: './dist/esm/printing/index.js' },
    require: { types: './dist/cjs/printing/index.d.ts', default: './dist/cjs/printing/index.js' },
  });
});

test('package.json: die Unterpfad-Ziele passen zu den outDir der Bau-Configs', () => {
  // Ohne diese Kopplung koennte jemand outDir oder die Verzeichnisstruktur
  // aendern, ohne dass ein Test faellt — der Bau liefe durch und
  // require('@kreiseck/kasseneck-api/printing') braeche bei jedem Verbraucher.
  const lies = (pfad: string): string => readFileSync(new URL(pfad, import.meta.url), 'utf8');
  const ohneKommentare = (roh: string): string => roh.replace(/^\s*\/\/.*$/gm, '');
  const paket = JSON.parse(lies('../../package.json')) as {
    exports: Record<string, Record<string, Record<string, string>>>;
  };
  const esm = JSON.parse(ohneKommentare(lies('../../tsconfig.json'))) as {
    compilerOptions: { outDir: string; rootDir: string };
  };
  const cjs = JSON.parse(ohneKommentare(lies('../../tsconfig.cjs.json'))) as {
    compilerOptions: { outDir: string };
  };
  const eintrag = paket.exports['./printing'];
  assert.ok(eintrag);
  assert.equal(esm.compilerOptions.rootDir, 'src');
  assert.equal(eintrag['import']?.['default'], `./${esm.compilerOptions.outDir}/printing/index.js`);
  assert.equal(eintrag['import']?.['types'], `./${esm.compilerOptions.outDir}/printing/index.d.ts`);
  assert.equal(eintrag['require']?.['default'], `./${cjs.compilerOptions.outDir}/printing/index.js`);
  // Die Deklarationen des require-Zweigs muessen aus dem CJS-Bau kommen; aus
  // dem ESM-Bau haelt TypeScript sie fuer ESM und lehnt jeden require-Import ab.
  assert.equal(eintrag['require']?.['types'], `./${cjs.compilerOptions.outDir}/printing/index.d.ts`);
});

test('Bauwerkzeug: der Waechter meldet einen fehlenden Bau-Pfad', () => {
  // Der Bau selbst prueft ueber scripts/check-build-exports.mjs, dass jeder in
  // exports genannte Pfad wirklich entstanden ist. Hier wird der Waechter
  // gegen ein Wurzelverzeichnis ohne dist/ gefahren: er muss anschlagen.
  const waechter = fileURLToPath(new URL('../../scripts/check-build-exports.mjs', import.meta.url));
  const leer = mkdtempSync(join(tmpdir(), 'keck-exports-'));
  writeFileSync(
    join(leer, 'package.json'),
    JSON.stringify({ exports: { './printing': { import: './dist/esm/printing/index.js' } } }),
  );
  try {
    execFileSync(process.execPath, [waechter], { cwd: leer, encoding: 'utf8', stdio: 'pipe' });
    assert.fail('Der Waechter haette anschlagen muessen');
  } catch (fehler) {
    const meldung = String((fehler as { stderr?: string }).stderr ?? '');
    assert.match(meldung, /dist\/esm\/printing\/index\.js/);
  } finally {
    rmSync(leer, { recursive: true, force: true });
  }
});

test('Bauwerkzeug: der Waechter meldet eine types-Bedingung neben import/require', () => {
  // Genau die Form, die dieses Paket bis zur Abschlusspruefung hatte: die
  // Dateien existieren alle, `require` laeuft zur Laufzeit — und trotzdem
  // uebersetzt kein CommonJS-Verbraucher mit module: Node16 (TS1479). Der
  // Waechter muss das an der Form erkennen, nicht an einer fehlenden Datei.
  const waechter = fileURLToPath(new URL('../../scripts/check-build-exports.mjs', import.meta.url));
  const ordner = mkdtempSync(join(tmpdir(), 'keck-exports-typen-'));
  const dateien = [
    'dist/esm/printing/index.js',
    'dist/esm/printing/index.d.ts',
    'dist/cjs/printing/index.js',
    'dist/cjs/printing/index.d.ts',
  ];
  for (const datei of dateien) {
    mkdirSync(join(ordner, dirname(datei)), { recursive: true });
    writeFileSync(join(ordner, datei), '');
  }
  writeFileSync(
    join(ordner, 'package.json'),
    JSON.stringify({
      exports: {
        './printing': {
          types: './dist/esm/printing/index.d.ts',
          import: './dist/esm/printing/index.js',
          require: './dist/cjs/printing/index.js',
        },
      },
    }),
  );
  try {
    execFileSync(process.execPath, [waechter], { cwd: ordner, encoding: 'utf8', stdio: 'pipe' });
    assert.fail('Der Waechter haette anschlagen muessen');
  } catch (fehler) {
    const meldung = String((fehler as { stderr?: string }).stderr ?? '');
    assert.match(meldung, /types.*neben import\/require/);
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
});

test('printing: kein Quelltext des Unterpfads greift auf den Rest des Pakets zu', () => {
  const verzeichnis = new URL('../../src/printing/', import.meta.url);
  const dateien = readdirSync(verzeichnis).filter((d) => d.endsWith('.ts'));
  assert.ok(dateien.length > 0);
  for (const datei of dateien) {
    const inhalt = readFileSync(new URL(datei, verzeichnis), 'utf8');
    for (const treffer of inhalt.matchAll(/from\s+'([^']+)'/g)) {
      const ziel = treffer[1] ?? '';
      assert.ok(
        !ziel.startsWith('../'),
        `${datei} laedt ${ziel} ausserhalb von src/printing`,
      );
    }
  }
});

test('printing: laesst sich in einem eigenen Node-Prozess allein laden', () => {
  const eintrag = fileURLToPath(new URL('../src/printing/index.js', import.meta.url));
  const programm = `
    import { createEscPosDocument, escPosReset, escPosText, escPosBytes } from ${JSON.stringify(eintrag)};
    const doc = createEscPosDocument();
    escPosReset(doc);
    escPosText(doc, 'ü');
    process.stdout.write(Array.from(escPosBytes(doc)).join(','));
  `;
  const ausgabe = execFileSync(process.execPath, ['--input-type=module', '-e', programm], {
    encoding: 'utf8',
  });
  assert.equal(ausgabe, '27,64,27,116,16,27,36,0,0,28,46,27,116,16,252,10');
});
