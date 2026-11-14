import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createHpsConnectClient,
  type HpsConnectEndpoint,
  type HpsConnectFetch,
} from '../src/payments/hobex-hps/connect-client.js';
import { HpsPreflightError } from '../src/payments/hobex-hps/errors.js';

// Attrappe: antwortet mit der Huelle von Kasseneck Connect (1.5.0 traegt
// `endpoint` neben `hps`, 1.4.2 nicht).

const ZIEL = { host: '192.168.1.50', tid: '3600335' };

function antwort(body: unknown): HpsConnectFetch {
  return async () => ({ status: 200, text: async () => JSON.stringify(body) });
}

function client(body: unknown, aufrufe: HpsConnectEndpoint[]) {
  return createHpsConnectClient({ token: 'kc_test_TOKEN', fetch: antwort(body), onEndpoint: (e) => aufrufe.push(e) });
}

test('onEndpoint: Antwort von Connect 1.5.0 meldet die benutzte Adresse', async () => {
  const aufrufe: HpsConnectEndpoint[] = [];
  const c = client({ ok: true, hps: { responseCode: '0' }, endpoint: { host: '192.168.1.77', port: 8080, relocated: true } }, aufrufe);
  await c.diagnosis(ZIEL);
  assert.deepEqual(aufrufe, [{ host: '192.168.1.77', port: 8080, relocated: true }]);
});

test('onEndpoint: ohne relocated gilt false', async () => {
  const aufrufe: HpsConnectEndpoint[] = [];
  const c = client({ ok: true, hps: {}, endpoint: { host: '192.168.1.50', port: 8080 } }, aufrufe);
  await c.diagnosis(ZIEL);
  assert.deepEqual(aufrufe, [{ host: '192.168.1.50', port: 8080, relocated: false }]);
});

test('onEndpoint: Fehlerhuelle ruft nie auf, auch mit endpoint', async () => {
  const aufrufe: HpsConnectEndpoint[] = [];
  const c = client(
    { ok: false, error: { code: 'terminal_unreachable', message: 'Terminal nicht erreichbar' }, endpoint: { host: '192.168.1.77', port: 8080, relocated: true } },
    aufrufe,
  );
  await assert.rejects(c.diagnosis(ZIEL), HpsPreflightError);
  assert.deepEqual(aufrufe, []);
});

test('onEndpoint: Antwort von Connect 1.4.2 (ohne endpoint) ruft nie auf', async () => {
  const aufrufe: HpsConnectEndpoint[] = [];
  const c = client({ ok: true, hps: { responseCode: '0' } }, aufrufe);
  await c.diagnosis(ZIEL);
  assert.deepEqual(aufrufe, []);
});

test('onEndpoint: unvollstaendige Adresse wird nicht gemeldet', async () => {
  for (const endpoint of [null, 'x', {}, { host: '', port: 8080 }, { host: '10.0.0.5' }, { host: '10.0.0.5', port: '8080' }]) {
    const aufrufe: HpsConnectEndpoint[] = [];
    await client({ ok: true, hps: {}, endpoint }, aufrufe).diagnosis(ZIEL);
    assert.deepEqual(aufrufe, [], JSON.stringify(endpoint));
  }
});

test('onEndpoint: ein Wurf des Aufrufers kippt die Antwort nicht', async () => {
  const c = createHpsConnectClient({
    token: 'kc_test_TOKEN',
    fetch: antwort({ ok: true, hps: { a: 1 }, endpoint: { host: '10.0.0.5', port: 8080, relocated: false } }),
    onEndpoint: () => {
      throw new Error('Aufrufer kaputt');
    },
  });
  assert.deepEqual(await c.diagnosis(ZIEL), { a: 1 });
});

test('ohne onEndpoint verhaelt sich der Client wie bisher', async () => {
  const c = createHpsConnectClient({ token: 'kc_test_TOKEN', fetch: antwort({ ok: true, hps: {}, endpoint: { host: 'h', port: 1, relocated: true } }) });
  assert.deepEqual(await c.diagnosis(ZIEL), {});
});
