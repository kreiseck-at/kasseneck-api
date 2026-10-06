import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createInventoryClient,
  parseInventoryWebhookEvent,
  inventoryErrorCode,
  inventoryFieldErrors,
  inventoryShortfalls,
  isInventoryError,
  isInventoryWarningCode,
  INVENTORY_IDEMPOTENCY_KEY_MAX,
  INVENTORY_WARNING_CODES,
  RESERVATION_MINUTES_MAX,
  RESERVATION_MINUTES_MIN,
  RESERVATION_STATUSES,
  type InventoryClient,
  type Reservation,
} from '../src/inventory/index.js';
import { createInvoiceApi, isInvoiceError, INVOICE_ERROR_CODES, type IssueInvoiceRequest } from '../src/invoice/index.js';
import { KasseneckApiError, KasseneckValidationError } from '../src/client/errors.js';
import type { FetchLike, HttpRequestInit, HttpResponseLike } from '../src/client/transport.js';

/*
 * Lager-API schreiben und reservieren (Backend Stufe 5b) gegen den
 * Vertrags-Export: die Drahtbeispiele stammen aus
 * `fixtures/v3/antworten/lager.json` (echte Antworten an einem erfundenen
 * Konto, Baeckerei Kornblum, Standort `haupt`), nichts davon ist hier gebaut.
 *
 * Geprueft wird vor allem, was vor dem Senden geschieht: eine schreibende
 * Anfrage ohne gueltigen `idempotencyKey` oder mit einer Bruchzahl als Menge
 * geht nie hinaus (sonst gaebe es keine sichere Wiederholung bzw. eine falsche
 * Buchung), und eine kaputte Antwort wird ein Antwortfehler, nie ein Ersatzwert.
 */

type Json = Record<string, any>;
const API_KEY = 'kr_test_Beispielschluessel0123456789';
const LAGER = JSON.parse(readFileSync(new URL('../../fixtures/v3/antworten/lager.json', import.meta.url), 'utf8')) as Json;
const VOKABULAR = JSON.parse(readFileSync(new URL('../../fixtures/v3/v3-vokabular.json', import.meta.url), 'utf8')) as Json;

function fall(name: string): Json {
  const c = (LAGER.cases as Json[]).find((x) => x.name === name);
  if (!c) throw new Error(`antworten/lager.json: kein Fall ${name}`);
  return c;
}
const daten = (name: string): Json => fall(name).response.data as Json;

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
const fehler = (message: string, data: Json) => antwort({ status: 'error', message, data, code: data['code'] });

function client(...antworten: HttpResponseLike[]): { lager: InventoryClient; anfragen: Aufzeichnung[] } {
  const anfragen: Aufzeichnung[] = [];
  let i = 0;
  const fetch: FetchLike = async (url, init) => {
    anfragen.push({ url, init });
    const naechste = antworten[i++];
    if (!naechste) throw new Error('Attrappe: keine Antwort mehr vorbereitet');
    return naechste;
  };
  return { lager: createInventoryClient({ apiKey: API_KEY, fetch }), anfragen };
}
const params = (a: Aufzeichnung | undefined): Json => JSON.parse(String(a?.init.body)).params;
const anfragefehler = (e: unknown) => e instanceof KasseneckValidationError && e.scope === 'request';
const antwortfehler = (e: unknown) => e instanceof KasseneckValidationError && e.scope === 'response';

const ARTIKEL: Json = daten('create_article').article;
const RESERVIERUNG: Json = daten('create_reservation').reservation;

// Je schreibender Aufruf eine gueltige Anfrage aus dem Vertrag und die Antwort dazu.
type Schreiben = (l: InventoryClient, p: Json) => Promise<unknown>;
const SCHREIBEN: Array<[string, Schreiben, string]> = [
  ['createArticle', (l, p) => l.createArticle(p as never), 'create_article'],
  ['updateArticle', (l, p) => l.updateArticle(p as never), 'update_article'],
  ['deactivateArticle', (l, p) => l.deactivateArticle(p as never), 'deactivate_article'],
  ['receiveGoods', (l, p) => l.receiveGoods(p as never), 'receive_goods'],
  ['transferStock', (l, p) => l.transferStock(p as never), 'transfer_stock'],
  ['recordStockLoss', (l, p) => l.recordStockLoss(p as never), 'record_stock_loss'],
  ['changeStockCondition', (l, p) => l.changeStockCondition(p as never), 'change_stock_condition'],
  ['reverseStockMovement', (l, p) => l.reverseStockMovement(p as never), 'reverse_stock_movement'],
  ['createReservation', (l, p) => l.createReservation(p as never), 'create_reservation'],
  ['extendReservation', (l, p) => l.extendReservation(p as never), 'extend_reservation'],
  ['releaseReservation', (l, p) => l.releaseReservation(p as never), 'release_reservation_partial'],
];

