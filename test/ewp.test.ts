import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createKasseneckApi } from '../src/client/api.js';
import { ALL_CALLS, CALLS_WITHOUT_EFFECT, PUBLIC_CALLS, isPosOnlyCall, isUnknownOutcomeCall } from '../src/client/aufrufe.js';
import { apiKeyAuth } from '../src/client/auth.js';
import { isKasseneckValidationError } from '../src/client/errors.js';
import { EWP_REASONS, type EwpReport, type EwpWarning } from '../src/client/ewp.js';
import type { FetchLike, HttpRequestInit, HttpResponseLike } from '../src/client/transport.js';
import * as wurzel from '../src/index.js';

/*
 * EWP-Meldung (Einwegpfand-Meldung, Pfand Teil 5): getEwpReport, downloadEwpReport,
 * setEwpExtraQuantities gegen eine Attrappe des Servers. Die Antwortformen stammen aus
 * dem Backend (functions-kasse/ewp-endpoints.js, Vokabular EWP_MELDUNG); GTINs sind
 * erfunden und pruefziffernrichtig, Betriebsnamen gibt es hier nicht.
 */

type Json = Record<string, any>;

const VOKABULAR = JSON.parse(readFileSync(new URL('../../fixtures/v3/v3-vokabular.json', import.meta.url), 'utf8')) as Json;

const KOPF: Record<string, string> = { 'content-type': 'application/json', 'kasseneck-api-version': 'v3' };
const GTIN_DOSE = '9012345000011';
const GTIN_FLASCHE = '9012345000028';
const GTIN_FREMD = '9012345000035';

function antwort(rumpf: Json): HttpResponseLike {
  const text = JSON.stringify(rumpf);
  return {
    status: 200,
    headers: { get: (name: string) => KOPF[name.toLowerCase()] ?? null },
    text: async () => text,
    arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer,
  };
}

function server(data: unknown) {
  const aufrufe: Array<{ url: string; params: Json }> = [];
  const holen: FetchLike = async (url: string, init: HttpRequestInit) => {
    aufrufe.push({ url, params: (JSON.parse(init.body) as { params: Json }).params });
    return antwort({ status: 'success', message: '', data });
  };
  const api = createKasseneckApi({
    auth: apiKeyAuth({ apiKey: 'kr_test_Beispielschluessel0123456789', cashregisterToken: 'cb_test_EXAMPLE00000000' }),
    fetch: holen,
  });
  return { api, aufrufe };
}

const STAMM = { barcodeType: 'International', productOrigin: 'Produced in Austria', depositFee: 'D1', producerFee: 'PF1', ecoImpact: 'EFP1', intBarcodeUsage: 'PFI1' };

/** Die Meldung, wie `getEwpReport` sie unter /v3 liefert (englische Namen, ganze Zahlen). */
const MELDUNG: Json = {
  month: '2026-11',
  dueDate: '2026-12-05',
  provisional: false,
  test: false,
  lines: [
    { gtin: GTIN_DOSE, name: 'Lager Dose 0,5 l', masterData: STAMM, domestic: 37, foreign: 0, sources: { register: 3, invoices: 24, deliveryNotes: 10, extra: 0 } },
    { gtin: GTIN_FLASCHE, name: 'Lager Flasche 0,33 l', masterData: STAMM, domestic: 0, foreign: 2, sources: { register: 0, invoices: 0, deliveryNotes: 0, extra: 2 } },
  ],
  warnings: [
    { code: 'foreign_not_reportable', gtin: GTIN_FLASCHE, country: 'DE', quantity: 2 },
    { code: 'gtin_not_registered', gtin: GTIN_FREMD, quantity: 4 },
    { code: 'master_data_missing', gtin: GTIN_DOSE, fields: ['ecoImpact'] },
    { code: 'negative_quantity', gtin: GTIN_DOSE, column: 'domestic', amount: -3 },
    { code: 'invalid_posting', count: 2 },
  ],
  extraQuantities: [
    { gtin: GTIN_FLASCHE, domestic: 0, foreign: 2, reason: 'sampling', text: null, at: 1760000000000, by: 'api' },
    { gtin: GTIN_DOSE, domestic: 1, foreign: 0, reason: 'own_consumption', text: 'Fest', at: 1760000100000, by: 'uidBeispiel1' },
  ],
  downloadedAt: null,
};

