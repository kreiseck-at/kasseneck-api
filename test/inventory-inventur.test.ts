import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createPdfOrDataTransport } from '../src/index.js';
import {
  createInventoryClient,
  getStocktakePdf,
  inventoryKeyAuth,
  inventoryBusyStocktakeId,
  inventoryErrorCode,
  isInventoryError,
  isInventoryWarningCode,
  INVENTORY_WARNING_CODES,
  type Stocktake,
  type StocktakeItem,
} from '../src/inventory/index.js';
import { KasseneckValidationError } from '../src/client/errors.js';
import type { FetchLike, HttpRequestInit, HttpResponseLike } from '../src/client/transport.js';

/*
 * Inventur der Lager-API (Lager-Kern Stufe 3) gegen den Vertrags-Export
 * `fixtures/v3/antworten/lager.json`: was gesendet wird, wie die Antworten
 * gelesen werden (jedes Feld des Drahts kommt im Modell an, nichts Fehlendes
 * wird 0), Blindheit und Kosten-Recht, das Protokoll als Datei oder Link, die
 * Pruefung vor dem Senden. Alle Daten erfunden (Baeckerei Kornblum).
 */

type Json = Record<string, any>;
const API_KEY = 'kr_test_Beispielschluessel0123456789';
const LAGER = JSON.parse(readFileSync(new URL('../../fixtures/v3/antworten/lager.json', import.meta.url), 'utf8')) as Json;

function fall(name: string): Json {
  const c = (LAGER.cases as Json[]).find((x) => x.name === name);
  if (!c) throw new Error(`antworten/lager.json: kein Fall ${name}`);
  return c;
}

function antwort(rumpf: string | Uint8Array, contentType = 'application/json'): HttpResponseLike {
  const bytes = typeof rumpf === 'string' ? new TextEncoder().encode(rumpf) : rumpf;
  return {
    status: 200,
    headers: { get: (n) => (n.toLowerCase() === 'content-type' ? contentType : n.toLowerCase() === 'kasseneck-api-version' ? 'v3' : null) },
    text: async () => new TextDecoder().decode(bytes),
    arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer,
  };
}
const huelle = (r: unknown) => antwort(JSON.stringify(r));
const erfolg = (data: unknown) => huelle({ status: 'success', message: '', data });

