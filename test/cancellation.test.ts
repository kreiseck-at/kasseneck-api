import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromReceiptPayload, remainingQuantities, CANCELLATION_REASONS, isCancellationReason, CANCELLATION_ERROR_CODES, isCancellationErrorCode } from '../src/models/index.js';
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

// Fehlercodes: dieselbe Liste wie functions/storno-core.js STORNO_FEHLERCODES.
// Die Kasse entscheidet am Code (KasseneckApiError.code), nie am Text.
test('Fehlercode-Katalog: dieselben vierzehn Codes wie das Backend, als Liste und Waechter', () => {
  assert.deepEqual([...CANCELLATION_ERROR_CODES], [
    'beleg_nicht_gefunden', 'belegart_nicht_stornierbar', 'trainingsbeleg', 'bereits_storniert',
    'position_ungueltig', 'menge_ueber_rest', 'grund_unbekannt', 'anmerkung_zu_lang', 'items_ungueltig',
    'kasse_nicht_zugewiesen', 'keine_berechtigung', 'nur_eigene_belege', 'kasse_unvollstaendig',
    'storno_fehlgeschlagen',
  ]);
  assert.equal(isCancellationErrorCode('bereits_storniert'), true);
  assert.equal(isCancellationErrorCode('Beleg ist bereits vollständig storniert.'), false);
  assert.equal(isCancellationErrorCode(undefined), false);
});

// Der gewaehrte Rabattgutschein-Ausgleich je Eintrag (Cent je Steuertopf) muss
// die Lesung ueberleben: die Kasse zeigt ihn im Storno-Dialog, und ein Eintrag
// ohne das Feld (Altbestand) bleibt ohne.
test('fromReceiptPayload behaelt promoAdjustmentCents am Storno-Eintrag, laesst es sonst weg', () => {
  const beleg = fromReceiptPayload({
    ...NUTZLAST,
    cancellations: [
      { receiptId: 'S1', at: 1, by: null, note: null, items: [{ index: 0, quantity: 1 }], promoAdjustmentCents: { amountRateReduced1: 200 } },
      { receiptId: 'S2', at: 2, by: null, note: null, items: [{ index: 0, quantity: 1 }] },
    ],
  });
  assert.deepEqual(beleg.cancellations?.[0]?.promoAdjustmentCents, { amountRateReduced1: 200 });
  assert.equal('promoAdjustmentCents' in (beleg.cancellations?.[1] ?? {}), false);
});

// Das Datum des Originals reist am Bezug mit (Kopfblock des Storno-Bons);
// fehlt es in der Nutzlast, bleibt das Feld weg.
test('fromReceiptPayload behaelt cancellationOf.timeStamp, laesst es sonst weg', () => {
  const mit = fromReceiptPayload({ ...NUTZLAST, receiptType: 'cancellation',
    cancellationOf: { receiptId: 'kasse-1-ID-11', fullReceiptId: 'F11', timeStamp: '2026-08-11T09:02:17' } });
  assert.deepEqual(mit.cancellationOf, { receiptId: 'kasse-1-ID-11', fullReceiptId: 'F11', timeStamp: '2026-08-11T09:02:17' });
  const ohne = fromReceiptPayload({ ...NUTZLAST, receiptType: 'cancellation', cancellationOf: { receiptId: 'kasse-1-ID-11', fullReceiptId: null } });
  assert.deepEqual(ohne.cancellationOf, { receiptId: 'kasse-1-ID-11', fullReceiptId: null });
});
