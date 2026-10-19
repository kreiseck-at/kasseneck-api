import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { fromReceiptPayload, receiptSubSumCents, receiptSumCents, type Receipt } from '../src/models/index.js';
import { buildReceiptLayout, renderReceiptGrid, gridToText, type ReceiptLayout } from '../src/receipt/index.js';
import { belegMitFirmaAusHuelle, type ReceiptWithCompany } from '../src/client/receipts.js';
import { gutscheineFuerPaket } from '../src/stored/gutscheine.js';
import { layoutWieServer } from '../src/stored/bon-layout.js';

/**
 * Bon der neuen Gutscheinform (Spec 2026-10-14, „Bon und Beleg“): das Paket
 * zeigt die Belege selbst, ohne die Aufbereitung des Servers
 * (`gutscheineFuerPaket`). Jeder Betrag zaehlt genau einmal: „Gesamt“ ist die
 * Summe der Zahlungen, die Steuertabelle sind die signierten Toepfe.
 *
 * Vorfall 16.10.2026: ein Verkauf ueber 30 € zeigte „Gesamt 60,00“, weil das
 * Paket die Position im 0-%-Topf und den alten Gutscheineintrag zaehlte.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const lies = (datei: string): Json => JSON.parse(readFileSync(new URL(`../../fixtures/v3/antworten/${datei}`, import.meta.url), 'utf8')) as Json;

interface Beispiel { name: string; daten: Json }
const BEISPIELE: Beispiel[] = [];
for (const datei of ['belege.json', 'kasse-belege.json', 'storno.json']) {
  for (const c of lies(datei).cases as Json[]) {
    const daten = c.response?.data;
    if (daten?.receipt == null || !Array.isArray(daten.receipt.payments)) continue;
    BEISPIELE.push({ name: `${datei.replace('.json', '')}/${c.channel ? `${c.channel}/` : ''}${c.name}`, daten });
  }
}
const istNeueForm = (r: Json): boolean =>
  (r.items ?? []).some((it: Json) => it.kind === 'voucher' || it.kind === 'voucher_float') || (r.vouchers ?? []).some((v: Json) => v.voucherType != null);
const NEUE_FORM = BEISPIELE.filter((b) => istNeueForm(b.daten.receipt));

/** Beleg mit Firma aus der Antwort (Storno-Antworten tragen keinen Kopf: dann leer). */
const ausAntwort = (daten: Json): ReceiptWithCompany => belegMitFirmaAusHuelle(JSON.parse(JSON.stringify(daten)), 'getReceipt');
const bezahlt = (daten: Json): number => (daten.receipt.payments as Json[]).reduce((s, p) => s + (p.amountCents as number), 0);
const bauen = (b: ReceiptWithCompany, receipt: Receipt = b.receipt): ReceiptLayout =>
  buildReceiptLayout(receipt, b.company, { paperSize: 'mm80', testCashregister: b.testCashregister, testSignature: b.testSignature, registrationInfo: b.registrationInfo });

const texte = (l: ReceiptLayout): string[] => l.lines.map((z) => (z.kind === 'columns' ? z.columns.map((c) => c.text).join(' | ') : 'text' in z ? String(z.text) : ''));
const euro = (cents: number): string => `${(cents / 100).toFixed(2).replace('.', ',')} €`;
const gesamt = (l: ReceiptLayout): string | null => {
  const z = l.lines.find((x) => x.kind === 'columns' && x.columns[0]!.text === 'Gesamt:');
  return z && z.kind === 'columns' ? z.columns[1]!.text : null;
};
const KATEGORIE: Record<string, string> = { A: 'amountRateStandard', B: 'amountRateReduced1', C: 'amountRateReduced2', D: 'amountRateZero', E: 'amountRateSpecial' };
/** Steuertabelle am Bon (Kategorie -> Brutto in Cent), Nullzeilen weggelassen. */
function steuerzeilen(l: ReceiptLayout): Record<string, number> {
  const raus: Record<string, number> = {};
  for (const z of l.lines) {
    if (z.kind !== 'columns' || z.columns.length !== 4) continue;
    const m = /^([A-E]) /.exec(z.columns[0]!.text);
    if (!m) continue;
    const c = Math.round(Number(z.columns[3]!.text.replace(/\./g, '').replace(',', '.')) * 100);
    if (c !== 0) raus[m[1]!] = c;
  }
  return raus;
}
function toepfe(r: Json): Record<string, number> {
  const raus: Record<string, number> = {};
  for (const [k, feld] of Object.entries(KATEGORIE)) {
    const c = Math.round((Number(r[feld]) || 0) * 100);
    if (c !== 0) raus[k] = c;
  }
  return raus;
}
/** Zeile als Spalten mit Breiten, so wie der Dart-Zwilling sie uebernimmt. */
const spalten = (l: ReceiptLayout): Array<Array<[string, number]>> =>
  l.lines.filter((z) => z.kind === 'columns').map((z) => (z.kind === 'columns' ? z.columns.map((c) => [c.text, c.width] as [string, number]) : []));
