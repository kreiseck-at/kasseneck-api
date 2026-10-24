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
  type LayoutColumnsLine,
  type LayoutLine,
  type PrintLogo,
  type ReceiptLayout,
} from '../src/receipt/index.js';
import { KasseneckValidationError } from '../src/client/errors.js';

/**
 * Belegduplikat (Erlass BMF-AV Nr. 2/2026, Abschnitt 4.5.6): ein Nachdruck
 * traegt im Kennungsblock direkt unter `Beleg-ID:` die Zeile
 * `Duplikat am: TT.MM.JJJJ HH:MM:SS` (Wiener Zeit des Nachdrucks), alles
 * andere bleibt Zeichen fuer Zeichen und Byte fuer Byte wie beim Erstdruck.
 * Die Prueffaelle unter `fixtures/duplicate-cases.json` (erzeugt von
 * `npm run fixtures:duplikat`) teilt das Paket mit dem Dart-Zwilling.
 */

const wurzel = new URL('../../fixtures/', import.meta.url);
const lies = <T>(pfad: string): T => JSON.parse(readFileSync(new URL(pfad, wurzel), 'utf8')) as T;
const golden = (name: string): ReceiptLayout => lies<ReceiptLayout>(`expected/${name}.lines.json`);

/** 24.10.2026 14:10:05 in Wien (Sommerzeit, UTC+2). */
const NACHDRUCK = new Date('2026-10-24T12:10:05Z');
const SOLL32 = 'Duplikat am: 24.10.2026 14:10:05';
const SOLL48 = `Duplikat am:${' '.repeat(17)}24.10.2026 14:10:05`;

/** Die Zeile, wie das Layout sie traegt (nicht fett, Wert rechtsbuendig). */
const zeile = (zeit: string): LayoutColumnsLine => ({
  kind: 'columns',
  columns: [
    { text: 'Duplikat am:', width: 5, align: 'left' },
    { text: zeit, width: 7, align: 'right' },
  ],
});

const istBelegId = (z: LayoutLine): boolean => z.kind === 'columns' && z.columns[0]?.text === 'Beleg-ID:';

/** Der Erstdruck mit der Zeile an ihrer Stelle: direkt nach `Beleg-ID:`, ohne diese Zeile ganz oben. */
function erwartet(erst: ReceiptLayout, zeit: string): ReceiptLayout {
  const lines = [...erst.lines];
  lines.splice(lines.findIndex(istBelegId) + 1, 0, zeile(zeit));
  return { ...erst, lines };
}

/** Alle Golden-Layouts des Vertrags: jede Belegart, die das Layout kennt, dazu die Schicht-Bons. */
const GOLDENS = readdirSync(new URL('expected/', wurzel))
  .filter((d) => d.endsWith('.lines.json') && !d.startsWith('code-table-'))
  .map((d) => d.slice(0, -'.lines.json'.length))
  .sort();

test('Duplikat: Zeile direkt unter „Beleg-ID:“ – 32 und 48 Zeichen genau wie vereinbart, nicht fett', () => {
  const erst = golden('sale-cash');
  const dup = markAsDuplicate(erst, NACHDRUCK);
  assert.deepEqual(dup, erwartet(erst, '24.10.2026 14:10:05'));
  for (const [zeichen, soll] of [[32, SOLL32], [48, SOLL48]] as const) {
    const raster = renderReceiptGrid(dup, { charsPerLine: zeichen }).lines;
    const i = raster.findIndex((z) => z.text.startsWith('Beleg-ID:'));
    assert.ok(i >= 0, `${zeichen}: Beleg-ID-Zeile`);
    assert.equal(raster[i + 1]!.text, soll, `${zeichen}: Zeile darunter`);
    assert.equal(raster[i + 1]!.text.length, zeichen);
    assert.equal(raster[i + 1]!.bold, false, `${zeichen}: nicht fett`);
    assert.equal(raster[i + 2]!.kind, 'space', `${zeichen}: kein Umbruch`);
  }
});

