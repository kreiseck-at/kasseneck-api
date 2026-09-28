import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createReceipt,
  sellReceipt,
  sellReceiptWithCompany,
  zeroReceipt,
  getReceipt,
  getReceiptWithCompany,
  cancelReceipt,
  sendReceiptEmail,
  listMyReceipts,
  paymentsExpectedCents,
  cardRefundReference,
  receiptLayoutFromResult,
  type ReceiptWithCompany,
  type SellReceiptOptions,
  type TipOptions,
} from '../src/client/receipts.js';
import { buildReceiptLayout, escPosLayoutBytes, type ReceiptLayout } from '../src/receipt/index.js';
import { isKasseneckApiError, isKasseneckValidationError, isOutcomeUnknown } from '../src/client/errors.js';
import { createTransport, DEFAULT_BASE_URL, KASSE_BASE_URL, type FetchLike, type HttpRequestInit, type HttpResponseLike } from '../src/client/transport.js';
import { apiKeyAuth, registerUserAuth } from '../src/client/auth.js';
import {
  fromReceiptItemPayload,
  fromVoucherPayload,
  CANCELLATION_ERROR_CODES,
  CANCELLATION_REASONS,
  CANCELLATION_STATUSES,
  PAYMENT_ERROR_CODES,
  RECEIPT_EMAIL_ERROR_CODES,
  RECEIPT_EMAIL_VIAS,
  RECEIPT_ERROR_CODES,
  isCancellationErrorCode,
  isPaymentErrorCode,
  isReceiptErrorCode,
  type ReceiptPaymentInput,
  type VoucherPayload,
} from '../src/models/index.js';
import { KeckPaymentMethod } from '../src/enums/index.js';
import { receiptDueCents } from '../src/receipt/due.js';
import { getReportV2 } from '../src/client/reports.js';
import * as wurzel from '../src/index.js';

/*
 * Belege, Storno, Belegmail und Zahlungen am englischen Draht `/v3`, gegen
 * den Vertrags-Export des Backends (fixtures/v3/antworten). Je Fall: was das
 * Paket aus denselben Eingaben sendet, ist der Fall (Parameter), und was es
 * aus der Antwort liest, traegt die englischen Namen. Kanal `api`
 * (api.kasseneck.at/v3, API-Schluessel) ohne Anbieterdaten, Kanal `app`
 * (kasse.kasseneck.at/api/v3, Kassen-Anmeldung) mit.
 */

type Json = Record<string, any>;
interface Fall {
  name: string;
  endpoint: string;
  path: string;
  channel?: string;
  params: Json;
  httpStatus: number;
  headers: Record<string, string>;
  response: Json;
}

const lies = (datei: string): Json => JSON.parse(readFileSync(fileURLToPath(new URL(`../../fixtures/v3/${datei}`, import.meta.url)), 'utf8')) as Json;
const BELEGE = lies('antworten/belege.json').cases as Fall[];
const KASSE_BELEGE = lies('antworten/kasse-belege.json').cases as Fall[];
const STORNO = lies('antworten/storno.json').cases as Fall[];
const BELEGMAIL = lies('antworten/belegmail.json').cases as Fall[];
const KASSE = lies('antworten/kasse.json').endpoints as Record<string, { cases: Fall[] }>;
const VOKABULAR = lies('v3-vokabular.json');

const API_KEY = 'kr_test_GEHEIMERAPIKEY';
const KASSEN_TOKEN = 'cb_test_GEHEIMESKASSENTOKEN';

interface Mitschrift {
  url: string;
  params: Json;
}

function antwortAus(fall: Fall): HttpResponseLike {
  const rumpf = JSON.stringify(fall.response);
  const kopf: Record<string, string> = { 'content-type': 'application/json' };
  for (const [k, v] of Object.entries(fall.headers)) kopf[k.toLowerCase()] = v;
  return {
    status: fall.httpStatus,
    headers: { get: (name: string) => kopf[name.toLowerCase()] ?? null },
    text: async () => rumpf,
    arrayBuffer: async () => new TextEncoder().encode(rumpf).buffer,
  };
}

/** Transport, der auf jeden Aufruf mit der Antwort des Falls antwortet; Kanal nach `fall.path`. */
function wegFuer(fall: Fall, cashregisterId = 'KECK-1') {
  const aufrufe: Mitschrift[] = [];
  const holen: FetchLike = async (url: string, init: HttpRequestInit) => {
    aufrufe.push({ url, params: (JSON.parse(init.body) as { params: Json }).params });
    return antwortAus(fall);
  };
  const kasse = fall.path.startsWith('/api/v3/');
  const rufen = createTransport({
    auth: kasse
      ? registerUserAuth({ getIdToken: () => 'eyJ-ID', getSessionId: () => 'sess-1', cashregisterId })
      : apiKeyAuth({ apiKey: API_KEY, cashregisterToken: KASSEN_TOKEN }),
    fetch: holen,
  });
  return { rufen, aufrufe, kasse };
}

/** Der eine gesendete Aufruf: Adresse des Kanals und Parameter ohne die Kassenbindung der Anmeldung. */
function gesendet(aufrufe: Mitschrift[], fall: Fall, kasse: boolean): Json {
  assert.equal(aufrufe.length, 1, `${fall.name}: genau ein Aufruf, nie ein zweiter`);
  assert.equal(aufrufe[0]!.url, `${kasse ? KASSE_BASE_URL : DEFAULT_BASE_URL}/${fall.endpoint}`);
  const params = { ...aufrufe[0]!.params };
  if (kasse && !('cashregisterId' in fall.params)) delete params.cashregisterId;
  return params;
}

