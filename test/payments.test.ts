import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { createStripeLink, stripeCaptureIntent } from '../src/payments/stripe.js';
import { hobexPay, hobexRefund, newHobexTransactionId } from '../src/payments/hobex.js';
import {
  createTransport,
  DEFAULT_BASE_URL,
  type FetchLike,
  type HttpRequestInit,
  type HttpResponseLike,
} from '../src/client/transport.js';
import { apiKeyAuth } from '../src/client/auth.js';
import {
  KasseneckApiError,
  KasseneckAuthError,
  KasseneckHttpError,
  KasseneckNetworkError,
  KasseneckValidationError,
} from '../src/client/errors.js';
import { StripeLinkMode, VatRate, CreditCardProvider } from '../src/enums/index.js';
import type { ReceiptItem } from '../src/models/index.js';

/**
 * Vertragstests der Zahlungs-Endpunkte: welcher Endpunktname geht raus, mit
 * welchen Parameternamen und -werten.
 *
 * Die Erwartungen sind aus dem Flutter-Vorbild
 * (kasseneck_api/lib/kasseneck_api.dart, Zeilen 443-526) **abgeschrieben**,
 * nicht aus der Umsetzung dieses Pakets abgeleitet. Hier haengt besonders viel
 * daran, denn vier Angaben sehen wie Tippfehler aus und sind keine:
 *
 * 1. `createStripeLink` ruft den Endpunkt `createPaymentLinkStripe`.
 * 2. `stripeCaptureIntent` sendet `stripe_sessions_id` — mit "sessions" im Plural.
 * 3. `hobexPay`/`hobexRefund` rufen `hobexPayApi`/`hobexRefundApi` — je mit Suffix.
 * 4. Die Hobex-Betraege gehen als Euro-Gleitkommazahl raus, nicht als Cent.
 *
 * Eine aus der eigenen Umsetzung abgeleitete Erwartung wuerde jeden dieser vier
 * Fehler mitschreiben, statt ihn zu fangen.
 */

const API_KEY = 'kr_live_GEHEIMERAPIKEY';
const KASSEN_TOKEN = 'cb_live_GEHEIMESKASSENTOKEN';
const GEHEIMNISSE = [API_KEY, KASSEN_TOKEN];

interface Aufruf {
  url: string;
  init: HttpRequestInit;
}

function jsonAntwort(
  rumpf: string,
  { status = 200, contentType = 'application/json' }: { status?: number; contentType?: string | null } = {},
): HttpResponseLike {
  return {
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null) },
    text: async () => rumpf,
    arrayBuffer: async () => new TextEncoder().encode(rumpf).buffer,
  };
}

const erfolg = (daten: unknown): HttpResponseLike =>
  jsonAntwort(JSON.stringify({ status: 'success', message: '', data: daten }));

function fetchFake(antwortWert: HttpResponseLike): { holen: FetchLike; aufrufe: Aufruf[] } {
  const aufrufe: Aufruf[] = [];
  const holen: FetchLike = async (url, init) => {
    aufrufe.push({ url, init });
    return antwortWert;
  };
  return { holen, aufrufe };
}

const weg = (holen: FetchLike) =>
  createTransport({ auth: apiKeyAuth({ apiKey: API_KEY, cashregisterToken: KASSEN_TOKEN }), fetch: holen });

const rumpfVon = (aufruf: Aufruf): { params: Record<string, unknown> } => JSON.parse(aufruf.init.body);

/** Zwei Positionen: eine gewoehnliche und eine mit ermaessigtem Satz. */
const POSITIONEN: ReceiptItem[] = [
  { name: 'Cappuccino', quantity: 2, vat: VatRate.vat20, priceCents: 390 },
  { name: 'Semmel', quantity: 1, vat: VatRate.vat10, priceCents: 120 },
];

