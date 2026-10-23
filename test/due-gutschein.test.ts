import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  receiptDueCents,
  receiptDueBreakdown,
  voucherRedeemMaxCents,
  ReceiptDueError,
  VOUCHER_ZERO_RATE_BUCKET_FROM,
  type ReceiptDueOptions,
  type VoucherDueInfo,
} from '../src/receipt/due.js';
import * as wurzel from '../src/index.js';
import { createReceiptParams } from '../src/client/receipts.js';
import { isKasseneckValidationError } from '../src/client/errors.js';
import { fromReceiptItemPayload, fromVoucherPayload, type ReceiptItem, type Voucher, type VoucherPayload } from '../src/models/index.js';
import type { VoucherCheck } from '../src/pos/gutschein.js';
import { istAbgelehnt, optionenDesFalls, type VertragsEingabe, type VertragsErgebnis } from './gutschein-setup.js';

/*
 * Zahlbetrag mit Gutscheinen der neuen Form: Zwilling von
 * gutschein-beleg.plane + gutschein-beleg.zahlbetrag im Backend. Die Kasse
 * rechnet ihn, bevor ein Kartenterminal belastet wird; der Server weist eine
 * andere Summe mit payments_sum_mismatch ab.
 */

const pos = (name: string, cents: number, satz: number, extra: Partial<ReceiptItem> = {}): ReceiptItem =>
  ({ name, quantity: 1, priceCents: cents, vat: satz, ...extra });
const LEER = { amountRateStandard: 0, amountRateReduced1: 0, amountRateReduced2: 0, amountRateZero: 0, amountRateSpecial: 0, amountRatOthers: 0 };
const toepfe = (werte: Partial<typeof LEER>) => ({ ...LEER, ...werte });

const CODE_M = 'DTD5-9ECF-5KNZ';
const CODE_E = '5TD5-9ECF-5KN2';
const CODE_L = 'CKD59ECF5KNN';
const CODE_A = '1BD59ECF5KNJ';
const CODE_P = 'DTD1-NKT1-8CN5';

const mehrzweck = (balanceCents: number, status: VoucherCheck['status'] = 'active'): VoucherCheck =>
  ({ type: 'multi_purpose', status, codeSuffix: '5KNZ', balanceCents, faceValueCents: 5000 });
const einzweck = (balanceCents: number, vatRateBp: number): VoucherCheck =>
  ({ type: 'single_purpose', status: 'active', codeSuffix: '9DWT', balanceCents, faceValueCents: 5000, vatRateBp });
const leistung = (remainingQuantity: number): VoucherCheck => ({
  type: 'service', status: 'active', codeSuffix: '5KNN', quantity: 3, remainingQuantity, vatRateBp: 2000,
  article: { id: 'art_mani', name: 'Maniküre', vatRateBp: 2000, priceCents: 3500 },
});

function wirft(f: () => unknown, voucherErrorCode?: string): void {
  assert.throws(f, (e: unknown) => {
    assert.ok(e instanceof ReceiptDueError, String(e));
    assert.equal(e.reason, 'invalid_voucher');
    assert.equal(e.outcome, 'rejected');
    if (voucherErrorCode !== undefined) assert.equal(e.voucherErrorCode, voucherErrorCode);
    // Der Klartext-Code steht nie in einer Meldung.
    for (const c of [CODE_M, CODE_E, CODE_L, CODE_A, CODE_P]) assert.ok(!e.message.includes(c) && !e.message.includes(c.replace(/-/g, '')), e.message);
    return true;
  });
}

// --- Vertragsfaelle ------------------------------------------------------------

interface Fall {
  name: string;
  input: VertragsEingabe;
  setup?: Record<string, unknown>;
  expected: VertragsErgebnis;
}
const FAELLE = (JSON.parse(readFileSync(fileURLToPath(new URL('../../fixtures/v3/zahlbetrag-faelle.json', import.meta.url)), 'utf8')) as { cases: Fall[] }).cases;
const MIT_NEUER_FORM = FAELLE.filter((f) => f.input.vouchers.some((v) => ['multi_purpose', 'single_purpose', 'service', 'promotion'].includes(String(v.type)) || v.action === 'payout'));

test('Vertrag: die Faelle mit Gutscheinen der neuen Form sind da', () => {
  const namen = MIT_NEUER_FORM.map((f) => f.name);
  for (const n of ['single_purpose_voucher_sell', 'single_purpose_voucher_redeem', 'service_voucher_sell', 'service_voucher_redeem', 'promotion_voucher_redeem']) {
    assert.ok(namen.includes(n), n);
  }
});

test('Vertrag: Trinkgeld-Regel (ein Gutschein deckt nie das Trinkgeld) mit Server-Ergebnis', () => {
  const namen = MIT_NEUER_FORM.map((f) => f.name);
  for (const n of ['tip_staff_value_voucher_capped', 'tip_owner_value_voucher_capped', 'tip_owner_value_voucher_over_tip', 'tip_payment_tipcents_value_voucher',
    'tip_promo_and_value_voucher', 'tip_value_voucher_boundary_accepted', 'tip_value_voucher_boundary_rejected', 'tip_single_purpose_voucher_goods_only']) {
    assert.ok(namen.includes(n), n);
  }
  assert.ok(MIT_NEUER_FORM.filter((f) => istAbgelehnt(f.expected)).length >= 2);
});

for (const fall of MIT_NEUER_FORM) {
  test(`Vertrag ${fall.name}: Zahlbetrag, Toepfe und Fluss bzw. Abweisung wie der Server`, () => {
    const items = fall.input.items.map((p) => fromReceiptItemPayload(p));
    const vouchers = fall.input.vouchers.map((v) => fromVoucherPayload(v as unknown as VoucherPayload));
    const o = optionenDesFalls(fall.input, fall.setup);
    const e = fall.expected;
    if (istAbgelehnt(e)) {
      wirft(() => receiptDueCents(items, vouchers, fall.input.receiptType, o), e.errorCode);
      return;
    }
    assert.deepEqual(receiptDueBreakdown(items, vouchers, fall.input.receiptType, o), e);
    assert.equal(receiptDueCents(items, vouchers, fall.input.receiptType, o), e.dueCents);
  });
}

