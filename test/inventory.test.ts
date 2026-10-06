import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createInventoryClient,
  inventoryKeyAuth,
  verifyWebhookSignature,
  parseWebhookEvent,
  isInventoryError,
  isInventoryErrorCode,
  inventoryErrorCode,
  inventoryFieldErrors,
  inventoryRetryAfterSec,
  INVENTORY_ENDPOINTS,
  INVENTORY_WEBHOOK_EVENTS,
  INVENTORY_WEBHOOK_ENVELOPE_FIELDS,
  INVENTORY_ERROR_CODES,
  INVENTORY_REQUEST_ERROR_CODES,
  LOCATION_TYPES,
  STOCK_MOVEMENT_TYPES,
  STOCK_MOVEMENT_SOURCES,
  STOCK_CONDITIONS,
  STOCK_CHANGE_CAUSES,
  WEBHOOK_DELIVERY_STATUSES,
  type Article,
  type InventoryWebhookEvent,
} from '../src/inventory/index.js';
import { ALL_CALLS, PUBLIC_CALLS } from '../src/client/aufrufe.js';
import { KasseneckApiError, KasseneckAuthError, KasseneckValidationError } from '../src/client/errors.js';
import type { FetchLike, HttpRequestInit, HttpResponseLike } from '../src/client/transport.js';
import { randUndAnmeldung } from './kassenweg-codes.js';

/*
 * Lager-API lesen und Konto-Webhooks (Backend Stufe 5a) gegen den
 * Vertrags-Export `fixtures/v3/v3-vokabular.json`: Endpunkte, Kataloge,
 * Feldnamen der Schemata und Ereignisse kommen aus dem Vertrag, nie aus diesem
 * Test. Die Drahtbeispiele folgen den Ansichten des Backends
 * (`lager-api-core.artikelAussen`, `bestandZeileAussen`,
 * `bewegungZeileAussen`, `konto-webhook-core.webhookAnsicht`/
 * `zustellungAnsicht`/`beispielNutzlast`), alle Daten erfunden.
 */

type Json = Record<string, any>;
const VOKABULAR = JSON.parse(readFileSync(new URL('../../fixtures/v3/v3-vokabular.json', import.meta.url), 'utf8')) as Json;
const API_KEY = 'kr_test_Beispielschluessel0123456789';

interface Aufzeichnung { url: string; init: HttpRequestInit }

function antwort(rumpf: unknown): HttpResponseLike {
  const text = JSON.stringify(rumpf);
  return {
    status: 200,
    headers: { get: (n) => (n.toLowerCase() === 'content-type' ? 'application/json' : n.toLowerCase() === 'kasseneck-api-version' ? 'v3' : null) },
    text: async () => text,
    arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer,
  };
}
const erfolg = (data: unknown) => antwort({ status: 'success', message: '', data });
// Wie gemeinsam/antwort.js: der Code steht in data.code und daneben.
const fehler = (message: string, data: Json) => antwort({ status: 'error', message, data, code: data['code'] });

function attrappe(...antworten: HttpResponseLike[]): { fetch: FetchLike; anfragen: Aufzeichnung[] } {
  const anfragen: Aufzeichnung[] = [];
  let i = 0;
  const fetch: FetchLike = async (url, init) => {
    anfragen.push({ url, init });
    const naechste = antworten[i++];
    if (!naechste) throw new Error('Attrappe: keine Antwort mehr vorbereitet');
    return naechste;
  };
  return { fetch, anfragen };
}
const params = (a: Aufzeichnung | undefined): Json => JSON.parse(String(a?.init.body)).params;
const client = (...antworten: HttpResponseLike[]) => {
  const a = attrappe(...antworten);
  return { lager: createInventoryClient({ apiKey: API_KEY, fetch: a.fetch }), anfragen: a.anfragen };
};

// ---- Drahtbeispiele (erfunden) ---------------------------------------------

const ARTIKEL: Json = {
  id: 'roggenbrot', name: 'Roggenbrot 1 kg', unitPriceCents: 450, vatRate: 10, unit: 'Stk', number: 'A-100', ean: '9001234567896',
  internalCode: null, groupId: 'brot', revenueGroupId: null, stockTracked: true, stockLocationIds: ['hauptstandort'], minStock: 5000,
  active: true, createdAt: '2026-10-01T06:00:00.000Z', updatedAt: '2026-10-06T08:15:00.000Z',
};
const BESTAND: Json = {
  articleId: 'roggenbrot', locationId: 'hauptstandort', onHand: 12000, reserved: 2000, available: 10000, defective: 0, sequence: 42,
  updatedAt: '2026-10-06T08:15:00.000Z',
};
const STANDORTE: Json[] = [
  { id: 'hauptstandort', name: 'Hauptstandort', type: 'store', address: null, licensePlate: null, active: true, virtual: true },
  { id: 'lager1', name: 'Lager Kornblum', type: 'warehouse', address: { street: 'Mühlgasse 4', zip: '5020', city: 'Salzburg', country: 'AT' }, licensePlate: null, active: true },
  { id: 'lieferwagen', name: 'Lieferwagen W-12345', type: 'vehicle', address: null, licensePlate: 'W-12345', active: false },
];
const BEWEGUNG: Json = {
  id: 'bw1', type: 'sale', articleId: 'roggenbrot', locationId: 'hauptstandort', condition: 'sellable', quantityDelta: -2000,
  stockAfter: { sellable: 10000, defective: 0 }, operationId: 'beleg_k1_r1', source: { type: 'receipt', id: 'r1', register: 'k1', position: 0 },
  viennaDay: '2026-10-06', time: '2026-10-06T08:15:00.000Z',
  lots: [{ lotId: 'los1', quantity: 2000, expiresOn: '2026-10-09', batch: 'C-7', serialNumber: null, receivedAt: '2026-10-05T05:00:00.000Z' }],
};
const WEBHOOK: Json = {
  id: 'wh1', url: 'https://shop.example.com/kasseneck-webhook', events: ['stock.changed', 'stock.below_minimum'], active: true, description: 'Shop',
  createdAt: '2026-10-06T08:00:00.000Z', lastDelivery: { at: '2026-10-06T08:15:10.000Z', status: 'delivered', statusCode: 200 }, failuresInRow: 0,
};
const ZUSTELLUNG: Json = {
  id: 'd1', webhookId: 'wh1', event: 'stock.changed', eventId: 'evt_1', status: 'failed', attempts: 6, statusCode: 500, response: 'Fehler',
  error: null, createdAt: '2026-10-06T08:15:10.000Z', lastAttemptAt: '2026-10-07T00:00:00.000Z', nextAttemptAt: null, test: false,
};