/** Positionen in beiden Draht-Formen (v1 amount/priceOneCents/vat, v2 quantity/unitPriceCents/vatRate) auf eine. */
function kanonisch(params: Json): Json {
  const raus: Json = { ...params };
  if (Array.isArray(params.items)) {
    raus.items = params.items.map((p: Json) => ({
      name: p.name,
      quantity: p.quantity ?? p.amount,
      unitPriceCents: p.unitPriceCents ?? p.priceOneCents,
      vatRate: p.vatRate ?? p.vat,
    }));
  }
  return raus;
}

/** Aus den Parametern eines Falls die Eingabe, die ein Aufrufer an sellReceipt gibt. */
function verkaufAus(params: Json): SellReceiptOptions {
  return {
    items: (params.items ?? []).map((p: Json) => fromReceiptItemPayload(p)),
    ...(params.vouchers ? { vouchers: params.vouchers.map((v: Json) => fromVoucherPayload(v as VoucherPayload)) } : {}),
    payments: params.payments as ReceiptPaymentInput[],
    ...(params.tip ? { tip: params.tip as TipOptions } : {}),
  };
}

async function fehlerVon(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (fehler) {
    return fehler;
  }
  assert.fail('Fehler erwartet');
}

const umsatzFaelle = (liste: Fall[]) => liste.filter((f) => f.endpoint === 'createReceipt' && f.response.status === 'success');

// --- createReceipt ------------------------------------------------------------

for (const [kanal, liste] of [['api', BELEGE], ['app', KASSE_BELEGE]] as const) {
  for (const fall of umsatzFaelle(liste)) {
    test(`createReceipt ${kanal}/${fall.name}: gesendet wird genau der Fall, gelesen die englischen Namen`, async () => {
      const { rufen, aufrufe, kasse } = wegFuer(fall);
      const typ = fall.params.receiptType as string;
      const ergebnis =
        typ === 'standard'
          ? await sellReceiptWithCompany(rufen, verkaufAus(fall.params))
          : typ === 'zero'
            ? { receipt: await zeroReceipt(rufen) }
            : { receipt: await createReceipt(rufen, { receiptType: typ as 'start' }) };
      assert.deepEqual(kanonisch(gesendet(aufrufe, fall, kasse)), kanonisch(fall.params));

      const daten = fall.response.data;
      const beleg = ergebnis.receipt;
      assert.equal(beleg.receiptId, daten.receipt.receiptId);
      assert.equal(beleg.headerVersionId, daten.receipt.headerVersionId);
      assert.equal(beleg.layoutRuleset, daten.receipt.layoutRuleset);
      // Zahlungen: dieselben Felder wie am Draht; Anbieterdaten nur im Kanal app.
      const zahlungen = (beleg.payments ?? []).map((z) => ({ ...z, method: typeof z.method === 'object' ? z.method.value : z.method }));
      assert.deepEqual(zahlungen, daten.receipt.payments);
      for (const z of zahlungen) {
        if (kanal === 'api') assert.equal(z.providerPaymentId, undefined);
      }
      if ('company' in ergebnis) {
        const { company, headerVersionId, registrationInfo, testCashregister, testSignature, logoScale } = ergebnis;
        assert.equal(company.taxNumber, daten.taxNumber);
        assert.equal(company.vatId, daten.vatId);
        assert.equal(headerVersionId, daten.headerVersionId);
        assert.deepEqual(registrationInfo, daten.registrationInfo);
        assert.equal(testCashregister, daten.testCashregister);
        assert.equal(testSignature, daten.testSignature);
        assert.equal(logoScale, daten.logo_scale);
      }
    });
  }
}

test('Zahlbetrag-Zwilling: jede angenommene Zahlungsliste ist genau receiptDueCents', () => {
  for (const fall of [...umsatzFaelle(BELEGE), ...umsatzFaelle(KASSE_BELEGE)]) {
    if (fall.params.receiptType !== 'standard') continue;
    const o = verkaufAus(fall.params);
    const summe = o.payments.reduce((s, z) => s + z.amountCents, 0);
    const tip = o.tip == null ? undefined : typeof o.tip === 'number' ? o.tip : o.tip.cents;
    // Die Vertragswelt verkauft ueber einen Geraete-Schluessel: Personal-Trinkgeld.
    assert.equal(receiptDueCents(o.items ?? [], o.vouchers ?? [], 'standard', { tip, payments: o.payments, tipRecipient: 'staff' }), summe, fall.name);
  }
});

test('Trinkgeld: receivedImmediately geht hinaus und kommt an der Position zurueck', async () => {
  const fall = BELEGE.find((f) => f.name === 'sale_card_with_tip')!;
  const { rufen, aufrufe, kasse } = wegFuer(fall);
  const beleg = await sellReceipt(rufen, verkaufAus(fall.params));
  assert.deepEqual(gesendet(aufrufe, fall, kasse).tip, { cents: 100, receivedImmediately: false });
  const tip = beleg.items.find((p) => p.kind === 'tip')!;
  assert.equal(tip.receivedImmediately, false);
  assert.equal(beleg.tipCents, 100);
});

