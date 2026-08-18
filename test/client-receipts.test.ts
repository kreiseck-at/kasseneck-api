import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import {
  isKasseneckApiError,
  isKasseneckAuthError,
  isKasseneckHttpError,
  isKasseneckNetworkError,
  isKasseneckValidationError,
} from '../src/client/errors.js';
import {
  sellReceipt,
  sellReceiptWithCompany,
  cancelReceipt,
  createCancelReceipt,
  zeroReceipt,
  getReceipt,
  getReceiptWithCompany,
  generateFullReceiptId,
  getFirstReceiptDate,
  createReceipt,
  checkVoucherCombinationError,
} from '../src/client/receipts.js';
import { createKasseneckApi } from '../src/client/api.js';
import {
  createTransport,
  DEFAULT_BASE_URL,
  type FetchLike,
  type HttpRequestInit,
  type HttpResponseLike,
  type KasseneckTransport,
} from '../src/client/transport.js';
import { apiKeyAuth, registerUserAuth } from '../src/client/auth.js';
import { ReceiptType, VatRate, KeckPaymentMethod, type KeckPaymentMethodKey, CreditCardProvider, VoucherAction, VoucherType } from '../src/enums/index.js';
import type { Receipt, ReceiptItem, ReceiptPayload, Voucher } from '../src/models/index.js';
import { fromReceiptPayload, receiptItemIsValid, receiptSumCents, toReceiptItemPayload } from '../src/models/index.js';
import { buildReceiptLayout, formatCents } from '../src/receipt/layout.js';

/**
 * Vertragstests der Beleg-Endpunkte: welcher Endpunktname geht raus, mit
 * welchen Parameternamen und -werten.
 *
 * Die Erwartungen sind aus dem Flutter-Vorbild
 * (kasseneck_api/lib/kasseneck_api.dart, `_createReceipt` ab Zeile 266)
 * **abgeschrieben**, nicht aus der Umsetzung dieses Pakets abgeleitet. Genau
 * das ist der Zweck: ein Tippfehler in einer dieser Zeichenketten faellt der
 * Typpruefung nicht auf und wuerde sonst erst in Produktion auffallen.
 */

const API_KEY = 'kr_live_GEHEIMERAPIKEY';
const KASSEN_TOKEN = 'cb_live_GEHEIMESKASSENTOKEN';
const ID_TOKEN = 'eyJ-GEHEIMESIDTOKEN';
const SITZUNG = 'sess-GEHEIMESITZUNG';
const KASSEN_ID = 'kasse-1';

interface Aufruf {
  url: string;
  init: HttpRequestInit;
}

function antwort(rumpf: string): HttpResponseLike {
  return {
    status: 200,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
    text: async () => rumpf,
    arrayBuffer: async () => new TextEncoder().encode(rumpf).buffer,
  };
}

const erfolg = (daten: unknown): HttpResponseLike => antwort(JSON.stringify({ status: 'success', message: '', data: daten }));

function fetchFake(antwortWert: HttpResponseLike): { holen: FetchLike; aufrufe: Aufruf[] } {
  const aufrufe: Aufruf[] = [];
  const holen: FetchLike = async (url, init) => {
    aufrufe.push({ url, init });
    return antwortWert;
  };
  return { holen, aufrufe };
}

/** Beleg-Nutzlast, wie das Backend sie in `data.receipt` legt. */
const BELEG_NUTZLAST: ReceiptPayload = {
  qr: '_R1-AT1_...',
  sig: 'SIGNATUR',
  certificateSerialNumber: '6F0404F0',
  signaturePreviousReceipt: 'VORGAENGER',
  turnoverCounterAES256ICM: 'ZAEHLER',
  paymentMethod: 'cash',
  items: [{ name: 'Kaffee', quantity: 1, unitPriceCents: 320, vatRate: 20 }],
  vouchers: null,
  timeStamp: '2026-08-13T10:15:00',
  cashregisterId: KASSEN_ID,
  receiptType: 'standard',
  receiptId: 'r-1',
  fullReceiptId: 'ENC-FULL-ID',
  creditCardProvider: null,
  cardPaymentId: null,
  cardPaymentData: null,
  customerDetails: '',
  legalMessage: '',
  signatureSuccess: true,
  customProjectId: null,
};

/** Antworthuelle von `createReceipt`/`getReceipt`: Beleg plus Firmen-Metadaten. */
const BELEG_ANTWORT = {
  receipt: BELEG_NUTZLAST,
  uid: 'ATU12345678',
  is_small_business: false,
  taxnr: '12/345/6789',
  company: 'Musterfirma',
  phone: '+43 1 234',
  street: 'Musterstrasse 1',
  zip: '1010',
  city: 'Wien',
  footer1: 'Danke',
  footer2: 'Wiederkommen',
  footer3: null,
  footer4: null,
  logo_url: null,
  kreiseck_logo: false,
};

const KAFFEE: ReceiptItem = { name: 'Kaffee', quantity: 1, vat: VatRate.vat20, priceCents: 320 };

/** Baut Transport plus Aufruf-Mitschrift fuer den API-Schluessel-Weg. */
function apiSchluesselWeg(daten: unknown = BELEG_ANTWORT): { rufen: KasseneckTransport; aufrufe: Aufruf[] } {
  const { holen, aufrufe } = fetchFake(erfolg(daten));
  const rufen = createTransport({
    auth: apiKeyAuth({ apiKey: API_KEY, cashregisterToken: KASSEN_TOKEN }),
    fetch: holen,
  });
  return { rufen, aufrufe };
}

