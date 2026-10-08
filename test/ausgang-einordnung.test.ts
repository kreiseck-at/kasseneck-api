import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ALL_CALLS,
  CALLS_WITHOUT_EFFECT,
  POS_CALLS,
  PUBLIC_CALLS,
  UNKNOWN_OUTCOME_CALLS,
  isUnknownOutcomeCall,
} from '../src/client/aufrufe.js';
import { apiKeyAuth } from '../src/client/auth.js';
import {
  KasseneckApiError,
  KasseneckHttpError,
  KasseneckNetworkError,
  isOutcomeUnknown,
  type ErrorOutcome,
} from '../src/client/errors.js';
import { createTransport, type FetchLike, type HttpResponseLike } from '../src/client/transport.js';
import { createInventoryClient, type InventoryClient } from '../src/inventory/index.js';
import { createInvoiceApi, type InvoiceApi } from '../src/invoice/index.js';

/*
 * Ausgang eines Scheiterns nach dem Senden (1.5.1): jeder Aufruf mit Wirkung
 * meldet bei Zeitlimit, Netzfehler, HTTP 5xx, unlesbarer Erfolgsantwort und
 * HTML mit Kennzeichen `outcome: 'unknown'`; Lesen und Probelauf bleiben
 * `'rejected'`. Vorher kam etwa ein Wareneingang nach einem Zeitlimit als
 * `'rejected'` an, und wer mit NEUEM Idempotenzschluessel neu sendete,
 * buchte doppelt.
 *
 * Geprueft wird ueber die echten Huellen (`createInventoryClient`,
 * `createInvoiceApi`), nicht nur am nackten Transport. Die Anfragen stammen
 * aus den Vertrags-Exporten (erfundenes Konto).
 */

type Json = Record<string, any>;
const API_KEY = 'kr_test_Beispielschluessel0123456789';
const LAGER = JSON.parse(readFileSync(new URL('../../fixtures/v3/antworten/lager.json', import.meta.url), 'utf8')) as Json;
const RECHNUNG = JSON.parse(readFileSync(new URL('../../fixtures/invoice-api-examples/issue-gross-20.json', import.meta.url), 'utf8')) as Json;

function lagerParams(name: string): Json {
  const c = (LAGER.cases as Json[]).find((x) => x.name === name);
  if (!c) throw new Error(`antworten/lager.json: kein Fall ${name}`);
  return { ...(c.params as Json) };
}

// ---- Waechter: jeder Aufruf ist eingeordnet ------------------------------------------

/** Jeder Name, den `aufrufe.ts` kennt: die Aufrufe des Pakets und beide Routenlisten. */
const ALLE_NAMEN = [...new Set<string>([...ALL_CALLS, ...PUBLIC_CALLS, ...POS_CALLS])].sort();

test('Einordnung: jeder Aufruf aus aufrufe.ts steht genau einmal als mit oder ohne Wirkung', () => {
  const mit = new Set<string>(UNKNOWN_OUTCOME_CALLS);
  const ohne = new Set<string>(Object.keys(CALLS_WITHOUT_EFFECT));
  const fehlt = ALLE_NAMEN.filter((n) => !mit.has(n) && !ohne.has(n));
  assert.deepEqual(fehlt, [], 'neuer Aufruf ohne Einordnung: in UNKNOWN_OUTCOME_CALLS (mit Wirkung) oder CALLS_WITHOUT_EFFECT (Lesen, wiederholbar) eintragen');
  const doppelt = ALLE_NAMEN.filter((n) => mit.has(n) && ohne.has(n));
  assert.deepEqual(doppelt, [], 'mit und ohne Wirkung zugleich');
  // Keine Leiche: jeder eingeordnete Name ist ein bekannter Aufruf.
  const bekannt = new Set(ALLE_NAMEN);
  assert.deepEqual([...mit, ...ohne].filter((n) => !bekannt.has(n)), [], 'eingeordnet, aber kein Aufruf');
  // Leer gegen leer waere gruen, ohne etwas zu pruefen.
  assert.ok(mit.size > 40 && ohne.size > 40, `${mit.size} mit, ${ohne.size} ohne Wirkung`);
});