interface Aufzeichnung { url: string; init: HttpRequestInit }
function client(...antworten: HttpResponseLike[]) {
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

/**
 * Jedes Feld des Drahts steht im Modell, mit demselben Wert (rekursiv). Das
 * Modell darf mehr tragen (`recount: null`, `serialNumbers: []`), nie weniger.
 */
function traegt(modell: unknown, draht: unknown, pfad: string): void {
  if (draht === null || typeof draht !== 'object') {
    assert.deepEqual(modell, draht, pfad);
    return;
  }
  if (Array.isArray(draht)) {
    assert.ok(Array.isArray(modell), `${pfad}: keine Liste`);
    assert.equal((modell as unknown[]).length, draht.length, `${pfad}: Laenge`);
    draht.forEach((x, i) => traegt((modell as unknown[])[i], x, `${pfad}[${i}]`));
    return;
  }
  assert.ok(modell !== null && typeof modell === 'object', `${pfad}: kein Objekt`);
  for (const [k, v] of Object.entries(draht as Json)) {
    assert.ok(k in (modell as Json), `${pfad}.${k} fehlt im Modell`);
    traegt((modell as Json)[k], v, `${pfad}.${k}`);
  }
}

const INVENTUR_FAELLE = (LAGER.cases as Json[]).filter((c) => /Stocktake/.test(c.endpoint));

test('Inventur: der Vertrag fuehrt jeden der zwoelf Endpunkte mit Erfolg, die Fehler am Code', () => {
  assert.deepEqual([...new Set(INVENTUR_FAELLE.map((c) => c.endpoint))].sort(), [
    'cancelStocktake', 'closeStocktake', 'createStocktake', 'getStocktake', 'getStocktakePdf', 'listStocktakeCounts',
    'listStocktakeItems', 'listStocktakes', 'recordStocktakeCount', 'recountStocktake', 'reviewStocktake', 'voidStocktakeCount',
  ]);
  assert.ok(INVENTUR_FAELLE.length >= 30, `nur ${INVENTUR_FAELLE.length} Faelle`);
});

/** Ruft den Fall ueber den Client und gibt Ergebnis und gesendete Parameter zurueck. */
async function rufe(c: Json): Promise<{ ergebnis: any; gesendet: Json }> {
  const { lager, anfragen } = client(huelle(c.response));
  const p = c.params as Json;
  const aufrufe: Record<string, () => Promise<unknown>> = {
    createStocktake: () => lager.createStocktake(p as never),
    listStocktakes: () => lager.listStocktakes(p),
    getStocktake: () => lager.getStocktake(p.stocktakeId),
    listStocktakeItems: () => lager.listStocktakeItems(p as never),
    recordStocktakeCount: () => lager.recordStocktakeCount(p as never),
    voidStocktakeCount: () => lager.voidStocktakeCount(p as never),
    listStocktakeCounts: () => lager.listStocktakeCounts(p as never),
    reviewStocktake: () => lager.reviewStocktake(p as never),
    recountStocktake: () => lager.recountStocktake(p as never),
    closeStocktake: () => lager.closeStocktake(p as never),
    cancelStocktake: () => lager.cancelStocktake(p as never),
    getStocktakePdf: () => lager.getStocktakePdf(p.stocktakeId),
  };
  const ergebnis = await aufrufe[c.endpoint]!();
  assert.equal(anfragen.length, 1, c.name);
  assert.equal(anfragen[0]!.url, `https://api.kasseneck.at${c.path}`, c.name);
  return { ergebnis, gesendet: params(anfragen[0]) };
}

test('Inventur: jeder Erfolgsfall sendet die Parameter des Falls und liest jedes Feld des Drahts', async () => {
  let n = 0;
  for (const c of INVENTUR_FAELLE.filter((x) => x.response.status === 'success')) {
    const { ergebnis, gesendet } = await rufe(c);
    assert.deepEqual(gesendet, c.params, `${c.name}: Parameter`);
    const d = c.response.data as Json;
    switch (c.endpoint) {
      case 'listStocktakes':
        traegt(ergebnis.stocktakes, d.stocktakes, `${c.name}.stocktakes`);
        assert.equal(ergebnis.nextCursor, d.nextCursor);
        break;
      case 'listStocktakeItems':
        traegt(ergebnis.items, d.items, `${c.name}.items`);
        assert.equal(ergebnis.nextCursor, d.nextCursor);
        break;
      case 'listStocktakeCounts':
        traegt(ergebnis.counts, d.counts, `${c.name}.counts`);
        break;
      case 'recordStocktakeCount':
      case 'voidStocktakeCount':
        traegt(ergebnis, d, c.name);
        break;
      case 'closeStocktake':
        traegt(ergebnis.stocktake, d.stocktake, `${c.name}.stocktake`);
        assert.deepEqual(ergebnis.warnings, d.warnings ?? []);
        break;
      case 'getStocktakePdf':
        assert.equal(ergebnis.kind, 'download', c.name);
        traegt(ergebnis.download, d.download, `${c.name}.download`);
        break;
      default:
        traegt(ergebnis, d.stocktake, `${c.name}.stocktake`);
    }
    n += 1;
  }
  assert.ok(n >= 20, `nur ${n} Erfolgsfaelle`);
});

test('Inventur: jeder Fehlerfall geht hinaus und ergibt den Code des Falls', async () => {
  const fehler = INVENTUR_FAELLE.filter((x) => x.response.status === 'error');
  assert.ok(fehler.length >= 7);
  for (const c of fehler) {
    let e: unknown;
    try { await rufe(c); } catch (x) { e = x; }
    assert.equal(inventoryErrorCode(e), c.response.code, c.name);
  }
  // Der belegte Standort nennt die Inventur, an der weitergezaehlt wird.
  const busy = fall('error_create_stocktake_location_busy');
  let e: unknown;
  try { await rufe(busy); } catch (x) { e = x; }
  assert.ok(isInventoryError(e, 'stocktake_location_busy'));
  assert.equal(inventoryBusyStocktakeId(e), busy.response.data.stocktakeId);
  assert.equal(inventoryBusyStocktakeId(new Error('x')), undefined);
});

test('Inventur blind: in counting traegt keine Position ein Soll, ab review schon (Rot-Probe am Vertrag)', async () => {
  const soll = ['expectedQuantity', 'differenceQuantity', 'needsCheck', 'checkReasons', 'expectedAsOf', 'differenceValueCents'];
  const zaehlung = (await rufe(fall('list_stocktake_items_counting'))).ergebnis.items as StocktakeItem[];
  for (const it of zaehlung) for (const k of soll) assert.equal(k in it, false, `counting: ${k}`);
  const gezaehlt = (await rufe(fall('record_stocktake_count'))).ergebnis.item as StocktakeItem;
  for (const k of soll) assert.equal(k in gezaehlt, false, `recordStocktakeCount: ${k}`);
  // Rot-Probe: dieselbe Pruefung schlaegt an der Pruefung an.
  const pruefung = (await rufe(fall('list_stocktake_items_review'))).ergebnis.items as StocktakeItem[];
  assert.equal(pruefung[0]!.expectedQuantity, 24000);
  assert.equal(pruefung[0]!.differenceQuantity, -12000);
  assert.deepEqual(pruefung[0]!.checkReasons, ['far_from_key_date']);
  // blind: false zeigt beim Zaehlen den heutigen Buchbestand, kein Soll.
  const offen = (await rufe(fall('list_stocktake_items_not_blind'))).ergebnis.items as StocktakeItem[];
  assert.equal(offen[0]!.bookStockNow, 3000);
  assert.equal('expectedQuantity' in offen[0]!, false);
  assert.equal(offen[0]!.quantity, null, 'ungezaehlt ist null, nie 0');
  assert.equal(offen[0]!.counted, false);
});

test('Inventur: Werte nur mit Kosten-Recht; ohne fehlen sie ganz, nicht null', async () => {
  const ohne = (await rufe(fall('get_stocktake_closed'))).ergebnis as Stocktake;
  assert.equal(ohne.status, 'closed');
  assert.equal('differenceValueCents' in ohne.totals!, false);
  assert.equal('valuesSha256' in ohne.pdf!, false);
  assert.equal(typeof ohne.pdf!.quantitiesSha256, 'string');
  assert.equal(ohne.progress!.counted, 1);
  const mit = (await rufe(fall('get_stocktake_closed_with_costs'))).ergebnis as Stocktake;
  assert.equal(mit.totals!.differenceValueCents, -122);
  assert.equal(mit.totals!.inventoryValueCents, 856);
  assert.equal(typeof mit.pdf!.valuesSha256, 'string');
  const pos = (await rufe(fall('list_stocktake_items_closed'))).ergebnis.items[0] as StocktakeItem;
  assert.deepEqual(pos.inventory, { quantity: 21000, countedOn: '2026-10-06' });
  const posMit = (await rufe(fall('list_stocktake_items_closed_with_costs'))).ergebnis.items[0] as StocktakeItem;
  assert.deepEqual(posMit.inventory, { quantity: 21000, countedOn: '2026-10-06', unitValueMicros: 407474, valueCents: 856 });
  assert.equal(posMit.bookedQuantity, -3000);
});

test('Inventur: progress.counted nur bei getStocktake, sonst null (nie 0)', async () => {
  const angelegt = (await rufe(fall('create_stocktake'))).ergebnis as Stocktake;
  assert.deepEqual(angelegt.progress, { items: 1, counted: null, recountOpen: false });
  assert.equal(angelegt.blind, true);
  assert.equal(angelegt.review, null);
  assert.equal('totals' in angelegt, false, 'vor dem Abschluss kein Ergebnis');
  const gelesen = (await rufe(fall('get_stocktake_counting'))).ergebnis as Stocktake;
  assert.equal(gelesen.progress!.counted, 1);
});

test('closeStocktake: Hinweise der Antwort (recount_uncounted), ohne Hinweis eine leere Liste', async () => {
  const kopf = fall('close_stocktake').response.data.stocktake;
  const mit = client(erfolg({ stocktake: kopf, warnings: [{ code: 'recount_uncounted', items: 2, message: '2 Position(en) zum Nachzählen wurden nicht gezählt und werden nicht gebucht.' }] }));
  const r = await mit.lager.closeStocktake({ idempotencyKey: 'abschluss-1', stocktakeId: 'auto78', uncountedAsZero: false });
  assert.deepEqual(r.warnings, [{ code: 'recount_uncounted', items: 2, message: '2 Position(en) zum Nachzählen wurden nicht gezählt und werden nicht gebucht.' }]);
  assert.ok(isInventoryWarningCode(r.warnings[0]!.code));
  assert.deepEqual(params(mit.anfragen[0]), { idempotencyKey: 'abschluss-1', stocktakeId: 'auto78', uncountedAsZero: false });
  const ohne = client(erfolg({ stocktake: kopf }));
  assert.deepEqual((await ohne.lager.closeStocktake({ idempotencyKey: 'abschluss-2', stocktakeId: 'auto78' })).warnings, []);
  // Ein Hinweis ohne Zahl ist kaputt, kein „0 Positionen“.
  const kaputt = client(erfolg({ stocktake: kopf, warnings: [{ code: 'recount_uncounted' }] }));
  await assert.rejects(() => kaputt.lager.closeStocktake({ idempotencyKey: 'abschluss-3', stocktakeId: 'auto78' }), KasseneckValidationError);
  for (const w of ['defect_capped', 'uncounted_items', 'not_booked', 'recount_uncounted']) {
    assert.ok((INVENTORY_WARNING_CODES as readonly string[]).includes(w), w);
  }
});

test('Inventurprotokoll: bis 9 MiB als Datei (Bytes unveraendert), darueber als Link, Fehler am Code', async () => {
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0xe2, 0x80, 0xff, 0x00, 0x25, 0x25, 0x45, 0x4f, 0x46]);
  const datei = client(antwort(pdf, 'application/pdf'));
  const r = await datei.lager.getStocktakePdf('auto78');
  assert.equal(r.kind, 'pdf');
  assert.deepEqual(r.kind === 'pdf' ? [...r.pdf] : [], [...pdf], 'Bytes ueber 0x7F bleiben (keine Textdeutung)');
  assert.deepEqual(params(datei.anfragen[0]), { stocktakeId: 'auto78' });
  const link = await client(huelle(fall('get_stocktake_pdf_download').response)).lager.getStocktakePdf('auto78');
  assert.equal(link.kind, 'download');
  if (link.kind === 'download') {
    assert.equal(link.download.sizeBytes, 44);
    assert.equal(link.download.fileName, 'stocktake-auto78-quantities.pdf');
    assert.match(link.download.sha256, /^[0-9a-f]{64}$/);
  }
  const vorher = client(huelle(fall('error_get_stocktake_pdf_not_closed').response));
  await assert.rejects(() => vorher.lager.getStocktakePdf('auto81'), (e) => isInventoryError(e, 'stocktake_not_closed'));
  // Erfolg ohne Datei und ohne Link ist kaputt; ein Link ohne Pruefsumme ebenso.
  await assert.rejects(() => client(erfolg({})).lager.getStocktakePdf('auto78'), (e) => e instanceof KasseneckValidationError && e.scope === 'response');
  const { sha256: _weg, ...ohnePruefsumme } = fall('get_stocktake_pdf_download').response.data.download;
  await assert.rejects(() => client(erfolg({ download: ohnePruefsumme })).lager.getStocktakePdf('auto78'), /sha256/);
  await assert.rejects(() => client(erfolg({ download: { ...ohnePruefsumme, sha256: 'ab', sizeBytes: 4.5 } })).lager.getStocktakePdf('auto78'), /sizeBytes/);
});