// ---- Vertrag ------------------------------------------------------------------

const AEUSSER = (namen: string[]) => namen.map((n) => (VOKABULAR.names as Record<string, string>)[n] ?? n);

test('Lager-API: INVENTORY_ENDPOINTS sind die 14 Endpunkte von Stufe 5a in endpoints.public, in Vertragsreihenfolge', () => {
  const oeffentlich = AEUSSER(VOKABULAR.endpoints.public as string[]);
  const start = oeffentlich.indexOf('getArticle');
  assert.ok(start > 0, 'getArticle fehlt im Vertrag');
  assert.deepEqual([...INVENTORY_ENDPOINTS], oeffentlich.slice(start, start + 14));
  assert.equal(INVENTORY_ENDPOINTS.at(-1), 'listWebhookDeliveries');
  for (const name of INVENTORY_ENDPOINTS) {
    assert.ok((PUBLIC_CALLS as readonly string[]).includes(name), `${name} fehlt in PUBLIC_CALLS`);
    assert.ok((ALL_CALLS as readonly string[]).includes(name), `${name} fehlt in ALL_CALLS`);
    assert.ok(VOKABULAR.schemas[name], `${name}: kein Schema im Vertrag`);
  }
});

test('Lager-API: die Wertlisten sind die Kataloge des Vertrags (aussen, in Katalogreihenfolge)', () => {
  const werte = (k: string) => Object.values(VOKABULAR.catalogs[k] as Record<string, string>);
  assert.deepEqual([...LOCATION_TYPES], werte('STANDORT_TYP'));
  assert.deepEqual([...STOCK_MOVEMENT_TYPES], werte('BEWEGUNG_ART'));
  assert.deepEqual([...STOCK_MOVEMENT_SOURCES], werte('BEWEGUNG_QUELLE'));
  assert.deepEqual([...STOCK_CONDITIONS], werte('LAGER_ZUSTAND'));
  assert.deepEqual([...STOCK_CHANGE_CAUSES], werte('LAGER_URSACHE'));
  assert.deepEqual([...WEBHOOK_DELIVERY_STATUSES], werte('ZUSTELLUNG'));
  // Die Schemata verweisen wirklich auf diese Kataloge.
  assert.deepEqual(VOKABULAR.schemas.listLocations.werte['locations[].type'], { $catalog: 'STANDORT_TYP' });
  assert.deepEqual(VOKABULAR.schemas.listStockMovements.werte['movements[].type'], { $catalog: 'BEWEGUNG_ART' });
  assert.deepEqual(VOKABULAR.schemas.listStockMovements.werte['movements[].source.type'], { $catalog: 'BEWEGUNG_QUELLE' });
  assert.deepEqual(VOKABULAR.schemas.listStockMovements.werte['movements[].condition'], { $catalog: 'LAGER_ZUSTAND' });
  assert.deepEqual(VOKABULAR.schemas.listWebhookDeliveries.werte['deliveries[].status'], { $catalog: 'ZUSTELLUNG' });
  assert.deepEqual(VOKABULAR.events['stock.changed'].werte.cause, { $catalog: 'LAGER_URSACHE' });
});

test('Lager-API: INVENTORY_WEBHOOK_EVENTS sind genau die Konto-Ereignisse des Vertrags', () => {
  const imVertrag = Object.keys(VOKABULAR.events).filter((e) => e.startsWith('stock.') || e.startsWith('article.'));
  assert.deepEqual([...INVENTORY_WEBHOOK_EVENTS].sort(), imVertrag.sort());
  assert.deepEqual([...INVENTORY_WEBHOOK_EVENTS], ['stock.changed', 'stock.below_minimum', 'article.created', 'article.updated', 'article.deactivated']);
  assert.deepEqual([...INVENTORY_WEBHOOK_ENVELOPE_FIELDS], ['id', 'type', 'createdAt', 'accountId', 'test', 'data']);
});

/** Die aeusseren Schluessel eines Schema-Eintrags (ohne `__`). */
const schluessel = (schema: Json): string[] => Object.keys(schema).filter((k) => k !== '__');