test('Einordnung: die Liste mit Wirkung ist sortiert und ohne Doppel, die Gruende sind bekannt', () => {
  assert.deepEqual([...UNKNOWN_OUTCOME_CALLS], [...new Set(UNKNOWN_OUTCOME_CALLS)].sort());
  for (const [name, grund] of Object.entries(CALLS_WITHOUT_EFFECT)) {
    assert.ok(grund === 'read' || grund === 'repeatable', `${name}: ${grund}`);
  }
  // Die sechs von 1.5.0 bleiben dabei.
  for (const n of ['createReceipt', 'cancelReceipt', 'financeWebService', 'hobexPayApi', 'hobexRefundApi', 'stripeCaptureIntent']) {
    assert.ok(isUnknownOutcomeCall(n), n);
  }
  // Mindestens diese haben Wirkung (Lager, Reservierung, Webhooks, Rechnung, Rechnungskorb, Kasse).
  for (const n of [
    'createArticle', 'updateArticle', 'deactivateArticle', 'receiveGoods', 'transferStock', 'recordStockLoss',
    'changeStockCondition', 'reverseStockMovement', 'createReservation', 'extendReservation', 'releaseReservation',
    'createVariantGroup', 'updateVariantGroup', 'addVariant',
    'createStocktake', 'recordStocktakeCount', 'voidStocktakeCount', 'reviewStocktake', 'recountStocktake', 'closeStocktake',
    'cancelStocktake', 'recordMyStocktakeCount', 'voidMyStocktakeCount',
    'createWebhook', 'updateWebhook', 'deleteWebhook', 'rotateWebhookSecret', 'sendWebhookTest',
    'issueInvoice', 'cancelInvoice', 'createCreditNote', 'recordInvoicePayment', 'createCustomer', 'updateCustomer',
    'createInvoiceItem', 'updateInvoiceItem', 'withdrawInvoiceItem', 'setCustomerMandate', 'revokeCustomerMandate',
    'setMyKasseSettings', 'pairRegisterDevice', 'createPrintJob', 'sendReceiptEmail',
  ]) {
    assert.ok(isUnknownOutcomeCall(n), n);
  }
});

test('Vertrag: fixtures/surface.json fuehrt die Aufrufe mit Wirkung sortiert (unknownOutcomeCalls)', () => {
  const vertrag = JSON.parse(readFileSync(new URL('../../fixtures/surface.json', import.meta.url), 'utf8')) as Json;
  assert.deepEqual(vertrag.unknownOutcomeCalls, [...UNKNOWN_OUTCOME_CALLS].sort(), 'npm run fixtures:oberflaeche ausfuehren');
});

// ---- Stoerungen nach dem Senden --------------------------------------------------------

function antwort(rumpf: string, o: { status?: number; contentType?: string } = {}): HttpResponseLike {
  return {
    status: o.status ?? 200,
    headers: {
      get: (n) => {
        const k = n.toLowerCase();
        if (k === 'content-type') return o.contentType ?? 'application/json';
        if (k === 'kasseneck-api-version') return 'v3';
        return null;
      },
    },
    text: async () => rumpf,
    arrayBuffer: async () => new TextEncoder().encode(rumpf).buffer as ArrayBuffer,
  };
}

type Art = 'timeout' | 'network' | 'http-5xx' | 'empty-body' | 'not-json' | 'missing-status' | 'html-mit-kennzeichen';

const STOERUNGEN: Record<Art, FetchLike> = {
  timeout: (_url, init) => new Promise((_, ablehnen) => {
    init.signal.addEventListener('abort', () => ablehnen(new Error('abgebrochen')), { once: true });
  }),
  network: async () => { throw new TypeError('fetch failed'); },
  'http-5xx': async () => antwort('<html>Bad Gateway</html>', { status: 502, contentType: 'text/html' }),
  'empty-body': async () => antwort(''),
  'not-json': async () => antwort('{"status":"succ'),
  'missing-status': async () => antwort(JSON.stringify({ data: { invoice: {} } })),
  'html-mit-kennzeichen': async () => antwort('<html>umgeschrieben</html>', { contentType: 'text/html; charset=utf-8' }),
};

