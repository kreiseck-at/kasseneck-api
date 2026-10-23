import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

import {
  escPosLayoutBytes,
  gridToText,
  logoDimensions,
  logoRasterSize,
  markAsDuplicate,
  renderReceiptGrid,
  type LayoutLine,
  type PrintLogo,
  type ReceiptLayout,
} from '../src/receipt/index.js';

/**
 * Belegduplikat (Erlass BMF-AV Nr. 2/2026, Abschnitt 4.5.6): ein Nachdruck
 * traegt oben den Aufdruck „DUPLIKAT“, alles andere bleibt Zeichen fuer
 * Zeichen und Byte fuer Byte wie beim Erstdruck. Die Prueffaelle unter
 * `fixtures/duplicate-cases.json` (erzeugt von `npm run fixtures:duplikat`)
 * teilt das Paket mit dem Dart-Zwilling.
 */

const wurzel = new URL('../../fixtures/', import.meta.url);
const lies = <T>(pfad: string): T => JSON.parse(readFileSync(new URL(pfad, wurzel), 'utf8')) as T;
const golden = (name: string): ReceiptLayout => lies<ReceiptLayout>(`expected/${name}.lines.json`);

const AUFDRUCK: LayoutLine = { kind: 'banner', text: 'DUPLIKAT', tone: 'receipt_type' };

/** Alle Golden-Layouts des Vertrags: jede Belegart, die das Layout kennt, dazu die Schicht-Bons. */
const GOLDENS = readdirSync(new URL('expected/', wurzel))
  .filter((d) => d.endsWith('.lines.json') && !d.startsWith('code-table-'))
  .map((d) => d.slice(0, -'.lines.json'.length))
  .sort();

test('Duplikat: neue erste Zeile „DUPLIKAT“ als Aufdruck (zentriert, fett, gerahmt), der Rest unveraendert', () => {
  const erst = golden('sale-cash');
  const dup = markAsDuplicate(erst);
  assert.deepEqual(dup.lines[0], AUFDRUCK);
  assert.deepEqual(dup.lines.slice(1), erst.lines);
  assert.equal(dup.paperSize, erst.paperSize);
  assert.equal(dup.ruleset, erst.ruleset);
  // Im Raster: Rahmen, zentrierter Text, Rahmen -- und alle drei fett.
  const raster = renderReceiptGrid(dup, { charsPerLine: 32 }).lines.slice(0, 3);
  assert.deepEqual(raster.map((z) => z.text), ['='.repeat(32), `${' '.repeat(12)}DUPLIKAT${' '.repeat(12)}`, '='.repeat(32)]);
  assert.ok(raster.every((z) => z.bold && z.kind === 'banner'));
});

test('Duplikat: jede Belegart des Vertrags (Standard, Storno, Null-/Startbeleg, Gutschein, Schicht) -- QR, Betraege, Signatur unveraendert', () => {
  for (const pflicht of ['sale-cash', 'cancellation-full', 'training', 'zero-start', 'zero-monthly', 'voucher-multi-purpose-redeem', 'voucher-single-purpose-sale', 'shift-close', 'cash-movement']) {
    assert.ok(GOLDENS.includes(pflicht), pflicht);
  }
  for (const name of GOLDENS) {
    const erst = golden(name);
    const dup = markAsDuplicate(erst);
    assert.deepEqual(dup, { ...erst, lines: [AUFDRUCK, ...erst.lines] }, name);
    // Das Raster ist das des Erstdrucks mit drei Zeilen davor (Rahmen, Text, Rahmen).
    for (const zeichen of [32, 48]) {
      const a = gridToText(renderReceiptGrid(erst, { charsPerLine: zeichen }));
      const b = gridToText(renderReceiptGrid(dup, { charsPerLine: zeichen }));
      const kopf = `${'='.repeat(zeichen)}\n${'DUPLIKAT'.padStart((zeichen + 8) / 2).padEnd(zeichen)}\n${'='.repeat(zeichen)}\n`;
      assert.equal(b, kopf + a, `${name}/${zeichen}`);
    }
  }
});

test('Duplikat: die Eingabe bleibt unangetastet, das Ergebnis ist eine eigene Kopie', () => {
  const erst = golden('voucher-multi-purpose-redeem');
  const vorher = JSON.stringify(erst);
  const dup = markAsDuplicate(erst);
  assert.equal(JSON.stringify(erst), vorher);
  assert.notEqual(dup, erst);
  assert.notEqual(dup.lines, erst.lines);
  // Wer am Ergebnis dreht, dreht nicht am Erstdruck.
  const spalten = dup.lines.find((z) => z.kind === 'columns');
  assert.ok(spalten && spalten.kind === 'columns');
  spalten.columns[0]!.text = 'verändert';
  const text = dup.lines.find((z, i) => i > 0 && z.kind === 'text');
  assert.ok(text && text.kind === 'text');
  text.text = 'verändert';
  assert.equal(JSON.stringify(erst), vorher);
  // Auch der Weg ueber ein schon gekennzeichnetes Layout gibt eine Kopie.
  const zweit = markAsDuplicate(dup);
  assert.notEqual(zweit, dup);
  assert.notEqual(zweit.lines, dup.lines);
});