test('Duplikat: jede Belegart des Vertrags (Standard, Storno, Null-/Startbeleg, Gutschein, Schicht) – genau eine Zeile mehr, kein Aufdruck', () => {
  for (const pflicht of ['sale-cash', 'cancellation-full', 'training', 'zero-start', 'zero-monthly', 'voucher-multi-purpose-redeem', 'voucher-single-purpose-sale', 'shift-close', 'cash-movement']) {
    assert.ok(GOLDENS.includes(pflicht), pflicht);
  }
  for (const name of GOLDENS) {
    const erst = golden(name);
    const dup = markAsDuplicate(erst, NACHDRUCK);
    assert.deepEqual(dup, erwartet(erst, '24.10.2026 14:10:05'), name);
    assert.ok(!dup.lines.some((z) => (z.kind === 'banner' || z.kind === 'text') && z.text.includes('DUPLIKAT')), `${name}: kein Aufdruck`);
    // Das Raster ist das des Erstdrucks mit genau einer Zeile dazu.
    for (const [zeichen, soll] of [[32, SOLL32], [48, SOLL48]] as const) {
      const a = gridToText(renderReceiptGrid(erst, { charsPerLine: zeichen })).split('\n');
      const b = gridToText(renderReceiptGrid(dup, { charsPerLine: zeichen })).split('\n');
      const i = a.findIndex((t) => t.startsWith('Beleg-ID:')) + 1;
      assert.deepEqual(b, [...a.slice(0, i), soll, ...a.slice(i)], `${name}/${zeichen}`);
    }
  }
});

test('Duplikat: Layout ohne „Beleg-ID:“ – die Zeile steht ganz oben', () => {
  const schicht = golden('shift-close');
  assert.ok(!schicht.lines.some(istBelegId));
  const dup = markAsDuplicate(schicht, NACHDRUCK);
  assert.deepEqual(dup.lines, [zeile('24.10.2026 14:10:05'), ...schicht.lines]);
  assert.deepEqual(markAsDuplicate({ paperSize: 'mm80', ruleset: 2, lines: [] }, NACHDRUCK), { paperSize: 'mm80', ruleset: 2, lines: [zeile('24.10.2026 14:10:05')] });
  // Ein „Beleg-ID:“ als Text (nicht als Spaltenzeile) zaehlt nicht.
  const text: ReceiptLayout = { paperSize: 'mm58', ruleset: 2, lines: [{ kind: 'text', text: 'Beleg-ID:', align: 'left', bold: false }] };
  assert.deepEqual(markAsDuplicate(text, NACHDRUCK).lines, [zeile('24.10.2026 14:10:05'), ...text.lines]);
});

test('Duplikat: noch einmal nachgedruckt – eine Zeile, die spaetere Zeit, an derselben Stelle', () => {
  for (const name of ['sale-cash', 'zero-start', 'shift-close']) {
    const erst = golden(name);
    const einmal = markAsDuplicate(erst, NACHDRUCK);
    const zweimal = markAsDuplicate(einmal, new Date('2026-10-24T13:45:00Z'));
    assert.deepEqual(zweimal, erwartet(erst, '24.10.2026 15:45:00'), name);
    // Dieselbe Zeit noch einmal: unveraendert.
    assert.deepEqual(markAsDuplicate(einmal, NACHDRUCK), einmal, name);
  }
  // Eine Duplikat-Zeile an anderer Stelle bleibt dort; eine zweite faellt weg.
  const doppelt: ReceiptLayout = { paperSize: 'mm80', ruleset: 2, lines: [
    { kind: 'text', text: 'Bäckerei Kornblum', align: 'center', bold: true },
    zeile('01.01.2026 08:00:00'),
    { kind: 'columns', columns: [{ text: 'Beleg-ID:', width: 6, align: 'left' }, { text: 'AT0-KASSE1-42', width: 6, align: 'right' }] },
    zeile('02.01.2026 08:00:00'),
  ] };
  assert.deepEqual(markAsDuplicate(doppelt, NACHDRUCK).lines, [doppelt.lines[0], zeile('24.10.2026 14:10:05'), doppelt.lines[2]]);
});

