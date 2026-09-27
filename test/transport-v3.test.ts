import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTransport,
  createBinaryTransport,
  DEFAULT_BASE_URL,
  KASSE_BASE_URL,
  type FetchLike,
  type HttpRequestInit,
  type HttpResponseLike,
} from '../src/client/transport.js';
import { KasseneckApiError, KasseneckValidationError } from '../src/client/errors.js';
import { apiKeyAuth, registerUserAuth } from '../src/client/auth.js';
import { createKasseneckApi } from '../src/client/api.js';
import { pairRegisterDevice, listRegisterUsersForDevice } from '../src/register/index.js';
import { PACKAGE_VERSION } from '../src/version.js';
import { createHpsConnectClient } from '../src/payments/hobex-hps/index.js';
import { eposDirectStatus } from '../src/receipt/epos.js';

/*
 * Transport der 1.x-Linie: nur `/v3`, fail closed am Kennzeichen
 * `Kasseneck-Api-Version: v3` (Nachtrag §5.4, Risiko R1), Kopfzeilen
 * `Kasseneck-Api-Version` und `Kasseneck-Client` nur an Kasseneck-Basen
 * (Nachtrag §6, Risiko R3).
 */

const paket = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };

interface Mitschrift {
  url: string;
  init: HttpRequestInit;
}

interface Attrappe extends HttpResponseLike {
  /** Wie oft der Rumpf gelesen wurde (text oder arrayBuffer). */
  gelesen: number;
}

function antwort(
  rumpf: string,
  { kennzeichen = 'v3' as string | null, contentType = 'application/json' as string | null, status = 200 } = {},
): Attrappe {
  const a: Attrappe = {
    status,
    gelesen: 0,
    headers: {
      get: (name: string) => {
        const n = name.toLowerCase();
        if (n === 'content-type') return contentType;
        if (n === 'kasseneck-api-version') return kennzeichen;
        return null;
      },
    },
    text: async () => {
      a.gelesen += 1;
      return rumpf;
    },
    arrayBuffer: async () => {
      a.gelesen += 1;
      return new TextEncoder().encode(rumpf).buffer as ArrayBuffer;
    },
  };
  return a;
}

const erfolg = (daten: unknown, o?: Parameters<typeof antwort>[1]) =>
  antwort(JSON.stringify({ status: 'success', message: '', data: daten }), o);

function aufzeichnen(liefere: () => HttpResponseLike): { holen: FetchLike; aufrufe: Mitschrift[] } {
  const aufrufe: Mitschrift[] = [];
  return {
    aufrufe,
    holen: async (url, init) => {
      aufrufe.push({ url, init });
      return liefere();
    },
  };
}

const schluessel = () => apiKeyAuth({ apiKey: 'kr_test_SCHLUESSEL', cashregisterToken: 'cb_test_TOKEN' });
const kassenBenutzer = () =>
  registerUserAuth({ getIdToken: () => 'eyJ-TOKEN', getSessionId: () => 'sess-1', cashregisterId: 'kasse-1' });

async function fehler(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  assert.fail('kein Fehler geworfen');
}

// --- Basen -----------------------------------------------------------------

test('v3: Vorgabe-Basen sind api.kasseneck.at/v3 (oeffentlich) und kasse.kasseneck.at/api/v3 (Kasse)', () => {
  assert.equal(DEFAULT_BASE_URL, 'https://api.kasseneck.at/v3');
  assert.equal(KASSE_BASE_URL, 'https://kasse.kasseneck.at/api/v3');
});

test('v3: PACKAGE_VERSION ist die Version aus package.json', () => {
  assert.equal(PACKAGE_VERSION, paket.version);
});

test('v3: oeffentlicher Aufruf mit api_key geht an api.kasseneck.at/v3', async () => {
  const { holen, aufrufe } = aufzeichnen(() => erfolg({}));
  await createTransport({ auth: schluessel(), fetch: holen })('createReceipt', {});
  assert.equal(aufrufe[0]!.url, 'https://api.kasseneck.at/v3/createReceipt');
});

test('v3: reiner Kassenaufruf geht ohne eigene Basis an kasse.kasseneck.at/api/v3', async () => {
  const { holen, aufrufe } = aufzeichnen(() => erfolg({}));
  await createTransport({ auth: schluessel(), fetch: holen })('getKasseSettings', {});
  assert.equal(aufrufe[0]!.url, 'https://kasse.kasseneck.at/api/v3/getKasseSettings');
});