test('Duplikat: idempotent -- zweimal angewandt wie einmal (Erkennung an der eigenen ersten Zeile)', () => {
  for (const name of GOLDENS) {
    const einmal = markAsDuplicate(golden(name));
    assert.deepEqual(markAsDuplicate(einmal), einmal, name);
    assert.deepEqual(markAsDuplicate(markAsDuplicate(einmal)), einmal, name);
  }
  // Ein „DUPLIKAT“ weiter unten (etwa im Artikelnamen) ist keine Kennzeichnung.
  const artikel: ReceiptLayout = { paperSize: 'mm58', ruleset: 2, lines: [{ kind: 'text', text: 'DUPLIKAT', align: 'center', bold: true }] };
  assert.deepEqual(markAsDuplicate(artikel).lines, [AUFDRUCK, ...artikel.lines]);
});

test('Duplikat: leeres Layout wirft nicht', () => {
  assert.deepEqual(markAsDuplicate({ paperSize: 'mm80', ruleset: 2, lines: [] }), { paperSize: 'mm80', ruleset: 2, lines: [AUFDRUCK] });
});

// ------------------------------------------------------------------ Zwilling

interface DuplikatFall {
  name: string;
  receipt?: string;
  input?: ReceiptLayout;
  times: number;
  print: boolean;
  expected: ReceiptLayout;
}
const zwilling = lies<{ version: number; text: string; cases: DuplikatFall[] }>('duplicate-cases.json');
const eingabe = (fall: DuplikatFall): ReceiptLayout => (fall.receipt !== undefined ? golden(fall.receipt) : fall.input!);
const hex = (bytes: Uint8Array): string => {
  const teile: string[] = [];
  for (let i = 0; i < bytes.length; i += 32) teile.push(Array.from(bytes.subarray(i, i + 32), (b) => b.toString(16).padStart(2, '0')).join(''));
  return teile.join('\n') + '\n';
};

test('Zwilling: Prueffaelle decken die Belegarten ab und nennen den Aufdruck', () => {
  assert.equal(zwilling.text, 'DUPLIKAT');
  const namen = zwilling.cases.map((f) => f.receipt ?? f.name);
  for (const pflicht of ['sale-cash', 'cancellation-full', 'zero-start', 'voucher-multi-purpose-redeem', 'test-cashregister-sale', 'shift-close']) {
    assert.ok(namen.includes(pflicht), pflicht);
  }
  assert.ok(zwilling.cases.some((f) => f.times > 1), 'ein Fall wendet mehrfach an (Idempotenz)');
  assert.ok(zwilling.cases.some((f) => f.input?.lines.length === 0), 'ein Fall ohne Zeilen');
  const hexDateien = readdirSync(new URL('expected/', wurzel)).filter((d) => d.startsWith('duplicate.')).sort();
  assert.deepEqual(hexDateien, zwilling.cases.filter((f) => f.print).map((f) => `duplicate.${f.name}.hex`).sort());
  assert.ok(hexDateien.length >= 2);
});

for (const fall of zwilling.cases) {
  test(`Zwilling ${fall.name}: Layout${fall.print ? ' und Bytes' : ''} wie in der Vertragsdatei`, () => {
    let layout = eingabe(fall);
    for (let i = 0; i < fall.times; i += 1) layout = markAsDuplicate(layout);
    assert.equal(JSON.stringify(layout, null, 2), JSON.stringify(fall.expected, null, 2));
    if (fall.print) assert.equal(hex(escPosLayoutBytes(layout)), readFileSync(new URL(`expected/duplicate.${fall.name}.hex`, wurzel), 'utf8'));
  });
}

// ---------------------------------------------------------------- Bytestrom

const latin1 = (b: Uint8Array): string => Array.from(b, (v) => String.fromCharCode(v)).join('');

function probeLogo(zeichen: number): PrintLogo {
  const mass = logoDimensions({ size: 'M', pixelWidth: 300, pixelHeight: 120 }, zeichen);
  const { width, height } = logoRasterSize(mass, zeichen);
  return { size: 'M', pixelWidth: 300, pixelHeight: 120, raster: { width, height, dots: new Uint8Array(width * height).fill(1) } };
}

