import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CreditCardProvider } from '../src/enums/index.js';
import { hobexReceiptNeedsSignature, hobexReceiptToCardPaymentData } from '../src/models/hobex-receipt.js';
import { hobexReceiptFromHps, parseHpsTransactionResponse } from '../src/payments/hobex-hps/index.js';

/**
 * Die Bruecke von der Terminal-Antwort zum Kasseneck-Beleg -- Zwilling von
 * `HobexReceipt.fromHps` (kasseneck_api, `lib/models/hobex_receipt.dart`).
 * Ohne sie kann eine HPS-Zahlung nicht gebucht werden, weil `cardPaymentData`
 * am Beleg fehlt.
 *
 * Die Nutzlast unten ist KEINE erfundene Form: sie ist die woertliche Antwort
 * des Terminals 3600335 auf die Statusabfrage zur Zahlung 178790461613600000
 * am 28.08.2026, samt der beiden Eigenheiten, die eine naive Abbildung
 * zerlegen wuerden -- `cvm` kommt als ZAHL, `currency` als `null`.
 */
const GEMESSEN = {
  aid: 'A0000000041010',
  amount: 0.01,
  approvalCode: '000252',
  approvalDate: null,
  brand: 'MASTERCARD',
  cardExpiry: '2810',
  cardIssuer: 'MASTERCARD',
  cardNumber: '543394******4720_2810',
  cleared: null,
  currency: null,
  cvm: 3,
  originalTransactionId: '00178790461613600000',
  receipt: '408859',
  reference: null,
  responseCode: '9011',
  responseText: 'Transaction Canceled',
  source: null,
  state: null,
  statusCode: null,
  tid: '3600335',
  transactionDate: '2026-08-28T10:10:30.0000000+02:00',
  transactionId: '178790461613600000',
  transactionType: 'S',
  vu: '000000351985785',
};

test('bildet die gemessene Terminal-Antwort auf einen Beleg ab', () => {
  const beleg = hobexReceiptFromHps(parseHpsTransactionResponse(GEMESSEN));

  assert.equal(beleg.transactionId, '178790461613600000');
  assert.equal(beleg.tid, '3600335');
  assert.equal(beleg.receipt, '408859');
  assert.equal(beleg.approvalCode, '000252');
  assert.equal(beleg.brand, 'MASTERCARD');
  assert.equal(beleg.cardNumber, '543394******4720_2810');
  assert.equal(beleg.cardExpiry, '2810');
  assert.equal(beleg.responseCode, '9011');
  assert.equal(beleg.transactionType, 'S');
  assert.equal(beleg.amountCents, 1);
  assert.equal(beleg.tipCents, 0);
  assert.equal(beleg.creditCardProvider, CreditCardProvider.hobexHps);
});

test('normalisiert das Datum wie das Dart-Vorbild', () => {
  const beleg = hobexReceiptFromHps(parseHpsTransactionResponse(GEMESSEN));
  assert.equal(beleg.transactionDate, '2026-08-28 10:10:30');
});

test('cvm kommt als Zahl und wird zu Text -- sonst kippt die Unterschriftsfrage', () => {
  const beleg = hobexReceiptFromHps(parseHpsTransactionResponse(GEMESSEN));
  assert.equal(beleg.cvm, '3');
  assert.equal(hobexReceiptNeedsSignature(beleg), false);

  const unterschrift = hobexReceiptFromHps(parseHpsTransactionResponse({ ...GEMESSEN, cvm: 1 }));
  assert.equal(unterschrift.cvm, '1');
  assert.equal(hobexReceiptNeedsSignature(unterschrift), true);
});

test('fehlende Felder werden zu leerem Text, nicht zu "null" oder "undefined"', () => {
  const beleg = hobexReceiptFromHps(parseHpsTransactionResponse(GEMESSEN));
  assert.equal(beleg.currency, '');
  assert.equal(beleg.reference, undefined);

  const leer = hobexReceiptFromHps(parseHpsTransactionResponse({ responseCode: '0' }));
  for (const wert of [leer.transactionId, leer.tid, leer.receipt, leer.approvalCode, leer.brand, leer.cardNumber, leer.cardExpiry, leer.cardIssuer, leer.transactionType, leer.currency, leer.cvm, leer.transactionDate]) {
    assert.equal(wert, '');
  }
  assert.equal(leer.amountCents, 0);
});

test('der Beleg traegt die HPS-Zusatzfelder in die cardPaymentData', () => {
  const daten = hobexReceiptToCardPaymentData(hobexReceiptFromHps(parseHpsTransactionResponse(GEMESSEN)));

  assert.equal(daten.transactionId, '178790461613600000');
  assert.equal(daten.date, '2026-08-28 10:10:30');
  assert.equal(daten.no, '408859');
  assert.equal(daten.cardBrand, 'MASTERCARD');
  assert.equal(daten.cvm, '3');
  // nur bei hobexHps -- belegt, dass die Bruecke den Provider richtig setzt
  assert.equal(daten.approvalCode, '000252');
  assert.equal(daten.cardExpiry, '2810');
  assert.equal(daten.cardIssuer, 'MASTERCARD');
  assert.equal(daten.amount, '0.01');
});

test('ein als Text gelieferter Betrag landet trotzdem richtig in Cent', () => {
  // `asNumber` (transaction-response.ts) nimmt auch Zahlen in Textform an --
  // der Beleg muss daraus dieselben Cent machen wie aus einer echten Zahl.
  const beleg = hobexReceiptFromHps(parseHpsTransactionResponse({ ...GEMESSEN, amount: '12.34' }));
  assert.equal(beleg.amountCents, 1234);

  // Unbrauchbarer Betrag: 0 Cent, kein NaN, das lautlos weiterreist.
  const kaputt = hobexReceiptFromHps(parseHpsTransactionResponse({ ...GEMESSEN, amount: 'abc' }));
  assert.equal(kaputt.amountCents, 0);
});
