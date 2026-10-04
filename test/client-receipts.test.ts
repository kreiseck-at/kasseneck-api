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
  POS_BASE_URL,
  type FetchLike,
  type HttpRequestInit,
  type HttpResponseLike,
  type KasseneckTransport,
} from '../src/client/transport.js';
import { apiKeyAuth, registerUserAuth } from '../src/client/auth.js';
import { ReceiptType, VatRate, KeckPaymentMethod, type KeckPaymentMethodKey, CreditCardProvider, VoucherAction, VoucherType } from '../src/enums/index.js';
import type { Receipt, ReceiptItem, ReceiptPayload, ReceiptPaymentInput, Voucher } from '../src/models/index.js';
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
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : name.toLowerCase() === 'kasseneck-api-version' ? 'v3' : null) },
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
  certificateSerialNumber: '5A1C3E07',
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
  vatId: 'ATU12345678',
  is_small_business: false,
  taxNumber: '12/345/6789',
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

/** Barzahlung ueber den Betrag von KAFFEE; unter /v3 ist die Zahlungsliste Pflicht. */
const BAR: ReceiptPaymentInput[] = [{ method: KeckPaymentMethod.cash, amountCents: 320 }];

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

/**
 * Liest Endpunktname und gesendete Parameter aus dem einzigen Aufruf. `basis`
 * ist die erwartete Basis: oeffentlich (api_key) oder Kassenweg
 * (Kassen-Benutzer, Kanal app).
 */
function gesendet(aufrufe: Aufruf[], basis: string = DEFAULT_BASE_URL): { endpunkt: string; params: Record<string, unknown> } {
  assert.equal(aufrufe.length, 1, 'genau ein Aufruf erwartet');
  const aufruf = aufrufe[0]!;
  assert.ok(aufruf.url.startsWith(`${basis}/`), `unerwartete URL: ${aufruf.url}`);
  const endpunkt = aufruf.url.slice(basis.length + 1);
  const rumpf = JSON.parse(aufruf.init.body) as { params: Record<string, unknown> };
  return { endpunkt, params: rumpf.params };
}

// --- sellReceipt -------------------------------------------------------

test('sellReceipt ruft createReceipt mit receiptType standard, items und payments', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg();

  await sellReceipt(rufen, { payments: BAR, items: [KAFFEE] });

  const { endpunkt, params } = gesendet(aufrufe);
  assert.equal(endpunkt, 'createReceipt');
  assert.deepEqual(params, {
    receiptType: 'standard',
    items: [{ name: 'Kaffee', quantity: 1, unitPriceCents: 320, vatRate: 20 }],
    payments: [{ method: 'cash', amountCents: 320 }],
  });
});

test('sellReceipt liefert den Beleg aus data.receipt', async () => {
  const { rufen } = apiSchluesselWeg();

  const beleg: Receipt = await sellReceipt(rufen, { payments: BAR, items: [KAFFEE] });

  assert.equal(beleg.receiptId, 'r-1');
  assert.equal(beleg.fullReceiptId, 'ENC-FULL-ID');
  assert.equal(beleg.receiptType, ReceiptType.standard);
  assert.equal(beleg.paymentMethod, KeckPaymentMethod.cash);
  assert.deepEqual(beleg.items, [KAFFEE]);
});

