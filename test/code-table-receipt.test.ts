import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';

import { escPosPrintableText, CODE_TABLES, type CodeTableId } from '../src/printing/index.js';
import { fromReceiptPayload } from '../src/models/index.js';
import { buildReceiptLayout, escPosLayoutBytes, type BuildReceiptLayoutOptions, type ReceiptLayout } from '../src/receipt/index.js';

/**
 * Bons mit gewaehlter Code-Tabelle: der Golden-Beleg `sale-cash` (80 mm)
 * geht mit der Tabelle hinaus, die der Drucker-Wizard gewaehlt hat. Ohne Wahl
 * bleibt jedes Byte wie aufgenommen (`druck-goldens.test.ts`).
 */

const wurzel = new URL('../../fixtures/', import.meta.url);
const LAYOUT = JSON.parse(readFileSync(new URL('expected/sale-cash.lines.json', wurzel), 'utf8')) as ReceiptLayout;
const goldens = JSON.parse(readFileSync(new URL('../../test/fixtures/druck-goldens.json', import.meta.url), 'utf8')) as {
  receipts: Record<string, Record<string, string>>;
};

const ESC_T = (n: number): number[] => [0x1b, 0x74, n];
const ascii = (s: string): number[] => Array.from(s, (z) => z.charCodeAt(0));

function findeFolge(heu: Uint8Array, nadel: number[], ab = 0): number {
  outer: for (let i = ab; i <= heu.length - nadel.length; i++) {
    for (let j = 0; j < nadel.length; j++) if (heu[i + j] !== nadel[j]) continue outer;
    return i;
  }
  return -1;
}

/** Die gedruckte Zeile, die mit `anfang` beginnt (bis zum Zeilenvorschub). */
function zeileAb(bytes: Uint8Array, anfang: number[]): number[] {
  const start = findeFolge(bytes, anfang);
  assert.ok(start >= 0, `Zeile ${String.fromCharCode(...anfang)} fehlt`);
  const ende = bytes.indexOf(0x0a, start);
  return Array.from(bytes.subarray(start, ende));
}

/** Layout mit zusaetzlicher Artikelzeile, deren Name § und ° traegt. */
function mitSonderzeichen(): ReceiptLayout {
  const lines = [...LAYOUT.lines];
  lines.splice(12, 0, {
    kind: 'columns',
    columns: [
      { text: '1  x Tee 80° § 3', width: 7, align: 'left' },
      { text: '1,00 €', width: 5, align: 'right' },
    ],
  } as ReceiptLayout['lines'][number]);
  return { ...LAYOUT, lines };
}

test('Bon mit Tabelle: ohne Wahl byte-gleich zum aufgenommenen Golden', () => {
  const soll = goldens.receipts['sale-cash']?.['escpos.mm80'];
  const ist = createHash('sha256').update(Buffer.from(escPosLayoutBytes(LAYOUT, { paperSize: 'mm80' })).toString('hex')).digest('hex');
  assert.equal(ist, soll);
  assert.deepEqual(escPosLayoutBytes(LAYOUT, { codeTable: 'CP1252' }), escPosLayoutBytes(LAYOUT));
});

test('Bon mit Tabelle: pc858 schaltet ESC t 19, ä = 0x84 und das echte €-Byte', () => {
  const bytes = escPosLayoutBytes(LAYOUT, { codeTable: 'pc858' });
  assert.ok(findeFolge(bytes, ESC_T(19)) >= 0, 'ESC t 19 fehlt');
  assert.equal(findeFolge(bytes, ESC_T(16)), -1, 'ESC t 16 darf nicht vorkommen');
  assert.ok(findeFolge(bytes, [...ascii('B'), 0x84, ...ascii('ckerei Muster')]) >= 0, 'ä nicht als 0x84');
  assert.ok(findeFolge(bytes, [...ascii('Dank f'), 0x81, ...ascii('r')]) >= 0, 'ü nicht als 0x81');
  const gesamt = zeileAb(bytes, ascii('Gesamt:'));
  assert.equal(gesamt.length, 48, 'Gesamtzeile nicht 48 Spalten');
  assert.deepEqual(gesamt.slice(-6), [...ascii('5,96 '), 0xd5]);
  assert.equal(findeFolge(bytes, ascii('EUR')), -1, 'EUR statt des €-Bytes');
});