test('Duplikat: Wiener Zeit des Nachdrucks, auch an den Umstellungen (nie die Zeitzone des Rechners)', () => {
  const zeit = (iso: string): string => {
    const dup = markAsDuplicate({ paperSize: 'mm80', ruleset: 2, lines: [] }, new Date(iso));
    const z = dup.lines[0]!;
    assert.ok(z.kind === 'columns');
    return z.columns[1]!.text;
  };
  // Ende der Sommerzeit: 03:00 MESZ wird 02:00 MEZ.
  assert.equal(zeit('2026-10-25T00:59:59Z'), '25.10.2026 02:59:59');
  assert.equal(zeit('2026-10-25T01:00:00Z'), '25.10.2026 02:00:00');
  // Beginn der Sommerzeit: 02:00 MEZ wird 03:00 MESZ.
  assert.equal(zeit('2026-03-29T00:59:59Z'), '29.03.2026 01:59:59');
  assert.equal(zeit('2026-03-29T01:00:00Z'), '29.03.2026 03:00:00');
  // Winter, Jahreswechsel, Bruchteile werden abgeschnitten (nicht gerundet).
  assert.equal(zeit('2026-12-31T23:30:00Z'), '01.01.2027 00:30:00');
  assert.equal(zeit('2026-10-24T12:10:05.999Z'), '24.10.2026 14:10:05');
  // Eine Wiener Uhrzeit, die es in New York nicht gibt (dort Sommerzeitbeginn 08.03. 02:00).
  assert.equal(zeit('2026-03-08T01:30:00Z'), '08.03.2026 02:30:00');
});

test('Duplikat: unbrauchbarer Zeitpunkt wirft KasseneckValidationError (request)', () => {
  const erst = golden('sale-cash');
  for (const falsch of [new Date('kaputt'), '2026-10-24T12:10:05Z' as unknown as Date, undefined as unknown as Date]) {
    assert.throws(() => markAsDuplicate(erst, falsch), (e: unknown) => e instanceof KasseneckValidationError && e.scope === 'request' && e.functionName === 'markAsDuplicate');
  }
});

test('Duplikat: die Eingabe bleibt unangetastet, das Ergebnis ist eine eigene Kopie', () => {
  const erst = golden('voucher-multi-purpose-redeem');
  const vorher = JSON.stringify(erst);
  const dup = markAsDuplicate(erst, NACHDRUCK);
  assert.equal(JSON.stringify(erst), vorher);
  assert.notEqual(dup, erst);
  assert.notEqual(dup.lines, erst.lines);
  // Wer am Ergebnis dreht, dreht nicht am Erstdruck.
  for (const z of dup.lines) {
    if (z.kind === 'columns') {
      z.columns[0]!.text = 'verändert';
      z.columns.push({ text: 'dazu', width: 1, align: 'left' });
    } else if (z.kind === 'text') {
      z.text = 'verändert';
    }
  }
  assert.equal(JSON.stringify(erst), vorher);
  // Auch der Weg ueber ein schon gekennzeichnetes Layout gibt eine Kopie und laesst es stehen.
  const einmal = markAsDuplicate(erst, NACHDRUCK);
  const einmalVorher = JSON.stringify(einmal);
  const zweit = markAsDuplicate(einmal, new Date('2026-10-24T13:45:00Z'));
  assert.equal(JSON.stringify(einmal), einmalVorher);
  assert.notEqual(zweit.lines, einmal.lines);
});

// ------------------------------------------------------------------ Zwilling

interface DuplikatFall {
  name: string;
  receipt?: string;
  input?: ReceiptLayout;
  paperSize?: 'mm58' | 'mm80';
  printedAt: string[];
  display: string;
  print: boolean;
  logo: boolean;
  expected: ReceiptLayout;
}
const zwilling = lies<{ version: number; label: string; cases: DuplikatFall[] }>('duplicate-cases.json');
const eingabe = (fall: DuplikatFall): ReceiptLayout => {
  const basis = fall.receipt !== undefined ? golden(fall.receipt) : fall.input!;
  return fall.paperSize !== undefined ? { ...basis, paperSize: fall.paperSize } : basis;
};
const hex = (bytes: Uint8Array): string => {
  const teile: string[] = [];
  for (let i = 0; i < bytes.length; i += 32) teile.push(Array.from(bytes.subarray(i, i + 32), (b) => b.toString(16).padStart(2, '0')).join(''));
  return teile.join('\n') + '\n';
};