test('Lager-API: jedes Feld der Schemata kommt im gelesenen Modell an (Artikel, Bestand, Standort, Bewegung)', async () => {
  const { lager } = client(
    erfolg({ article: { ...ARTIKEL, purchasePriceMicros: 1_234_500 } }),
    erfolg({ stock: [BESTAND] }),
    erfolg({ locations: STANDORTE }),
    erfolg({ movements: [{ ...BEWEGUNG, valueDeltaCents: -90, consumedValueCents: 90, lots: [{ ...BEWEGUNG.lots[0], valueCents: 90 }] }], nextCursor: null }),
  );
  const artikel = await lager.getArticle('roggenbrot');
  for (const k of schluessel(VOKABULAR.schemas.getArticle.data.article)) assert.ok(k in artikel, `Article.${k}`);
  for (const k of VOKABULAR.articleFields.outer as string[]) {
    // Die Lager-API sendet den Kern; Kassenfelder (Kachel, Mengenregel …) nicht.
    if (k in ARTIKEL) assert.ok(k in artikel, `Article.${k}`);
  }
  const { stock } = await lager.getStock('roggenbrot');
  for (const k of schluessel(VOKABULAR.schemas.getStock.data.stock[0])) assert.ok(k in stock[0]!, `StockLevel.${k}`);
  const standorte = await lager.listLocations();
  const s = VOKABULAR.schemas.listLocations.data.locations[0];
  for (const k of schluessel(s)) assert.ok(k in standorte[1]!, `Location.${k}`);
  for (const k of schluessel(s.address)) assert.ok(k in standorte[1]!.address!, `Location.address.${k}`);
  const { movements } = await lager.listStockMovements();
  const m = VOKABULAR.schemas.listStockMovements.data.movements[0];
  const b = movements[0]!;
  for (const k of schluessel(m)) assert.ok(k in b, `StockMovement.${k}`);
  for (const k of schluessel(m.stockAfter)) assert.ok(k in b.stockAfter!, `StockMovement.stockAfter.${k}`);
  for (const k of schluessel(m.source)) assert.ok(k in b.source!, `StockMovement.source.${k}`);
  for (const k of schluessel(m.lots[0])) assert.ok(k in b.lots[0]!, `StockMovement.lots.${k}`);
});

test('Lager-API: jedes Feld der Webhook-Schemata kommt im gelesenen Modell an', async () => {
  const { lager } = client(erfolg({ webhooks: [WEBHOOK], events: [...INVENTORY_WEBHOOK_EVENTS] }), erfolg({ deliveries: [ZUSTELLUNG] }));
  const { webhooks } = await lager.listWebhooks();
  for (const k of schluessel(VOKABULAR.schemas.listWebhooks.data.webhooks[0])) assert.ok(k in webhooks[0]!, `InventoryWebhook.${k}`);
  const [z] = await lager.listWebhookDeliveries();
  for (const k of schluessel(VOKABULAR.schemas.listWebhookDeliveries.data.deliveries[0])) assert.ok(k in z!, `InventoryWebhookDelivery.${k}`);
});

/**
 * Codes, die der Lager-Rand des Backends sendet, die aber (Stand des
 * Vertrags-Exports) noch nicht in `errorCodes.all` stehen. Sobald der Export
 * sie fuehrt, wird dieser Test rot: dann die Liste leeren.
 */
const NOCH_NICHT_IM_VERTRAG = [
  'invalid_cursor', 'article_not_found', 'webhook_not_found', 'webhook_limit_reached', 'invalid_webhook_url', 'inventory_api_not_enabled',
];

test('Lager-API: INVENTORY_ERROR_CODES stehen im Vertrag, ausser den benannten Luecken des Exports', () => {
  const alle = new Set(VOKABULAR.errorCodes.all as string[]);
  const fehlend = INVENTORY_ERROR_CODES.filter((c) => !alle.has(c));
  assert.deepEqual(fehlend, NOCH_NICHT_IM_VERTRAG, 'der Vertrag fuehrt jetzt mehr Lager-Codes: NOCH_NICHT_IM_VERTRAG anpassen');
  for (const c of ['rate_limited', 'module_inactive', 'validation', 'event_not_subscribed', 'webhook_inactive', 'server_error']) {
    assert.ok((INVENTORY_ERROR_CODES as readonly string[]).includes(c), c);
  }
});

test('Lager-API: INVENTORY_REQUEST_ERROR_CODES = Anmeldung und Rand aus dem Vertrag ohne den Katalog, dahinter route_missing', () => {
  const katalog = new Set<string>(INVENTORY_ERROR_CODES);
  assert.deepEqual([...INVENTORY_REQUEST_ERROR_CODES], [...randUndAnmeldung().filter((c) => !katalog.has(c)), 'route_missing']);
  for (const c of ['api_not_approved', 'unauthorized', 'register_user_not_allowed', 'dialect_mismatch', 'route_missing', 'article_not_found']) {
    assert.ok(isInventoryErrorCode(c), c);
  }
  assert.equal(isInventoryErrorCode('brand_new_code_2027'), false);
});

// ---- Anmeldung ------------------------------------------------------------------

test('inventoryKeyAuth: Bearer des Kontoschluessels; Partner-Schluessel und Kassen-Token abgewiesen, ohne den Wert zu nennen', async () => {
  const cred = await inventoryKeyAuth({ apiKey: API_KEY })();
  assert.equal(cred.headers['Authorization'], `Bearer ${API_KEY}`);
  assert.equal(cred.headers['cashregister-token'], undefined);
  assert.throws(() => inventoryKeyAuth({ apiKey: ' ' }), KasseneckAuthError);
  for (const falsch of ['pk_live_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345', 'cb_live_ZmFsc2NoZXJUb2tlbg']) {
    assert.throws(() => inventoryKeyAuth({ apiKey: falsch }), (e: unknown) => e instanceof KasseneckAuthError && !e.message.includes(falsch));
  }
});

// ---- Artikel ------------------------------------------------------------------

test('getArticle: POST an api.kasseneck.at/v3/getArticle, Ganzzahlen bleiben, ohne Kosten-Recht kein purchasePriceMicros', async () => {
  const { lager, anfragen } = client(erfolg({ article: ARTIKEL }));
  const a: Article = await lager.getArticle('roggenbrot');
  assert.equal(anfragen[0]!.url, 'https://api.kasseneck.at/v3/getArticle');
  assert.deepEqual(params(anfragen[0]), { articleId: 'roggenbrot' });
  const h = anfragen[0]!.init.headers as Record<string, string>;
  assert.equal(h['Authorization'], `Bearer ${API_KEY}`);
  assert.deepEqual(a, ARTIKEL);
  // Das Feld fehlt ganz (nicht null): ohne Recht `costs` sendet der Server es nicht.
  assert.equal('purchasePriceMicros' in a, false);
});

