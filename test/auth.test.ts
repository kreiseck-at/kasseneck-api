import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiKeyAuth, registerUserAuth } from '../src/client/auth.js';
import { KasseneckAuthError } from '../src/client/errors.js';

const API_KEY = 'kr_live_GEHEIMERAPIKEY';
const KASSEN_TOKEN = 'cb_live_GEHEIMESKASSENTOKEN';

// --- apiKeyAuth --------------------------------------------------------

test('apiKeyAuth: Bearer-Schluessel und cashregister-token, keine Zusatzparameter', async () => {
  const anmeldung = apiKeyAuth({ apiKey: API_KEY, cashregisterToken: KASSEN_TOKEN });
  const daten = await anmeldung();
  assert.deepEqual(daten.headers, {
    Authorization: `Bearer ${API_KEY}`,
    'cashregister-token': KASSEN_TOKEN,
  });
  assert.deepEqual(daten.params, {});
});

test('apiKeyAuth: setzt keine Kopfzeile des Kassen-Benutzer-Wegs', async () => {
  const daten = await apiKeyAuth({ apiKey: API_KEY, cashregisterToken: KASSEN_TOKEN })();
  assert.equal(daten.headers['register-session'], undefined);
  assert.equal(Object.keys(daten.params).length, 0);
});

test('apiKeyAuth: fehlender Schluessel faellt sofort auf, ohne den Wert zu nennen', () => {
  assert.throws(
    () => apiKeyAuth({ apiKey: '', cashregisterToken: KASSEN_TOKEN }),
    (fehler: Error) =>
      fehler instanceof KasseneckAuthError && fehler.message.includes('apiKey') && !fehler.message.includes(KASSEN_TOKEN),
  );
  assert.throws(() => apiKeyAuth({ apiKey: API_KEY, cashregisterToken: '' }), /cashregisterToken/);
});

test('apiKeyAuth: jeder Aufruf liefert ein eigenes Objekt (kein geteilter Zustand)', async () => {
  const anmeldung = apiKeyAuth({ apiKey: API_KEY, cashregisterToken: KASSEN_TOKEN });
  const erste = await anmeldung();
  erste.headers['Authorization'] = 'Bearer manipuliert';
  erste.params['schmuggel'] = true;
  const zweite = await anmeldung();
  assert.equal(zweite.headers['Authorization'], `Bearer ${API_KEY}`);
  assert.deepEqual(zweite.params, {});
});

// --- registerUserAuth --------------------------------------------------

test('registerUserAuth: Bearer-ID-Token, register-session und die Kasse als Parameter', async () => {
  const anmeldung = registerUserAuth({
    getIdToken: () => 'eyJ-ID-TOKEN',
    getSessionId: () => 'sess-1',
    cashregisterId: 'kasse-1',
  });
  const daten = await anmeldung();
  assert.equal(daten.headers['cashregister-token'], undefined, 'der api_key-Weg darf hier nicht durchschlagen');
  assert.deepEqual(daten.headers, {
    Authorization: 'Bearer eyJ-ID-TOKEN',
    'register-session': 'sess-1',
  });
  assert.deepEqual(daten.params, { cashregisterId: 'kasse-1' });
});

test('registerUserAuth: Token und Sitzung werden bei JEDEM Aufruf frisch geholt', async () => {
  // Firebase-ID-Tokens laufen nach einer Stunde ab, die Sitzung der
  // Browser-Kasse nach 90 Sekunden — ein einmal gemerkter Wert waere tot.
  let tokenAufrufe = 0;
  let sitzungsAufrufe = 0;
  const anmeldung = registerUserAuth({
    getIdToken: () => `token-${++tokenAufrufe}`,
    getSessionId: () => `sess-${++sitzungsAufrufe}`,
    cashregisterId: 'kasse-1',
  });
  assert.equal(tokenAufrufe, 0, 'beim Anlegen darf noch nichts geholt werden');

  const erste = await anmeldung();
  const zweite = await anmeldung();
  const dritte = await anmeldung();

  assert.equal(erste.headers['Authorization'], 'Bearer token-1');
  assert.equal(zweite.headers['Authorization'], 'Bearer token-2');
  assert.equal(dritte.headers['Authorization'], 'Bearer token-3');
  assert.equal(erste.headers['register-session'], 'sess-1');
  assert.equal(dritte.headers['register-session'], 'sess-3');
  assert.equal(tokenAufrufe, 3);
  assert.equal(sitzungsAufrufe, 3);
});

test('registerUserAuth: asynchrone Geber werden abgewartet', async () => {
  const anmeldung = registerUserAuth({
    getIdToken: async () => {
      await new Promise((weiter) => setTimeout(weiter, 1));
      return 'spaeter-token';
    },
    getSessionId: async () => 'spaeter-sess',
    cashregisterId: 'kasse-7',
  });
  const daten = await anmeldung();
  assert.equal(daten.headers['Authorization'], 'Bearer spaeter-token');
  assert.equal(daten.headers['register-session'], 'spaeter-sess');
});

test('registerUserAuth: leeres Token/leere Sitzung fallen auf, ohne Geheimnisse zu nennen', async () => {
  const ohneToken = registerUserAuth({
    getIdToken: () => '',
    getSessionId: () => 'sess-GEHEIM',
    cashregisterId: 'kasse-1',
  });
  await assert.rejects(async () => ohneToken(), (fehler: Error) => {
    assert.ok(fehler instanceof KasseneckAuthError, 'Anmeldefehler haben eine eigene Fehlerart');
    assert.match(fehler.message, /getIdToken/);
    assert.ok(!fehler.message.includes('sess-GEHEIM'), 'Sitzung darf nicht in der Meldung stehen');
    return true;
  });

  const ohneSitzung = registerUserAuth({
    getIdToken: () => 'eyJ-GEHEIM',
    getSessionId: () => '',
    cashregisterId: 'kasse-1',
  });
  await assert.rejects(async () => ohneSitzung(), (fehler: Error) => {
    assert.match(fehler.message, /getSessionId/);
    assert.ok(!fehler.message.includes('eyJ-GEHEIM'), 'ID-Token darf nicht in der Meldung stehen');
    return true;
  });
});

test('registerUserAuth: fehlende Kasse faellt beim Anlegen auf', () => {
  assert.throws(
    () => registerUserAuth({ getIdToken: () => 't', getSessionId: () => 's', cashregisterId: '' }),
    /cashregisterId/,
  );
});

test('beide Anmeldewege erfuellen dieselbe Form — keiner ist der bevorzugte', async () => {
  const wege = [
    apiKeyAuth({ apiKey: API_KEY, cashregisterToken: KASSEN_TOKEN }),
    registerUserAuth({ getIdToken: () => 'tok', getSessionId: () => 'sess', cashregisterId: 'kasse-1' }),
  ];
  for (const weg of wege) {
    const daten = await weg();
    assert.equal(typeof daten.headers['Authorization'], 'string');
    assert.match(daten.headers['Authorization'] ?? '', /^Bearer .+/);
    assert.equal(typeof daten.params, 'object');
  }
});