test('Trinkgeld: der deutsche Schluessel sofortErhalten geht nicht mehr hinaus', async () => {
  const fall = BELEGE.find((f) => f.name === 'sale_card_with_tip')!;
  const { rufen, aufrufe } = wegFuer(fall);
  const fehler = await fehlerVon(sellReceipt(rufen, { ...verkaufAus(fall.params), tip: { cents: 100, sofortErhalten: false } as unknown as TipOptions }));
  assert.ok(isKasseneckValidationError(fehler));
  assert.equal(aufrufe.length, 0);
});

// --- Pflicht payments[], kein paymentMethod-Weg -------------------------------

test('payments_required und payment_method_not_supported: das Paket sendet so etwas gar nicht erst', async () => {
  for (const name of ['error_payments_required', 'error_payment_method_not_supported']) {
    const fall = BELEGE.find((f) => f.name === name)!;
    const { rufen, aufrufe } = wegFuer(fall);
    const roh = { items: verkaufAus({ ...fall.params, payments: [] }).items, ...(fall.params.paymentMethod ? { paymentMethod: fall.params.paymentMethod } : {}) };
    const fehler = await fehlerVon(sellReceipt(rufen, roh as unknown as SellReceiptOptions));
    assert.ok(isKasseneckValidationError(fehler), name);
    // Der Grund, nicht nur die Fehlerart: payments fehlt bzw. paymentMethod gibt es nicht mehr.
    assert.match(fehler.reason, name === 'error_payments_required' ? /^payments fehlt/ : /^paymentMethod gibt es unter \/v3 nicht mehr/, name);
    assert.equal(aufrufe.length, 0, name);
  }
});

test('Kartenfelder am Beleg (creditCardProvider, cardPaymentId, cardPaymentData) gehen nicht hinaus', async () => {
  const fall = BELEGE.find((f) => f.name === 'sale_cash_tendered')!;
  for (const feld of ['paymentMethod', 'creditCardProvider', 'cardPaymentId', 'cardPaymentData'] as const) {
    const { rufen, aufrufe } = wegFuer(fall);
    const wert = feld === 'cardPaymentData' ? {} : feld === 'paymentMethod' ? 'cash' : 'x';
    const fehler = await fehlerVon(sellReceipt(rufen, { ...verkaufAus(fall.params), [feld]: wert } as unknown as SellReceiptOptions));
    assert.ok(isKasseneckValidationError(fehler), feld);
    assert.equal(aufrufe.length, 0, feld);
  }
});

test('Storno ueber createReceipt gibt es nicht mehr, createCancelReceipt ist entfernt', async () => {
  const fall = BELEGE.find((f) => f.name === 'sale_cash_tendered')!;
  const { rufen, aufrufe } = wegFuer(fall);
  const fehler = await fehlerVon(createReceipt(rufen, { ...verkaufAus(fall.params), receiptType: 'cancellation' }));
  assert.ok(isKasseneckValidationError(fehler));
  assert.equal(aufrufe.length, 0);
  assert.equal((wurzel as Json).createCancelReceipt, undefined);
});

test('unbekannter Belegtyp (error_receipt_type_invalid) faellt vor dem Senden', async () => {
  const fall = BELEGE.find((f) => f.name === 'error_receipt_type_invalid')!;
  const { rufen, aufrufe } = wegFuer(fall);
  const fehler = await fehlerVon(createReceipt(rufen, { ...verkaufAus(fall.params), receiptType: 'rechnung' as 'standard' }));
  assert.ok(isKasseneckValidationError(fehler));
  assert.equal(aufrufe.length, 0);
});

test('payments_sum_mismatch: expectedCents liegt offen, nie ein zweiter Versuch', async () => {
  for (const liste of [BELEGE, KASSE_BELEGE]) {
    const fall = liste.find((f) => f.name === 'error_payments_sum_mismatch')!;
    const { rufen, aufrufe, kasse } = wegFuer(fall);
    const fehler = await fehlerVon(sellReceipt(rufen, verkaufAus(fall.params)));
    assert.ok(isKasseneckApiError(fehler));
    assert.equal(fehler.code, 'payments_sum_mismatch');
    assert.equal(fehler.outcome, 'rejected');
    assert.equal(fehler.serverMessage, fall.response.message);
    assert.equal(paymentsExpectedCents(fehler), 600);
    assert.equal(paymentsExpectedCents(fehler), fall.response.data.expectedCents);
    assert.deepEqual(kanonisch(gesendet(aufrufe, fall, kasse)), kanonisch(fall.params));
  }
  assert.equal(paymentsExpectedCents(new Error('x')), undefined);
});

test('receipt_outcome_unknown und cancellation_outcome_unknown: Ausgang unklar, genau ein Aufruf', async () => {
  const faelle: Array<[string, string, (rufen: any) => Promise<unknown>]> = [
    ['createReceipt', 'receipt_outcome_unknown', (rufen) => sellReceipt(rufen, verkaufAus(BELEGE.find((f) => f.name === 'sale_cash_tendered')!.params))],
    ['cancelReceipt', 'cancellation_outcome_unknown', (rufen) => cancelReceipt(rufen, { cashregisterId: 'KECK-1', originalReceiptId: 'KECK-1-ID-2', reason: 'input_error' })],
  ];
  for (const [endpoint, code, aufruf] of faelle) {
    const fall: Fall = {
      name: code,
      endpoint,
      path: `/v3/${endpoint}`,
      params: {},
      httpStatus: 200,
      headers: { 'Kasseneck-Api-Version': 'v3' },
      response: { status: 'error', message: 'Ergebnis unklar.', data: { code }, code },
    };
    const { rufen, aufrufe } = wegFuer(fall);
    const fehler = await fehlerVon(aufruf(rufen));
    assert.ok(isKasseneckApiError(fehler));
    assert.equal(fehler.code, code);
    assert.equal(fehler.outcome, 'unknown');
    assert.ok(isOutcomeUnknown(fehler));
    assert.equal(aufrufe.length, 1, `${code}: nie wiederholt`);
  }
});

