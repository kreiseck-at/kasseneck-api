import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sellReceipt, cancelReceipt, createReceipt, createCancelReceipt } from '../src/client/receipts.js';
import { createTransport, DEFAULT_BASE_URL, type FetchLike, type HttpRequestInit, type HttpResponseLike, type KasseneckTransport } from '../src/client/transport.js';
import { apiKeyAuth } from '../src/client/auth.js';
import { isKasseneckValidationError } from '../src/client/errors.js';
import { KeckPaymentMethod, CreditCardProvider, ReceiptType, VatRate, type KeckPaymentMethodKey } from '../src/enums/index.js';
import {
  fromReceiptPayload,
  toReceiptPayload,
  fromReceiptSummaryPayload,
  PAYMENT_ERROR_CODES,
  isPaymentErrorCode,
  type ReceiptPayload,
  type ReceiptPayloadRead,
  type ReceiptItem,
  type ReceiptPaymentInput,
} from '../src/models/index.js';
import * as wurzel from '../src/index.js';

/**
 * Mehrere Zahlungen je Beleg (`payments`) — Zwilling von
 * functions/gemeinsam/zahlungen-core.js und functions/zahlungs-eingang.js.
 * Die Feldnamen und Codes sind aus dem Backend abgeschrieben, nicht aus der
 * Umsetzung dieses Pakets abgeleitet.
 */

const KASSEN_ID = 'kasse-1';

const NUTZLAST: ReceiptPayload = {
  qr: '_R1-AT1_...',
  sig: 'SIGNATUR',
  certificateSerialNumber: '6F0404F0',
  signaturePreviousReceipt: 'VORGAENGER',
  turnoverCounterAES256ICM: 'ZAEHLER',
  paymentMethod: 'mixed',
  items: [{ name: 'Menue', quantity: 1, unitPriceCents: 4545, vatRate: 10 }],
  vouchers: null,
  timeStamp: '2026-09-25T12:00:00',
  cashregisterId: KASSEN_ID,
  receiptType: 'standard',
  receiptId: 'kasse-1-ID-40',
  fullReceiptId: 'ENC-FULL-40',
  creditCardProvider: null,
  cardPaymentId: null,
  cardPaymentData: null,
  customerDetails: '',
  legalMessage: '',
  signatureSuccess: true,
  customProjectId: null,
};

// Form wie im Backend gespeichert (pruefeZahlungen normalisiert: id p<n>,
// changeCents nur neben tenderedCents).
const ZAHLUNGEN = [
  { id: 'p1', method: 'creditCard', amountCents: 2000, provider: 'sumup', providerPaymentId: 'TX-81', providerData: { cardNumber: '541333******0021' } },
  { id: 'p2', method: 'cash', amountCents: 2545, tenderedCents: 3000, changeCents: 455 },
];

// --- Modell ---------------------------------------------------------------

test('fromReceiptPayload liest payments samt Anbieterdaten; mixed ist eine bekannte Zahlungsart', () => {
  const beleg = fromReceiptPayload({ ...NUTZLAST, payments: ZAHLUNGEN } as ReceiptPayloadRead);
  assert.equal(beleg.paymentMethod, KeckPaymentMethod.mixed);
  assert.deepEqual(beleg.payments, [
    { id: 'p1', method: KeckPaymentMethod.creditCard, amountCents: 2000, provider: CreditCardProvider.sumup, providerPaymentId: 'TX-81', providerData: { cardNumber: '541333******0021' } },
    { id: 'p2', method: KeckPaymentMethod.cash, amountCents: 2545, tenderedCents: 3000, changeCents: 455 },
  ]);
});

test('Rundreise mit payments: toReceiptPayload schreibt dieselbe Liste zurueck', () => {
  const beleg = fromReceiptPayload({ ...NUTZLAST, payments: ZAHLUNGEN } as ReceiptPayloadRead);
  const zurueck = toReceiptPayload(beleg);
  assert.equal(zurueck.paymentMethod, 'mixed');
  assert.deepEqual(zurueck.payments, ZAHLUNGEN);
});

test('Storno-Rueckzahlung behaelt refundOf und das negative Vorzeichen', () => {
  const beleg = fromReceiptPayload({
    ...NUTZLAST,
    receiptType: 'cancellation',
    payments: [{ id: 'p1', method: 'creditCard', amountCents: -2000, refundOf: 'p1' }],
  } as ReceiptPayloadRead);
  assert.deepEqual(beleg.payments, [{ id: 'p1', method: KeckPaymentMethod.creditCard, amountCents: -2000, refundOf: 'p1' }]);
});