test('Inventur: vor dem Senden nur, was ohne Netz sicher falsch ist (nichts geht hinaus)', async () => {
  const { lager, anfragen } = client();
  const faelle: Array<[string, () => Promise<unknown>, RegExp]> = [
    ['ohne Schluessel', () => lager.recordStocktakeCount({ stocktakeId: 'auto78', articleId: 'kornspitz', quantity: 37000 } as never), /idempotencyKey/],
    ['Schluessel zu lang', () => lager.reviewStocktake({ idempotencyKey: 'k'.repeat(121), stocktakeId: 'auto78' }), /idempotencyKey/],
    ['ohne Inventur', () => lager.reviewStocktake({ idempotencyKey: 'k1', stocktakeId: ' ' }), /stocktakeId/],
    ['Menge als Bruch', () => lager.recordStocktakeCount({ idempotencyKey: 'k1', stocktakeId: 'auto78', articleId: 'kornspitz', quantity: 37.5 }), /quantity/],
    ['Menge fehlt', () => lager.recordStocktakeCount({ idempotencyKey: 'k1', stocktakeId: 'auto78', articleId: 'kornspitz' } as never), /quantity/],
    ['ohne Artikel', () => lager.recordStocktakeCount({ idempotencyKey: 'k1', stocktakeId: 'auto78', articleId: '', quantity: 1000 }), /articleId/],
    ['Seriennummern keine Liste', () => lager.recordStocktakeCount({ idempotencyKey: 'k1', stocktakeId: 'auto78', articleId: 'a', quantity: 1000, serialNumbers: 'KB-0001' as never }), /serialNumbers/],
    ['Storno ohne Zaehlung', () => lager.voidStocktakeCount({ idempotencyKey: 'k1', stocktakeId: 'auto78', countId: '', reason: 'doppelt' }), /countId/],
    ['Storno ohne Grund', () => lager.voidStocktakeCount({ idempotencyKey: 'k1', stocktakeId: 'auto78', countId: 'z1', reason: '  ' }), /reason/],
    ['Nachzaehlen leer', () => lager.recountStocktake({ idempotencyKey: 'k1', stocktakeId: 'auto78', items: [], reason: 'fehlt' }), /items/],
    ['Nachzaehlen ohne Artikel', () => lager.recountStocktake({ idempotencyKey: 'k1', stocktakeId: 'auto78', items: [{} as never], reason: 'fehlt' }), /items\[0\]\.articleId/],
    ['Nachzaehlen ohne Grund', () => lager.recountStocktake({ idempotencyKey: 'k1', stocktakeId: 'auto78', items: [{ articleId: 'a' }], reason: '' }), /reason/],
    ['Abschluss mit Text statt Wahrheitswert', () => lager.closeStocktake({ idempotencyKey: 'k1', stocktakeId: 'auto78', uncountedAsZero: 'ja' as never }), /uncountedAsZero/],
    ['Abbruch ohne Grund', () => lager.cancelStocktake({ idempotencyKey: 'k1', stocktakeId: 'auto78' } as never), /reason/],
    ['Anlage ohne Umfang', () => lager.createStocktake({ idempotencyKey: 'k1', locationId: 'haupt', type: 'perpetual' } as never), /scope/],
    ['Anlage ohne Standort', () => lager.createStocktake({ idempotencyKey: 'k1', scope: { type: 'all' }, type: 'perpetual' } as never), /locationId/],
    ['Liste ohne Inventur', () => lager.listStocktakeItems({} as never), /stocktakeId/],
    ['Liste mit limit 0', () => lager.listStocktakeCounts({ stocktakeId: 'auto78', limit: 0 }), /limit/],
    ['Protokoll ohne Kennung', () => lager.getStocktakePdf(''), /stocktakeId/],
  ];
  for (const [name, aufruf, muster] of faelle) {
    await assert.rejects(aufruf, (e) => e instanceof KasseneckValidationError && e.scope === 'request' && muster.test(e.message), name);
  }
  assert.equal(anfragen.length, 0);
});