for (const [kanal, liste] of [['api', BELEGE], ['app', KASSE_BELEGE]] as const) {
  for (const fall of liste.filter((f) => f.response.status === 'error' && ['error_payments_sum_mismatch', 'error_receipt_not_found'].includes(f.name))) {
    test(`Fehler ${kanal}/${fall.name}: Code klein, Meldung deutsch unveraendert`, async () => {
      const { rufen } = wegFuer(fall);
      const fehler = await fehlerVon(
        fall.endpoint === 'getReceipt' ? getReceipt(rufen, fall.params.receiptId) : sellReceipt(rufen, verkaufAus(fall.params)),
      );
      assert.ok(isKasseneckApiError(fehler));
      assert.equal(fehler.code, fall.response.code);
      assert.equal(fehler.serverMessage, fall.response.message);
      assert.ok(isReceiptErrorCode(fehler.code) || isPaymentErrorCode(fehler.code));
    });
  }
}

// --- getReceipt ---------------------------------------------------------------

for (const [kanal, liste] of [['api', BELEGE], ['app', KASSE_BELEGE]] as const) {
  for (const fall of liste.filter((f) => f.endpoint === 'getReceipt' && f.response.status === 'success')) {
    test(`getReceipt ${kanal}/${fall.name}: englische Felder, Anbieterdaten je Kanal`, async () => {
      const { rufen, aufrufe, kasse } = wegFuer(fall);
      const { receipt, company, headerVersionId, registrationInfo } = await getReceiptWithCompany(rufen, fall.params.receiptId);
      assert.deepEqual(gesendet(aufrufe, fall, kasse), fall.params);
      const roh = fall.response.data.receipt;
      assert.equal(receipt.headerVersionId, roh.headerVersionId);
      assert.equal(receipt.layoutRuleset, roh.layoutRuleset);
      assert.deepEqual(receipt.registrationInfo ?? null, roh.registrationInfo ?? null);
      assert.deepEqual(registrationInfo, fall.response.data.registrationInfo);
      assert.equal(headerVersionId, fall.response.data.headerVersionId);
      assert.equal(company.taxNumber, fall.response.data.taxNumber);
      assert.equal(receipt.cancellationReason, roh.cancellationReason ?? undefined);
      if (roh.cancellationOf) assert.deepEqual(receipt.cancellationOf, roh.cancellationOf);
      if (roh.cancellations) assert.deepEqual(receipt.cancellations, roh.cancellations);
      for (const z of receipt.payments ?? []) {
        assert.equal(z.providerPaymentId !== undefined, kanal === 'app' && z.method === KeckPaymentMethod.creditCard, `${fall.name}: ${JSON.stringify(z)}`);
      }
    });
  }
}

test('Karten-Storno: die Kennung der Originalzahlung liest nur der Kassenweg, der Storno geht mit refundOf hinaus', async () => {
  const lesen = (liste: Fall[]) => liste.find((f) => f.name === 'get_card_receipt_with_cancellation')!;
  const oeffentlich = wegFuer(lesen(BELEGE));
  const ohne = await getReceipt(oeffentlich.rufen, 'KECK-1-ID-2');
  assert.equal(ohne.payments![0]!.providerPaymentId, undefined);
  assert.equal(ohne.payments![0]!.providerData, undefined);

  const kasse = wegFuer(lesen(KASSE_BELEGE));
  const original = await getReceipt(kasse.rufen, 'KECK-1-ID-2');
  const karte = original.payments!.find((z) => z.method === KeckPaymentMethod.creditCard)!;
  assert.equal(karte.providerPaymentId, 'tx-4711');
  assert.deepEqual(karte.providerData, { cardLast4: '4242', terminal: 'T1' });
  assert.deepEqual(original.cancellations![0]!.refundedByPayment, { p1: 700 });

  // Mit der Kennung erstattet das Terminal; die Rueckbuchung bekommt ihre eigene.
  const storno = STORNO.find((f) => f.channel === 'app' && f.name === 'cancel_full_card_refund')!;
  const weg = wegFuer(storno);
  const ergebnis = await cancelReceipt(weg.rufen, {
    receipt: original,
    reason: 'input_error',
    payments: [{
      method: karte.method as KeckPaymentMethod,
      amountCents: -karte.amountCents,
      refundOf: karte.id!,
      provider: karte.provider as 'sumup',
      providerPaymentId: 'rf-1',
      providerData: { refund: 'ok' },
    }],
  });
  assert.deepEqual(gesendet(weg.aufrufe, storno, weg.kasse), storno.params);
  assert.equal(ergebnis.receipt.payments![0]!.providerPaymentId, 'rf-1');
});

// --- cancelReceipt ------------------------------------------------------------