/** Antwort von `createPaymentLinkStripe` (payment-endpoints.js, successResponse). */
const SITZUNG_NUTZLAST = {
  id: 'cs_test_a1b2c3',
  url: 'https://checkout.stripe.com/c/pay/cs_test_a1b2c3',
  expires_at: '2026-08-13T22:30:00.000Z',
  shorten_payment_url: 'https://pay.kasseneck.at/AB12CD',
};

/** Antwort von `hobexPayApi` (die Hobex-Cloud-Nutzlast, unveraendert durchgereicht). */
const HOBEX_NUTZLAST = {
  transactionId: '2608140030051239999',
  tid: '11223344',
  receipt: '000123',
  approvalCode: '123456',
  reference: 'Tisch 4',
  transactionDate: '2026-08-14T00:30:07.918+02:00',
  cardNumber: '400000******0002',
  cardExpiry: '12/29',
  brand: 'VISA',
  cardIssuer: 'Issuer',
  responseCode: '00',
  transactionType: '1',
  currency: 'EUR',
  amount: 12.34,
  tip: 0.5,
  cvm: 0,
};

// --- createStripeLink ---------------------------------------------------

test('createStripeLink ruft den Endpunkt createPaymentLinkStripe (nicht createStripeLink)', async () => {
  const { holen, aufrufe } = fetchFake(erfolg(SITZUNG_NUTZLAST));

  await createStripeLink(weg(holen), {
    items: POSITIONEN,
    createReceiptAfterPayment: true,
    mode: StripeLinkMode.payment,
  });

  assert.equal(aufrufe.length, 1);
  // Abgeschrieben aus dem Dart-Vorbild: `endpoint: 'createPaymentLinkStripe'`.
  assert.equal(aufrufe[0]!.url, `${DEFAULT_BASE_URL}/createPaymentLinkStripe`);
  assert.ok(
    !aufrufe[0]!.url.endsWith('/createStripeLink'),
    'der Endpunktname folgt dem Vorbild, nicht dem Methodennamen',
  );
});

test('createStripeLink sendet items, createReceiptAfterPayment und mode — und sonst nichts', async () => {
  const { holen, aufrufe } = fetchFake(erfolg(SITZUNG_NUTZLAST));

  await createStripeLink(weg(holen), {
    items: POSITIONEN,
    createReceiptAfterPayment: false,
    mode: StripeLinkMode.authorization,
  });

  // Im Vorbild stehen die drei Pflichtfelder unbedingt, die drei uebrigen unter
  // `if (… != null)` — ohne Angabe darf also kein leeres Feld rausgehen.
  assert.deepEqual(rumpfVon(aufrufe[0]!), {
    params: {
      items: [
        { name: 'Cappuccino', quantity: 2, unitPriceCents: 390, vatRate: 20 },
        { name: 'Semmel', quantity: 1, unitPriceCents: 120, vatRate: 10 },
      ],
      createReceiptAfterPayment: false,
      mode: 'authorization',
    },
  });
});

test('createStripeLink sendet mode als Namen des Enums (mode.name im Vorbild)', async () => {
  for (const [modus, erwartet] of [
    [StripeLinkMode.payment, 'payment'],
    [StripeLinkMode.authorization, 'authorization'],
  ] as const) {
    const { holen, aufrufe } = fetchFake(erfolg(SITZUNG_NUTZLAST));
    await createStripeLink(weg(holen), { items: POSITIONEN, createReceiptAfterPayment: true, mode: modus });
    assert.equal(rumpfVon(aufrufe[0]!).params['mode'], erwartet);
  }
});

