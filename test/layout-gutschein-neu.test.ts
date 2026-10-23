import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

import { fromReceiptPayload, receiptSubSumCents, receiptSumCents, type Receipt, type ReceiptCompany } from '../src/models/index.js';
import { buildReceiptLayout, renderReceiptGrid, gridAlsText, type ReceiptLayout } from '../src/receipt/index.js';
import { ReceiptLayoutView } from '../src/react/index.js';

/**
 * Bon der neuen Gutscheinform (Spec 2026-10-14, „Bon und Beleg“) auf der
 * 0.x-Linie: das Paket zeigt die Belege selbst, ohne die Aufbereitung des
 * Servers (`gutscheineFuerPaket` in functions/beleg-layout.js). Jeder Betrag
 * zaehlt genau einmal: „Gesamt“ ist die Summe der Zahlungen, die
 * Steuertabelle sind die signierten Toepfe. Zwilling von
 * layout-gutschein-neu.test.ts der 1.x-Linie (1.12.0); die Belege stehen
 * hier in der internen Form, die das Backend ablegt.
 *
 * Vorfall 16.10.2026: ein Verkauf ueber 30 € zeigte „Gesamt 60,00“, weil das
 * Paket die Position im 0-%-Topf und den alten Gutscheineintrag zaehlte.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const wurzel = new URL('../../fixtures/', import.meta.url);
const NAMEN = readdirSync(new URL('belege/', wurzel)).filter((f) => f.startsWith('gutschein-') && f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
const lade = (name: string): Json => JSON.parse(readFileSync(new URL(`belege/${name}.json`, wurzel), 'utf8')) as Json;
const lesen = (r: Json): Receipt => fromReceiptPayload({ ...r, customerDetails: r.customerDetails.join('\n'), legalMessage: r.legalMessage.join('\n') });

const FIRMA: ReceiptCompany = {
  companyName: 'Melisse Nails e.U.', street: 'Melissenweg 7', zip: '1070', city: 'Wien', phone: '+43 1 2345678',
  uid: 'ATU12345675', taxnr: '', isSmallBusiness: false, footer1: '', footer2: '', thanksMessage: [], showKreiseckLogo: false,
};
const bauen = (r: Receipt): ReceiptLayout => buildReceiptLayout(r, FIRMA, { paperSize: 'mm80' });
const texte = (l: ReceiptLayout): string[] => l.lines.map((z) => (z.kind === 'columns' ? z.columns.map((c) => c.text).join(' | ') : 'text' in z ? String(z.text) : ''));
const euro = (cents: number): string => `${(cents / 100).toFixed(2).replace('.', ',')} €`;
const gesamt = (l: ReceiptLayout): string | null => {
  const z = l.lines.find((x) => x.kind === 'columns' && x.columns[0]!.text === 'Gesamt:');
  return z && z.kind === 'columns' ? z.columns[1]!.text : null;
};
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
/** Signierte Toepfe eines Belegs nach Satz (Kategorie -> Cent), aus seinen Positionen. */
function toepfe(r: Receipt): Record<string, number> {
  const kat: Record<number, string> = { 20: 'A', 10: 'B', 13: 'C', 0: 'D', 19: 'E' };
  const raus: Record<string, number> = {};
  for (const it of r.items) {
    const satz = typeof it.vat === 'number' ? it.vat : it.vat.rate;
    const k = kat[satz]!;
    raus[k] = (raus[k] ?? 0) + Math.round(it.priceCents * it.quantity);
  }
  for (const k of Object.keys(raus)) if (raus[k] === 0) delete raus[k];
  return raus;
}
const spalten = (l: ReceiptLayout): Array<Array<[string, number]>> =>
  l.lines.filter((z) => z.kind === 'columns').map((z) => (z.kind === 'columns' ? z.columns.map((c) => [c.text, c.width] as [string, number]) : []));
const hatSpalten = (l: ReceiptLayout, soll: Array<[string, number]>): boolean => spalten(l).some((s) => JSON.stringify(s) === JSON.stringify(soll));
const hatText = (l: ReceiptLayout, text: string): boolean => l.lines.some((z) => z.kind === 'text' && z.text === text);
const bezahlt = (f: Json): number => (f.receipt.payments as Json[]).reduce((s, p) => s + (p.amountCents as number), 0);
const raster = (l: ReceiptLayout, zeichen: 32 | 48): string[] => gridAlsText(renderReceiptGrid(l, { zeichen })).split('\n');

