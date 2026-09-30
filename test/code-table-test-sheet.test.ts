import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import { CODE_TABLES, encodeForCodeTable } from '../src/printing/index.js';
import {
  codeTableTestSheet,
  codeTableTestSheetBytes,
  codeTableReferenceImage,
  CODE_TABLE_TEST_SHEET_CHARS,
  type CodeTableTestSheetInput,
} from '../src/receipt/index.js';
import { labelText, messageText } from '../src/pos/texte.js';

/**
 * Das Testblatt fuer den Zeichensatz: dieselben Zeilen am Bildschirm und am
 * Papier. Gemeinsamer Prueffall mit dem Dart-Zwilling:
 * `fixtures/expected/code-table-test-sheet.{mm58,mm80}.hex` und `.lines.json`.
 */

const EINGABE: CodeTableTestSheetInput = { cashregisterLabel: 'Kasse KECK-1', time: new Date('2026-09-30T12:05:00Z'), paper: 'mm58' };

const FS = 0x1c;
const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

function enthaelt(heu: Uint8Array, nadel: readonly number[]): number {
  outer: for (let i = 0; i + nadel.length <= heu.length; i++) {
    for (let j = 0; j < nadel.length; j++) if (heu[i + j] !== nadel[j]) continue outer;
    return i;
  }
  return -1;
}

const ascii = (s: string): number[] => Array.from(s, (z) => z.charCodeAt(0));
const hex = (bytes: Uint8Array): string => {
  const teile: string[] = [];
  for (let i = 0; i < bytes.length; i += 32) teile.push(Array.from(bytes.subarray(i, i + 32), (b) => b.toString(16).padStart(2, '0')).join(''));
  return teile.join('\n') + '\n';
};
const zeilenTexte = (eingabe: CodeTableTestSheetInput): string[] =>
  codeTableTestSheet(eingabe).blocks.map((b) => (b.kind === 'line' ? b.text : `<${b.kind}>`));

test('Testblatt: immer 32 Spalten, jede Zeile genau so breit, auch fuer 80 mm', () => {
  for (const paper of ['mm58', 'mm80'] as const) {
    const blatt = codeTableTestSheet({ ...EINGABE, paper });
    assert.equal(CODE_TABLE_TEST_SHEET_CHARS, 32);
    assert.equal(blatt.charsPerLine, 32);
    for (const b of blatt.blocks) {
      assert.equal(b.kind, 'line');
      if (b.kind === 'line') assert.equal(b.text.length, 32, JSON.stringify(b.text));
    }
  }
});

test('Testblatt: Aufbau wie in der Spec abgenommen', () => {
  const r = (s: string): string => s.padEnd(32, ' ');
  assert.deepEqual(zeilenTexte(EINGABE), [
    r('================================'),
    r('        ZEICHENSATZ-TEST'),
    r('   Kasse KECK-1  30.09. 14:05'),
    r('================================'),
    r('So muss jede Zeile aussehen:'),
    r('     ä ö ü Ä Ö Ü ß € § °'),
    r('--------------------------------'),
    r(' 1 | ä ö ü Ä Ö Ü ß € § °'),
    r(' 2 | ä ö ü Ä Ö Ü ß € § °'),
    r(' 3 | ä ö ü Ä Ö Ü ß   § °'),
    r(' 4 | ä ö ü Ä Ö Ü ß     °'),
    r(' 5 | ä ö ü Ä Ö Ü ß € § °'),
    r('--------------------------------'),
    r(' 6 | ae oe ue Ae Oe Ue ss EUR'),
    r('     Par. Grad'),
    r('     (Ersatz, passt immer)'),
    r('================================'),
    r('Die Nummer der ersten Zeile, die'),
    r('genau wie oben aussieht, in der'),
    r('Kasse antippen.'),
    r('================================'),
  ]);
});

test('Testblatt: Texte kommen aus dem Katalog', () => {
  const texte = zeilenTexte(EINGABE).map((t) => t.trim());
  assert.ok(texte.includes(labelText('codetable.title')));
  assert.ok(texte.includes(labelText('codetable.reference')));
  assert.ok(texte.includes(labelText('codetable.replacement_note')));
  assert.equal(texte.slice(17, 20).join(' '), messageText('codetable.instruction'));
});

test('Testblatt: Nummern gross (doppelte Breite und Hoehe), je Zeile Tabelle und fehlende Zeichen', () => {
  const blatt = codeTableTestSheet(EINGABE);
  const zeilen = blatt.blocks.filter((b) => b.kind === 'line' && b.doubleSizeLead !== undefined);
  assert.deepEqual(zeilen.map((b) => (b.kind === 'line' ? [b.text.slice(0, 2), b.doubleSizeLead, b.bold] : null)), [1, 2, 3, 4, 5, 6].map((n) => [` ${n}`, 2, false]));
  assert.deepEqual(blatt.rows, CODE_TABLES.map((t) => ({ number: t.number, codeTable: t.id, missing: t.missing })));
  assert.deepEqual(blatt.rows[2]!.missing, ['€']);
  assert.deepEqual(blatt.rows[3]!.missing, ['€', '§']);
});

test('Testblatt: Kopfzeile in Wiener Zeit, auch um Mitternacht UTC', () => {
  const texte = zeilenTexte({ ...EINGABE, time: new Date('2026-09-29T23:30:00Z') });
  assert.equal(texte[2]!.trim(), 'Kasse KECK-1  30.09. 01:30');
  const winter = zeilenTexte({ ...EINGABE, time: new Date('2026-12-31T23:30:00Z') });
  assert.equal(winter[2]!.trim(), 'Kasse KECK-1  01.01. 00:30');
});