test('Schreiben: jede gueltige Anfrage des Vertrags geht unveraendert an /v3/<name>, die Antwort liest sich', async () => {
  assert.equal(SCHREIBEN.length, 11, 'jeder schreibende Endpunkt (ohne die Vorschau) einmal');
  for (const [name, rufe, fallName] of SCHREIBEN) {
    const c = fall(fallName);
    assert.equal(c.endpoint, name);
    const { lager, anfragen } = client(antwort(c.response));
    const ergebnis = await rufe(lager, c.params);
    assert.equal(anfragen.length, 1, name);
    assert.equal(anfragen[0]!.url, `https://api.kasseneck.at/v3/${name}`);
    assert.deepEqual(params(anfragen[0]), c.params, `${name}: Parameter`);
    assert.equal((anfragen[0]!.init.headers as Record<string, string>)['Authorization'], `Bearer ${API_KEY}`);
    // Artikel, Vorgang und Reservierung kommen Feld fuer Feld so an, wie der Server sie sendet.
    const d = c.response.data;
    assert.deepEqual(ergebnis, d.article ?? d.reservation ?? d, name);
  }
});

// ---- idempotencyKey (sicherheitsrelevant: ohne ihn keine sichere Wiederholung) ---------------

test('idempotencyKey: fehlt, null, leer, nur Leerraum, kein Text oder ueber 120 Zeichen: keine schreibende Anfrage geht hinaus', async () => {
  const falsch: unknown[] = [undefined, null, '', '   ', 42, 'x'.repeat(INVENTORY_IDEMPOTENCY_KEY_MAX + 1)];
  let geprueft = 0;
  for (const [name, rufe, fallName] of SCHREIBEN) {
    for (const schluessel of falsch) {
      const { lager, anfragen } = client(antwort(fall(fallName).response));
      const p: Json = { ...fall(fallName).params };
      if (schluessel === undefined) delete p['idempotencyKey'];
      else p['idempotencyKey'] = schluessel;
      await assert.rejects(rufe(lager, p), anfragefehler, `${name} mit ${JSON.stringify(schluessel)}`);
      assert.equal(anfragen.length, 0, `${name}: mit ${JSON.stringify(schluessel)} gesendet`);
      geprueft += 1;
    }
  }
  assert.equal(geprueft, 11 * falsch.length);
});

test('idempotencyKey: 120 Zeichen gehen hinaus, unveraendert (nie getrimmt oder gekuerzt)', async () => {
  for (const schluessel of ['k'.repeat(INVENTORY_IDEMPOTENCY_KEY_MAX), ' shop-res-1001 ', 'Bestellung 1001 / Versuch 1']) {
    const c = fall('create_reservation');
    const { lager, anfragen } = client(antwort(c.response));
    await lager.createReservation({ ...(c.params as Json), idempotencyKey: schluessel } as never);
    assert.equal(params(anfragen[0])['idempotencyKey'], schluessel);
  }
});

test('idempotencyKey: eine Wiederholung sendet dieselbe Anfrage noch einmal und liefert die gespeicherte Antwort', async () => {
  const erst = fall('create_article');
  const wieder = fall('create_article_replayed');
  assert.deepEqual(wieder.params, erst.params);
  const { lager, anfragen } = client(antwort(erst.response), antwort(wieder.response));
  const a = await lager.createArticle(erst.params as never);
  const b = await lager.createArticle(erst.params as never);
  assert.deepEqual(params(anfragen[0]), params(anfragen[1]));
  assert.deepEqual(a, b);
  const konflikt = fall('error_create_article_idempotency_conflict');
  const k = client(antwort(konflikt.response));
  const e = await k.lager.createArticle(konflikt.params as never).catch((x: unknown) => x);
  assert.ok(isInventoryError(e, 'idempotency_conflict'));
});

// ---- Ganzzahlen in der Anfrage -----------------------------------------------------------

