import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getCardReaderSetup, startCardAccountConnection, disconnectCardAccount, pairCardReader, renameCardReader,
  removeCardReader, setDeviceCardReader, startCardReaderPayment, getCardReaderPayment, cancelCardReaderPayment,
  resolveCardReaderPayment, refundCardReaderPayment, getCardReaderRefund,
  isCardReaderFinal, cardReaderChoices, cardReaderBusyDevice,
  CARD_READER_PAYMENT_STATUSES, CARD_READER_DECISIONS, CARD_READER_MIN_CENTS, CARD_READER_MAX_CENTS,
} from '../src/pos/index.js';
import { KasseneckApiError } from '../src/client/errors.js';
import { isKasseneckValidationError } from '../src/client/errors.js';

type Aufruf = [string, Record<string, unknown> | undefined];
function attrappe(daten: unknown): { rufen: never; aufrufe: Aufruf[] } {
  const aufrufe: Aufruf[] = [];
  const rufen = (async (name: string, params?: Record<string, unknown>) => {
    aufrufe.push([name, params]);
    return daten;
  }) as never;
  return { rufen, aufrufe };
}
async function wirft(p: Promise<unknown>, scope: 'request' | 'response'): Promise<void> {
  try {
    await p;
  } catch (e) {
    assert.ok(isKasseneckValidationError(e), String(e));
    assert.equal((e as { scope: string }).scope, scope);
    return;
  }
  assert.fail('Fehler erwartet');
}

const D = 'dev_pin';
const REF = 'payment-0001';
const ZAHLUNG = { reference: REF, status: 'pending', amountCents: 1090, readerId: 'rdr_01', readerName: 'Theke' };
const ERFOLG = {
  reference: REF, status: 'successful', amountCents: 1090, readerId: 'rdr_01', readerName: 'Theke',
  transaction: { id: 'txn_1', code: 'TC1', cardType: 'VISA', cardLastDigits: '4242', entryMode: 'contactless', authCode: '123456', amountCents: 1090, timeMs: 1790409575000 },
  receiptPayment: {
    provider: 'sumup', providerPaymentId: 'TC1',
    providerData: { channel: 'cloud', transactionCode: 'TC1', transactionId: 'txn_1', amount: 10.9, currency: 'EUR', cardType: 'VISA', cardLastDigits: '4242', entryMode: 'contactless', authCode: '123456', merchantCode: 'MZK4711X', foreignTransactionId: REF, readerId: 'rdr_01' },
  },
};

test('Kataloge: Stand, Entscheidung, Betragsgrenzen', () => {
  assert.deepEqual([...CARD_READER_PAYMENT_STATUSES], ['pending', 'successful', 'failed', 'cancelled', 'declined', 'unclear']);
  assert.deepEqual([...CARD_READER_DECISIONS], ['receipt', 'discard']);
  assert.equal(CARD_READER_MIN_CENTS, 100);
  assert.equal(CARD_READER_MAX_CENTS, 1_000_000);
});

test('getCardReaderSetup: sendet deviceId (withStatus nur wenn true), liest Leser mit Vorgaben', async () => {
  const { rufen, aufrufe } = attrappe({
    connection: { state: 'connected', method: 'api_key', merchantCode: 'MZK4711X', refundsEnabled: true, connectAvailable: true },
    readers: [{ readerId: 'rdr_01', name: 'Theke', serial: '1', model: 'solo', status: 'paired', busy: true, busyDevice: 'Tablet hinten' }, { name: 'ohne Kennung' }],
    deviceReader: 'bluetooth', canManage: true,
  });
  const s = await getCardReaderSetup(rufen, { deviceId: D, withStatus: true });
  assert.deepEqual(aufrufe, [['getCardReaderSetup', { deviceId: D, withStatus: true }]]);
  assert.equal(s.readers.length, 1);
  assert.deepEqual(s.readers[0], { readerId: 'rdr_01', name: 'Theke', serial: '1', model: 'solo', status: 'paired', online: null, battery: null, busy: true, busyDevice: 'Tablet hinten' });
  assert.equal(s.deviceReader, 'bluetooth');
  const b = attrappe({ connection: { state: 'wild', method: 'x' }, readers: 'kaputt' });
  const leer = await getCardReaderSetup(b.rufen, { deviceId: D });
  assert.deepEqual(b.aufrufe, [['getCardReaderSetup', { deviceId: D }]]);
  assert.deepEqual(leer, { connection: { state: 'none', method: null, merchantCode: null, refundsEnabled: false, connectAvailable: false }, readers: [], deviceReader: null, canManage: false });
});