test('Testblatt: Kassenname ohne Umlaut-Risiko (Ersatzbuchstaben), langer Name bricht um', () => {
  const texte = zeilenTexte({ ...EINGABE, cashregisterLabel: 'Bäckerei Straße' });
  assert.equal(texte[2]!.trim(), 'Baeckerei Strasse  30.09. 14:05');
  const lang = codeTableTestSheet({ ...EINGABE, cashregisterLabel: 'Kasse mit einem sehr langen Namen am Tresen' });
  for (const b of lang.blocks) if (b.kind === 'line') assert.equal(b.text.length, 32);
});

test('Vorlage-Zeile: Rasterbild 384 x 24, Tinte nur in den Spalten der zehn Zeichen', () => {
  const bild = codeTableReferenceImage();
  assert.equal(bild.width, 384);
  assert.equal(bild.height, 24);
  const vorlage = zeilenTexte(EINGABE)[5]!;
  for (let spalte = 0; spalte < 32; spalte++) {
    let tinte = 0;
    for (let y = 0; y < 24; y++) for (let x = spalte * 12; x < spalte * 12 + 12; x++) tinte += bild.dots[y * 384 + x]!;
    if (vorlage[spalte] === ' ') assert.equal(tinte, 0, `Spalte ${spalte} leer`);
    else assert.ok(tinte > 8, `Spalte ${spalte} (${vorlage[spalte]}) hat Tinte`);
  }
});

test('Bytes: Vorlage als GS v 0, jede Zeile FS . + ESC t n + Bytes der Tabelle, Nummer doppelt gross', () => {
  const bytes = codeTableTestSheetBytes(EINGABE);
  const vorlage = enthaelt(bytes, [GS, 0x76, 0x30, 0x00, 48, 0, 24, 0]);
  assert.ok(vorlage > 0, 'Rasterkopf fehlt');
  const zeilen = zeilenTexte(EINGABE);
  let zuletzt = vorlage;
  for (const t of CODE_TABLES) {
    const zeile = zeilen.find((z) => z.startsWith(` ${t.number} | `))!;
    const nummer = enthaelt(bytes, [GS, 0x21, 0x11, FS, 0x2e, ESC, 0x74, t.escT, 0x30 + t.number]);
    assert.ok(nummer > zuletzt, `Nummer ${t.number} doppelt gross nach ESC t ${t.escT}`);
    const rest = [FS, 0x2e, ESC, 0x74, t.escT, ...encodeForCodeTable(zeile.slice(2).trimEnd(), t.id), LF];
    const i = enthaelt(bytes, rest);
    assert.ok(i > nummer, `Zeile ${t.number}: Zeichen in Tabelle ${t.id}`);
    zuletzt = i;
  }
  // Das echte €-Byte, wo die Tabelle es hat (nicht EUR).
  assert.ok(enthaelt(bytes, [0xdf, 0x20, 0x80, 0x20, 0xa7]) > 0, 'wpc1252: ß € §');
  assert.ok(enthaelt(bytes, [0xe1, 0x20, 0xd5, 0x20, 0xf5]) > 0, 'pc858: ß € §');
  assert.ok(enthaelt(bytes, [0xdf, 0x20, 0xa4, 0x20, 0xa7]) > 0, 'iso8859_15: ß € §');
});

test('Bytes: 58 mm ohne Rand, 80 mm mit dem 32-Spalten-Block mittig (GS L 96)', () => {
  const b58 = codeTableTestSheetBytes(EINGABE);
  const b80 = codeTableTestSheetBytes({ ...EINGABE, paper: 'mm80' });
  const bereich = [GS, 0x57, 0x80, 0x01];
  assert.deepEqual(Array.from(b58.subarray(0, 10)), [ESC, 0x40, GS, 0x4c, 0, 0, ...bereich]);
  assert.deepEqual(Array.from(b80.subarray(0, 14)), [ESC, 0x40, GS, 0x4c, 0, 0, ...bereich, GS, 0x4c, 96, 0]);
  // Danach dieselben Bytes: nur der Rand unterscheidet die beiden Papiere.
  assert.deepEqual(Array.from(b80.subarray(14)), Array.from(b58.subarray(10)));
  const titel = enthaelt(b58, ascii('ZEICHENSATZ-TEST'));
  assert.ok(titel > 0);
});

test('Bytes und Zeilen: gemeinsame Prueffaelle mit dem Dart-Zwilling', () => {
  const pfad = (name: string): URL => new URL(`../../fixtures/expected/code-table-test-sheet.${name}`, import.meta.url);
  const fall = JSON.parse(readFileSync(pfad('lines.json'), 'utf8')) as { input: { cashregisterLabel: string; time: string }; sheet: unknown };
  assert.deepEqual(fall.input, { cashregisterLabel: EINGABE.cashregisterLabel, time: EINGABE.time.toISOString() });
  assert.deepEqual(JSON.parse(JSON.stringify(codeTableTestSheet(EINGABE))), fall.sheet);
  assert.equal(hex(codeTableTestSheetBytes(EINGABE)), readFileSync(pfad('mm58.hex'), 'utf8'));
  assert.equal(hex(codeTableTestSheetBytes({ ...EINGABE, paper: 'mm80' })), readFileSync(pfad('mm80.hex'), 'utf8'));
});
