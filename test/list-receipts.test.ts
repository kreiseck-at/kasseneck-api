import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  listAllReceipts,
  listReceipts,
  LIST_ALL_RECEIPTS_MAX_PAGES,
  LIST_RECEIPTS_ERROR_CODES,
  LIST_RECEIPTS_ORDERS,
  LIST_RECEIPTS_VIEWS,
  listedReceiptWithCompany,
  type ListReceiptsOptions,
  type ListReceiptsSummary,
} from '../src/client/list-receipts.js';
import { createKasseneckApi } from '../src/client/api.js';
import { CALLS_WITHOUT_EFFECT, PUBLIC_CALLS, isPosOnlyCall, isUnknownOutcomeCall } from '../src/client/aufrufe.js';
import { apiKeyAuth } from '../src/client/auth.js';
import { isKasseneckApiError, isKasseneckValidationError } from '../src/client/errors.js';
import { createTransport, DEFAULT_BASE_URL, type FetchLike, type HttpRequestInit, type HttpResponseLike } from '../src/client/transport.js';
import { CANCELLATION_REASONS, CANCELLATION_STATUSES, type Receipt } from '../src/models/index.js';
import { KeckPaymentMethod, ReceiptType } from '../src/enums/index.js';
import * as wurzel from '../src/index.js';

/*
 * listReceipts / listAllReceipts (Spec 2026-10-28-list-receipts-design.md,
 * Stufe 1) mit einer Attrappe des Servers: Antwort je Aufruf, Mitschrift der
 * gesendeten Parameter. Die Zeilen der Kurzansicht sind erfunden; die vollen
 * Belege stammen aus dem Vertrags-Export (`getReportV2`, Fall `report`), dessen
 * Form `view: 'full'` laut Backend teilt.
 */

type Json = Record<string, any>;
const lies = (datei: string): Json => JSON.parse(readFileSync(new URL(`../../fixtures/v3/${datei}`, import.meta.url), 'utf8')) as Json;
const VOKABULAR = lies('v3-vokabular.json');
const BERICHT = (lies('antworten/belege.json').cases as Json[]).find((f) => f.name === 'report')!;
const VOLLE_BELEGE = BERICHT.response.data.receipts as Json[];

const KOPF: Record<string, string> = { 'content-type': 'application/json', 'kasseneck-api-version': 'v3' };

function antwort(rumpf: Json): HttpResponseLike {
  const text = JSON.stringify(rumpf);
  return {
    status: 200,
    headers: { get: (name: string) => KOPF[name.toLowerCase()] ?? null },
    text: async () => text,
    arrayBuffer: async () => new TextEncoder().encode(text).buffer,
  };
}

const erfolg = (data: Json): Json => ({ status: 'success', message: '', data });
const fehler = (code: string, message: string): Json => ({ status: 'error', message, code });

/** Attrappe: die n-te Antwort fuer den n-ten Aufruf; mehr Aufrufe als Antworten sind ein Testfehler. */
function server(antworten: Json[] | ((n: number) => Json)) {
  const aufrufe: Array<{ url: string; params: Json }> = [];
  const holen: FetchLike = async (url: string, init: HttpRequestInit) => {
    aufrufe.push({ url, params: (JSON.parse(init.body) as { params: Json }).params });
    const n = aufrufe.length - 1;
    const rumpf = typeof antworten === 'function' ? antworten(n) : antworten[n];
    if (!rumpf) throw new Error(`unerwarteter Aufruf Nr. ${n + 1}`);
    return antwort(rumpf);
  };
  const rufen = createTransport({ auth: apiKeyAuth({ apiKey: 'kr_test_Beispielschluessel0123456789', cashregisterToken: 'cb_test_EXAMPLE00000000' }), fetch: holen });
  return { rufen, aufrufe, holen };
}

/** Erfundene Zeile der Kurzansicht (Kasse KECK-1, Bediener Mirela Weinzierl). */
function zeile(n: number, extra: Json = {}): Json {
  return {
    receiptId: `KECK-1-ID-${n}`,
    counter: n,
    receiptType: 'standard',
    zeroKind: null,
    timeStamp: `2026-10-27T${String(8 + (n % 10)).padStart(2, '0')}:15:00`,
    totalCents: 1999,
    grossByRateCents: { standard: 0, reduced1: 1999, reduced2: 0, zero: 0, special: 0 },
    paymentMethod: 'cash',
    operator: { name: 'Mirela Weinzierl' },
    cancellationOf: null,
    cancellationReason: null,
    cancellationStatus: 'none',
    signatureOk: true,
    customProjectId: null,
    fullReceiptId: null,
    ...extra,
  };
}