test('getArticle: purchasePriceMicros, externalIds, metadata und Varianten kommen durch, wenn der Server sie sendet', async () => {
  const mehr = { ...ARTIKEL, externalIds: { shop: '4711' }, metadata: { farbe: 'dunkel' }, variantGroupId: 'vg1', variantAttributes: { size: 'L' }, purchasePriceMicros: 1_234_500 };
  const { lager } = client(erfolg({ article: mehr }), erfolg({ article: { ...ARTIKEL, purchasePriceMicros: null } }));
  assert.deepEqual(await lager.getArticle('roggenbrot'), mehr);
  assert.equal((await lager.getArticle('roggenbrot')).purchasePriceMicros, null);
});

test('getArticle: Bruchzahl als Preis, Mindestbestand oder Einkaufspreis ist ein Antwortfehler, nie gerundet', async () => {
  for (const kaputt of [{ unitPriceCents: 4.5 }, { minStock: 2.5 }, { purchasePriceMicros: 10.25 }, { id: '' }, { stockLocationIds: 'hauptstandort' }]) {
    const { lager } = client(erfolg({ article: { ...ARTIKEL, ...kaputt } }));
    await assert.rejects(lager.getArticle('roggenbrot'), (e: unknown) => e instanceof KasseneckValidationError && e.scope === 'response', JSON.stringify(kaputt));
  }
  const { lager } = client(erfolg({}));
  await assert.rejects(lager.getArticle('roggenbrot'), (e: unknown) => e instanceof KasseneckValidationError && e.scope === 'response');
});

test('getArticle: leere Kennung geht nicht raus', async () => {
  const { lager, anfragen } = client();
  await assert.rejects(lager.getArticle(''), (e: unknown) => e instanceof KasseneckValidationError && e.scope === 'request');
  assert.equal(anfragen.length, 0);
});

test('listArticles: Filter und Cursor gehen unveraendert hinaus, ein Date wird ISO UTC; nextCursor null am Ende', async () => {
  const { lager, anfragen } = client(erfolg({ articles: [ARTIKEL], nextCursor: 'eyJ6ZWl0IjoxfQ' }));
  const seite = await lager.listArticles({ updatedSince: new Date('2026-10-06T06:00:00Z'), active: true, limit: 1 });
  assert.deepEqual(params(anfragen[0]), { updatedSince: '2026-10-06T06:00:00.000Z', active: true, limit: 1 });
  assert.equal(seite.nextCursor, 'eyJ6ZWl0IjoxfQ');
  assert.deepEqual(seite.articles, [ARTIKEL]);
});

test('listArticles: limit ausserhalb 1–200 geht nicht raus', async () => {
  const { lager, anfragen } = client();
  for (const limit of [0, 201, 2.5]) {
    await assert.rejects(lager.listArticles({ limit }), (e: unknown) => e instanceof KasseneckValidationError && e.scope === 'request');
  }
  assert.equal(anfragen.length, 0);
});

test('iterateArticles: folgt nextCursor bis null, der Filter bleibt auf jeder Seite', async () => {
  const zweiter = { ...ARTIKEL, id: 'semmel', name: 'Semmel' };
  const { lager, anfragen } = client(
    erfolg({ articles: [ARTIKEL], nextCursor: 'c1' }),
    erfolg({ articles: [], nextCursor: 'c2' }),
    erfolg({ articles: [zweiter], nextCursor: null }),
  );
  const ids: string[] = [];
  for await (const a of lager.iterateArticles({ updatedSince: '2026-10-01T00:00:00.000Z' })) ids.push(a.id);
  assert.deepEqual(ids, ['roggenbrot', 'semmel']);
  assert.deepEqual(anfragen.map(params), [
    { updatedSince: '2026-10-01T00:00:00.000Z' },
    { updatedSince: '2026-10-01T00:00:00.000Z', cursor: 'c1' },
    { updatedSince: '2026-10-01T00:00:00.000Z', cursor: 'c2' },
  ]);
});

test('iterateArticles: derselbe Cursor zweimal ist ein Antwortfehler statt einer Endlosschleife', async () => {
  const { lager } = client(erfolg({ articles: [ARTIKEL], nextCursor: 'c1' }), erfolg({ articles: [ARTIKEL], nextCursor: 'c1' }));
  await assert.rejects(async () => {
    for await (const _ of lager.iterateArticles()) { /* leer */ }
  }, (e: unknown) => e instanceof KasseneckValidationError && e.scope === 'response');
});

test('lookupArticleByCode: Code als Text oder Objekt, oder externalSystem mit externalId', async () => {
  const { lager, anfragen } = client(erfolg({ article: ARTIKEL }), erfolg({ article: ARTIKEL }), erfolg({ article: ARTIKEL }));
  await lager.lookupArticleByCode('9001234567896');
  await lager.lookupArticleByCode({ code: 'A-100' });
  await lager.lookupArticleByCode({ externalSystem: 'shop', externalId: '4711' });
  assert.deepEqual(anfragen.map(params), [{ code: '9001234567896' }, { code: 'A-100' }, { externalSystem: 'shop', externalId: '4711' }]);
  assert.ok(anfragen.every((a) => a.url.endsWith('/v3/lookupArticleByCode')));
});

test('lookupArticleByCode: unvollstaendige Kennung geht nicht raus', async () => {
  const { lager, anfragen } = client();
  for (const falsch of ['', { externalSystem: 'shop' }, { externalId: '4711' }, {}, { code: 'A', externalSystem: 'shop', externalId: '1' }]) {
    await assert.rejects(lager.lookupArticleByCode(falsch as never), (e: unknown) => e instanceof KasseneckValidationError && e.scope === 'request', JSON.stringify(falsch));
  }
  assert.equal(anfragen.length, 0);
});

// ---- Standorte und Bestand --------------------------------------------------------