test('Anfrage: Bruchzahl oder Text als Menge, Betrag oder Preis geht nie hinaus (Tausendstel, Cent, Mikro-Euro)', async () => {
  const eingang = fall('receive_goods').params as Json;
  const pos = (extra: Json) => [{ ...eingang['items'][0], ...extra }];
  const faelle: Array<[string, (l: InventoryClient) => Promise<unknown>]> = [
    ['quantity 1.5', (l) => l.receiveGoods({ ...eingang, items: pos({ quantity: 1.5 }) } as never)],
    ['quantity fehlt', (l) => l.receiveGoods({ ...eingang, items: [{ articleId: 'roggenbrot' }] } as never)],
    ['totalCents 2400.5', (l) => l.receiveGoods({ ...eingang, items: pos({ totalCents: 2400.5 }) } as never)],
    ['unitPriceMicros als Text', (l) => l.receiveGoods({ ...eingang, items: [{ articleId: 'kipferl', quantity: 1000, unitPriceMicros: '380000' }] } as never)],
    ['landedCostCents 0.5', (l) => l.receiveGoods({ ...eingang, items: pos({ landedCostCents: 0.5 }) } as never)],
    ['landedCosts amountCents 4.5', (l) => l.receiveGoods({ ...eingang, landedCosts: [{ type: 'freight', amountCents: 4.5 }] } as never)],
    ['items fehlt', (l) => l.receiveGoods({ idempotencyKey: 'k' } as never)],
    ['items kein Array', (l) => l.transferStock({ idempotencyKey: 'k', fromLocationId: 'haupt', toLocationId: 'lieferwagen', items: { articleId: 'x', quantity: 1000 } } as never)],
    ['Position ohne articleId', (l) => l.recordStockLoss({ idempotencyKey: 'k', reason: 'breakage', items: [{ articleId: '', quantity: 1000 }] })],
    ['Umbuchung 0.25', (l) => l.transferStock({ idempotencyKey: 'k', fromLocationId: 'haupt', toLocationId: 'lieferwagen', items: [{ articleId: 'kipferl', quantity: 0.25 }] })],
    ['Zustand NaN', (l) => l.changeStockCondition({ idempotencyKey: 'k', from: 'sellable', to: 'defective', items: [{ articleId: 'kipferl', quantity: Number.NaN }] })],
    ['Reservierung 2.5', (l) => l.createReservation({ idempotencyKey: 'k', items: [{ articleId: 'kipferl', quantity: 2.5 }] })],
    ['Freigabe 0.5', (l) => l.releaseReservation({ idempotencyKey: 'k', reservationId: 'r1', items: [{ articleId: 'kipferl', quantity: 0.5 }] })],
    ['unitPriceCents 4.5', (l) => l.createArticle({ idempotencyKey: 'k', name: 'Kaisersemmel', unitPriceCents: 4.5 })],
    ['purchasePriceMicros 1e30', (l) => l.createArticle({ idempotencyKey: 'k', name: 'Kaisersemmel', purchasePriceMicros: 1e30 })],
    ['minStock 1500.5', (l) => l.updateArticle({ idempotencyKey: 'k', articleId: 'a1', minStock: 1500.5 })],
    ['minStockByLocation 0.5', (l) => l.updateArticle({ idempotencyKey: 'k', articleId: 'a1', minStockByLocation: { haupt: 0.5 } })],
    ['minStockByLocation Liste', (l) => l.updateArticle({ idempotencyKey: 'k', articleId: 'a1', minStockByLocation: [20000] as never })],
  ];
  for (const [grund, rufe] of faelle) {
    const { lager, anfragen } = client();
    await assert.rejects(rufe(lager), anfragefehler, grund);
    assert.equal(anfragen.length, 0, `${grund}: gesendet`);
  }
});

test('Anfrage: null leert bzw. heisst „nicht angegeben“ und geht unveraendert hinaus', async () => {
  const { lager, anfragen } = client(erfolg({ article: ARTIKEL }), erfolg({ article: ARTIKEL }), erfolg({ reservation: RESERVIERUNG }));
  await lager.updateArticle({
    idempotencyKey: 'shop-update-1', articleId: 'a1', unitPriceCents: null, minStock: null, purchasePriceMicros: null,
    minStockByLocation: { haupt: null, lieferwagen: 10000 }, description: null, externalIds: null,
  });
  assert.deepEqual(params(anfragen[0]), {
    idempotencyKey: 'shop-update-1', articleId: 'a1', unitPriceCents: null, minStock: null, purchasePriceMicros: null,
    minStockByLocation: { haupt: null, lieferwagen: 10000 }, description: null, externalIds: null,
  });
  await lager.createArticle({ idempotencyKey: 'shop-artikel-1', name: 'Kaisersemmel', ean: null, minStockByLocation: null });
  assert.deepEqual(params(anfragen[1]), { idempotencyKey: 'shop-artikel-1', name: 'Kaisersemmel', ean: null, minStockByLocation: null });
  await lager.createReservation({ idempotencyKey: 'shop-res-1', items: [{ articleId: 'kipferl', quantity: 1000 }], reference: null, expiresInMinutes: null });
  assert.deepEqual(params(anfragen[2]), { idempotencyKey: 'shop-res-1', items: [{ articleId: 'kipferl', quantity: 1000 }], reference: null, expiresInMinutes: null });
});