const TAG = { date: '2026-10-27', receiptCount: 143, revenueCents: 512340, revenueByRate: [{ rateBp: 2000, grossCents: 401200 }, { rateBp: 1000, grossCents: 111140 }] };

async function fehlerVon(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  assert.fail('Fehler erwartet');
}

async function sammle<T>(iter: AsyncIterable<T>): Promise<{ belege: T[]; fehler?: unknown }> {
  const belege: T[] = [];
  try {
    for await (const b of iter) belege.push(b);
  } catch (e) {
    return { belege, fehler: e };
  }
  return { belege };
}

// --- eine Seite ------------------------------------------------------------------

test('listReceipts: eine Seite (summary) mit date, gelesen in Cent, Tagessumme der ersten Seite', async () => {
  const storno = zeile(102, {
    receiptType: 'cancellation',
    totalCents: -1999,
    grossByRateCents: { standard: 0, reduced1: -1999, reduced2: 0, zero: 0, special: 0 },
    cancellationOf: { receiptId: 'KECK-1-ID-101', timeStamp: '2026-10-27T09:15:00' },
    cancellationReason: 'input_error',
  });
  const gemischt = zeile(103, {
    totalCents: 4250,
    grossByRateCents: { standard: 2000, reduced1: 2250, reduced2: 0, zero: 0, special: 0 },
    paymentMethod: 'mixed',
    payments: [{ id: 'p1', method: 'creditCard', amountCents: 3000, provider: 'sumup' }, { id: 'p2', method: 'cash', amountCents: 1250, tenderedCents: 2000, changeCents: 750 }],
    tipCents: 150,
    cancellationStatus: 'partial',
    customProjectId: 'kornblum-4711',
    fullReceiptId: '000000000000.0000000000000001',
  });
  const nullbeleg = zeile(104, { receiptType: 'zero', zeroKind: 'monthly', totalCents: 0, grossByRateCents: { standard: 0, reduced1: 0, reduced2: 0, zero: 0, special: 0 }, paymentMethod: null, operator: null, signatureOk: false });
  const { rufen, aufrufe } = server([erfolg({ receipts: [gemischt, storno, nullbeleg], hasMore: false, nextCursor: null, daySummary: TAG })]);

  const seite = await listReceipts(rufen, { date: '2026-10-27' });

  assert.equal(aufrufe.length, 1);
  assert.equal(aufrufe[0]!.url, `${DEFAULT_BASE_URL}/listReceipts`);
  assert.deepEqual(aufrufe[0]!.params, { date: '2026-10-27' }, 'nur gesetzte Felder gehen hinaus');
  assert.equal(seite.hasMore, false);
  assert.equal(seite.nextCursor, null);
  assert.deepEqual(seite.daySummary, TAG);

  const [a, b, c] = seite.receipts as [ListReceiptsSummary, ListReceiptsSummary, ListReceiptsSummary];
  assert.equal(a.receiptType, ReceiptType.standard);
  assert.equal(a.paymentMethod, KeckPaymentMethod.mixed);
  assert.equal(a.totalCents, 4250);
  assert.deepEqual(a.grossByRateCents, { standard: 2000, reduced1: 2250, reduced2: 0, zero: 0, special: 0 });
  assert.equal(a.payments!.length, 2);
  assert.equal(a.payments![0]!.method, KeckPaymentMethod.creditCard);
  assert.equal(a.payments![1]!.changeCents, 750);
  assert.equal(a.tipCents, 150);
  assert.equal(a.cancellationStatus, 'partial');
  assert.equal(a.customProjectId, 'kornblum-4711');
  assert.equal(a.fullReceiptId, '000000000000.0000000000000001');
  assert.deepEqual(a.operator, { name: 'Mirela Weinzierl' });

  assert.equal(b.receiptType, ReceiptType.cancellation);
  assert.equal(b.totalCents, -1999);
  assert.deepEqual(b.cancellationOf, { receiptId: 'KECK-1-ID-101', timeStamp: '2026-10-27T09:15:00' });
  assert.equal(b.cancellationReason, 'input_error');
  assert.equal('payments' in b, false, 'Altbeleg ohne Zahlungsliste: das Feld fehlt');
  assert.equal('tipCents' in b, false);

  assert.equal(c.receiptType, ReceiptType.zero);
  assert.equal(c.zeroKind, 'monthly');
  assert.equal(c.paymentMethod, null);
  assert.equal(c.operator, null);
  assert.equal(c.signatureOk, false);
});