/** Baut Transport plus Aufruf-Mitschrift fuer den Kassen-Benutzer-Weg (Browser-Kasse). */
function kassenBenutzerWeg(daten: unknown = BELEG_ANTWORT): { rufen: KasseneckTransport; aufrufe: Aufruf[] } {
  const { holen, aufrufe } = fetchFake(erfolg(daten));
  const rufen = createTransport({
    auth: registerUserAuth({ getIdToken: () => ID_TOKEN, getSessionId: () => SITZUNG, cashregisterId: KASSEN_ID }),
    fetch: holen,
  });
  return { rufen, aufrufe };
}

/** Faellt der Fehler unter einen der Waechter des Pakets — ist die Union dicht? */
function istKasseneckFehler(fehler: unknown): boolean {
  return (
    isKasseneckApiError(fehler) ||
    isKasseneckHttpError(fehler) ||
    isKasseneckNetworkError(fehler) ||
    isKasseneckAuthError(fehler) ||
    isKasseneckValidationError(fehler)
  );
}

/** Liest Endpunktname und gesendete Parameter aus dem einzigen Aufruf. */
function gesendet(aufrufe: Aufruf[]): { endpunkt: string; params: Record<string, unknown> } {
  assert.equal(aufrufe.length, 1, 'genau ein Aufruf erwartet');
  const aufruf = aufrufe[0]!;
  assert.ok(aufruf.url.startsWith(`${DEFAULT_BASE_URL}/`), `unerwartete URL: ${aufruf.url}`);
  const endpunkt = aufruf.url.slice(DEFAULT_BASE_URL.length + 1);
  const rumpf = JSON.parse(aufruf.init.body) as { params: Record<string, unknown> };
  return { endpunkt, params: rumpf.params };
}

// --- sellReceipt -------------------------------------------------------

test('sellReceipt ruft createReceipt mit receiptType standard, items und paymentMethod', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg();

  await sellReceipt(rufen, { paymentMethod: KeckPaymentMethod.cash, items: [KAFFEE] });

  const { endpunkt, params } = gesendet(aufrufe);
  assert.equal(endpunkt, 'createReceipt');
  assert.deepEqual(params, {
    receiptType: 'standard',
    items: [{ name: 'Kaffee', quantity: 1, unitPriceCents: 320, vatRate: 20 }],
    paymentMethod: 'cash',
  });
});

test('sellReceipt liefert den Beleg aus data.receipt', async () => {
  const { rufen } = apiSchluesselWeg();

  const beleg: Receipt = await sellReceipt(rufen, { paymentMethod: KeckPaymentMethod.cash, items: [KAFFEE] });

  assert.equal(beleg.receiptId, 'r-1');
  assert.equal(beleg.fullReceiptId, 'ENC-FULL-ID');
  assert.equal(beleg.receiptType, ReceiptType.standard);
  assert.equal(beleg.paymentMethod, KeckPaymentMethod.cash);
  assert.deepEqual(beleg.items, [KAFFEE]);
});

test('sellReceipt: customerDetails und legalMessage gehen als \\n-verbundene Zeichenkette', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg();

  await sellReceipt(rufen, {
    paymentMethod: KeckPaymentMethod.cash,
    items: [KAFFEE],
    customerDetails: ['Musterfirma GmbH', 'Musterstrasse 1'],
    legalMessage: ['Reverse Charge', '§ 19 UStG'],
    customProjectId: 'projekt-7',
  });

  const { params } = gesendet(aufrufe);
  assert.equal(params['customerDetails'], 'Musterfirma GmbH\nMusterstrasse 1');
  assert.equal(params['legalMessage'], 'Reverse Charge\n§ 19 UStG');
  assert.equal(params['customProjectId'], 'projekt-7');
});

test('sellReceipt mit Kartenzahlung sendet cardPaymentId, creditCardProvider und cardPaymentData', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg();

  await sellReceipt(rufen, {
    paymentMethod: KeckPaymentMethod.creditCard,
    items: [KAFFEE],
    creditCardProvider: CreditCardProvider.hobexCloudApi,
    cardPaymentId: 'tx-1',
    cardPaymentData: { approvalCode: 'A1' },
  });

  const { params } = gesendet(aufrufe);
  assert.deepEqual(params, {
    receiptType: 'standard',
    items: [{ name: 'Kaffee', quantity: 1, unitPriceCents: 320, vatRate: 20 }],
    paymentMethod: 'creditCard',
    cardPaymentId: 'tx-1',
    creditCardProvider: 'hobexCloudApi',
    cardPaymentData: { approvalCode: 'A1' },
  });
});

test('sellReceipt mit Kartenzahlung ohne cardPaymentId: Vorgabe custom, keine Kartenfelder', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg();

  await sellReceipt(rufen, { paymentMethod: KeckPaymentMethod.creditCard, items: [KAFFEE] });

  const { params } = gesendet(aufrufe);
  assert.deepEqual(params, {
    receiptType: 'standard',
    items: [{ name: 'Kaffee', quantity: 1, unitPriceCents: 320, vatRate: 20 }],
    paymentMethod: 'creditCard',
  });
});

test('sellReceipt: fremder Kartenanbieter ohne cardPaymentId wird abgelehnt', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg();

  await assert.rejects(
    () =>
      sellReceipt(rufen, {
        paymentMethod: KeckPaymentMethod.creditCard,
        items: [KAFFEE],
        creditCardProvider: CreditCardProvider.stripe,
      }),
    /cardPaymentId/,
  );
  assert.equal(aufrufe.length, 0, 'ohne cardPaymentId darf nichts gesendet werden');
});

test('sellReceipt sendet Gutscheine mit value (Euro) und valueCents', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg();
  const gutschein: Voucher = {
    name: 'Wertgutschein',
    code: 'G-1',
    action: VoucherAction.sell,
    type: VoucherType.value,
    valueCents: 500,
  };

  await sellReceipt(rufen, { paymentMethod: KeckPaymentMethod.cash, vouchers: [gutschein] });

  const { params } = gesendet(aufrufe);
  assert.deepEqual(params, {
    receiptType: 'standard',
    vouchers: [{ name: 'Wertgutschein', code: 'G-1', action: 'sell', type: 'value', value: 5, valueCents: 500 }],
    paymentMethod: 'cash',
  });
});