test('Anfrage: undefined faellt weg, das Objekt des Aufrufers bleibt unveraendert', async () => {
  const { lager, anfragen } = client(erfolg(daten('transfer_stock')));
  const anfrage = { idempotencyKey: 'shop-um-1', fromLocationId: 'haupt', toLocationId: 'lieferwagen', items: [{ articleId: 'kipferl', quantity: 24000 }], note: undefined };
  const kopie = structuredClone(anfrage);
  await lager.transferStock(anfrage);
  assert.deepEqual(params(anfragen[0]), { idempotencyKey: 'shop-um-1', fromLocationId: 'haupt', toLocationId: 'lieferwagen', items: [{ articleId: 'kipferl', quantity: 24000 }] });
  assert.deepEqual(anfrage, kopie);
});

test('Anfrage: Pflichtkennungen, leere Aenderung, leere Freigabeliste und kein Objekt gehen nicht hinaus', async () => {
  const faelle: Array<[string, (l: InventoryClient) => Promise<unknown>]> = [
    ['updateArticle ohne Feld', (l) => l.updateArticle({ idempotencyKey: 'k', articleId: 'a1' })],
    ['updateArticle ohne articleId', (l) => l.updateArticle({ idempotencyKey: 'k', articleId: '', name: 'x' })],
    ['deactivateArticle ohne articleId', (l) => l.deactivateArticle({ idempotencyKey: 'k' } as never)],
    ['transferStock ohne Ziel', (l) => l.transferStock({ idempotencyKey: 'k', fromLocationId: 'haupt', items: [] } as never)],
    ['reverseStockMovement ohne operationId', (l) => l.reverseStockMovement({ idempotencyKey: 'k', operationId: ' ', reason: 'Irrtum' })],
    ['extendReservation ohne reservationId', (l) => l.extendReservation({ idempotencyKey: 'k', expiresInMinutes: 30 } as never)],
    ['releaseReservation mit leerer Liste', (l) => l.releaseReservation({ idempotencyKey: 'k', reservationId: 'r1', items: [] })],
    ['getReservation leer', (l) => l.getReservation('')],
    ['Anfrage kein Objekt', (l) => l.createArticle('Kaisersemmel' as never)],
    ['Anfrage null', (l) => l.receiveGoods(null as never)],
  ];
  for (const [grund, rufe] of faelle) {
    const { lager, anfragen } = client();
    await assert.rejects(rufe(lager), anfragefehler, grund);
    assert.equal(anfragen.length, 0, `${grund}: gesendet`);
  }
});

test('expiresInMinutes: ganze Minuten 5 … 43 200; ausserhalb geht nichts hinaus, die Grenzen schon', async () => {
  assert.equal(RESERVATION_MINUTES_MIN, 5);
  assert.equal(RESERVATION_MINUTES_MAX, 43_200);
  for (const falsch of [4, 43_201, 30.5, '30', 0]) {
    const { lager, anfragen } = client();
    await assert.rejects(lager.extendReservation({ idempotencyKey: 'k', reservationId: 'r1', expiresInMinutes: falsch as never }), anfragefehler, String(falsch));
    await assert.rejects(lager.createReservation({ idempotencyKey: 'k', items: [{ articleId: 'kipferl', quantity: 1000 }], expiresInMinutes: falsch as never }), anfragefehler);
    assert.equal(anfragen.length, 0);
  }
  const { lager, anfragen } = client();
  await assert.rejects(lager.extendReservation({ idempotencyKey: 'k', reservationId: 'r1', expiresInMinutes: null } as never), anfragefehler, 'beim Verlaengern Pflicht');
  assert.equal(anfragen.length, 0);
  const ok = client(erfolg({ reservation: RESERVIERUNG }), erfolg({ reservation: RESERVIERUNG }));
  await ok.lager.extendReservation({ idempotencyKey: 'k1', reservationId: 'r1', expiresInMinutes: 5 });
  await ok.lager.createReservation({ idempotencyKey: 'k2', items: [{ articleId: 'kipferl', quantity: 1000 }], expiresInMinutes: 43_200 });
  assert.deepEqual(ok.anfragen.map((a) => params(a)['expiresInMinutes']), [5, 43_200]);
});

// ---- Wareneingang und Vorschau --------------------------------------------------------