test('Unbekannte Zahlungsart oder unbekannter Anbieter in payments bleiben roh lesbar', () => {
  const beleg = fromReceiptPayload({
    ...NUTZLAST,
    payments: [{ id: 'p1', method: 'kryptoWallet', amountCents: 4545, provider: 'neuerAnbieter' }],
  } as unknown as ReceiptPayloadRead);
  assert.deepEqual(beleg.payments, [{ id: 'p1', method: 'kryptoWallet', amountCents: 4545, provider: 'neuerAnbieter' }]);
});

test('Ohne payments: kein Feld am Beleg und keines in der Nutzlast (Altbelege byte-gleich)', () => {
  const beleg = fromReceiptPayload({ ...NUTZLAST, paymentMethod: 'cash' });
  assert.equal('payments' in beleg, false);
  const zurueck = toReceiptPayload(beleg);
  assert.equal('payments' in zurueck, false);
  assert.equal(JSON.stringify(zurueck), JSON.stringify(toReceiptPayload(fromReceiptPayload({ ...NUTZLAST, paymentMethod: 'cash' }))));
  // null (Firestore-Luecke) zaehlt wie fehlend.
  assert.equal('payments' in fromReceiptPayload({ ...NUTZLAST, payments: null } as ReceiptPayloadRead), false);
});

test('Belegliste liest die oeffentlichen Zahlungsfelder, ohne payments bleibt das Feld weg', () => {
  const zeile = fromReceiptSummaryPayload({
    receiptId: 'r-1',
    receiptType: 'standard',
    timeStamp: '2026-09-25T12:00:00',
    total: 45.45,
    paymentMethod: 'mixed',
    payments: [
      { id: 'p1', method: 'creditCard', amountCents: 2000, provider: 'sumup' },
      { id: 'p2', method: 'cash', amountCents: 2545, tenderedCents: 3000, changeCents: 455 },
    ],
  });
  assert.equal(zeile.paymentMethod, KeckPaymentMethod.mixed);
  assert.deepEqual(zeile.payments, [
    { id: 'p1', method: KeckPaymentMethod.creditCard, amountCents: 2000, provider: CreditCardProvider.sumup },
    { id: 'p2', method: KeckPaymentMethod.cash, amountCents: 2545, tenderedCents: 3000, changeCents: 455 },
  ]);
  const alt = fromReceiptSummaryPayload({ receiptId: 'r-2', receiptType: 'standard', total: 1, paymentMethod: 'cash' });
  assert.equal('payments' in alt, false);
});

// --- Enum -----------------------------------------------------------------

test('KeckPaymentMethod.mixed: keine Karte, Label wie paymentMethodToString im Backend', () => {
  assert.deepEqual(
    { value: KeckPaymentMethod.mixed.value, needsCreditCard: KeckPaymentMethod.mixed.needsCreditCard, label: KeckPaymentMethod.mixed.label },
    { value: 'mixed', needsCreditCard: false, label: 'Mehrere Zahlungsarten' },
  );
});

// --- Fehlercodes ----------------------------------------------------------

test('PAYMENT_ERROR_CODES: exakt ZAHLUNGS_FEHLERCODES des Backends, gleiche Reihenfolge', () => {
  assert.deepEqual([...PAYMENT_ERROR_CODES], [
    'PAYMENTS_INVALID',
    'PAYMENT_METHOD_INVALID',
    'PAYMENT_AMOUNT_INVALID',
    'PAYMENT_TENDERED_INVALID',
    'PAYMENT_PROVIDER_INVALID',
    'PAYMENT_PROVIDER_NOT_ALLOWED',
    'PAYMENTS_SUM_MISMATCH',
    'PAYMENTS_DUE_NEGATIVE',
    'PAYMENTS_NOT_ALLOWED',
    'PAYMENTS_CONFLICT',
    'PAYMENTS_REQUIRED',
    'PAYMENT_METHOD_NOT_SUPPORTED',
    'TIP_PAYMENT_METHOD_INVALID',
    'TIP_PAYMENT_METHOD_REQUIRED',
    'TIP_EXCEEDS_PAYMENT',
    'PAYMENT_REFUND_NOT_ALLOWED',
  ]);
  assert.equal(Object.isFrozen(PAYMENT_ERROR_CODES), true);
});

test('isPaymentErrorCode: gross (/v1, intern) und klein (/v3) erkannt, Fremdes nicht', () => {
  assert.equal(isPaymentErrorCode('PAYMENTS_SUM_MISMATCH'), true);
  assert.equal(isPaymentErrorCode('payments_sum_mismatch'), true);
  assert.equal(isPaymentErrorCode('payments_not_allowed'), true);
  assert.equal(isPaymentErrorCode('bereits_storniert'), false);
  assert.equal(isPaymentErrorCode('Die Summe der Zahlungen entspricht nicht dem Zahlbetrag.'), false);
  assert.equal(isPaymentErrorCode(undefined), false);
  assert.equal(isPaymentErrorCode(7), false);
});

