import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { KeckPaymentMethod, ReceiptType, VatRate } from '../src/enums/index.js';
import type { Receipt, ReceiptCompany } from '../src/models/index.js';
import { buildReceiptLayout, type ReceiptLayout } from '../src/receipt/layout.js';
import { renderReceiptGrid, gridSpaltenBreiten, ZEICHEN_JE_PAPIER, gridAlsText } from '../src/receipt/grid.js';
import { escPosLayoutBytes } from '../src/receipt/layout-escpos.js';

/**
 * Zeichenraster: der Beleg als Zeilen mit exakt N Zeichen -- die einzige
 * Wahrheit fuer Bildschirm, Bondruck, PDF. Spalten in ganzen Zeichen, rechte
 * Spalte buendig am Rand, mindestens ein Leerzeichen zwischen Spalten,
 * wortweiser Umbruch, Trennlinie ueber die volle Breite.
 */
const FIRMA: ReceiptCompany = {
  companyName: 'Café Kreiseck', street: 'Hauptstraße 5', zip: '1010', city: 'Wien', phone: '+43 1 1234567',
  uid: 'ATU12345678', taxnr: '', isSmallBusiness: false,
  footer1: 'Vielen Dank für Ihren Einkauf', footer2: 'www.kreiseck.com', thanksMessage: ['Bis bald!'], showKreiseckLogo: false,
};
const QR = '_R1-AT1_KASSE1_AT0-KASSE1-42_2026-08-13T00:30:00_5,00_2,70_0,00_0,00_0,00_UMSATZ_VORGAENGER_6F0404F0_SIGNATUR';
const BELEG: Receipt = {
  receiptId: 'AT0-KASSE1-42', cashregisterId: 'KASSE1', timeStamp: '2026-08-13T00:30:00',
  items: [{ name: 'Semmel', quantity: 4, vat: VatRate.vat10, priceCents: 79 }, { name: 'Espresso', quantity: 2, vat: VatRate.vat20, priceCents: 250 }],
  vouchers: [], paymentMethod: KeckPaymentMethod.cash, turnoverCounterAES256ICM: 'UMSATZ', signaturePreviousReceipt: 'VORGAENGER',
  certificateSerialNumber: '6F0404F0', receiptType: ReceiptType.standard, sig: 'eyJhbGciOiJFUzI1NiJ9.QVQx.SIGNATURWERT', qr: QR,
  fullReceiptId: 'VOLL', customerDetails: [], legalMessage: [],
};

test('Zeichenbreite je Papier: 58 mm = 32, 80 mm = 48; jede Rasterzeile hat exakt N Zeichen', () => {
  assert.equal(ZEICHEN_JE_PAPIER.mm58, 32);
  assert.equal(ZEICHEN_JE_PAPIER.mm80, 48);
  for (const paperSize of ['mm58', 'mm80'] as const) {
    const g = renderReceiptGrid(buildReceiptLayout(BELEG, FIRMA, { paperSize }));
    assert.equal(g.zeichen, ZEICHEN_JE_PAPIER[paperSize]);
    assert.ok(g.lines.length > 20);
    for (const z of g.lines) assert.equal(z.text.length, g.zeichen, `${paperSize}: "${z.text}"`);
  }
  // Breite ausdruecklich vorgeben (Font B, 42 Zeichen)
  const g42 = renderReceiptGrid(buildReceiptLayout(BELEG, FIRMA), { zeichen: 42 });
  for (const z of g42.lines) assert.equal(z.text.length, 42);
});

test('Spalten: ganze Zeichen aus Zwoelfteln, Rest an die letzte Spalte, mindestens 1 Zeichen', () => {
  assert.deepEqual(gridSpaltenBreiten([6, 6], 32), [16, 16]);
  assert.deepEqual(gridSpaltenBreiten([7, 5], 32), [18, 14]);
  assert.deepEqual(gridSpaltenBreiten([4, 8], 32), [10, 22]);
  assert.deepEqual(gridSpaltenBreiten([2, 3, 3, 4], 48), [8, 12, 12, 16]);
  assert.deepEqual(gridSpaltenBreiten([1, 11], 8), [1, 7]);
});

test('rechte Spalte buendig am rechten Rand -- der Preis endet exakt ueber dem Ende der Trennlinie', () => {
  const g = renderReceiptGrid(buildReceiptLayout(BELEG, FIRMA, { paperSize: 'mm58' }));
  const gesamt = g.lines.find((z) => z.text.startsWith('Gesamt:'))!;
  assert.ok(gesamt.text.endsWith('5,00 €') || gesamt.text.endsWith('8,16 €'), gesamt.text);
  assert.equal(gesamt.text.length, 32);
  const linie = g.lines.find((z) => z.kind === 'rule')!;
  assert.equal(linie.text, '-'.repeat(32));
  const position = g.lines.find((z) => z.text.startsWith('4  x Semmel'))!;
  assert.ok(position.text.endsWith('3,16 B'), position.text);
});