test('previewGoodsReceipt: dryRun true an receiveGoods, Schluessel freigestellt; Werte nur mit dem Recht costs', async () => {
  const ohne = fall('receive_goods_dry_run');
  const mit = fall('receive_goods_dry_run_with_costs');
  const { dryRun: _a, ...anfrage } = ohne.params;
  const { lager, anfragen } = client(antwort(ohne.response), antwort(mit.response), antwort(ohne.response));
  const v1 = await lager.previewGoodsReceipt(anfrage as never);
  assert.equal(anfragen[0]!.url, 'https://api.kasseneck.at/v3/receiveGoods');
  assert.deepEqual(params(anfragen[0]), ohne.params);
  assert.deepEqual(v1, ohne.response.data);
  assert.equal('baseCents' in v1.preview[0]!, false, 'ohne Recht costs fehlen die Werte ganz');
  const v2 = await lager.previewGoodsReceipt(anfrage as never);
  assert.deepEqual(v2, mit.response.data);
  assert.equal(v2.preview[0]!.unitCostMicros, 1_302_500);
  // Ein mitgesendeter Schluessel wird nur auf seine Form geprueft und nicht verbraucht.
  await lager.previewGoodsReceipt({ ...(anfrage as Json), idempotencyKey: 'shop-we-118' } as never);
  assert.equal(params(anfragen[2])['idempotencyKey'], 'shop-we-118');
  assert.equal(params(anfragen[2])['dryRun'], true);
  await assert.rejects(lager.previewGoodsReceipt({ ...(anfrage as Json), idempotencyKey: '' } as never), anfragefehler);
  assert.equal(anfragen.length, 3);
});

test('previewGoodsReceipt: idempotencyKey null geht nicht hinaus (wie nicht angegeben)', async () => {
  const ohne = fall('receive_goods_dry_run');
  const { dryRun: _a, ...anfrage } = ohne.params;
  const { lager, anfragen } = client(antwort(ohne.response));
  await lager.previewGoodsReceipt({ ...(anfrage as Json), idempotencyKey: null } as never);
  assert.equal('idempotencyKey' in params(anfragen[0]), false);
  assert.deepEqual(params(anfragen[0]), ohne.params);
});

test('receiveGoods: dryRun true ist keine Buchung und geht nicht hinaus (dafuer previewGoodsReceipt)', async () => {
  const { lager, anfragen } = client();
  await assert.rejects(lager.receiveGoods({ ...(fall('receive_goods').params as Json), dryRun: true } as never), anfragefehler);
  assert.equal(anfragen.length, 0);
});

test('Vorschau: Bruchzahl in quantity oder einem Wert ist ein Antwortfehler; fehlende preview auch', async () => {
  const zeile = daten('receive_goods_dry_run_with_costs').preview[0];
  for (const kaputt of [{ quantity: 1.5 }, { valueCents: 26.05 }, { unitCostMicros: '1302500' }, { serialNumbers: 'S1' }, { articleId: '' }]) {
    const { lager } = client(erfolg({ preview: [{ ...zeile, ...kaputt }] }));
    await assert.rejects(lager.previewGoodsReceipt({ items: [{ articleId: 'roggenbrot', quantity: 20000 }] }), antwortfehler, JSON.stringify(kaputt));
  }
  const { lager } = client(erfolg({}));
  await assert.rejects(lager.previewGoodsReceipt({ items: [{ articleId: 'roggenbrot', quantity: 20000 }] }), antwortfehler);
});

// ---- Antwort einer Buchung ------------------------------------------------------------

test('Buchung: operationId, movementIds, lotIds, warnings; Hinweise aus dem Katalog, keine Fehler', async () => {
  const c = fall('record_stock_loss');
  const { lager } = client(antwort(c.response));
  const r = await lager.recordStockLoss(c.params as never);
  assert.deepEqual(r, c.response.data);
  assert.equal(r.warnings[0]!.code, 'below_minimum');
  assert.ok(isInventoryWarningCode(r.warnings[0]!.code));
  assert.equal(isInventoryWarningCode('exceeds_stock'), false, 'ein Fehlercode ist kein Hinweis');
  for (const w of INVENTORY_WARNING_CODES) assert.ok(isInventoryWarningCode(w));
  // Jeder Hinweis im Vertrag stammt aus dem Katalog.
  for (const f of LAGER.cases as Json[]) {
    for (const w of (f.response.data?.warnings ?? []) as Json[]) assert.ok(isInventoryWarningCode(w.code), `${f.name}: ${w.code}`);
  }
});

test('Buchung: ohne operationId, mit Text statt Kennungsliste oder Hinweis ohne Code ist die Antwort unbrauchbar', async () => {
  const gut = daten('transfer_stock');
  for (const kaputt of [{ operationId: undefined }, { operationId: '' }, { movementIds: 'auto35_0' }, { lotIds: [1] }, { warnings: {} }, { warnings: [{ message: 'x' }] }]) {
    const { lager } = client(erfolg({ ...gut, ...kaputt }));
    await assert.rejects(lager.transferStock(fall('transfer_stock').params as never), antwortfehler, JSON.stringify(kaputt));
  }
});