test('jeder Gutschein-Beleg: receiptSumCents und Gesamt = Summe der Zahlungen, Steuertabelle = Positionen je Satz', () => {
  assert.equal(NAMEN.length, 8);
  for (const name of NAMEN) {
    const f = lade(name);
    const r = lesen(f.receipt);
    const l = bauen(r);
    assert.equal(receiptSumCents(r), bezahlt(f), name);
    assert.equal(gesamt(l), euro(bezahlt(f)), name);
    assert.deepEqual(steuerzeilen(l), toepfe(r), name);
  }
});

// ---- Einloesung Einzweck: das Beispiel der Spec -------------------------------------

/** Manikuere 35,00, Gutschein -30,50, Rest 19,50, bar 4,50 (Spec „Bon und Beleg“). */
function specBeispiel(eintrag: Json = {}): Receipt {
  const r = JSON.parse(JSON.stringify(lade('gutschein-einzweck-einloesung').receipt));
  Object.assign(r.vouchers[0], eintrag);
  for (const k of Object.keys(r.vouchers[0])) if (r.vouchers[0][k] === undefined) delete r.vouchers[0][k];
  return lesen(r);
}

test('Spec-Beispiel Einzweck: Gutscheinzeile, versteuert mit Beleg, Rest am Gutschein, Gesamt 4,50', () => {
  const r = specBeispiel();
  const l = bauen(r);
  assert.ok(hatSpalten(l, [['1  x Maniküre', 7], ['35,00 A', 5]]), texte(l).join('\n'));
  assert.ok(hatSpalten(l, [['Gutschein ····-9DWT', 8], ['-30,50 A', 4]]), texte(l).join('\n'));
  assert.ok(hatText(l, '  Einzweck, versteuert mit Beleg K1-ID-4711'), texte(l).join('\n'));
  assert.ok(hatSpalten(l, [['  Rest am Gutschein', 8], ['19,50 €', 4]]), texte(l).join('\n'));
  assert.equal(gesamt(l), '4,50 €');
  assert.equal(receiptSumCents(r), 450);
  assert.deepEqual(steuerzeilen(l), { A: 450 });
  // Der Gutschein steht einmal am Bon: keine zweite Zeile aus der Gutscheinliste, keine Zwischensumme.
  assert.equal(texte(l).filter((t) => t.includes('9DWT')).length, 1, texte(l).join('\n'));
  assert.ok(!texte(l).some((t) => t.startsWith('Zwischensumme')));
  const i = texte(l).indexOf('Gutschein ····-9DWT | -30,50 A');
  assert.deepEqual(texte(l).slice(i, i + 3), ['Gutschein ····-9DWT | -30,50 A', '  Einzweck, versteuert mit Beleg K1-ID-4711', '  Rest am Gutschein | 19,50 €']);
});

test('Spec-Beispiel im Zeichenraster (80 mm und 58 mm)', () => {
  const l = bauen(specBeispiel());
  const z48 = raster(l, 48);
  const i = z48.findIndex((z) => z.startsWith('Gutschein ····-9DWT'));
  assert.deepEqual(z48.slice(i - 1, i + 3), [
    '1  x Maniküre                            35,00 A',
    'Gutschein ····-9DWT                     -30,50 A',
    '  Einzweck, versteuert mit Beleg K1-ID-4711     ',
    '  Rest am Gutschein                      19,50 €',
  ]);
  const z32 = raster(l, 32);
  const k = z32.findIndex((z) => z.startsWith('Gutschein ····-9DWT'));
  assert.deepEqual(z32.slice(k, k + 4), [
    'Gutschein ····-9DWT     -30,50 A',
    '  Einzweck, versteuert mit Beleg',
    '  K1-ID-4711                    ',
    '  Rest am Gutschein      19,50 €',
  ]);
});

test('Einzweck als Kleinunternehmer befreit verkauft: Vermerk statt Belegnummer', () => {
  const l = bauen(specBeispiel({ versteuertMit: undefined, befreit: true }));
  assert.ok(hatText(l, '  Einzweck, befreit verkauft (Kleinunternehmer)'), texte(l).join('\n'));
  assert.ok(!texte(l).some((t) => t.includes('versteuert mit')));
});

// ---- die Zeilen je Fall --------------------------------------------------------------

