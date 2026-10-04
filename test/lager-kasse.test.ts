import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  listMyStockLocations, listMyStock, setMyCashregisterStockLocation, STOCK_LOCATION_TYPES,
  fromPosArticlePayload, stockViewOf, type PosArticle,
} from '../src/pos/index.js';
import { fromCashregisterPayload } from '../src/models/index.js';
import { isKasseneckValidationError } from '../src/client/errors.js';

/*
 * Lager an der Kasse ohne Netz: was hinausgeht und wie die Antwort gelesen
 * wird. Die Vertragsfaelle des Backends prueft kasse-v3.test.ts.
 */

type Aufruf = [string, Record<string, unknown> | undefined];
function attrappe(daten: unknown): { rufen: never; aufrufe: Aufruf[] } {
  const aufrufe: Aufruf[] = [];
  const rufen = (async (name: string, params?: Record<string, unknown>) => {
    aufrufe.push([name, params]);
    return daten;
  }) as never;
  return { rufen, aufrufe };
}

test('STOCK_LOCATION_TYPES: die vier Typen des Backends, englisch', () => {
  assert.deepEqual([...STOCK_LOCATION_TYPES], ['warehouse', 'store', 'vehicle', 'other']);
});

test('listMyStockLocations: unbekannter Typ wird null, fehlende Adresse null, virtual nur wenn true', async () => {
  const { rufen, aufrufe } = attrappe({
    locations: [
      { id: 'store-1', name: 'Bäckerei Kornblum Filiale', type: 'store', address: { street: 'Mühlgasse 3', zip: '4020', city: 'Linz', country: 'AT' }, licensePlate: null, active: true },
      { id: 'van-1', name: 'Lieferwagen', type: 'boat', address: null, licensePlate: 'L-1234X', active: false, virtual: 'ja' },
    ],
  });
  const orte = await listMyStockLocations(rufen);
  assert.deepEqual(aufrufe, [['listMyStockLocations', undefined]]);
  assert.deepEqual(orte, [
    { id: 'store-1', name: 'Bäckerei Kornblum Filiale', type: 'store', address: { street: 'Mühlgasse 3', zip: '4020', city: 'Linz', country: 'AT' }, licensePlate: null, active: true, virtual: false },
    { id: 'van-1', name: 'Lieferwagen', type: null, address: null, licensePlate: 'L-1234X', active: false, virtual: false },
  ]);
});

test('listMyStock: negativer und gebrochener Bestand bleibt exakt (Tausendstel), ohne Recht stockCosts values null', async () => {
  const zeile = { articleId: 'rye-bread', locationId: 'store-1', sellable: -2500, defective: 0, reserved: 0, available: -2500 };
  const halb = { articleId: 'flour', locationId: 'store-1', sellable: 250, defective: 0, reserved: 0, available: 250 };
  const { rufen } = attrappe({ stock: [zeile, halb] });
  const liste = await listMyStock(rufen);
  assert.deepEqual(liste.stock, [zeile, halb]);
  assert.equal(liste.values, null, 'ohne Recht stockCosts: null, nie []');
});

test('listMyStock: mit Recht leere Werte bleiben [], averageCostMicros bei Menge 0 null', async () => {
  assert.deepEqual((await listMyStock(attrappe({ stock: [], values: [] }).rufen)).values, []);
  const { values } = await listMyStock(attrappe({
    stock: [],
    values: [{ articleId: 'rye-bread', stockValueCents: 4800, averageCostMicros: 3000000 }, { articleId: 'flour', stockValueCents: 0, averageCostMicros: null }],
  }).rufen);
  assert.deepEqual(values, [
    { articleId: 'rye-bread', stockValueCents: 4800, averageCostMicros: 3000000 },
    { articleId: 'flour', stockValueCents: 0, averageCostMicros: null },
  ]);
});