test('listReceipts: unbekannter Storno-Stand heisst unknown, nie still none', async () => {
  const { rufen } = server([erfolg({ receipts: [zeile(1, { cancellationStatus: 'reversed' }), zeile(2, { cancellationStatus: undefined })], hasMore: false, nextCursor: null })]);
  const seite = await listReceipts(rufen, { from: '2026-10-27', to: '2026-10-28' });
  assert.deepEqual(seite.receipts.map((z) => z.cancellationStatus), ['unknown', 'unknown']);
  // Ein Wert, den das Paket nicht kennt, bleibt roh lesbar und laesst die Liste nicht scheitern.
  const { rufen: weg2 } = server([erfolg({ receipts: [zeile(3, { paymentMethod: 'barter', receiptType: 'deposit' })], hasMore: false, nextCursor: null })]);
  const [fremd] = (await listReceipts(weg2, { date: '2026-10-27' })).receipts;
  assert.equal(fremd!.paymentMethod, 'barter');
  assert.equal(fremd!.receiptType, 'deposit');
  assert.equal('daySummary' in seite, false, 'ohne date keine Tagessumme');
});

test('listReceipts: view full liefert das Belegdokument wie getReportV2', async () => {
  const { rufen, aufrufe } = server([erfolg({ receipts: VOLLE_BELEGE, hasMore: false, nextCursor: null })]);
  const seite = await listReceipts(rufen, { from: '2026-09-01', to: '2026-10-01T00:00:00', view: 'full', order: 'asc', limit: 500 });
  assert.deepEqual(aufrufe[0]!.params, { from: '2026-09-01', to: '2026-10-01T00:00:00', view: 'full', order: 'asc', limit: 500 });
  const belege: Receipt[] = seite.receipts;
  assert.equal(belege.length, VOLLE_BELEGE.length);
  belege.forEach((b, i) => {
    const roh = VOLLE_BELEGE[i]!;
    assert.equal(b.receiptId, roh.receiptId);
    assert.equal(b.items.length, roh.items.length);
    assert.equal(b.headerVersionId, roh.headerVersionId);
  });
});

test('listReceipts: view full traegt metadata wie getReportV2 (Firmendaten + Bezeichnung)', async () => {
  const kopf = {
    label: 'Schank', company: 'Bäckerei Kornblum', street: 'Hauptstraße 1', zip: '1010', city: 'Wien', phone: null,
    taxNumber: '91-123/4565', vatId: 'ATU12345675', is_small_business: false,
    footer1: 'Danke', footer2: null, footer3: null, footer4: null, logo_url: null, thanks_message: null, kreiseck_logo: true,
  };
  const { rufen } = server([erfolg({ receipts: VOLLE_BELEGE, hasMore: false, nextCursor: null, metadata: kopf })]);
  const seite = await listReceipts(rufen, { date: '2026-09-26', view: 'full' });
  assert.ok(seite.metadata);
  assert.equal(seite.metadata.label, 'Schank');
  assert.equal(seite.metadata.companyName, 'Bäckerei Kornblum');
  assert.equal(seite.metadata.showKreiseckLogo, true);
  assert.equal(seite.metadata.taxNumber, '91-123/4565');
  assert.equal(seite.metadata.vatId, 'ATU12345675');
});

test('listReceipts: summary ohne metadata; metadata kein Objekt ist ein Antwortfehler', async () => {
  const kurz = await listReceipts(server([erfolg({ receipts: [zeile(1)], hasMore: false, nextCursor: null })]).rufen, { date: '2026-09-26' });
  assert.equal('metadata' in kurz, false);
  const e = await fehlerVon(listReceipts(server([erfolg({ receipts: VOLLE_BELEGE, hasMore: false, nextCursor: null, metadata: 'x' })]).rufen, { date: '2026-09-26', view: 'full' }));
  assert.ok(isKasseneckValidationError(e));
});

test('listReceipts: daySummary null bleibt null (Tag ohne Statistik)', async () => {
  const { rufen } = server([erfolg({ receipts: [], hasMore: false, nextCursor: null, daySummary: null })]);
  const seite = await listReceipts(rufen, { date: '2026-10-25' });
  assert.deepEqual(seite.receipts, []);
  assert.equal(seite.daySummary, null);
  assert.ok('daySummary' in seite);
});