test('sellReceipt ohne Positionen und ohne Verkaufsgutschein wird abgelehnt', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg();

  await assert.rejects(() => sellReceipt(rufen, { paymentMethod: KeckPaymentMethod.cash, items: [] }), /Positionen/i);
  assert.equal(aufrufe.length, 0);
});

test('sellReceipt mit ungueltiger Position wird abgelehnt', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg();
  const ohneName: ReceiptItem = { name: '', quantity: 1, vat: VatRate.vat20, priceCents: 320 };

  await assert.rejects(() => sellReceipt(rufen, { paymentMethod: KeckPaymentMethod.cash, items: [ohneName] }), /Position/i);
  assert.equal(aufrufe.length, 0);
});

test('sellReceipt mit ungueltigem Gutschein wird abgelehnt', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg();
  const ohneWert: Voucher = { action: VoucherAction.sell, type: VoucherType.value };

  await assert.rejects(
    () => sellReceipt(rufen, { paymentMethod: KeckPaymentMethod.cash, items: [KAFFEE], vouchers: [ohneWert] }),
    /Gutschein/i,
  );
  assert.equal(aufrufe.length, 0);
});

// --- cancelReceipt / createCancelReceipt -------------------------------
//
// cancelReceipt geht seit der Storno-API an den eigenen Endpunkt cancelReceipt:
// der Server negiert, prueft Restmengen und verkettet. Das Paket schickt nur
// Bezug, Grund und (optional) Positionen -- und liest die Antwort mit
// Storno-Beleg, Bezug und Restmengen.

const STORNO_ANTWORT = {
  receipt: { ...BELEG_NUTZLAST, receiptType: 'cancellation', receiptId: 'kasse-1-ID-13' },
  cancellationOf: { receiptId: 'kasse-1-ID-12', fullReceiptId: 'ENC-FULL-12' },
  remaining: [0, 1],
};

test('cancelReceipt ruft den Storno-Endpunkt mit Bezug und Grund und liest Restmengen', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg(STORNO_ANTWORT);
  const ergebnis = await cancelReceipt(rufen, {
    cashregisterId: KASSEN_ID,
    originalReceiptId: 'kasse-1-ID-12',
    reason: 'fehleingabe',
    items: [{ index: 0, quantity: 1 }],
    note: 'Kunde wollte nur eine',
  });
  const { endpunkt, params } = gesendet(aufrufe);
  assert.equal(endpunkt, 'cancelReceipt');
  assert.deepEqual(params, {
    cashregisterId: KASSEN_ID,
    originalReceiptId: 'kasse-1-ID-12',
    reason: 'fehleingabe',
    items: [{ index: 0, quantity: 1 }],
    note: 'Kunde wollte nur eine',
  });
  assert.equal(ergebnis.receipt.receiptType, ReceiptType.cancellation);
  assert.deepEqual(ergebnis.cancellationOf, { receiptId: 'kasse-1-ID-12', fullReceiptId: 'ENC-FULL-12' });
  assert.deepEqual(ergebnis.remaining, [0, 1]);
});

test('cancelReceipt nimmt auch den Beleg selbst als Bezug (Kasse und ID daraus)', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg(STORNO_ANTWORT);
  const beleg = fromReceiptPayload({ ...BELEG_NUTZLAST, receiptId: 'kasse-1-ID-12' });
  await cancelReceipt(rufen, { receipt: beleg, reason: 'kunde_storniert', paymentMethod: KeckPaymentMethod.cash });
  const { params } = gesendet(aufrufe);
  assert.deepEqual(params, {
    cashregisterId: KASSEN_ID,
    originalReceiptId: 'kasse-1-ID-12',
    reason: 'kunde_storniert',
    paymentMethod: 'cash',
  });
});

test('cancelReceipt prueft die Eingabe, bevor etwas hinausgeht', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg(STORNO_ANTWORT);
  await assert.rejects(
    () => cancelReceipt(rufen, { cashregisterId: KASSEN_ID, originalReceiptId: 'x', reason: 'weil' as never }),
    /Storno-Grund/,
  );
  await assert.rejects(
    () => cancelReceipt(rufen, { cashregisterId: KASSEN_ID, originalReceiptId: 'x', reason: 'sonstiges', items: [{ index: 0, quantity: 0 }] }),
    /Storno-Menge/,
  );
  await assert.rejects(
    () => cancelReceipt(rufen, { cashregisterId: KASSEN_ID, originalReceiptId: 'x', reason: 'sonstiges', note: 'x'.repeat(201) }),
    /Anmerkung/,
  );
  await assert.rejects(
    () => cancelReceipt(rufen, { cashregisterId: '', originalReceiptId: 'x', reason: 'sonstiges' }),
    /cashregisterId/,
  );
  assert.equal(aufrufe.length, 0);
});

test('cancelReceipt weist eine Antwort ohne Bezug oder ohne Restmengen zurueck', async () => {
  const ohneBezug = apiSchluesselWeg({ receipt: BELEG_NUTZLAST, remaining: [0] });
  await assert.rejects(
    () => cancelReceipt(ohneBezug.rufen, { cashregisterId: KASSEN_ID, originalReceiptId: 'x', reason: 'sonstiges' }),
    /cancellationOf/,
  );
  const ohneReste = apiSchluesselWeg({ receipt: BELEG_NUTZLAST, cancellationOf: { receiptId: 'x', fullReceiptId: null } });
  await assert.rejects(
    () => cancelReceipt(ohneReste.rufen, { cashregisterId: KASSEN_ID, originalReceiptId: 'x', reason: 'sonstiges' }),
    /remaining/,
  );
});