test('sellReceipt: customerDetails und legalMessage gehen als \\n-verbundene Zeichenkette', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg();

  await sellReceipt(rufen, {
    payments: BAR,
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

test('sellReceipt mit Kartenzahlung: Anbieter, Kennung und Terminaldaten stehen in der Zahlung', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg();

  await sellReceipt(rufen, {
    items: [KAFFEE],
    payments: [{
      method: KeckPaymentMethod.creditCard,
      amountCents: 320,
      provider: CreditCardProvider.hobexCloudApi,
      providerPaymentId: 'tx-1',
      providerData: { approvalCode: 'A1' },
    }],
  });

  const { params } = gesendet(aufrufe);
  assert.deepEqual(params, {
    receiptType: 'standard',
    items: [{ name: 'Kaffee', quantity: 1, unitPriceCents: 320, vatRate: 20 }],
    payments: [{ method: 'creditCard', amountCents: 320, provider: 'hobexCloudApi', providerPaymentId: 'tx-1', providerData: { approvalCode: 'A1' } }],
  });
  for (const alt of ['paymentMethod', 'creditCardProvider', 'cardPaymentId', 'cardPaymentData']) {
    assert.equal(alt in params, false, `${alt} gibt es unter /v3 nicht`);
  }
});

test('sellReceipt sendet Gutscheine nur mit valueCents (ganze Cent, kein Euro-Wert)', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg();
  const gutschein: Voucher = {
    name: 'Wertgutschein',
    code: 'G-1',
    action: VoucherAction.sell,
    type: VoucherType.value,
    valueCents: 500,
  };

  await sellReceipt(rufen, { payments: [{ method: KeckPaymentMethod.cash, amountCents: 500 }], vouchers: [gutschein] });

  const { params } = gesendet(aufrufe);
  assert.deepEqual(params, {
    receiptType: 'standard',
    vouchers: [{ action: 'sell', type: 'value', valueCents: 500, code: 'G-1', name: 'Wertgutschein' }],
    payments: [{ method: 'cash', amountCents: 500 }],
  });
});

test('sellReceipt ohne Positionen und ohne Verkaufsgutschein wird abgelehnt', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg();

  await assert.rejects(() => sellReceipt(rufen, { payments: BAR, items: [] }), /Positionen/i);
  assert.equal(aufrufe.length, 0);
});

test('sellReceipt mit ungueltiger Position wird abgelehnt', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg();
  const ohneName: ReceiptItem = { name: '', quantity: 1, vat: VatRate.vat20, priceCents: 320 };

  await assert.rejects(() => sellReceipt(rufen, { payments: BAR, items: [ohneName] }), /Position/i);
  assert.equal(aufrufe.length, 0);
});

test('sellReceipt mit ungueltigem Gutschein wird abgelehnt', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg();
  const ohneWert: Voucher = { action: VoucherAction.sell, type: VoucherType.value };

  await assert.rejects(
    () => sellReceipt(rufen, { payments: BAR, items: [KAFFEE], vouchers: [ohneWert] }),
    /Gutschein/i,
  );
  assert.equal(aufrufe.length, 0);
});

// --- cancelReceipt -----------------------------------------------------
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
    reason: 'input_error',
    items: [{ index: 0, quantity: 1 }],
    note: 'Kunde wollte nur eine',
  });
  const { endpunkt, params } = gesendet(aufrufe);
  assert.equal(endpunkt, 'cancelReceipt');
  assert.deepEqual(params, {
    cashregisterId: KASSEN_ID,
    originalReceiptId: 'kasse-1-ID-12',
    reason: 'input_error',
    items: [{ index: 0, quantity: 1 }],
    note: 'Kunde wollte nur eine',
  });
  assert.equal(ergebnis.receipt.receiptType, ReceiptType.cancellation);
  assert.deepEqual(ergebnis.cancellationOf, { receiptId: 'kasse-1-ID-12', fullReceiptId: 'ENC-FULL-12' });
  assert.deepEqual(ergebnis.remaining, [0, 1]);
});

