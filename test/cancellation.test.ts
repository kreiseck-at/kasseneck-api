import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromReceiptPayload, remainingQuantities, CANCELLATION_REASONS, isCancellationReason } from '../src/models/index.js';
import type { ReceiptPayloadRead } from '../src/models/index.js';

// Storno-Felder am Beleg: Bezug/Grund am Storno-Beleg, cancellations[] am
// Original -- und die Restmengen als reine Funktion (Zwilling von
// functions/storno-core.js restmengen).

const NUTZLAST: ReceiptPayloadRead = {
  qr: 'QR', sig: 'SIG', certificateSerialNumber: 'C', signaturePreviousReceipt: 'P', turnoverCounterAES256ICM: 'T',
  paymentMethod: 'cash', timeStamp: '2026-08-16T10:00:00', cashregisterId: 'kasse-1', receiptType: 'standard',
  receiptId: 'kasse-1-ID-12', fullReceiptId: 'F', creditCardProvider: null, cardPaymentId: null, cardPaymentData: null,
  customerDetails: '', legalMessage: '', signatureSuccess: true, customProjectId: null,
  items: [
    { name: 'Semmel', amount: 4, priceOne: 0.79, vat: 10 },
    { name: 'Kaffee', amount: 1, priceOne: 2.8, vat: 20 },
  ],
};

test('Grund-Katalog: dieselben fuenf Codes wie das Backend', () => {
  assert.deepEqual(Object.keys(CANCELLATION_REASONS), ['fehleingabe', 'kunde_storniert', 'falsche_zahlart', 'doppelt_erfasst', 'sonstiges']);
  assert.equal(CANCELLATION_REASONS.kunde_storniert, 'Kunde hat storniert');
  assert.equal(isCancellationReason('fehleingabe'), true);
  assert.equal(isCancellationReason('weil'), false);
});

test('fromReceiptPayload liest Bezug, Grund und cancellations; ohne sie bleiben die Felder weg', () => {
  const ohne = fromReceiptPayload(NUTZLAST);
  assert.equal(ohne.cancellationOf, undefined);
  assert.equal(ohne.cancellations, undefined);
  const storno = fromReceiptPayload({
    ...NUTZLAST, receiptType: 'cancellation',
    cancellationOf: { receiptId: 'kasse-1-ID-12', fullReceiptId: 'F' }, cancellationReason: 'fehleingabe',
  } as ReceiptPayloadRead);
  assert.deepEqual(storno.cancellationOf, { receiptId: 'kasse-1-ID-12', fullReceiptId: 'F' });
  assert.equal(storno.cancellationReason, 'fehleingabe');
  const original = fromReceiptPayload({
    ...NUTZLAST,
    cancellations: [{ receiptId: 'kasse-1-ID-13', at: 1, by: 'anna', note: null, items: [{ index: 0, quantity: 3 }] }],
  } as ReceiptPayloadRead);
  assert.deepEqual(original.cancellations, [{ receiptId: 'kasse-1-ID-13', at: 1, by: 'anna', note: null, items: [{ index: 0, quantity: 3 }] }]);
});

test('remainingQuantities: Belegmengen minus Stornos und frische Reservierungen, nie unter null', () => {
  const jetzt = 1_700_000_000_000;
  const beleg = fromReceiptPayload({
    ...NUTZLAST,
    cancellations: [
      { receiptId: 'a', at: jetzt - 5000, by: null, note: null, items: [{ index: 0, quantity: 1 }] },
      { pending: true, at: jetzt - 10_000, by: null, note: null, items: [{ index: 1, quantity: 1 }] },
      { pending: true, at: jetzt - 121_000, by: null, note: null, items: [{ index: 0, quantity: 9 }] },
    ],
  } as ReceiptPayloadRead);
  assert.deepEqual(remainingQuantities(beleg, jetzt), [3, 0]);
  assert.deepEqual(remainingQuantities(fromReceiptPayload(NUTZLAST), jetzt), [4, 1]);
});