for (const fall of STORNO) {
  test(`cancelReceipt ${fall.channel}/${fall.name}`, async () => {
    const { rufen, aufrufe, kasse } = wegFuer(fall);
    const p = fall.params;
    const aufruf = cancelReceipt(rufen, {
      cashregisterId: p.cashregisterId,
      originalReceiptId: p.originalReceiptId,
      reason: p.reason,
      ...(p.items ? { items: p.items } : {}),
      ...(p.payments ? { payments: p.payments } : {}),
    });
    if (fall.name === 'error_german_reason' || fall.name === 'error_unknown_reason') {
      // Ein Grund ausserhalb des Katalogs (auch der alte deutsche) geht nicht hinaus.
      assert.ok(isKasseneckValidationError(await fehlerVon(aufruf)));
      assert.equal(aufrufe.length, 0);
      return;
    }
    if (fall.response.status === 'error') {
      const fehler = await fehlerVon(aufruf);
      assert.ok(isKasseneckApiError(fehler));
      assert.equal(fehler.code, fall.response.code);
      assert.ok(isCancellationErrorCode(fehler.code), fehler.code);
      assert.equal(fehler.outcome, 'rejected');
      assert.deepEqual(gesendet(aufrufe, fall, kasse), p);
      return;
    }
    const ergebnis = await aufruf;
    assert.deepEqual(gesendet(aufrufe, fall, kasse), p);
    assert.deepEqual(ergebnis.cancellationOf, fall.response.data.cancellationOf);
    assert.deepEqual(ergebnis.remaining, fall.response.data.remaining);
    assert.equal(ergebnis.receipt.cancellationReason, p.reason);
    const zahlungen = (ergebnis.receipt.payments ?? []).map((z) => ({ ...z, method: typeof z.method === 'object' ? z.method.value : z.method }));
    assert.deepEqual(zahlungen, fall.response.data.receipt.payments);
  });
}

test('cancelReceipt: paymentMethod und Kartenfelder am Storno gehen nicht hinaus', async () => {
  const fall = STORNO.find((f) => f.name === 'error_already_cancelled')!;
  for (const feld of ['paymentMethod', 'creditCardProvider', 'cardPaymentId', 'cardPaymentData']) {
    const { rufen, aufrufe } = wegFuer(fall);
    const fehler = await fehlerVon(cancelReceipt(rufen, { ...fall.params, [feld]: feld === 'cardPaymentData' ? {} : 'cash' } as never));
    assert.ok(isKasseneckValidationError(fehler), feld);
    assert.equal(aufrufe.length, 0, feld);
  }
});

// --- sendReceiptEmail ---------------------------------------------------------

for (const fall of BELEGMAIL) {
  test(`sendReceiptEmail ${fall.name}`, async () => {
    const { rufen, aufrufe, kasse } = wegFuer(fall);
    const p = fall.params;
    if (fall.name === 'error_german_parameter') {
      // `sprache` ist kein Feld mehr: ein Aufrufer ohne Typen bekommt einen Fehler, nichts geht hinaus.
      const fehler = await fehlerVon(sendReceiptEmail(rufen, { fullReceiptId: p.fullReceiptId, to: p.to, sprache: 'de' } as never));
      assert.ok(isKasseneckValidationError(fehler));
      assert.match(fehler.reason, /sprache/);
      assert.equal(aufrufe.length, 0);
      return;
    }
    const aufruf = sendReceiptEmail(rufen, { fullReceiptId: p.fullReceiptId, to: p.to, ...(p.language ? { language: p.language } : {}) });
    if (fall.response.status === 'error') {
      const fehler = await fehlerVon(aufruf);
      assert.ok(isKasseneckApiError(fehler));
      assert.equal(fehler.code, fall.response.code);
      assert.ok((RECEIPT_EMAIL_ERROR_CODES as readonly string[]).includes(fehler.code!));
    } else {
      const ergebnis = await aufruf;
      assert.deepEqual(ergebnis, fall.response.data);
      assert.ok((RECEIPT_EMAIL_VIAS as readonly string[]).includes(ergebnis.via!));
    }
    assert.deepEqual(gesendet(aufrufe, fall, kasse), p);
  });
}

// --- listMyReceipts (Kassenweg) -----------------------------------------------

test('listMyReceipts: Parameter cashregisterId, cancellationStatus und revenue englisch', async () => {
  const faelle = KASSE.listMyReceipts!.cases.filter((f) => f.response.status === 'success' && f.response.data.receipts.length > 0 && f.params.limit === undefined && f.params.from === undefined);
  const fall = { ...faelle[0]!, endpoint: 'listMyReceipts', path: '/api/v3/listMyReceipts' };
  const { rufen, aufrufe, kasse } = wegFuer(fall, 'KASSE1');
  const liste = await listMyReceipts(rufen, { cashregisterId: 'KASSE1' });
  assert.deepEqual(gesendet(aufrufe, fall, kasse), fall.params);
  const erster = fall.response.data.receipts[0];
  assert.equal(liste.receipts[0]!.receiptId, erster.receiptId);
  assert.equal(liste.receipts[0]!.cancellationStatus, erster.cancellationStatus);
  assert.equal(liste.stats.today.revenueCents, Math.round(fall.response.data.stats.today.revenue * 100));
  assert.deepEqual(liste.stats.days.map((t) => t.revenueCents), fall.response.data.stats.days.map((t: Json) => Math.round(t.revenue * 100)));
});

// --- Kataloge: genau das Vokabular des Servers -----------------------------------

