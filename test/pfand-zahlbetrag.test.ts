import assert from 'node:assert/strict';
import { test } from 'node:test';
import { receiptDueBreakdown, receiptDueCents, voucherRedeemMaxCents, ReceiptDueError } from '../src/receipt/due.js';
import { distributeDiscount } from '../src/receipt/discount.js';
import type { ReceiptItem, Voucher } from '../src/models/index.js';
import type { VoucherCheck } from '../src/pos/gutschein.js';

/*
 * Pfand und Leergut im Zahlbetrag (Spec Pfand & Leergut, E17/E18, Leergut-Auszahlung): die Vertragsfaelle
 * stehen in due.test.ts; hier die Regeln, die sie nicht einzeln benennen.
 */

const ware = (cents: number, satz: number, name = 'Ware'): ReceiptItem => ({ name, quantity: 1, priceCents: cents, vat: satz });
const pfand = (cents: number, satz: number, extra: Partial<ReceiptItem> = {}): ReceiptItem =>
  ({ name: 'Pfand', quantity: 1, priceCents: cents, vat: satz, kind: 'deposit', depositTypeId: 'kiste', depositKind: 'reusable', ...extra });
const leergut = (stueck: number, centsJe: number, satz: number): ReceiptItem =>
  ({ name: 'Leergut', quantity: stueck, priceCents: -centsJe, vat: satz, kind: 'deposit_return', depositTypeId: 'kiste', depositKind: 'reusable' });
const CODE = '5TD5-9ECF-5KN2';
const einzweck = (balanceCents: number, vatRateBp: number): VoucherCheck =>
  ({ type: 'single_purpose', status: 'active', codeSuffix: '5KN2', balanceCents, faceValueCents: 5000, vatRateBp });

test('Einweg-Pfand liegt im Topf Null, Mehrweg-Pfand im Topf seines Satzes, 4,9 % im Topf Besonders', () => {
  const b = receiptDueBreakdown(
    [ware(1000, 20), pfand(150, 0, { depositTypeId: 'einweg', depositKind: 'single_use' }), pfand(400, 20), pfand(100, 4.9)],
    [], 'standard',
  );
  assert.equal(b.dueCents, 1650);
  assert.deepEqual(b.bucketsCents, {
    amountRateStandard: 1400, amountRateReduced1: 0, amountRateReduced2: 0, amountRateZero: 150, amountRateSpecial: 100, amountRatOthers: 0,
  });
  assert.equal(b.payout, undefined);
});

test('Rabattgutschein mindert nie das Pfand und rechnet nur ueber die Ware (E17)', () => {
  const promo: Voucher[] = [{ action: 'redeem', type: 'promo', valueCents: 500, code: 'R' }];
  // 10 EUR Ware + 4 EUR Pfand im selben Satz: 5 EUR Rabatt nur von der Ware.
  assert.equal(receiptDueCents([ware(1000, 20), pfand(400, 20)], promo, 'standard'), 900);
  // Der Deckel ist die Ware, nicht Ware + Pfand: 20 EUR Rabatt kappen bei 10 EUR.
  assert.equal(receiptDueCents([ware(1000, 20), pfand(400, 20)], [{ ...promo[0]!, valueCents: 2000 }], 'standard'), 400);
});

test('distributeDiscount laesst Pfand und Leergut aus', () => {
  const korb = [ware(1000, 20), pfand(400, 20), pfand(150, 0, { depositKind: 'single_use' }), leergut(2, 50, 20)];
  const zeilen = distributeDiscount(korb, 200);
  assert.equal(zeilen.length, 1);
  assert.equal(zeilen[0]!.priceCents, -200);
  assert.equal(zeilen[0]!.vat, 20);
  // Mehr als die Ware gibt es nicht zu rabattieren, auch wenn das Pfand dazukommt.
  assert.throws(() => distributeDiscount(korb, 1001), /uebersteigt/);
  // Ein Korb nur aus Pfand ist nicht rabattierbar.
  assert.throws(() => distributeDiscount([pfand(400, 20)], 100), /uebersteigt/);
});

test('Einzweckgutschein deckt kein Pfand (E18), Mehrzweck als Zahlung deckt den ganzen Beleg', () => {
  const korb = [ware(1000, 20), pfand(400, 20)];
  const info = [{ code: CODE, check: einzweck(5000, 2000) }];
  const einloesen = (cents: number): Voucher[] => [{ action: 'redeem', type: 'single_purpose', code: CODE, amountCents: cents }];
  assert.equal(receiptDueCents(korb, einloesen(1000), 'standard', { voucherInfo: info }), 400);
  assert.throws(
    () => receiptDueCents(korb, einloesen(1001), 'standard', { voucherInfo: info }),
    (e) => e instanceof ReceiptDueError && e.voucherErrorCode === 'voucher_rate_mismatch',
  );
  assert.equal(voucherRedeemMaxCents(korb, einzweck(5000, 2000), { options: { voucherInfo: info } }), 1000);
  // Wertgutschein (Mehrzweck) als Zahlung: Fluss mindert den ganzen Betrag, Pfand inklusive.
  const mehrzweck: VoucherCheck = { type: 'multi_purpose', status: 'active', codeSuffix: '5KN2', balanceCents: 5000, faceValueCents: 5000 };
  assert.equal(receiptDueCents(korb, [{ action: 'redeem', type: 'multi_purpose', code: CODE, amountCents: 1400 }], 'standard', { voucherInfo: [{ code: CODE, check: mehrzweck }] }), 0);
});

test('Leergut-Auszahlung: payout deposit nur bei negativem Betrag mit Leergut, hoechstens die Leergutsumme', () => {
  const rein = receiptDueBreakdown([leergut(2, 50, 20)], [], 'standard');
  assert.equal(rein.dueCents, -100);
  assert.equal(rein.payout, 'deposit');
  // Leergut zu Ware: positiver Betrag, keine Auszahlung.
  const misch = receiptDueBreakdown([ware(1000, 20), leergut(2, 50, 20)], [], 'standard');
  assert.equal(misch.dueCents, 900);
  assert.equal(misch.payout, undefined);
  // Mehr Leergut als Ware: negativ, aber innerhalb der Leergutsumme.
  const mehr = receiptDueBreakdown([ware(30, 20), leergut(2, 50, 20)], [], 'standard');
  assert.equal(mehr.dueCents, -70);
  assert.equal(mehr.payout, 'deposit');
  // Ware fuehrt nie zu einer Auszahlung: eine Negativzeile ohne Leergut zahlt nicht aus.
  const negativ = receiptDueBreakdown([ware(-100, 20)], [], 'standard');
  assert.equal(negativ.dueCents, -100);
  assert.equal(negativ.payout, undefined);
  // Mehr als die Leergutsumme auszahlen waere Ware: keine Leergut-Auszahlung.
  assert.equal(receiptDueBreakdown([ware(-100, 20), leergut(1, 50, 20)], [], 'standard').payout, undefined);
  // Storno ist keine Auszahlung.
  assert.equal(receiptDueBreakdown([leergut(2, 50, 20)], [], 'cancellation').payout, undefined);
});

test('Belege ohne Pfand tragen kein payout-Feld', () => {
  const b = receiptDueBreakdown([ware(1000, 20)], [], 'standard');
  assert.equal('payout' in b, false);
});
