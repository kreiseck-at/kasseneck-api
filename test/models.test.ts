import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VatRate, ReceiptType, KeckPaymentMethod, CreditCardProvider, VoucherType, VoucherAction } from '../src/enums/index.js';
import {
  type ReceiptItem,
  toReceiptItemPayload,
  fromReceiptItemPayload,
  receiptItemTotalCents,
} from '../src/models/receipt-item.js';
import { type Voucher, toVoucherPayload, fromVoucherPayload } from '../src/models/voucher.js';
import {
  type Receipt,
  toReceiptPayload,
  fromReceiptPayload,
  receiptSubSumCents,
  receiptSumCents,
} from '../src/models/receipt.js';
import { type Cashregister, toCashregisterPayload, fromCashregisterPayload } from '../src/models/cashregister.js';
import {
  type ReportMonth,
  previousReportMonth,
  nextReportMonth,
  reportMonthKey,
  reportMonthReadable,
  reportMonthFromDate,
} from '../src/models/report-month.js';
import {
  type StripeUrlSession,
  toStripeUrlSessionPayload,
  fromStripeUrlSessionPayload,
} from '../src/models/stripe-url-session.js';
import {
  type HobexReceipt,
  toHobexReceiptPayload,
  fromHobexReceiptPayload,
  hobexReceiptToCardPaymentData,
  hobexReceiptNeedsSignature,
} from '../src/models/hobex-receipt.js';

// --- Belegposition -----------------------------------------------------

test('Belegposition: Nutzlast hin und zurueck ergibt denselben Wert', () => {
  const item: ReceiptItem = { name: 'Espresso', quantity: 2, vat: VatRate.vat10, priceCents: 250 };
  const payload = toReceiptItemPayload(item);
  assert.deepEqual(payload, { name: 'Espresso', quantity: 2, unitPriceCents: 250, vatRate: 10 });
  assert.deepEqual(fromReceiptItemPayload(payload), item);
});

test('Belegposition: Betraege bleiben ganzzahlig ueber drei krumme Positionen', () => {
  const items: ReceiptItem[] = [
    { name: 'A', quantity: 1, vat: VatRate.vat20, priceCents: 29 },
    { name: 'B', quantity: 1, vat: VatRate.vat20, priceCents: 29 },
    { name: 'C', quantity: 1, vat: VatRate.vat20, priceCents: 29 },
  ];
  const summe = items.reduce((acc, item) => acc + receiptItemTotalCents(item), 0);
  // 3 * 29 Cent = 87 Cent exakt (Integer-Addition). Mit Euro-Gleitkomma
  // (0.29 + 0.29 + 0.29) landet man dagegen bei 0.8699999999999999 statt
  // 0.87 — genau der Rundungsfehler, den Cent-Integer-Arithmetik vermeidet.
  assert.equal(summe, 87);
  assert.notEqual(0.29 + 0.29 + 0.29, 0.87);
});

test('Belegposition: unbekannter Steuersatz aus der Nutzlast wird erkannt statt still zu undefined', () => {
  const bogus = { name: 'X', quantity: 1, unitPriceCents: 100, vatRate: 999 };
  assert.throws(() => fromReceiptItemPayload(bogus), /Steuersatz/);
});

// --- Gutschein -----------------------------------------------------------

test('Gutschein: Nutzlast hin und zurueck ergibt denselben Wert', () => {
  const voucher: Voucher = { name: 'Weihnachten', code: 'XMAS', action: VoucherAction.sell, type: VoucherType.value, valueCents: 550 };
  const payload = toVoucherPayload(voucher);
  assert.equal(payload.value, 5.5);
  assert.equal(payload.valueCents, 550);
  assert.deepEqual(fromVoucherPayload(payload), voucher);
});

test('Gutschein: Wert ohne valueCents faellt exakt auf Euro-Rundung zurueck', () => {
  const payload = { name: null, code: null, action: 'redeem', type: 'promo', value: 5, valueCents: null };
  const voucher = fromVoucherPayload(payload);
  assert.equal(voucher.valueCents, 500);
});

test('Gutschein: unbekannte Aktion aus der Nutzlast wird erkannt statt still zu undefined', () => {
  const bogus = { name: null, code: null, action: 'teleport', type: 'promo', value: null, valueCents: null };
  assert.throws(() => fromVoucherPayload(bogus), /Aktion/);
});

// --- Beleg -----------------------------------------------------------------