test('v3: der Kassen-Benutzer ruft auch die oeffentlichen Belegaufrufe ueber den Kassenweg (Kanal app)', async () => {
  const { holen, aufrufe } = aufzeichnen(() => erfolg({}));
  const rufen = createTransport({ auth: kassenBenutzer(), fetch: holen });
  await rufen('createReceipt', {});
  await rufen('getReceipt', {});
  await rufen('listMyReceipts', {});
  assert.deepEqual(aufrufe.map((a) => a.url), [
    'https://kasse.kasseneck.at/api/v3/createReceipt',
    'https://kasse.kasseneck.at/api/v3/getReceipt',
    'https://kasse.kasseneck.at/api/v3/listMyReceipts',
  ]);
});

test('v3: was der Kassenweg nicht fuehrt, geht auch fuer den Kassen-Benutzer an die oeffentliche Basis', async () => {
  const { holen, aufrufe } = aufzeichnen(() => erfolg({}));
  const rufen = createTransport({ auth: kassenBenutzer(), fetch: holen });
  await rufen('downloadDailyReport', {});
  await rufen('hobexPayApi', {});
  assert.deepEqual(aufrufe.map((a) => a.url), [
    'https://api.kasseneck.at/v3/downloadDailyReport',
    'https://api.kasseneck.at/v3/hobexPayApi',
  ]);
});

test('v3: eine eigene Basis gilt fuer jeden Aufruf (Web-Kasse: gleicher Ursprung /api/v3)', async () => {
  const { holen, aufrufe } = aufzeichnen(() => erfolg({}));
  const rufen = createTransport({ auth: kassenBenutzer(), fetch: holen, baseUrl: '/api/v3/' });
  await rufen('createReceipt', {});
  await rufen('getKasseSettings', {});
  assert.deepEqual(aufrufe.map((a) => a.url), ['/api/v3/createReceipt', '/api/v3/getKasseSettings']);
});

test('v3: Kopplung und Benutzerliste gehen ohne Angabe an kasse.kasseneck.at/api/v3', async () => {
  const { holen, aufrufe } = aufzeichnen(() => erfolg({}));
  await fehler(pairRegisterDevice({ code: 'EXMPABCD', fetch: holen }));
  await fehler(listRegisterUsersForDevice({ ownerUid: 'u1', deviceId: 'd1', deviceSecret: 'EXAMPLEgeheim', fetch: holen }));
  assert.deepEqual(aufrufe.map((a) => a.url), [
    'https://kasse.kasseneck.at/api/v3/pairRegisterDevice',
    'https://kasse.kasseneck.at/api/v3/listRegisterUsersForDevice',
  ]);
});

// --- Kennzeichen: fail closed (R1) -----------------------------------------

test('v3: Antwort ohne Kennzeichen wirft dialect_mismatch und liest den Rumpf nicht', async () => {
  const ohne = erfolg({ receiptId: 'r1' }, { kennzeichen: null });
  const e = await fehler(createTransport({ auth: schluessel(), fetch: async () => ohne })('createReceipt', {}));
  assert.ok(e instanceof KasseneckApiError, String(e));
  assert.equal(e.code, 'dialect_mismatch');
  assert.equal(e.functionName, 'createReceipt');
  assert.equal(ohne.gelesen, 0, 'der Rumpf wurde gelesen');
});

test('v3: auch eine Fehlerhuelle ohne Kennzeichen ist dialect_mismatch, nicht ihr eigener Fehler', async () => {
  const ohne = antwort(JSON.stringify({ status: 'error', message: 'Kasse gesperrt', code: 'irgendwas' }), { kennzeichen: null });
  const e = await fehler(createTransport({ auth: schluessel(), fetch: async () => ohne })('createReceipt', {}));
  assert.ok(e instanceof KasseneckApiError);
  assert.equal(e.code, 'dialect_mismatch');
  assert.equal(ohne.gelesen, 0);
});

test('v3: ein anderes Kennzeichen (v1, leer) ist ebenfalls dialect_mismatch', async () => {
  for (const kennzeichen of ['v1', '', 'v3x', 'intern']) {
    const a = erfolg({}, { kennzeichen });
    const e = await fehler(createTransport({ auth: schluessel(), fetch: async () => a })('getReceipt', {}));
    assert.ok(e instanceof KasseneckApiError, kennzeichen);
    assert.equal(e.code, 'dialect_mismatch', kennzeichen);
    assert.equal(a.gelesen, 0, kennzeichen);
  }
});

test('v3: das Kennzeichen wird ohne Ruecksicht auf Gross-/Kleinschreibung und Rand gelesen', async () => {
  for (const kennzeichen of ['v3', 'V3', ' v3 ']) {
    const a = erfolg({ ok: kennzeichen }, { kennzeichen });
    assert.deepEqual(await createTransport({ auth: schluessel(), fetch: async () => a })('getReceipt', {}), { ok: kennzeichen });
  }
});