test('cancelReceipt reicht die Kartendaten der Erstattung in der Rueckzahlung durch', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg(STORNO_ANTWORT);
  await cancelReceipt(rufen, {
    cashregisterId: KASSEN_ID,
    originalReceiptId: 'kasse-1-ID-12',
    reason: 'customer_cancelled',
    payments: [{
      method: KeckPaymentMethod.creditCard,
      amountCents: -320,
      refundOf: 'p1',
      provider: CreditCardProvider.hobexHps,
      providerPaymentId: '178834783507100000',
      providerData: { cardNumber: '541333******0021' },
    }],
  });
  const { params } = gesendet(aufrufe);
  assert.deepEqual(params.payments, [{
    method: 'creditCard',
    amountCents: -320,
    provider: 'hobexHps',
    providerPaymentId: '178834783507100000',
    providerData: { cardNumber: '541333******0021' },
    refundOf: 'p1',
  }]);
});

test('cancelReceipt: Kartenfelder am Storno und unbekannter Anbieter gehen gar nicht erst raus', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg(STORNO_ANTWORT);
  await assert.rejects(
    () => cancelReceipt(rufen, { cashregisterId: KASSEN_ID, originalReceiptId: 'kasse-1-ID-12', reason: 'customer_cancelled', cardPaymentId: 'x' } as never),
    /cardPaymentId/,
  );
  await assert.rejects(
    () => cancelReceipt(rufen, { cashregisterId: KASSEN_ID, originalReceiptId: 'kasse-1-ID-12', reason: 'customer_cancelled', payments: [{ method: 'creditCard', amountCents: -1, provider: 'gibtsNicht' as CreditCardProvider }] }),
    /Kartenanbieter/,
  );
  assert.equal(aufrufe.length, 0);
});

test('cancelReceipt ohne Kartendaten schickt keine Kartenfelder', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg(STORNO_ANTWORT);
  await cancelReceipt(rufen, { cashregisterId: KASSEN_ID, originalReceiptId: 'kasse-1-ID-12', reason: 'input_error' });
  const { params } = gesendet(aufrufe);
  assert.equal('creditCardProvider' in params, false);
  assert.equal('cardPaymentId' in params, false);
  assert.equal('cardPaymentData' in params, false);
});

test('cancelReceipt nimmt auch den Beleg selbst als Bezug (Kasse und ID daraus)', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg(STORNO_ANTWORT);
  const beleg = fromReceiptPayload({ ...BELEG_NUTZLAST, receiptId: 'kasse-1-ID-12' });
  await cancelReceipt(rufen, { receipt: beleg, reason: 'customer_cancelled' });
  const { params } = gesendet(aufrufe);
  assert.deepEqual(params, {
    cashregisterId: KASSEN_ID,
    originalReceiptId: 'kasse-1-ID-12',
    reason: 'customer_cancelled',
  });
});

test('cancelReceipt prueft die Eingabe, bevor etwas hinausgeht', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg(STORNO_ANTWORT);
  await assert.rejects(
    () => cancelReceipt(rufen, { cashregisterId: KASSEN_ID, originalReceiptId: 'x', reason: 'weil' as never }),
    /Storno-Grund/,
  );
  await assert.rejects(
    () => cancelReceipt(rufen, { cashregisterId: KASSEN_ID, originalReceiptId: 'x', reason: 'other', items: [{ index: 0, quantity: 0 }] }),
    /Storno-Menge/,
  );
  await assert.rejects(
    () => cancelReceipt(rufen, { cashregisterId: KASSEN_ID, originalReceiptId: 'x', reason: 'other', note: 'x'.repeat(201) }),
    /Anmerkung/,
  );
  await assert.rejects(
    () => cancelReceipt(rufen, { cashregisterId: '', originalReceiptId: 'x', reason: 'other' }),
    /cashregisterId/,
  );
  assert.equal(aufrufe.length, 0);
});