test('listLocations: Typen aus dem Katalog, Adresse oder null, virtual nur bei true', async () => {
  const { lager, anfragen } = client(erfolg({ locations: [...STANDORTE, { id: 'x', name: 'Neu', type: 'spaceship', active: true }] }));
  const l = await lager.listLocations();
  assert.deepEqual(params(anfragen[0]), {});
  assert.deepEqual(l[0], STANDORTE[0]);
  assert.deepEqual(l[1], { ...STANDORTE[1], virtual: false });
  assert.deepEqual(l[2], { ...STANDORTE[2], virtual: false });
  assert.equal(l[3]!.type, null, 'ein unbekannter Typ wird null, nicht geraten');
});

test('getStock: Zeilen je Standort, available darf negativ sein; values null ohne Kosten-Recht, Liste mit', async () => {
  const minus = { ...BESTAND, locationId: 'lieferwagen', onHand: 1000, reserved: 3000, available: -2000, sequence: 7 };
  const werte = [{ articleId: 'roggenbrot', stockValueCents: 2700, averageCostMicros: 225_000 }];
  const { lager, anfragen } = client(erfolg({ stock: [BESTAND, minus] }), erfolg({ stock: [BESTAND], values: werte }));
  const ohne = await lager.getStock('roggenbrot');
  assert.deepEqual(params(anfragen[0]), { articleId: 'roggenbrot' });
  assert.deepEqual(ohne, { stock: [BESTAND, minus], values: null });
  assert.deepEqual(await lager.getStock('roggenbrot'), { stock: [BESTAND], values: werte });
});

test('getStock: Bruchzahl, fehlende Menge oder Text statt Zahl ist ein Antwortfehler, nie 0', async () => {
  for (const kaputt of [{ onHand: 1.5 }, { reserved: undefined }, { available: '10000' }, { sequence: 1.1 }, { locationId: '' }]) {
    const { lager } = client(erfolg({ stock: [{ ...BESTAND, ...kaputt }] }));
    await assert.rejects(lager.getStock('roggenbrot'), (e: unknown) => e instanceof KasseneckValidationError && e.scope === 'response', JSON.stringify(kaputt));
  }
});

test('listStock und iterateStock: Filter, changedSince als Date, Seiten bis nextCursor null', async () => {
  const { lager, anfragen } = client(
    erfolg({ stock: [BESTAND], nextCursor: 'c1' }),
    erfolg({ stock: [{ ...BESTAND, locationId: 'lager1' }], nextCursor: null }),
    erfolg({ stock: [BESTAND], nextCursor: null, values: [] }),
  );
  const orte: string[] = [];
  for await (const z of lager.iterateStock({ articleId: 'roggenbrot', changedSince: new Date('2026-10-06T08:00:00Z') })) orte.push(z.locationId);
  assert.deepEqual(orte, ['hauptstandort', 'lager1']);
  assert.deepEqual(params(anfragen[1]), { articleId: 'roggenbrot', changedSince: '2026-10-06T08:00:00.000Z', cursor: 'c1' });
  const seite = await lager.listStock({ belowMinimum: true });
  assert.deepEqual(params(anfragen[2]), { belowMinimum: true });
  assert.deepEqual(seite, { stock: [BESTAND], values: [], nextCursor: null });
});

test('listStockMovements: Filter type/source englisch wie gesendet, Wertfelder nur wenn vorhanden', async () => {
  const mitWert = { ...BEWEGUNG, valueDeltaCents: -90, consumedValueCents: 90, lots: [{ ...BEWEGUNG.lots[0], valueCents: 90 }] };
  const { lager, anfragen } = client(erfolg({ movements: [BEWEGUNG], nextCursor: 'c1' }), erfolg({ movements: [mitWert], nextCursor: null }));
  const seite = await lager.listStockMovements({ articleId: 'roggenbrot', type: 'sale', source: 'receipt', from: '2026-10-01T00:00:00.000Z' });
  assert.deepEqual(params(anfragen[0]), { articleId: 'roggenbrot', type: 'sale', source: 'receipt', from: '2026-10-01T00:00:00.000Z' });
  assert.deepEqual(seite.movements, [BEWEGUNG]);
  assert.equal('valueDeltaCents' in seite.movements[0]!, false);
  const zweite = await lager.listStockMovements({ articleId: 'roggenbrot', cursor: 'c1' });
  assert.deepEqual(zweite.movements, [mitWert]);
  assert.deepEqual(params(anfragen[1]), { articleId: 'roggenbrot', cursor: 'c1' });
});

test('iterateStockMovements: alle Seiten', async () => {
  const { lager } = client(erfolg({ movements: [BEWEGUNG], nextCursor: 'c1' }), erfolg({ movements: [{ ...BEWEGUNG, id: 'bw2' }], nextCursor: null }));
  const ids: string[] = [];
  for await (const b of lager.iterateStockMovements()) ids.push(b.id);
  assert.deepEqual(ids, ['bw1', 'bw2']);
});

test('listStockMovements: Bruchzahl in quantityDelta, stockAfter oder einem Los ist ein Antwortfehler', async () => {
  for (const kaputt of [{ quantityDelta: -1.5 }, { stockAfter: { sellable: 0.5, defective: 0 } }, { lots: [{ ...BEWEGUNG.lots[0], quantity: 0.1 }] }]) {
    const { lager } = client(erfolg({ movements: [{ ...BEWEGUNG, ...kaputt }], nextCursor: null }));
    await assert.rejects(lager.listStockMovements(), (e: unknown) => e instanceof KasseneckValidationError && e.scope === 'response', JSON.stringify(kaputt));
  }
});

// ---- Fehler ---------------------------------------------------------------------