// --- Blaettern --------------------------------------------------------------------

test('listReceipts von Hand: daySummary nur auf Seite 1, Seite 2 mit Cursor und gleichem Fenster', async () => {
  const { rufen, aufrufe } = server([
    erfolg({ receipts: [zeile(3), zeile(2)], hasMore: true, nextCursor: 'c-1', daySummary: TAG }),
    erfolg({ receipts: [zeile(1)], hasMore: false, nextCursor: null }),
  ]);
  const eins = await listReceipts(rufen, { date: '2026-10-27', limit: 2 });
  assert.deepEqual(eins.daySummary, TAG);
  assert.equal(eins.nextCursor, 'c-1');
  // limit darf sich zwischen den Seiten aendern.
  const zwei = await listReceipts(rufen, { date: '2026-10-27', limit: 50, cursor: eins.nextCursor! });
  assert.equal('daySummary' in zwei, false);
  assert.deepEqual(aufrufe.map((a) => a.params), [{ date: '2026-10-27', limit: 2 }, { date: '2026-10-27', limit: 50, cursor: 'c-1' }]);
});

test('listAllReceipts: drei Seiten, Cursor weitergereicht, Fenster/order/view gleich, jeder Beleg einmal', async () => {
  const seiten = [
    erfolg({ receipts: [zeile(1), zeile(2), zeile(3)], hasMore: true, nextCursor: 'c-1' }),
    erfolg({ receipts: [zeile(4), zeile(5), zeile(6)], hasMore: true, nextCursor: 'c-2' }),
    erfolg({ receipts: [zeile(7), zeile(8)], hasMore: false, nextCursor: null }),
  ];
  const { rufen, aufrufe } = server(seiten);
  const optionen: ListReceiptsOptions<'summary'> = { from: '2026-10-01', to: '2026-11-01', order: 'asc', view: 'summary' };
  const { belege, fehler: f } = await sammle(listAllReceipts(rufen, optionen));
  assert.equal(f, undefined);
  assert.deepEqual(belege.map((b) => b.receiptId), [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `KECK-1-ID-${n}`));
  const fenster = { from: '2026-10-01', to: '2026-11-01', order: 'asc', view: 'summary', limit: 500 };
  assert.deepEqual(aufrufe.map((a) => a.params), [fenster, { ...fenster, cursor: 'c-1' }, { ...fenster, cursor: 'c-2' }]);
  assert.ok(aufrufe.every((a) => a.url === `${DEFAULT_BASE_URL}/listReceipts`));
  assert.deepEqual(optionen, { from: '2026-10-01', to: '2026-11-01', order: 'asc', view: 'summary' }, 'die Eingabe bleibt unveraendert');
});

test('listAllReceipts: eigenes limit und Start-Cursor gehen so hinaus, view full liefert Belege', async () => {
  const { rufen, aufrufe } = server([
    erfolg({ receipts: VOLLE_BELEGE.slice(0, 4), hasMore: true, nextCursor: 'c-9' }),
    erfolg({ receipts: VOLLE_BELEGE.slice(4), hasMore: false, nextCursor: null }),
  ]);
  const { belege } = await sammle(listAllReceipts(rufen, { date: '2026-09-26', view: 'full', limit: 4, cursor: 'c-8' }));
  assert.deepEqual(belege.map((b) => b.receiptId), VOLLE_BELEGE.map((b) => b.receiptId));
  assert.deepEqual(aufrufe.map((a) => a.params), [
    { date: '2026-09-26', view: 'full', limit: 4, cursor: 'c-8' },
    { date: '2026-09-26', view: 'full', limit: 4, cursor: 'c-9' },
  ]);
});

test('listAllReceipts: Fehler auf Seite 2 bricht ab, Seite 1 ist schon geliefert, keine Seite 3', async () => {
  const { rufen, aufrufe } = server([
    erfolg({ receipts: [zeile(1), zeile(2)], hasMore: true, nextCursor: 'c-1' }),
    fehler('invalid_cursor', 'cursor ist ungültig oder gehört zu einer anderen Abfrage.'),
    erfolg({ receipts: [zeile(3)], hasMore: false, nextCursor: null }),
  ]);
  const { belege, fehler: f } = await sammle(listAllReceipts(rufen, { date: '2026-10-27' }));
  assert.deepEqual(belege.map((b) => b.receiptId), ['KECK-1-ID-1', 'KECK-1-ID-2']);
  assert.ok(isKasseneckApiError(f));
  assert.equal(f.code, 'invalid_cursor');
  assert.equal(f.outcome, 'rejected', 'reines Lesen: nie Ausgang unklar');
  assert.equal(aufrufe.length, 2);
});