test('Inventur: kaputte Antworten werden nie zu 0 oder „ungezaehlt“', async () => {
  const pos = fall('list_stocktake_items_counting').response.data.items[0];
  const zaehlung = fall('list_stocktake_counts').response.data.counts[0];
  const kopf = fall('get_stocktake_counting').response.data.stocktake;
  const kaputt: Array<[string, () => Promise<unknown>, string]> = [
    ['Menge als Bruch', () => client(erfolg({ items: [{ ...pos, quantity: 12000.5 }], nextCursor: null })).lager.listStocktakeItems({ stocktakeId: 'auto78' }), 'items[0].quantity'],
    ['gezaehlt ohne Menge', () => client(erfolg({ items: [{ ...pos, quantity: null }], nextCursor: null })).lager.listStocktakeItems({ stocktakeId: 'auto78' }), 'items[0].quantity'],
    ['counted fehlt', () => client(erfolg({ items: [{ ...pos, counted: undefined }], nextCursor: null })).lager.listStocktakeItems({ stocktakeId: 'auto78' }), 'items[0].counted'],
    ['Runde fehlt', () => client(erfolg({ items: [{ ...pos, round: undefined }], nextCursor: null })).lager.listStocktakeItems({ stocktakeId: 'auto78' }), 'items[0].round'],
    ['Soll als Text', () => client(erfolg({ items: [{ ...pos, expectedQuantity: '24000' }], nextCursor: null })).lager.listStocktakeItems({ stocktakeId: 'auto78' }), 'items[0].expectedQuantity'],
    ['Zaehlmenge fehlt', () => client(erfolg({ counts: [{ ...zaehlung, quantity: undefined }], nextCursor: null })).lager.listStocktakeCounts({ stocktakeId: 'auto78' }), 'counts[0].quantity'],
    ['Positionen fehlen', () => client(erfolg({ stocktake: { ...kopf, progress: { recountOpen: false } } })).lager.getStocktake('auto78'), 'stocktake.progress.items'],
    ['Liste fehlt', () => client(erfolg({ nextCursor: null })).lager.listStocktakeCounts({ stocktakeId: 'auto78' }), 'data.counts'],
    ['Kopf ohne Kennung', () => client(erfolg({ stocktake: { ...kopf, id: '' } })).lager.getStocktake('auto78'), 'stocktake.id'],
  ];
  for (const [name, aufruf, stelle] of kaputt) {
    await assert.rejects(aufruf, (e) => e instanceof KasseneckValidationError && e.scope === 'response' && e.message.includes(stelle), name);
  }
});