// --- Mehrzweck -------------------------------------------------------------------

test('Mehrzweck einloesen ist Zahlung: mindert den Zahlbetrag, nicht die Toepfe', () => {
  const items = [pos('Blumenstrauß', 2240, 20)];
  const v: Voucher[] = [{ action: 'redeem', type: 'multi_purpose', code: CODE_M, amountCents: 1750 }];
  const o: ReceiptDueOptions = { voucherInfo: [{ code: CODE_M, check: mehrzweck(5000) }] };
  assert.deepEqual(receiptDueBreakdown(items, v, 'standard', o), {
    dueCents: 490, counterDeltaCents: 2240, valueVoucherFlowCents: -1750, bucketsCents: toepfe({ amountRateStandard: 2240 }),
  });
});

test('Mehrzweck deckt den ganzen Betrag: Zahlbetrag 0', () => {
  const items = [pos('Blumenstrauß', 2240, 20)];
  const v: Voucher[] = [{ action: 'redeem', type: 'multi_purpose', code: 'dtd59ecf5knz', amountCents: 2240 }];
  assert.equal(receiptDueCents(items, v, 'standard', { voucherInfo: [{ code: CODE_M, check: mehrzweck(5000) }] }), 0);
});

test('Mehrzweck ueber der Summe: der Server antwortet voucher_exceeds_total, hier wirft es vorher', () => {
  const items = [pos('Blumenstrauß', 2240, 20)];
  const v: Voucher[] = [{ action: 'redeem', type: 'multi_purpose', code: CODE_M, amountCents: 3000 }];
  wirft(() => receiptDueCents(items, v, 'standard', { voucherInfo: [{ code: CODE_M, check: mehrzweck(5000) }] }), 'voucher_exceeds_total');
});

test('Mehrzweck ueber dem Saldo: voucher_insufficient_balance', () => {
  const items = [pos('Blumenstrauß', 2240, 20)];
  const v: Voucher[] = [{ action: 'redeem', type: 'multi_purpose', code: CODE_M, amountCents: 2000 }];
  wirft(() => receiptDueCents(items, v, 'standard', { voucherInfo: [{ code: CODE_M, check: mehrzweck(1999) }] }), 'voucher_insufficient_balance');
});

const MEHRZWECK_EIN: ReceiptDueOptions = { voucherSettings: { sale: true, valueVoucherType: 'multi_purpose', vatRateBp: null } };

test('Mehrzweck verkaufen: vor dem Stichtag Fluss, ab dem Stichtag Position im 0-%-Topf', () => {
  const v: Voucher[] = [{ action: 'sell', type: 'multi_purpose', amountCents: 5000 }];
  assert.equal(VOUCHER_ZERO_RATE_BUCKET_FROM, '2099-12-31');
  assert.deepEqual(receiptDueBreakdown([], v, 'standard', MEHRZWECK_EIN), {
    dueCents: 5000, counterDeltaCents: 0, valueVoucherFlowCents: 5000, bucketsCents: toepfe({}),
  });
  const ab = { ...MEHRZWECK_EIN, zeroRateBucketFrom: '2026-10-01', today: '2026-10-19' };
  assert.deepEqual(receiptDueBreakdown([], v, 'standard', ab), {
    dueCents: 5000, counterDeltaCents: 5000, valueVoucherFlowCents: 0, bucketsCents: toepfe({ amountRateZero: 5000 }),
  });
  // Vor dem Stichtag (heute davor): wie bisher.
  assert.equal(receiptDueBreakdown([], v, 'standard', { ...MEHRZWECK_EIN, zeroRateBucketFrom: '2026-10-20', today: '2026-10-19' }).valueVoucherFlowCents, 5000);
  // Altform-Verkauf ab dem Stichtag ebenso in den 0-%-Topf.
  const alt: Voucher[] = [{ action: 'sell', type: 'value', valueCents: 2500, code: 'G1' }];
  assert.deepEqual(receiptDueBreakdown([pos('Kaffee', 320, 20)], alt, 'standard', ab), {
    dueCents: 2820, counterDeltaCents: 2820, valueVoucherFlowCents: 0, bucketsCents: toepfe({ amountRateStandard: 320, amountRateZero: 2500 }),
  });
});

test('Verkauf ohne Gutschein-Einstellung: voucher_settings_missing (Mehrzweck wie Einzweck), sonst nichts kassieren', () => {
  for (const type of ['multi_purpose', 'single_purpose'] as const) {
    const v: Voucher[] = [{ action: 'sell', type, amountCents: 5000 }];
    wirft(() => receiptDueCents([], v, 'standard'), 'voucher_settings_missing');
    wirft(() => receiptDueCents([], v, 'standard', { voucherSettings: { sale: false, valueVoucherType: null, vatRateBp: null } }), 'voucher_settings_missing');
  }
});

test('Altform nach dem Stichtag: plane laeuft, ein negativer Zahlbetrag ist voucher_exceeds_total', () => {
  const v: Voucher[] = [{ action: 'sell', type: 'value', valueCents: 1000, code: 'G1' }, { action: 'redeem', type: 'value', valueCents: 5000, code: 'G2' }];
  const items = [pos('Kaffee', 320, 20)];
  // Vor dem Stichtag wie bisher (der Server prueft das Vorzeichen erst an den Zahlungen).
  assert.equal(receiptDueCents(items, v, 'standard', { today: '2026-10-19' }), -3680);
  wirft(() => receiptDueCents(items, v, 'standard', { today: '2026-10-19', zeroRateBucketFrom: '2026-01-01' }), 'voucher_exceeds_total');
});

test('Mehrzweck verkaufen mit Einzweck-Einstellung: voucher_invalid', () => {
  const v: Voucher[] = [{ action: 'sell', type: 'multi_purpose', amountCents: 5000 }];
  wirft(() => receiptDueCents([], v, 'standard', { voucherSettings: { sale: true, valueVoucherType: 'single_purpose', vatRateBp: 2000 } }), 'voucher_invalid');
});

