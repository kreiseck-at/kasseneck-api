import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  fromReceiptPayload,
  toReceiptPayload,
  fromVoucherPayload,
  toVoucherPayload,
  isVoucherItem,
  isVoucherFloatItem,
  voucherIsValid,
  type Voucher,
  type VoucherPayload,
} from '../src/models/index.js';
import { VoucherAction, VoucherType, ReceiptType } from '../src/enums/index.js';
import { checkVoucherCombinationError, createReceiptParams } from '../src/client/receipts.js';

/*
 * Neue Gutscheinform (Mehrzweck, Einzweck, Leistung, Aktion) auf der 0.x-Linie:
 * diese Linie spricht die interne Form (`/api`, wie Firestore) mit deutschen
 * Schluesseln und Arten. Beleg lesen (intern und `/v3`), wieder schreiben
 * (intern) und Wuensche pruefen, bevor etwas hinausgeht. Zwilling von
 * voucher-neue-form.test.ts der 1.x-Linie (1.12.0).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const wurzel = new URL('../../fixtures/', import.meta.url);
const GUTSCHEIN_BELEGE = readdirSync(new URL('belege/', wurzel)).filter((f) => f.startsWith('gutschein-') && f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
const lade = (name: string): Json => JSON.parse(readFileSync(new URL(`belege/${name}.json`, wurzel), 'utf8')) as Json;
const nutzlast = (f: Json): Json => ({ ...f.receipt, customerDetails: f.receipt.customerDetails.join('\n'), legalMessage: f.receipt.legalMessage.join('\n') });

const posi = [{ name: 'a', quantity: 1, priceCents: 100, vat: 20 } as Json];
const ZAHLUNG = [{ method: 'cash', amountCents: 5000 }] as Json;
const v = (o: Json): Voucher => o as Voucher;

test('Golden-Belege der neuen Form liegen vor (Verkauf, Einloesung, Auszahlung, Storno)', () => {
  assert.equal(GUTSCHEIN_BELEGE.length, 8, GUTSCHEIN_BELEGE.join(', '));
});

test('jeder Gutschein-Beleg ueberlebt Lesen, Schreiben, Lesen (intern)', () => {
  for (const name of GUTSCHEIN_BELEGE) {
    const r = fromReceiptPayload(nutzlast(lade(name)));
    assert.doesNotThrow(() => toReceiptPayload(r), name);
    const zurueck = fromReceiptPayload(toReceiptPayload(r) as Json);
    assert.deepEqual(zurueck.items, r.items, name);
    assert.deepEqual(zurueck.vouchers, r.vouchers, name);
  }
});

test('geschrieben wird die interne Form, wie der Server sie ablegt', () => {
  const f = lade('gutschein-einzweck-leistung-verkauf');
  const r = fromReceiptPayload(nutzlast(f));
  assert.deepEqual(toReceiptPayload(r).vouchers, f.receipt.vouchers);
  const mz = lade('gutschein-mehrzweck-verkauf');
  assert.deepEqual(toReceiptPayload(fromReceiptPayload(nutzlast(mz))).vouchers, mz.receipt.vouchers.map((g: Json) => ({ ...g, value: g.valueCents / 100 })));
});

test('gelesene Felder der neuen Form (intern) kommen als Modellfelder an', () => {
  const r = fromReceiptPayload(nutzlast(lade('gutschein-leistung-einloesung')));
  const g = r.vouchers[0]!;
  assert.equal(g.type, VoucherType.service);
  assert.equal(g.voucherType, VoucherType.service);
  assert.equal(g.codeSuffix, 'RRRF');
  assert.equal(g.voucherId, 'gls1');
  assert.deepEqual(g.positions, [0]);
  assert.equal(g.remainingQuantityAfter, 9);
  assert.equal(g.vatRateBp, 2000);
  assert.equal(g.amountCents, 3500);
  assert.equal(g.taxedWith, 'K1-ID-4712');
  const verkauf = fromReceiptPayload(nutzlast(lade('gutschein-einzweck-leistung-verkauf'))).vouchers[1]!;
  assert.deepEqual(verkauf.article, { id: 'manicure', name: 'Maniküre', vatRateBp: 2000, priceCents: 3500 });
  assert.equal(verkauf.quantity, 10);
  const mz = fromReceiptPayload(nutzlast(lade('gutschein-mehrzweck-verkauf'))).vouchers[0]!;
  assert.equal(mz.type, VoucherType.value);
  assert.equal(mz.voucherType, VoucherType.multi_purpose);
  assert.equal(mz.zeroRateBucket, true);
  const aus = fromReceiptPayload(nutzlast(lade('gutschein-auszahlung'))).vouchers[0]!;
  assert.equal(aus.action, VoucherAction.payout);
  assert.equal(aus.reason, 'Kundin zieht weg');
  assert.equal(aus.balanceAfterCents, 0);
  const befreit = fromReceiptPayload(nutzlast(lade('gutschein-einzweck-einloesung-befreit'))).vouchers[0]!;
  assert.equal(befreit.exempt, true);
});

test('die /v3-Form (englisch) liest sich zum selben Gutschein', () => {
  const intern: VoucherPayload = {
    action: 'redeem', type: 'einzweck', art: 'einzweck', betragCents: 3050, satzBp: 2000, saldoNachCents: 1950,
    versteuertMit: 'K1-ID-4711', code: '····-····-9DWT', codeEnde: '9DWT', gutscheinId: 'gez1',
  };
  const v3: VoucherPayload = {
    action: 'redeem', type: 'single_purpose', voucherType: 'single_purpose', amountCents: 3050, vatRateBp: 2000, balanceAfterCents: 1950,
    taxedWith: 'K1-ID-4711', code: '····-····-9DWT', codeSuffix: '9DWT', voucherId: 'gez1',
  };
  assert.deepEqual(fromVoucherPayload(v3), fromVoucherPayload(intern));
});

test('Altform bleibt byte-gleich (lesen und schreiben)', () => {
  const alt = { name: null, code: 'GS-1', action: 'redeem', type: 'value', value: 3, valueCents: 300 };
  const g = fromVoucherPayload(alt);
  assert.deepEqual(g, { name: undefined, code: 'GS-1', action: 'redeem', type: 'value', valueCents: 300 });
  assert.deepEqual(toVoucherPayload(g), alt);
  const p = createReceiptParams({ receiptType: 'standard', items: posi, vouchers: [{ action: VoucherAction.redeem, type: VoucherType.value, valueCents: 500, code: 'WG-1' }], payments: ZAHLUNG });
  assert.deepEqual(p['vouchers'], [{ name: null, code: 'WG-1', action: 'redeem', type: 'value', value: 5, valueCents: 500 }]);
});

test('Gutschein-Positionen werden erkannt', () => {
  const r = fromReceiptPayload(nutzlast(lade('gutschein-auszahlung')));
  const p = r.items.find((i) => i.kind === 'voucher_float')!;
  assert.ok(isVoucherFloatItem(p));
  assert.ok(!isVoucherItem(p));
  assert.equal(p.priceCents, -1200);
  const q = fromReceiptPayload(nutzlast(lade('gutschein-einzweck-einloesung'))).items.find((i) => i.kind === 'voucher')!;
  assert.ok(isVoucherItem(q));
});

test('Wuensche der neuen Form gehen in der internen Form hinaus', () => {
  const p = createReceiptParams({ receiptType: 'standard', items: [], vouchers: [{ action: 'sell', type: 'multi_purpose', amountCents: 5000 }], payments: ZAHLUNG });
  assert.deepEqual(p['vouchers'], [{ action: 'sell', type: 'mehrzweck', betragCents: 5000 }]);
  assert.deepEqual(p['items'], []);
  const faelle: Array<[Json, Json]> = [
    [{ action: 'sell', type: 'single_purpose', amountCents: 5000 }, { action: 'sell', type: 'einzweck', betragCents: 5000 }],
    [{ action: 'sell', type: 'service', articleId: 'manicure', quantity: 2 }, { action: 'sell', type: 'leistung', artikelId: 'manicure', stueck: 2 }],
    [{ action: 'redeem', type: 'multi_purpose', code: 'K7QX-AB12-9DWT', amountCents: 1750 }, { action: 'redeem', type: 'mehrzweck', code: 'K7QX-AB12-9DWT', betragCents: 1750 }],
    [{ action: 'redeem', type: 'service', code: 'K7QX-AB12-RRRF', positions: [0] }, { action: 'redeem', type: 'leistung', code: 'K7QX-AB12-RRRF', positionen: [0] }],
    [{ action: 'redeem', type: 'promotion', code: 'K7QX-AB12-P3AK' }, { action: 'redeem', type: 'aktion', code: 'K7QX-AB12-P3AK' }],
    [{ action: 'payout', type: 'multi_purpose', code: 'K7QX-AB12-8CN5', amountCents: 3000, reason: 'Kunde zieht weg' }, { action: 'payout', type: 'mehrzweck', code: 'K7QX-AB12-8CN5', betragCents: 3000, grund: 'Kunde zieht weg' }],
  ];
  for (const [wunsch, soll] of faelle) {
    const items = wunsch.action === 'redeem' ? posi : [];
    // Eine Auszahlung (negativer Zahlbetrag) geht hier ohne Zahlungsliste: die prueft nur positive Betraege
    // (der Zahlbetrag der neuen Form ist Sache der 1.x-Linie).
    const zahlung = wunsch.action === 'payout' ? { paymentMethod: 'cash' } : { payments: ZAHLUNG };
    const q = createReceiptParams({ receiptType: 'standard', items, vouchers: [wunsch], ...zahlung } as Json);
    assert.deepEqual(q['vouchers'], [soll], JSON.stringify(wunsch));
  }
});

test('Server-Felder an einem Wunsch werden vor dem Senden abgewiesen', () => {
  for (const feld of [{ voucherId: 'g1' }, { codeSuffix: '5KN2' }, { zeroRateBucket: 'x' }, { voucherType: 'multi_purpose' }]) {
    assert.throws(
      () => createReceiptParams({ receiptType: 'standard', items: posi, vouchers: [{ action: 'redeem', type: 'multi_purpose', code: 'X', amountCents: 1, ...feld }] as Json, payments: ZAHLUNG }),
      /voucher_invalid/,
    );
  }
});

test('Gutschein-Positionen im Wunsch geben vor jeder anderen Positionspruefung voucher_invalid', () => {
  assert.throws(
    () => createReceiptParams({ receiptType: 'standard', items: [{ name: 'G', quantity: 1, priceCents: -100, vat: 20, kind: 'voucher' } as Json], payments: ZAHLUNG }),
    /voucher_invalid/,
  );
  // Leerer Name waere sonst "Ungueltige Position uebergeben."
  assert.throws(
    () => createReceiptParams({ receiptType: 'standard', items: [{ name: '', quantity: 1, priceCents: -100, vat: 20, kind: 'voucher_float' } as Json], payments: ZAHLUNG }),
    /voucher_invalid/,
  );
});

test('Pruefung bildet die Server-Regeln ab', () => {
  const ok = [
    v({ action: 'sell', type: 'single_purpose', amountCents: 100 }),
    v({ action: 'sell', type: 'service', articleId: 'a', quantity: 2 }),
    v({ action: 'redeem', type: 'service', code: 'C', positions: [0] }),
    v({ action: 'redeem', type: 'promotion', code: 'C' }),
    v({ action: 'payout', type: 'multi_purpose', code: 'C', amountCents: 5, reason: 'x' }),
  ];
  for (const g of ok) assert.ok(voucherIsValid(g), JSON.stringify(g));
  const schlecht = [
    v({ action: 'sell', type: 'multi_purpose' }),
    v({ action: 'sell', type: 'multi_purpose', amountCents: 0 }),
    v({ action: 'sell', type: 'multi_purpose', amountCents: 1.5 }),
    v({ action: 'sell', type: 'service', articleId: 'a' }),
    v({ action: 'sell', type: 'promotion', code: 'C' }),
    v({ action: 'redeem', type: 'multi_purpose', amountCents: 1 }),
    v({ action: 'redeem', type: 'service', code: 'C', positions: [] }),
    v({ action: 'payout', type: 'multi_purpose', code: 'C', amountCents: 5 }),
    v({ action: 'payout', type: 'multi_purpose', code: 'C', amountCents: 5, reason: '' }),
    v({ action: 'payout', type: 'multi_purpose', code: 'C', amountCents: 5, reason: 'x'.repeat(201) }),
    v({ action: 'payout', type: 'service', code: 'C', amountCents: 5, reason: 'x' }),
    v({ action: 'payout', type: 'promotion', code: 'C', reason: 'x' }),
    v({ action: 'payout', type: 'value', code: 'C', valueCents: 5, reason: 'x' }),
    v({ action: 'redeem', type: 'multi_purpose', code: 'C', amountCents: 1, voucherId: 'g' }),
  ];
  for (const g of schlecht) assert.ok(!voucherIsValid(g), JSON.stringify(g));
});

test('Grenzen wie der Server: Betrag, Menge, Positionen, Grund und Code getrimmt', () => {
  const ok = (g: Json): boolean => voucherIsValid(v(g));
  assert.ok(ok({ action: 'sell', type: 'multi_purpose', amountCents: 1_000_000 }));
  assert.ok(!ok({ action: 'sell', type: 'multi_purpose', amountCents: 1_000_001 }));
  assert.ok(!ok({ action: 'redeem', type: 'single_purpose', code: 'C', amountCents: 1_000_001 }));
  assert.ok(ok({ action: 'sell', type: 'service', articleId: 'a', quantity: 100 }));
  assert.ok(!ok({ action: 'sell', type: 'service', articleId: 'a', quantity: 101 }));
  assert.ok(!ok({ action: 'redeem', type: 'service', code: 'C', positions: [0, 0] }));
  assert.ok(ok({ action: 'redeem', type: 'service', code: 'C', positions: [0, 1] }));
  assert.ok(!ok({ action: 'redeem', type: 'multi_purpose', code: '   ', amountCents: 1 }));
  assert.ok(!ok({ action: 'payout', type: 'multi_purpose', code: 'C', amountCents: 1, reason: '   ' }));
  assert.ok(ok({ action: 'payout', type: 'multi_purpose', code: 'C', amountCents: 1, reason: ` ${'x'.repeat(200)} ` }));
  assert.ok(!ok({ action: 'payout', type: 'multi_purpose', code: 'C', amountCents: 1, reason: 'x'.repeat(201) }));
});

test('Kombinationen wie gutschein-beleg.plane des Servers', () => {
  const sell = v({ action: 'sell', type: 'multi_purpose', amountCents: 100 });
  const red = v({ action: 'redeem', type: 'multi_purpose', code: 'C', amountCents: 100 });
  const redS = v({ action: 'redeem', type: 'single_purpose', code: 'D', amountCents: 100 });
  const promo = v({ action: 'redeem', type: 'promotion', code: 'P' });
  const pay = v({ action: 'payout', type: 'multi_purpose', code: 'C', amountCents: 5, reason: 'x' });
  assert.equal(checkVoucherCombinationError([sell], []), null);
  assert.equal(checkVoucherCombinationError([red, redS], posi), null);
  assert.match(checkVoucherCombinationError([sell, red], posi)!, /\S/);
  assert.match(checkVoucherCombinationError([promo, red], posi)!, /\S/);
  assert.match(checkVoucherCombinationError([promo, v({ action: 'redeem', type: 'value', valueCents: 5 })], posi)!, /\S/);
  assert.equal(checkVoucherCombinationError([pay], []), null);
  // Verkauf und Einloesung nie zusammen, sobald einer die neue Form hat (auch gegen die Altform).
  assert.match(checkVoucherCombinationError([sell, v({ action: 'redeem', type: 'value', valueCents: 5 })], posi)!, /\S/);
  assert.match(checkVoucherCombinationError([v({ action: 'sell', type: 'value', valueCents: 5 }), red], posi)!, /\S/);
  // Reine Altform bleibt Sache der alten Regeln.
  assert.equal(checkVoucherCombinationError([v({ action: 'sell', type: 'value', valueCents: 5 }), v({ action: 'redeem', type: 'value', valueCents: 5 })], posi), null);
  // Auszahlung neben Verkauf oder Einloesung anderer Gutscheine ist erlaubt, nur nicht mit einem Altform-Rabatt.
  assert.equal(checkVoucherCombinationError([pay, red], posi), null);
  assert.equal(checkVoucherCombinationError([pay, sell], posi), null);
  assert.match(checkVoucherCombinationError([pay, v({ action: 'redeem', type: 'promo', valueCents: 5 })], posi)!, /\S/);
  // Altform-Rabatt + Einloesung der neuen Form geht durch.
  assert.equal(checkVoucherCombinationError([v({ action: 'redeem', type: 'promo', valueCents: 5 }), red], posi), null);
  // Einloesung der neuen Form braucht Positionen.
  assert.match(checkVoucherCombinationError([red], [])!, /item/);
});

test('neue Form nicht auf Schulungsbelegen', () => {
  assert.throws(() => createReceiptParams({ receiptType: 'training', items: posi, vouchers: [{ action: 'redeem', type: 'multi_purpose', code: 'C', amountCents: 1 }], payments: ZAHLUNG }), /Schulung|training/i);
  assert.ok(ReceiptType.training);
});