test('Bon mit Tabelle: € je Tabelle als echtes Byte oder EUR, Spalten bleiben 48', () => {
  const erwartet: Record<CodeTableId, number[]> = {
    wpc1252: [0x80],
    pc858: [0xd5],
    pc850: ascii('EUR'),
    pc437: ascii('EUR'),
    iso8859_15: [0xa4],
    replacement: ascii('EUR'),
  };
  for (const t of CODE_TABLES) {
    const bytes = escPosLayoutBytes(LAYOUT, { codeTable: t.id });
    assert.ok(findeFolge(bytes, ESC_T(t.escT)) >= 0, `${t.id}: ESC t ${t.escT} fehlt`);
    const gesamt = zeileAb(bytes, ascii('Gesamt:'));
    assert.equal(gesamt.length, 48, `${t.id}: Gesamtzeile ${gesamt.length} statt 48`);
    assert.deepEqual(gesamt.slice(-erwartet[t.id].length), erwartet[t.id], `${t.id}: €`);
  }
});

test('Bon mit Tabelle: replacement druckt nur ASCII, gleich dem vorab ersetzten Bon', () => {
  const bytes = escPosLayoutBytes(LAYOUT, { codeTable: 'replacement', cut: false });
  const hoch = Array.from(bytes).filter((b) => b >= 0x80);
  assert.deepEqual(hoch, [], 'Bytes ab 0x80 im Bon');
  // Derselbe Bon mit vorab von Hand ersetzten Texten auf dem alten Weg: bis auf
  // ESC t 0 statt ESC t 16 (je Zeile) dieselben Bytes, also dieselben Spalten.
  const vonHand: ReceiptLayout = JSON.parse(
    JSON.stringify(LAYOUT).replace(/ä/g, 'ae').replace(/ü/g, 'ue').replace(/€/g, 'EUR'),
  ) as ReceiptLayout;
  const alt = Array.from(escPosLayoutBytes(vonHand, { cut: false }));
  let umgeschaltet = 0;
  for (let i = findeFolge(Uint8Array.from(alt), ESC_T(16)); i >= 0; i = findeFolge(Uint8Array.from(alt), ESC_T(16), i + 3)) {
    alt[i + 2] = 0;
    umgeschaltet += 1;
  }
  assert.ok(umgeschaltet > 0);
  assert.deepEqual(Array.from(bytes), alt);
});

test('Bon mit Tabelle: § und ° als Byte, wo die Tabelle sie hat, sonst Ersatz; Spalten bleiben', () => {
  const faelle: Array<[CodeTableId | 'CP437', number[]]> = [
    ['wpc1252', [...ascii('Tee 80'), 0xb0, ...ascii(' '), 0xa7, ...ascii(' 3')]],
    ['pc858', [...ascii('Tee 80'), 0xf8, ...ascii(' '), 0xf5, ...ascii(' 3')]],
    ['pc437', [...ascii('Tee 80'), 0xf8, ...ascii(' Par. 3')]],
    ['CP437', [...ascii('Tee 80'), 0xf8, ...ascii(' Par. 3')]],
    ['replacement', ascii('Tee 80Grad Par. 3')],
  ];
  for (const [tabelle, name] of faelle) {
    const bytes = escPosLayoutBytes(mitSonderzeichen(), { codeTable: tabelle });
    const zeile = zeileAb(bytes, ascii('1  x Tee'));
    assert.equal(zeile.length, 48, `${tabelle}: Artikelzeile ${zeile.length} statt 48`);
    assert.ok(findeFolge(Uint8Array.from(zeile), name) >= 0, `${tabelle}: Name falsch kodiert`);
  }
});

test('escPosPrintableText: ohne Tabelle wie bisher, mit Tabelle bleibt € nur, wo die Tabelle es hat', () => {
  assert.equal(escPosPrintableText('5 € § ° ä'), '5 EUR § ° ä');
  assert.equal(escPosPrintableText('5 € § ° ä', 'CP1252'), '5 EUR § ° ä');
  assert.equal(escPosPrintableText('5 € § ° ä', null), '5 EUR § ° ä');
  assert.equal(escPosPrintableText('5 € § ° ä', 'wpc1252'), '5 € § ° ä');
  assert.equal(escPosPrintableText('5 € § ° ä', 'pc850'), '5 EUR § ° ä');
  assert.equal(escPosPrintableText('5 € § ° ä', 'pc437'), '5 EUR Par. ° ä');
  assert.equal(escPosPrintableText('5 € § ° ä', 'CP437'), '5 EUR Par. ° ä');
  assert.equal(escPosPrintableText('5 € § ° ä', 'replacement'), '5 EUR Par. Grad ae');
  assert.equal(escPosPrintableText('– „x“ … ™', 'pc858'), '- "x" ... TM');
});

/**
 * Gemeinsame Prueffaelle mit dem Dart-Zwilling: `fixtures/code-table-receipts.json`
 * nennt die Faelle, `fixtures/expected/code-table-receipt.<fall>.<tabelle>.hex`
 * haelt die Bytes (erzeugt von `npm run fixtures:zeichensatz`).
 */