test('Auszahlung Mehrzweck: immer Position im 0-%-Topf, Zahlbetrag negativ, kein Fluss', () => {
  const v: Voucher[] = [{ action: 'payout', type: 'multi_purpose', code: CODE_P, amountCents: 3000, reason: 'Kunde zieht weg' }];
  const o: ReceiptDueOptions = { voucherInfo: [{ code: CODE_P, check: { ...mehrzweck(3000), codeSuffix: '8CN5' } }] };
  assert.deepEqual(receiptDueBreakdown([], v, 'standard', o), {
    dueCents: -3000, counterDeltaCents: -3000, valueVoucherFlowCents: 0, bucketsCents: toepfe({ amountRateZero: -3000 }),
  });
});

test('Auszahlung abgelaufen: bis rueckzahlbar-bis erlaubt, danach voucher_expired', () => {
  const v: Voucher[] = [{ action: 'payout', type: 'multi_purpose', code: CODE_P, amountCents: 1000, reason: 'Ablauf' }];
  const check: VoucherCheck = { ...mehrzweck(3000, 'expired'), validity: { pattern: '1+3', refundableUntil: '2026-12-31' } };
  assert.equal(receiptDueCents([], v, 'standard', { voucherInfo: [{ code: CODE_P, check }], today: '2026-10-19' }), -1000);
  wirft(() => receiptDueCents([], v, 'standard', { voucherInfo: [{ code: CODE_P, check }], today: '2027-01-01' }), 'voucher_expired');
});

// --- Einzweck --------------------------------------------------------------------

test('Einzweck einloesen: Minuszeile im Satz des Gutscheins', () => {
  const items = [pos('Maniküre', 3500, 20), pos('Shampoo', 1200, 10)];
  const v: Voucher[] = [{ action: 'redeem', type: 'single_purpose', code: CODE_E, amountCents: 3000 }];
  assert.deepEqual(receiptDueBreakdown(items, v, 'standard', { voucherInfo: [{ code: CODE_E, check: einzweck(5000, 2000) }] }), {
    dueCents: 1700, counterDeltaCents: 1700, valueVoucherFlowCents: 0, bucketsCents: toepfe({ amountRateStandard: 500, amountRateReduced1: 1200 }),
  });
});

test('Einzweck deckt nie mehr als die Positionen seines Topfs: voucher_rate_mismatch', () => {
  const items = [pos('Maniküre', 3500, 20), pos('Shampoo', 1200, 10)];
  const v: Voucher[] = [{ action: 'redeem', type: 'single_purpose', code: CODE_E, amountCents: 3501 }];
  wirft(() => receiptDueCents(items, v, 'standard', { voucherInfo: [{ code: CODE_E, check: einzweck(5000, 2000) }] }), 'voucher_rate_mismatch');
});

test('Einzweck deckt keine Trinkgeld-Position', () => {
  const items = [pos('Kaffee', 320, 20)];
  const v: Voucher[] = [{ action: 'redeem', type: 'single_purpose', code: CODE_E, amountCents: 400 }];
  wirft(() => receiptDueCents(items, v, 'standard', { voucherInfo: [{ code: CODE_E, check: einzweck(5000, 2000) }], tip: 100, tipRecipient: 'owner' }), 'voucher_rate_mismatch');
  // Trinkgeld kommt vor den Gutscheinzeilen (Basis bleibt die Ware): 320 + 100 - 320
  assert.equal(receiptDueCents(items, [{ ...v[0]!, amountCents: 320 }], 'standard', { voucherInfo: [{ code: CODE_E, check: einzweck(5000, 2000) }], tip: 100, tipRecipient: 'staff' }), 100);
});

test('Einzweck 19 % deckt auch 4,9 %: ein Topf (Besonders), wie der Server zaehlt', () => {
  const items = [pos('Brot', 400, 4.9)];
  const v: Voucher[] = [{ action: 'redeem', type: 'single_purpose', code: CODE_E, amountCents: 400 }];
  assert.equal(receiptDueCents(items, v, 'standard', { voucherInfo: [{ code: CODE_E, check: einzweck(5000, 1900) }] }), 0);
});

test('Einzweck als Kleinunternehmer: anteilig auf alle Saetze, groesster Rest', () => {
  const items = [pos('Maniküre', 3500, 20), pos('Shampoo', 1200, 10)];
  const v: Voucher[] = [{ action: 'redeem', type: 'single_purpose', code: CODE_E, amountCents: 1000 }];
  assert.deepEqual(receiptDueBreakdown(items, v, 'standard', { voucherInfo: [{ code: CODE_E, check: einzweck(5000, 2000) }], smallBusiness: true }), {
    dueCents: 3700, counterDeltaCents: 3700, valueVoucherFlowCents: 0, bucketsCents: toepfe({ amountRateStandard: 2755, amountRateReduced1: 945 }),
  });
});

test('Einzweck befreit verkauft (exempt) in einem steuerpflichtigen Konto: anteilig wie Kleinunternehmer', () => {
  const items = [pos('Maniküre', 3500, 20), pos('Shampoo', 1200, 10)];
  const v: Voucher[] = [{ action: 'redeem', type: 'single_purpose', code: CODE_E, amountCents: 1000 }];
  const check: VoucherCheck = { ...einzweck(5000, 0), exempt: true };
  assert.deepEqual(receiptDueBreakdown(items, v, 'standard', { voucherInfo: [{ code: CODE_E, check }] }).bucketsCents,
    toepfe({ amountRateStandard: 2755, amountRateReduced1: 945 }));
  // Ohne exempt waere es eine Minuszeile zu 0 %, die hier keine Position deckt.
  wirft(() => receiptDueCents(items, v, 'standard', { voucherInfo: [{ code: CODE_E, check: einzweck(5000, 0) }] }), 'voucher_rate_mismatch');
});