test(`listAllReceipts: nach ${LIST_ALL_RECEIPTS_MAX_PAGES} Seiten Abbruch mit Fehler`, async () => {
  const { rufen, aufrufe } = server((n) => erfolg({ receipts: [zeile(n)], hasMore: true, nextCursor: `c-${n + 1}` }));
  const { belege, fehler: f } = await sammle(listAllReceipts(rufen, { from: '2026-10-01', to: '2026-10-31' }));
  assert.equal(aufrufe.length, LIST_ALL_RECEIPTS_MAX_PAGES);
  assert.equal(belege.length, LIST_ALL_RECEIPTS_MAX_PAGES);
  assert.ok(isKasseneckValidationError(f));
  assert.equal(f.scope, 'response');
  assert.match(f.message, /100 Seiten/);
});

test('listAllReceipts: derselbe Cursor zweimal bricht sofort ab statt im Kreis zu laufen', async () => {
  const { rufen, aufrufe } = server([
    erfolg({ receipts: [zeile(1)], hasMore: true, nextCursor: 'c-1' }),
    erfolg({ receipts: [zeile(2)], hasMore: true, nextCursor: 'c-1' }),
  ]);
  const { belege, fehler: f } = await sammle(listAllReceipts(rufen, { date: '2026-10-27' }));
  assert.equal(belege.length, 2);
  assert.ok(isKasseneckValidationError(f));
  assert.equal(aufrufe.length, 2);
});

// --- Eingabe vor dem Senden ---------------------------------------------------------

const UNGUELTIG: Array<[string, unknown]> = [
  ['kein Fenster', {}],
  ['date und from/to', { date: '2026-10-27', from: '2026-10-27', to: '2026-10-28' }],
  ['date und to', { date: '2026-10-27', to: '2026-10-28' }],
  ['nur from', { from: '2026-10-27' }],
  ['nur to', { to: '2026-10-28' }],
  ['date unmoeglich', { date: '2026-02-30' }],
  ['date deutsch geschrieben', { date: '27.10.2026' }],
  ['date mit Uhrzeit', { date: '2026-10-27T00:00:00' }],
  ['date als Zahl', { date: 20261027 }],
  ['from mit Zone', { from: '2026-10-27T00:00:00Z', to: '2026-10-28' }],
  ['from mit Bruchteil', { from: '2026-10-27T00:00:00.000', to: '2026-10-28' }],
  ['from 24 Uhr', { from: '2026-10-27T24:00:00', to: '2026-10-28' }],
  ['to 29. Februar ohne Schaltjahr', { from: '2026-02-01', to: '2026-02-29' }],
  ['to gleich from', { from: '2026-10-27', to: '2026-10-27T00:00:00' }],
  ['to vor from', { from: '2026-10-28', to: '2026-10-27' }],
  ['32 Kalendertage', { from: '2026-10-01', to: '2026-11-02' }],
  ['31 Tage und eine Sekunde', { from: '2026-10-01T12:00:00', to: '2026-11-01T12:00:01' }],
  ['limit 0', { date: '2026-10-27', limit: 0 }],
  ['limit 501', { date: '2026-10-27', limit: 501 }],
  ['limit 1,5', { date: '2026-10-27', limit: 1.5 }],
  ['limit als Text', { date: '2026-10-27', limit: '100' }],
  ['order unbekannt', { date: '2026-10-27', order: 'newest' }],
  ['view unbekannt', { date: '2026-10-27', view: 'compact' }],
  ['cursor leer', { date: '2026-10-27', cursor: '' }],
  ['withLayout true mit summary', { date: '2026-10-27', withLayout: true }],
  ['withLayout als Text', { date: '2026-10-27', view: 'full', withLayout: 'true' }],
  ['cursor als Zahl', { date: '2026-10-27', cursor: 7 }],
];

for (const [name, optionen] of UNGUELTIG) {
  test(`Eingabe ${name}: KasseneckValidationError (request), kein Aufruf`, async () => {
    const { rufen, aufrufe } = server([]);
    const e1 = await fehlerVon(listReceipts(rufen, optionen as ListReceiptsOptions));
    assert.ok(isKasseneckValidationError(e1), name);
    assert.equal(e1.scope, 'request');
    assert.equal(e1.functionName, 'listReceipts');
    const { belege, fehler: e2 } = await sammle(listAllReceipts(rufen, optionen as ListReceiptsOptions));
    assert.deepEqual(belege, []);
    assert.ok(isKasseneckValidationError(e2) && e2.scope === 'request', name);
    assert.equal(aufrufe.length, 0, `${name}: fetch darf nicht aufgerufen werden`);
  });
}