const hatSpalten = (l: ReceiptLayout, soll: Array<[string, number]>): boolean => spalten(l).some((s) => JSON.stringify(s) === JSON.stringify(soll));
const hatText = (l: ReceiptLayout, text: string): boolean => l.lines.some((z) => z.kind === 'text' && z.text === text);
const beispiel = (name: string): Json => {
  const b = NEUE_FORM.find((x) => x.name === name);
  assert.ok(b, name);
  return b.daten;
};

test('Vertragsbeispiele der neuen Form sind da (Verkauf, Einloesung, Auszahlung, Storno)', () => {
  const namen = NEUE_FORM.map((b) => b.name);
  for (const n of ['kasse-belege/sale_single_purpose_voucher', 'kasse-belege/redeem_service_voucher', 'kasse-belege/payout_multi_purpose_voucher', 'storno/app/cancel_redeemed_multi_purpose_voucher']) {
    assert.ok(namen.includes(n), `${n} fehlt: ${namen.join(', ')}`);
  }
});

test('jedes Vertragsbeispiel: receiptSumCents = Summe der Zahlungen', () => {
  for (const b of BEISPIELE) {
    const r = ausAntwort(b.daten).receipt;
    assert.equal(receiptSumCents(r), bezahlt(b.daten), b.name);
  }
});

// Vor dem Stichtag des 0-%-Topfs (NULLTOPF_AB) steht ein Mehrzweck-Verkauf nicht im Topf: der Bon zeigt
// die 0-%-Zeile, der Topf ist leer -- bewusst unveraendert (Backend beleg-layout-gutschein, VOR_STICHTAG).
const VOR_STICHTAG = ['belege/sale_multi_purpose_voucher', 'kasse-belege/sale_multi_purpose_voucher'];

test('jedes Vertragsbeispiel der neuen Form: Gesamt am Bon = bezahlt, Steuertabelle = signierte Toepfe', () => {
  for (const b of NEUE_FORM) {
    const l = bauen(ausAntwort(b.daten));
    assert.equal(gesamt(l), euro(bezahlt(b.daten)), b.name);
    if (VOR_STICHTAG.includes(b.name)) assert.deepEqual(steuerzeilen(l), { D: bezahlt(b.daten) }, b.name);
    else assert.deepEqual(steuerzeilen(l), toepfe(b.daten.receipt), b.name);
  }
});

test('aufbereitet wie der Server (gutscheineFuerPaket) und roh: dieselbe Summe, dieselbe Steuertabelle', () => {
  for (const b of NEUE_FORM) {
    const mit = ausAntwort(b.daten);
    const roh = bauen(mit);
    const auf = bauen(mit, gutscheineFuerPaket(mit.receipt));
    assert.equal(gesamt(auf), gesamt(roh), b.name);
    assert.deepEqual(steuerzeilen(auf), steuerzeilen(roh), b.name);
    assert.equal(receiptSumCents(gutscheineFuerPaket(mit.receipt)), receiptSumCents(mit.receipt), b.name);
  }
});

test('aufbereitet wie der Server: das Server-Layout des Vertrags, Zeile fuer Zeile (layoutWieServer)', () => {
  for (const b of NEUE_FORM) {
    if (b.daten.layout == null) continue;
    assert.deepEqual(layoutWieServer(ausAntwort(b.daten), b.daten.receipt.layoutRuleset), b.daten.layout, b.name);
  }
});