test('v3: der Binaerweg prueft das Kennzeichen ebenso, bevor er Bytes liest', async () => {
  const pdf = antwort('%PDF-1.7 ...', { kennzeichen: null, contentType: 'application/pdf' });
  const e = await fehler(createBinaryTransport({ auth: schluessel(), fetch: async () => pdf })('downloadReport', {}));
  assert.ok(e instanceof KasseneckApiError);
  assert.equal(e.code, 'dialect_mismatch');
  assert.equal(pdf.gelesen, 0);

  const mit = antwort('%PDF-1.7 ...', { contentType: 'application/pdf' });
  const bytes = await createBinaryTransport({ auth: schluessel(), fetch: async () => mit })('downloadReport', {});
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), '%PDF');
});

test('v3: HTML-Antwort (Route fehlt, SPA-Auffangregel) ist route_missing, ohne den Rumpf zu lesen', async () => {
  for (const contentType of ['text/html', 'text/html; charset=utf-8', 'TEXT/HTML']) {
    const html = antwort('<!doctype html><html></html>', { kennzeichen: null, contentType });
    const e = await fehler(createTransport({ auth: kassenBenutzer(), fetch: async () => html })('createReceipt', {}));
    assert.ok(e instanceof KasseneckApiError, contentType);
    assert.equal(e.code, 'route_missing', contentType);
    assert.equal(html.gelesen, 0, contentType);
  }
  const html = antwort('<!doctype html>', { kennzeichen: null, contentType: 'text/html' });
  const e = await fehler(createBinaryTransport({ auth: schluessel(), fetch: async () => html })('downloadReport', {}));
  assert.ok(e instanceof KasseneckApiError);
  assert.equal(e.code, 'route_missing');
});

test('v3: sellReceipt ohne Kennzeichen bricht ab: ein Aufruf, keine Wiederholung, keine Folgeaufrufe', async () => {
  const { holen, aufrufe } = aufzeichnen(() => erfolg({ receiptId: 'r1', sig: 'x' }, { kennzeichen: null }));
  const api = createKasseneckApi({ auth: kassenBenutzer(), fetch: holen });
  const e = await fehler(
    // Form der 0.x-Linie; der Draht der Belege wird in einer spaeteren Aufgabe englisch.
    api.sellReceipt({ paymentMethod: 'cash', items: [{ name: 'Kaffee', quantity: 1, vat: 20, priceCents: 320 }] } as never),
  );
  assert.ok(e instanceof KasseneckApiError, String(e));
  assert.equal(e.code, 'dialect_mismatch');
  assert.equal(aufrufe.length, 1, 'kein zweiter Aufruf nach dialect_mismatch');
  assert.match(aufrufe[0]!.url, /\/createReceipt$/);
});

// --- Kopfzeilen nur an Kasseneck-Basen (R3) --------------------------------

const KENNUNG = `kasseneck-api/${paket.version}`;

async function kopfzeilenAn(baseUrl: string | undefined, extra: Record<string, unknown> = {}): Promise<Record<string, string>> {
  const { holen, aufrufe } = aufzeichnen(() => erfolg({}));
  await createTransport({ auth: schluessel(), fetch: holen, ...(baseUrl === undefined ? {} : { baseUrl }), ...extra })('getReceipt', {});
  return aufrufe[0]!.init.headers;
}

test('v3: an Kasseneck-Basen gehen Kasseneck-Api-Version und Kasseneck-Client mit', async () => {
  for (const basis of [undefined, 'https://api.kasseneck.at/v3', 'https://kasse.kasseneck.at/api/v3', '/api/v3', '/v3/']) {
    const kopf = await kopfzeilenAn(basis);
    assert.equal(kopf['Kasseneck-Api-Version'], 'v3', String(basis));
    assert.equal(kopf['Kasseneck-Client'], KENNUNG, String(basis));
    assert.equal(kopf['Authorization'], 'Bearer kr_test_SCHLUESSEL', String(basis));
  }
});

test('v3: an jede fremde Basis gehen weder Kasseneck-Api-Version noch Kasseneck-Client', async () => {
  for (const basis of [
    'https://kasse.example.at/api/v3',
    'http://127.0.0.1:27182',
    'http://127.0.0.1:5001/kasseneck/europe-west1',
    'http://api.kasseneck.at/v3',
    'https://api.kasseneck.at.boese.example/v3',
    'https://api.kasseneck.at:8443/v3',
    'https://boese.example/https://api.kasseneck.at/v3',
    '//boese.example/api/v3',
    '/api',
    '/api/v1',
    'api/v3',
  ]) {
    const kopf = await kopfzeilenAn(basis);
    const namen = Object.keys(kopf).map((n) => n.toLowerCase());
    assert.ok(!namen.includes('kasseneck-api-version'), `${basis}: Kasseneck-Api-Version gesendet`);
    assert.ok(!namen.includes('kasseneck-client'), `${basis}: Kasseneck-Client gesendet`);
  }
});