test('Eingabe: Grenzen, die der Server annimmt, gehen hinaus (31 Kalendertage auch ueber die Zeitumstellung)', async () => {
  const gut: ListReceiptsOptions[] = [
    { from: '2026-10-01', to: '2026-11-01' }, // Oktober mit Ende der Sommerzeit am 25.10.
    { from: '2026-10-01T12:00:00', to: '2026-11-01T12:00:00' },
    { from: '2026-03-01', to: '2026-04-01' }, // Beginn der Sommerzeit am 29.03.
    { from: '2026-10-27T23:59:59', to: '2026-10-28' },
    { from: '2028-02-29', to: '2028-03-01' }, // Schaltjahr
    { from: '2026-12-15', to: '2027-01-15' },
    { date: '2026-10-25', limit: 1, order: 'desc', view: 'summary' },
    { date: '2026-10-25', limit: 500, order: 'asc', view: 'full' },
  ];
  const { rufen, aufrufe } = server(() => erfolg({ receipts: [], hasMore: false, nextCursor: null }));
  for (const o of gut) await listReceipts(rufen, o);
  assert.deepEqual(aufrufe.map((a) => a.params), gut);
});

// --- Antwort ----------------------------------------------------------------------

test('Antwort: ohne Belegliste, ohne hasMore oder mit hasMore ohne Cursor ist ein Antwortfehler', async () => {
  const kaputt: Json[] = [
    { hasMore: false, nextCursor: null },
    { receipts: [zeile(1), 'x'], hasMore: false, nextCursor: null },
    { receipts: [] , nextCursor: null },
    { receipts: [zeile(1)], hasMore: true, nextCursor: null },
    { receipts: [zeile(1)], hasMore: true, nextCursor: '' },
    { receipts: [zeile(1)], hasMore: false, nextCursor: 'c-1' },
    { receipts: [], hasMore: false, nextCursor: null, daySummary: 'heute' },
  ];
  for (const data of kaputt) {
    const { rufen } = server([erfolg(data)]);
    const e = await fehlerVon(listReceipts(rufen, { date: '2026-10-27' }));
    assert.ok(isKasseneckValidationError(e), JSON.stringify(data));
    assert.equal(e.scope, 'response');
  }
});

// --- Fassade, Wurzel und Vertrag ---------------------------------------------------

test('Fassade und Wurzel: listReceipts und listAllReceipts', async () => {
  const { holen, aufrufe } = server([
    erfolg({ receipts: [zeile(1)], hasMore: true, nextCursor: 'c-1', daySummary: TAG }),
    erfolg({ receipts: [zeile(2)], hasMore: false, nextCursor: null }),
    erfolg({ receipts: [zeile(1)], hasMore: false, nextCursor: null, daySummary: TAG }),
  ]);
  const api = createKasseneckApi({ auth: apiKeyAuth({ apiKey: 'kr_test_Beispielschluessel0123456789', cashregisterToken: 'cb_test_EXAMPLE00000000' }), fetch: holen });
  const alle: string[] = [];
  for await (const b of api.listAllReceipts({ date: '2026-10-27' })) alle.push(b.receiptId!);
  assert.deepEqual(alle, ['KECK-1-ID-1', 'KECK-1-ID-2']);
  const seite = await api.listReceipts({ date: '2026-10-27' });
  assert.deepEqual(seite.daySummary, TAG);
  assert.equal(aufrufe.length, 3);
  for (const name of ['listReceipts', 'listAllReceipts', 'LIST_RECEIPTS_ERROR_CODES', 'LIST_ALL_RECEIPTS_MAX_PAGES', 'fromListReceiptsSummaryPayload']) {
    assert.ok(name in wurzel, name);
  }
});