/** Probe-Logo der Vertragsfaelle mit `logo`: Stufe M, 300x120 px, jeder Punkt schwarz. */
function probeLogo(zeichen: number): PrintLogo {
  const mass = logoDimensions({ size: 'M', pixelWidth: 300, pixelHeight: 120 }, zeichen);
  const { width, height } = logoRasterSize(mass, zeichen);
  return { size: 'M', pixelWidth: 300, pixelHeight: 120, raster: { width, height, dots: new Uint8Array(width * height).fill(1) } };
}
const zeichenVon = (paperSize: string): number => (paperSize === 'mm58' ? 32 : 48);

test('Zwilling: Prueffaelle decken Belegarten, Breiten und Umstellungen ab', () => {
  assert.equal(zwilling.version, 2);
  assert.equal(zwilling.label, 'Duplikat am:');
  const namen = zwilling.cases.map((f) => f.receipt ?? f.name);
  for (const pflicht of ['sale-cash', 'cancellation-full', 'zero-start', 'voucher-multi-purpose-redeem', 'shift-close']) {
    assert.ok(namen.includes(pflicht), pflicht);
  }
  const gedruckt = zwilling.cases.filter((f) => f.print);
  assert.ok(gedruckt.some((f) => eingabe(f).paperSize === 'mm58') && gedruckt.some((f) => eingabe(f).paperSize === 'mm80'), 'Bytes fuer 58 und 80 mm');
  assert.ok(gedruckt.some((f) => f.logo), 'ein Fall mit Logo');
  assert.ok(zwilling.cases.some((f) => f.printedAt.length > 1), 'ein Fall zweimal angewandt');
  assert.ok(zwilling.cases.some((f) => !eingabe(f).lines.some(istBelegId)), 'ein Fall ohne Beleg-ID');
  for (const [iso, anzeige] of [['2026-10-25T00:59:59Z', '25.10.2026 02:59:59'], ['2026-10-25T01:00:00Z', '25.10.2026 02:00:00'], ['2026-03-29T01:00:00Z', '29.03.2026 03:00:00']]) {
    assert.ok(zwilling.cases.some((f) => f.printedAt.at(-1) === iso && f.display === anzeige), iso);
  }
  const hexDateien = readdirSync(new URL('expected/', wurzel)).filter((d) => d.startsWith('duplicate.')).sort();
  assert.deepEqual(hexDateien, gedruckt.map((f) => `duplicate.${f.name}.hex`).sort());
});

for (const fall of zwilling.cases) {
  test(`Zwilling ${fall.name}: Layout${fall.print ? ' und Bytes' : ''} wie in der Vertragsdatei`, () => {
    let layout = eingabe(fall);
    for (const iso of fall.printedAt) layout = markAsDuplicate(layout, new Date(iso));
    assert.equal(JSON.stringify(layout, null, 2), JSON.stringify(fall.expected, null, 2));
    assert.ok(layout.lines.some((z) => z.kind === 'columns' && z.columns[0]?.text === 'Duplikat am:' && z.columns[1]?.text === fall.display), 'Anzeige der Zeit');
    if (fall.print) {
      const logo = fall.logo ? probeLogo(zeichenVon(layout.paperSize)) : null;
      assert.equal(hex(escPosLayoutBytes(layout, { logo })), readFileSync(new URL(`expected/duplicate.${fall.name}.hex`, wurzel), 'utf8'));
    }
  });
}

// ---------------------------------------------------------------- Bytestrom

const latin1 = (b: Uint8Array): string => Array.from(b, (v) => String.fromCharCode(v)).join('');