// ---- Einloesung Einzweck: das Beispiel der Spec -------------------------------------

/** Maniküre 35,00, Gutschein -30,50, Rest 19,50, bar 4,50 (Spec „Bon und Beleg“). */
function specBeispiel(eintrag: Json = {}): ReceiptWithCompany {
  const daten = JSON.parse(JSON.stringify(beispiel('kasse-belege/redeem_single_purpose_voucher')));
  daten.receipt.items = [
    { name: 'Maniküre', amount: 1, priceOneCents: 3500, vat: 20, priceOne: 35 },
    { name: 'Gutschein ····-9DWT', vat: 20, vatRate: 20, priceOne: -30.5, priceOneCents: -3050, unitPriceCents: -3050, amount: 1, quantity: 1, kind: 'voucher' },
  ];
  daten.receipt.vouchers = [{
    action: 'redeem', type: 'single_purpose', voucherType: 'single_purpose', amountCents: 3050, vatRateBp: 2000, balanceAfterCents: 1950,
    taxedWith: 'K1-ID-4711', name: 'Gutschein', code: '····-····-9DWT', codeSuffix: '9DWT', voucherId: 'gez9', ...eintrag,
  }];
  daten.receipt.payments = [{ id: 'p1', method: 'cash', amountCents: 450 }];
  daten.receipt.amountRateStandard = 4.5;
  return ausAntwort(daten);
}

test('Spec-Beispiel Einzweck: Gutscheinzeile, versteuert mit Beleg, Rest am Gutschein, Gesamt 4,50', () => {
  const b = specBeispiel();
  const l = bauen(b);
  assert.ok(hatSpalten(l, [['1  x Maniküre', 7], ['35,00 A', 5]]), texte(l).join('\n'));
  assert.ok(hatSpalten(l, [['Gutschein ····-9DWT', 8], ['-30,50 A', 4]]), texte(l).join('\n'));
  assert.ok(hatText(l, '  Einzweck, versteuert mit Beleg K1-ID-4711'), texte(l).join('\n'));
  assert.ok(hatSpalten(l, [['  Rest am Gutschein', 8], ['19,50  ', 4]]), texte(l).join('\n'));
  assert.equal(gesamt(l), '4,50 €');
  assert.equal(receiptSumCents(b.receipt), 450);
  assert.deepEqual(steuerzeilen(l), { A: 450 });
  // Der Gutschein steht einmal am Bon: keine zweite Zeile aus der Gutscheinliste, keine Zwischensumme.
  assert.equal(texte(l).filter((t) => t.includes('9DWT')).length, 1, texte(l).join('\n'));
  assert.ok(!texte(l).some((t) => t.startsWith('Zwischensumme')));
  // Reihenfolge: Position, darunter Vermerk und Rest.
  const i = texte(l).indexOf('Gutschein ····-9DWT | -30,50 A');
  assert.deepEqual(texte(l).slice(i, i + 3), ['Gutschein ····-9DWT | -30,50 A', '  Einzweck, versteuert mit Beleg K1-ID-4711', '  Rest am Gutschein | 19,50  ']);
});

test('Spec-Beispiel im Zeichenraster (80 mm und 58 mm)', () => {
  const l = bauen(specBeispiel());
  const z48 = gridToText(renderReceiptGrid(l, { charsPerLine: 48 })).split('\n');
  const i = z48.findIndex((z) => z.startsWith('Gutschein ····-9DWT'));
  assert.deepEqual(z48.slice(i - 1, i + 3), [
    '1  x Maniküre                            35,00 A',
    'Gutschein ····-9DWT                     -30,50 A',
    '  Einzweck, versteuert mit Beleg K1-ID-4711     ',
    '  Rest am Gutschein                      19,50  ',
  ]);
  const z32 = gridToText(renderReceiptGrid(l, { charsPerLine: 32 })).split('\n');
  const k = z32.findIndex((z) => z.startsWith('Gutschein ····-9DWT'));
  assert.deepEqual(z32.slice(k, k + 4), [
    'Gutschein ····-9DWT     -30,50 A',
    '  Einzweck, versteuert mit Beleg',
    'K1-ID-4711                      ',
    '  Rest am Gutschein      19,50  ',
  ]);
});