test('Vertrag: listReceipts ist oeffentlich unter /v3, liest nur, Kataloge der Kurzansicht wie im Vokabular', () => {
  assert.ok((VOKABULAR.endpoints.public as string[]).includes('listReceipts'));
  assert.ok((VOKABULAR.endpoints.v3Routed as string[]).includes('listReceipts'));
  assert.ok(!(VOKABULAR.endpoints.register as string[]).includes('listReceipts'), 'nicht am Kassenweg');
  assert.ok((PUBLIC_CALLS as readonly string[]).includes('listReceipts'));
  assert.equal(isPosOnlyCall('listReceipts'), false);
  assert.equal(isUnknownOutcomeCall('listReceipts'), false);
  assert.equal(CALLS_WITHOUT_EFFECT['listReceipts'], 'read');

  const werte = VOKABULAR.schemas.listReceipts.werte as Record<string, { $catalog: string }>;
  const katalog = (name: string) => Object.values(VOKABULAR.catalogs[name] as Record<string, string>).sort();
  assert.deepEqual(katalog(werte['receipts[].cancellationStatus']!.$catalog), [...CANCELLATION_STATUSES].sort());
  assert.deepEqual(katalog(werte['receipts[].cancellationReason']!.$catalog), Object.keys(CANCELLATION_REASONS).sort());
  // Die Wertelisten der Eingabe und die Codes der Spec.
  assert.deepEqual([...LIST_RECEIPTS_VIEWS], ['summary', 'full']);
  assert.deepEqual([...LIST_RECEIPTS_ORDERS], ['desc', 'asc']);
  assert.deepEqual([...LIST_RECEIPTS_ERROR_CODES], ['invalid_date', 'invalid_range', 'range_too_long', 'invalid_limit', 'invalid_order', 'invalid_view', 'invalid_cursor', 'invalid_with_layout', 'server_error']);
  // Seit Backend 30.10.2026: die volle Ansicht traegt Kopf-Versionen, Kennzeichen und auf Wunsch das Zeilenmodell.
  const daten = VOKABULAR.schemas.listReceipts.data as Record<string, unknown>;
  for (const feld of ['headers', 'testCashregister', 'logo_scale']) assert.ok(feld in daten, feld);
  assert.equal(werte['receipts[].layout.lines[].tone']!.$catalog, VOKABULAR.schemas.getReceipt.werte['layout.lines[].tone'].$catalog);
});

// --- volle Ansicht wie getReceipt (Backend 30.10.2026, Spec list-receipts-voll) -----------------------

const KOPF_V1 = {
  headerVersionId: 'v1', company: 'Bäckerei Kornblum', street: 'Alter Weg 1', zip: '1010', city: 'Wien', phone: '+43 1 234',
  taxNumber: '91-123/4565', vatId: 'ATU12345675', is_small_business: false,
  footer1: 'Danke', footer2: null, footer3: null, footer4: null, thanks_message: 'Bis bald', kreiseck_logo: false, logo_url: 'https://example.at/logo.png',
};
const KOPF_V2 = { ...KOPF_V1, headerVersionId: 'v2', street: 'Neuer Platz 2' };
const LAYOUT = { paperSize: 'mm80', ruleset: 2, lines: [{ kind: 'text', text: 'Bäckerei Kornblum' }] };

function volleSeite(extra: Json = {}): Json {
  const [a, b, ...rest] = VOLLE_BELEGE;
  return {
    receipts: [
      { ...a, headerVersionId: 'v1', testSignature: false, layout: LAYOUT },
      { ...b, headerVersionId: 'v2', testSignature: true, layout: null },
      ...rest.map((r) => ({ ...r, headerVersionId: 'v2', testSignature: false })),
    ],
    hasMore: false, nextCursor: null, metadata: { ...KOPF_V2, label: 'Schank' },
    headers: [KOPF_V1, KOPF_V2], testCashregister: true, logo_scale: 'L',
    ...extra,
  };
}

test('listReceipts: withLayout geht nur gesetzt hinaus; false auch mit summary', async () => {
  const { rufen, aufrufe } = server([erfolg(volleSeite()), erfolg({ receipts: [], hasMore: false, nextCursor: null }), erfolg(volleSeite())]);
  await listReceipts(rufen, { date: '2026-10-27', view: 'full', withLayout: true });
  await listReceipts(rufen, { date: '2026-10-27', withLayout: false });
  await listReceipts(rufen, { date: '2026-10-27', view: 'full' });
  assert.deepEqual(aufrufe.map((a) => a.params), [
    { date: '2026-10-27', view: 'full', withLayout: true },
    { date: '2026-10-27', withLayout: false },
    { date: '2026-10-27', view: 'full' },
  ]);
});