test('Einzweck verkaufen: Position im Satz der Einstellung; ohne Einstellung nicht rechenbar', () => {
  const v: Voucher[] = [{ action: 'sell', type: 'single_purpose', amountCents: 5000 }];
  const o: ReceiptDueOptions = { voucherSettings: { sale: true, valueVoucherType: 'single_purpose', vatRateBp: 1000 } };
  assert.deepEqual(receiptDueBreakdown([], v, 'standard', o), {
    dueCents: 5000, counterDeltaCents: 5000, valueVoucherFlowCents: 0, bucketsCents: toepfe({ amountRateReduced1: 5000 }),
  });
  assert.deepEqual(receiptDueBreakdown([], v, 'standard', { ...o, smallBusiness: true }).bucketsCents, toepfe({ amountRateZero: 5000 }));
  wirft(() => receiptDueCents([], v, 'standard'), 'voucher_settings_missing');
});

test('Auszahlung Einzweck: Minusposition im Satz des Gutscheins', () => {
  const v: Voucher[] = [{ action: 'payout', type: 'single_purpose', code: CODE_E, amountCents: 1200, reason: 'Kulanz' }];
  assert.deepEqual(receiptDueBreakdown([], v, 'standard', { voucherInfo: [{ code: CODE_E, check: einzweck(2000, 2000) }] }), {
    dueCents: -1200, counterDeltaCents: -1200, valueVoucherFlowCents: 0, bucketsCents: toepfe({ amountRateStandard: -1200 }),
  });
});

// --- Leistung --------------------------------------------------------------------

test('Leistung einloesen: je Satz eine Minuszeile ueber die gewaehlten Positionen samt Menge', () => {
  const items = [pos('Maniküre', 3500, 20, { articleId: 'art_mani', quantity: 2 }), pos('Kaffee', 320, 20)];
  const v: Voucher[] = [{ action: 'redeem', type: 'service', code: CODE_L, positions: [0] }];
  assert.equal(receiptDueCents(items, v, 'standard', { voucherInfo: [{ code: CODE_L, check: leistung(3) }] }), 320);
  wirft(() => receiptDueCents(items, v, 'standard', { voucherInfo: [{ code: CODE_L, check: leistung(1) }] }), 'voucher_insufficient_balance');
  wirft(() => receiptDueCents(items, [{ ...v[0]!, positions: [1] }], 'standard', { voucherInfo: [{ code: CODE_L, check: leistung(3) }] }), 'voucher_item_mismatch');
  wirft(() => receiptDueCents(items, [{ ...v[0]!, positions: [5] }], 'standard', { voucherInfo: [{ code: CODE_L, check: leistung(3) }] }), 'voucher_item_mismatch');
});

test('Leistung einloesen: eine Position mit kind null gilt als Ware (der Server prueft !kind)', () => {
  const items = [pos('Maniküre', 3500, 20, { articleId: 'art_mani', kind: null as unknown as undefined })];
  const v: Voucher[] = [{ action: 'redeem', type: 'service', code: CODE_L, positions: [0] }];
  assert.equal(receiptDueCents(items, v, 'standard', { voucherInfo: [{ code: CODE_L, check: leistung(3) }] }), 0);
});

test('Leistung verkaufen: Stueck mal Artikelpreis im Artikelsatz; ohne Artikel nicht rechenbar', () => {
  const v: Voucher[] = [{ action: 'sell', type: 'service', articleId: 'art_mani', quantity: 3 }];
  const o: ReceiptDueOptions = { voucherArticles: [{ id: 'art_mani', priceCents: 3500, vatRateBp: 2000 }] };
  assert.deepEqual(receiptDueBreakdown([], v, 'standard', o), {
    dueCents: 10500, counterDeltaCents: 10500, valueVoucherFlowCents: 0, bucketsCents: toepfe({ amountRateStandard: 10500 }),
  });
  wirft(() => receiptDueCents([], v, 'standard'), 'voucher_item_mismatch');
});

// --- Aktion ----------------------------------------------------------------------

test('Aktion mit Prozent: abgerundet von der Summe der deckbaren Positionen, wie promo verteilt', () => {
  const items = [pos('Kaffee', 333, 20), pos('Semmel', 79, 10)];
  const check: VoucherCheck = { type: 'promotion', status: 'active', codeSuffix: '5KNJ', discountPercentBp: 1000 };
  // 412 * 10 % = 41,2 -> 41
  assert.equal(receiptDueCents(items, [{ action: 'redeem', type: 'promotion', code: CODE_A }], 'standard', { voucherInfo: [{ code: CODE_A, check }] }), 371);
  // Betrag ueber der Summe: hoechstens die Summe
  const gross: VoucherCheck = { type: 'promotion', status: 'active', codeSuffix: '5KNJ', discountCents: 10000 };
  assert.equal(receiptDueCents(items, [{ action: 'redeem', type: 'promotion', code: CODE_A }], 'standard', { voucherInfo: [{ code: CODE_A, check: gross }] }), 0);
});

test('Aktion nur allein am Beleg', () => {
  const items = [pos('Kaffee', 320, 20)];
  const v: Voucher[] = [{ action: 'redeem', type: 'promotion', code: CODE_A }, { action: 'redeem', type: 'multi_purpose', code: CODE_M, amountCents: 100 }];
  wirft(() => receiptDueCents(items, v, 'standard', {
    voucherInfo: [{ code: CODE_A, check: { type: 'promotion', status: 'active', codeSuffix: '5KNJ', discountCents: 100 } }, { code: CODE_M, check: mehrzweck(5000) }],
  }), 'voucher_invalid');
});

// --- Pruefung fehlt, Regeln des Plans ------------------------------------------------

test('Einloesung ohne passende Pruefung: invalid_voucher, der Code steht nicht in der Meldung', () => {
  const items = [pos('Kaffee', 320, 20)];
  const v: Voucher[] = [{ action: 'redeem', type: 'multi_purpose', code: CODE_M, amountCents: 100 }];
  wirft(() => receiptDueCents(items, v, 'standard'));
  wirft(() => receiptDueCents(items, v, 'standard', { voucherInfo: [{ code: CODE_E, check: mehrzweck(5000) }] }));
  // Art der Pruefung passt nicht zum Wunsch
  wirft(() => receiptDueCents(items, v, 'standard', { voucherInfo: [{ code: CODE_M, check: einzweck(5000, 2000) }] }), 'voucher_invalid');
  // Nicht aktiv
  wirft(() => receiptDueCents(items, v, 'standard', { voucherInfo: [{ code: CODE_M, check: mehrzweck(5000, 'blocked') }] }), 'voucher_blocked');
});