function baueBeleg(items: ReceiptItem[], vouchers: Voucher[] = []): Receipt {
  return {
    receiptId: 'r1',
    cashregisterId: 'cr1',
    timeStamp: '2026-08-13T10:00:00.000Z',
    items,
    vouchers,
    paymentMethod: KeckPaymentMethod.cash,
    turnoverCounterAES256ICM: 'aes',
    signaturePreviousReceipt: 'sig-prev',
    certificateSerialNumber: 'cert-123',
    receiptType: ReceiptType.standard,
    sig: 'sig',
    qr: 'qr-data',
    fullReceiptId: 'AT1-r1',
    customerDetails: ['Zeile 1', 'Zeile 2'],
    legalMessage: ['Beleg gemaess RKSV'],
    // fromReceiptPayload traegt fehlende optionale Felder explizit als
    // `undefined` ein (nicht als fehlender Schluessel) — hier ebenso, damit
    // der Rundtrip-Vergleich dieselbe Objektform hat.
    creditCardProvider: undefined,
    cardPaymentId: undefined,
    cardPaymentData: undefined,
    signatureSuccess: undefined,
    customProjectId: undefined,
  };
}

test('Beleg: Nutzlast hin und zurueck ergibt denselben Wert', () => {
  const beleg = baueBeleg([{ name: 'Kaffee', quantity: 1, vat: VatRate.vat10, priceCents: 350 }]);
  const payload = toReceiptPayload(beleg);
  assert.equal(payload.customerDetails, 'Zeile 1\nZeile 2');
  assert.deepEqual(fromReceiptPayload(payload), beleg);
});

test('Beleg mit allen Steuersaetzen behaelt seine Summen nach der Nutzlast-Runde', () => {
  const items: ReceiptItem[] = Object.values(VatRate).map((vat, i) => ({
    name: `Position ${i}`,
    quantity: 1,
    vat,
    priceCents: 100 + i,
  }));
  const beleg = baueBeleg(items);
  const erwarteteSumme = items.reduce((acc, item) => acc + receiptItemTotalCents(item), 0);
  assert.equal(receiptSubSumCents(beleg), erwarteteSumme);
  assert.equal(receiptSumCents(beleg), erwarteteSumme);

  const rundtrip = fromReceiptPayload(toReceiptPayload(beleg));
  assert.equal(receiptSumCents(rundtrip), erwarteteSumme);
});

test('Beleg: eingeloester Wertgutschein senkt die Gesamtsumme, nicht die Zwischensumme', () => {
  const beleg = baueBeleg(
    [{ name: 'Kaffee', quantity: 1, vat: VatRate.vat10, priceCents: 350 }],
    [{ name: null as unknown as string, code: null as unknown as string, action: VoucherAction.redeem, type: VoucherType.value, valueCents: 100 }],
  );
  assert.equal(receiptSubSumCents(beleg), 350);
  assert.equal(receiptSumCents(beleg), 250);
});

test('Beleg: unbekannter Belegtyp aus der Nutzlast wird erkannt statt still zu undefined', () => {
  const beleg = baueBeleg([{ name: 'Kaffee', quantity: 1, vat: VatRate.vat10, priceCents: 350 }]);
  const payload = { ...toReceiptPayload(beleg), receiptType: 'unbekannt' };
  assert.throws(() => fromReceiptPayload(payload), /Belegtyp/);
});

// --- Kasse -----------------------------------------------------------------

test('Kasse: Nutzlast hin und zurueck ergibt denselben Wert', () => {
  const kasse: Cashregister = {
    userId: 'u1',
    id: 'cr1',
    createTime: new Date('2026-01-05T09:00:00.000Z'),
    token: 'tok',
    aesKey: 'aes-key',
    signatureId: 'sig1',
  };
  const payload = toCashregisterPayload(kasse);
  assert.equal(payload.create_time, '2026-01-05T09:00:00.000Z');
  assert.deepEqual(fromCashregisterPayload(payload, kasse.id, kasse.userId), kasse);
});

test('Kasse: fehlende signatureId bleibt nach der Nutzlast-Runde undefined', () => {
  const kasse: Cashregister = { userId: 'u1', id: 'cr1', createTime: new Date('2026-01-05T09:00:00.000Z'), token: 'tok', aesKey: 'aes-key' };
  const rundtrip = fromCashregisterPayload(toCashregisterPayload(kasse), kasse.id, kasse.userId);
  assert.equal(rundtrip.signatureId, undefined);
});

// --- Berichtsmonat -----------------------------------------------------------

test('Berichtsmonat: Jaenner rueckwaerts wechselt ins Vorjahr auf Dezember', () => {
  const jaenner: ReportMonth = { month: 1, year: 2026 };
  assert.deepEqual(previousReportMonth(jaenner), { month: 12, year: 2025 });
});