test('Paketwurzel exportiert Codes, Waechter und die Zahlungs-Typen', () => {
  assert.equal(wurzel.PAYMENT_ERROR_CODES, PAYMENT_ERROR_CODES);
  assert.equal(wurzel.isPaymentErrorCode, isPaymentErrorCode);
});

// --- Client ---------------------------------------------------------------

interface Aufruf {
  url: string;
  init: HttpRequestInit;
}

function weg(daten: unknown): { rufen: KasseneckTransport; aufrufe: Aufruf[] } {
  const aufrufe: Aufruf[] = [];
  const rumpf = JSON.stringify({ status: 'success', message: '', data: daten });
  const holen: FetchLike = async (url, init) => {
    aufrufe.push({ url, init });
    const antwort: HttpResponseLike = {
      status: 200,
      headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
      text: async () => rumpf,
      arrayBuffer: async () => new TextEncoder().encode(rumpf).buffer,
    };
    return antwort;
  };
  return { rufen: createTransport({ auth: apiKeyAuth({ apiKey: 'kr_live_X', cashregisterToken: 'cb_live_Y' }), fetch: holen }), aufrufe };
}

function gesendet(aufrufe: Aufruf[]): { endpunkt: string; params: Record<string, unknown> } {
  assert.equal(aufrufe.length, 1, 'genau ein Aufruf erwartet');
  const aufruf = aufrufe[0]!;
  return {
    endpunkt: aufruf.url.slice(DEFAULT_BASE_URL.length + 1),
    params: (JSON.parse(aufruf.init.body) as { params: Record<string, unknown> }).params,
  };
}

const MENUE: ReceiptItem = { name: 'Menue', quantity: 1, vat: VatRate.vat10, priceCents: 4545 };
const VERKAUF = { receipt: { ...NUTZLAST, payments: ZAHLUNGEN } };
const STORNO = {
  receipt: { ...NUTZLAST, receiptType: 'cancellation', receiptId: 'kasse-1-ID-41' },
  cancellationOf: { receiptId: 'kasse-1-ID-40', fullReceiptId: 'ENC-FULL-40' },
  remaining: [0],
};

test('sellReceipt mit payments: Liste geht in Backend-Form hinaus, kein paymentMethod', async () => {
  const { rufen, aufrufe } = weg(VERKAUF);
  const beleg = await sellReceipt(rufen, {
    items: [MENUE],
    payments: [
      { method: KeckPaymentMethod.creditCard, amountCents: 2000, provider: CreditCardProvider.sumup, providerPaymentId: 'TX-81', providerData: { cardNumber: '541333******0021' } },
      { method: 'cash', amountCents: 2545, tenderedCents: 3000 },
    ],
  });
  const { endpunkt, params } = gesendet(aufrufe);
  assert.equal(endpunkt, 'createReceipt');
  assert.deepEqual(params, {
    receiptType: 'standard',
    items: [{ name: 'Menue', quantity: 1, unitPriceCents: 4545, vatRate: 10 }],
    payments: [
      { method: 'creditCard', amountCents: 2000, provider: 'sumup', providerPaymentId: 'TX-81', providerData: { cardNumber: '541333******0021' } },
      { method: 'cash', amountCents: 2545, tenderedCents: 3000 },
    ],
  });
  assert.equal(beleg.payments?.length, 2);
});

test('createReceipt mit payments und Trinkgeld: tip.paymentMethod geht mit', async () => {
  const { rufen, aufrufe } = weg(VERKAUF);
  await createReceipt(rufen, {
    receiptType: ReceiptType.standard,
    items: [MENUE],
    payments: [{ method: 'cash', amountCents: 4745 }],
    tip: { cents: 200, paymentMethod: 'cash' },
  });
  const { params } = gesendet(aufrufe);
  assert.deepEqual(params.payments, [{ method: 'cash', amountCents: 4745 }]);
  assert.deepEqual(params.tip, { cents: 200, paymentMethod: 'cash' });
});