test('Verkauf und Einloesung zusammen, derselbe Gutschein zweimal, Gutscheinzeilen von aussen: invalid_voucher', () => {
  const items = [pos('Kaffee', 320, 20)];
  const info: VoucherDueInfo[] = [{ code: CODE_M, check: mehrzweck(5000) }];
  wirft(() => receiptDueCents(items, [
    { action: 'sell', type: 'multi_purpose', amountCents: 1000 },
    { action: 'redeem', type: 'multi_purpose', code: CODE_M, amountCents: 100 },
  ], 'standard', { voucherInfo: info }), 'voucher_invalid');
  wirft(() => receiptDueCents(items, [
    { action: 'redeem', type: 'multi_purpose', code: CODE_M, amountCents: 100 },
    { action: 'redeem', type: 'multi_purpose', code: 'dtd5 9ecf 5knz', amountCents: 100 },
  ], 'standard', { voucherInfo: info }), 'voucher_invalid');
  wirft(() => receiptDueCents([...items, pos('Gutschein', -100, 20, { kind: 'voucher' })], [
    { action: 'redeem', type: 'multi_purpose', code: CODE_M, amountCents: 100 },
  ], 'standard', { voucherInfo: info }), 'voucher_invalid');
});

test('Gelesener Beleg der neuen Form: Positionen tragen das Geld, nur Mehrzweck ohne 0-%-Topf fliesst', () => {
  // So steht der Einzweck-Einloesebeleg im Vertrag (antworten/belege.json, redeem_single_purpose_voucher).
  const items = [pos('Kaffee', 320, 20, { quantity: 2 }), pos('Gutschein ····-5KN2', -300, 20, { kind: 'voucher' })];
  const v: Voucher[] = [{ action: 'redeem', type: 'single_purpose', voucherType: 'single_purpose', amountCents: 300, vatRateBp: 2000, codeSuffix: '5KN2', voucherId: 'gez1' }];
  assert.equal(receiptDueCents(items, v, 'standard'), 340);
  const auszahlung: Voucher[] = [{ action: 'payout', type: 'value', voucherType: 'multi_purpose', valueCents: 3000, codeSuffix: '8CN5', voucherId: 'gmz2', zeroRateBucket: true }];
  assert.equal(receiptDueCents([pos('Auszahlung Gutschein ····-8CN5', -3000, 0, { kind: 'voucher_float' })], auszahlung, 'standard'), -3000);
});

// --- Vorbelegung an der Kasse ---------------------------------------------------------

test('Einzweck 20 % deckt nur Positionen seines Satzes, hoechstens den Saldo', () => {
  const items = [pos('Maniküre', 3500, 20), pos('Shampoo', 1200, 10)];
  assert.equal(voucherRedeemMaxCents(items, { type: 'single_purpose', status: 'active', codeSuffix: '9DWT', balanceCents: 5000, vatRateBp: 2000 }), 3500);
  assert.equal(voucherRedeemMaxCents(items, { type: 'single_purpose', status: 'active', codeSuffix: '9DWT', balanceCents: 1950, vatRateBp: 2000 }), 1950);
  assert.equal(voucherRedeemMaxCents(items, { type: 'single_purpose', status: 'active', codeSuffix: '9DWT', balanceCents: 5000, vatRateBp: 1300 }), 0);
});

test('Vorbelegung: Mehrzweck hoechstens der offene Betrag, Leistung und Aktion kein Betrag, nie negativ', () => {
  const items = [pos('Blumenstrauß', 2240, 20)];
  assert.equal(voucherRedeemMaxCents(items, mehrzweck(5000)), 2240);
  assert.equal(voucherRedeemMaxCents(items, mehrzweck(1000)), 1000);
  assert.equal(voucherRedeemMaxCents(items, mehrzweck(5000, 'expired')), 0);
  assert.equal(voucherRedeemMaxCents(items, leistung(3)), 0);
  assert.equal(voucherRedeemMaxCents(items, { type: 'promotion', status: 'active', codeSuffix: '5KNJ', discountCents: 500 }), 0);
  assert.equal(voucherRedeemMaxCents([], mehrzweck(5000)), 0);
  assert.equal(voucherRedeemMaxCents([pos('Rabatt', -500, 20)], mehrzweck(5000)), 0);
});

test('Vorbelegung an halben Cent: 1478 x 0,25 zu 4,9 % deckt 369, nicht 370 (der Topf liefe auf -1 Cent)', () => {
  const items = [pos('Brot', 1478, 4.9, { quantity: 0.25 })];
  const check = einzweck(5000, 490);
  assert.equal(voucherRedeemMaxCents(items, check), 369);
  const mit = (cents: number) => receiptDueCents(items, [{ action: 'redeem', type: 'single_purpose', code: CODE_E, amountCents: cents }], 'standard', { voucherInfo: [{ code: CODE_E, check }] });
  assert.equal(mit(369), 0);
  wirft(() => mit(370), 'voucher_exceeds_total');
});

test('Vorbelegung Kleinunternehmer: Summe je Satz (kuTeile), nicht die Summe ueber den Korb', () => {
  // 2931 x 0,25 zu 4,9 % = 732,75 -> 733; 443 x 0,25 zu 20 % = 110,75 -> 111; Korb 843, je Satz 844 (Server-Hoechstbetrag).
  const items = [pos('Brot', 2931, 4.9, { quantity: 0.25 }), pos('Kaffee', 443, 20, { quantity: 0.25 })];
  const check = einzweck(100000, 2000);
  assert.equal(voucherRedeemMaxCents(items, check, { options: { smallBusiness: true } }), 844);
  assert.equal(voucherRedeemMaxCents(items, { ...check, exempt: true }), 844);
  const mit = (cents: number) => receiptDueCents(items, [{ action: 'redeem', type: 'single_purpose', code: CODE_E, amountCents: cents }], 'standard', { voucherInfo: [{ code: CODE_E, check }], smallBusiness: true });
  assert.equal(mit(844), 0);
  wirft(() => mit(845));
});

