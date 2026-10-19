import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fromReceiptPayload, toReceiptPayload, isVoucherItem, isVoucherFloatItem, voucherIsValid, type Voucher } from '../src/models/index.js';
import { VoucherAction, VoucherType, ReceiptType } from '../src/enums/index.js';
import { checkVoucherCombinationError, createReceiptParams } from '../src/client/receipts.js';

/*
 * Neue Gutscheinform (Mehrzweck, Einzweck, Leistung, Aktion): Beleg lesen und
 * wieder schreiben (der Cache der Web-Kasse tut das) und Wuensche pruefen,
 * bevor etwas hinausgeht. Beispiele aus dem Vertrags-Export /v3.
 */

type Json = Record<string, any>;
function lade(datei: string): Json[] {
  return (JSON.parse(readFileSync(fileURLToPath(new URL(`../../fixtures/v3/antworten/${datei}`, import.meta.url)), 'utf8')) as Json).cases;
}
const FAELLE = [...lade('kasse-belege.json'), ...lade('belege.json'), ...lade('storno.json')];
function beispiel(name: string): Json {
  const f = FAELLE.find((c) => c.name === name);
  if (!f) throw new Error(`kein Fall ${name}`);
  return f;
}

const posi = [{ name: 'a', quantity: 1, priceCents: 100, vat: 20 } as any];
const ZAHLUNG = [{ method: 'cash', amountCents: 5000 }] as any;

test('Beleg mit Einzweck-Einloesung: lesen und wieder schreiben ohne Fehler', () => {
  const roh = beispiel('get_receipt_single_purpose_redeemed');
  const r = fromReceiptPayload(roh.response.data.receipt);
  assert.equal(r.items.find((i) => i.kind === 'voucher')?.priceCents, -300);
  assert.doesNotThrow(() => toReceiptPayload(r));
  const zurueck = fromReceiptPayload(toReceiptPayload(r) as any);
  assert.deepEqual(zurueck.items, r.items);
  assert.deepEqual(zurueck.vouchers, r.vouchers);
});

test('jeder Beispielbeleg mit Gutschein ueberlebt Lesen, Schreiben, Lesen', () => {
  let n = 0;
  for (const f of FAELLE) {
    const beleg = f.response?.data?.receipt;
    if (!beleg || !((beleg.vouchers ?? []).length > 0)) continue;
    const r = fromReceiptPayload(beleg);
    assert.doesNotThrow(() => toReceiptPayload(r), f.name);
    const zurueck = fromReceiptPayload(toReceiptPayload(r) as any);
    assert.deepEqual(zurueck.items, r.items, f.name);
    assert.deepEqual(zurueck.vouchers, r.vouchers, f.name);
    n++;
  }
  assert.ok(n >= 8, `nur ${n} Faelle`);
});

test('gelesene Felder der neuen Form bleiben erhalten', () => {
  const r = fromReceiptPayload(beispiel('redeem_service_voucher').response.data.receipt);
  const v = r.vouchers[0]!;
  assert.equal(v.type, 'service');
  assert.equal(v.voucherType, 'service');
  assert.equal(v.codeSuffix, '5KNN');
  assert.equal(v.voucherId, 'gls1');
  assert.deepEqual(v.positions, [0]);
  assert.equal(v.remainingQuantityAfter, 2);
  assert.equal(v.vatRateBp, 2000);
  assert.equal(v.amountCents, 3500);
  const verkauf = fromReceiptPayload(beispiel('sale_service_voucher').response.data.receipt).vouchers[0]!;
  assert.deepEqual(verkauf.article, { id: 'art_mani', name: 'Maniküre', vatRateBp: 2000, priceCents: 3500 });
});

test('Gutschein-Positionen werden erkannt', () => {
  const r = fromReceiptPayload(beispiel('payout_multi_purpose_voucher').response.data.receipt);
  const p = r.items.find((i) => i.kind === 'voucher_float')!;
  assert.ok(isVoucherFloatItem(p));
  assert.ok(!isVoucherItem(p));
  assert.equal(p.priceCents, -3000);
  const q = fromReceiptPayload(beispiel('redeem_single_purpose_voucher').response.data.receipt).items.find((i) => i.kind === 'voucher')!;
  assert.ok(isVoucherItem(q));
});

test('Verkaufswunsch der neuen Form wird gesendet, wie er ist', () => {
  const p = createReceiptParams({ receiptType: 'standard', items: [], vouchers: [{ action: 'sell', type: 'multi_purpose', amountCents: 5000 }], payments: ZAHLUNG });
  assert.deepEqual(p['vouchers'], [{ action: 'sell', type: 'multi_purpose', amountCents: 5000 }]);
});

test('alle Wunschformen aus dem Vertrag gehen unveraendert hinaus', () => {
  for (const name of ['sale_single_purpose_voucher', 'sale_multi_purpose_voucher', 'sale_service_voucher', 'redeem_multi_purpose_voucher', 'redeem_single_purpose_voucher', 'redeem_service_voucher', 'redeem_promotion_voucher', 'payout_multi_purpose_voucher']) {
    const wunsch = beispiel(name).params.vouchers;
    // Eine reine Auszahlung geht mit genau einer negativen Barzahlung hinaus (wie im Vertrag).
    const payments = wunsch[0].action === 'payout' ? beispiel(name).params.payments : ZAHLUNG;
    const p = createReceiptParams({ receiptType: 'standard', items: wunsch[0].action === 'redeem' ? posi : [], vouchers: wunsch, payments } as any);
    assert.deepEqual(p['vouchers'], wunsch, name);
  }
});