test('Einzweck als Kleinunternehmer befreit verkauft: Vermerk statt Belegnummer', () => {
  const l = bauen(specBeispiel({ taxedWith: undefined, exempt: true }));
  assert.ok(hatText(l, '  Einzweck, als Kleinunternehmer befreit verkauft'), texte(l).join('\n'));
  assert.ok(!texte(l).some((t) => t.includes('versteuert mit')));
});

// ---- Vertragsbeispiele: die Zeilen je Fall ---------------------------------------------

test('Einloesung Leistung: Gutscheinzeile, versteuert mit Beleg, Rest in Stueck', () => {
  const l = bauen(ausAntwort(beispiel('kasse-belege/redeem_service_voucher')));
  assert.ok(hatSpalten(l, [['Gutschein ····-5KNN', 8], ['-35,00 A', 4]]), texte(l).join('\n'));
  assert.ok(hatText(l, '  Leistung, versteuert mit Beleg KECK-0-ID-1'), texte(l).join('\n'));
  assert.ok(hatSpalten(l, [['  Rest am Gutschein', 8], ['2 Stück', 4]]), texte(l).join('\n'));
  assert.equal(gesamt(l), '6,40 €');
});

test('Einloesung Mehrzweck: nach der Zwischensumme Gutschein und Rest, Gesamt = bar', () => {
  const l = bauen(ausAntwort(beispiel('kasse-belege/redeem_multi_purpose_voucher')));
  const t = texte(l);
  const i = t.indexOf('Zwischensumme | 22,40 €');
  assert.ok(i > 0, t.join('\n'));
  assert.deepEqual(t.slice(i, i + 3), ['Zwischensumme | 22,40 €', 'Gutschein ····-5KNZ | -17,50 €', '  Rest am Gutschein | 32,50 €']);
  assert.ok(hatSpalten(l, [['Gutschein ····-5KNZ', 8], ['-17,50 €', 4]]));
  assert.ok(hatSpalten(l, [['  Rest am Gutschein', 8], ['32,50 €', 4]]));
  assert.ok(!t.some((z) => z.includes('Wertgutschein')), t.join('\n'));
  assert.equal(gesamt(l), '4,90 €');
});

test('Verkauf Mehrzweck (vor dem Stichtag, nur Eintrag): Zeile mit Code und „USt bei Einlösung“', () => {
  const l = bauen(ausAntwort(beispiel('kasse-belege/sale_multi_purpose_voucher')));
  assert.ok(hatSpalten(l, [['1  x Mehrzweckgutschein ····-····-NNNY', 7], ['50,00 D', 5]]), texte(l).join('\n'));
  assert.ok(hatText(l, '  USt bei Einlösung'), texte(l).join('\n'));
  assert.equal(texte(l).filter((t) => t.includes('50,00 D')).length, 1);
  assert.equal(gesamt(l), '50,00 €');
});

test('Verkauf Mehrzweck ab dem Stichtag (Position im 0-%-Topf + Eintrag zeroRateBucket): genau einmal 50,00', () => {
  const daten = JSON.parse(JSON.stringify(beispiel('kasse-belege/sale_multi_purpose_voucher')));
  daten.receipt.items = [{ name: 'Mehrzweckgutschein', vat: 0, vatRate: 0, priceOne: 50, priceOneCents: 5000, unitPriceCents: 5000, amount: 1, quantity: 1, kind: 'voucher_float' }];
  daten.receipt.vouchers[0].zeroRateBucket = true;
  daten.receipt.amountRateZero = 50;
  const b = ausAntwort(daten);
  const l = bauen(b);
  assert.equal(receiptSubSumCents(b.receipt), 5000);
  assert.equal(receiptSumCents(b.receipt), 5000);
  assert.equal(gesamt(l), '50,00 €');
  assert.deepEqual(steuerzeilen(l), { D: 5000 });
  assert.ok(hatSpalten(l, [['1  x Mehrzweckgutschein ····-····-NNNY', 7], ['50,00 D', 5]]), texte(l).join('\n'));
  assert.ok(hatText(l, '  USt bei Einlösung'));
  assert.equal(texte(l).filter((t) => t.includes('50,00 D')).length, 1, texte(l).join('\n'));
  assert.equal(texte(l).filter((t) => t.includes('NNNY')).length, 1, texte(l).join('\n'));
  // Wie der Server aufbereitet: dieselbe Summe, die Endung steht an der Position.
  const auf = bauen(b, gutscheineFuerPaket(b.receipt));
  assert.equal(gesamt(auf), '50,00 €');
  assert.equal(texte(auf).filter((t) => t.includes('50,00 D')).length, 1, texte(auf).join('\n'));
});