// Erwartete Hoechstbetraege mit dem Server-Code (gutschein-beleg.plane) durch Abzaehlen aller Betraege ermittelt.
const befreit = (): VoucherCheck => ({ ...einzweck(1000000, 0), exempt: true });

test('Vorbelegung befreit neben einem schon gewaehlten Einzweck: Anteil je Topf plus Vorgaenger (Server 3357, nicht 0)', () => {
  // 3500 zu 20 %, 1200 zu 10 %; schon gewaehlt 1000 Einzweck 20 %. Der 20-%-Anteil 3500/4700 * c plus 1000 darf 3500 nicht uebersteigen.
  const items = [pos('Maniküre', 3500, 20), pos('Shampoo', 1200, 10)];
  const vorher: Voucher[] = [{ action: 'redeem', type: 'single_purpose', code: CODE_E, amountCents: 1000 }];
  const options: ReceiptDueOptions = { voucherInfo: [{ code: CODE_E, check: einzweck(1000000, 2000) }] };
  assert.equal(voucherRedeemMaxCents(items, befreit(), { vouchers: vorher, options }), 3357);
  // Als Kleinunternehmer verteilt sich auch der schon gewaehlte Gutschein anteilig: dann begrenzt nur der offene Betrag (Server 3700).
  assert.equal(voucherRedeemMaxCents(items, einzweck(1000000, 2000), { vouchers: vorher, options: { ...options, smallBusiness: true } }), 3700);
  const mit = (cents: number) => receiptDueCents(items, [...vorher, { action: 'redeem', type: 'single_purpose', code: CODE_M, amountCents: cents }], 'standard',
    { voucherInfo: [...options.voucherInfo!, { code: CODE_M, check: befreit() }] });
  assert.equal(mit(3357), 343);
  wirft(() => mit(3358), 'voucher_rate_mismatch');
});

test('Vorbelegung: mehr als 64 Cent unter der Grenze findet die Bisektion den Hoechstbetrag (Server 67)', () => {
  // 20000 zu 20 %, je 100 zu 19 % und 4,9 %; der Topf Besonders ist durch 200 Einzweck 19 % voll. Angenommen wird
  // nur, solange kein Cent dorthin faellt: bis 67 (danach erhalten 19 % und 4,9 % den groessten Rest). Grenze 202.
  const items = [pos('Ware', 20000, 20), pos('Wein', 100, 19), pos('Brot', 100, 4.9)];
  const vorher: Voucher[] = [{ action: 'redeem', type: 'single_purpose', code: CODE_E, amountCents: 200 }];
  const options: ReceiptDueOptions = { voucherInfo: [{ code: CODE_E, check: einzweck(1000000, 1900) }] };
  assert.equal(voucherRedeemMaxCents(items, befreit(), { vouchers: vorher, options }), 67);
});

test('kuTeile: gleicher Rest in zwei Saetzen, der Cent geht an den Topf in fester Reihenfolge (20 % vor 10 %)', () => {
  const items = [pos('Kaffee', 100, 20), pos('Semmel', 100, 10)];
  const v: Voucher[] = [{ action: 'redeem', type: 'single_purpose', code: CODE_E, amountCents: 1 }];
  assert.deepEqual(receiptDueBreakdown(items, v, 'standard', { voucherInfo: [{ code: CODE_E, check: befreit() }] }).bucketsCents,
    toepfe({ amountRateStandard: 99, amountRateReduced1: 100 }));
});

test('Vorbelegung mit schon gewaehlten Gutscheinen: der Rest des Topfs und des Betrags', () => {
  const items = [pos('Maniküre', 3500, 20), pos('Shampoo', 1200, 10)];
  const vorher: Voucher[] = [{ action: 'redeem', type: 'single_purpose', code: CODE_E, amountCents: 3000 }];
  const o: ReceiptDueOptions = { voucherInfo: [{ code: CODE_E, check: einzweck(5000, 2000) }] };
  assert.equal(voucherRedeemMaxCents(items, einzweck(5000, 2000), { vouchers: vorher, options: o }), 500);
  assert.equal(voucherRedeemMaxCents(items, mehrzweck(5000), { vouchers: vorher, options: o }), 1700);
});

// --- Trinkgeld: ein Gutschein deckt es nie (gutschein-beleg.plane) ------------------------

const PERSONAL: ReceiptDueOptions = { tip: 200, tipRecipient: 'staff' };
const INHABER: ReceiptDueOptions = { tip: 200, tipRecipient: 'owner' };

test('Trinkgeld: Einloesung bis Ware, nie in das Trinkgeld (Personal wie Inhaber, auch Grenzwerte 2001 und 2100)', () => {
  const items = [pos('Maniküre', 2000, 20)];
  const mit = (cents: number, options: ReceiptDueOptions) => receiptDueCents(items, [{ action: 'redeem', type: 'multi_purpose', code: CODE_M, amountCents: cents }], 'standard',
    { ...options, voucherInfo: [{ code: CODE_M, check: mehrzweck(5000) }] });
  for (const options of [PERSONAL, INHABER, { tip: { cents: 200, recipients: [{ cents: 120, owner: true }, { cents: 80, owner: false }] } }]) {
    assert.equal(mit(2000, options), 200);
    for (const zuViel of [2001, 2100, 2199, 2200]) wirft(() => mit(zuViel, options), 'voucher_exceeds_total');
  }
  // Trinkgeld ueber die Zahlung (payments[].tipCents) zaehlt genauso.
  const ueberZahlung: ReceiptDueOptions = { payments: [{ method: 'creditCard', tipCents: 200 }], tipRecipient: 'staff' };
  assert.equal(mit(2000, ueberZahlung), 200);
  wirft(() => mit(2001, ueberZahlung), 'voucher_exceeds_total');
});