// PAYMENTS_CONFLICT im Backend (zahlungs-eingang.js): payments nie zusammen
// mit paymentMethod oder einem der drei Kartenfelder.
test('payments zusammen mit paymentMethod oder Kartenfeldern: Eingabefehler, nichts geht hinaus', async () => {
  const { rufen, aufrufe } = weg(VERKAUF);
  const zahlungen: ReceiptPaymentInput[] = [{ method: 'cash', amountCents: 4545 }];
  const faelle: Array<Record<string, unknown>> = [
    { paymentMethod: KeckPaymentMethod.cash },
    { paymentMethodFromServer: 'cash' },
    { creditCardProvider: CreditCardProvider.sumup },
    { cardPaymentId: 'TX-1' },
    { cardPaymentData: { a: 1 } },
  ];
  for (const zusatz of faelle) {
    await assert.rejects(
      () => createReceipt(rufen, { receiptType: ReceiptType.standard, items: [MENUE], payments: zahlungen, ...zusatz } as never),
      (fehler: unknown) => isKasseneckValidationError(fehler) && /payments/.test((fehler as Error).message),
      `Konflikt mit ${Object.keys(zusatz)[0]} nicht erkannt`,
    );
  }
  assert.equal(aufrufe.length, 0);
});

test('payments: Form wird vor dem Senden geprueft', async () => {
  const { rufen, aufrufe } = weg(VERKAUF);
  const falsch: Array<[unknown, RegExp]> = [
    ['keine Liste', /payments/],
    [[{ method: 'cash', amountCents: 12.5 }], /amountCents/],
    [[{ method: 'cash', amountCents: 0 }], /amountCents/],
    [[{ method: 'cash', amountCents: -100 }], /amountCents/],
    [[{ method: 'cash', amountCents: '4545' }], /amountCents/],
    [[{ method: 'cash', amountCents: 4545, tenderedCents: 50.5 }], /tenderedCents/],
    [[{ method: 'gibtsNicht', amountCents: 4545 }], /Zahlungsart/],
    [[{ method: 'mixed', amountCents: 4545 }], /mixed/],
    [[{ method: KeckPaymentMethod.mixed, amountCents: 4545 }], /mixed/],
    [[{ method: 'creditCard', amountCents: 4545, provider: 'gibtsNicht' }], /Kartenanbieter/],
    [[{ method: 'creditCard', amountCents: 4545, provider: 'sumup', providerPaymentId: 'x', providerData: ['a'] }], /providerData/],
    [[{ method: 'creditCard', amountCents: 4545, provider: 'sumup', providerPaymentId: 'x', providerData: null }], /providerData/],
    [[{ method: 'creditCard', amountCents: 4545, provider: 'sumup', providerPaymentId: '' }], /providerPaymentId/],
    [[{ method: 'cash', amountCents: 4545, refundOf: 'p1' }], /refundOf/],
    [[null], /Zahlung 1/],
  ];
  for (const [payments, muster] of falsch) {
    await assert.rejects(
      () => createReceipt(rufen, { receiptType: ReceiptType.standard, items: [MENUE], payments } as never),
      (fehler: unknown) => isKasseneckValidationError(fehler) && muster.test((fehler as Error).message),
      `nicht abgelehnt: ${JSON.stringify(payments)}`,
    );
  }
  await assert.rejects(
    () => createReceipt(rufen, { receiptType: ReceiptType.standard, items: [MENUE], payments: Array.from({ length: 21 }, () => ({ method: 'cash', amountCents: 1 })) } as never),
    /20/,
  );
  assert.equal(aufrufe.length, 0);
});

test('payments am alten Storno-Weg und am Nullbeleg werden abgewiesen (PAYMENTS_NOT_ALLOWED im Backend)', async () => {
  const { rufen, aufrufe } = weg(VERKAUF);
  await assert.rejects(
    () => createCancelReceipt(rufen, { items: [MENUE], payments: [{ method: 'cash', amountCents: -4545 }] } as never),
    /cancelReceipt/,
  );
  await assert.rejects(
    () => createReceipt(rufen, { receiptType: ReceiptType.zero, payments: [{ method: 'cash', amountCents: 1 }] }),
    /payments/,
  );
  assert.equal(aufrufe.length, 0);
});

test('Senden mit paymentMethod mixed wird abgelehnt, auch am Trinkgeld', async () => {
  const { rufen, aufrufe } = weg(VERKAUF);
  await assert.rejects(() => sellReceipt(rufen, { paymentMethod: KeckPaymentMethod.mixed, items: [MENUE] }), /mixed/);
  await assert.rejects(() => sellReceipt(rufen, { paymentMethod: 'mixed', items: [MENUE] }), /mixed/);
  await assert.rejects(
    () => sellReceipt(rufen, { paymentMethod: 'cash', items: [MENUE], tip: { cents: 100, paymentMethod: 'mixed' as KeckPaymentMethodKey } }),
    /mixed/,
  );
  await assert.rejects(
    () => cancelReceipt(rufen, { cashregisterId: KASSEN_ID, originalReceiptId: 'kasse-1-ID-40', reason: 'fehleingabe', paymentMethod: 'mixed' }),
    /mixed/,
  );
  assert.equal(aufrufe.length, 0);
});