test('listStocktakes/iterateStocktakes: updatedSince als Date geht als ISO hinaus, Seiten folgen nextCursor, doppelter Cursor endet', async () => {
  const kopf = fall('list_stocktakes').response.data.stocktakes[0];
  const zweiter = { ...kopf, id: 'auto79', updatedAt: '2026-10-06T09:00:00.000Z' };
  const { lager, anfragen } = client(erfolg({ stocktakes: [kopf], nextCursor: 'c1' }), erfolg({ stocktakes: [zweiter], nextCursor: null }));
  const seit = new Date('2026-10-06T08:00:00.000Z');
  const gesehen: string[] = [];
  for await (const s of lager.iterateStocktakes({ updatedSince: seit, status: 'counting', limit: 1 })) gesehen.push(s.id);
  assert.deepEqual(gesehen, ['auto78', 'auto79']);
  assert.deepEqual(params(anfragen[0]), { updatedSince: '2026-10-06T08:00:00.000Z', status: 'counting', limit: 1 });
  assert.deepEqual(params(anfragen[1]), { updatedSince: '2026-10-06T08:00:00.000Z', status: 'counting', limit: 1, cursor: 'c1' });

  const schleife = client(erfolg({ items: [], nextCursor: 'c1' }), erfolg({ items: [], nextCursor: 'c1' }));
  await assert.rejects(async () => {
    for await (const _ of schleife.lager.iterateStocktakeItems({ stocktakeId: 'auto78' })) { /* leer */ }
  }, /nextCursor/);

  const zaehlungen = client(erfolg({ counts: fall('list_stocktake_counts').response.data.counts, nextCursor: null }));
  const alle = [];
  for await (const z of zaehlungen.lager.iterateStocktakeCounts({ stocktakeId: 'auto78', articleId: 'kipferl' })) alle.push(z);
  assert.equal(alle.length, 2);
  assert.equal(alle[0]!.voided?.reason, 'Kiste doppelt gezählt');
  assert.equal(alle[1]!.voided, null);
  assert.deepEqual(params(zaehlungen.anfragen[0]), { stocktakeId: 'auto78', articleId: 'kipferl' });
});