test('Trinkgeld: ohne Gutschein der neuen Form bleibt alles wie bisher (Storno, Altform-Rabatt)', () => {
  const items = [pos('Maniküre', 2000, 20)];
  assert.equal(receiptDueCents(items, [], 'standard', PERSONAL), 2200);
  // Altform-Rabatt verteilt sich auch auf das Inhaber-Trinkgeld; ohne Plan prueft der Server das nicht.
  assert.equal(receiptDueCents(items, [{ action: 'redeem', type: 'promo', valueCents: 2200 }], 'standard', INHABER), 0);
  assert.equal(receiptDueCents([pos('Maniküre', -2000, 20)], [], 'cancellation'), -2000);
});

test('Trinkgeld: Aktionsgutschein mindert nur die Ware, das Trinkgeld bleibt zu zahlen', () => {
  const items = [pos('Maniküre', 2000, 20)];
  const check: VoucherCheck = { type: 'promotion', status: 'active', codeSuffix: '5KNJ', discountCents: 10000 };
  for (const options of [PERSONAL, INHABER]) {
    assert.equal(receiptDueCents(items, [{ action: 'redeem', type: 'promotion', code: CODE_A }], 'standard', { ...options, voucherInfo: [{ code: CODE_A, check }] }), 200);
  }
});

test('Vorbelegung mit Trinkgeld: Mehrzweck hoechstens der offene Betrag ohne Trinkgeld (Personal und Inhaber)', () => {
  const items = [pos('Maniküre', 2000, 20)];
  assert.equal(voucherRedeemMaxCents(items, mehrzweck(5000), { options: PERSONAL }), 2000);
  assert.equal(voucherRedeemMaxCents(items, mehrzweck(5000), { options: INHABER }), 2000);
  assert.equal(voucherRedeemMaxCents(items, mehrzweck(5000), { options: { payments: [{ method: 'cash', tipCents: 200 }], tipRecipient: 'staff' } }), 2000);
  // Der Saldo begrenzt weiter.
  assert.equal(voucherRedeemMaxCents(items, mehrzweck(1500), { options: PERSONAL }), 1500);
  // Schon gewaehlte Einloesung: der Rest der Ware, nie das Trinkgeld.
  const vorher: Voucher[] = [{ action: 'redeem', type: 'multi_purpose', code: CODE_P, amountCents: 1200 }];
  const o: ReceiptDueOptions = { ...INHABER, voucherInfo: [{ code: CODE_P, check: mehrzweck(5000) }] };
  assert.equal(voucherRedeemMaxCents(items, mehrzweck(5000), { vouchers: vorher, options: o }), 800);
});

test('Vorbelegung mit Trinkgeld: Einzweck, der nur Ware deckt, bekommt die Ware (nicht 0)', () => {
  const items = [pos('Maniküre', 2000, 20)];
  assert.equal(voucherRedeemMaxCents(items, einzweck(5000, 2000), { options: PERSONAL }), 2000);
  assert.equal(voucherRedeemMaxCents(items, einzweck(5000, 2000), { options: INHABER }), 2000);
  // Zwei Saetze: Einzweck 10 % deckt nur seinen Topf, das Trinkgeld begrenzt hier nicht.
  const zwei = [pos('Maniküre', 2000, 20), pos('Shampoo', 1200, 10)];
  assert.equal(voucherRedeemMaxCents(zwei, einzweck(5000, 1000), { options: INHABER }), 1200);
});

test('Vorbelegung mit Trinkgeld und Rabatt bzw. Altform-Aktion: Deckel nach dem Abzug, nie negativ', () => {
  const items = [pos('Maniküre', 2000, 20)];
  const rabatt = pos('Rabatt', -500, 20, { kind: 'discount' });
  assert.equal(voucherRedeemMaxCents([...items, rabatt], mehrzweck(5000), { options: PERSONAL }), 1500);
  assert.equal(voucherRedeemMaxCents([...items, rabatt], mehrzweck(5000), { options: INHABER }), 1500);
  assert.equal(voucherRedeemMaxCents([...items, rabatt], einzweck(5000, 2000), { options: PERSONAL }), 1500);
  const promo = (cents: number): Voucher[] => [{ action: 'redeem', type: 'promo', valueCents: cents }];
  assert.equal(voucherRedeemMaxCents(items, mehrzweck(5000), { vouchers: promo(500), options: PERSONAL }), 1500);
  assert.equal(voucherRedeemMaxCents(items, mehrzweck(5000), { vouchers: promo(500), options: INHABER }), 1500);
  // Rabatt in Hoehe der Ware: nur noch das Trinkgeld offen, also 0 (nie negativ).
  assert.equal(voucherRedeemMaxCents(items, mehrzweck(5000), { vouchers: promo(2000), options: PERSONAL }), 0);
  assert.equal(voucherRedeemMaxCents(items, mehrzweck(5000), { vouchers: promo(2200), options: INHABER }), 0);
  assert.equal(voucherRedeemMaxCents(items, einzweck(5000, 2000), { vouchers: promo(2200), options: INHABER }), 0);
});

test('Vorbelegung wirft nie: nicht rechenbarer Beleg (Trinkgeld ohne Ware) ergibt 0', () => {
  assert.equal(voucherRedeemMaxCents([pos('Gratisprobe', 0, 20)], mehrzweck(5000), { options: PERSONAL }), 0);
  assert.equal(voucherRedeemMaxCents([pos('Gratisprobe', 0, 20)], einzweck(5000, 2000), { options: INHABER }), 0);
  assert.equal(voucherRedeemMaxCents([], mehrzweck(5000), { options: PERSONAL }), 0);
  // Ohne Empfaenger (tip_recipient_missing) ebenso.
  assert.equal(voucherRedeemMaxCents([pos('Maniküre', 2000, 20)], mehrzweck(5000), { options: { tip: 200 } }), 0);
  // Schon gewaehlte Gutscheine decken das Trinkgeld bereits: 0 statt Wurf.
  const vorher: Voucher[] = [{ action: 'redeem', type: 'multi_purpose', code: CODE_P, amountCents: 2100 }];
  assert.equal(voucherRedeemMaxCents([pos('Maniküre', 2000, 20)], mehrzweck(5000), { vouchers: vorher, options: { ...PERSONAL, voucherInfo: [{ code: CODE_P, check: mehrzweck(5000) }] } }), 0);
});