test('Fehler: rate_limited traegt retryAfterSec; inventory_api_not_enabled, module_inactive, article_not_found, invalid_cursor am Code', async () => {
  const { lager } = client(
    fehler('Zu viele Anfragen – bitte später erneut versuchen.', { code: 'rate_limited', retryAfterSec: 3 }),
    fehler('Die Lager-API ist für dieses Konto nicht freigeschaltet.', { code: 'inventory_api_not_enabled' }),
    fehler('Modul inaktiv', { code: 'module_inactive' }),
    fehler('Artikel nicht gefunden.', { code: 'article_not_found' }),
    fehler('Der Blätter-Zeiger ist ungültig.', { code: 'invalid_cursor' }),
  );
  const fang = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e; } assert.fail('kein Fehler'); };
  const e1 = await fang(lager.getStock('roggenbrot'));
  assert.ok(e1 instanceof KasseneckApiError && isInventoryError(e1, 'rate_limited'));
  assert.equal(inventoryRetryAfterSec(e1), 3);
  assert.equal((e1 as KasseneckApiError).outcome, 'rejected');
  assert.equal(inventoryErrorCode(await fang(lager.listArticles())), 'inventory_api_not_enabled');
  assert.equal(inventoryErrorCode(await fang(lager.listLocations())), 'module_inactive');
  const e4 = await fang(lager.getArticle('weg'));
  assert.ok(isInventoryError(e4, 'article_not_found'));
  assert.equal(inventoryRetryAfterSec(e4), undefined);
  assert.equal(inventoryErrorCode(await fang(lager.listStock({ cursor: 'kaputt' }))), 'invalid_cursor');
});

test('Fehler: validation liefert die Feldfehler; fremde Codes sind keine Lager-Fehler', async () => {
  const { lager } = client(fehler('Bitte Eingaben prüfen.', { code: 'validation', errors: [{ field: 'limit', message: 'Limit muss eine ganze Zahl von 1 bis 200 sein.' }] }));
  try {
    await lager.listStockMovements({ type: 'sale' });
    assert.fail('kein Fehler');
  } catch (e) {
    assert.deepEqual(inventoryFieldErrors(e), [{ field: 'limit', message: 'Limit muss eine ganze Zahl von 1 bis 200 sein.' }]);
  }
  assert.equal(isInventoryError(new KasseneckApiError('getStock', 'x', {}, 'brand_new_code_2027')), false);
  assert.equal(isInventoryError(new Error('x')), false);
});

// ---- Webhooks verwalten ------------------------------------------------------------

test('createWebhook: Secret genau einmal in der Antwort; ohne Secret ist die Antwort unbrauchbar', async () => {
  const { lager, anfragen } = client(erfolg({ webhook: WEBHOOK, secret: 'whsec_Beispiel0123456789' }), erfolg({ webhook: WEBHOOK }));
  const r = await lager.createWebhook({ url: 'https://shop.example.com/kasseneck-webhook', events: ['stock.changed', 'stock.below_minimum'], description: 'Shop' });
  assert.equal(anfragen[0]!.url, 'https://api.kasseneck.at/v3/createWebhook');
  assert.deepEqual(params(anfragen[0]), { url: 'https://shop.example.com/kasseneck-webhook', events: ['stock.changed', 'stock.below_minimum'], description: 'Shop' });
  assert.equal(r.secret, 'whsec_Beispiel0123456789');
  assert.deepEqual(r.webhook, WEBHOOK);
  await assert.rejects(lager.createWebhook({ url: 'https://shop.example.com/x', events: ['stock.changed'] }),
    (e: unknown) => e instanceof KasseneckValidationError && e.scope === 'response');
});

test('createWebhook: ohne url oder ohne Ereignis geht nichts raus', async () => {
  const { lager, anfragen } = client();
  await assert.rejects(lager.createWebhook({ url: '', events: ['stock.changed'] }), KasseneckValidationError);
  await assert.rejects(lager.createWebhook({ url: 'https://shop.example.com/x', events: [] }), KasseneckValidationError);
  assert.equal(anfragen.length, 0);
});

test('updateWebhook: flache Parameter neben webhookId; description null loescht; leere Aenderung geht nicht raus', async () => {
  const { lager, anfragen } = client(erfolg({ webhook: { ...WEBHOOK, active: false, description: null } }));
  const w = await lager.updateWebhook('wh1', { active: false, description: null });
  assert.deepEqual(params(anfragen[0]), { webhookId: 'wh1', active: false, description: null });
  assert.equal(w.active, false);
  assert.equal(w.description, null);
  await assert.rejects(lager.updateWebhook('wh1', {}), (e: unknown) => e instanceof KasseneckValidationError && e.scope === 'request');
  await assert.rejects(lager.updateWebhook('', { active: true }), KasseneckValidationError);
  assert.equal(anfragen.length, 1);
});

test('deleteWebhook, listWebhooks, rotateWebhookSecret, sendWebhookTest, listWebhookDeliveries', async () => {
  const { lager, anfragen } = client(
    erfolg({ webhookId: 'wh1', deleted: true }),
    erfolg({ webhooks: [WEBHOOK, { ...WEBHOOK, id: 'wh2', lastDelivery: null }], events: [...INVENTORY_WEBHOOK_EVENTS] }),
    erfolg({ webhook: WEBHOOK, secret: 'whsec_Neu0123456789' }),
    erfolg({ eventId: 'evt_9', event: 'stock.changed', deliveries: [{ id: 'd9', webhookId: 'wh1', status: 'delivered', statusCode: 204 }] }),
    erfolg({ deliveries: [ZUSTELLUNG] }),
  );
  assert.deepEqual(await lager.deleteWebhook('wh1'), { webhookId: 'wh1', deleted: true });
  const liste = await lager.listWebhooks();
  assert.deepEqual(liste.events, [...INVENTORY_WEBHOOK_EVENTS]);
  assert.equal(liste.webhooks[1]!.lastDelivery, null);
  assert.equal((await lager.rotateWebhookSecret('wh1')).secret, 'whsec_Neu0123456789');
  const probe = await lager.sendWebhookTest('wh1', 'stock.changed');
  assert.deepEqual(probe, { eventId: 'evt_9', event: 'stock.changed', deliveries: [{ id: 'd9', webhookId: 'wh1', status: 'delivered', statusCode: 204 }] });
  const zustellungen = await lager.listWebhookDeliveries({ webhookId: 'wh1', limit: 20 });
  assert.deepEqual(zustellungen, [ZUSTELLUNG]);
  assert.deepEqual(anfragen.map((a) => a.url.split('/').pop()),
    ['deleteWebhook', 'listWebhooks', 'rotateWebhookSecret', 'sendWebhookTest', 'listWebhookDeliveries']);
  assert.deepEqual(anfragen.map(params), [
    { webhookId: 'wh1' }, {}, { webhookId: 'wh1' }, { webhookId: 'wh1', event: 'stock.changed' }, { webhookId: 'wh1', limit: 20 },
  ]);
});