test('createStripeLink sendet den Kundenkontakt unter den Namen, die das Backend liest', async () => {
  const { holen, aufrufe } = fetchFake(erfolg(SITZUNG_NUTZLAST));

  await createStripeLink(weg(holen), {
    items: POSITIONEN,
    createReceiptAfterPayment: true,
    mode: StripeLinkMode.payment,
    webhookId: 'hook-7',
    customerEmail: 'gast@example.at',
    customerPhone: '+43 660 1234567',
  });

  const params = rumpfVon(aufrufe[0]!).params;
  // `webhookId` heisst im Vorbild wie im Backend gleich.
  assert.equal(params['webhookId'], 'hook-7');
  // Kontaktdaten: das Backend nimmt sie ausschliesslich unter `customer_email`
  // und `customer_phone` entgegen (optionalParams und Auswertung in
  // functions/payment-endpoints.js). Das Vorbild sendet sie camelCase — dort
  // fallen sie still unter den Tisch. Siehe Begruendung in src/payments/stripe.ts.
  assert.equal(params['customer_email'], 'gast@example.at');
  assert.equal(params['customer_phone'], '+43 660 1234567');
  assert.ok(!('customerEmail' in params), 'camelCase liest das Backend nicht — ein solches Feld waere tot');
  assert.ok(!('customerPhone' in params), 'camelCase liest das Backend nicht — ein solches Feld waere tot');
});

test('createStripeLink liefert die Sitzung aus der Antwort', async () => {
  const { holen } = fetchFake(erfolg(SITZUNG_NUTZLAST));

  const sitzung = await createStripeLink(weg(holen), {
    items: POSITIONEN,
    createReceiptAfterPayment: true,
    mode: StripeLinkMode.payment,
  });

  assert.equal(sitzung.id, 'cs_test_a1b2c3');
  assert.equal(sitzung.url, 'https://checkout.stripe.com/c/pay/cs_test_a1b2c3');
  // Das Backend nennt das Feld `shorten_payment_url` (nicht `shorten_url`).
  assert.equal(sitzung.shortenUrl, 'https://pay.kasseneck.at/AB12CD');
  assert.equal(sitzung.expiresAt.toISOString(), '2026-08-13T22:30:00.000Z');
});

test('createStripeLink meldet eine unbrauchbare Antwort als Antwortfehler statt einer kaputten Sitzung', async () => {
  const kaputte: Array<[string, unknown]> = [
    ['keine Nutzlast', null],
    ['ohne id', { ...SITZUNG_NUTZLAST, id: undefined }],
    ['ohne url', { ...SITZUNG_NUTZLAST, url: undefined }],
    ['ohne shorten_payment_url', { ...SITZUNG_NUTZLAST, shorten_payment_url: undefined }],
    ['unlesbares Ablaufdatum', { ...SITZUNG_NUTZLAST, expires_at: 'irgendwann' }],
  ];

  for (const [name, nutzlast] of kaputte) {
    const { holen } = fetchFake(erfolg(nutzlast));
    await assert.rejects(
      createStripeLink(weg(holen), { items: POSITIONEN, createReceiptAfterPayment: true, mode: StripeLinkMode.payment }),
      (fehler: unknown) => {
        assert.ok(fehler instanceof KasseneckValidationError, `Fall ${name}`);
        assert.equal(fehler.scope, 'response');
        assert.equal(fehler.functionName, 'createPaymentLinkStripe');
        return true;
      },
    );
  }
});

test('createStripeLink lehnt fehlende oder unbrauchbare Positionen ab, bevor etwas rausgeht', async () => {
  const kaputte: Array<[string, ReceiptItem[]]> = [
    ['leere Liste', []],
    ['Position ohne Namen', [{ name: '', quantity: 1, vat: VatRate.vat20, priceCents: 100 }]],
    ['Position ohne Menge', [{ name: 'Kaffee', quantity: 0, vat: VatRate.vat20, priceCents: 100 }]],
  ];

  for (const [name, items] of kaputte) {
    const { holen, aufrufe } = fetchFake(erfolg(SITZUNG_NUTZLAST));
    await assert.rejects(
      createStripeLink(weg(holen), { items, createReceiptAfterPayment: true, mode: StripeLinkMode.payment }),
      (fehler: unknown) => {
        assert.ok(fehler instanceof KasseneckValidationError, `Fall ${name}`);
        assert.equal(fehler.scope, 'request');
        return true;
      },
    );
    assert.equal(aufrufe.length, 0, `Fall ${name}: ein Zahlungslink ohne brauchbare Positionen darf nicht rausgehen`);
  }
});