test('cancelReceipt: uebergebene Zahlungsart sticht die des Belegs', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg(STORNO_ANTWORT);
  const beleg: Receipt = {
    receiptId: 'r-1',
    cashregisterId: KASSEN_ID,
    timeStamp: '2026-08-13T10:15:00',
    items: [KAFFEE],
    vouchers: [],
    paymentMethod: KeckPaymentMethod.creditCard,
    turnoverCounterAES256ICM: 'ZAEHLER',
    signaturePreviousReceipt: 'VORGAENGER',
    certificateSerialNumber: '6F0404F0',
    receiptType: ReceiptType.standard,
    sig: 'SIGNATUR',
    qr: 'QR',
    fullReceiptId: 'ENC-FULL-ID',
    customerDetails: [],
    legalMessage: [],
  };

  await cancelReceipt(rufen, { receipt: beleg, reason: 'falsche_zahlart', paymentMethod: KeckPaymentMethod.cash });

  const { endpunkt, params } = gesendet(aufrufe);
  assert.equal(endpunkt, 'cancelReceipt');
  assert.equal(params['paymentMethod'], 'cash');
});

test('createCancelReceipt storniert die uebergebenen Positionen unveraendert', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg();
  const minus: ReceiptItem = { name: 'Kaffee', quantity: 1, vat: VatRate.vat20, priceCents: -320 };

  await createCancelReceipt(rufen, { paymentMethod: KeckPaymentMethod.cash, items: [minus] });

  const { endpunkt, params } = gesendet(aufrufe);
  assert.equal(endpunkt, 'createReceipt');
  assert.deepEqual(params, {
    receiptType: 'cancellation',
    items: [{ name: 'Kaffee', quantity: 1, unitPriceCents: -320, vatRate: 20 }],
    paymentMethod: 'cash',
  });
});

// --- zeroReceipt -------------------------------------------------------

test('zeroReceipt sendet nur receiptType zero — keine Zahlungsart, keine Positionen', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg();

  await zeroReceipt(rufen);

  const { endpunkt, params } = gesendet(aufrufe);
  assert.equal(endpunkt, 'createReceipt');
  assert.deepEqual(params, { receiptType: 'zero' });
});

// --- getReceipt / generateFullReceiptId / getFirstReceiptDate ----------

test('getReceipt ruft getReceipt mit receiptId und liefert den Beleg', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg();

  const beleg = await getReceipt(rufen, 'r-1');

  const { endpunkt, params } = gesendet(aufrufe);
  assert.equal(endpunkt, 'getReceipt');
  assert.deepEqual(params, { receiptId: 'r-1' });
  assert.equal(beleg.receiptId, 'r-1');
});

test('generateFullReceiptId ruft generateFullReceiptId mit receiptId und liefert fullReceiptId', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg({ fullReceiptId: 'ENC-NEU' });

  const id = await generateFullReceiptId(rufen, 'r-1');

  const { endpunkt, params } = gesendet(aufrufe);
  assert.equal(endpunkt, 'generateFullReceiptId');
  assert.deepEqual(params, { receiptId: 'r-1' });
  assert.equal(id, 'ENC-NEU');
});

test('getFirstReceiptDate ruft ohne Parameter auf und liefert den Berichtsmonat', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg('2026-03-14T09:30:00');

  const monat = await getFirstReceiptDate(rufen);

  const { endpunkt, params } = gesendet(aufrufe);
  assert.equal(endpunkt, 'getFirstReceiptDate');
  assert.deepEqual(params, {});
  assert.deepEqual(monat, { month: 3, year: 2026 });
});

test('getFirstReceiptDate deutet den Zeitstempel als Wiener Wanduhrzeit', async () => {
  // Wiener Wanduhrzeit 01.03. 00:30 ist als echter Zeitpunkt der 28.02. 23:30 UTC.
  // Der Berichtsmonat ist trotzdem Maerz — und zwar unabhaengig von der
  // Zeitzone des ausfuehrenden Rechners.
  const { rufen } = apiSchluesselWeg('2026-03-01T00:30:00');

  assert.deepEqual(await getFirstReceiptDate(rufen), { month: 3, year: 2026 });
});

// --- Anmeldewege -------------------------------------------------------

test('Kassen-Benutzer-Weg: cashregisterId geht bei jedem erlaubten Aufruf mit', async () => {
  for (const [name, aufruf] of [
    ['createReceipt', (r: KasseneckTransport) => sellReceipt(r, { paymentMethod: KeckPaymentMethod.cash, items: [KAFFEE] })],
    ['getReceipt', (r: KasseneckTransport) => getReceipt(r, 'r-1')],
    ['generateFullReceiptId', (r: KasseneckTransport) => generateFullReceiptId(r, 'r-1')],
  ] as const) {
    const { rufen, aufrufe } = kassenBenutzerWeg(name === 'generateFullReceiptId' ? { fullReceiptId: 'X' } : BELEG_ANTWORT);
    await aufruf(rufen);
    const { endpunkt, params } = gesendet(aufrufe);
    assert.equal(endpunkt, name);
    assert.equal(params['cashregisterId'], KASSEN_ID, `${name}: cashregisterId fehlt`);
  }
});

test('API-Schluessel-Weg: keine cashregisterId in der Nutzlast — die Kasse steckt im Token', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg();

  await sellReceipt(rufen, { paymentMethod: KeckPaymentMethod.cash, items: [KAFFEE] });

  const { params } = gesendet(aufrufe);
  assert.ok(!('cashregisterId' in params), 'cashregisterId gehoert nicht in die Nutzlast des API-Schluessel-Wegs');
});

// --- gemeinsame Umsetzung ----------------------------------------------