test('Kornspitz (Plan, Aufgabe 2): gezaehlt 37 bei Soll 37 ergibt Differenz 0, bei Soll 40 Differenz −3', async () => {
  // Bestand 40; Verkauf von 3 um 10:00:00, gebucht 10:00:03; Zaehlung 10:00:02 → 37.
  // Die Soll-Rechnung macht der Server; das Paket liest die Zahlen exakt (Tausendstel).
  const vorlage = fall('list_stocktake_items_review').response.data.items[0];
  const kornspitz = (soll: number) => ({
    ...vorlage, articleId: 'kornspitz', name: 'Kornspitz', quantity: 37000, expectedQuantity: soll, differenceQuantity: 37000 - soll,
    needsCheck: false, checkReasons: [], referenceTime: '2026-12-31T09:00:02.000Z',
  });
  const { lager } = client(erfolg({ items: [kornspitz(37000)], nextCursor: null }), erfolg({ items: [kornspitz(40000)], nextCursor: null }));
  const [vorher] = (await lager.listStocktakeItems({ stocktakeId: 'inv_kornspitz' })).items;
  assert.deepEqual([vorher!.quantity, vorher!.expectedQuantity, vorher!.differenceQuantity], [37000, 37000, 0]);
  // Derselbe Verkauf erst um 10:00:05: Soll 40, Differenz −3; der Abschluss bucht −3 auf den
  // heutigen Bestand 37 (nach dem Verkauf) → 34. Jedes Stueck wird genau einmal abgezogen.
  const [nachher] = (await lager.listStocktakeItems({ stocktakeId: 'inv_kornspitz' })).items;
  assert.deepEqual([nachher!.quantity, nachher!.expectedQuantity, nachher!.differenceQuantity], [37000, 40000, -3000]);
  assert.equal(40000 - 3000 + nachher!.differenceQuantity!, 34000);
});