test('createStripeLink lehnt einen unbekannten Modus ab, auch ohne Typpruefung des Aufrufers', async () => {
  const { holen, aufrufe } = fetchFake(erfolg(SITZUNG_NUTZLAST));

  await assert.rejects(
    createStripeLink(weg(holen), {
      items: POSITIONEN,
      createReceiptAfterPayment: true,
      mode: 'preauth' as unknown as typeof StripeLinkMode.payment,
    }),
    (fehler: unknown) => {
      assert.ok(fehler instanceof KasseneckValidationError);
      assert.equal(fehler.scope, 'request');
      return true;
    },
  );
  assert.equal(aufrufe.length, 0);
});

// --- stripeCaptureIntent ------------------------------------------------

test('stripeCaptureIntent sendet stripe_sessions_id — mit "sessions" im Plural', async () => {
  const { holen, aufrufe } = fetchFake(erfolg({ id: 'pi_1', status: 'succeeded', amount_received: 1234, currency: 'eur' }));

  await stripeCaptureIntent(weg(holen), 'cs_test_a1b2c3');

  assert.equal(aufrufe[0]!.url, `${DEFAULT_BASE_URL}/stripeCaptureIntent`);
  // Abgeschrieben aus dem Dart-Vorbild: `'stripe_sessions_id': stripeSessionId`.
  assert.deepEqual(rumpfVon(aufrufe[0]!), { params: { stripe_sessions_id: 'cs_test_a1b2c3' } });
  const params = rumpfVon(aufrufe[0]!).params;
  assert.ok(!('stripe_session_id' in params), 'der Singular ist der naheliegende Tippfehler — das Backend liest ihn nicht');
});

test('stripeCaptureIntent liefert das eingezogene Zahlungsversprechen, keine Zahlungslink-Sitzung', async () => {
  const { holen } = fetchFake(erfolg({ id: 'pi_1', status: 'succeeded', amount_received: 1234, currency: 'eur' }));

  const ergebnis = await stripeCaptureIntent(weg(holen), 'cs_test_a1b2c3');

  assert.equal(ergebnis.id, 'pi_1');
  assert.equal(ergebnis.status, 'succeeded');
  // Stripe fuehrt `amount_received` in der kleinsten Waehrungseinheit — Cent.
  assert.equal(ergebnis.amountReceivedCents, 1234);
  assert.equal(ergebnis.currency, 'eur');
});

test('stripeCaptureIntent meldet eine unbrauchbare Antwort als Antwortfehler', async () => {
  for (const [name, nutzlast] of [
    ['keine Nutzlast', null],
    ['ohne id', { status: 'succeeded', amount_received: 1234, currency: 'eur' }],
    ['ohne status', { id: 'pi_1', amount_received: 1234, currency: 'eur' }],
    ['ohne amount_received', { id: 'pi_1', status: 'succeeded', currency: 'eur' }],
  ] as Array<[string, unknown]>) {
    const { holen } = fetchFake(erfolg(nutzlast));
    await assert.rejects(stripeCaptureIntent(weg(holen), 'cs_test_a1b2c3'), (fehler: unknown) => {
      assert.ok(fehler instanceof KasseneckValidationError, `Fall ${name}`);
      assert.equal(fehler.scope, 'response');
      assert.equal(fehler.functionName, 'stripeCaptureIntent');
      return true;
    });
  }
});