test('createReceipt lehnt Gutscheine auf Belegtypen ab, die keine erlauben', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg();
  const gutschein: Voucher = { action: VoucherAction.sell, type: VoucherType.value, valueCents: 500 };

  await assert.rejects(() => createReceipt(rufen, { receiptType: ReceiptType.zero, vouchers: [gutschein] }), /Gutschein/i);
  assert.equal(aufrufe.length, 0);
});

test('checkVoucherCombinationError deckt die Kombinationsregeln des Vorbilds ab', () => {
  const wert = (action: string): Voucher => ({ action, type: VoucherType.value, valueCents: 500 });
  const promo = (action: string): Voucher => ({ action, type: VoucherType.promo, valueCents: 500 });

  assert.equal(checkVoucherCombinationError([wert(VoucherAction.sell)], []), null);
  assert.match(checkVoucherCombinationError([promo(VoucherAction.sell)], [KAFFEE]) ?? '', /promo/);
  assert.match(checkVoucherCombinationError([promo(VoucherAction.redeem), promo(VoucherAction.redeem)], [KAFFEE]) ?? '', /promo/);
  assert.match(
    checkVoucherCombinationError([promo(VoucherAction.redeem), wert(VoucherAction.redeem)], [KAFFEE]) ?? '',
    /kombiniert/,
  );
  assert.match(checkVoucherCombinationError([promo(VoucherAction.redeem), wert(VoucherAction.sell)], [KAFFEE]) ?? '', /verkauft/);
  assert.match(checkVoucherCombinationError([wert(VoucherAction.redeem)], []) ?? '', /item/);
  assert.equal(checkVoucherCombinationError([wert(VoucherAction.redeem)], [KAFFEE]), null);
});

// --- Factory -----------------------------------------------------------

test('createKasseneckApi bindet die Beleg-Aufrufe an einen Transport', async () => {
  const { holen, aufrufe } = fetchFake(erfolg(BELEG_ANTWORT));
  const api = createKasseneckApi({
    auth: apiKeyAuth({ apiKey: API_KEY, cashregisterToken: KASSEN_TOKEN }),
    fetch: holen,
  });

  const beleg = await api.sellReceipt({ paymentMethod: KeckPaymentMethod.cash, items: [KAFFEE] });

  const { endpunkt } = gesendet(aufrufe);
  assert.equal(endpunkt, 'createReceipt');
  assert.equal(beleg.receiptId, 'r-1');
});

// --- Fehlerarten -------------------------------------------------------
//
// Die Fehler-Union des Pakets soll dicht bleiben: ein Verbraucher, der nach
// den Waechtern verzweigt, darf mit keinem Fehler dieses Pakets im
// "unbekannt"-Zweig landen.

test('Aufrufer-Pruefungen werfen KasseneckValidationError, nicht nacktes Error', async () => {
  const { rufen } = apiSchluesselWeg();

  const faelle: Array<() => Promise<unknown>> = [
    () => sellReceipt(rufen, { paymentMethod: KeckPaymentMethod.cash, items: [] }),
    () => sellReceipt(rufen, { paymentMethod: KeckPaymentMethod.cash, items: [{ name: '', quantity: 1, vat: VatRate.vat20, priceCents: 1 }] }),
    () =>
      sellReceipt(rufen, {
        paymentMethod: KeckPaymentMethod.creditCard,
        items: [KAFFEE],
        creditCardProvider: CreditCardProvider.stripe,
      }),
    () => sellReceipt(rufen, { paymentMethod: KeckPaymentMethod.cash, items: [KAFFEE], vouchers: [{ action: VoucherAction.sell, type: VoucherType.value }] }),
    () => createReceipt(rufen, { receiptType: ReceiptType.zero, vouchers: [{ action: VoucherAction.sell, type: VoucherType.value, valueCents: 500 }] }),
    // Steuersatz, den dieses Paket nicht kennt: kommt aus dem Modell-Schreibpfad
    // und darf ebenfalls nicht als nacktes Error durchschlagen.
    () => sellReceipt(rufen, { paymentMethod: KeckPaymentMethod.cash, items: [{ name: 'X', quantity: 1, vat: 999, priceCents: 100 }] }),
  ];

  for (const [i, fall] of faelle.entries()) {
    const fehler = await fall().then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(isKasseneckValidationError(fehler), `Fall ${i}: erwartet KasseneckValidationError, bekam ${String(fehler)}`);
    assert.equal(fehler.scope, 'request');
    assert.equal(fehler.functionName, 'createReceipt');
    assert.ok(istKasseneckFehler(fehler), `Fall ${i}: faellt aus der Fehler-Union`);
  }
});

test('unbrauchbare Antwortformen werfen KasseneckValidationError mit scope response', async () => {
  const faelle: Array<{ daten: unknown; aufruf: (r: KasseneckTransport) => Promise<unknown>; name: string }> = [
    { daten: { uid: 'ATU1' }, aufruf: (r) => getReceipt(r, 'r-1'), name: 'getReceipt' },
    { daten: { uid: 'ATU1' }, aufruf: (r) => sellReceipt(r, { paymentMethod: KeckPaymentMethod.cash, items: [KAFFEE] }), name: 'createReceipt' },
    { daten: {}, aufruf: (r) => generateFullReceiptId(r, 'r-1'), name: 'generateFullReceiptId' },
    { daten: { nichts: true }, aufruf: (r) => getFirstReceiptDate(r), name: 'getFirstReceiptDate' },
  ];

  for (const fall of faelle) {
    const { rufen } = apiSchluesselWeg(fall.daten);
    const fehler = await fall.aufruf(rufen).then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(isKasseneckValidationError(fehler), `${fall.name}: erwartet KasseneckValidationError, bekam ${String(fehler)}`);
    assert.equal(fehler.scope, 'response');
    assert.equal(fehler.functionName, fall.name);
  }
});