/**
 * Der Bytestrom so, wie der Drucker ihn ausfuehrt: jedes Byte ausser den
 * Stilbefehlen `ESC E n` (fett) und `ESC a n` (Ausrichtung), jeweils mit dem
 * Stil, der in diesem Moment wirkt. Der Druckweg sendet einen Stil nur, wenn
 * er sich aendert; nach dem fetten Aufdruck faellt darum das `ESC E 1` des
 * fetten Firmennamens weg (bzw. vor dem Logo kommt ein `ESC E 0` dazu). Auf
 * dem Papier ist das dasselbe -- und genau das vergleicht diese Form: gleiche
 * Bytes im gleichen wirksamen Stil. (Gilt fuer diese Prueffaelle: weder das
 * Probe-Logo noch die QR-Nutzlast enthalten die Folge 1B 45 / 1B 61.)
 */
function wirksam(b: Uint8Array): string[] {
  let fett = false;
  let ausrichtung = 0x30;
  const aus: string[] = [];
  for (let i = 0; i < b.length; i += 1) {
    if (b[i] === 0x1b && b[i + 1] === 0x45) { fett = b[i + 2] === 1; i += 2; continue; }
    if (b[i] === 0x1b && b[i + 1] === 0x61) { ausrichtung = b[i + 2]!; i += 2; continue; }
    aus.push(`${b[i]!}|${fett ? 'fett' : 'normal'}|${String.fromCharCode(ausrichtung)}`);
  }
  return aus;
}

/**
 * Der Nachdruck am Drucker: derselbe Vorspann (Initialisierung, Druckbereich,
 * Codepage), dann der Aufdruck (drei fette Zeilen: Rahmen, „DUPLIKAT“,
 * Rahmen; mit Logo dazu die Leerzeile vor dem Logo, die das Blatt nach jedem
 * fuehrenden Rahmen setzt), dann der Erstdruck ab dem Ende des Vorspanns,
 * samt Logo, QR und Schnitt: Byte fuer Byte im selben wirksamen Stil.
 */
test('ESC/POS: Nachdruck beginnt nach dem Vorspann mit „DUPLIKAT“, der Rest ist der Erstdruck (gleiche Bytes, gleicher Stil)', () => {
  for (const name of ['sale-cash', 'voucher-multi-purpose-redeem', 'zero-start', 'cancellation-full', 'test-cashregister-sale', 'shift-close']) {
    for (const paperSize of ['mm58', 'mm80'] as const) {
      const zeichen = paperSize === 'mm58' ? 32 : 48;
      for (const logo of [null, probeLogo(zeichen)]) {
        const fall = `${name}/${paperSize}/${logo ? 'Logo' : 'ohne Logo'}`;
        const erst = golden(name);
        const optionen = { paperSize, logo };
        const a = escPosLayoutBytes(erst, optionen);
        const b = escPosLayoutBytes(markAsDuplicate(erst), optionen);
        const vorspann = escPosLayoutBytes({ ...erst, lines: [] }, { paperSize, cut: false });
        assert.deepEqual(a.subarray(0, vorspann.length), vorspann, fall);
        assert.deepEqual(b.subarray(0, vorspann.length), vorspann, fall);

        const wa = wirksam(a);
        const wb = wirksam(b);
        const nv = wirksam(vorspann).length;
        const rest = wa.length - nv;
        assert.ok(wb.length > wa.length, fall);
        assert.deepEqual(wb.slice(wb.length - rest), wa.slice(nv), `${fall}: Rest wie der Erstdruck`);

        // Der Kopf dazwischen: drei fette Zeilen, mit Logo dazu ein Vorschub, kein Bild.
        const kopf = wb.slice(nv, wb.length - rest);
        const text = kopf.map((t) => String.fromCharCode(Number(t.split('|')[0]))).join('');
        const zeilen = text.replace(/\x1c\x2e|\x1bt[\x00-\xff]/g, '').split('\n');
        assert.deepEqual(zeilen.slice(0, 3), ['='.repeat(zeichen), `${' '.repeat((zeichen - 8) / 2)}DUPLIKAT`, '='.repeat(zeichen)], fall);
        assert.deepEqual(zeilen.slice(3), logo && !erst.lines.some((z, i) => i === 0 && z.kind === 'banner') ? ['\x1bd\x01'] : [''], `${fall}: nach dem Aufdruck`);
        assert.ok(kopf.filter((t) => '=DUPLIKAT'.includes(String.fromCharCode(Number(t.split('|')[0])))).every((t) => t.endsWith('|fett|0')), `${fall}: Aufdruck fett`);
        assert.equal(text.indexOf('\x1dv0'), -1, `${fall}: kein Bild im Kopf`);
      }
    }
  }
});