test('Webhooks: Antwort ohne Kennung ist unbrauchbar; limit der Zustellungen 1–200', async () => {
  const { lager, anfragen } = client(erfolg({ webhooks: [{ ...WEBHOOK, id: '' }], events: [] }));
  await assert.rejects(lager.listWebhooks(), (e: unknown) => e instanceof KasseneckValidationError && e.scope === 'response');
  await assert.rejects(lager.listWebhookDeliveries({ limit: 0 }), (e: unknown) => e instanceof KasseneckValidationError && e.scope === 'request');
  await assert.rejects(lager.sendWebhookTest('wh1', ''), (e: unknown) => e instanceof KasseneckValidationError && e.scope === 'request');
  assert.equal(anfragen.length, 1);
});

// ---- Signatur ------------------------------------------------------------------

// Testvektor des Backends (functions/test/unit/webhook-core.test.js).
const VEKTOR = { secret: 'whsec_test', t: 1700000000, body: '{"id":"evt_1","type":"webhook.test"}' };
const VEKTOR_HEX = '684fbc8999ff13aa332102c10e23ad56af8cb3b34c5d3bcba8bf53317e5f6c33';
const um = (sek: number) => new Date(sek * 1000);

test('verifyWebhookSignature: Testvektor des Backends (t=1700000000) ist gueltig', async () => {
  assert.equal(createHmac('sha256', VEKTOR.secret).update(`${VEKTOR.t}.${VEKTOR.body}`).digest('hex'), VEKTOR_HEX);
  const kopf = `t=${VEKTOR.t},v1=${VEKTOR_HEX}`;
  assert.equal(await verifyWebhookSignature(VEKTOR.secret, kopf, VEKTOR.body, { now: um(VEKTOR.t) }), true);
  assert.equal(await verifyWebhookSignature(VEKTOR.secret, kopf, new TextEncoder().encode(VEKTOR.body), { now: VEKTOR.t * 1000 }), true);
  // Ein zweiter v1-Anteil (Schluesselwechsel) stoert nicht.
  assert.equal(await verifyWebhookSignature(VEKTOR.secret, `t=${VEKTOR.t},v1=${'0'.repeat(64)},v1=${VEKTOR_HEX}`, VEKTOR.body, { now: um(VEKTOR.t) }), true);
});

test('verifyWebhookSignature: falscher Schluessel, veraenderter Rumpf, kaputter Kopf: nein, nie ein Wurf (Rot-Probe)', async () => {
  const kopf = `t=${VEKTOR.t},v1=${VEKTOR_HEX}`;
  const jetzt = { now: um(VEKTOR.t) };
  assert.equal(await verifyWebhookSignature('whsec_anders', kopf, VEKTOR.body, jetzt), false);
  assert.equal(await verifyWebhookSignature(VEKTOR.secret, kopf, `${VEKTOR.body} `, jetzt), false);
  assert.equal(await verifyWebhookSignature(VEKTOR.secret, kopf, JSON.stringify(JSON.parse(VEKTOR.body), null, 1), jetzt), false);
  for (const schlecht of ['', 'unsinn', `t=abc,v1=${VEKTOR_HEX}`, `v1=${VEKTOR_HEX}`, `t=${VEKTOR.t}`, `t=${VEKTOR.t},v1=zz`, null, undefined]) {
    assert.equal(await verifyWebhookSignature(VEKTOR.secret, schlecht as never, VEKTOR.body, jetzt), false, String(schlecht));
  }
  assert.equal(await verifyWebhookSignature('', kopf, VEKTOR.body, jetzt), false);
  assert.equal(await verifyWebhookSignature(VEKTOR.secret, kopf, null as never, jetzt), false);
});

test('verifyWebhookSignature: Zeitfenster 300 s in beide Richtungen, toleranceSec setzbar', async () => {
  const kopf = `t=${VEKTOR.t},v1=${VEKTOR_HEX}`;
  const pruefe = (sek: number, toleranceSec?: number) =>
    verifyWebhookSignature(VEKTOR.secret, kopf, VEKTOR.body, toleranceSec === undefined ? { now: um(sek) } : { now: um(sek), toleranceSec });
  assert.equal(await pruefe(VEKTOR.t + 300), true);
  assert.equal(await pruefe(VEKTOR.t - 300), true);
  assert.equal(await pruefe(VEKTOR.t + 301), false);
  assert.equal(await pruefe(VEKTOR.t - 301), false);
  assert.equal(await pruefe(VEKTOR.t + 600, 600), true);
  assert.equal(await pruefe(VEKTOR.t + 61, 60), false);
  // Ohne `now` gilt die Systemuhr: der Vektor von 2023 ist laengst abgelaufen.
  assert.equal(await verifyWebhookSignature(VEKTOR.secret, kopf, VEKTOR.body), false);
});

// ---- Ereignisse ------------------------------------------------------------------