test('Kataloge und Codes sind die des /v3-Vokabulars', () => {
  const codes = VOKABULAR.errorCodes;
  assert.deepEqual([...CANCELLATION_ERROR_CODES], codes.cancellation);
  assert.deepEqual([...PAYMENT_ERROR_CODES], codes.payments);
  assert.deepEqual([...RECEIPT_EMAIL_ERROR_CODES], codes.receiptEmail);
  const beleg = [...new Set([...codes.receiptMessagesByEndpoint.createReceipt, ...codes.receiptMessagesByEndpoint.getReceipt])].sort();
  assert.deepEqual([...RECEIPT_ERROR_CODES].sort(), beleg);
  assert.ok(RECEIPT_ERROR_CODES.includes('receipt_outcome_unknown'));
  assert.ok(CANCELLATION_ERROR_CODES.includes('cancellation_outcome_unknown'));
  assert.deepEqual(Object.keys(CANCELLATION_REASONS), Object.values(VOKABULAR.catalogs.STORNO_GRUND));
  assert.deepEqual([...CANCELLATION_STATUSES], Object.values(VOKABULAR.catalogs.STORNO_STAND));
  assert.deepEqual([...RECEIPT_EMAIL_VIAS], Object.values(VOKABULAR.catalogs.MAILWEG));
  // Jeder Code ist ein /v3-Code: klein, kein alter deutscher oder grosser.
  for (const code of [...CANCELLATION_ERROR_CODES, ...PAYMENT_ERROR_CODES, ...RECEIPT_EMAIL_ERROR_CODES, ...RECEIPT_ERROR_CODES]) {
    assert.ok(codes.all.includes(code), code);
  }
  assert.equal(isPaymentErrorCode('PAYMENTS_SUM_MISMATCH'), false);
  assert.equal(isCancellationErrorCode('bereits_storniert'), false);
});

test('jeder Code in den Antworten ist in einem Katalog des Pakets', () => {
  const alle = new Set<string>([...CANCELLATION_ERROR_CODES, ...PAYMENT_ERROR_CODES, ...RECEIPT_EMAIL_ERROR_CODES, ...RECEIPT_ERROR_CODES]);
  for (const fall of [...BELEGE, ...KASSE_BELEGE, ...STORNO, ...BELEGMAIL]) {
    const code = fall.response.code;
    if (code != null && code !== 'validation') assert.ok(alle.has(code), `${fall.name}: ${code}`);
  }
});

// --- Server-Layout (englische Form, nur durchgereicht) -------------------------------

test('ReceiptWithCompany.layout traegt die /v3-Form: ruleset und tone', async () => {
  const fall = BELEGE.find((f) => f.name === 'sale_card_with_tip')!;
  const { rufen } = wegFuer(fall);
  const { layout } = await sellReceiptWithCompany(rufen, verkaufAus(fall.params));
  assert.ok(layout != null);
  assert.equal(layout.ruleset, fall.response.data.layout.ruleset);
  assert.equal('regelwerk' in layout, false);
  const banner = layout.lines.find((z) => z.kind === 'banner');
  assert.ok(banner != null && banner.kind === 'banner');
  assert.equal(banner.tone, 'warning');
  assert.deepEqual(layout, fall.response.data.layout);
  const toene = Object.values(VOKABULAR.catalogs.LAYOUT_TON);
  for (const z of layout.lines) if (z.kind === 'banner') assert.ok(toene.includes(z.tone), z.tone);
});

/** Alle Faelle mit `data.layout`, die das Paket als ReceiptWithCompany liest (Verkauf, Beleg lesen). */
async function mitLayout(liste: Fall[]): Promise<{ fall: Fall; ergebnis: ReceiptWithCompany }[]> {
  const aus: { fall: Fall; ergebnis: ReceiptWithCompany }[] = [];
  for (const fall of liste) {
    if (fall.response.data?.layout == null) continue;
    const { rufen } = wegFuer(fall);
    if (fall.endpoint === 'getReceipt') aus.push({ fall, ergebnis: await getReceiptWithCompany(rufen, fall.params.receiptId) });
    else if (fall.params.receiptType === 'standard') aus.push({ fall, ergebnis: await sellReceiptWithCompany(rufen, verkaufAus(fall.params)) });
  }
  return aus;
}

test('Server-Layout ist ein ReceiptLayout: druckbar ohne Umweg, identisch mit der Antwort', async () => {
  const faelle = await mitLayout([...BELEGE, ...KASSE_BELEGE]);
  assert.ok(faelle.length >= 14, `nur ${faelle.length} Faelle`);
  for (const { fall, ergebnis } of faelle) {
    const layout: ReceiptLayout | null = ergebnis.layout;
    assert.deepEqual(layout, fall.response.data.layout, fall.name);
    assert.equal(receiptLayoutFromResult(ergebnis), ergebnis.layout, fall.name);
    // Zeichnen und drucken nehmen es direkt.
    assert.ok(escPosLayoutBytes(layout!).length > 0);
  }
});

/**
 * Wer das Layout selbst baut (Antwort ohne `data.layout`), setzt es mit den
 * englischen Optionen aus derselben Antwort und bekommt im Kanal `app` Zeile
 * fuer Zeile, was der Server baut: Testrahmen, Pruefangaben, Kartenblock.
 */
