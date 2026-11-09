import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createKasseneckApi } from '../src/client/api.js';
import { apiKeyAuth } from '../src/client/auth.js';
import { CALLS_WITHOUT_EFFECT, PUBLIC_CALLS, isPosOnlyCall } from '../src/client/aufrufe.js';
import { isKasseneckValidationError } from '../src/client/errors.js';
import { type FetchLike, type HttpRequestInit, type HttpResponseLike } from '../src/client/transport.js';

/*
 * listDepositTypes (Pfandarten lesen, nur /v3): Attrappe des Servers, die Antwort
 * ist die Form des Blocks `deposit` aus getKasseSettings. Namen erfunden.
 */

type Json = Record<string, any>;

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

function server(data: Json) {
  const aufrufe: Array<{ url: string; params: Json }> = [];
  const holen: FetchLike = async (url: string, init: HttpRequestInit) => {
    aufrufe.push({ url, params: (JSON.parse(init.body) as { params: Json }).params });
    return antwort({ status: 'success', message: '', data });
  };
  const api = createKasseneckApi({ auth: apiKeyAuth({ apiKey: 'kr_test_Beispielschluessel0123456789', cashregisterToken: 'cb_test_EXAMPLE00000000' }), fetch: holen });
  return { api, aufrufe };
}

const ARTEN = [
  { id: 'pf_einweg_1', kind: 'single_use', name: 'Einweg Flasche', type: 'bottle', amounts: [{ from: '2025-01-01', cents: 25 }], returnRate: null, used: true },
  { id: 'pf_mehrweg_1', kind: 'reusable', name: 'Mehrweg Bierkiste', type: 'crate', amounts: [{ from: '2020-01-01', cents: 300 }, { from: '2026-07-01', cents: 350 }], returnRate: null, used: false },
];

test('listDepositTypes ruft /v3 listDepositTypes ohne Parameter', async () => {
  const { api, aufrufe } = server({ deposit: null });
  await api.listDepositTypes();
  assert.equal(aufrufe.length, 1);
  assert.match(aufrufe[0]!.url, /\/v3\/listDepositTypes$/);
  assert.deepEqual(aufrufe[0]!.params, {});
});

test('deposit null -> null', async () => {
  const { api } = server({ deposit: null });
  assert.equal(await api.listDepositTypes(), null);
});

test('Einweg und Mehrweg -> DepositSettings mit depositTypes[0].kind "single_use", amounts[{from, cents}]', async () => {
  const { api } = server({ deposit: { singleUse: true, reusable: true, depositTypes: ARTEN } });
  const r = await api.listDepositTypes();
  assert.ok(r);
  assert.equal(r.singleUse, true);
  assert.equal(r.reusable, true);
  assert.equal(r.depositTypes.length, 2);
  assert.equal(r.depositTypes[0]!.kind, 'single_use');
  assert.deepEqual(r.depositTypes[0]!.amounts, [{ from: '2025-01-01', cents: 25 }]);
  assert.equal(r.depositTypes[1]!.kind, 'reusable');
  assert.equal(r.depositTypes[1]!.amounts[1]!.cents, 350);
});

for (const deposit of ['an', 7, true, [], [{ singleUse: true }]]) {
  test(`deposit kein Objekt (${JSON.stringify(deposit)}) -> KasseneckValidationError (response)`, async () => {
    const { api } = server({ deposit });
    await assert.rejects(api.listDepositTypes(), (e: unknown) => {
      assert.ok(isKasseneckValidationError(e));
      assert.equal(e.scope, 'response');
      return true;
    });
  });
}

test('data ohne deposit -> KasseneckValidationError (response), nie still null', async () => {
  const { api } = server({});
  await assert.rejects(api.listDepositTypes(), (e: unknown) => isKasseneckValidationError(e) && e.scope === 'response');
});

test('listDepositTypes ist ein oeffentlicher Lese-Aufruf ohne Wirkung', () => {
  assert.ok((PUBLIC_CALLS as readonly string[]).includes('listDepositTypes'));
  assert.equal(CALLS_WITHOUT_EFFECT['listDepositTypes'], 'read');
  assert.equal(isPosOnlyCall('listDepositTypes'), false);
});

test('Vertrag: listDepositTypes steht in fixtures/surface.json und im Vokabular', () => {
  const surface = JSON.parse(readFileSync(new URL('../../fixtures/surface.json', import.meta.url), 'utf8')) as Json;
  assert.ok(surface.calls.public.includes('listDepositTypes'));
  const vok = JSON.parse(readFileSync(new URL('../../fixtures/v3/v3-vokabular.json', import.meta.url), 'utf8')) as Json;
  assert.ok(vok.endpoints.public.includes('listDepositTypes'));
});