test('Einloesung Leistung: Gutscheinzeile, versteuert mit Beleg, Rest in Stueck', () => {
  const l = bauen(lesen(lade('gutschein-leistung-einloesung').receipt));
  assert.ok(hatSpalten(l, [['Gutschein ····-RRRF', 8], ['-35,00 A', 4]]), texte(l).join('\n'));
  assert.ok(hatText(l, '  Leistung, versteuert mit Beleg K1-ID-4712'), texte(l).join('\n'));
  assert.ok(hatSpalten(l, [['  Rest am Gutschein', 8], ['9 Stück', 4]]), texte(l).join('\n'));
  assert.equal(gesamt(l), '3,20 €');
});

test('Einloesung Mehrzweck: nach der Zwischensumme Gutschein und Rest, Gesamt = bar', () => {
  const l = bauen(lesen(lade('gutschein-mehrzweck-einloesung').receipt));
  const t = texte(l);
  const i = t.indexOf('Zwischensumme | 22,40 €');
  assert.ok(i > 0, t.join('\n'));
  assert.deepEqual(t.slice(i, i + 3), ['Zwischensumme | 22,40 €', 'Gutschein ····-5KNZ | -17,50 €', '  Rest am Gutschein | 32,50 €']);
  assert.ok(hatSpalten(l, [['Gutschein ····-5KNZ', 8], ['-17,50 €', 4]]));
  assert.ok(!t.some((z) => z.includes('Wertgutschein')), t.join('\n'));
  assert.equal(gesamt(l), '4,90 €');
});

test('Verkauf Mehrzweck ab dem Stichtag (Position im 0-%-Topf + Eintrag imNullTopf): genau einmal', () => {
  const r = lesen(lade('gutschein-mehrzweck-verkauf').receipt);
  const l = bauen(r);
  assert.equal(receiptSubSumCents(r), 3000);
  assert.equal(receiptSumCents(r), 3000);
  assert.equal(gesamt(l), '30,00 €');
  assert.deepEqual(steuerzeilen(l), { D: 3000 });
  assert.ok(hatSpalten(l, [['1  x Mehrzweckgutschein ····-NNNY', 7], ['30,00 D', 5]]), texte(l).join('\n'));
  assert.ok(hatText(l, '  USt bei Einlösung'));
  assert.equal(texte(l).filter((t) => t.includes('30,00 D')).length, 1, texte(l).join('\n'));
  assert.equal(texte(l).filter((t) => t.includes('NNNY')).length, 1, texte(l).join('\n'));
});

test('Verkauf Mehrzweck vor dem Stichtag (nur Eintrag): Zeile mit Code und „USt bei Einlösung“', () => {
  const roh = JSON.parse(JSON.stringify(lade('gutschein-mehrzweck-verkauf').receipt));
  roh.items = [];
  delete roh.vouchers[0].imNullTopf;
  const l = bauen(lesen(roh));
  assert.ok(hatSpalten(l, [['1  x Mehrzweckgutschein ····-NNNY', 7], ['30,00 D', 5]]), texte(l).join('\n'));
  assert.ok(hatText(l, '  USt bei Einlösung'));
  assert.equal(texte(l).filter((t) => t.includes('30,00 D')).length, 1);
  assert.equal(gesamt(l), '30,00 €');
});

test('Verkauf Einzweck und Leistung: Positionszeile mit Code des Eintrags, keine Zusatzzeile, keine 0-%-Zeile', () => {
  const l = bauen(lesen(lade('gutschein-einzweck-leistung-verkauf').receipt));
  assert.ok(hatSpalten(l, [['1  x Einzweckgutschein 20 % ····-JJJ2', 7], ['50,00 A', 5]]), texte(l).join('\n'));
  assert.ok(hatSpalten(l, [['1  x Leistungsgutschein 10× Maniküre ····-RRRF', 7], ['350,00 A', 5]]), texte(l).join('\n'));
  assert.ok(!texte(l).some((t) => t.includes('USt bei Einlösung')));
  assert.deepEqual(l.lines.filter((z) => z.kind === 'columns' && /^D /.test(z.columns[0]!.text)), []);
  assert.equal(gesamt(l), '400,00 €');
});

test('Auszahlung Mehrzweck: Zeile mit Betrag und Grund, Gesamt negativ', () => {
  const l = bauen(lesen(lade('gutschein-auszahlung').receipt));
  assert.ok(hatSpalten(l, [['Auszahlung Gutschein ····-9DWT', 8], ['-12,00 D', 4]]), texte(l).join('\n'));
  assert.ok(hatText(l, '  Grund: Kundin zieht weg'), texte(l).join('\n'));
  assert.equal(texte(l).filter((t) => t.includes('9DWT')).length, 1, texte(l).join('\n'));
  assert.equal(gesamt(l), '-12,00 €');
});