test('stripeCaptureIntent verlangt eine Sitzungsnummer, bevor etwas rausgeht', async () => {
  const { holen, aufrufe } = fetchFake(erfolg({ id: 'pi_1', status: 'succeeded', amount_received: 0, currency: 'eur' }));

  await assert.rejects(stripeCaptureIntent(weg(holen), '  '), (fehler: unknown) => {
    assert.ok(fehler instanceof KasseneckValidationError);
    assert.equal(fehler.scope, 'request');
    return true;
  });
  assert.equal(aufrufe.length, 0);
});

// --- hobexPay -----------------------------------------------------------

test('hobexPay ruft den Endpunkt hobexPayApi — mit Suffix Api', async () => {
  const { holen, aufrufe } = fetchFake(erfolg(HOBEX_NUTZLAST));

  await hobexPay(weg(holen), { transactionId: '2608140030051239999', amountCents: 1234 });

  // Abgeschrieben aus dem Dart-Vorbild: `endpoint: 'hobexPayApi'`.
  assert.equal(aufrufe[0]!.url, `${DEFAULT_BASE_URL}/hobexPayApi`);
  assert.ok(!aufrufe[0]!.url.endsWith('/hobexPay'), 'ohne Suffix gibt es diesen Endpunkt nicht');
});

test('hobexPay sendet die Betraege als Euro-Gleitkommazahl, nicht als Cent', async () => {
  const faelle: Array<[string, number, number, number, number]> = [
    // [Fall, amountCents, tipCents, erwartetes amount, erwartetes tip]
    ['glatter Betrag', 1200, 0, 12, 0],
    ['mit Cent-Anteil', 1234, 50, 12.34, 0.5],
    ['unter einem Euro', 5, 1, 0.05, 0.01],
    ['grosser Betrag', 1234567, 0, 12345.67, 0],
  ];

  for (const [name, amountCents, tipCents, amount, tip] of faelle) {
    const { holen, aufrufe } = fetchFake(erfolg(HOBEX_NUTZLAST));
    await hobexPay(weg(holen), { transactionId: 'tx-1', amountCents, tipCents });
    const params = rumpfVon(aufrufe[0]!).params;
    assert.equal(params['amount'], amount, `Fall ${name}: amount in Euro`);
    assert.equal(params['tip'], tip, `Fall ${name}: tip in Euro`);
    assert.notEqual(params['amount'], amountCents, `Fall ${name}: Cent auf der Leitung waere das Hundertfache`);
  }
});

test('hobexPay sendet transactionId, amount, tip und reference — reference auch als null', async () => {
  // Im Vorbild steht `'reference': reference` unbedingt in der Nutzlast: ohne
  // Angabe geht das Feld als null raus, nicht gar nicht.
  const { holen, aufrufe } = fetchFake(erfolg(HOBEX_NUTZLAST));
  await hobexPay(weg(holen), { transactionId: 'tx-1', amountCents: 1234 });
  assert.deepEqual(rumpfVon(aufrufe[0]!), {
    params: { transactionId: 'tx-1', amount: 12.34, tip: 0, reference: null },
  });

  const { holen: holen2, aufrufe: aufrufe2 } = fetchFake(erfolg(HOBEX_NUTZLAST));
  await hobexPay(weg(holen2), { transactionId: 'tx-1', amountCents: 1234, tipCents: 50, reference: 'Tisch 4' });
  assert.deepEqual(rumpfVon(aufrufe2[0]!), {
    params: { transactionId: 'tx-1', amount: 12.34, tip: 0.5, reference: 'Tisch 4' },
  });
});

test('hobexPay liefert den Hobex-Beleg mit Betraegen in Cent', async () => {
  const { holen } = fetchFake(erfolg(HOBEX_NUTZLAST));

  const beleg = await hobexPay(weg(holen), { transactionId: 'tx-1', amountCents: 1234, tipCents: 50 });

  assert.equal(beleg.transactionId, '2608140030051239999');
  assert.equal(beleg.amountCents, 1234, 'Euro der Terminal-Antwort werden beim Lesen zu Cent');
  assert.equal(beleg.tipCents, 50);
  assert.equal(beleg.brand, 'VISA');
  assert.equal(beleg.cvm, '0');
  assert.equal(beleg.creditCardProvider, CreditCardProvider.hobexCloudApi);
  // Die Normalisierung des Zeitstempels kommt aus dem Modell (Task 2).
  assert.equal(beleg.transactionDate, '2026-08-14 00:30:07');
});