test('Kanal app: selbst gebautes Layout mit den englischen Optionen ist das Server-Layout', async () => {
  const faelle = await mitLayout(KASSE_BELEGE);
  assert.ok(faelle.length >= 7);
  let mitPruefangaben = 0;
  for (const { fall, ergebnis } of faelle) {
    const { receipt, company, testCashregister, testSignature, registrationInfo } = ergebnis;
    const selbst = buildReceiptLayout(receipt, company, { paperSize: 'mm80', testCashregister, testSignature, registrationInfo });
    assert.deepEqual(selbst, fall.response.data.layout, fall.name);
    // Ohne Server-Layout baut der Helfer genau das.
    assert.deepEqual(receiptLayoutFromResult({ ...ergebnis, layout: null }, { fallbackPaperSize: 'mm80' }), selbst, fall.name);
    if (registrationInfo != null) mitPruefangaben += 1;
  }
  assert.ok(mitPruefangaben >= 1, 'kein Nullbeleg mit Registrierdaten dabei');
});

test('receiptLayoutFromResult: Server-Layout gewinnt, fallbackPaperSize gilt nur ohne, Vorgabe mm58 wie 0.x', async () => {
  const { ergebnis } = (await mitLayout(KASSE_BELEGE))[0]!;
  assert.equal(ergebnis.layout!.paperSize, 'mm80');
  // Mit Server-Layout: dessen Breite, auch wenn eine andere Rueckfallbreite genannt ist.
  assert.equal(receiptLayoutFromResult(ergebnis, { fallbackPaperSize: 'mm58' }), ergebnis.layout);
  // Ohne: Vorgabe mm58, sonst die genannte Breite.
  const ohne = { ...ergebnis, layout: null };
  assert.equal(receiptLayoutFromResult(ohne).paperSize, 'mm58');
  assert.equal(receiptLayoutFromResult(ohne, { fallbackPaperSize: 'mm80' }).paperSize, 'mm80');
  const { receipt, company, testCashregister, testSignature, registrationInfo } = ergebnis;
  assert.deepEqual(receiptLayoutFromResult(ohne), buildReceiptLayout(receipt, company, { paperSize: 'mm58', testCashregister, testSignature, registrationInfo }));
  // Die alte Form `paperSize` klingt nach Druckbreite und wird darum abgewiesen, nie still uebergangen.
  assert.throws(() => receiptLayoutFromResult(ergebnis, { paperSize: 'mm58' } as never), (e: unknown) => isKasseneckValidationError(e) && /paperSize/.test(e.message));
});

test('Kanal api: das Server-Layout traegt den Kartenblock, den der Beleg ohne Anbieterdaten nicht hat', async () => {
  const { ergebnis } = (await mitLayout(BELEGE)).find(({ fall }) => fall.name === 'sale_card_with_tip')!;
  const text = (l: ReceiptLayout) => JSON.stringify(l.lines);
  assert.ok(text(receiptLayoutFromResult(ergebnis)).includes('Sumup Beleg'));
  const { receipt, company, testCashregister, testSignature, registrationInfo } = ergebnis;
  assert.ok(!text(buildReceiptLayout(receipt, company, { paperSize: 'mm80', testCashregister, testSignature, registrationInfo })).includes('Sumup Beleg'));
});

// --- Karten-Storno: Kennung der Originalzahlung ---------------------------------------

test('cardRefundReference: Kassenweg liefert die Kennung, der oeffentliche Weg wirft', async () => {
  const lesen = (liste: Fall[]) => liste.find((f) => f.name === 'get_card_receipt_with_cancellation')!;
  const kasse = wegFuer(lesen(KASSE_BELEGE));
  assert.equal(cardRefundReference(await getReceipt(kasse.rufen, 'KECK-1-ID-2'), 'p1'), 'tx-4711');
  const oeffentlich = wegFuer(lesen(BELEGE));
  const ohne = await getReceipt(oeffentlich.rufen, 'KECK-1-ID-2');
  assert.throws(() => cardRefundReference(ohne, 'p1'), (e: unknown) => isKasseneckValidationError(e) && /Kassenweg/.test(e.reason));
  assert.throws(() => cardRefundReference(ohne, 'p9'), (e: unknown) => isKasseneckValidationError(e) && /p9/.test(e.reason));
});