// --- Auszahlung: Zahlungen ------------------------------------------------------------

test('Beleg nur aus einer Auszahlung: genau eine negative Barzahlung ueber den Zahlbetrag', () => {
  const vouchers: Voucher[] = [{ action: 'payout', type: 'multi_purpose', code: CODE_P, amountCents: 3000, reason: 'Kunde zieht weg' }];
  const params = createReceiptParams({ receiptType: 'standard', items: [], vouchers, payments: [{ method: 'cash', amountCents: -3000 }] });
  assert.deepEqual(params['payments'], [{ method: 'cash', amountCents: -3000 }]);
  const falsch = (payments: unknown) => assert.throws(
    () => createReceiptParams({ receiptType: 'standard', items: [], vouchers, payments: payments as never }),
    (e: unknown) => isKasseneckValidationError(e),
  );
  falsch([{ method: 'cash', amountCents: 3000 }]);
  falsch([{ method: 'creditCard', amountCents: -3000, provider: 'custom' }]);
  falsch([{ method: 'cash', amountCents: -1000 }, { method: 'cash', amountCents: -2000 }]);
  falsch([{ method: 'cash', amountCents: -3000, tenderedCents: 0 }]);
  falsch([{ method: 'cash', amountCents: -3000, tipCents: 100 }]);
  // Mit Trinkgeld ist es keine reine Auszahlung mehr (der Server haengt die Trinkgeldzeile an).
  assert.throws(() => createReceiptParams({ receiptType: 'standard', items: [], vouchers, tip: 100, payments: [{ method: 'cash', amountCents: -3000 }] }), (e: unknown) => isKasseneckValidationError(e));
  // Mit Ware ist es ein gewoehnlicher Verkauf: Zahlungen positiv.
  assert.throws(() => createReceiptParams({
    receiptType: 'standard', items: [pos('Kaffee', 320, 20)], vouchers, payments: [{ method: 'cash', amountCents: -2680 }],
  }), (e: unknown) => isKasseneckValidationError(e));
});

test('Wurzel exportiert die Gutschein-Teile des Zahlbetrags', () => {
  assert.equal(wurzel.voucherRedeemMaxCents, voucherRedeemMaxCents);
  assert.equal(wurzel.VOUCHER_ZERO_RATE_BUCKET_FROM, '2099-12-31');
});

// --- Generierte Faelle (echter Backend-Code, scripts/v3-zahlbetrag-gutscheine-generieren.mjs) ---

interface GenFall {
  name: string;
  input: ReceiptDueOptions & {
    receiptType: string;
    items: Array<{ name: string; quantity: number; priceCents: number; vatRate: number; kind?: 'discount'; articleId?: string }>;
    vouchers: VoucherPayload[];
    today: string;
  };
  expected: { dueCents: number; counterDeltaCents: number; valueVoucherFlowCents: number; bucketsCents: Record<string, number> } | { voucherError: string } | { error: string };
}
const GENERIERT = (JSON.parse(readFileSync(fileURLToPath(new URL('../../fixtures/receipt-due-voucher-generated.json', import.meta.url)), 'utf8')) as { cases: GenFall[] }).cases;

test('Generierte Gutscheinfaelle: genug und von jeder Art (Bruchmengen, Trinkgeld, Kleinunternehmer, befreit, Stichtag, Abweisungen)', () => {
  const c = GENERIERT;
  assert.ok(c.length >= 400, `nur ${c.length}`);
  assert.ok(c.filter((f) => f.input.items.some((p) => !Number.isInteger(p.quantity))).length >= 150);
  assert.ok(c.filter((f) => f.input.tip != null).length >= 50);
  assert.ok(c.filter((f) => f.input.smallBusiness === true).length >= 50);
  assert.ok(c.filter((f) => f.input.voucherInfo?.some((i) => i.check.exempt === true)).length >= 20);
  assert.ok(c.filter((f) => f.input.today >= VOUCHER_ZERO_RATE_BUCKET_FROM).length >= 100);
  for (const art of ['multi_purpose', 'single_purpose', 'service', 'promotion']) {
    assert.ok(c.some((f) => f.input.vouchers.some((v) => v.type === art && v.action === 'redeem') && 'dueCents' in f.expected), art);
  }
  for (const a of ['sell', 'payout']) assert.ok(c.some((f) => f.input.vouchers.some((v) => v.action === a) && 'dueCents' in f.expected), a);
  for (const code of ['voucher_rate_mismatch', 'voucher_exceeds_total', 'voucher_insufficient_balance', 'voucher_item_mismatch', 'voucher_settings_missing']) {
    assert.ok(c.some((f) => 'voucherError' in f.expected && f.expected.voucherError === code), code);
  }
});

test('Generierte Gutscheinfaelle: jeder stimmt exakt mit dem Backend (Betrag, Toepfe, Fluss bzw. Abweisungscode)', () => {
  const abweichend: string[] = [];
  for (const f of GENERIERT) {
    const { receiptType, items, vouchers, ...optionen } = f.input;
    const positionen: ReceiptItem[] = items.map((p) => ({ name: p.name, quantity: p.quantity, priceCents: p.priceCents, vat: p.vatRate, ...(p.kind ? { kind: p.kind } : {}), ...(p.articleId ? { articleId: p.articleId } : {}) }));
    const wuensche = vouchers.map((v) => fromVoucherPayload(v));
    let ist: unknown;
    try {
      ist = receiptDueBreakdown(positionen, wuensche, receiptType, { ...optionen, tipRecipient: optionen.tipRecipient });
    } catch (e) {
      ist = e instanceof ReceiptDueError ? (e.voucherErrorCode ? { voucherError: e.voucherErrorCode } : { error: e.reason }) : { error: String(e) };
    }
    const soll = 'error' in f.expected ? { error: 'tip_without_goods' } : f.expected;
    if (JSON.stringify(ist) !== JSON.stringify(soll)) abweichend.push(`${f.name}: ${JSON.stringify(ist)} statt ${JSON.stringify(soll)}`);
  }
  assert.deepEqual(abweichend.slice(0, 5), []);
});