test('hobexPay meldet eine Antwort ohne Beleg als Antwortfehler', async () => {
  for (const [name, nutzlast] of [
    ['keine Nutzlast', null],
    ['leeres Objekt', {}],
    ['ohne transactionDate', { ...HOBEX_NUTZLAST, transactionDate: undefined }],
    ['ohne transactionId', { ...HOBEX_NUTZLAST, transactionId: undefined }],
  ] as Array<[string, unknown]>) {
    const { holen } = fetchFake(erfolg(nutzlast));
    await assert.rejects(hobexPay(weg(holen), { transactionId: 'tx-1', amountCents: 1234 }), (fehler: unknown) => {
      assert.ok(fehler instanceof KasseneckValidationError, `Fall ${name}`);
      assert.equal(fehler.scope, 'response');
      assert.equal(fehler.functionName, 'hobexPayApi');
      return true;
    });
  }
});

// --- hobexRefund --------------------------------------------------------

test('hobexRefund ruft den Endpunkt hobexRefundApi — mit Suffix Api', async () => {
  const { holen, aufrufe } = fetchFake(erfolg({ success: true }));

  await hobexRefund(weg(holen), { transactionId: 'tx-1', amountCents: 1234, tipCents: 50 });

  // Abgeschrieben aus dem Dart-Vorbild: `endpoint: 'hobexRefundApi'`.
  assert.equal(aufrufe[0]!.url, `${DEFAULT_BASE_URL}/hobexRefundApi`);
  assert.ok(!aufrufe[0]!.url.endsWith('/hobexRefund'), 'ohne Suffix gibt es diesen Endpunkt nicht');
  // Im Vorbild sendet der Refund KEINE reference — anders als die Zahlung.
  assert.deepEqual(rumpfVon(aufrufe[0]!), { params: { transactionId: 'tx-1', amount: 12.34, tip: 0.5 } });
});

test('hobexRefund gibt nichts zurueck — die Fehlerhuelle hat schon vorher geworfen', async () => {
  const { holen } = fetchFake(erfolg({ success: true }));

  const ergebnis = await hobexRefund(weg(holen), { transactionId: 'tx-1', amountCents: 1234 });

  // Das Vorbild liefert `resJson['status'] == 'success'`. In diesem Paket wirft
  // der Transport bei allem, was nicht Erfolg ist — ein Wahrheitswert waere
  // hier immer true und damit eine Luege ueber den Informationsgehalt.
  assert.equal(ergebnis, undefined);
});

test('hobexRefund wirft, wenn das Backend die Erstattung ablehnt', async () => {
  const { holen } = fetchFake(jsonAntwort(JSON.stringify({ status: 'error', message: 'Refund abgelehnt', data: null })));

  await assert.rejects(hobexRefund(weg(holen), { transactionId: 'tx-1', amountCents: 1234 }), (fehler: unknown) => {
    assert.ok(fehler instanceof KasseneckApiError);
    assert.equal(fehler.functionName, 'hobexRefundApi');
    assert.equal(fehler.serverMessage, 'Refund abgelehnt');
    return true;
  });
});

// --- Pruefungen vor dem Senden ------------------------------------------