interface BonFall {
  name: string;
  receipt?: string;
  input?: { company: Parameters<typeof buildReceiptLayout>[1]; receipt: Record<string, unknown> & { customerDetails: string[]; legalMessage: string[] }; options?: BuildReceiptLayoutOptions };
}
const BONS = JSON.parse(readFileSync(new URL('code-table-receipts.json', wurzel), 'utf8')) as { version: number; tables: CodeTableId[]; cases: BonFall[] };

function bonLayout(fall: BonFall): ReceiptLayout {
  const f = fall.input ?? (JSON.parse(readFileSync(new URL(`receipts/${fall.receipt}.json`, wurzel), 'utf8')) as NonNullable<BonFall['input']>);
  const receipt = fromReceiptPayload({ ...f.receipt, customerDetails: f.receipt.customerDetails.join('\n'), legalMessage: f.receipt.legalMessage.join('\n') } as never);
  return buildReceiptLayout(receipt, f.company, f.options ?? {});
}
const hexZeilen = (bytes: Uint8Array): string => {
  const teile: string[] = [];
  for (let i = 0; i < bytes.length; i += 32) teile.push(Buffer.from(bytes.subarray(i, i + 32)).toString('hex'));
  return teile.join('\n') + '\n';
};
const hexDatei = (fall: string, tabelle: string): string =>
  readFileSync(new URL(`expected/code-table-receipt.${fall}.${tabelle}.hex`, wurzel), 'utf8');

test('Bons je Tabelle (Prueffall): alle sechs Tabellen, die verlangten Faelle', () => {
  assert.deepEqual(BONS.tables, CODE_TABLES.map((t) => t.id));
  const namen = BONS.cases.map((c) => c.name);
  for (const pflicht of ['sale-cash', 'test-cashregister-sale', 'special-characters']) assert.ok(namen.includes(pflicht), pflicht);
  const papiere = new Set(BONS.cases.map((c) => bonLayout(c).paperSize));
  assert.deepEqual([...papiere].sort(), ['mm58', 'mm80']);
  const sonder = JSON.stringify(BONS.cases.find((c) => c.name === 'special-characters')!.input);
  for (const z of ['€', '§', '°', 'ä', 'ö', 'ü', 'Ö', 'ß']) assert.ok(sonder.includes(z), `special-characters ohne ${z}`);
  assert.ok(bonLayout(BONS.cases.find((c) => c.name === 'test-cashregister-sale')!).lines.some((z) => z.kind === 'banner'), 'kein TESTKASSE-Banner');
  const dateien = readdirSync(new URL('expected/', wurzel)).filter((d) => d.startsWith('code-table-receipt.')).sort();
  const soll = BONS.cases.flatMap((c) => BONS.tables.map((t) => `code-table-receipt.${c.name}.${t}.hex`)).sort();
  assert.deepEqual(dateien, soll, 'Hex-Dateien passen nicht zu den Faellen');
});

for (const fall of BONS.cases) {
  test(`Bons je Tabelle (Prueffall) ${fall.name}: Bytes je Tabelle wie in der Hex-Datei`, () => {
    const layout = bonLayout(fall);
    for (const tabelle of BONS.tables) {
      assert.equal(hexZeilen(escPosLayoutBytes(layout, { codeTable: tabelle })), hexDatei(fall.name, tabelle), `${fall.name}.${tabelle}`);
    }
  });
}

test('Bons je Tabelle (Prueffall): special-characters traegt die echten Bytes der Tabellen', () => {
  const bytes = (t: CodeTableId): Uint8Array => Uint8Array.from(Buffer.from(hexDatei('special-characters', t).replace(/\n/g, ''), 'hex'));
  const hat = (t: CodeTableId, folge: number[]): boolean => findeFolge(bytes(t), folge) >= 0;
  assert.ok(hat('wpc1252', [...ascii('80'), 0xb0, ...ascii(' hei'), 0xdf]));
  assert.ok(hat('wpc1252', [...ascii('19,90 '), 0x80]));
  assert.ok(hat('pc858', [...ascii('19,90 '), 0xd5]));
  assert.ok(hat('pc858', [...ascii('Pfand '), 0xf5]));
  assert.ok(hat('iso8859_15', [...ascii('19,90 '), 0xa4]));
  assert.ok(hat('pc850', ascii('19,90 EUR')));
  assert.ok(hat('pc437', ascii('Pfand Par. 3')));
  assert.ok(hat('replacement', ascii('Kuerbis Groesse XL')));
  assert.ok(hat('replacement', ascii('Tee 80Grad')));
});