test('kein Geheimnis wandert in einen Fehler der Beleg-Endpunkte', async () => {
  const { rufen } = kassenBenutzerWeg({ uid: 'ATU1' });

  const fehler = await getReceipt(rufen, 'r-1').then(
    () => null,
    (e: unknown) => e,
  );

  const gedruckt = `${String(fehler)} ${inspect(fehler, { depth: 10 })}`;
  for (const geheim of [API_KEY, KASSEN_TOKEN, ID_TOKEN, SITZUNG]) {
    assert.ok(!gedruckt.includes(geheim), `Geheimnis im Fehler sichtbar: ${geheim}`);
  }
});

test('getFirstReceiptDate: unlesbarer Zeitstempel kommt als KasseneckValidationError, nicht als nacktes Error', async () => {
  for (const roh of ['gestern', '2026-99-99T00:00:00Z', '']) {
    const { rufen } = apiSchluesselWeg(roh);
    const fehler = await getFirstReceiptDate(rufen).then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(isKasseneckValidationError(fehler), `"${roh}": erwartet KasseneckValidationError, bekam ${String(fehler)}`);
    assert.equal(fehler.scope, 'response');
    assert.equal(fehler.functionName, 'getFirstReceiptDate');
    assert.ok(istKasseneckFehler(fehler), `"${roh}": faellt aus der Fehler-Union`);
  }
});

test('getFirstReceiptDate liefert nie einen NaN-Berichtsmonat', async () => {
  // '2026-99-99T00:00:00Z' trug frueher still ein Invalid Date bis in den
  // Berichtsmonat durch: {month: NaN, year: NaN} ohne einen einzigen Fehler.
  const { rufen } = apiSchluesselWeg('2026-99-99T00:00:00Z');
  const monat = await getFirstReceiptDate(rufen).then(
    (m) => m,
    () => null,
  );
  assert.equal(monat, null, 'ein unlesbarer Zeitstempel darf keinen Berichtsmonat ergeben');
});

// --- Zahlungsart: Aufrufer streng, Serverwert roh ------------------------

test('benannte Aufrufe pruefen die Zahlungsart auch ohne Typpruefung des Aufrufers', async () => {
  // Ein JS-Verbraucher ohne Typen faellt durch das Typnetz. Ohne
  // Laufzeitpruefung ginge 'klarna' hinaus und faellt erst am Server auf.
  const faelle: Array<{ name: string; aufruf: (r: KasseneckTransport) => Promise<unknown> }> = [
    { name: 'sellReceipt', aufruf: (r) => sellReceipt(r, { paymentMethod: 'klarna' as KeckPaymentMethodKey, items: [KAFFEE] }) },
    { name: 'createCancelReceipt', aufruf: (r) => createCancelReceipt(r, { paymentMethod: 'klarna' as KeckPaymentMethodKey, items: [KAFFEE] }) },
  ];

  for (const fall of faelle) {
    const { rufen, aufrufe } = apiSchluesselWeg();
    const fehler = await fall.aufruf(rufen).then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(isKasseneckValidationError(fehler), `${fall.name}: erwartet KasseneckValidationError, bekam ${String(fehler)}`);
    assert.equal(fehler.scope, 'request');
    assert.match(fehler.reason, /Zahlungsart/);
    assert.equal(aufrufe.length, 0, `${fall.name}: es darf nichts gesendet werden`);
  }
});

test('cancelReceipt prueft eine ausdruecklich uebergebene Zahlungsart ebenfalls', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg();
  const beleg: Receipt = {
    receiptId: 'r-1',
    cashregisterId: KASSEN_ID,
    timeStamp: '2026-08-13T10:15:00',
    items: [KAFFEE],
    vouchers: [],
    paymentMethod: KeckPaymentMethod.cash,
    turnoverCounterAES256ICM: 'ZAEHLER',
    signaturePreviousReceipt: 'VORGAENGER',
    certificateSerialNumber: '6F0404F0',
    receiptType: ReceiptType.standard,
    sig: 'SIGNATUR',
    qr: 'QR',
    fullReceiptId: 'ENC-FULL-ID',
    customerDetails: [],
    legalMessage: [],
  };

  await assert.rejects(
    () => cancelReceipt(rufen, { receipt: beleg, reason: 'sonstiges', paymentMethod: 'klarna' as KeckPaymentMethodKey }),
    /Zahlungsart/,
  );
  assert.equal(aufrufe.length, 0);
});

/**
 * Der ganze Weg: verkaufen, zuruecklesen, layouten.
 *
 * Das Backend speichert Positionen in der v1-Form (`normalizeMoneyInputs` in
 * functions/index.js: quantity->amount, unitPriceCents->priceOneCents) und
 * prueft nur `unitPriceCents` auf Ganzzahligkeit — eine gebrochene Menge
 * kaeme durch und wuerde mitsigniert. Aus diesem Paket geht sie deshalb gar
 * nicht erst hinaus.
 *
 * Der Waechter formuliert genau diese Zusage: **entweder** wird der Verkauf
 * abgelehnt, bevor etwas rausgeht, **oder** der gelayoutete Beleg traegt exakt
 * den Betrag, der gesendet (und damit signiert) wurde.
 *
 * Fuer Belege aus **fremder** Hand gilt die Gegenprobe am Ende dieser Datei:
 * die kommen unveraendert durch den Lesepfad und werden gedruckt, wie sie
 * signiert wurden.
 */