/** Die Fehlerart, die zu jeder Stoerung gehoert. */
function passtZurArt(art: Art, e: unknown): boolean {
  switch (art) {
    case 'timeout': return e instanceof KasseneckNetworkError && e.timedOut;
    case 'network': return e instanceof KasseneckNetworkError && !e.timedOut;
    case 'http-5xx': return e instanceof KasseneckHttpError && e.statusCode === 502 && e.reason === 'server-error';
    case 'empty-body': return e instanceof KasseneckHttpError && e.reason === 'empty-body';
    case 'not-json': return e instanceof KasseneckHttpError && e.reason === 'not-json';
    case 'missing-status': return e instanceof KasseneckHttpError && e.reason === 'missing-status';
    // Mit Wirkung: unlesbarer Rumpf (Ausgang unklar); ohne: route_missing.
    case 'html-mit-kennzeichen': return (e instanceof KasseneckHttpError && e.reason === 'not-json')
      || (e instanceof KasseneckApiError && e.code === 'route_missing');
  }
}

interface Huellen { lager: InventoryClient; rechnung: InvoiceApi; gesendet: string[] }

function huellen(holen: FetchLike): Huellen {
  const gesendet: string[] = [];
  const fetch: FetchLike = (url, init) => {
    gesendet.push(`${url.split('/').pop()} ${JSON.stringify(JSON.parse(init.body).params.dryRun ?? null)}`);
    return holen(url, init);
  };
  return {
    lager: createInventoryClient({ apiKey: API_KEY, fetch, timeoutMs: 20 }),
    rechnung: createInvoiceApi({ apiKey: API_KEY, fetch, timeoutMs: 20 }),
    gesendet,
  };
}

const RECHNUNG_ANFRAGE = (): Json => ({ ...(RECHNUNG.request as Json) });
const { dryRun: _ohne, ...VORSCHAU_EINGANG } = { ...lagerParams('receive_goods_dry_run') };