test('Buchung: Fehler am Code (exceeds_stock, withdrawal_type_required, already_reversed, invalid_condition …)', async () => {
  for (const [name, rufe] of [
    ['error_transfer_stock_exceeds_stock', (l: InventoryClient, p: Json) => l.transferStock(p as never)],
    ['error_record_stock_loss_withdrawal_type_required', (l: InventoryClient, p: Json) => l.recordStockLoss(p as never)],
    ['error_record_stock_loss_invalid_reason', (l: InventoryClient, p: Json) => l.recordStockLoss(p as never)],
    ['error_change_stock_condition_invalid_condition', (l: InventoryClient, p: Json) => l.changeStockCondition(p as never)],
    ['error_reverse_stock_movement_already_reversed', (l: InventoryClient, p: Json) => l.reverseStockMovement(p as never)],
    ['error_update_article_stock_kind_locked', (l: InventoryClient, p: Json) => l.updateArticle(p as never)],
  ] as const) {
    const c = fall(name);
    const { lager } = client(antwort(c.response));
    const e = await rufe(lager, c.params).catch((x: unknown) => x);
    assert.ok(e instanceof KasseneckApiError, name);
    assert.equal(inventoryErrorCode(e), c.response.code, name);
  }
});

// ---- Artikel ------------------------------------------------------------------

test('Artikel: description, stockKind, minStockByLocation kommen an; code_taken nennt Feld und Artikel', async () => {
  const { lager } = client(erfolg({ article: ARTIKEL }));
  const a = await lager.createArticle(fall('create_article').params as never);
  assert.equal(a.description, 'Handgeschlagen, mit Mohn bestreut');
  assert.equal(a.stockKind, 'quantity');
  assert.deepEqual(a.minStockByLocation, { haupt: 20000 });
  assert.equal(a.minStock, null, 'Altfeld');
  const c = fall('error_create_article_code_taken');
  const e = await client(antwort(c.response)).lager.createArticle(c.params as never).catch((x: unknown) => x);
  assert.ok(isInventoryError(e, 'code_taken'));
  assert.equal((e as KasseneckApiError).details['field'], 'ean');
  assert.equal((e as KasseneckApiError).details['articleId'], 'roggenbrot');
  const v = fall('error_create_article_validation');
  const e2 = await client(antwort(v.response)).lager.createArticle(v.params as never).catch((x: unknown) => x);
  assert.deepEqual(inventoryFieldErrors(e2).map((f) => f.field), ['ean', 'minStock']);
});

test('Artikel: ein Server vor Stufe 5b ohne die neuen Felder ergibt description null, stockKind null, minStockByLocation {}', async () => {
  const { description: _d, stockKind: _s, minStockByLocation: _m, ...alt } = ARTIKEL;
  const a = await client(erfolg({ article: alt })).lager.getArticle('auto29');
  assert.equal(a.description, null);
  assert.equal(a.stockKind, null);
  assert.deepEqual(a.minStockByLocation, {});
});

test('Artikel: Bruchzahl oder Text im Mindestbestand je Standort ist ein Antwortfehler, nie gerundet', async () => {
  for (const kaputt of [{ minStockByLocation: { haupt: 1.5 } }, { minStockByLocation: { haupt: '20000' } }, { minStockByLocation: [20000] }]) {
    const { lager } = client(erfolg({ article: { ...ARTIKEL, ...kaputt } }));
    await assert.rejects(lager.getArticle('auto29'), antwortfehler, JSON.stringify(kaputt));
  }
});

// ---- Reservierung ---------------------------------------------------------------

test('Reservierung: Status aus dem Katalog, Positionen in Tausendstel; Lesen, Liste und Iterator', async () => {
  const { lager, anfragen } = client(
    antwort(fall('get_reservation_redeemed').response),
    antwort(fall('list_reservations_active').response),
    erfolg({ reservations: [RESERVIERUNG], nextCursor: 'c1' }),
    erfolg({ reservations: [{ ...RESERVIERUNG, id: 'auto49' }], nextCursor: null }),
  );
  const r: Reservation = await lager.getReservation('auto53');
  assert.deepEqual(params(anfragen[0]), { reservationId: 'auto53' });
  assert.equal(r.status, 'redeemed');
  assert.ok((RESERVATION_STATUSES as readonly string[]).includes(r.status!));
  assert.deepEqual(r.items[0], { articleId: 'roggenbrot', locationId: 'haupt', quantity: 1000, redeemed: 1000, released: 0 });
  const seite = await lager.listReservations({ status: 'active' });
  assert.deepEqual(params(anfragen[1]), { status: 'active' });
  assert.deepEqual(seite, daten('list_reservations_active'));
  const ids: string[] = [];
  for await (const x of lager.iterateReservations({ reference: 'Bestellung 1001' })) ids.push(x.id);
  assert.deepEqual(ids, ['auto43', 'auto49']);
  assert.deepEqual(params(anfragen[3]), { reference: 'Bestellung 1001', cursor: 'c1' });
  await assert.rejects(lager.listReservations({ limit: 201 }), anfragefehler);
  assert.equal(anfragen.length, 4);
});