test('v3: auch ohne Kopfzeilen (fremde Basis) bleibt die Antwortpruefung scharf', async () => {
  const ohne = erfolg({}, { kennzeichen: null });
  const e = await fehler(
    createTransport({ auth: schluessel(), fetch: async () => ohne, baseUrl: 'https://proxy.example/v3' })('getReceipt', {}),
  );
  assert.ok(e instanceof KasseneckApiError);
  assert.equal(e.code, 'dialect_mismatch');
});

test('v3: eigene App-Kennung ersetzt kasseneck-api/<version>, nur aus der Positivliste', async () => {
  for (const client of ['kasse-web/0.6.46+3120', 'kasse-app/1.0.3-34', 'kasseneck_api/10.0.0', 'kasseneck-api/1.0.0']) {
    assert.equal((await kopfzeilenAn(undefined, { clientHeader: client }))['Kasseneck-Client'], client);
  }
  for (const client of ['fremd/1.0', 'kasse-web', 'kasse-web/', 'kasse-web/1 0', 'kasse-web/1.0\r\nX: y', `kasse-web/${'1'.repeat(41)}`, 'kasse-web/1/2', '']) {
    assert.throws(
      () => createTransport({ auth: schluessel(), clientHeader: client }),
      (e: unknown) => e instanceof KasseneckValidationError && e.scope === 'request',
      JSON.stringify(client),
    );
  }
});

test('v3: omitKasseneckHeaders laesst beide Kopfzeilen weg (Browser, fremder Ursprung), prueft aber weiter', async () => {
  const kopf = await kopfzeilenAn(undefined, { omitKasseneckHeaders: true });
  const namen = Object.keys(kopf).map((n) => n.toLowerCase());
  assert.ok(!namen.includes('kasseneck-api-version'));
  assert.ok(!namen.includes('kasseneck-client'));

  const ohne = erfolg({}, { kennzeichen: null });
  const e = await fehler(createTransport({ auth: schluessel(), fetch: async () => ohne, omitKasseneckHeaders: true })('getReceipt', {}));
  assert.equal((e as KasseneckApiError).code, 'dialect_mismatch');
});

test('v3: die Anmeldung kann die Kasseneck-Kopfzeilen weder ueberschreiben noch an eine fremde Basis bringen', async () => {
  const { holen, aufrufe } = aufzeichnen(() => erfolg({}));
  const auth = () => ({
    headers: { Authorization: 'Bearer x', 'kasseneck-api-version': 'v1', 'KASSENECK-CLIENT': 'fremd/1' },
    params: {},
  });
  await createTransport({ auth, fetch: holen })('getReceipt', {});
  await createTransport({ auth, fetch: holen, baseUrl: 'http://127.0.0.1:27182' })('getReceipt', {});
  const [kasseneck, fremd] = aufrufe.map((a) => a.init.headers);
  const kasseneckNamen = Object.keys(kasseneck!).filter((n) => n.toLowerCase().startsWith('kasseneck-'));
  assert.deepEqual(kasseneckNamen.sort(), ['Kasseneck-Api-Version', 'Kasseneck-Client']);
  assert.equal(kasseneck!['Kasseneck-Api-Version'], 'v3');
  assert.equal(kasseneck!['Kasseneck-Client'], KENNUNG);
  assert.deepEqual(Object.keys(fremd!).filter((n) => n.toLowerCase().startsWith('kasseneck-')), []);
  assert.equal(fremd!['Authorization'], 'Bearer x');
});

test('v3 (R3): Connect-, ePOS- und Terminalaufrufe mit derselben fetch-Umsetzung tragen keine Kasseneck-Kopfzeile', async () => {
  const aufrufe: Mitschrift[] = [];
  const geteilt = async (url: string, init: HttpRequestInit) => {
    aufrufe.push({ url, init });
    return erfolg({});
  };
  // Kasseneck-Aufruf ueber dieselbe Umsetzung: der traegt sie.
  await createTransport({ auth: kassenBenutzer(), fetch: geteilt })('getKasseSettings', {});
  // Connect (Kartenterminal ueber den lokalen Agenten).
  const connect = createHpsConnectClient({ token: 'connect-token', fetch: geteilt as never });
  await connect.diagnosis({ host: '192.168.0.50', tid: '123' }).catch(() => undefined);
  // ePOS direkt an den Drucker.
  await eposDirectStatus({ ip: '192.168.0.60' }, geteilt as never).catch(() => undefined);

  assert.equal(aufrufe.length, 3);
  assert.equal(aufrufe[0]!.init.headers['Kasseneck-Api-Version'], 'v3');
  for (const aufruf of aufrufe.slice(1)) {
    const namen = Object.keys(aufruf.init.headers).map((n) => n.toLowerCase());
    assert.ok(!namen.some((n) => n.startsWith('kasseneck-')), `${aufruf.url}: ${namen.join(',')}`);
  }
});