test('Hobex-Aufrufe lehnen unbrauchbare Betraege und Kennungen ab, bevor Geld bewegt wird', async () => {
  const kaputte: Array<[string, { transactionId: string; amountCents: number; tipCents?: number }]> = [
    ['ohne transactionId', { transactionId: '', amountCents: 1234 }],
    ['Betrag NaN', { transactionId: 'tx-1', amountCents: Number.NaN }],
    ['Betrag unendlich', { transactionId: 'tx-1', amountCents: Number.POSITIVE_INFINITY }],
    ['Betrag mit Bruchteil-Cent', { transactionId: 'tx-1', amountCents: 12.5 }],
    ['Betrag null', { transactionId: 'tx-1', amountCents: 0 }],
    ['Betrag negativ', { transactionId: 'tx-1', amountCents: -100 }],
    ['Trinkgeld negativ', { transactionId: 'tx-1', amountCents: 1234, tipCents: -1 }],
    ['Trinkgeld mit Bruchteil-Cent', { transactionId: 'tx-1', amountCents: 1234, tipCents: 0.5 }],
  ];

  const aufrufeUnterTest: Array<[string, (holen: FetchLike, o: { transactionId: string; amountCents: number; tipCents?: number }) => Promise<unknown>]> = [
    ['hobexPay', (holen, o) => hobexPay(weg(holen), o)],
    ['hobexRefund', (holen, o) => hobexRefund(weg(holen), o)],
  ];

  for (const [aufrufName, aufruf] of aufrufeUnterTest) {
    for (const [name, eingabe] of kaputte) {
      const { holen, aufrufe } = fetchFake(erfolg(HOBEX_NUTZLAST));
      await assert.rejects(aufruf(holen, eingabe), (fehler: unknown) => {
        assert.ok(fehler instanceof KasseneckValidationError, `${aufrufName} / ${name}`);
        assert.equal(fehler.scope, 'request');
        return true;
      });
      assert.equal(aufrufe.length, 0, `${aufrufName} / ${name}: es darf keine Anfrage rausgehen`);
    }
  }
});

// --- newHobexTransactionId ----------------------------------------------

test('newHobexTransactionId liefert 19 Ziffern aus Wiener Wanduhrzeit und Zufall', async () => {
  // Fester Zeitpunkt: 13.08.2026 22:30:05.123 UTC = 14.08.2026 00:30:05.123 in
  // Wien (Sommerzeit). Der Tageswechsel liegt zwischen beiden — genau deshalb
  // darf die Kennung nicht von der Zeitzone des ausfuehrenden Rechners haengen
  // (die Suite laeuft in Vienna, UTC und Kiritimati).
  const kennung = newHobexTransactionId({ now: new Date('2026-08-13T22:30:05.123Z'), random: () => 0.5 });

  assert.equal(kennung, '2608140030051235000');
  assert.equal(kennung.length, 19);
  assert.match(kennung, /^\d{19}$/);
});

test('newHobexTransactionId unterscheidet zwei Kennungen derselben Millisekunde', async () => {
  const zeitpunkt = new Date('2026-08-13T22:30:05.123Z');
  const erste = newHobexTransactionId({ now: zeitpunkt, random: () => 0.1234 });
  const zweite = newHobexTransactionId({ now: zeitpunkt, random: () => 0.9876 });

  assert.notEqual(erste, zweite, 'ohne Zufallsanteil waeren zwei Zahlungen derselben Millisekunde dieselbe Kennung');
  assert.equal(erste.slice(0, 15), zweite.slice(0, 15), 'der Zeitanteil ist derselbe');
});

test('newHobexTransactionId ohne Angaben liefert eine gueltige Kennung', async () => {
  assert.match(newHobexTransactionId(), /^\d{19}$/);
});

// --- Zusagen des Pakets -------------------------------------------------

/** Alle vier Aufrufe dieses Tasks, jeweils an ein Fake-fetch gebunden. */
const alleAufrufe: Array<[string, (holen: FetchLike) => Promise<unknown>]> = [
  [
    'createStripeLink',
    (holen) =>
      createStripeLink(weg(holen), { items: POSITIONEN, createReceiptAfterPayment: true, mode: StripeLinkMode.payment }),
  ],
  ['stripeCaptureIntent', (holen) => stripeCaptureIntent(weg(holen), 'cs_test_a1b2c3')],
  ['hobexPay', (holen) => hobexPay(weg(holen), { transactionId: 'tx-1', amountCents: 1234 })],
  ['hobexRefund', (holen) => hobexRefund(weg(holen), { transactionId: 'tx-1', amountCents: 1234 })],
];