test('Verwaltung: je Aufruf genau ein Aufruf mit deviceId', async () => {
  let a = attrappe({ authorizeUrl: 'https://api.sumup.com/authorize?x=1' });
  assert.deepEqual(await startCardAccountConnection(a.rufen, { deviceId: D }), { authorizeUrl: 'https://api.sumup.com/authorize?x=1' });
  assert.deepEqual(a.aufrufe, [['startCardAccountConnection', { deviceId: D }]]);
  // Antwort ohne die dokumentierten Felder ist trotzdem Erfolg
  a = attrappe({});
  assert.equal(await disconnectCardAccount(a.rufen, { deviceId: D }), undefined);
  assert.deepEqual(a.aufrufe, [['disconnectCardAccount', { deviceId: D }]]);
  a = attrappe(undefined);
  assert.equal(await removeCardReader(a.rufen, { deviceId: D, readerId: 'rdr_01' }), undefined);
  assert.deepEqual(a.aufrufe, [['removeCardReader', { deviceId: D, readerId: 'rdr_01' }]]);
  const leser = { readerId: 'rdr_01', name: 'Theke', status: 'pairing', busy: false };
  a = attrappe(leser);
  const l = await pairCardReader(a.rufen, { deviceId: D, pairingCode: ' k7p4 ', name: ' Theke ' });
  assert.deepEqual(a.aufrufe, [['pairCardReader', { deviceId: D, pairingCode: ' k7p4 ', name: ' Theke ' }]]);
  assert.equal(l.status, 'pairing');
  a = attrappe(leser);
  await renameCardReader(a.rufen, { deviceId: D, readerId: 'rdr_01', name: 'Neu' });
  assert.deepEqual(a.aufrufe, [['renameCardReader', { deviceId: D, readerId: 'rdr_01', name: 'Neu' }]]);
  await wirft(pairCardReader(attrappe({}).rufen, { deviceId: D, pairingCode: 'A', name: 'B' }), 'response');
});

test('setDeviceCardReader: readerId geht immer hinaus, auch als null', async () => {
  let a = attrappe({ deviceReader: null });
  assert.equal(await setDeviceCardReader(a.rufen, { deviceId: D, readerId: null }), null);
  assert.equal(a.aufrufe.length, 1);
  const params = a.aufrufe[0]![1]!;
  assert.ok('readerId' in params);
  assert.deepEqual(params, { deviceId: D, readerId: null });
  a = attrappe({ deviceReader: 'bluetooth' });
  assert.equal(await setDeviceCardReader(a.rufen, { deviceId: D, readerId: 'bluetooth' }), 'bluetooth');
  assert.deepEqual(a.aufrufe, [['setDeviceCardReader', { deviceId: D, readerId: 'bluetooth' }]]);
});