test('Storno einer Einzweck-Einloesung: Gutscheinzeile plus, kein Rest und Vermerk, Gesamt = Rueckzahlung', () => {
  const l = bauen(lesen(lade('gutschein-storno-einzweck').receipt));
  assert.ok(hatSpalten(l, [['Gutschein ····-9DWT', 8], ['30,50 A', 4]]), texte(l).join('\n'));
  assert.ok(!texte(l).some((t) => t.includes('Rest am Gutschein') || t.includes('versteuert')), texte(l).join('\n'));
  assert.equal(gesamt(l), '-4,50 €');
});

test('Storno einer Mehrzweck-Einloesung (Spiegel mit unveraenderter action): ohne Minus, kein Rest, Gesamt = Rueckzahlung', () => {
  const roh = JSON.parse(JSON.stringify(lade('gutschein-mehrzweck-einloesung').receipt));
  roh.receiptType = 'cancellation';
  roh.items = roh.items.map((it: Json) => ({ ...it, unitPriceCents: -it.unitPriceCents }));
  roh.payments = [{ id: 'p1', method: 'cash', amountCents: -490, refundOf: 'p1' }];
  const l = bauen(lesen(roh));
  assert.ok(hatSpalten(l, [['Gutschein ····-5KNZ', 8], ['17,50 €', 4]]), texte(l).join('\n'));
  assert.ok(!texte(l).some((t) => t.includes('Rest am Gutschein')));
  assert.equal(gesamt(l), '-4,90 €');
});

test('Aktionsgutschein der neuen Form (type promo, art aktion): Rabattzeile wie der Altbeleg', () => {
  const basis = JSON.parse(JSON.stringify(lade('gutschein-mehrzweck-einloesung').receipt));
  const alt = { ...basis, vouchers: [{ action: 'redeem', type: 'promo', code: '····-····-P3AK', value: 10, valueCents: 1000 }], payments: [{ id: 'p1', method: 'cash', amountCents: 1240 }] };
  const neu = { ...alt, vouchers: [{ ...alt.vouchers[0], art: 'aktion', codeEnde: 'P3AK', gutscheinId: 'g-ak-1' }] };
  assert.deepEqual(bauen(lesen(neu)), bauen(lesen(alt)));
  assert.equal(gesamt(bauen(lesen(neu))), '12,40 €');
});

// ---- Umbruch und Zuordnung -----------------------------------------------------------

test('Vermerke brechen mit demselben Einzug um, auf 32 und 48 Zeichen', () => {
  const befreit = bauen(specBeispiel({ versteuertMit: undefined, befreit: true }));
  // 47 Zeichen: auf 80 mm eine Zeile.
  assert.ok(raster(befreit, 48).includes('  Einzweck, befreit verkauft (Kleinunternehmer) '));
  const z32 = raster(befreit, 32);
  const i = z32.findIndex((z) => z.startsWith('  Einzweck, befreit'));
  assert.deepEqual(z32.slice(i, i + 2), ['  Einzweck, befreit verkauft    ', '  (Kleinunternehmer)            ']);
  // Ein langer Grund: jede Folgezeile mit zwei Zeichen Einzug.
  const roh = JSON.parse(JSON.stringify(lade('gutschein-auszahlung').receipt));
  roh.vouchers[0].grund = 'Kundin zieht in ein anderes Bundesland und kommt nicht mehr vorbei';
  const l = bauen(lesen(roh));
  for (const zeichen of [32, 48] as const) {
    const z = raster(l, zeichen);
    const k = z.findIndex((x) => x.startsWith('  Grund:'));
    const folgen = z.slice(k + 1, k + 4).filter((x) => x.trim() !== '' && !x.startsWith('MwSt'));
    assert.ok(folgen.length >= 1, z.join('\n'));
    for (const f of folgen) assert.ok(f.startsWith('  ') && f[2] !== ' ', `${zeichen}: ${f}`);
  }
});