/** [Bezeichnung, erwarteter Ausgang, Aufruf ueber die Huelle, gesendeter Name + dryRun]. */
const FAELLE: Array<[string, ErrorOutcome, (h: Huellen) => Promise<unknown>, string]> = [
  // Lager mit Wirkung
  ['lager: receiveGoods', 'unknown', (h) => h.lager.receiveGoods(lagerParams('receive_goods') as never), 'receiveGoods null'],
  ['lager: createArticle', 'unknown', (h) => h.lager.createArticle(lagerParams('create_article') as never), 'createArticle null'],
  ['lager: transferStock', 'unknown', (h) => h.lager.transferStock(lagerParams('transfer_stock') as never), 'transferStock null'],
  ['lager: createWebhook', 'unknown', (h) => h.lager.createWebhook(lagerParams('create_webhook') as never), 'createWebhook null'],
  // Reservierung mit Wirkung
  ['reservierung: createReservation', 'unknown', (h) => h.lager.createReservation(lagerParams('create_reservation') as never), 'createReservation null'],
  ['reservierung: extendReservation', 'unknown', (h) => h.lager.extendReservation(lagerParams('extend_reservation') as never), 'extendReservation null'],
  ['reservierung: releaseReservation', 'unknown', (h) => h.lager.releaseReservation(lagerParams('release_reservation') as never), 'releaseReservation null'],
  // Varianten mit Wirkung (1.6.0)
  ['varianten: createVariantGroup', 'unknown', (h) => h.lager.createVariantGroup(lagerParams('create_variant_group_matrix') as never), 'createVariantGroup null'],
  ['varianten: updateVariantGroup', 'unknown', (h) => h.lager.updateVariantGroup(lagerParams('update_variant_group_deactivate') as never), 'updateVariantGroup null'],
  ['varianten: addVariant', 'unknown', (h) => h.lager.addVariant(lagerParams('add_variant') as never), 'addVariant null'],
  // Inventur mit Wirkung (1.8.0): auch Zaehlen; eine neue Zaehlung mit neuem Schluessel zaehlte doppelt.
  ['inventur: createStocktake', 'unknown', (h) => h.lager.createStocktake(lagerParams('create_stocktake') as never), 'createStocktake null'],
  ['inventur: recordStocktakeCount', 'unknown', (h) => h.lager.recordStocktakeCount(lagerParams('record_stocktake_count') as never), 'recordStocktakeCount null'],
  ['inventur: voidStocktakeCount', 'unknown', (h) => h.lager.voidStocktakeCount(lagerParams('void_stocktake_count') as never), 'voidStocktakeCount null'],
  ['inventur: reviewStocktake', 'unknown', (h) => h.lager.reviewStocktake(lagerParams('review_stocktake') as never), 'reviewStocktake null'],
  ['inventur: recountStocktake', 'unknown', (h) => h.lager.recountStocktake(lagerParams('recount_stocktake') as never), 'recountStocktake null'],
  ['inventur: closeStocktake', 'unknown', (h) => h.lager.closeStocktake(lagerParams('close_stocktake') as never), 'closeStocktake null'],
  ['inventur: cancelStocktake', 'unknown', (h) => h.lager.cancelStocktake(lagerParams('cancel_stocktake') as never), 'cancelStocktake null'],
  // Rechnung mit Wirkung
  ['rechnung: issueInvoice', 'unknown', (h) => h.rechnung.issueInvoice(RECHNUNG_ANFRAGE() as never), 'issueInvoice null'],
  ['rechnung: cancelInvoice', 'unknown', (h) => h.rechnung.cancelInvoice({ idempotencyKey: 'storno-7', invoiceId: 'inv_beispiel' } as never), 'cancelInvoice null'],
  ['rechnung: recordInvoicePayment', 'unknown', (h) => h.rechnung.recordInvoicePayment({ idempotencyKey: 'zahlung-7', invoiceId: 'inv_beispiel', amountCents: 1200, method: 'transfer' } as never), 'recordInvoicePayment null'],
  ['rechnung: createCustomer', 'unknown', (h) => h.rechnung.createCustomer({ name: 'Max Hollerer GmbH' } as never, { idempotencyKey: 'kunde-7' }), 'createCustomer null'],
  ['rechnung: updateCustomer', 'unknown', (h) => h.rechnung.updateCustomer('customer_example', { name: 'Max Hollerer GmbH' } as never), 'updateCustomer null'],
  // Lesen
  ['lesen: getStock', 'rejected', (h) => h.lager.getStock('roggenbrot'), 'getStock null'],
  ['lesen: getReservation', 'rejected', (h) => h.lager.getReservation('auto43'), 'getReservation null'],
  ['lesen: getVariantGroup', 'rejected', (h) => h.lager.getVariantGroup('auto61'), 'getVariantGroup null'],
  ['lesen: listVariantGroups', 'rejected', (h) => h.lager.listVariantGroups({ active: true }), 'listVariantGroups null'],
  ['lesen: getStocktake', 'rejected', (h) => h.lager.getStocktake('auto78'), 'getStocktake null'],
  ['lesen: listStocktakeItems', 'rejected', (h) => h.lager.listStocktakeItems({ stocktakeId: 'auto78' }), 'listStocktakeItems null'],
  ['lesen: listStocktakeCounts', 'rejected', (h) => h.lager.listStocktakeCounts({ stocktakeId: 'auto78' }), 'listStocktakeCounts null'],
  ['lesen: getStocktakePdf (Datei oder Link)', 'rejected', (h) => h.lager.getStocktakePdf('auto78'), 'getStocktakePdf null'],
  ['lesen: getInvoice', 'rejected', (h) => h.rechnung.getInvoice({ invoiceId: 'inv_beispiel' }), 'getInvoice null'],
  ['lesen: listInvoices', 'rejected', (h) => h.rechnung.listInvoices(), 'listInvoices null'],
  // Probelauf unter dem Namen des echten Aufrufs
  ['probelauf: previewGoodsReceipt', 'rejected', (h) => h.lager.previewGoodsReceipt(VORSCHAU_EINGANG as never), 'receiveGoods true'],
  ['probelauf: previewInvoice', 'rejected', (h) => h.rechnung.previewInvoice(RECHNUNG_ANFRAGE() as never), 'issueInvoice true'],
  ['probelauf: issueInvoice mit dryRun (ohne Typen)', 'rejected', (h) => h.rechnung.issueInvoice({ ...RECHNUNG_ANFRAGE(), dryRun: true } as never), 'issueInvoice true'],
];

for (const art of Object.keys(STOERUNGEN) as Art[]) {
  test(`Ausgang bei ${art}: mit Wirkung unknown, Lesen und Probelauf rejected (ueber die Huellen)`, async () => {
    for (const [name, erwartet, rufe, gesendetErwartet] of FAELLE) {
      const h = huellen(STOERUNGEN[art]);
      let fehler: unknown;
      try {
        await rufe(h);
      } catch (e) {
        fehler = e;
      }
      assert.ok(fehler !== undefined, `${name}: kein Fehler`);
      // Die Anfrage ging hinaus (sonst prueft dieser Fall nichts) und war die gemeinte.
      assert.deepEqual(h.gesendet, [gesendetErwartet], name);
      assert.ok(passtZurArt(art, fehler), `${name}: unerwartete Fehlerart ${String(fehler)}`);
      assert.equal((fehler as { outcome?: unknown }).outcome, erwartet, `${name} bei ${art}`);
      assert.equal(isOutcomeUnknown(fehler), erwartet === 'unknown', `${name} bei ${art}`);
    }
  });
}