function backendMitV1Speicherung(): { rufen: KasseneckTransport; gesendet: Array<Record<string, unknown>> } {
  const gesendet: Array<Record<string, unknown>> = [];
  const holen: FetchLike = async (_url, init) => {
    const rumpf = JSON.parse(init.body) as { params: Record<string, unknown> };
    gesendet.push(rumpf.params);
    const positionen = (rumpf.params['items'] ?? []) as Array<Record<string, number | string>>;
    return erfolg({
      ...BELEG_ANTWORT,
      receipt: {
        ...BELEG_NUTZLAST,
        // genau die Abbildung des Backends
        items: positionen.map((i) => ({
          name: i['name'],
          amount: i['quantity'],
          priceOneCents: i['unitPriceCents'],
          priceOne: (i['unitPriceCents'] as number) / 100,
          vat: i['vatRate'],
        })),
      },
    });
  };
  return { rufen: createTransport({ auth: apiKeyAuth({ apiKey: API_KEY, cashregisterToken: KASSEN_TOKEN }), fetch: holen }), gesendet };
}

test('gedruckter Beleg widerspricht nie dem signierten — auch nicht bei gebrochener Menge', async () => {
  for (const menge of [1, 2, 0.35, 3.7, 12]) {
    const { rufen, gesendet } = backendMitV1Speicherung();
    const ergebnis = await sellReceiptWithCompany(rufen, {
      paymentMethod: KeckPaymentMethod.cash,
      items: [{ name: 'Käse', quantity: menge, vat: VatRate.vat20, priceCents: 1990 }],
    }).then(
      (wert) => ({ wert }),
      (fehler: unknown) => ({ fehler }),
    );

    if ('fehler' in ergebnis) {
      // Abgelehnt — dann darf auch nichts rausgegangen sein.
      assert.ok(
        isKasseneckValidationError(ergebnis.fehler),
        `Menge ${menge}: erwartet KasseneckValidationError, bekam ${inspect(ergebnis.fehler)}`,
      );
      assert.equal(ergebnis.fehler.scope, 'request');
      assert.equal(gesendet.length, 0, `Menge ${menge}: es darf nichts gesendet werden`);
      continue;
    }

    // Angenommen — dann muss der gedruckte Betrag dem signierten entsprechen.
    const gesendetePositionen = gesendet[0]?.['items'] as Array<{ quantity: number; unitPriceCents: number }>;
    const signiertCents = gesendetePositionen.reduce((s, i) => s + i.quantity * i.unitPriceCents, 0);
    const layout = buildReceiptLayout(ergebnis.wert.receipt, ergebnis.wert.company);
    const gesamtZeile = layout.lines.find(
      (zeile): zeile is Extract<typeof zeile, { kind: 'columns' }> =>
        zeile.kind === 'columns' && zeile.columns[0]?.text === 'Gesamt:',
    );
    assert.equal(
      gesamtZeile?.columns[1]?.text,
      `${formatCents(signiertCents)} €`,
      `Menge ${menge}: gedruckte Summe muss der signierten entsprechen`,
    );
    assert.equal(receiptSumCents(ergebnis.wert.receipt), signiertCents, `Menge ${menge}: Belegsumme`);
  }
});

test('eine gebrochene Menge ist keine sendbare Position (Modellpruefung)', () => {
  const brueche: ReceiptItem[] = [
    { name: 'Käse', quantity: 0.35, vat: VatRate.vat20, priceCents: 1990 },
    { name: 'Käse', quantity: 3.7, vat: VatRate.vat20, priceCents: 1990 },
    { name: 'Käse', quantity: Number.NaN, vat: VatRate.vat20, priceCents: 1990 },
    { name: 'Käse', quantity: Number.POSITIVE_INFINITY, vat: VatRate.vat20, priceCents: 1990 },
  ];
  for (const position of brueche) {
    assert.equal(receiptItemIsValid(position), false, `Menge ${position.quantity} darf nicht gueltig sein`);
    assert.throws(() => toReceiptItemPayload(position), /Menge/, `Menge ${position.quantity} darf nicht hinausgehen`);
  }
  // Ganze Mengen bleiben unveraendert gueltig.
  assert.equal(receiptItemIsValid({ name: 'Käse', quantity: 2, vat: VatRate.vat20, priceCents: 1990 }), true);
});

/**
 * Die Fehler-Union endete an der Endpunkt-Schicht: unterhalb davon kamen
 * nackte `TypeError` heraus, obwohl errors.ts zusagt, alle Fehler dieses
 * Pakets aufzuzaehlen.
 */
test('cancelReceipt: ohne eigene Zahlungsart geht keine mit -- der Server nimmt die des Originals', async () => {
  // Frueher negierte das Paket lokal und musste die Zahlungsart des Belegs
  // (auch null oder eine ihm unbekannte) selbst weiterreichen. Jetzt kennt der
  // Server das Original; das Paket schickt nur, was der Aufrufer ausdruecklich
  // will. Ein Beleg ohne Zahlungsart oder mit einer dem Paket unbekannten
  // ist deshalb kein Sonderfall mehr.
  const { rufen, aufrufe } = apiSchluesselWeg(STORNO_ANTWORT);
  const beleg = { ...fromReceiptPayload(BELEG_NUTZLAST), paymentMethod: 'klarna' } as unknown as Receipt;
  await cancelReceipt(rufen, { receipt: beleg, reason: 'sonstiges' });
  const gesendet = JSON.parse(aufrufe[0]!.init.body) as { params: Record<string, unknown> };
  assert.equal('paymentMethod' in gesendet.params, false);
  assert.equal(gesendet.params['originalReceiptId'], BELEG_NUTZLAST.receiptId);
});