test('Bildschirm (React): fuehrende Leerzeichen werden zum Einzug, andere Texte bleiben gleich', () => {
  const l = bauen(specBeispiel());
  const html = renderToStaticMarkup(createElement(ReceiptLayoutView, { layout: l }));
  assert.match(html, /padding-left:2ch[^>]*>Einzweck, versteuert mit Beleg K1-ID-4711</);
  assert.ok(!html.includes('>  Einzweck'));
});

test('Zwei Gutscheine mit derselben Endung: jede Position genau einem Eintrag, der Reihe nach', () => {
  const roh = JSON.parse(JSON.stringify(lade('gutschein-einzweck-einloesung').receipt));
  roh.items = [
    { ...roh.items[0], unitPriceCents: 5000 },
    { ...roh.items[1], unitPriceCents: -1000 },
    { ...roh.items[1], unitPriceCents: -500 },
  ];
  roh.vouchers = [
    { ...roh.vouchers[0], betragCents: 1000, saldoNachCents: 4000, versteuertMit: 'K1-ID-1', gutscheinId: 'a' },
    { ...roh.vouchers[0], betragCents: 500, saldoNachCents: 0, versteuertMit: 'K1-ID-2', gutscheinId: 'b' },
  ];
  roh.payments = [{ id: 'p1', method: 'cash', amountCents: 3500 }];
  const r = lesen(roh);
  const t = texte(bauen(r));
  const i = t.indexOf('Gutschein ····-9DWT | -10,00 A');
  assert.deepEqual(t.slice(i, i + 6), [
    'Gutschein ····-9DWT | -10,00 A', '  Einzweck, versteuert mit Beleg K1-ID-1', '  Rest am Gutschein | 40,00 €',
    'Gutschein ····-9DWT | -5,00 A', '  Einzweck, versteuert mit Beleg K1-ID-2', '  Rest am Gutschein | 0,00 €',
  ], t.join('\n'));
  assert.equal(receiptSumCents(r), 3500);
});

test('Auszahlungsposition nur zum Auszahlungseintrag, Einloesungsposition nur zur Einloesung (gleiche Endung)', () => {
  const roh = JSON.parse(JSON.stringify(lade('gutschein-einzweck-einloesung').receipt));
  roh.items = [...roh.items, { ...roh.items[1], name: 'Auszahlung Gutschein ····-9DWT', unitPriceCents: -500 }];
  roh.vouchers = [
    { action: 'payout', type: 'einzweck', art: 'einzweck', betragCents: 500, satzBp: 2000, grund: 'Rest bar', code: '····-····-9DWT', codeEnde: '9DWT', gutscheinId: 'p' },
    ...roh.vouchers,
  ];
  const t = texte(bauen(lesen(roh)));
  const i = t.indexOf('Gutschein ····-9DWT | -30,50 A');
  assert.deepEqual(t.slice(i, i + 3), ['Gutschein ····-9DWT | -30,50 A', '  Einzweck, versteuert mit Beleg K1-ID-4711', '  Rest am Gutschein | 19,50 €'], t.join('\n'));
  const k = t.indexOf('Auszahlung Gutschein ····-9DWT | -5,00 A');
  assert.deepEqual(t.slice(k, k + 2), ['Auszahlung Gutschein ····-9DWT | -5,00 A', '  Grund: Rest bar'], t.join('\n'));
});

test('Platzhalter no-code des Servers steht nie an der Verkaufszeile', () => {
  const roh = JSON.parse(JSON.stringify(lade('gutschein-mehrzweck-verkauf').receipt));
  // Alt-Verkauf ohne Code ab dem Stichtag: der Server setzt code 'no-code' und imNullTopf.
  roh.vouchers = [{ action: 'sell', type: 'value', value: 30, valueCents: 3000, name: 'Wertgutschein', code: 'no-code', imNullTopf: true }];
  const l = bauen(lesen(roh));
  assert.ok(hatSpalten(l, [['1  x Mehrzweckgutschein', 7], ['30,00 D', 5]]), texte(l).join('\n'));
  assert.ok(!texte(l).some((z) => z.includes('no-code')), texte(l).join('\n'));
  assert.equal(gesamt(l), '30,00 €');
});