test('Reservierung: Bruchzahl, fehlende Menge oder Kennung ist ein Antwortfehler', async () => {
  const pos = RESERVIERUNG.items[0];
  for (const kaputt of [
    { items: [{ ...pos, quantity: 1.5 }] }, { items: [{ ...pos, released: undefined }] }, { items: [{ ...pos, locationId: '' }] },
    { items: 'roggenbrot' }, { id: '' },
  ]) {
    const { lager } = client(erfolg({ reservation: { ...RESERVIERUNG, ...kaputt } }));
    await assert.rejects(lager.getReservation('auto43'), antwortfehler, JSON.stringify(kaputt));
  }
  await assert.rejects(client(erfolg({})).lager.getReservation('auto43'), antwortfehler);
});

test('Reservierung: insufficient_available nennt die fehlenden Positionen, sonst ist die Liste leer', async () => {
  const c = fall('error_create_reservation_insufficient_available');
  const { lager } = client(antwort(c.response), fehler('Reservierung nicht gefunden.', { code: 'reservation_not_found' }));
  const e = await lager.createReservation(c.params as never).catch((x: unknown) => x);
  assert.ok(isInventoryError(e, 'insufficient_available'));
  assert.deepEqual(inventoryShortfalls(e), [{ articleId: 'roggenbrot', locationId: 'haupt', requested: 3000, available: 2000 }]);
  const anderer = await lager.getReservation('gibt_es_nicht').catch((x: unknown) => x);
  assert.ok(isInventoryError(anderer, 'reservation_not_found'));
  assert.deepEqual(inventoryShortfalls(anderer), []);
  assert.deepEqual(inventoryShortfalls(new Error('x')), []);
  // Ein kaputter Eintrag faellt weg (der Aufruf ist ohnehin gescheitert, nichts reserviert).
  const kaputt = new KasseneckApiError('createReservation', 'x', { details: [{ articleId: 'a', locationId: 'haupt', requested: 1.5, available: 0 }, 'x'] }, 'insufficient_available');
  assert.deepEqual(inventoryShortfalls(kaputt), []);
});

test('Reservierung: reservation_not_active und reservation_not_found am Code', async () => {
  const c = fall('error_extend_reservation_not_active');
  const e = await client(antwort(c.response)).lager.extendReservation(c.params as never).catch((x: unknown) => x);
  assert.ok(isInventoryError(e, 'reservation_not_active'));
  const n = fall('error_get_reservation_not_found');
  const e2 = await client(antwort(n.response)).lager.getReservation(n.params['reservationId']).catch((x: unknown) => x);
  assert.ok(isInventoryError(e2, 'reservation_not_found'));
});

// ---- Bewegungen ------------------------------------------------------------------

test('Bewegung: reservation mit reservedDelta und stockAfter.reserved; sonst reservedDelta 0 und reserved null', async () => {
  const res = daten('list_stock_movements_reservation');
  const { lager } = client(erfolg(res), erfolg(daten('list_stock_movements')));
  const { movements } = await lager.listStockMovements({ articleId: 'kipferl', type: 'reservation', limit: 3 });
  assert.deepEqual(movements, res.movements);
  assert.equal(movements[0]!.type, 'reservation');
  assert.equal(movements[0]!.quantityDelta, 0);
  assert.equal(movements[0]!.reservedDelta, -3000);
  assert.equal(movements[1]!.stockAfter!.reserved, 3000);
  const andere = (await lager.listStockMovements()).movements[0]!;
  assert.equal(andere.reservedDelta, 0);
  assert.equal(andere.stockAfter!.reserved, null);
});

test('Bewegung: ein Server vor Stufe 5b ohne reservedDelta ergibt 0; Bruchzahl darin ist ein Antwortfehler', async () => {
  const b = daten('list_stock_movements').movements[0];
  const { reservedDelta: _r, ...alt } = b;
  const { lager } = client(
    erfolg({ movements: [{ ...alt, stockAfter: { sellable: 4000, defective: 0 } }], nextCursor: null }),
    erfolg({ movements: [{ ...b, reservedDelta: 0.5 }], nextCursor: null }),
    erfolg({ movements: [{ ...b, stockAfter: { sellable: 4000, defective: 0, reserved: 0.5 } }], nextCursor: null }),
  );
  const [m] = (await lager.listStockMovements()).movements;
  assert.equal(m!.reservedDelta, 0);
  assert.equal(m!.stockAfter!.reserved, null);
  await assert.rejects(lager.listStockMovements(), antwortfehler);
  await assert.rejects(lager.listStockMovements(), antwortfehler);
});

// ---- Ereignisse ------------------------------------------------------------------