test('Zahlung: Aufrufe senden genau die Felder', async () => {
  let a = attrappe(ZAHLUNG);
  await startCardReaderPayment(a.rufen, { deviceId: D, reference: REF, amountCents: 1090 });
  assert.deepEqual(a.aufrufe, [['startCardReaderPayment', { deviceId: D, reference: REF, amountCents: 1090 }]]);
  a = attrappe(ZAHLUNG);
  await startCardReaderPayment(a.rufen, { deviceId: D, reference: REF, amountCents: 1090, readerId: 'rdr_01' });
  assert.deepEqual(a.aufrufe, [['startCardReaderPayment', { deviceId: D, reference: REF, amountCents: 1090, readerId: 'rdr_01' }]]);
  a = attrappe(ZAHLUNG);
  await getCardReaderPayment(a.rufen, { deviceId: D, reference: REF });
  assert.deepEqual(a.aufrufe, [['getCardReaderPayment', { deviceId: D, reference: REF }]]);
  a = attrappe(ZAHLUNG);
  await cancelCardReaderPayment(a.rufen, { deviceId: D, reference: REF });
  assert.deepEqual(a.aufrufe, [['cancelCardReaderPayment', { deviceId: D, reference: REF }]]);
  a = attrappe(ZAHLUNG);
  await resolveCardReaderPayment(a.rufen, { deviceId: D, reference: REF, decision: 'discard' });
  assert.deepEqual(a.aufrufe, [['resolveCardReaderPayment', { deviceId: D, reference: REF, decision: 'discard' }]]);
  const r = { reference: 'refund-0001', paymentReference: REF, status: 'successful', amountCents: 590 };
  a = attrappe(r);
  const e = await refundCardReaderPayment(a.rufen, { deviceId: D, reference: 'refund-0001', paymentReference: REF, amountCents: 590 });
  assert.deepEqual(a.aufrufe, [['refundCardReaderPayment', { deviceId: D, reference: 'refund-0001', paymentReference: REF, amountCents: 590 }]]);
  assert.deepEqual(e, { ...r, reason: null });
  a = attrappe(r);
  await getCardReaderRefund(a.rufen, { deviceId: D, reference: 'refund-0001' });
  assert.deepEqual(a.aufrufe, [['getCardReaderRefund', { deviceId: D, reference: 'refund-0001' }]]);
});

test('Pruefung vor dem Senden: kein Aufruf', async () => {
  const a = attrappe(ZAHLUNG);
  const t = a.rufen;
  await wirft(getCardReaderSetup(t, { deviceId: '' }), 'request');
  await wirft(getCardReaderSetup(t, {} as never), 'request');
  await wirft(startCardReaderPayment(t, { deviceId: D, reference: 'kurz', amountCents: 1090 }), 'request');
  await wirft(startCardReaderPayment(t, { deviceId: D, reference: 'mit leerzeichen!', amountCents: 1090 }), 'request');
  await wirft(startCardReaderPayment(t, { deviceId: D, reference: 'x'.repeat(65), amountCents: 1090 }), 'request');
  for (const amountCents of [99, 1_000_001, 10.5, NaN, '1090' as never]) {
    await wirft(startCardReaderPayment(t, { deviceId: D, reference: REF, amountCents }), 'request');
  }
  await wirft(startCardReaderPayment(t, { deviceId: D, reference: REF, amountCents: 1090, readerId: '' }), 'request');
  await wirft(resolveCardReaderPayment(t, { deviceId: D, reference: REF, decision: 'vielleicht' as never }), 'request');
  await wirft(refundCardReaderPayment(t, { deviceId: D, reference: 'refund-0001', paymentReference: REF, amountCents: 50 }), 'request');
  await wirft(refundCardReaderPayment(t, { deviceId: D, reference: 'refund-0001', paymentReference: 'zu', amountCents: 500 }), 'request');
  await wirft(getCardReaderPayment(t, { deviceId: D, reference: 'a b' }), 'request');
  await wirft(renameCardReader(t, { deviceId: D, readerId: '', name: 'x' }), 'request');
  await wirft(removeCardReader(t, { deviceId: D, readerId: '  ' }), 'request');
  await wirft(setDeviceCardReader(t, { deviceId: D, readerId: '' }), 'request');
  assert.deepEqual(a.aufrufe, []);
  // Grenzen sind erlaubt
  await startCardReaderPayment(t, { deviceId: D, reference: REF, amountCents: 100 });
  await startCardReaderPayment(t, { deviceId: D, reference: REF, amountCents: 1_000_000 });
  assert.equal(a.aufrufe.length, 2);
});

test('Antwort lesen: fehlende Kennung und krumme Betraege sind Antwortfehler', async () => {
  await wirft(getCardReaderPayment(attrappe({ ...ZAHLUNG, reference: undefined }).rufen, { deviceId: D, reference: REF }), 'response');
  await wirft(getCardReaderPayment(attrappe(null).rufen, { deviceId: D, reference: REF }), 'response');
  await wirft(getCardReaderPayment(attrappe({ ...ZAHLUNG, amountCents: 10.9 }).rufen, { deviceId: D, reference: REF }), 'response');
  await wirft(getCardReaderPayment(attrappe({ ...ZAHLUNG, amountCents: '1090' }).rufen, { deviceId: D, reference: REF }), 'response');
  await wirft(getCardReaderRefund(attrappe({ reference: 'refund-0001', paymentReference: REF }).rufen, { deviceId: D, reference: 'refund-0001' }), 'response');
  await wirft(startCardAccountConnection(attrappe({}).rufen, { deviceId: D }), 'response');
});