test('Wie der Server heute aufbereitet (Eintraege mit Position weg, Code an der Position): dieselbe Summe und Steuertabelle', () => {
  for (const name of NAMEN) {
    const f = lade(name);
    const roh = f.receipt;
    // Nachbau von functions/beleg-layout.js gutscheineFuerPaket (intern: type einzweck|leistung, imNullTopf).
    const positionen = roh.items.map((it: Json) => ({ ...it }));
    const vergeben = new Set<number>();
    const cents = (it: Json): number => Math.abs(it.unitPriceCents * it.quantity);
    const bleiben: Json[] = [];
    for (const g of roh.vouchers) {
      const anPosition = (kinds: string[]): void => {
        const ziel = Number.isInteger(g.betragCents) ? Math.abs(g.betragCents) : Math.abs(g.valueCents ?? 0);
        const i = positionen.findIndex((it: Json, k: number) => !vergeben.has(k) && kinds.includes(it.kind) && cents(it) === ziel && !String(it.name).includes('····'));
        if (i < 0) return;
        vergeben.add(i);
        if (g.code) positionen[i].name = `${positionen[i].name} ${g.code}`;
      };
      if (['einzweck', 'leistung'].includes(g.type)) { if (g.action === 'sell') anPosition(['voucher']); continue; }
      if (g.imNullTopf === true) { anPosition(['voucher_float']); continue; }
      bleiben.push(g);
    }
    const auf = lesen({ ...roh, items: positionen, vouchers: bleiben });
    const r = lesen(roh);
    assert.equal(receiptSumCents(auf), receiptSumCents(r), name);
    assert.equal(gesamt(bauen(auf)), gesamt(bauen(r)), name);
    assert.deepEqual(steuerzeilen(bauen(auf)), steuerzeilen(bauen(r)), name);
  }
});

// ---- Bon-Feinschliff: eine kurze Maske, Zahlungsart nur bei Zahlung, Rest mit Euro ------------

/** Spec-Beispiel (Maniküre 30,50, Gutschein -30,50), vollstaendig vom Gutschein gedeckt. */
function gedeckt(payments: Json): Json {
  const r = JSON.parse(JSON.stringify(lade('gutschein-einzweck-einloesung').receipt));
  r.items[0].unitPriceCents = 3050;
  r.payments = payments;
  return r;
}
const zahlungsart = (l: ReceiptLayout): string[] => texte(l).filter((t) => t.startsWith('Zahlungsart') || /^\d\. /.test(t));

test('R3: voll gedeckter Beleg (0 Cent bezahlt) traegt keine Zahlungsart-Zeile, Gesamt bleibt', () => {
  for (const zahlungen of [undefined, [], [{ id: 'p1', method: 'cash', amountCents: 0 }]]) {
    const l = bauen(lesen(gedeckt(zahlungen)));
    assert.equal(gesamt(l), '0,00 €');
    assert.deepEqual(zahlungsart(l), [], texte(l).join('\n'));
  }
});

test('R3: Gutschein plus Barzahlung 4,50 -- die Zahlungsart-Zeile bleibt', () => {
  const l = bauen(specBeispiel());
  assert.deepEqual(zahlungsart(l), ['Zahlungsart: | Barzahlung'], texte(l).join('\n'));
});

test('R3: mehrere Zahlungen mit Gutschein, eine mit 0 Cent -- diese fehlt, die Nummer bleibt', () => {
  const r = JSON.parse(JSON.stringify(lade('gutschein-einzweck-einloesung').receipt));
  r.payments = [{ id: 'p1', method: 'cash', amountCents: 0 }, { id: 'p2', method: 'cash', amountCents: 250 }, { id: 'p3', method: 'cash', amountCents: 200 }];
  const t = texte(bauen(lesen(r)));
  assert.ok(!t.some((z) => z.startsWith('1. ')), t.join('\n'));
  assert.ok(t.some((z) => z.startsWith('2. ') && z.endsWith('2,50 €')), t.join('\n'));
  assert.ok(t.some((z) => z.startsWith('3. ') && z.endsWith('2,00 €')), t.join('\n'));
});

test('R3: Nullbeleg ohne Gutschein behaelt die Zahlungsart-Zeile', () => {
  const r = JSON.parse(JSON.stringify(lade('gutschein-einzweck-einloesung').receipt));
  r.items = [{ name: 'Probe', quantity: 1, unitPriceCents: 0, vatRate: 20 }];
  r.vouchers = [];
  r.payments = [{ id: 'p1', method: 'cash', amountCents: 0 }];
  assert.equal(zahlungsart(bauen(lesen(r))).length, 1);
});