test('cancelReceipt: Rueckgabe-Wahl als Vorgabe und je Position geht englisch hinaus', async () => {
  const { rufen, aufrufe } = kassenBenutzerWeg(STORNO_ANTWORT);
  await cancelReceipt(rufen, {
    cashregisterId: KASSEN_ID,
    originalReceiptId: 'kasse-1-ID-12',
    reason: 'customer_cancelled',
    returnDisposition: 'restock',
    items: [{ index: 0, quantity: 1, returnDisposition: 'defective' }, { index: 1, quantity: 2 }],
  });
  const { endpunkt, params } = gesendet(aufrufe, POS_BASE_URL);
  assert.equal(endpunkt, 'cancelReceipt');
  assert.equal(params.returnDisposition, 'restock');
  assert.deepEqual(params.items, [{ index: 0, quantity: 1, returnDisposition: 'defective' }, { index: 1, quantity: 2 }]);
});

test('cancelReceipt: Vollstorno mit Vorgabe sendet sie oben und ohne items', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg(STORNO_ANTWORT);
  await cancelReceipt(rufen, { cashregisterId: KASSEN_ID, originalReceiptId: 'kasse-1-ID-12', reason: 'other', returnDisposition: 'disposed' });
  const { params } = gesendet(aufrufe);
  assert.equal(params.returnDisposition, 'disposed');
  assert.equal('items' in params, false);
});

test('cancelReceipt: ohne Rueckgabe-Wahl geht kein returnDisposition hinaus (der Server bucht restock)', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg(STORNO_ANTWORT);
  await cancelReceipt(rufen, { cashregisterId: KASSEN_ID, originalReceiptId: 'kasse-1-ID-12', reason: 'input_error', items: [{ index: 0, quantity: 1 }] });
  const { params } = gesendet(aufrufe);
  assert.equal('returnDisposition' in params, false);
  assert.deepEqual(params.items, [{ index: 0, quantity: 1 }]);
});

test('cancelReceipt: innere, vertippte oder leere Vorgabe geht nicht hinaus und nennt das Feld', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg(STORNO_ANTWORT);
  const basis = { cashregisterId: KASSEN_ID, originalReceiptId: 'kasse-1-ID-12', reason: 'other' as const };
  await assert.rejects(
    () => cancelReceipt(rufen, { ...basis, returnDisposition: 'lager' as never }),
    (e) => isKasseneckValidationError(e) && /returnDisposition/.test(e.message) && !/items\[/.test(e.message) && /restock, defective, disposed/.test(e.message),
  );
  for (const wert of ['entsorgt', '', null, 'Restock', 1]) {
    await assert.rejects(() => cancelReceipt(rufen, { ...basis, returnDisposition: wert as never }), /returnDisposition/, `Vorgabe ${String(wert)}`);
  }
  assert.equal(aufrufe.length, 0);
});

test('cancelReceipt: innere, vertippte oder leere Wahl je Position geht nicht hinaus und nennt den Pfad', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg(STORNO_ANTWORT);
  const basis = { cashregisterId: KASSEN_ID, originalReceiptId: 'kasse-1-ID-12', reason: 'other' as const };
  await assert.rejects(
    () => cancelReceipt(rufen, { ...basis, items: [{ index: 0, quantity: 1 }, { index: 1, quantity: 1, returnDisposition: 'defekt' as never }] }),
    (e) => isKasseneckValidationError(e) && /items\[1\]\.returnDisposition/.test(e.message) && /restock, defective, disposed/.test(e.message),
  );
  for (const wert of ['lager', 'entsorgt', '', null, 'Restock', 1]) {
    await assert.rejects(
      () => cancelReceipt(rufen, { ...basis, items: [{ index: 0, quantity: 1, returnDisposition: wert as never }] }),
      /items\[0\]\.returnDisposition/,
      `Position ${String(wert)}`,
    );
  }
  assert.equal(aufrufe.length, 0);
});

test('cancelReceipt: eine Position geht nur mit den bekannten Feldern hinaus', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg(STORNO_ANTWORT);
  const position = { index: 0, quantity: 1, foo: 1 } as unknown as { index: number; quantity: number };
  await cancelReceipt(rufen, { cashregisterId: KASSEN_ID, originalReceiptId: 'kasse-1-ID-12', reason: 'other', items: [position] });
  assert.deepEqual(gesendet(aufrufe).params.items, [{ index: 0, quantity: 1 }]);
});