test('cancelReceipt mit payments: negative Betraege und refundOf gehen hinaus', async () => {
  const { rufen, aufrufe } = weg(STORNO);
  await cancelReceipt(rufen, {
    cashregisterId: KASSEN_ID,
    originalReceiptId: 'kasse-1-ID-40',
    reason: 'kunde_storniert',
    payments: [
      { method: 'creditCard', amountCents: -2000, refundOf: 'p1', provider: CreditCardProvider.sumup, providerPaymentId: 'RF-1' },
      { method: KeckPaymentMethod.cash, amountCents: -2545 },
    ],
  });
  const { endpunkt, params } = gesendet(aufrufe);
  assert.equal(endpunkt, 'cancelReceipt');
  assert.deepEqual(params, {
    cashregisterId: KASSEN_ID,
    originalReceiptId: 'kasse-1-ID-40',
    reason: 'kunde_storniert',
    payments: [
      { method: 'creditCard', amountCents: -2000, provider: 'sumup', providerPaymentId: 'RF-1', refundOf: 'p1' },
      { method: 'cash', amountCents: -2545 },
    ],
  });
});

test('cancelReceipt mit payments: Konflikte und Vorzeichen werden vor dem Senden abgewiesen', async () => {
  const { rufen, aufrufe } = weg(STORNO);
  const basis = { cashregisterId: KASSEN_ID, originalReceiptId: 'kasse-1-ID-40', reason: 'fehleingabe' as const };
  const faelle: Array<[Record<string, unknown>, RegExp]> = [
    [{ payments: [{ method: 'cash', amountCents: -100 }], paymentMethod: 'cash' }, /payments/],
    [{ payments: [{ method: 'cash', amountCents: -100 }], creditCardProvider: 'sumup' }, /payments/],
    [{ payments: [{ method: 'cash', amountCents: -100 }], cardPaymentId: 'x' }, /payments/],
    [{ payments: [{ method: 'cash', amountCents: -100 }], cardPaymentData: {} }, /payments/],
    [{ payments: [{ method: 'cash', amountCents: 100 }] }, /amountCents/],
    [{ payments: [{ method: 'cash', amountCents: -100, tenderedCents: 0 }] }, /tenderedCents/],
    [{ payments: [{ method: 'cash', amountCents: -100, refundOf: 7 }] }, /refundOf/],
    [{ payments: {} }, /payments/],
  ];
  for (const [zusatz, muster] of faelle) {
    await assert.rejects(
      () => cancelReceipt(rufen, { ...basis, ...zusatz } as never),
      (fehler: unknown) => isKasseneckValidationError(fehler) && muster.test((fehler as Error).message),
      `nicht abgelehnt: ${JSON.stringify(zusatz)}`,
    );
  }
  assert.equal(aufrufe.length, 0);
});

// Ohne payments bleibt jeder gesendete Parameter byte-gleich — die
// bestehenden Vertragstests (client-receipts.test.ts) halten die Einzelwerte,
// hier steht die Gesamtform der drei Wege noch einmal als Zeichenkette.
test('Ohne payments: Parameter von sellReceipt, createReceipt und cancelReceipt unveraendert', async () => {
  const a = weg(VERKAUF);
  await sellReceipt(a.rufen, {
    paymentMethod: KeckPaymentMethod.creditCard,
    items: [MENUE],
    creditCardProvider: CreditCardProvider.sumup,
    cardPaymentId: 'TX-81',
    tip: 150,
  });
  assert.equal(
    JSON.stringify(gesendet(a.aufrufe).params),
    '{"receiptType":"standard","items":[{"name":"Menue","quantity":1,"unitPriceCents":4545,"vatRate":10}],"paymentMethod":"creditCard","cardPaymentId":"TX-81","creditCardProvider":"sumup","cardPaymentData":null,"tip":150}',
  );
  const b = weg(STORNO);
  await cancelReceipt(b.rufen, { cashregisterId: KASSEN_ID, originalReceiptId: 'kasse-1-ID-40', reason: 'fehleingabe', paymentMethod: 'cash' });
  assert.equal(
    JSON.stringify(gesendet(b.aufrufe).params),
    '{"cashregisterId":"kasse-1","originalReceiptId":"kasse-1-ID-40","reason":"fehleingabe","paymentMethod":"cash"}',
  );
});