/** Wie gemeinsam/webhook-core.payload fuer Konto-Webhooks: id,type,createdAt,accountId,[test],data. */
const huelle = (type: string, data: unknown, test = false) =>
  JSON.stringify({ id: 'evt_Beispiel', type, createdAt: 1791274500000, accountId: 'konto_kornblum', ...(test ? { test: true } : {}), data });

// Nutzlasten wie konto-webhook-core.beispielNutzlast (aussen, englisch).
const STOCK_CHANGED = {
  articleId: 'beispiel_roggenbrot', locationId: 'hauptstandort', onHand: 12000, reserved: 0, available: 12000, defective: 0,
  sequence: 42, updatedAt: '2026-10-06T08:15:00.000Z', cause: 'sale', movementId: 'beispiel_bewegung_1',
};
const UNTER_MINDEST = { articleId: 'beispiel_roggenbrot', locationId: 'hauptstandort', available: 4000, minStock: 5000 };

test('parseWebhookEvent: stock.changed typisiert, Huelle mit accountId, test nur bei true', () => {
  const e = parseWebhookEvent(huelle('stock.changed', STOCK_CHANGED));
  assert.ok(e);
  assert.deepEqual(Object.keys(e), [...INVENTORY_WEBHOOK_ENVELOPE_FIELDS]);
  assert.equal(e.accountId, 'konto_kornblum');
  assert.equal(e.createdAt, 1791274500000);
  assert.equal(e.test, false);
  if (e.type !== 'stock.changed') assert.fail(e.type);
  assert.deepEqual(e.data, STOCK_CHANGED);
  for (const k of schluessel(VOKABULAR.events['stock.changed'].data)) assert.ok(k in e.data, `stock.changed.${k}`);
  const probe = parseWebhookEvent(new TextEncoder().encode(huelle('stock.changed', { ...STOCK_CHANGED, movementId: null, cause: 'other' }, true)));
  assert.equal(probe?.test, true);
  assert.equal(probe?.type === 'stock.changed' && probe.data.movementId, null);
});

test('parseWebhookEvent: stock.below_minimum und article.* (Artikel wie getArticle)', () => {
  const u = parseWebhookEvent(huelle('stock.below_minimum', UNTER_MINDEST));
  assert.ok(u && u.type === 'stock.below_minimum');
  assert.deepEqual(u.data, UNTER_MINDEST);
  for (const art of ['article.created', 'article.updated', 'article.deactivated'] as const) {
    const a = parseWebhookEvent(huelle(art, { ...ARTIKEL, active: art !== 'article.deactivated' }));
    assert.ok(a && a.type === art);
    assert.equal((a.data as Article).id, 'roggenbrot');
    assert.equal((a.data as Article).active, art !== 'article.deactivated');
  }
});

test('parseWebhookEvent: unbekannter Typ ist null (2xx antworten und uebergehen), kaputter Rumpf wirft', () => {
  assert.equal(parseWebhookEvent(huelle('reservation.expired', { reservationId: 'r1' })), null);
  for (const kaputt of ['', 'kein json', '[]', '{"type":"stock.changed"}', huelle('stock.changed', { ...STOCK_CHANGED, onHand: 1.5 }),
    huelle('stock.changed', { ...STOCK_CHANGED, sequence: undefined }), huelle('stock.below_minimum', { ...UNTER_MINDEST, minStock: '5000' })]) {
    assert.throws(() => parseWebhookEvent(kaputt), KasseneckValidationError, kaputt);
  }
});

test('Shop-Ablauf: Signatur pruefen, dann Ereignis lesen, Stand nur bei groesserer sequence uebernehmen', async () => {
  const secret = 'whsec_Beispiel0123456789';
  const t = 1791274510;
  const body = huelle('stock.changed', STOCK_CHANGED);
  const kopf = `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
  const stand = new Map<string, number>([['beispiel_roggenbrot/hauptstandort', 41]]);
  assert.equal(await verifyWebhookSignature(secret, kopf, body, { now: um(t + 2) }), true);
  const e: InventoryWebhookEvent | null = parseWebhookEvent(body);
  if (!e || e.type !== 'stock.changed') assert.fail('kein stock.changed');
  const schluesselStand = `${e.data.articleId}/${e.data.locationId}`;
  if (e.data.sequence > (stand.get(schluesselStand) ?? -1)) stand.set(schluesselStand, e.data.sequence);
  assert.equal(stand.get(schluesselStand), 42);
});

test('Lager-API: ein Ereignis aus dem Kopf X-Kasseneck-Event entspricht body.type (Konstanten wie bei Partnern)', async () => {
  const lagerModul = await import('../src/inventory/index.js');
  assert.equal(lagerModul.WEBHOOK_SIGNATURE_HEADER, 'X-Kasseneck-Signature');
  assert.equal(lagerModul.WEBHOOK_EVENT_HEADER, 'X-Kasseneck-Event');
  assert.equal(lagerModul.WEBHOOK_DELIVERY_HEADER, 'X-Kasseneck-Delivery');
  assert.equal(lagerModul.WEBHOOK_TOLERANCE_SEC, 300);
  assert.equal(lagerModul.INVENTORY_WEBHOOK_LIMIT, 5);
  assert.equal(lagerModul.INVENTORY_LIST_LIMIT_MAX, 200);
});

test('Lager-API: inventoryKeyAuth haengt an createInventoryClient, baseUrl abweichend erlaubt (eigener Proxy auf /v3)', async () => {
  const a = attrappe(erfolg({ locations: [] }));
  const lager = createInventoryClient({ apiKey: API_KEY, fetch: a.fetch, baseUrl: 'https://proxy.example.com/kasseneck/v3' });
  assert.deepEqual(await lager.listLocations(), []);
  assert.equal(a.anfragen[0]!.url, 'https://proxy.example.com/kasseneck/v3/listLocations');
  assert.throws(() => createInventoryClient({ apiKey: 'pk_test_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345' }), KasseneckAuthError);
});