test('listMyStock: leere Filter gehen nicht hinaus, belowMinimum nur wenn true, falscher Typ nicht vor das Netz', async () => {
  const a = attrappe({ stock: [] });
  await listMyStock(a.rufen, { locationId: '', articleId: undefined, belowMinimum: false });
  await listMyStock(a.rufen, { locationId: 'van-1', articleId: 'rye-bread', belowMinimum: true });
  assert.deepEqual(a.aufrufe, [
    ['listMyStock', {}],
    ['listMyStock', { locationId: 'van-1', articleId: 'rye-bread', belowMinimum: true }],
  ]);
  const b = attrappe({ stock: [] });
  await assert.rejects(() => listMyStock(b.rufen, { locationId: 5 as never }), (e) => isKasseneckValidationError(e) && /locationId/.test(e.message));
  await assert.rejects(() => listMyStock(b.rufen, { belowMinimum: 'ja' as never }), /belowMinimum/);
  assert.equal(b.aufrufe.length, 0);
});

test('listMyStock: fehlende Liste ist ein Antwortfehler, keine leere Liste', async () => {
  await assert.rejects(() => listMyStock(attrappe({}).rufen), /data\.stock/);
});

test('setMyCashregisterStockLocation: null setzt zurueck (leerer Text), Antwort null bleibt null', async () => {
  const { rufen, aufrufe } = attrappe({ cashregisterId: 'K1', stockLocationId: null });
  const stand = await setMyCashregisterStockLocation(rufen, { cashregisterId: 'K1', stockLocationId: null });
  assert.deepEqual(aufrufe, [['setMyCashregisterStockLocation', { cashregisterId: 'K1', stockLocationId: '' }]]);
  assert.deepEqual(stand, { cashregisterId: 'K1', stockLocationId: null });
});

test('setMyCashregisterStockLocation: ohne cashregisterId geht keiner hinaus (die Anmeldung bindet die Kasse)', async () => {
  const { rufen, aufrufe } = attrappe({ cashregisterId: 'K1', stockLocationId: 'van-1' });
  await setMyCashregisterStockLocation(rufen, { stockLocationId: 'van-1' });
  assert.deepEqual(aufrufe, [['setMyCashregisterStockLocation', { stockLocationId: 'van-1' }]]);
});

test('setMyCashregisterStockLocation: undefined, Zahl oder leere Kasse gehen nicht hinaus; Antwort ohne Kasse ist ein Fehler', async () => {
  const { rufen, aufrufe } = attrappe({ cashregisterId: 'K1', stockLocationId: 'van-1' });
  await assert.rejects(() => setMyCashregisterStockLocation(rufen, {} as never), /stockLocationId/);
  await assert.rejects(() => setMyCashregisterStockLocation(rufen, { stockLocationId: 7 as never }), /stockLocationId/);
  await assert.rejects(() => setMyCashregisterStockLocation(rufen, { stockLocationId: 'van-1', cashregisterId: ' ' }), /cashregisterId/);
  assert.equal(aufrufe.length, 0);
  await assert.rejects(() => setMyCashregisterStockLocation(attrappe({ stockLocationId: 'van-1' }).rufen, { stockLocationId: 'van-1' }), /cashregisterId/);
});

test('listMyStock: fehlende, gebrochene oder falsch getypte Menge ist ein Antwortfehler, nie still 0', async () => {
  const gut = { articleId: 'rye-bread', locationId: 'store-1', sellable: 1000, defective: 0, reserved: 0, available: 1000 };
  for (const [feld, wert] of [['sellable', undefined], ['defective', 1.5], ['reserved', '3'], ['available', null], ['sellable', Number.NaN]] as const) {
    const zeile = { ...gut, [feld]: wert };
    await assert.rejects(
      () => listMyStock(attrappe({ stock: [gut, zeile] }).rufen),
      (e) => isKasseneckValidationError(e) && e.scope === 'response' && e.reason.includes(`stock[1].${feld}`),
      `${feld}=${String(wert)}`,
    );
  }
  // Ein Eintrag, der kein Objekt ist, ist keine Zeile mit Nullen.
  await assert.rejects(() => listMyStock(attrappe({ stock: [null] }).rufen), /stock\[0\]/);
});

