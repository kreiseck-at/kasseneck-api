import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createInventoryClient,
  parseInventoryWebhookEvent,
  inventoryErrorCode,
  inventoryFieldErrors,
  isInventoryError,
  INVENTORY_IDEMPOTENCY_KEY_MAX,
  INVENTORY_WEBHOOK_EVENTS,
  VARIANT_ATTRIBUTES_MAX,
  VARIANT_GROUP_ACTIVE_MAX,
  VARIANT_MATRIX_MAX,
  VARIANT_VALUES_MAX,
  type InventoryClient,
  type VariantGroup,
} from '../src/inventory/index.js';
import { KasseneckApiError, KasseneckValidationError } from '../src/client/errors.js';
import type { FetchLike, HttpRequestInit, HttpResponseLike } from '../src/client/transport.js';

/*
 * Variantengruppen der Lager-API (Backend Stufe 5c) gegen den Vertrags-Export:
 * die Drahtbeispiele stammen aus `fixtures/v3/antworten/lager.json` (echte
 * Antworten an einem erfundenen Konto, Baeckerei Kornblum, Gruppen „Schürze“
 * und „Geschirrtuch“), nichts davon ist hier gebaut.
 *
 * Geprueft wird vor allem, was vor dem Senden geschieht (ohne gueltigen
 * `idempotencyKey` oder mit einer Bruchzahl als Preis geht nichts hinaus, die
 * Grenzen der Gruppe entscheidet der Server) und dass eine kaputte Antwort ein
 * Antwortfehler wird, nie ein Ersatzwert.
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

const SCHUERZE: Json = daten('get_variant_group').variantGroup;
const MATRIX = fall('create_variant_group_matrix');

// Je schreibender Aufruf eine gueltige Anfrage aus dem Vertrag.
type Schreiben = (l: InventoryClient, p: Json) => Promise<unknown>;
const SCHREIBEN: Array<[string, Schreiben, string]> = [
  ['createVariantGroup', (l, p) => l.createVariantGroup(p as never), 'create_variant_group_matrix'],
  ['createVariantGroup', (l, p) => l.createVariantGroup(p as never), 'create_variant_group_variants'],
  ['updateVariantGroup', (l, p) => l.updateVariantGroup(p as never), 'update_variant_group_values'],
  ['updateVariantGroup', (l, p) => l.updateVariantGroup(p as never), 'update_variant_group_deactivate'],
  ['addVariant', (l, p) => l.addVariant(p as never), 'add_variant'],
];

// ---- Vertrag ------------------------------------------------------------------

test('Varianten: jede gueltige Anfrage des Vertrags geht unveraendert an /v3/<name>, die Antwort liest sich Feld fuer Feld', async () => {
  for (const [name, rufe, fallName] of SCHREIBEN) {
    const c = fall(fallName);
    assert.equal(c.endpoint, name);
    const { lager, anfragen } = client(antwort(c.response));
    const ergebnis = await rufe(lager, c.params);
    assert.equal(anfragen.length, 1, fallName);
    assert.equal(anfragen[0]!.url, `https://api.kasseneck.at/v3/${name}`);
    assert.deepEqual(params(anfragen[0]), c.params, `${fallName}: Parameter`);
    assert.equal((anfragen[0]!.init.headers as Record<string, string>)['Authorization'], `Bearer ${API_KEY}`);
    const d = c.response.data;
    assert.deepEqual(ergebnis, d.variantGroup ?? d.article, fallName);
  }
});

test('Varianten: Lesen, Liste und Iterator; listVariantGroups nimmt active, updatedSince (Date wird ISO UTC), limit, cursor', async () => {
  const { lager, anfragen } = client(
    antwort(fall('get_variant_group').response),
    antwort(fall('list_variant_groups').response),
    erfolg({ variantGroups: [SCHUERZE], nextCursor: 'c1' }),
    erfolg({ variantGroups: [{ ...SCHUERZE, id: 'auto99' }], nextCursor: null }),
  );
  const g: VariantGroup = await lager.getVariantGroup('auto61');
  assert.deepEqual(params(anfragen[0]), { variantGroupId: 'auto61' });
  assert.deepEqual(g, SCHUERZE);
  const seite = await lager.listVariantGroups();
  assert.deepEqual(params(anfragen[1]), {});
  assert.deepEqual(seite, daten('list_variant_groups'));
  assert.deepEqual(seite.variantGroups.map((x) => x.active), [true, false]);
  const ids: string[] = [];
  for await (const x of lager.iterateVariantGroups({ active: true, updatedSince: new Date('2026-10-06T08:00:00Z'), limit: 1 })) ids.push(x.id);
  assert.deepEqual(ids, ['auto61', 'auto99']);
  assert.deepEqual(params(anfragen[2]), { active: true, updatedSince: '2026-10-06T08:00:00.000Z', limit: 1 });
  assert.deepEqual(params(anfragen[3]), { active: true, updatedSince: '2026-10-06T08:00:00.000Z', limit: 1, cursor: 'c1' });
  for (const falsch of [0, 201, 1.5]) await assert.rejects(lager.listVariantGroups({ limit: falsch }), anfragefehler, String(falsch));
  await assert.rejects(lager.getVariantGroup(''), anfragefehler);
  await assert.rejects(lager.getVariantGroup('  '), anfragefehler);
  assert.equal(anfragen.length, 4);
});

test('Varianten: listArticles({ variantGroupId }) liest die Varianten als Artikel; variantAttributes nach Schluessel sortiert', async () => {
  const c = fall('list_articles_by_variant_group');
  const { lager, anfragen } = client(antwort(c.response));
  const { articles, nextCursor } = await lager.listArticles({ variantGroupId: 'auto61', limit: 3 });
  assert.deepEqual(params(anfragen[0]), c.params);
  assert.deepEqual(articles, c.response.data.articles);
  assert.equal(nextCursor, c.response.data.nextCursor);
  for (const a of articles) {
    assert.equal(a.variantGroupId, 'auto61');
    const schluessel = Object.keys(a.variantAttributes!);
    assert.deepEqual(schluessel, [...schluessel].sort(), `${a.id}: Schluessel sortiert`);
  }
  // Die Gruppe nennt die Merkmale in ihrer eigenen Reihenfolge (Groesse vor Farbe).
  assert.deepEqual(SCHUERZE.attributes.map((m: Json) => m.key), ['groesse', 'farbe']);
  assert.equal(articles[0]!.name, 'Schürze S rot', 'Standardname in Merkmalsreihenfolge');
});

test('Varianten: jedes Feld der Gruppen-Schemata kommt im gelesenen Modell an', async () => {
  const g = await client(antwort(fall('get_variant_group').response)).lager.getVariantGroup('auto61');
  for (const name of ['createVariantGroup', 'updateVariantGroup', 'getVariantGroup'] as const) {
    const s = VOKABULAR.schemas[name].data.variantGroup;
    for (const k of Object.keys(s).filter((x) => x !== '__')) assert.ok(k in g, `${name}: VariantGroup.${k}`);
  }
  const liste = VOKABULAR.schemas.listVariantGroups.data;
  assert.deepEqual(Object.keys(liste).sort(), ['nextCursor', 'variantGroups']);
  for (const k of ['id', 'name', 'attributes', 'defaults', 'active', 'variants', 'createdAt', 'updatedAt']) assert.ok(k in g, k);
  for (const k of ['key', 'label', 'values']) assert.ok(k in g.attributes[0]!, `VariantAttribute.${k}`);
  for (const k of ['articleId', 'variantAttributes']) assert.ok(k in g.variants[0]!, `VariantGroupMember.${k}`);
  assert.deepEqual(VOKABULAR.schemas.addVariant.data.article.__, 'artikel', 'addVariant antwortet mit dem Artikel wie createArticle');
});

// ---- idempotencyKey (sicherheitsrelevant: ohne ihn keine sichere Wiederholung) ---------------

test('idempotencyKey: fehlt, null, leer, nur Leerraum, kein Text oder ueber 120 Zeichen: keine Variantenanfrage geht hinaus', async () => {
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
  assert.equal(geprueft, SCHREIBEN.length * falsch.length);
});

test('idempotencyKey: eine Wiederholung sendet dieselbe Anfrage noch einmal und liefert die gespeicherte Antwort', async () => {
  const erst = fall('add_variant');
  const wieder = fall('add_variant_replayed');
  assert.deepEqual(wieder.params, erst.params);
  const { lager, anfragen } = client(antwort(erst.response), antwort(wieder.response));
  const a = await lager.addVariant(erst.params as never);
  const b = await lager.addVariant(erst.params as never);
  assert.deepEqual(params(anfragen[0]), params(anfragen[1]));
  assert.deepEqual(a, b);
  assert.equal(a.variantGroupId, 'auto69');
  assert.deepEqual(a.variantAttributes, { farbe: 'grün' });
});

// ---- Pruefung vor dem Senden ------------------------------------------------------------

test('Anfrage: was ohne Netz sicher falsch ist, geht nie hinaus', async () => {
  const gruppe = { idempotencyKey: 'k', name: 'Schürze', attributes: [{ key: 'farbe', label: 'Farbe', values: ['rot', 'blau'] }] };
  const rot = { variantAttributes: { farbe: 'rot' } };
  const faelle: Array<[string, (l: InventoryClient) => Promise<unknown>]> = [
    ['createMatrix true mit variants', (l) => l.createVariantGroup({ ...gruppe, createMatrix: true, variants: [rot] })],
    ['createMatrix true mit leeren variants', (l) => l.createVariantGroup({ ...gruppe, createMatrix: true, variants: [] })],
    ['variants keine Liste', (l) => l.createVariantGroup({ ...gruppe, variants: rot } as never)],
    ['variants[0] kein Objekt', (l) => l.createVariantGroup({ ...gruppe, variants: ['rot'] } as never)],
    ['variants[0] ohne variantAttributes', (l) => l.createVariantGroup({ ...gruppe, variants: [{ name: 'Schürze rot' }] } as never)],
    ['variants[0].variantAttributes als Liste', (l) => l.createVariantGroup({ ...gruppe, variants: [{ variantAttributes: ['rot'] }] } as never)],
    ['variants[1].unitPriceCents 24.9', (l) => l.createVariantGroup({ ...gruppe, variants: [rot, { variantAttributes: { farbe: 'blau' }, unitPriceCents: 24.9 }] })],
    ['variants[0].minStockByLocation 0.5', (l) => l.createVariantGroup({ ...gruppe, variants: [{ ...rot, minStockByLocation: { haupt: 0.5 } }] })],
    ['defaults.unitPriceCents 2490.5', (l) => l.createVariantGroup({ ...gruppe, defaults: { unitPriceCents: 2490.5 } })],
    ['defaults als Liste', (l) => l.createVariantGroup({ ...gruppe, defaults: [2490] } as never)],
    ['addVariant ohne variantGroupId', (l) => l.addVariant({ idempotencyKey: 'k', variantAttributes: { farbe: 'rot' } } as never)],
    ['addVariant mit leerer variantGroupId', (l) => l.addVariant({ idempotencyKey: 'k', variantGroupId: ' ', variantAttributes: { farbe: 'rot' } })],
    ['addVariant ohne variantAttributes', (l) => l.addVariant({ idempotencyKey: 'k', variantGroupId: 'auto69' } as never)],
    ['addVariant mit variantAttributes null', (l) => l.addVariant({ idempotencyKey: 'k', variantGroupId: 'auto69', variantAttributes: null } as never)],
    ['addVariant purchasePriceMicros als Text', (l) => l.addVariant({ idempotencyKey: 'k', variantGroupId: 'auto69', variantAttributes: { farbe: 'rot' }, purchasePriceMicros: '1200000' } as never)],
    ['addVariant minStock 1500.5', (l) => l.addVariant({ idempotencyKey: 'k', variantGroupId: 'auto69', variantAttributes: { farbe: 'rot' }, minStock: 1500.5 })],
    ['updateVariantGroup ohne Feld', (l) => l.updateVariantGroup({ idempotencyKey: 'k', variantGroupId: 'auto61' })],
    ['updateVariantGroup ohne variantGroupId', (l) => l.updateVariantGroup({ idempotencyKey: 'k', name: 'Schürze' } as never)],
    ['updateVariantGroup active true', (l) => l.updateVariantGroup({ idempotencyKey: 'k', variantGroupId: 'auto61', active: true } as never)],
    ['updateVariantGroup active als Text', (l) => l.updateVariantGroup({ idempotencyKey: 'k', variantGroupId: 'auto61', active: 'false' } as never)],
    ['updateVariantGroup active false mit Name', (l) => l.updateVariantGroup({ idempotencyKey: 'k', variantGroupId: 'auto61', active: false, name: 'Schürze alt' })],
    ['updateVariantGroup addAttributeValues als Liste', (l) => l.updateVariantGroup({ idempotencyKey: 'k', variantGroupId: 'auto61', addAttributeValues: ['XL'] } as never)],
    ['updateVariantGroup defaults.unitPriceCents 2590.5', (l) => l.updateVariantGroup({ idempotencyKey: 'k', variantGroupId: 'auto61', defaults: { unitPriceCents: 2590.5 } })],
    ['Anfrage kein Objekt', (l) => l.createVariantGroup('Schürze' as never)],
    ['Anfrage null', (l) => l.addVariant(null as never)],
  ];
  for (const [grund, rufe] of faelle) {
    const { lager, anfragen } = client();
    const e = await rufe(lager).then(() => undefined, (x: unknown) => x);
    assert.ok(anfragefehler(e), `${grund}: ${String(e)}`);
    assert.equal(anfragen.length, 0, `${grund}: gesendet`);
  }
});

test('Anfrage: die Fehlermeldung nennt die Stelle in variants[]', async () => {
  const { lager } = client();
  const e = await lager.createVariantGroup({
    idempotencyKey: 'k', name: 'Schürze', attributes: [{ key: 'farbe', label: 'Farbe', values: ['rot', 'blau'] }],
    variants: [{ variantAttributes: { farbe: 'rot' } }, { variantAttributes: { farbe: 'blau' }, unitPriceCents: 24.9 }],
  }).then(() => undefined, (x: unknown) => x);
  assert.ok(e instanceof KasseneckValidationError);
  assert.match(e.message, /variants\[1\]\.unitPriceCents/);
});

test('Anfrage: die Grenzen der Gruppe prueft der Server; vier Merkmale, 31 Werte und eine Matrix ueber 100 gehen hinaus', async () => {
  assert.equal(VARIANT_ATTRIBUTES_MAX, 3);
  assert.equal(VARIANT_VALUES_MAX, 30);
  assert.equal(VARIANT_MATRIX_MAX, 100);
  assert.equal(VARIANT_GROUP_ACTIVE_MAX, 250);
  const werte = (n: number) => Array.from({ length: n }, (_, i) => `W${i + 1}`);
  const merkmale = ['a', 'b', 'c', 'd'].map((key) => ({ key, label: key.toUpperCase(), values: werte(4) }));
  const fehler = { status: 'error', message: 'Bitte Eingaben prüfen.', data: { code: 'validation', errors: [{ field: 'attributes', message: 'Liste mit 1 bis 3 Merkmalen.' }] }, code: 'validation' };
  const { lager, anfragen } = client(antwort(fehler), antwort(fehler), antwort(fehler));
  const anfragen3: Array<Promise<unknown>> = [
    lager.createVariantGroup({ idempotencyKey: 'k1', name: 'Servietten', attributes: merkmale, createMatrix: true }),
    lager.createVariantGroup({ idempotencyKey: 'k2', name: 'Servietten', attributes: [{ key: 'reihe', label: 'Reihe', values: werte(31) }] }),
    lager.updateVariantGroup({ idempotencyKey: 'k3', variantGroupId: 'auto61', addAttributeValues: { groesse: werte(40) } }),
  ];
  for (const p of anfragen3) assert.ok(isInventoryError(await p.then(() => undefined, (x: unknown) => x), 'validation'));
  assert.equal(anfragen.length, 3, 'keine Grenze vor dem Senden');
  assert.equal(params(anfragen[0])['attributes'].length, 4);
});

test('Anfrage: null heisst „nicht angegeben“ bzw. „leeren“ und geht unveraendert hinaus; createMatrix true mit variants null geht', async () => {
  const g = erfolg({ variantGroup: SCHUERZE });
  const { lager, anfragen } = client(g, g, g, erfolg({ article: daten('add_variant').article }));
  await lager.updateVariantGroup({ idempotencyKey: 'shop-gruppe-3001-v', variantGroupId: 'auto61', defaults: { unitPriceCents: null, stockTracked: true } });
  assert.deepEqual(params(anfragen[0]), { idempotencyKey: 'shop-gruppe-3001-v', variantGroupId: 'auto61', defaults: { unitPriceCents: null, stockTracked: true } });
  await lager.updateVariantGroup({ idempotencyKey: 'shop-gruppe-3001-w', variantGroupId: 'auto61', defaults: null });
  assert.deepEqual(params(anfragen[1]), { idempotencyKey: 'shop-gruppe-3001-w', variantGroupId: 'auto61', defaults: null });
  const matrix = { ...(MATRIX.params as Json), variants: null };
  await lager.createVariantGroup(matrix as never);
  assert.deepEqual(params(anfragen[2]), matrix);
  await lager.addVariant({ idempotencyKey: 'shop-variante-1', variantGroupId: 'auto69', variantAttributes: { farbe: 'grün' }, name: null, ean: null, unitPriceCents: null, description: undefined });
  assert.deepEqual(params(anfragen[3]), { idempotencyKey: 'shop-variante-1', variantGroupId: 'auto69', variantAttributes: { farbe: 'grün' }, name: null, ean: null, unitPriceCents: null });
});

test('Anfrage: das Objekt des Aufrufers bleibt unveraendert', async () => {
  const anfrage = { ...(fall('create_variant_group_variants').params as Json), createMatrix: undefined };
  const kopie = structuredClone(anfrage);
  const { lager, anfragen } = client(antwort(fall('create_variant_group_variants').response));
  await lager.createVariantGroup(anfrage as never);
  assert.equal('createMatrix' in params(anfragen[0]), false);
  assert.deepEqual(anfrage, kopie);
});

// ---- Antwort ------------------------------------------------------------------

test('Antwort: Bruchzahl im Vorgabepreis, fehlende Listen, Variante ohne Kennung oder Werte, die keine Texte sind, sind Antwortfehler', async () => {
  const kaputte: Json[] = [
    { defaults: { unitPriceCents: 2490.5 } },
    { defaults: { unitPriceCents: '2490' } },
    { defaults: { vatRate: '20' } },
    { defaults: { stockTracked: 'ja' } },
    { defaults: { unit: 7 } },
    { defaults: [2490] },
    { attributes: undefined },
    { attributes: {} },
    { variants: undefined },
    { variants: [{ variantAttributes: { farbe: 'rot' } }] },
    { attributes: [{ key: 'groesse', label: 'Größe', values: 'S' }] },
    { attributes: [{ key: 'groesse', label: 'Größe', values: ['S', 2] }] },
    { attributes: [{ label: 'Größe', values: ['S'] }] },
    { id: '' },
  ];
  for (const kaputt of kaputte) {
    const { lager } = client(erfolg({ variantGroup: { ...SCHUERZE, ...kaputt } }));
    await assert.rejects(lager.getVariantGroup('auto61'), antwortfehler, JSON.stringify(kaputt));
  }
  await assert.rejects(client(erfolg({})).lager.getVariantGroup('auto61'), antwortfehler);
  await assert.rejects(client(erfolg({ variantGroups: {} })).lager.listVariantGroups(), antwortfehler);
});

test('Antwort: fehlende Vorgaben sind {}, nur gesendete Vorgaben stehen im Modell; null gilt als nicht gesendet', async () => {
  const { lager } = client(
    erfolg({ variantGroup: { ...SCHUERZE, defaults: undefined } }),
    erfolg({ variantGroup: { ...SCHUERZE, defaults: { unitPriceCents: 2490, unit: null, groupId: 'textil' } } }),
  );
  assert.deepEqual((await lager.getVariantGroup('auto61')).defaults, {});
  assert.deepEqual((await lager.getVariantGroup('auto61')).defaults, { unitPriceCents: 2490, groupId: 'textil' });
});

// ---- Fehler ------------------------------------------------------------------

test('Fehler: variant_already_exists nennt Feld und bestehende Variante, invalid_variant_attributes die Feldfehler', async () => {
  const vorhanden = fall('error_add_variant_exists');
  const e = await client(antwort(vorhanden.response)).lager.addVariant(vorhanden.params as never).catch((x: unknown) => x);
  assert.ok(isInventoryError(e, 'variant_already_exists'));
  assert.equal((e as KasseneckApiError).details['articleId'], 'auto70');
  assert.equal((e as KasseneckApiError).details['field'], 'variantAttributes');
  const ungueltig = fall('error_add_variant_invalid_attributes');
  const e2 = await client(antwort(ungueltig.response)).lager.addVariant(ungueltig.params as never).catch((x: unknown) => x);
  assert.ok(isInventoryError(e2, 'invalid_variant_attributes'));
  assert.equal((e2 as KasseneckApiError).details['field'], 'variantAttributes.farbe');
  assert.deepEqual(inventoryFieldErrors(e2).map((f) => f.field), ['variantAttributes.farbe']);
});

test('Fehler: too_many_positions traegt das Feld (variants), variant_group_inactive und variant_group_not_found am Code', async () => {
  const zuViel = fall('error_create_variant_group_too_many_positions');
  assert.ok((zuViel.params.variants as unknown[]).length <= VARIANT_MATRIX_MAX, 'nicht die Grenze, das Schreibbudget');
  const e = await client(antwort(zuViel.response)).lager.createVariantGroup(zuViel.params as never).catch((x: unknown) => x);
  assert.ok(isInventoryError(e, 'too_many_positions'));
  assert.equal((e as KasseneckApiError).details['field'], 'variants');
  for (const [name, rufe] of [
    ['error_add_variant_group_inactive', (l: InventoryClient, p: Json) => l.addVariant(p as never)],
    ['error_get_variant_group_not_found', (l: InventoryClient, p: Json) => l.getVariantGroup(p['variantGroupId'])],
  ] as const) {
    const c = fall(name);
    const f = await rufe(client(antwort(c.response)).lager, c.params).catch((x: unknown) => x);
    assert.equal(inventoryErrorCode(f), c.response.code, name);
  }
  const limit = new KasseneckApiError('addVariant', 'Höchstens 250 aktive Varianten je Variantengruppe.', {}, 'variant_limit');
  assert.ok(isInventoryError(limit, 'variant_limit'));
});

// ---- Ereignisse ------------------------------------------------------------------

test('parseInventoryWebhookEvent: variant_group.created|updated tragen die Gruppe wie getVariantGroup', () => {
  assert.deepEqual(INVENTORY_WEBHOOK_EVENTS.slice(-2), ['variant_group.created', 'variant_group.updated']);
  const ereignisse = (LAGER.webhookEvents as Json[]).filter((e) => e.event.startsWith('variant_group.'));
  assert.deepEqual([...new Set(ereignisse.map((e) => e.event))].sort(), ['variant_group.created', 'variant_group.updated']);
  for (const { event, body } of ereignisse) {
    const e = parseInventoryWebhookEvent(JSON.stringify(body));
    assert.ok(e && e.type === event);
    if (e.type !== 'variant_group.created' && e.type !== 'variant_group.updated') assert.fail(e.type);
    assert.deepEqual(e.data, body.data);
    assert.ok(Array.isArray(e.data.variants));
  }
  // Stilllegen der Gruppe: genau ein variant_group.updated mit active false und eingefrorener Liste.
  const still = ereignisse.filter((e) => e.event === 'variant_group.updated' && e.body.data.active === false);
  assert.equal(still.length, 1);
  assert.equal(still[0]!.body.data.variants.length, 3);
  const kaputt = { ...ereignisse[0]!.body, data: { ...ereignisse[0]!.body.data, defaults: { unitPriceCents: 24.9 } } };
  assert.throws(() => parseInventoryWebhookEvent(JSON.stringify(kaputt)), KasseneckValidationError);
});

test('Ereignisse: zwei Zustellungen derselben Gruppe ordnet updatedAt, nicht die Ankunft', () => {
  const ereignisse = (LAGER.webhookEvents as Json[]).filter((e) => e.event.startsWith('variant_group.') && e.body.data.id === 'auto69');
  const gelesen = ereignisse.map((x) => parseInventoryWebhookEvent(JSON.stringify(x.body))!);
  // Spaet zugestellt zuerst: der Empfaenger behaelt den Stand mit dem neuesten updatedAt.
  const stand = new Map<string, VariantGroup>();
  for (const e of [...gelesen].reverse()) {
    if (e.type !== 'variant_group.created' && e.type !== 'variant_group.updated') continue;
    const alt = stand.get(e.data.id);
    if (!alt || (e.data.updatedAt ?? '') > (alt.updatedAt ?? '')) stand.set(e.data.id, e.data);
  }
  assert.equal(stand.get('auto69')!.active, false);
  assert.equal(stand.get('auto69')!.updatedAt, '2026-10-06T08:02:50.000Z');
});