test('unbekannter Stand wird unclear, unbekannter Grund null, optionale Felder null', async () => {
  const z = await getCardReaderPayment(attrappe({ reference: REF, status: 'wartet_neu', reason: 'neu', amountCents: 500 }).rufen, { deviceId: D, reference: REF });
  assert.deepEqual(z, { reference: REF, status: 'unclear', reason: null, amountCents: 500, readerId: null, readerName: null, transaction: null, receiptPayment: null });
  const g = await getCardReaderPayment(attrappe({ ...ZAHLUNG, status: 'failed', reason: 'declined' }).rufen, { deviceId: D, reference: REF });
  assert.equal(g.reason, 'declined');
});

test('receiptPayment nur bei successful, mit Zahlungskennung und channel cloud', async () => {
  const lesen = (d: unknown) => getCardReaderPayment(attrappe(d).rufen, { deviceId: D, reference: REF });
  const ok = await lesen(ERFOLG);
  assert.deepEqual(ok.receiptPayment, ERFOLG.receiptPayment);
  assert.equal(ok.transaction?.cardLastDigits, '4242');
  assert.equal((await lesen({ ...ERFOLG, status: 'failed' })).receiptPayment, null);
  assert.equal((await lesen({ ...ERFOLG, status: 'unclear' })).receiptPayment, null);
  assert.equal((await lesen({ ...ERFOLG, receiptPayment: { ...ERFOLG.receiptPayment, providerPaymentId: '' } })).receiptPayment, null);
  assert.equal((await lesen({ ...ERFOLG, receiptPayment: { ...ERFOLG.receiptPayment, providerData: { ...ERFOLG.receiptPayment.providerData, channel: 'app' } } })).receiptPayment, null);
  assert.equal((await lesen({ ...ERFOLG, receiptPayment: undefined })).receiptPayment, null);
});

test('isCardReaderFinal: nur successful, failed, cancelled, declined', () => {
  const final = CARD_READER_PAYMENT_STATUSES.filter(isCardReaderFinal);
  assert.deepEqual([...final], ['successful', 'failed', 'cancelled', 'declined']);
});

test('cardReaderChoices und cardReaderBusyDevice lesen details nach Code', () => {
  const auswahl = new KasseneckApiError('startCardReaderPayment', 'Mehrere Leser.', {
    code: 'card_reader_choice_needed',
    readers: [{ readerId: 'rdr_01', name: 'Theke' }, { readerId: 'rdr_02', name: 'Terrasse' }],
  });
  const r = cardReaderChoices(auswahl);
  assert.deepEqual(r.map((x) => [x.readerId, x.name, x.status, x.busy]), [['rdr_01', 'Theke', null, false], ['rdr_02', 'Terrasse', null, false]]);
  assert.deepEqual(cardReaderChoices(new KasseneckApiError('x', 'm', { code: 'card_reader_choice_needed', readers: 'kaputt' })), []);
  assert.deepEqual(cardReaderChoices(new KasseneckApiError('x', 'm', { code: 'card_reader_choice_needed' })), []);
  assert.deepEqual(cardReaderChoices(new KasseneckApiError('x', 'm', { code: 'validation', readers: [{ readerId: 'a', name: 'b' }] })), []);
  assert.deepEqual(cardReaderChoices(new Error('x')), []);
  const belegt = new KasseneckApiError('startCardReaderPayment', 'belegt', { code: 'card_reader_busy', busyDevice: 'Tablet hinten' });
  assert.equal(cardReaderBusyDevice(belegt), 'Tablet hinten');
  assert.equal(cardReaderBusyDevice(new KasseneckApiError('x', 'm', { code: 'validation', busyDevice: 'Tablet' })), null);
  assert.equal(cardReaderBusyDevice(new KasseneckApiError('x', 'm', { code: 'card_reader_busy' })), null);
  assert.equal(cardReaderBusyDevice(undefined), null);
});
