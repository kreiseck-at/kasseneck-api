import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MANUAL_RECEIPT_REASONS, readManualReceipt } from '../src/models/manual-receipt.js';
import { fromReceiptPayload, fromReceiptSummaryPayload, type ReceiptPayloadRead } from '../src/models/index.js';
import { fromListReceiptsSummaryPayload } from '../src/client/list-receipts.js';

const EINZEL = { number: 'H-17', date: '2026-12-31', time: '14:30', reason: 'network_outage' };
const SAMMEL = { number: '201', numberTo: '248', count: 48, date: '2026-11-03', reason: 'power_outage' };

const BELEG: ReceiptPayloadRead = {
  qr: '_R1-AT1_KASSE1_AT0-KASSE1-67', sig: 'eyJ.e30.c2ln', certificateSerialNumber: '5A1C3E07',
  signaturePreviousReceipt: 'VORGAENGER', turnoverCounterAES256ICM: 'UMSATZ', paymentMethod: 'cash',
  items: [], vouchers: [], timeStamp: '2027-01-02T09:12:40', cashregisterId: 'KASSE1', receiptType: 'standard',
  receiptId: 'AT0-KASSE1-67', fullReceiptId: 'VOLL', creditCardProvider: null, cardPaymentId: null,
  cardPaymentData: null, customerDetails: '', legalMessage: '', signatureSuccess: true, customProjectId: null,
};

test('MANUAL_RECEIPT_REASONS: die sechs Gründe des Vertrags', () => {
  assert.deepEqual([...MANUAL_RECEIPT_REASONS], [
    'network_outage', 'power_outage', 'device_failure', 'system_outage', 'other', 'outside_premises',
  ]);
});

test('readManualReceipt: Einzelbeleg mit Uhrzeit', () => {
  assert.deepEqual(readManualReceipt(EINZEL), EINZEL);
});

test('readManualReceipt: Tagessammelbeleg mit Anzahl und Text', () => {
  const roh = { ...SAMMEL, reason: 'other', note: 'Kasse beim Umzug abgebaut' };
  assert.deepEqual(readManualReceipt(roh), roh);
});

test('readManualReceipt: unbekannte Schlüssel fallen weg, Formfehler einzelner Zusatzfelder auch', () => {
  assert.deepEqual(readManualReceipt({ ...EINZEL, extra: 1, count: '7', numberTo: 5 }), EINZEL);
});

test('readManualReceipt: ohne Nummer, Datum oder Grund kein Handbeleg', () => {
  for (const fehlt of ['number', 'date', 'reason'] as const) {
    const { [fehlt]: _weg, ...rest } = EINZEL;
    assert.equal(readManualReceipt(rest), undefined, fehlt);
  }
  assert.equal(readManualReceipt(null), undefined);
  assert.equal(readManualReceipt('H-17'), undefined);
  assert.equal(readManualReceipt([EINZEL]), undefined);
});

test('readManualReceipt: unbekannter Grund bleibt als roher Wert lesbar', () => {
  assert.equal(readManualReceipt({ ...EINZEL, reason: 'flood' })?.reason, 'flood');
});

test('fromReceiptPayload: manualReceipt am Beleg, ohne Feld kein Schlüssel', () => {
  assert.deepEqual(fromReceiptPayload({ ...BELEG, manualReceipt: SAMMEL }).manualReceipt, SAMMEL);
  assert.equal('manualReceipt' in fromReceiptPayload(BELEG), false);
  assert.equal('manualReceipt' in fromReceiptPayload({ ...BELEG, manualReceipt: null }), false);
});

test('fromListReceiptsSummaryPayload: manualReceipt in der Kurzansicht', () => {
  assert.deepEqual(fromListReceiptsSummaryPayload({ receiptId: 'AT0-KASSE1-67', manualReceipt: EINZEL }).manualReceipt, EINZEL);
  assert.equal('manualReceipt' in fromListReceiptsSummaryPayload({ receiptId: 'AT0-KASSE1-67' }), false);
});

test('fromReceiptSummaryPayload: manualReceipt in der Belegliste der Kasse', () => {
  assert.deepEqual(fromReceiptSummaryPayload({ receiptId: 'AT0-KASSE1-67', total: 120, manualReceipt: EINZEL }).manualReceipt, EINZEL);
  assert.equal('manualReceipt' in fromReceiptSummaryPayload({ receiptId: 'AT0-KASSE1-67', total: 120 }), false);
});