test('Berichtsmonat: Dezember vorwaerts wechselt ins Folgejahr auf Jaenner', () => {
  const dezember: ReportMonth = { month: 12, year: 2026 };
  assert.deepEqual(nextReportMonth(dezember), { month: 1, year: 2027 });
});

test('Berichtsmonat: Schluessel- und Lesbar-Format stimmen mit dem Flutter-Paket ueberein', () => {
  const rm: ReportMonth = { month: 3, year: 2026 };
  assert.equal(reportMonthKey(rm), 'march_2026');
  assert.equal(reportMonthReadable(rm), 'März 2026');
});

test('Berichtsmonat: aus Datum abgeleitet trifft Monat und Jahr', () => {
  assert.deepEqual(reportMonthFromDate(new Date(2026, 7, 13)), { month: 8, year: 2026 });
});

// --- Stripe-Sitzung ----------------------------------------------------------

test('Stripe-Sitzung: Nutzlast hin und zurueck ergibt denselben Wert', () => {
  const session: StripeUrlSession = {
    id: 'sess_1',
    url: 'https://checkout.stripe.com/pay/sess_1',
    shortenUrl: 'https://kasseneck.at/s/abc',
    expiresAt: new Date('2026-08-14T00:00:00.000Z'),
  };
  const payload = toStripeUrlSessionPayload(session);
  assert.deepEqual(payload, {
    id: 'sess_1',
    url: 'https://checkout.stripe.com/pay/sess_1',
    shorten_payment_url: 'https://kasseneck.at/s/abc',
    expires_at: '2026-08-14T00:00:00.000Z',
  });
  assert.deepEqual(fromStripeUrlSessionPayload(payload), session);
});

// --- Hobex-Beleg ---------------------------------------------------------------

test('Hobex-Beleg: Nutzlast hin und zurueck ergibt denselben Wert', () => {
  const beleg: HobexReceipt = {
    transactionId: 'tx1',
    tid: 't1',
    receipt: '000123',
    approvalCode: '00',
    reference: undefined,
    transactionDate: '2026-08-13 10:00:00',
    cardNumber: '****1234',
    cardExpiry: '12/28',
    brand: 'visa',
    cardIssuer: 'Bank',
    responseCode: '00',
    transactionType: 'purchase',
    currency: 'EUR',
    amountCents: 1999,
    tipCents: 150,
    cvm: '0',
    creditCardProvider: CreditCardProvider.hobexCloudApi,
  };
  const payload = toHobexReceiptPayload(beleg);
  assert.equal(payload.amount, 19.99);
  assert.equal(payload.tip, 1.5);
  assert.deepEqual(fromHobexReceiptPayload(payload), beleg);
});

test('Hobex-Beleg: Transaktionsdatum wird wie im Flutter-Paket normalisiert (Bruchteil + T entfernt)', () => {
  const payload = {
    transactionId: 'tx1',
    tid: 't1',
    receipt: '000123',
    approvalCode: '00',
    reference: null,
    transactionDate: '2026-08-13T10:00:00.123+02:00',
    cardNumber: '****1234',
    cardExpiry: '12/28',
    brand: 'visa',
    cardIssuer: 'Bank',
    responseCode: '00',
    transactionType: 'purchase',
    currency: 'EUR',
    amount: 19.99,
    tip: 0,
    cvm: 0,
  };
  const beleg = fromHobexReceiptPayload(payload);
  assert.equal(beleg.transactionDate, '2026-08-13 10:00:00');
  assert.equal(beleg.cvm, '0');
});

test('Hobex-Beleg: toCardPaymentData liefert die vom Beleg-Rendering erwarteten Schluessel', () => {
  const beleg: HobexReceipt = {
    transactionId: 'tx1',
    tid: 't1',
    receipt: '000123',
    approvalCode: '00',
    reference: undefined,
    transactionDate: '2026-08-13 10:00:00',
    cardNumber: '****1234',
    cardExpiry: '12/28',
    brand: 'visa',
    cardIssuer: 'Bank',
    responseCode: '00',
    transactionType: 'purchase',
    currency: 'EUR',
    amountCents: 1999,
    tipCents: 0,
    cvm: '1',
    creditCardProvider: CreditCardProvider.hobexCloudApi,
  };
  const data = hobexReceiptToCardPaymentData(beleg);
  assert.deepEqual(data, {
    transactionId: 'tx1',
    date: '2026-08-13 10:00:00',
    tid: 't1',
    no: '000123',
    type: 'purchase',
    cardBrand: 'visa',
    cardNumber: '****1234',
    responseCode: '00',
    cvm: '1',
  });
  assert.equal(hobexReceiptNeedsSignature(beleg), true);
});