const stoerungen: Array<[string, FetchLike, string]> = [
  [
    'Netz weg',
    async () => {
      throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    },
    'Network',
  ],
  ['HTTP 500', async () => jsonAntwort('<html>500</html>', { status: 500, contentType: 'text/html' }), 'Http:server-error'],
  ['HTML statt Antwort', async () => jsonAntwort('<html>oops</html>', { contentType: 'text/html' }), 'Http:not-json'],
  ['leere Antwort', async () => jsonAntwort(''), 'Http:empty-body'],
  ['JSON ohne Statusfeld', async () => jsonAntwort('{"irgendwas":true}'), 'Http:missing-status'],
  ['fachlicher Fehler', async () => jsonAntwort(JSON.stringify({ status: 'error', message: 'nein', data: null })), 'Api'],
];

/** Kurzform eines Fehlers — `fremd:` fuer alles ausserhalb der Union. */
function kennungVon(fehler: unknown): string {
  if (fehler instanceof KasseneckHttpError) return `Http:${fehler.reason}`;
  if (fehler instanceof KasseneckApiError) return 'Api';
  if (fehler instanceof KasseneckNetworkError) return 'Network';
  if (fehler instanceof KasseneckAuthError) return 'Auth';
  if (fehler instanceof KasseneckValidationError) return `Validation:${fehler.reason}`;
  return `fremd:${inspect(fehler)}`;
}

test('alle vier Zahlungs-Aufrufe melden dieselbe Stoerung als denselben Fehler der Union', async () => {
  for (const [name, aufruf] of alleAufrufe) {
    for (const [stoerung, holen, erwartet] of stoerungen) {
      await assert.rejects(aufruf(holen), (fehler: unknown) => {
        assert.equal(kennungVon(fehler), erwartet, `${name} / ${stoerung}`);
        return true;
      });
    }
  }
});

test('kein Geheimnis wandert in einen Fehler der Zahlungs-Endpunkte', async () => {
  const undichteStellen: Array<[string, FetchLike]> = [
    [
      'fremde Ursache mit Bearer',
      async () => {
        throw Object.assign(new Error(`Anfrage fehlgeschlagen: Bearer ${API_KEY}`), {
          code: 'ECONNRESET',
          config: { headers: { Authorization: `Bearer ${API_KEY}`, 'cashregister-token': KASSEN_TOKEN } },
        });
      },
    ],
    [
      'Antwortrumpf spiegelt die Anfrage',
      async () =>
        jsonAntwort(`<html>Authorization: Bearer ${API_KEY}\ncashregister-token: ${KASSEN_TOKEN}</html>`, {
          contentType: 'text/html',
        }),
    ],
    [
      'Erfolgsrumpf mit Zugangsdaten',
      async () => jsonAntwort(JSON.stringify({ status: 'success', message: '', data: { echo: API_KEY } })),
    ],
    ['fachlicher Fehler', async () => jsonAntwort(JSON.stringify({ status: 'error', message: 'nein', data: null }))],
  ];

  for (const [name, aufruf] of alleAufrufe) {
    for (const [stelle, holen] of undichteStellen) {
      try {
        await aufruf(holen);
        continue;
      } catch (fehler) {
        const abdruck = inspect(fehler, { depth: 10 }) + String((fehler as Error).message);
        for (const geheim of GEHEIMNISSE) {
          assert.ok(!abdruck.includes(geheim), `${name} / ${stelle}: Geheimnis im Fehler: ${abdruck}`);
        }
      }
    }
  }
});