test('toReceiptItemPayload: originalIndex und returnDisposition gehen nie mit createReceipt hinaus', () => {
  const zeile = toReceiptItemPayload({ ...KAFFEE, articleId: 'coffee', originalIndex: 0, returnDisposition: 'restock' });
  assert.deepEqual(zeile, { name: 'Kaffee', quantity: 1, unitPriceCents: 320, vatRate: 20, articleId: 'coffee' });
});

test('cancelReceipt weist eine Antwort ohne Bezug oder ohne Restmengen zurueck', async () => {
  const ohneBezug = apiSchluesselWeg({ receipt: BELEG_NUTZLAST, remaining: [0] });
  await assert.rejects(
    () => cancelReceipt(ohneBezug.rufen, { cashregisterId: KASSEN_ID, originalReceiptId: 'x', reason: 'other' }),
    /cancellationOf/,
  );
  const ohneReste = apiSchluesselWeg({ receipt: BELEG_NUTZLAST, cancellationOf: { receiptId: 'x', fullReceiptId: null } });
  await assert.rejects(
    () => cancelReceipt(ohneReste.rufen, { cashregisterId: KASSEN_ID, originalReceiptId: 'x', reason: 'other' }),
    /remaining/,
  );
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

test('Kassen-Benutzer-Weg: cashregisterId geht bei jedem erlaubten Aufruf mit, ueber den Kassenweg', async () => {
  for (const [name, aufruf] of [
    ['createReceipt', (r: KasseneckTransport) => sellReceipt(r, { payments: BAR, items: [KAFFEE] })],
    ['getReceipt', (r: KasseneckTransport) => getReceipt(r, 'r-1')],
    ['generateFullReceiptId', (r: KasseneckTransport) => generateFullReceiptId(r, 'r-1')],
    ['cancelReceipt', (r: KasseneckTransport) => cancelReceipt(r, { cashregisterId: KASSEN_ID, originalReceiptId: 'kasse-1-ID-12', reason: 'input_error' })],
  ] as const) {
    const antwort = name === 'generateFullReceiptId' ? { fullReceiptId: 'X' } : name === 'cancelReceipt' ? STORNO_ANTWORT : BELEG_ANTWORT;
    const { rufen, aufrufe } = kassenBenutzerWeg(antwort);
    await aufruf(rufen);
    // Kassen-Benutzer: Kanal app ueber kasse.kasseneck.at/api/v3, nicht api.kasseneck.at.
    const { endpunkt, params } = gesendet(aufrufe, POS_BASE_URL);
    assert.equal(endpunkt, name);
    assert.equal(params['cashregisterId'], KASSEN_ID, `${name}: cashregisterId fehlt`);
  }
});

test('API-Schluessel-Weg: keine cashregisterId in der Nutzlast — die Kasse steckt im Token', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg();

  await sellReceipt(rufen, { payments: BAR, items: [KAFFEE] });

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

  const beleg = await api.sellReceipt({ payments: BAR, items: [KAFFEE] });

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
    () => sellReceipt(rufen, { payments: BAR, items: [] }),
    () => sellReceipt(rufen, { payments: BAR, items: [{ name: '', quantity: 1, vat: VatRate.vat20, priceCents: 1 }] }),
    // Alter Einzel-Zahlungsweg (ohne Typen): unter /v3 abgewiesen.
    () => sellReceipt(rufen, { items: [KAFFEE], paymentMethod: 'creditCard', creditCardProvider: CreditCardProvider.stripe } as never),
    () => sellReceipt(rufen, { payments: BAR, items: [KAFFEE], vouchers: [{ action: VoucherAction.sell, type: VoucherType.value }] }),
    () => createReceipt(rufen, { receiptType: ReceiptType.zero, vouchers: [{ action: VoucherAction.sell, type: VoucherType.value, valueCents: 500 }] }),
    // Steuersatz, den dieses Paket nicht kennt: kommt aus dem Modell-Schreibpfad
    // und darf ebenfalls nicht als nacktes Error durchschlagen.
    () => sellReceipt(rufen, { payments: BAR, items: [{ name: 'X', quantity: 1, vat: 999, priceCents: 100 }] }),
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
  // Ein signierender Aufruf dagegen: Erfolg gemeldet heisst, der Beleg kann
  // signiert sein. Die unbrauchbare Antwort ist darum ein Ausgang-unklar-Fehler.
  const { rufen } = apiSchluesselWeg({ uid: 'ATU1' });
  const signiert = await sellReceipt(rufen, { payments: BAR, items: [KAFFEE] }).then(() => null, (e: unknown) => e);
  assert.ok(isKasseneckApiError(signiert), String(signiert));
  assert.equal(signiert.code, 'response_unreadable');
  assert.equal(signiert.outcome, 'unknown');
  assert.equal(signiert.functionName, 'createReceipt');
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
    { name: 'sellReceipt', aufruf: (r) => sellReceipt(r, { payments: [{ method: 'klarna' as KeckPaymentMethodKey, amountCents: 320 }], items: [KAFFEE] }) },
    { name: 'cancelReceipt', aufruf: (r) => cancelReceipt(r, { cashregisterId: KASSEN_ID, originalReceiptId: 'r-1', reason: 'other', payments: [{ method: 'klarna' as KeckPaymentMethodKey, amountCents: -320 }] }) },
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
      payments: BAR,
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
  await cancelReceipt(rufen, { receipt: beleg, reason: 'other' });
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

test('getReceiptWithCompany: testCashregister/testSignature, headerVersionId und mitgeliefertes Zeilenmodell kommen durch (fehlen: false/null)', async () => {
  const layout = { lines: [{ kind: 'banner', text: 'TESTSIGNATUR – kein gültiger Beleg', tone: 'warning' }], paperSize: 'mm80', ruleset: 1 };
  const { holen } = fetchFake(erfolg({ ...BELEG_ANTWORT, testCashregister: false, testSignature: true, headerVersionId: 'v1', layout, registrationInfo: { cardRegisteredAt: '2024-03-12', cashregisterRegisteredAt: null } }));
  const rufen = createTransport({ auth: apiKeyAuth({ apiKey: API_KEY, cashregisterToken: KASSEN_TOKEN }), fetch: holen });
  const antwort = await getReceiptWithCompany(rufen, 'r-1');
  assert.equal(antwort.testCashregister, false);
  assert.equal(antwort.testSignature, true);
  assert.equal(antwort.headerVersionId, 'v1');
  assert.deepEqual(antwort.layout, layout);
  assert.deepEqual(antwort.registrationInfo, { cardRegisteredAt: '2024-03-12', cashregisterRegisteredAt: null });
  // Ohne die Felder: false bzw. null. Die alten deutschen Namen zaehlen nicht.
  const { holen: alt } = fetchFake(erfolg({ ...BELEG_ANTWORT, testKasse: true, testSignatur: true, kopfId: 'alt', pruefangaben: { karteRegistriertAm: 'x' } }));
  const a2 = await getReceiptWithCompany(createTransport({ auth: apiKeyAuth({ apiKey: API_KEY, cashregisterToken: KASSEN_TOKEN }), fetch: alt }), 'r-1');
  assert.equal(a2.testCashregister, false);
  assert.equal(a2.testSignature, false);
  assert.equal(a2.headerVersionId, null);
  assert.equal(a2.registrationInfo, null);
  assert.equal(a2.layout, null);
});

test('getReceiptWithCompany: logo_scale wird zur Logo-Stufe (fehlt, unbekannt oder altes logo_skala: M)', async () => {
  const faelle: ReadonlyArray<readonly [unknown, string]> = [['XL', 'XL'], ['S', 'S'], [undefined, 'M'], ['riesig', 'M'], [3, 'M'], [null, 'M']];
  for (const [roh, soll] of faelle) {
    const { holen } = fetchFake(erfolg({ ...BELEG_ANTWORT, ...(roh === undefined ? {} : { logo_scale: roh }) }));
    const rufen = createTransport({ auth: apiKeyAuth({ apiKey: API_KEY, cashregisterToken: KASSEN_TOKEN }), fetch: holen });
    const antwort = await getReceiptWithCompany(rufen, 'r-1');
    assert.equal(antwort.logoScale, soll, `logo_scale=${String(roh)}`);
  }
  const { holen } = fetchFake(erfolg({ ...BELEG_ANTWORT, logo_skala: 'XL' }));
  const alt = await getReceiptWithCompany(createTransport({ auth: apiKeyAuth({ apiKey: API_KEY, cashregisterToken: KASSEN_TOKEN }), fetch: holen }), 'r-1');
  assert.equal(alt.logoScale, 'M');
});

// --- Trinkgeld (Backend keck#201: Positionen kind:'tip', Parameter tip) -----

test('sellReceipt: tip als Zahl geht unveraendert als Cent hinaus', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg();
  await sellReceipt(rufen, { payments: BAR, items: [KAFFEE], tip: 200 });
  const { params } = gesendet(aufrufe);
  assert.equal(params['tip'], 200);
});

test('sellReceipt: tip als Objekt mit Zahlart (geprueft) und Empfaengern', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg();
  await sellReceipt(rufen, {
    payments: BAR,
    items: [KAFFEE],
    tip: {
      cents: 300,
      paymentMethod: KeckPaymentMethod.creditCard,
      recipients: [{ registerUserId: 'ru_7', cents: 200 }, { registerUserId: 'ru_9', cents: 100 }],
    },
  });
  const { params } = gesendet(aufrufe);
  assert.deepEqual(params['tip'], {
    cents: 300,
    paymentMethod: 'creditCard',
    recipients: [{ registerUserId: 'ru_7', cents: 200 }, { registerUserId: 'ru_9', cents: 100 }],
  });
});

// Das Merkmal „hat sie das Geld schon?" (Backend keck#293, Spec § 4.1).
// Entscheidend ist nicht die Zahlart, sondern der Besitz: Bargeld kann in der
// Lade bleiben, Kartentrinkgeld kann sofort bar ausgezahlt werden -- § 2j Abs 2
// AVRAG kennt beide Faelle.

test('sellReceipt: receivedImmediately geht in beide Richtungen hinaus', async () => {
  for (const wert of [true, false]) {
    const { rufen, aufrufe } = apiSchluesselWeg();
    await sellReceipt(rufen, {
      payments: BAR, items: [KAFFEE],
      tip: { cents: 200, receivedImmediately: wert },
    });
    const { params } = gesendet(aufrufe);
    assert.deepEqual(params['tip'], { cents: 200, receivedImmediately: wert });
  }
});

test('sellReceipt: ohne receivedImmediately steht das Feld NICHT in der Nutzlast', async () => {
  // Sonst waere „nichts gesagt" ploetzlich eine Aussage, und die
  // Voreinstellung des Betriebs kaeme nie zum Zug. Vor dieser Ergaenzung
  // verschluckte das Paket das Feld sogar dann, wenn es jemand SETZTE --
  // gepruefterTip baut die Nutzlast aus bekannten Feldern neu auf.
  const { rufen, aufrufe } = apiSchluesselWeg();
  await sellReceipt(rufen, {
    payments: BAR, items: [KAFFEE], tip: { cents: 200 },
  });
  const { params } = gesendet(aufrufe);
  assert.equal(Object.prototype.hasOwnProperty.call(params['tip'], 'receivedImmediately'), false);
});

test('sellReceipt: ein receivedImmediately, das kein Boolean ist, geht nicht hinaus', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg();
  await assert.rejects(
    () => sellReceipt(rufen, {
      payments: BAR, items: [KAFFEE],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tip: { cents: 200, receivedImmediately: 'ja' as any },
    }),
    /receivedImmediately muss true oder false sein/,
  );
  assert.equal(aufrufe.length, 0);
});