test('Verkauf Einzweck und Leistung: Positionszeile mit Code des Eintrags, keine Zusatzzeile', () => {
  const ez = bauen(ausAntwort(beispiel('kasse-belege/sale_single_purpose_voucher')));
  assert.ok(hatSpalten(ez, [['1  x Einzweckgutschein 20 % ····-····-JJJ2', 7], ['50,00 A', 5]]), texte(ez).join('\n'));
  const ls = bauen(ausAntwort(beispiel('kasse-belege/sale_service_voucher')));
  assert.ok(hatSpalten(ls, [['1  x Leistungsgutschein 2× Maniküre ····-····-RRRF', 7], ['70,00 A', 5]]), texte(ls).join('\n'));
  assert.ok(!texte(ez).some((t) => t.includes('USt bei Einlösung')));
  assert.ok(!texte(ls).some((t) => t.includes('USt bei Einlösung')));
});

test('Auszahlung Mehrzweck: Zeile mit Betrag und Grund, Gesamt negativ', () => {
  const l = bauen(ausAntwort(beispiel('kasse-belege/payout_multi_purpose_voucher')));
  assert.ok(hatSpalten(l, [['Auszahlung Gutschein ····-8CN5', 8], ['-30,00 D', 4]]), texte(l).join('\n'));
  assert.ok(hatText(l, '  Grund: Kunde zieht weg'), texte(l).join('\n'));
  assert.equal(texte(l).filter((t) => t.includes('8CN5')).length, 1, texte(l).join('\n'));
  assert.equal(gesamt(l), '-30,00 €');
});

test('Aktion bleibt die Rabattzeile wie bisher', () => {
  const b = beispiel('kasse-belege/redeem_promotion_voucher');
  assert.deepEqual(bauen(ausAntwort(b)), b.layout);
});

test('Storno einer Mehrzweck-Einloesung: Gutschein ohne Minus, kein Rest, Gesamt = Rueckzahlung', () => {
  const l = bauen(ausAntwort(beispiel('storno/app/cancel_redeemed_multi_purpose_voucher')));
  assert.ok(hatSpalten(l, [['Gutschein ····-5KNZ', 8], ['17,50 €', 4]]), texte(l).join('\n'));
  assert.ok(!texte(l).some((t) => t.includes('Rest am Gutschein')));
  assert.equal(gesamt(l), '-4,90 €');
});

test('Storno einer Einzweck-Einloesung (Spiegel ohne Rest und Vermerk): Gutscheinzeile plus, Gesamt = Rueckzahlung', () => {
  const b = specBeispiel();
  const r = b.receipt;
  const storno: Receipt = {
    ...r,
    receiptType: 'cancellation' as never,
    items: r.items.map((it) => ({ ...it, priceCents: -it.priceCents })),
    vouchers: r.vouchers.map((v) => ({ action: v.action, type: v.type, voucherType: v.voucherType, code: v.code, codeSuffix: v.codeSuffix, name: v.name, amountCents: v.amountCents, vatRateBp: v.vatRateBp, voucherId: v.voucherId })),
    payments: [{ id: 'p1', method: 'cash' as never, amountCents: -450 }],
  };
  const l = bauen(b, storno);
  assert.ok(hatSpalten(l, [['Gutschein ····-9DWT', 8], ['30,50 A', 4]]), texte(l).join('\n'));
  assert.ok(!texte(l).some((t) => t.includes('Rest am Gutschein') || t.includes('versteuert')), texte(l).join('\n'));
  assert.equal(gesamt(l), '-4,50 €');
});

test('Altbeleg ohne neue Form: Wertgutschein-Zeilen wie bisher', () => {
  const b = BEISPIELE.find((x) => x.name === 'kasse-belege/sale_v2_items_value_voucher')!;
  assert.deepEqual(bauen(ausAntwort(b.daten)), b.daten.layout);
});