test('listReceipts full: headers je Kopf-Version, testCashregister, logoScale; je Beleg testSignature und layout', async () => {
  const seite = await listReceipts(server([erfolg(volleSeite())]).rufen, { date: '2026-10-27', view: 'full', withLayout: true });
  assert.deepEqual(seite.headers!.map((h) => [h.headerVersionId, h.company.street]), [['v1', 'Alter Weg 1'], ['v2', 'Neuer Platz 2']]);
  assert.equal(seite.headers![0]!.company.taxNumber, '91-123/4565');
  assert.equal(seite.testCashregister, true);
  assert.equal(seite.logoScale, 'L');
  const [a, b] = seite.receipts;
  assert.equal(a!.testSignature, false);
  assert.deepEqual(a!.layout, LAYOUT);
  assert.equal(b!.testSignature, true);
  assert.equal(b!.layout, null);
  assert.equal(b!.headerVersionId, 'v2');
});

test('listReceipts full: aelteres Backend ohne headers -> Felder fehlen, keine Ausnahme', async () => {
  const { headers: _h, testCashregister: _t, logo_scale: _l, ...alt } = volleSeite();
  const seite = await listReceipts(server([erfolg({ ...alt, receipts: VOLLE_BELEGE })]).rufen, { date: '2026-10-27', view: 'full' });
  assert.equal('headers' in seite, false);
  assert.equal('testCashregister' in seite, false);
  assert.equal('testSignature' in seite.receipts[0]!, false);
  assert.equal('layout' in seite.receipts[0]!, false);
});

test('listReceipts full: headers kein Array ist ein Antwortfehler', async () => {
  const e = await fehlerVon(listReceipts(server([erfolg(volleSeite({ headers: 'x' }))]).rufen, { date: '2026-10-27', view: 'full' }));
  assert.ok(isKasseneckValidationError(e));
  assert.equal(e.scope, 'response');
});

test('listedReceiptWithCompany: derselbe Inhalt wie getReceiptWithCompany, Kopf der Version des Belegs', async () => {
  const seite = await listReceipts(server([erfolg(volleSeite())]).rufen, { date: '2026-10-27', view: 'full', withLayout: true });
  const erster = listedReceiptWithCompany(seite, seite.receipts[0]!);
  assert.equal(erster.receipt, seite.receipts[0]);
  assert.equal(erster.company.street, 'Alter Weg 1');
  assert.equal(erster.company.logoUrl, 'https://example.at/logo.png');
  assert.equal(erster.headerVersionId, 'v1');
  assert.equal(erster.testCashregister, true);
  assert.equal(erster.testSignature, false);
  assert.equal(erster.logoScale, 'L');
  assert.deepEqual(erster.layout, LAYOUT);
  assert.equal('outputs' in erster, false);
  const zweiter = listedReceiptWithCompany(seite, seite.receipts[1]!);
  assert.equal(zweiter.company.street, 'Neuer Platz 2');
  assert.equal(zweiter.testSignature, true);
  assert.equal(zweiter.layout, null);
});

test('listedReceiptWithCompany: Nullbeleg ohne Logo, registrationInfo vom Beleg; ohne headers der Kopf aus metadata', async () => {
  const nullbeleg = { ...VOLLE_BELEGE[0]!, receiptId: 'KECK-1-ID-99', receiptType: 'zero', headerVersionId: 'v1', testSignature: false,
    registrationInfo: { cardRegisteredAt: '2024-03-11T08:00:00.000Z', cashregisterRegisteredAt: null } };
  const seite = await listReceipts(server([erfolg(volleSeite({ receipts: [nullbeleg] }))]).rufen, { date: '2026-10-27', view: 'full' });
  const r = listedReceiptWithCompany(seite, seite.receipts[0]!);
  assert.equal(r.company.logoUrl, undefined);
  assert.deepEqual(r.registrationInfo, { cardRegisteredAt: '2024-03-11T08:00:00.000Z', cashregisterRegisteredAt: null });
  assert.equal(r.layout, null);

  const { headers: _h, testCashregister: _t, logo_scale: _l, ...alt } = volleSeite();
  const altSeite = await listReceipts(server([erfolg({ ...alt, receipts: VOLLE_BELEGE })]).rufen, { date: '2026-10-27', view: 'full' });
  const ausMetadata = listedReceiptWithCompany(altSeite, altSeite.receipts[0]!);
  assert.equal(ausMetadata.company.street, 'Neuer Platz 2');
  assert.equal(ausMetadata.testCashregister, false);
  assert.equal(ausMetadata.logoScale, 'M');
});