test('sellReceipt: ohne tip steht kein tip-Feld in der Nutzlast', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg();
  await sellReceipt(rufen, { payments: BAR, items: [KAFFEE] });
  const { params } = gesendet(aufrufe);
  assert.equal('tip' in params, false);
});

test('sellReceipt: ungueltiges Trinkgeld wird VOR dem Senden abgewiesen', async () => {
  const faelle: unknown[] = [
    0,
    -100,
    1.5,
    { cents: 100, paymentMethod: 'bitcoin' },
    { cents: 100, recipients: [] },
    { cents: 100, recipients: [{ registerUserId: 'a', cents: 60 }, { registerUserId: 'b', cents: 60 }] },
    { cents: 100, recipients: [{ registerUserId: 'a', cents: 0 }, { registerUserId: 'b', cents: 100 }] },
    { cents: 100, recipients: [{ registerUserId: '', cents: 100 }] },
  ];
  for (const tip of faelle) {
    const { rufen, aufrufe } = apiSchluesselWeg();
    await assert.rejects(
      () => sellReceipt(rufen, { payments: BAR, items: [KAFFEE], tip: tip as never }),
      (e: unknown) => isKasseneckValidationError(e),
      `erwartet Ablehnung fuer ${inspect(tip)}`,
    );
    assert.equal(aufrufe.length, 0, `nichts gesendet fuer ${inspect(tip)}`);
  }
});