test('mindestens ein Leerzeichen zwischen Spalten, auch wenn die linke Spalte voll ist', () => {
  const layout: ReceiptLayout = { paperSize: 'mm58', regelwerk: 2, lines: [
    { kind: 'columns', columns: [{ text: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', width: 7, align: 'left' }, { text: '1,00 A', width: 5, align: 'right' }] },
  ] };
  const g = renderReceiptGrid(layout);
  // linke Spalte 18 Zeichen: 17 Inhalt + 1 Abstand -> Umbruch nach 17
  assert.equal(g.lines[0]!.text, 'ABCDEFGHIJKLMNOPQ' + ' ' + '        1,00 A');
  assert.equal(g.lines[1]!.text.trimEnd(), 'RSTUVWXYZ');
  for (const z of g.lines) assert.equal(z.text.length, 32);
});

test('wortweiser Umbruch in Text, Aufdruck und Spalten; ueberlanges Wort hart', () => {
  const layout: ReceiptLayout = { paperSize: 'mm58', regelwerk: 2, lines: [
    { kind: 'banner', text: 'TESTSIGNATUR — kein gültiger Beleg', ton: 'warnung' },
    { kind: 'text', text: 'Umsatzsteuerbefreit – Kleinunternehmer gemäß § 6 Abs. 1 Z 27 UStG.', align: 'center', bold: false },
    { kind: 'columns', columns: [{ text: '4  x Semmel je 0,79', width: 7, align: 'left' }, { text: '3,16 B', width: 5, align: 'right' }] },
    { kind: 'text', text: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEF', align: 'left', bold: false },
  ] };
  const t = renderReceiptGrid(layout).lines.map((z) => z.text.trim());
  assert.deepEqual(t.slice(0, 2), ['TESTSIGNATUR — kein gültiger', 'Beleg']);
  assert.deepEqual(t.slice(2, 5), ['Umsatzsteuerbefreit –', 'Kleinunternehmer gemäß § 6 Abs.', '1 Z 27 UStG.']);
  assert.ok(t[5]!.startsWith('4  x Semmel je') && t[5]!.endsWith('3,16 B'), t[5]);
  assert.equal(t[6], '0,79');
  assert.deepEqual(t.slice(7), ['ABCDEFGHIJKLMNOPQRSTUVWXYZ012345', '6789ABCDEF']);
});

test('58 mm: Folgezeilen einer Spalte laufen ueber die volle Breite, wenn die anderen Spalten leer sind; geschuetztes Leerzeichen haelt "je 0,79" zusammen; ueberlange Woerter brechen am Bindestrich', () => {
  const layout: ReceiptLayout = { paperSize: 'mm58', regelwerk: 2, lines: [
    // Artikelname laenger als die Spalte: Rest ueber die volle Breite statt in der schmalen Spalte
    { kind: 'columns', columns: [{ text: '2  x Hausgemachte Bio-Dinkelvollkornsemmel mit Kürbiskernen je\u00a01,49', width: 7, align: 'left' }, { text: '2,98 B', width: 5, align: 'right' }] },
    // beide Spalten lang: bleibt im Raster (kein Fliessen, sonst verschoebe sich die rechte)
    { kind: 'columns', columns: [{ text: 'Linke Spalte mit viel Text drin', width: 6, align: 'left' }, { text: 'Rechte Spalte auch lang', width: 6, align: 'right' }] },
    // ueberlanges Wort mit Bindestrich: nach dem Bindestrich brechen, nicht mitten im Wort
    { kind: 'text', text: 'Bio-Dinkelvollkornsemmelbrotaufstrich', align: 'left', bold: false },
    // "je 0,79" bleibt zusammen (geschuetztes Leerzeichen), gedruckt als normales Leerzeichen
    { kind: 'columns', columns: [{ text: '4  x Semmel je\u00a00,79', width: 7, align: 'left' }, { text: '3,16 B', width: 5, align: 'right' }] },
  ] };
  const g = renderReceiptGrid(layout);
  const t = g.lines.map((z) => z.text);
  assert.ok(g.lines.every((z) => z.text.length === 32));
  assert.ok(!t.some((z) => z.includes('\u00a0')), 'kein NBSP im Raster');
  assert.equal(t[0], '2  x Hausgemachte         2,98 B');
  assert.deepEqual(t.slice(1, 3).map((z) => z.trimEnd()), ['Bio-Dinkelvollkornsemmel mit', 'Kürbiskernen je 1,49']);
  // zwei lange Spalten: Rasterbreiten bleiben (linke 15+1, rechte 16)
  assert.equal(t[3], 'Linke Spalte       Rechte Spalte');
  assert.ok(t[4]!.startsWith('mit viel Text') && t[4]!.endsWith('auch lang'), t[4]);
  assert.equal(t[5]!.trimEnd(), 'drin');
  assert.deepEqual(t.slice(6, 8).map((z) => z.trimEnd()), ['Bio-', 'Dinkelvollkornsemmelbrotaufstrich'.slice(0, 32)]);
  assert.equal(t[8]!.trimEnd(), 'Dinkelvollkornsemmelbrotaufstrich'.slice(32));
  assert.equal(t[9], '4  x Semmel               3,16 B');
  assert.equal(t[10]!.trimEnd(), 'je 0,79');
});

test('Stile und Sonderzeilen: Banner fett + Ton, QR traegt die Nutzlast, Leerraum als Leerzeilen', () => {
  const layout: ReceiptLayout = { paperSize: 'mm58', regelwerk: 2, lines: [
    { kind: 'banner', text: 'STORNOBELEG', ton: 'belegart' },
    { kind: 'text', text: 'Fett', align: 'center', bold: true },
    { kind: 'space', lines: 2 },
    { kind: 'qr', data: QR },
  ] };
  const g = renderReceiptGrid(layout);
  assert.equal(g.lines[0]!.kind, 'banner'); assert.equal(g.lines[0]!.bold, true); assert.equal(g.lines[0]!.ton, 'belegart');
  assert.equal(g.lines[0]!.text, ' '.repeat(10) + 'STORNOBELEG' + ' '.repeat(11));
  assert.equal(g.lines[1]!.bold, true);
  assert.equal(g.lines[2]!.kind, 'space'); assert.equal(g.lines[3]!.kind, 'space');
  assert.equal(g.lines[4]!.kind, 'qr'); assert.equal(g.lines[4]!.qr, QR);
  // Klartext-Form (Golden-Dateien): eine Zeile je Rasterzeile, QR als Platzhalter
  assert.equal(gridAlsText(g).split('\n').length, 5);
});

test('ESC/POS druckt genau die Rasterzeilen (keine eigene Spaltenrechnung mehr): Bytestrom enthaelt jede Zeile', () => {
  const layout = buildReceiptLayout(BELEG, { ...FIRMA, isSmallBusiness: true }, { paperSize: 'mm58' });
  const bytes = escPosLayoutBytes(layout);
  const g = renderReceiptGrid(layout);
  const text = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
  // Waehrung wird druckbar gemacht (EUR statt €) -- die Zeile bleibt 32 Zeichen breit, der Preis buendig rechts
  const gesamt = /Gesamt: +8,16 EUR/.exec(text);
  assert.ok(gesamt, 'Gesamt-Zeile fehlt');
  assert.equal(gesamt![0].length, 32);
  // Keine Spaltenpositionierung mehr: jedes ESC $ steht auf Position 0 (Zeilenanfang)
  for (const m of text.matchAll(/\x1b\$([\s\S]{2})/g)) assert.equal(m[1], '\x00\x00', 'ESC $ mit Position != 0');
  for (const z of g.lines) {
    if (z.kind === 'qr' || z.kind === 'space') continue;
    // Woerter der Zeile in Reihenfolge, Leerraum darf (durch EUR statt €) variieren
    const woerter = z.text.replace(/€/g, 'EUR').replace(/–|—/g, '-').trim().split(/ +/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (woerter.length === 0 || woerter[0] === '') continue;
    assert.ok(new RegExp(woerter.join(' +')).test(text), 'Zeile fehlt im Bytestrom: "' + z.text.trim() + '"');
  }
});

test('Golden: grid32/grid48 der Fixtures stimmen zeichengenau', () => {
  const wurzel = new URL('../../fixtures/', import.meta.url);
  const namen = readdirSync(new URL('belege/', wurzel)).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
  assert.ok(namen.length >= 17);
  for (const name of namen) {
    for (const zeichen of [32, 48] as const) {
      const soll = readFileSync(new URL(`erwartet/${name}.grid${zeichen}.txt`, wurzel), 'utf8');
      const layout = JSON.parse(readFileSync(new URL(`erwartet/${name}.lines.json`, wurzel), 'utf8')) as ReceiptLayout;
      assert.equal(gridAlsText(renderReceiptGrid(layout, { zeichen })), soll, `${name} @${zeichen}`);
    }
  }
});
