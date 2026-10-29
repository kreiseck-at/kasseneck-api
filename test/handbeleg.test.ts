import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HANDBELEG_GRUENDE, leseHandbeleg } from '../src/models/handbeleg.js';
import { fromReceiptPayload, type ReceiptPayloadRead } from '../src/models/index.js';

const EINZEL = { nummer: 'H-17', datum: '2026-12-31', uhrzeit: '14:30', grund: 'internet' };
const BELEG: ReceiptPayloadRead = {
  qr: '_R1-AT1_KASSE1_AT0-KASSE1-67', sig: 'eyJ.e30.c2ln', certificateSerialNumber: '5A1C3E07',
  signaturePreviousReceipt: 'VORGAENGER', turnoverCounterAES256ICM: 'UMSATZ', paymentMethod: 'cash',
  items: [], vouchers: [], timeStamp: '2027-01-02T09:12:40', cashregisterId: 'KASSE1', receiptType: 'standard',
  receiptId: 'AT0-KASSE1-67', fullReceiptId: 'VOLL', creditCardProvider: null, cardPaymentId: null,
  cardPaymentData: null, customerDetails: '', legalMessage: '', signatureSuccess: true, customProjectId: null,
};

test('HANDBELEG_GRUENDE: die sechs inneren Gründe', () => {
  assert.deepEqual([...HANDBELEG_GRUENDE], ['internet', 'strom', 'geraet', 'stoerung', 'sonstiges', 'ausser_haus']);
});

test('leseHandbeleg: Einzelbeleg und Sammelbeleg mit Text', () => {
  assert.deepEqual(leseHandbeleg(EINZEL), EINZEL);
  const sammel = { nummer: '201', nummerBis: '248', anzahl: 48, datum: '2026-11-03', grund: 'sonstiges', text: 'Umzug' };
  assert.deepEqual(leseHandbeleg(sammel), sammel);
});

test('leseHandbeleg: ohne Nummer, Datum oder Grund kein Handbeleg; falsche Zusatzfelder fallen weg', () => {
  for (const fehlt of ['nummer', 'datum', 'grund'] as const) {
    const { [fehlt]: _weg, ...rest } = EINZEL;
    assert.equal(leseHandbeleg(rest), undefined, fehlt);
  }
  assert.equal(leseHandbeleg(null), undefined);
  assert.deepEqual(leseHandbeleg({ ...EINZEL, anzahl: '7', nummerBis: 5, x: 1 }), EINZEL);
});

test('fromReceiptPayload: handbeleg am Beleg, ohne Feld kein Schlüssel', () => {
  assert.deepEqual(fromReceiptPayload({ ...BELEG, handbeleg: EINZEL }).handbeleg, EINZEL);
  assert.equal('handbeleg' in fromReceiptPayload(BELEG), false);
});