/**
 * Der Nachdruck am Drucker ist der Erstdruck mit genau einer Zeile mehr:
 * dieselben Bytes bis einschliesslich der Zeile `Beleg-ID:`, dann derselbe
 * Zeichensatz-Vorspann wie vor jeder Zeile, `Duplikat am: …` und der
 * Zeilenvorschub, dann wieder dieselben Bytes bis zum
 * Schnitt (Logo, QR, Signaturtext). Die Zeile steht im selben Stil wie
 * `Beleg-ID:` (nicht fett, linksbuendig), darum kommt kein Stilbefehl dazu.
 */
test('ESC/POS: Nachdruck = Erstdruck plus genau die Zeile „Duplikat am:“ (Byte fuer Byte)', () => {
  for (const name of ['sale-cash', 'voucher-multi-purpose-redeem', 'zero-start', 'cancellation-full', 'test-cashregister-sale', 'cancellation-partial', 'voucher-service-redeem']) {
    for (const paperSize of ['mm58', 'mm80'] as const) {
      const zeichen = zeichenVon(paperSize);
      for (const logo of [null, probeLogo(zeichen)]) {
        const fall = `${name}/${paperSize}/${logo ? 'Logo' : 'ohne Logo'}`;
        const erst = golden(name);
        const optionen = { paperSize, logo };
        const a = latin1(escPosLayoutBytes(erst, optionen));
        const b = latin1(escPosLayoutBytes(markAsDuplicate(erst, NACHDRUCK), optionen));
        const beleg = a.indexOf('Beleg-ID:');
        assert.ok(beleg > 0, `${fall}: Beleg-ID im Erstdruck`);
        const ende = a.indexOf('\n', beleg) + 1;
        // Jede Zeile beginnt mit demselben Zeichensatz-Vorspann (FS ., ESC t n); den traegt auch die neue Zeile.
        const zeilenVorspann = a.slice(a.lastIndexOf('\n', beleg) + 1, beleg);
        assert.equal(zeilenVorspann, '\x1c.\x1bt\x10', fall);
        assert.equal(b, `${a.slice(0, ende)}${zeilenVorspann}${zeichen === 32 ? SOLL32 : SOLL48}\n${a.slice(ende)}`, fall);
      }
    }
  }
});

/** Ohne Stilbefehle `ESC E n` (fett) und `ESC a n` (Ausrichtung): was als Zeichen aufs Papier kommt. */
const ohneStil = (s: string): string => s.replace(/\x1bE[\x00\x01]|\x1ba[\x00-\x02\x30-\x32]/g, '');

test('ESC/POS: ohne „Beleg-ID:“ steht die Zeile vor der ersten Zeile des Erstdrucks', () => {
  for (const name of ['shift-close', 'cash-movement']) {
    for (const paperSize of ['mm58', 'mm80'] as const) {
      const soll = zeichenVon(paperSize) === 32 ? SOLL32 : SOLL48;
      const erst = golden(name);
      const a = latin1(escPosLayoutBytes(erst, { paperSize }));
      const b = latin1(escPosLayoutBytes(markAsDuplicate(erst, NACHDRUCK), { paperSize }));
      const vorspann = latin1(escPosLayoutBytes({ ...erst, lines: [] }, { paperSize, cut: false }));
      assert.ok(a.startsWith(vorspann) && b.startsWith(vorspann), `${name}/${paperSize}: Vorspann`);
      const kopf = b.slice(vorspann.length, b.indexOf('\n', vorspann.length) + 1);
      assert.equal(ohneStil(kopf), `\x1c.\x1bt\x10${soll}\n`, `${name}/${paperSize}: Zeile zuerst`);
      assert.ok(!kopf.includes('\x1bE\x01'), `${name}/${paperSize}: nicht fett`);
      // Danach der Erstdruck; nur Stilbefehle duerfen sich verschieben.
      assert.equal(ohneStil(b.slice(vorspann.length + kopf.length)), ohneStil(a.slice(vorspann.length)), `${name}/${paperSize}: Rest`);
    }
  }
});