test('createReceipt: Trinkgeld nur auf standard und training', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg();
  await assert.rejects(
    () => createReceipt(rufen, { receiptType: ReceiptType.zero, tip: 100 }),
    (e: unknown) => isKasseneckValidationError(e),
  );
  await assert.rejects(
    () => createReceipt(rufen, { receiptType: ReceiptType.cancellation, payments: BAR, items: [{ ...KAFFEE, priceCents: -320 }], tip: 100 }),
    (e: unknown) => isKasseneckValidationError(e),
  );
  assert.equal(aufrufe.length, 0);
  await createReceipt(rufen, { receiptType: ReceiptType.training, payments: BAR, items: [KAFFEE], tip: 50 });
  assert.equal(gesendet(aufrufe).params['tip'], 50);
});

test('sellReceipt: der zurueckgelesene Beleg traegt tipCents und die Tip-Position mit Kennzeichnung', async () => {
  // Wie das Backend ihn speichert: Tip-Zeile in v1-Form mit Kennzeichnung.
  const nutzlast = {
    ...BELEG_NUTZLAST,
    items: [
      { name: 'Kaffee', quantity: 1, unitPriceCents: 320, vatRate: 20 },
      { kind: 'tip', name: 'Trinkgeld', amount: 1, priceOneCents: 200, vat: 0, paymentMethod: 'cash', recipient: { registerUserId: 'ru_7', name: 'Anna' } },
    ],
    tipCents: 200,
  };
  const { rufen } = apiSchluesselWeg({ ...BELEG_ANTWORT, receipt: nutzlast });
  const beleg = await sellReceipt(rufen, { payments: BAR, items: [KAFFEE], tip: 200 });
  assert.equal(beleg.tipCents, 200);
  assert.equal(beleg.items[1]?.kind, 'tip');
  assert.deepEqual(beleg.items[1]?.recipient, { registerUserId: 'ru_7', name: 'Anna' });
  assert.equal(beleg.items[1]?.paymentMethod, 'cash');
  assert.equal(receiptSumCents(beleg), 520);
});