test('parseInventoryWebhookEvent: reservation.expired|released|redeemed tragen die Reservierung wie getReservation', () => {
  const ereignisse = (LAGER.webhookEvents as Json[]).filter((e) => e.event.startsWith('reservation.'));
  assert.deepEqual([...new Set(ereignisse.map((e) => e.event))].sort(), ['reservation.expired', 'reservation.redeemed', 'reservation.released']);
  for (const { event, body } of ereignisse) {
    const e = parseInventoryWebhookEvent(JSON.stringify(body));
    assert.ok(e && e.type === event);
    if (e.type !== 'reservation.expired' && e.type !== 'reservation.released' && e.type !== 'reservation.redeemed') assert.fail(e.type);
    assert.deepEqual(e.data, body.data);
    assert.ok((RESERVATION_STATUSES as readonly string[]).includes(e.data.status!));
  }
  // Teilfreigabe: das Ereignis kommt, der Status bleibt active.
  const teil = ereignisse.find((e) => e.event === 'reservation.released' && e.body.data.status === 'active');
  assert.ok(teil, 'Teilfreigabe im Vertrag');
  const kaputt = { ...ereignisse[0]!.body, data: { ...ereignisse[0]!.body.data, items: [{ ...ereignisse[0]!.body.data.items[0], quantity: 2.5 }] } };
  assert.throws(() => parseInventoryWebhookEvent(JSON.stringify(kaputt)), KasseneckValidationError);
});

test('Ereignisse: die 5b-Antworten im Vertrag tragen jedes Feld ihres Schemas', async () => {
  const r = await client(antwort(fall('create_reservation').response)).lager.createReservation(fall('create_reservation').params as never);
  const s = VOKABULAR.schemas.createReservation.data.reservation;
  for (const k of Object.keys(s).filter((x) => x !== '__')) assert.ok(k in r, `Reservation.${k}`);
  for (const k of Object.keys(s.items[0]).filter((x) => x !== '__')) assert.ok(k in r.items[0]!, `ReservationItem.${k}`);
  const v = await client(antwort(fall('transfer_stock').response)).lager.transferStock(fall('transfer_stock').params as never);
  for (const k of Object.keys(VOKABULAR.schemas.transferStock.data).filter((x) => x !== '__')) assert.ok(k in v, `StockOperation.${k}`);
  const p = await client(antwort(fall('receive_goods_dry_run_with_costs').response)).lager.previewGoodsReceipt({ items: [{ articleId: 'roggenbrot', quantity: 20000 }] });
  for (const k of Object.keys(VOKABULAR.schemas.receiveGoods.data.preview[0]).filter((x) => x !== '__')) assert.ok(k in p.preview[0]!, `GoodsReceiptPreviewLine.${k}`);
});

// ---- Rechnung: Reservierung einloesen ------------------------------------------------------

test('issueInvoice: items[].reservationId geht unveraendert hinaus; Hinweis reservation_expired mit reservationId', async () => {
  const anfragen: Aufzeichnung[] = [];
  const antworten = [
    erfolg({ invoice: { id: 'inv1' }, replayed: false, notice: [{ code: 'reservation_expired', reservationId: 'auto43', message: 'Die Reservierung war schon abgelaufen.' }] }),
    fehler('Die Reservierung passt nicht zur Position.', { code: 'reservation_mismatch', field: 'items[0].reservationId', reservationId: 'auto43' }),
  ];
  const fetch: FetchLike = async (url, init) => { anfragen.push({ url, init }); return antworten[anfragen.length - 1]!; };
  const api = createInvoiceApi({ apiKey: API_KEY, fetch });
  const anfrage: IssueInvoiceRequest = {
    idempotencyKey: 'shop-rechnung-1001', priceMode: 'gross', serviceStart: '2026-10-06', stockLocationId: 'haupt',
    items: [{ description: 'Roggenbrot', quantity: 2, unitPriceCents: 450, vatRate: 10, articleId: 'roggenbrot', reservationId: 'auto43' }],
  };
  const r = await api.issueInvoice(anfrage);
  assert.deepEqual(params(anfragen[0]), anfrage);
  assert.deepEqual(r.notice, [{ code: 'reservation_expired', reservationId: 'auto43', message: 'Die Reservierung war schon abgelaufen.' }]);
  const e = await api.issueInvoice(anfrage).catch((x: unknown) => x);
  assert.ok(isInvoiceError(e, 'reservation_mismatch'));
  assert.equal((e as KasseneckApiError).details['field'], 'items[0].reservationId');
  for (const code of ['reservation_not_found', 'reservation_mismatch', 'reservation_not_active']) {
    assert.ok((INVOICE_ERROR_CODES as readonly string[]).includes(code), code);
  }
});