test('R3: Aktionsgutschein deckt alles (Summe 0) -- die Zahlungsart-Zeile bleibt, Aktion ist keine Zahlung', () => {
  const r = JSON.parse(JSON.stringify(lade('gutschein-einzweck-einloesung').receipt));
  r.items = [{ name: 'Probe', quantity: 1, unitPriceCents: 1000, vatRate: 20 }];
  r.vouchers = [{ action: 'redeem', type: 'promo', name: 'Aktion', code: '····-····-5KNJ', valueCents: 1000 }];
  r.payments = [{ id: 'p1', method: 'cash', amountCents: 0 }];
  assert.equal(zahlungsart(bauen(lesen(r))).length, 1, texte(bauen(lesen(r))).join('\n'));
});

test('R3: mehrere Zahlungen ohne Gutschein behalten die 0-Cent-Zahlung', () => {
  const r = JSON.parse(JSON.stringify(lade('gutschein-einzweck-einloesung').receipt));
  r.vouchers = [];
  r.items = [{ name: 'Probe', quantity: 1, unitPriceCents: 500, vatRate: 20 }];
  r.payments = [{ id: 'p1', method: 'cash', amountCents: 0 }, { id: 'p2', method: 'cash', amountCents: 500 }];
  assert.ok(texte(bauen(lesen(r))).some((z) => z.startsWith('1. ')));
});

test('R3 (Review 4): Storno eines voll gedeckten Belegs zeigt keine „Barzahlung 0,00“', () => {
  const r = gedeckt([{ id: 'p1', method: 'cash', amountCents: 0 }]);
  r.receiptType = 'cancellation';
  r.cancellationOf = { receiptId: 'AT0-KASSE1-42', fullReceiptId: null };
  r.cancellationReason = 'kunde_storniert';
  r.items = r.items.map((it: Json) => ({ ...it, unitPriceCents: -it.unitPriceCents }));
  const l = bauen(lesen(r));
  assert.deepEqual(zahlungsart(l), [], texte(l).join('\n'));
});

test('R5: Einzweck-Rest steht mit Euro', () => {
  const l = bauen(specBeispiel());
  assert.ok(hatSpalten(l, [['  Rest am Gutschein', 8], ['19,50 €', 4]]), texte(l).join('\n'));
  assert.ok(!texte(l).some((t) => /Rest am Gutschein \| \d+,\d\d {2}$/.test(t)));
});

test('R2: Aktion „Aktionsgutschein ····-5KNJ - Aktion“ (kurze Maske, neues Wort); alter Name „Promotionsgutschein“ steht wie gespeichert', () => {
  const r = JSON.parse(JSON.stringify(lade('gutschein-mehrzweck-einloesung').receipt));
  r.vouchers = [{ action: 'redeem', type: 'promo', name: 'Aktion', code: '····-····-5KNJ', valueCents: 100 }];
  assert.ok(texte(bauen(lesen(r))).some((t) => t.startsWith('Aktionsgutschein ····-5KNJ - Aktion')), texte(bauen(lesen(r))).join('\n'));
  r.vouchers[0].name = 'Promotionsgutschein Herbst';
  const t = texte(bauen(lesen(r)));
  assert.ok(t.some((z) => z.startsWith('Promotionsgutschein Herbst')), t.join('\n'));
  assert.ok(!t.some((z) => z.startsWith('Aktionsgutschein')), t.join('\n'));
});

test('R2: alter Beleg mit langer Maske und „×“-Name druckt mit kurzer Maske (Review 5)', () => {
  const t = texte(bauen(lesen(lade('gutschein-einzweck-leistung-verkauf').receipt)));
  assert.ok(t.some((z) => z.includes('Leistungsgutschein 10× Maniküre ····-RRRF')), t.join('\n'));
  assert.ok(!t.some((z) => z.includes('····-····')), t.join('\n'));
});

test('R2: Verkauf ohne codeEnde: die Endung kommt aus dem Code-Ende; Code ohne Maske bleibt', () => {
  const roh = JSON.parse(JSON.stringify(lade('gutschein-mehrzweck-verkauf').receipt));
  delete roh.vouchers[0].codeEnde;
  assert.ok(texte(bauen(lesen(roh))).some((z) => z.startsWith('1  x Mehrzweckgutschein ····-NNNY')), texte(bauen(lesen(roh))).join('\n'));
  roh.vouchers[0].code = 'GS-1';
  assert.ok(texte(bauen(lesen(roh))).some((z) => z.startsWith('1  x Mehrzweckgutschein GS-1')), texte(bauen(lesen(roh))).join('\n'));
});