test('getStocktakePdf als freie Funktion: mit createPdfOrDataTransport von der Paketwurzel, Datei und Link', async () => {
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0xc3, 0xa4, 0x25, 0x25, 0x45, 0x4f, 0x46]);
  const gesendet: Json[] = [];
  const antworten = [antwort(pdf, 'application/pdf'), huelle(fall('get_stocktake_pdf_download').response)];
  const fetch: FetchLike = async (url, init) => {
    gesendet.push({ url, params: JSON.parse(init.body).params });
    return antworten.shift()!;
  };
  const transport = createPdfOrDataTransport({ auth: inventoryKeyAuth({ apiKey: API_KEY }), fetch });
  const datei = await getStocktakePdf(transport, 'auto78');
  assert.deepEqual(datei.kind === 'pdf' ? [...datei.pdf] : null, [...pdf]);
  const link = await getStocktakePdf(transport, 'auto78');
  assert.equal(link.kind === 'download' ? link.download.fileName : null, 'stocktake-auto78-quantities.pdf');
  assert.deepEqual(gesendet.map((g) => g.url), ['https://api.kasseneck.at/v3/getStocktakePdf', 'https://api.kasseneck.at/v3/getStocktakePdf']);
  assert.deepEqual(gesendet[0]!.params, { stocktakeId: 'auto78' });
  // Der Transport selbst: PDF als Bytes, Erfolgshuelle als data.
  const roh = createPdfOrDataTransport({ auth: inventoryKeyAuth({ apiKey: API_KEY }), fetch: async () => erfolg({ ok: 1 }) });
  assert.deepEqual(await roh('getStocktakePdf', { stocktakeId: 'auto78' }), { data: { ok: 1 } });
});