test('getReceipt: ein Beleg mit unbrauchbaren Positionen ist ein Antwortfehler, kein TypeError', async () => {
  const faelle: Array<[string, unknown]> = [
    ['items als Zeichenkette', { ...BELEG_NUTZLAST, items: 'text' }],
    ['items als Zahl', { ...BELEG_NUTZLAST, items: 7 }],
    ['vouchers als Zeichenkette', { ...BELEG_NUTZLAST, vouchers: 'text' }],
    ['receipt als Zeichenkette', 'kein Beleg'],
    ['receipt als Liste', []],
  ];
  for (const [name, beleg] of faelle) {
    const { holen } = fetchFake(erfolg({ receipt: beleg }));
    const rufen = createTransport({ auth: apiKeyAuth({ apiKey: API_KEY, cashregisterToken: KASSEN_TOKEN }), fetch: holen });
    const fehler = await getReceipt(rufen, 'r-1').then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(isKasseneckValidationError(fehler), `${name}: erwartet KasseneckValidationError, bekam ${inspect(fehler)}`);
    assert.equal(fehler.scope, 'response', name);
    assert.equal(fehler.functionName, 'getReceipt', name);
  }
});

test('getReceipt: ein Nullbeleg ohne Positionen bleibt lesbar', async () => {
  // Die Verschaerfung oben darf den Normalfall nicht treffen: Nullbelege
  // tragen weder items noch vouchers.
  const { holen } = fetchFake(erfolg({ receipt: { ...BELEG_NUTZLAST, items: null, vouchers: null } }));
  const rufen = createTransport({ auth: apiKeyAuth({ apiKey: API_KEY, cashregisterToken: KASSEN_TOKEN }), fetch: holen });
  const beleg = await getReceipt(rufen, 'r-1');
  assert.deepEqual(beleg.items, []);
  assert.deepEqual(beleg.vouchers, []);
});

/**
 * Gegenprobe zum Durchstich weiter oben: derselbe Weg (lesen, layouten), aber
 * mit einem Beleg, den **dieses Paket nicht erzeugt hat**.
 *
 * Die Schreibpfad-Ablehnung schuetzt nur unsere eigenen Belege. Am HTTP-API
 * haengt aber auch fremde Software, und das Backend prueft bei den Positionen
 * allein `unitPriceCents` auf Ganzzahligkeit — eine gebrochene Menge ist dort
 * also ausstellbar und wird mitsigniert. Schnitte der Lesepfad sie ab, zeigte
 * unser Ausdruck einen anderen Betrag als die Signatur, und zwar lautlos.
 *
 * Lesen bleibt tolerant, schreiben streng: der Wert kommt herein, wie er ist.
 */
test('ein fremd erzeugter Beleg wird gedruckt, wie er signiert wurde', async () => {
  const MENGE = 0.35;
  const EINZELPREIS_CENT = 1990;
  // v1-Positionsform, wie das Backend sie ablegt (normalizeMoneyInputs).
  const { holen } = fetchFake(
    erfolg({
      ...BELEG_ANTWORT,
      receipt: {
        ...BELEG_NUTZLAST,
        items: [
          {
            name: 'Käse',
            amount: MENGE,
            priceOneCents: EINZELPREIS_CENT,
            priceOne: EINZELPREIS_CENT / 100,
            vat: 20,
          },
        ],
      },
    }),
  );
  const rufen = createTransport({ auth: apiKeyAuth({ apiKey: API_KEY, cashregisterToken: KASSEN_TOKEN }), fetch: holen });
  const { receipt, company } = await getReceiptWithCompany(rufen, 'r-1');

  // Die Menge kommt herein, wie sie signiert wurde — nicht abgeschnitten.
  assert.equal(receipt.items[0]?.quantity, MENGE);

  const signiertCents = MENGE * EINZELPREIS_CENT;
  assert.equal(receiptSumCents(receipt), signiertCents);

  const layout = buildReceiptLayout(receipt, company);
  const gesamtZeile = layout.lines.find(
    (zeile): zeile is Extract<typeof zeile, { kind: 'columns' }> =>
      zeile.kind === 'columns' && zeile.columns[0]?.text === 'Gesamt:',
  );
  assert.equal(
    gesamtZeile?.columns[1]?.text,
    `${formatCents(signiertCents)} €`,
    'die gedruckte Summe muss die signierte sein',
  );
});

test('getReceiptWithCompany: Testkasse/Testsignatur, kopfId und mitgeliefertes Zeilenmodell kommen durch (fehlen: false/null)', async () => {
  const layout = { lines: [{ kind: 'banner', text: 'TESTSIGNATUR — kein gültiger Beleg', ton: 'warnung' }], paperSize: 'mm80', regelwerk: 1 };
  const { holen } = fetchFake(erfolg({ ...BELEG_ANTWORT, testKasse: false, testSignatur: true, kopfId: 'v1', layout, pruefangaben: { karteRegistriertAm: '2024-03-12', kasseRegistriertAm: null } }));
  const rufen = createTransport({ auth: apiKeyAuth({ apiKey: API_KEY, cashregisterToken: KASSEN_TOKEN }), fetch: holen });
  const antwort = await getReceiptWithCompany(rufen, 'r-1');
  assert.equal(antwort.testKasse, false);
  assert.equal(antwort.testSignatur, true);
  assert.equal(antwort.kopfId, 'v1');
  assert.deepEqual(antwort.layout, layout);
  assert.deepEqual(antwort.pruefangaben, { karteRegistriertAm: '2024-03-12', kasseRegistriertAm: null });
  // Rot-Probe: altes Backend ohne die Felder
  const { holen: alt } = fetchFake(erfolg({ ...BELEG_ANTWORT }));
  const a2 = await getReceiptWithCompany(createTransport({ auth: apiKeyAuth({ apiKey: API_KEY, cashregisterToken: KASSEN_TOKEN }), fetch: alt }), 'r-1');
  assert.equal(a2.testKasse, false);
  assert.equal(a2.testSignatur, false);
  assert.equal(a2.kopfId, null);
  assert.equal(a2.pruefangaben, null);
  assert.equal(a2.layout, null);
});