test('Karten-Storno: Bezug aus der Erstattung oder dem Original, erst ohne beides ein Fehler vor dem Senden', async () => {
  const storno = (kanal: string) => STORNO.find((f) => f.channel === kanal && f.name === 'cancel_full_card_refund')!;
  const original = async (liste: Fall[]) => getReceipt(wegFuer(liste.find((f) => f.name === 'get_card_receipt_with_cancellation')!).rufen, 'KECK-1-ID-2');
  const zahlung = { method: KeckPaymentMethod.creditCard, amountCents: -700, refundOf: 'p1', provider: 'sumup' as const, providerPaymentId: 'rf-1', providerData: { refund: 'ok' } };
  const ohneKennung = { method: KeckPaymentMethod.creditCard, amountCents: -700, refundOf: 'p1', provider: 'sumup' as const };

  // Eigene Kennung der Erstattung: geht hinaus, auch mit dem Original vom oeffentlichen Weg.
  for (const [kanal, liste] of [['api', BELEGE], ['app', KASSE_BELEGE]] as const) {
    const weg = wegFuer(storno(kanal));
    await cancelReceipt(weg.rufen, { receipt: await original(liste), reason: 'input_error', payments: [zahlung] });
    assert.deepEqual(gesendet(weg.aufrufe, storno(kanal), weg.kasse), storno(kanal).params, kanal);
  }

  // Ohne eigene Kennung: das Original vom Kassenweg traegt tx-4711 und liefert den Bezug.
  const app = wegFuer(storno('app'));
  await cancelReceipt(app.rufen, { receipt: await original(KASSE_BELEGE), reason: 'input_error', payments: [ohneKennung] });
  assert.equal(app.aufrufe.length, 1);

  // Ohne eigene Kennung und mit dem Original vom oeffentlichen Weg (oder ganz ohne Original): kein Bezug.
  for (const mitOriginal of [true, false]) {
    const weg = wegFuer(storno('api'));
    const bezug = mitOriginal ? { receipt: await original(BELEGE) } : { cashregisterId: 'KECK-1', originalReceiptId: 'KECK-1-ID-2' };
    const fehler = await fehlerVon(cancelReceipt(weg.rufen, { ...bezug, reason: 'input_error', payments: [ohneKennung] }));
    assert.ok(isKasseneckValidationError(fehler));
    assert.match(fehler.reason, /ohne Bezug: providerPaymentId der Erstattung/);
    assert.equal(weg.aufrufe.length, 0, 'fetch darf nicht aufgerufen werden');
  }

  // Ganz ohne Anbieterfelder (N1): Fehler, kein fetch; mit custom (ohne Terminal) geht sie hinaus.
  const leer = wegFuer(storno('api'));
  const fehler = await fehlerVon(cancelReceipt(leer.rufen, { cashregisterId: 'KECK-1', originalReceiptId: 'KECK-1-ID-2', reason: 'input_error', payments: [{ method: KeckPaymentMethod.creditCard, amountCents: -700, refundOf: 'p1' }] }));
  assert.ok(isKasseneckValidationError(fehler));
  assert.match(fehler.reason, /ohne Anbieter und ohne Kennung/);
  assert.equal(leer.aufrufe.length, 0, 'fetch darf nicht aufgerufen werden');
  const eigen = wegFuer(storno('api'));
  await cancelReceipt(eigen.rufen, { cashregisterId: 'KECK-1', originalReceiptId: 'KECK-1-ID-2', reason: 'input_error', payments: [{ method: KeckPaymentMethod.creditCard, amountCents: -700, refundOf: 'p1', provider: 'custom' }] });
  assert.equal(eigen.aufrufe.length, 1);
});

// --- getReportV2 --------------------------------------------------------------------

test('getReportV2: Zeitraum hinaus, Belege und Firmendaten englisch zurueck', async () => {
  const fall = BELEGE.find((f) => f.name === 'report')!;
  const { rufen, aufrufe, kasse } = wegFuer(fall);
  const bericht = await getReportV2(rufen, { start: fall.params.start, end: fall.params.end });
  assert.deepEqual(gesendet(aufrufe, fall, kasse), fall.params);
  const daten = fall.response.data;
  assert.equal(bericht.receipts.length, daten.receipts.length);
  bericht.receipts.forEach((b, i) => {
    const roh = daten.receipts[i];
    assert.equal(b.receiptId, roh.receiptId);
    assert.equal(b.headerVersionId, roh.headerVersionId);
    assert.equal(b.layoutRuleset, roh.layoutRuleset);
    assert.deepEqual(b.registrationInfo ?? null, roh.registrationInfo ?? null);
    assert.equal(b.cancellationReason, roh.cancellationReason ?? undefined);
    if (roh.cancellationReason != null) assert.ok(Object.values(VOKABULAR.catalogs.STORNO_GRUND).includes(roh.cancellationReason));
    roh.items.forEach((p: Json, j: number) => assert.equal(b.items[j]!.receivedImmediately, p.kind === 'tip' ? p.receivedImmediately : undefined));
  });
  const m = daten.metadata;
  assert.equal(bericht.metadata.label, m.label);
  assert.equal(bericht.metadata.taxNumber, m.taxNumber);
  assert.equal(bericht.metadata.vatId, m.vatId);
  assert.equal(bericht.metadata.companyName, m.company);
  // Das Vokabular benennt genau diese Felder um; kein deutscher Name bleibt.
  const umbenannt = Object.keys(VOKABULAR.schemas.getReportV2.data.metadata).filter((k) => k !== '__');
  assert.deepEqual(umbenannt.sort(), ['taxNumber', 'vatId']);
  for (const k of umbenannt) assert.ok(k in m, k);
  assert.ok(bericht.receipts.some((b) => b.items.some((p) => p.receivedImmediately !== undefined)));
});

test('getReportV2: unbrauchbarer Zeitraum geht nicht hinaus, unbrauchbare Antwort ist ein Antwortfehler', async () => {
  const fall = BELEGE.find((f) => f.name === 'report')!;
  for (const o of [{ start: 'gestern', end: '2026-09-30' }, { start: '2026-09-30', end: '2026-09-01' }]) {
    const { rufen, aufrufe } = wegFuer(fall);
    assert.ok(isKasseneckValidationError(await fehlerVon(getReportV2(rufen, o))));
    assert.equal(aufrufe.length, 0);
  }
  const kaputt: Fall = { ...fall, response: { status: 'success', message: '', data: { receipts: [] } } };
  const fehler = await fehlerVon(getReportV2(wegFuer(kaputt).rufen, { start: '2026-09-01', end: '2026-09-30' }));
  assert.ok(isKasseneckValidationError(fehler));
  assert.equal(fehler.scope, 'response');
});