test('listMyStock: Kennungen fehlen nicht still, Werte mit unbrauchbarer Zahl sind ein Antwortfehler', async () => {
  const gut = { articleId: 'rye-bread', locationId: 'store-1', sellable: 0, defective: 0, reserved: 0, available: 0 };
  await assert.rejects(() => listMyStock(attrappe({ stock: [{ ...gut, articleId: '' }] }).rufen), /stock\[0\]\.articleId/);
  await assert.rejects(() => listMyStock(attrappe({ stock: [{ ...gut, locationId: undefined }] }).rufen), /stock\[0\]\.locationId/);
  const wert = { articleId: 'rye-bread', stockValueCents: 4800, averageCostMicros: 3000000 };
  for (const [feld, v] of [['stockValueCents', undefined], ['stockValueCents', 12.5], ['averageCostMicros', 0.5], ['averageCostMicros', '3']] as const) {
    await assert.rejects(
      () => listMyStock(attrappe({ stock: [], values: [wert, { ...wert, [feld]: v }] }).rufen),
      (e) => isKasseneckValidationError(e) && e.reason.includes(`values[1].${feld}`),
      `${feld}=${String(v)}`,
    );
  }
  // Fehlt averageCostMicros ganz, ist es wie null (Menge 0), nicht 0.
  const { values } = await listMyStock(attrappe({ stock: [], values: [{ articleId: 'flour', stockValueCents: 0 }] }).rufen);
  assert.deepEqual(values, [{ articleId: 'flour', stockValueCents: 0, averageCostMicros: null }]);
});

test('listMyStock: values, das keine Liste ist, wird nicht zu null (kein Recht) umgedeutet', async () => {
  await assert.rejects(() => listMyStock(attrappe({ stock: [], values: {} }).rufen), /data\.values/);
  await assert.rejects(() => listMyStock(attrappe({ stock: [], values: 'x' }).rufen), /data\.values/);
});

test('listMyStockLocations: Standort ohne Kennung ist ein Antwortfehler (leere Kennung wuerde die Kasse zuruecksetzen)', async () => {
  await assert.rejects(() => listMyStockLocations(attrappe({ locations: [{ name: 'X', type: 'store', active: true }] }).rufen), /locations\[0\]\.id/);
  await assert.rejects(() => listMyStockLocations(attrappe({}).rufen), /data\.locations/);
});

test('setMyCashregisterStockLocation: Antwort mit anderem Typ als Text oder null ist ein Antwortfehler', async () => {
  await assert.rejects(
    () => setMyCashregisterStockLocation(attrappe({ cashregisterId: 'K1', stockLocationId: 7 }).rufen, { stockLocationId: 'van-1' }),
    /stockLocationId/,
  );
});


test('listMyStockLocations: Adresse ohne jeden Teil ist keine Adresse (null)', async () => {
  const { rufen } = attrappe({
    locations: [
      { id: 'a', name: 'A', type: 'store', address: { street: '', zip: null, city: undefined, country: '' }, active: true },
      { id: 'b', name: 'B', type: 'store', address: {}, active: true },
      { id: 'c', name: 'C', type: 'store', address: { city: 'Linz' }, active: true },
    ],
  });
  const orte = await listMyStockLocations(rufen);
  assert.deepEqual(orte.map((o) => o.address), [null, null, { street: null, zip: null, city: 'Linz', country: null }]);
});

test('listMyStock: null als options ist ein Anfragefehler, kein TypeError', async () => {
  const a = attrappe({ stock: [] });
  await assert.rejects(
    () => listMyStock(a.rufen, null as never),
    (e) => isKasseneckValidationError(e) && e.scope === 'request' && /options/.test(e.reason),
  );
  assert.equal(a.aufrufe.length, 0);
});

test('Artikel: stockLocationIds nur Texte, fehlt -> null, leere Liste bleibt leer', () => {
  assert.deepEqual(fromPosArticlePayload({ id: 'rye-bread', stockLocationIds: ['store-1', 7, '', 'van-1'] as never }).stockLocationIds, ['store-1', 'van-1']);
  assert.deepEqual(fromPosArticlePayload({ id: 'rye-bread', stockLocationIds: [] }).stockLocationIds, []);
  assert.equal(fromPosArticlePayload({ id: 'rye-bread' }).stockLocationIds, null);
});