test('Server-Felder an einem Wunsch werden vor dem Senden abgewiesen', () => {
  for (const feld of [{ voucherId: 'g1' }, { codeSuffix: '5KN2' }, { zeroRateBucket: 'x' }, { voucherType: 'multi_purpose' }]) {
    assert.throws(
      () => createReceiptParams({ receiptType: 'standard', items: [{ name: 'a', quantity: 1, priceCents: 100, vat: 20 } as any], vouchers: [{ action: 'redeem', type: 'multi_purpose', code: 'X', amountCents: 1, ...feld }] as any, payments: ZAHLUNG }),
      /voucher_invalid/,
    );
  }
});

test('Gutschein-Positionen im Wunsch werden abgewiesen', () => {
  assert.throws(
    () => createReceiptParams({ receiptType: 'standard', items: [{ name: 'G', quantity: 1, priceCents: -100, vat: 20, kind: 'voucher' } as any], payments: ZAHLUNG }),
    /voucher_invalid/,
  );
});

const v = (o: Json): Voucher => o as Voucher;

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

test('Kombinationen: Verkauf ODER Einloesung, Aktion allein, Aktion nie mit Altform-Promo', () => {
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
  assert.match(checkVoucherCombinationError([pay, v({ action: 'redeem', type: 'promo', valueCents: 5 })], posi)!, /\S/);
  assert.equal(checkVoucherCombinationError([pay], []), null);

  // Regel 1: Verkauf und Einloesung nie zusammen, sobald einer die neue Form hat (auch gegen die Altform).
  assert.match(checkVoucherCombinationError([sell, v({ action: 'redeem', type: 'value', valueCents: 5 })], posi)!, /\S/);
  assert.match(checkVoucherCombinationError([v({ action: 'sell', type: 'value', valueCents: 5 }), red], posi)!, /\S/);
  // ... reine Altform bleibt Sache der alten Regeln (Wert verkaufen + Wert einloesen ist dort erlaubt).
  assert.equal(checkVoucherCombinationError([v({ action: 'sell', type: 'value', valueCents: 5 }), v({ action: 'redeem', type: 'value', valueCents: 5 })], posi), null);
  // Regel 2: Auszahlung neben Verkauf oder Einloesung anderer Gutscheine ist erlaubt.
  assert.equal(checkVoucherCombinationError([pay, red], posi), null);
  assert.equal(checkVoucherCombinationError([pay, sell], posi), null);
  assert.equal(checkVoucherCombinationError([pay, v({ action: 'sell', type: 'value', valueCents: 5 })], posi), null);
  assert.equal(checkVoucherCombinationError([pay, v({ action: 'redeem', type: 'value', valueCents: 5, code: 'W' })], posi), null);
  // Regel 3: Auszahlung nur mit einem Altform-Rabatt (promo) nicht.
  assert.match(checkVoucherCombinationError([pay, v({ action: 'redeem', type: 'promo', valueCents: 5 })], posi)!, /\S/);
  // Regel 4: Altform-Rabatt + Einloesung der neuen Form geht durch (die neue Einloesung zaehlt nicht zur Altform-Summe).
  assert.equal(checkVoucherCombinationError([v({ action: 'redeem', type: 'promo', valueCents: 5 }), red], posi), null);
  assert.equal(checkVoucherCombinationError([red, v({ action: 'redeem', type: 'promo', valueCents: 5 })], posi), null);
  assert.equal(checkVoucherCombinationError([promo], posi), null);
});

test('neue Form nicht auf Schulungsbelegen', () => {
  assert.throws(() => createReceiptParams({ receiptType: 'training', items: posi, vouchers: [{ action: 'redeem', type: 'multi_purpose', code: 'C', amountCents: 1 }], payments: ZAHLUNG }), /Schulung|training/i);
  assert.ok(ReceiptType.training);
});

test('Altform bleibt unveraendert', () => {
  const p = createReceiptParams({ receiptType: 'standard', items: posi, vouchers: [{ action: VoucherAction.redeem, type: VoucherType.value, valueCents: 500, code: 'WG-1' }], payments: ZAHLUNG });
  assert.deepEqual(p['vouchers'], [{ action: 'redeem', type: 'value', valueCents: 500, code: 'WG-1' }]);
});

test('Grenzen wie der Server: Betrag, Menge, Positionen, Grund und Code getrimmt', () => {
  const ok = (g: Json) => voucherIsValid(v(g));
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

test('eine Gutschein-Position gibt vor jeder anderen Positionspruefung voucher_invalid', () => {
  // Leerer Name waere sonst "Ungueltige Position uebergeben."
  assert.throws(
    () => createReceiptParams({ receiptType: 'standard', items: [{ name: '', quantity: 1, priceCents: -100, vat: 20, kind: 'voucher_float' } as any], payments: ZAHLUNG }),
    /voucher_invalid/,
  );
});