test('getEwpReport ruft /v3 getEwpReport mit { month } und liefert die Meldung unveraendert', async () => {
  const { api, aufrufe } = server(MELDUNG);
  const bericht: EwpReport = await api.getEwpReport({ month: '2026-11' });
  assert.equal(aufrufe.length, 1);
  assert.match(aufrufe[0]!.url, /\/v3\/getEwpReport$/);
  assert.deepEqual(aufrufe[0]!.params, { month: '2026-11' });
  assert.deepEqual(bericht, MELDUNG);
  assert.equal(bericht.lines[0]!.sources.deliveryNotes, 10);
  assert.equal(bericht.extraQuantities[0]!.by, 'api');
});

test('Warnungen tragen je Code ihre Angaben (gtin, country, quantity, fields, count, column, amount)', async () => {
  const { api } = server(MELDUNG);
  const bericht = await api.getEwpReport({ month: '2026-11' });
  const nachCode = (code: EwpWarning['code']): EwpWarning => bericht.warnings.find((w) => w.code === code)!;
  assert.deepEqual(nachCode('foreign_not_reportable'), { code: 'foreign_not_reportable', gtin: GTIN_FLASCHE, country: 'DE', quantity: 2 });
  assert.deepEqual(nachCode('master_data_missing').fields, ['ecoImpact']);
  assert.equal(nachCode('negative_quantity').column, 'domestic');
  assert.equal(nachCode('negative_quantity').amount, -3);
  assert.equal(nachCode('invalid_posting').count, 2);
});

test('downloadEwpReport ruft getEwpReport mit format csv und liefert { csv, filename, contentType }', async () => {
  const datei = { csv: 'Kopf\r\nZeile\r\n', filename: 'EWP-Meldung-2026-11.csv', contentType: 'text/csv; charset=utf-8' };
  const { api, aufrufe } = server(datei);
  const r = await api.downloadEwpReport({ month: '2026-11' });
  assert.match(aufrufe[0]!.url, /\/v3\/getEwpReport$/);
  assert.deepEqual(aufrufe[0]!.params, { month: '2026-11', format: 'csv' });
  assert.deepEqual(r, datei);
});

test('setEwpExtraQuantities sendet extraQuantities und liefert die neue Meldung', async () => {
  const { api, aufrufe } = server(MELDUNG);
  const zusatz = [
    { gtin: GTIN_DOSE, domestic: 1, foreign: 0, reason: 'own_consumption' as const, text: 'Fest' },
    { gtin: GTIN_FLASCHE, domestic: 0, foreign: 2, reason: 'sampling' as const },
  ];
  const bericht = await api.setEwpExtraQuantities({ month: '2026-11', extraQuantities: zusatz });
  assert.match(aufrufe[0]!.url, /\/v3\/setEwpExtraQuantities$/);
  assert.deepEqual(aufrufe[0]!.params, { month: '2026-11', extraQuantities: zusatz });
  assert.deepEqual(bericht, MELDUNG);
});

test('setEwpExtraQuantities mit leerer Liste leert die Zusatzmengen (wird gesendet, nicht weggelassen)', async () => {
  const { api, aufrufe } = server({ ...MELDUNG, extraQuantities: [] });
  const bericht = await api.setEwpExtraQuantities({ month: '2026-11', extraQuantities: [] });
  assert.deepEqual(aufrufe[0]!.params, { month: '2026-11', extraQuantities: [] });
  assert.deepEqual(bericht.extraQuantities, []);
});

for (const [name, aufruf] of [
  ['getEwpReport', (api: ReturnType<typeof server>['api']) => api.getEwpReport({ month: '2026-11' })],
  ['setEwpExtraQuantities', (api: ReturnType<typeof server>['api']) => api.setEwpExtraQuantities({ month: '2026-11', extraQuantities: [] })],
] as const) {
  for (const data of [null, 'text', [], {}, { ...MELDUNG, lines: 'x' }, { ...MELDUNG, warnings: null }, { ...MELDUNG, extraQuantities: {} }, { ...MELDUNG, month: 7 }]) {
    test(`${name}: unlesbare Antwort (${JSON.stringify(data)?.slice(0, 40)}) -> KasseneckValidationError (response)`, async () => {
      const { api } = server(data);
      await assert.rejects(aufruf(api), (e: unknown) => {
        assert.ok(isKasseneckValidationError(e));
        assert.equal(e.scope, 'response');
        return true;
      });
    });
  }
}