test('Seriennummern der Position nur, wenn der Server sie sendet; die Zaehlung traegt sie immer', async () => {
  const gezaehlt = (await rufe(fall('record_stocktake_count'))).ergebnis.item as StocktakeItem;
  assert.equal('serialNumbers' in gezaehlt, false, 'Zaehl-Antwort ohne Seriennummern: Feld fehlt, nie []');
  const liste = (await rufe(fall('list_stocktake_items_counting'))).ergebnis.items[0] as StocktakeItem;
  assert.deepEqual(liste.serialNumbers, []);
  const zaehlung = fall('list_stocktake_counts').response.data.counts[0];
  const { serialNumbers: _weg, ...ohne } = zaehlung;
  await assert.rejects(() => client(erfolg({ counts: [ohne], nextCursor: null })).lager.listStocktakeCounts({ stocktakeId: 'auto78' }),
    (e) => e instanceof KasseneckValidationError && e.message.includes('counts[0].serialNumbers'));
});

test('Akteure: ein kaputter Eintrag ist ein Antwortfehler, kein stilles Weglassen', async () => {
  const pos = fall('list_stocktake_items_counting').response.data.items[0];
  const kopf = fall('get_stocktake_counting').response.data.stocktake;
  const zaehlung = fall('list_stocktake_counts').response.data.counts[0];
  const kaputt: Array<[string, () => Promise<unknown>, string]> = [
    ['Zaehler als Text', () => client(erfolg({ items: [{ ...pos, countedBy: ['kornblum'] }], nextCursor: null })).lager.listStocktakeItems({ stocktakeId: 'auto78' }), 'items[0].countedBy[0]'],
    ['Zaehler null in der Liste', () => client(erfolg({ items: [{ ...pos, countedBy: [null] }], nextCursor: null })).lager.listStocktakeItems({ stocktakeId: 'auto78' }), 'items[0].countedBy[0]'],
    ['Zaehlerliste fehlt', () => client(erfolg({ items: [{ ...pos, countedBy: undefined }], nextCursor: null })).lager.listStocktakeItems({ stocktakeId: 'auto78' }), 'items[0].countedBy'],
    ['angelegt von als Text', () => client(erfolg({ stocktake: { ...kopf, createdBy: 'api' } })).lager.getStocktake('auto78'), 'stocktake.createdBy'],
    ['Zaehler der Zaehlung als Zahl', () => client(erfolg({ counts: [{ ...zaehlung, countedBy: 7 }], nextCursor: null })).lager.listStocktakeCounts({ stocktakeId: 'auto78' }), 'counts[0].countedBy'],
  ];
  for (const [name, aufruf, stelle] of kaputt) {
    await assert.rejects(aufruf, (e) => e instanceof KasseneckValidationError && e.scope === 'response' && e.message.includes(stelle), name);
  }
  // Fehlt der Akteur ganz (null), bleibt er null.
  const ohne = await client(erfolg({ stocktake: { ...kopf, createdBy: null } })).lager.getStocktake('auto78');
  assert.equal(ohne.createdBy, null);
});