test('HTML mit Kennzeichen: mit Wirkung unlesbarer Rumpf (unknown), Lesen und Probelauf route_missing (rejected)', async () => {
  for (const [name, erwartet, rufe] of FAELLE) {
    const fehler = await rufe(huellen(STOERUNGEN['html-mit-kennzeichen'])).then(() => undefined, (e: unknown) => e);
    if (erwartet === 'unknown') assert.ok(fehler instanceof KasseneckHttpError && fehler.reason === 'not-json', name);
    else assert.ok(fehler instanceof KasseneckApiError && fehler.code === 'route_missing', name);
  }
});

// ---- Angabe beim Aufruf (offener Transport) -----------------------------------------------

test('hasEffect beim Aufruf: true hebt jeden Aufruf, false senkt nur einen Probelauf; ohne Angabe gilt die Liste', async () => {
  const rufen = createTransport({
    auth: apiKeyAuth({ apiKey: API_KEY, cashregisterToken: 'cb_test_TOKEN' }),
    fetch: STOERUNGEN.network,
  });
  const ausgang = async (name: string, hasEffect?: boolean, params: Record<string, unknown> = {}): Promise<unknown> => {
    try {
      await rufen(name, params, undefined, undefined, hasEffect === undefined ? undefined : { hasEffect });
    } catch (e) {
      assert.ok(e instanceof KasseneckNetworkError, String(e));
      return e.outcome;
    }
    return assert.fail(`${name}: kein Fehler`);
  };
  assert.equal(await ausgang('receiveGoods'), 'unknown');
  // false ohne `dryRun: true` aendert nichts: ein echter Beleg oder eine echte
  // Buchung laeuft nach einem Zeitlimit nie als `rejected`.
  for (const name of ['receiveGoods', 'createReceipt', 'issueInvoice', 'recordStockLoss']) {
    assert.equal(await ausgang(name, false), 'unknown', `${name} mit hasEffect:false ohne dryRun`);
    assert.equal(await ausgang(name, false, { dryRun: false }), 'unknown', `${name} mit dryRun:false`);
    assert.equal(await ausgang(name, false, { dryRun: 'true' }), 'unknown', `${name} mit dryRun als Text`);
    // dryRun allein (ohne die Angabe) senkt ebenfalls nicht.
    assert.equal(await ausgang(name, undefined, { dryRun: true }), 'unknown', `${name} mit dryRun ohne Angabe`);
  }
  // Nur beides zusammen ist ein Probelauf.
  assert.equal(await ausgang('receiveGoods', false, { dryRun: true }), 'rejected');
  assert.equal(await ausgang('issueInvoice', false, { dryRun: true }), 'rejected');
  assert.equal(await ausgang('getStock'), 'rejected');
  assert.equal(await ausgang('getStock', true), 'unknown');
  // Ein Name, den das Paket nicht kennt: ohne Angabe ohne Wirkung, mit Angabe unklar.
  assert.equal(await ausgang('createSomethingNew'), 'rejected');
  assert.equal(await ausgang('createSomethingNew', true), 'unknown');
  // Alle bekannten Aufrufe: der Ausgang folgt der Liste.
  for (const name of ALLE_NAMEN) {
    assert.equal(await ausgang(name), isUnknownOutcomeCall(name) ? 'unknown' : 'rejected', name);
  }
});

test('Zeitlimit schon in der Anmeldung: nichts gesendet, auch mit Wirkung rejected', async () => {
  const rufen = createTransport({
    auth: () => new Promise<never>(() => {}),
    fetch: async () => assert.fail('nichts darf hinausgehen'),
    timeoutMs: 20,
  });
  const e = await rufen('receiveGoods', {}, undefined, undefined, { hasEffect: true }).then(() => undefined, (f: unknown) => f);
  assert.ok(e instanceof KasseneckNetworkError && e.timedOut, String(e));
  assert.equal(e.outcome, 'rejected');
});