for (const data of [null, {}, { csv: 7, filename: 'a.csv', contentType: 'text/csv' }, { csv: 'x', filename: null, contentType: 'text/csv' }, { csv: 'x', filename: 'a.csv' }]) {
  test(`downloadEwpReport: unlesbare Antwort (${JSON.stringify(data)}) -> KasseneckValidationError (response)`, async () => {
    const { api } = server(data);
    await assert.rejects(api.downloadEwpReport({ month: '2026-11' }), (e: unknown) => isKasseneckValidationError(e) && e.scope === 'response');
  });
}

for (const month of ['', 7, null, undefined]) {
  test(`Monat ${JSON.stringify(month)} wirft vor dem Senden (request)`, async () => {
    const { api, aufrufe } = server(MELDUNG);
    const m = month as unknown as string;
    await assert.rejects(api.getEwpReport({ month: m }), (e: unknown) => isKasseneckValidationError(e) && e.scope === 'request');
    await assert.rejects(api.downloadEwpReport({ month: m }), (e: unknown) => isKasseneckValidationError(e) && e.scope === 'request');
    await assert.rejects(api.setEwpExtraQuantities({ month: m, extraQuantities: [] }), (e: unknown) => isKasseneckValidationError(e) && e.scope === 'request');
    assert.equal(aufrufe.length, 0);
  });
}

test('extraQuantities, die keine Liste ist, wirft vor dem Senden (request)', async () => {
  const { api, aufrufe } = server(MELDUNG);
  await assert.rejects(
    api.setEwpExtraQuantities({ month: '2026-11', extraQuantities: null as unknown as [] }),
    (e: unknown) => isKasseneckValidationError(e) && e.scope === 'request',
  );
  assert.equal(aufrufe.length, 0);
});

test('EWP_REASONS: die neun Gruende in Reihenfolge des Backends, jeder ein Wert des Vokabulars', () => {
  assert.deepEqual([...EWP_REASONS], [
    'own_consumption', 'sampling', 'donation', 'theft', 'free_goods', 'stocktake', 'return', 'external_system', 'other',
  ]);
  const werte = Object.values(VOKABULAR.schemas['setEwpExtraQuantities'].paramWerte['extraQuantities[].reason'] as Record<string, string>);
  assert.deepEqual([...EWP_REASONS].sort(), [...werte].sort());
  assert.equal(wurzel.EWP_REASONS, EWP_REASONS);
});

test('EwpWarning.code: die fuenf Werte des Vokabulars', () => {
  const werte = Object.values(VOKABULAR.schemas['getEwpReport'].werte['warnings[].code'] as Record<string, string>);
  assert.deepEqual(werte, ['gtin_not_registered', 'foreign_not_reportable', 'master_data_missing', 'negative_quantity', 'invalid_posting']);
});

test('Einordnung: beide Aufrufe oeffentlich unter /v3, am Ende der Liste, wiederholbar, nicht am Kassenweg', () => {
  for (const n of ['getEwpReport', 'setEwpExtraQuantities']) {
    assert.ok((PUBLIC_CALLS as readonly string[]).includes(n), n);
    assert.ok((ALL_CALLS as readonly string[]).includes(n), n);
    assert.equal(isPosOnlyCall(n), false, n);
    assert.equal(CALLS_WITHOUT_EFFECT[n], 'repeatable', n);
    assert.equal(isUnknownOutcomeCall(n), false, n);
    assert.ok(VOKABULAR.schemas[n], `${n}: kein Schema im Vertrag`);
  }
  assert.deepEqual(PUBLIC_CALLS.slice(-3), ['listDepositTypes', 'getEwpReport', 'setEwpExtraQuantities']);
  assert.deepEqual((VOKABULAR.endpoints.public as string[]).slice(-3), ['listDepositTypes', 'getEwpReport', 'setEwpExtraQuantities']);
});

test('Vertrag: surface.json fuehrt beide Aufrufe', () => {
  const surface = JSON.parse(readFileSync(new URL('../../fixtures/surface.json', import.meta.url), 'utf8')) as Json;
  for (const n of ['getEwpReport', 'setEwpExtraQuantities']) assert.ok(surface.calls.public.includes(n), n);
});