test('Kasse: stockLocationId nur wenn gesetzt', () => {
  assert.equal(fromCashregisterPayload({ id: 'K1', stockLocationId: 'van-1' }, 'K1').stockLocationId, 'van-1');
  assert.equal('stockLocationId' in fromCashregisterPayload({ id: 'K1', stockLocationId: null }, 'K1'), false);
  assert.equal('stockLocationId' in fromCashregisterPayload({ id: 'K1' }, 'K1'), false);
});

test('stockViewOf: fehlt das Recht, gilt es als erteilt – ein ausdrueckliches false sperrt', () => {
  const basis = { sell: false, cancel: false, articles: false, layout: false, reports: false, takeover: false };
  assert.equal(stockViewOf(basis), true);
  assert.equal(stockViewOf({ ...basis, stockView: true }), true);
  assert.equal(stockViewOf({ ...basis, stockView: false }), false);
  assert.equal(stockViewOf(null), false);
  assert.equal(stockViewOf(undefined), false);
});

test('PosArticle: ein Literal ohne stockLocationIds ist gueltig (Feld optional), der Leser setzt es immer', () => {
  // Bestehende Verbraucher bauen PosArticle-Literale ohne das neue Feld; das
  // muss uebersetzbar bleiben (tsc ueber die Tests ist der Beweis).
  const literal: PosArticle = {
    id: 'a1', name: 'Semmel', unitPriceCents: 79, vatRate: 10, unit: 'Stk', groupId: null, revenueGroupId: null,
    visible: true, sort: 0, active: true, quantityRule: null, askQuantity: null, maxQuantity: null,
  };
  assert.equal(literal.stockLocationIds, undefined);
  assert.equal(fromPosArticlePayload({ id: 'a1' }).stockLocationIds, null);
  assert.deepEqual(fromPosArticlePayload({ id: 'a1', stockLocationIds: ['store-1'] }).stockLocationIds, ['store-1']);
});

test('listMyStock: values ohne Liste meldet "keine Liste", nicht "fehlt"', async () => {
  for (const kaputt of ['x', 5, {}, true]) {
    await assert.rejects(
      () => listMyStock(attrappe({ stock: [], values: kaputt }).rufen),
      (e) => isKasseneckValidationError(e) && e.scope === 'response' && /data\.values ist keine Liste/.test(e.reason) && !/fehlt/.test(e.reason),
      String(kaputt),
    );
  }
  // fehlt `values` ganz oder ist null, ist das kein Fehler (kein Recht stockCosts)
  assert.equal((await listMyStock(attrappe({ stock: [] }).rufen)).values, null);
  assert.equal((await listMyStock(attrappe({ stock: [], values: null }).rufen)).values, null);
  // und die Pflichtliste `stock` fehlt weiterhin als "fehlt"
  await assert.rejects(() => listMyStock(attrappe({}).rufen), /data\.stock fehlt/);
});

test('setMyCashregisterStockLocation: Standort nur aus Leerraum geht nicht hinaus, leerer Text setzt zurueck', async () => {
  const { rufen, aufrufe } = attrappe({ cashregisterId: 'K1', stockLocationId: null });
  for (const leer of ['  ', '\t', ' \n ']) {
    await assert.rejects(
      () => setMyCashregisterStockLocation(rufen, { stockLocationId: leer, cashregisterId: 'K1' }),
      (e) => isKasseneckValidationError(e) && e.scope === 'request' && /stockLocationId/.test(e.reason),
      JSON.stringify(leer),
    );
  }
  assert.equal(aufrufe.length, 0);
  await setMyCashregisterStockLocation(rufen, { stockLocationId: '', cashregisterId: 'K1' });
  assert.deepEqual(aufrufe, [['setMyCashregisterStockLocation', { cashregisterId: 'K1', stockLocationId: '' }]]);
});
