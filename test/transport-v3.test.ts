import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTransport,
  createBinaryTransport,
  DEFAULT_BASE_URL,
  POS_BASE_URL,
  type FetchLike,
  type HttpRequestInit,
  type HttpResponseLike,
} from '../src/client/transport.js';
import {
  KasseneckApiError,
  KasseneckHttpError,
  KasseneckNetworkError,
  KasseneckValidationError,
  isOutcomeUnknown,
} from '../src/client/errors.js';
import { PUBLIC_CALLS, POS_CALLS } from '../src/client/aufrufe.js';
import { apiKeyAuth, registerUserAuth } from '../src/client/auth.js';
import { createKasseneckApi } from '../src/client/api.js';
import { pairRegisterDevice, listRegisterUsersForDevice } from '../src/register/index.js';
import { PACKAGE_VERSION } from '../src/version.js';
import { findErrorRule, messageText } from '../src/pos/texte.js';
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
  assert.equal(POS_BASE_URL, 'https://kasse.kasseneck.at/api/v3');
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

test('v3: posBaseUrl gilt fuer den Kassenweg, baseUrl fuer die oeffentlichen Aufrufe (Kassen-Benutzer)', async () => {
  const { holen, aufrufe } = aufzeichnen(() => erfolg({}));
  const rufen = createTransport({ auth: kassenBenutzer(), fetch: holen, posBaseUrl: '/api/v3/', baseUrl: 'https://proxy.example/v3/' });
  await rufen('createReceipt', {});
  await rufen('getKasseSettings', {});
  await rufen('downloadDailyReport', {});
  assert.deepEqual(aufrufe.map((a) => a.url), [
    '/api/v3/createReceipt',
    '/api/v3/getKasseSettings',
    'https://proxy.example/v3/downloadDailyReport',
  ]);
});

test('v3: mit api_key gehen die oeffentlichen Aufrufe an baseUrl, nur die reinen Kassenaufrufe an posBaseUrl', async () => {
  const { holen, aufrufe } = aufzeichnen(() => erfolg({}));
  const rufen = createTransport({ auth: schluessel(), fetch: holen, posBaseUrl: '/api/v3', baseUrl: 'https://proxy.example/v3' });
  await rufen('createReceipt', {});
  await rufen('getKasseSettings', {});
  assert.deepEqual(aufrufe.map((a) => a.url), ['https://proxy.example/v3/createReceipt', '/api/v3/getKasseSettings']);
});

test('v3: jede Basis muss auf /v3 enden, sonst wirft das Anlegen mit Hinweis auf die Behebung', () => {
  for (const [option, basis] of [
    ['baseUrl', '/api'],
    ['baseUrl', '/api/v1'],
    ['baseUrl', 'https://api.kasseneck.at/v1'],
    ['baseUrl', 'http://127.0.0.1:27182'],
    ['baseUrl', 'https://api.kasseneck.at/v3x'],
    ['posBaseUrl', '/api'],
    ['posBaseUrl', 'https://kasse.kasseneck.at/api'],
    ['posBaseUrl', ''],
  ] as const) {
    assert.throws(
      () => createTransport({ auth: schluessel(), [option]: basis }),
      (e: unknown) =>
        e instanceof KasseneckValidationError && e.scope === 'request' && e.reason.includes(option) && /\/v3/.test(e.reason),
      `${option}=${basis}`,
    );
  }
  for (const basis of ['/api/v3', '/api/v3/', '/v3', 'https://proxy.example/pfad/v3//', 'api/v3']) {
    assert.doesNotThrow(() => createTransport({ auth: schluessel(), baseUrl: basis, posBaseUrl: basis }), basis);
  }
});

test('v3: alle sechs oeffentlichen Aufrufe des Kassenwegs gehen mit registerUserAuth an den Kassenweg, mit api_key an die oeffentliche Basis', async () => {
  const beide = PUBLIC_CALLS.filter((name) => (POS_CALLS as readonly string[]).includes(name));
  assert.deepEqual([...beide].sort(), [
    'cancelReceipt', 'createReceipt', 'generateFullReceiptId', 'getReceipt', 'listMyTipRecipients', 'sendReceiptEmail',
  ]);
  const kasse = aufzeichnen(() => erfolg({}));
  const oeffentlich = aufzeichnen(() => erfolg({}));
  for (const name of beide) {
    await createTransport({ auth: kassenBenutzer(), fetch: kasse.holen })(name, {});
    await createTransport({ auth: schluessel(), fetch: oeffentlich.holen })(name, {});
  }
  assert.deepEqual(kasse.aufrufe.map((a) => a.url), beide.map((n) => `https://kasse.kasseneck.at/api/v3/${n}`));
  assert.deepEqual(oeffentlich.aufrufe.map((a) => a.url), beide.map((n) => `https://api.kasseneck.at/v3/${n}`));
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
    api.sellReceipt({ payments: [{ method: 'cash', amountCents: 320 }], items: [{ name: 'Kaffee', quantity: 1, vat: 20, priceCents: 320 }] }),
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
  for (const basis of [undefined, 'https://api.kasseneck.at/v3', 'https://kasse.kasseneck.at/api/v3', '/api/v3', '/v3/', 'api/v3', '/kasse/api/v3']) {
    const kopf = await kopfzeilenAn(basis);
    assert.equal(kopf['Kasseneck-Api-Version'], 'v3', String(basis));
    assert.equal(kopf['Kasseneck-Client'], KENNUNG, String(basis));
    assert.equal(kopf['Authorization'], 'Bearer kr_test_SCHLUESSEL', String(basis));
  }
});

test('v3: an jede fremde Basis gehen weder Kasseneck-Api-Version noch Kasseneck-Client', async () => {
  for (const basis of [
    'https://kasse.example.at/api/v3',
    'http://127.0.0.1:27182/v3',
    'http://127.0.0.1:5001/kasseneck/europe-west1/v3',
    'http://api.kasseneck.at/v3',
    'https://api.kasseneck.at.boese.example/v3',
    'https://api.kasseneck.at:8443/v3',
    'https://nutzer@api.kasseneck.at/v3',
    'https://boese.example/https://api.kasseneck.at/v3',
    '//boese.example/api/v3',
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
  await createTransport({ auth, fetch: holen, baseUrl: 'http://127.0.0.1:27182/v3' })('getReceipt', {});
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

// --- Ausgang (outcome) -------------------------------------------------------

test('v3: outcome unknown fuer dialect_mismatch und die Ausgang-unklar-Codes, sonst rejected', () => {
  const unklar = [
    new KasseneckApiError('createReceipt', 'x', {}, 'dialect_mismatch'),
    new KasseneckApiError('createReceipt', 'x', {}, 'receipt_outcome_unknown'),
    new KasseneckApiError('cancelReceipt', 'x', {}, 'cancellation_outcome_unknown'),
    new KasseneckApiError('createReceipt', 'x', { handled: true }, 'response_translation_failed'),
    new KasseneckApiError('createReceipt', 'x', { handled: null }, 'response_translation_failed'),
    new KasseneckApiError('createReceipt', 'x', {}, 'response_translation_failed'),
    new KasseneckApiError('createReceipt', 'x', { code: 'receipt_outcome_unknown' }),
  ];
  for (const e of unklar) {
    assert.equal(e.outcome, 'unknown', `${e.code} ${JSON.stringify(e.details)}`);
    assert.equal(isOutcomeUnknown(e), true);
  }
  const abgelehnt = [
    new KasseneckApiError('createReceipt', 'x', { handled: false }, 'response_translation_failed'),
    new KasseneckApiError('createReceipt', 'x', {}, 'route_missing'),
    new KasseneckApiError('createReceipt', 'x', {}, 'payments_sum_mismatch'),
    new KasseneckApiError('createReceipt', 'x', {}, 'not_found'),
    new KasseneckApiError('createReceipt', 'x'),
  ];
  for (const e of abgelehnt) {
    assert.equal(e.outcome, 'rejected', `${e.code} ${JSON.stringify(e.details)}`);
    assert.equal(isOutcomeUnknown(e), false);
  }
  assert.equal(isOutcomeUnknown(new Error('x')), false);
  assert.equal(isOutcomeUnknown(new KasseneckHttpError('createReceipt', 500, undefined, 'server-error')), false);
  assert.equal(isOutcomeUnknown(new KasseneckHttpError('createReceipt', 500, undefined, 'server-error', 'unknown')), true);
});

test('v3: dialect_mismatch vom Transport traegt outcome unknown, route_missing rejected', async () => {
  const ohne = erfolg({}, { kennzeichen: null });
  const e1 = await fehler(createTransport({ auth: schluessel(), fetch: async () => ohne })('createReceipt', {}));
  assert.equal((e1 as KasseneckApiError).outcome, 'unknown');
  const html = antwort('<html>', { kennzeichen: null, contentType: 'text/html' });
  const e2 = await fehler(createTransport({ auth: schluessel(), fetch: async () => html })('createReceipt', {}));
  assert.equal((e2 as KasseneckApiError).outcome, 'rejected');
});

test('v3: Fehlerhuelle mit Code aus der Antwort bekommt ihren outcome (receipt_outcome_unknown, handled:false)', async () => {
  const unklar = antwort(JSON.stringify({ status: 'error', message: 'Ausgang unklar', code: 'receipt_outcome_unknown' }));
  const e1 = await fehler(createTransport({ auth: schluessel(), fetch: async () => unklar })('createReceipt', {}));
  assert.equal((e1 as KasseneckApiError).outcome, 'unknown');
  const abgelehnt = antwort(JSON.stringify({ status: 'error', message: 'x', code: 'response_translation_failed', data: { handled: false } }));
  const e2 = await fehler(createTransport({ auth: schluessel(), fetch: async () => abgelehnt })('createReceipt', {}));
  assert.equal((e2 as KasseneckApiError).code, 'response_translation_failed');
  assert.equal((e2 as KasseneckApiError).outcome, 'rejected');
});

test('v3: Netzfehler oder Zeitlimit nach dem Senden: signierende Aufrufe unknown, uebrige rejected', async () => {
  const netzWeg: FetchLike = async () => {
    throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
  };
  for (const [name, erwartet] of [
    ['createReceipt', 'unknown'],
    ['cancelReceipt', 'unknown'],
    ['financeWebService', 'unknown'],
    ['getReceipt', 'rejected'],
    ['sendReceiptEmail', 'rejected'],
  ] as const) {
    const e = await fehler(createTransport({ auth: schluessel(), fetch: netzWeg })(name, {}));
    assert.ok(e instanceof KasseneckNetworkError, name);
    assert.equal(e.outcome, erwartet, name);
    assert.equal(isOutcomeUnknown(e), erwartet === 'unknown', name);
  }
  // financeWebService mit Vorgang: der Fehlername traegt ihn, der Ausgang bleibt unklar.
  const fws = await fehler(createTransport({ auth: schluessel(), fetch: netzWeg })('financeWebService', {}, { method: 'status_cashbox' }));
  assert.equal((fws as KasseneckNetworkError).functionName, 'financeWebService/status_cashbox');
  assert.equal((fws as KasseneckNetworkError).outcome, 'unknown');

  // Zeitlimit beim Lesen des Rumpfs (Anfrage war laengst unterwegs).
  const haengt: FetchLike = async () => ({
    status: 200,
    headers: { get: (n: string) => (n.toLowerCase() === 'kasseneck-api-version' ? 'v3' : 'application/json') },
    text: () => new Promise<string>(() => {}),
    arrayBuffer: () => new Promise<ArrayBuffer>(() => {}),
  });
  const zeit = await fehler(createTransport({ auth: schluessel(), fetch: haengt, timeoutMs: 30 })('createReceipt', {}));
  assert.ok(zeit instanceof KasseneckNetworkError && zeit.timedOut);
  assert.equal(zeit.outcome, 'unknown');

  // Zeitlimit schon in der Anmeldung: nichts gesendet, rejected.
  const langsam = () => new Promise<never>(() => {});
  const vorher = await fehler(createTransport({ auth: langsam, fetch: haengt, timeoutMs: 30 })('createReceipt', {}));
  assert.ok(vorher instanceof KasseneckNetworkError && vorher.timedOut);
  assert.equal(vorher.outcome, 'rejected');
});

// --- 404 des /v3-Rands -------------------------------------------------------

test('v3: HTTP 404 mit Kennzeichen und Code wird KasseneckApiError mit diesem Code (not_found)', async () => {
  const a = antwort(JSON.stringify({ status: 'error', message: 'Endpunkt unbekannt', code: 'not_found' }), { status: 404 });
  const e = await fehler(createTransport({ auth: schluessel(), fetch: async () => a })('getReceipt', {}));
  assert.ok(e instanceof KasseneckApiError, String(e));
  assert.equal(e.code, 'not_found');
  assert.equal(e.outcome, 'rejected');
  // Auch auf dem Binaerweg.
  const b = antwort(JSON.stringify({ status: 'error', message: 'Endpunkt unbekannt', code: 'not_found' }), { status: 404 });
  const eb = await fehler(createBinaryTransport({ auth: schluessel(), fetch: async () => b })('downloadReport', {}));
  assert.equal((eb as KasseneckApiError).code, 'not_found');
});

test('v3: HTTP 404 ohne Kennzeichen, ohne Code oder ohne Huelle bleibt HTTP-Fehler, ohne Kennzeichen ungelesen', async () => {
  const ohne = antwort(JSON.stringify({ status: 'error', message: 'x', code: 'not_found' }), { status: 404, kennzeichen: null });
  const e1 = await fehler(createTransport({ auth: schluessel(), fetch: async () => ohne })('getReceipt', {}));
  assert.ok(e1 instanceof KasseneckHttpError && e1.statusCode === 404 && e1.reason === 'server-error');
  assert.equal(ohne.gelesen, 0);
  for (const rumpf of [JSON.stringify({ status: 'error', message: 'x' }), '<html>404</html>', '']) {
    const a = antwort(rumpf, { status: 404 });
    const e = await fehler(createTransport({ auth: schluessel(), fetch: async () => a })('getReceipt', {}));
    assert.ok(e instanceof KasseneckHttpError && e.statusCode === 404, rumpf);
  }
  // Andere Status mit Kennzeichen bleiben HTTP-Fehler (kein Lesen).
  const f500 = antwort(JSON.stringify({ status: 'error', message: 'x', code: 'internal' }), { status: 500 });
  const e5 = await fehler(createTransport({ auth: schluessel(), fetch: async () => f500 })('getReceipt', {}));
  assert.ok(e5 instanceof KasseneckHttpError && e5.statusCode === 500);
  assert.equal(f500.gelesen, 0);
});

test('v3: HTTP 5xx auf signierenden Aufrufen ist outcome unknown, 4xx und andere Aufrufe rejected', async () => {
  const faelle: [string, number, 'unknown' | 'rejected'][] = [
    ['createReceipt', 500, 'unknown'],
    ['createReceipt', 502, 'unknown'],
    ['cancelReceipt', 503, 'unknown'],
    ['financeWebService', 504, 'unknown'],
    ['createReceipt', 404, 'rejected'],
    ['createReceipt', 429, 'rejected'],
    ['cancelReceipt', 400, 'rejected'],
    ['getReceipt', 500, 'rejected'],
    ['sendReceiptEmail', 503, 'rejected'],
  ];
  for (const [name, status, erwartet] of faelle) {
    for (const kennzeichen of ['v3', null]) {
      const a = antwort('<html>fehler</html>', { status, kennzeichen, contentType: 'text/html' });
      const e = await fehler(createTransport({ auth: schluessel(), fetch: async () => a })(name, {}));
      assert.ok(e instanceof KasseneckHttpError, `${name} ${status}`);
      assert.equal(e.statusCode, status);
      assert.equal(e.outcome, erwartet, `${name} ${status} ${kennzeichen}`);
      assert.equal(isOutcomeUnknown(e), erwartet === 'unknown', `${name} ${status}`);
    }
  }
  // Mit Vorgang im Fehlernamen bleibt financeWebService signierend.
  const a = antwort('', { status: 502, kennzeichen: null });
  const e = await fehler(createTransport({ auth: schluessel(), fetch: async () => a })('financeWebService', {}, { method: 'status_cashbox' }));
  assert.equal((e as KasseneckHttpError).outcome, 'unknown');
});

test('v3: HTTP 200 mit Kennzeichen, aber unlesbarem Rumpf: signierende Aufrufe unknown, uebrige rejected', async () => {
  const rumpfe: [string, string][] = [
    ['', 'empty-body'],
    ['   ', 'empty-body'],
    ['{"status":"succ', 'not-json'],
    ['<kein json>', 'not-json'],
    [JSON.stringify({ data: { receipt: {} } }), 'missing-status'],
    ['[]', 'missing-status'],
  ];
  const aufrufe: [string, 'unknown' | 'rejected', { method: string } | undefined][] = [
    ['createReceipt', 'unknown', undefined],
    ['cancelReceipt', 'unknown', undefined],
    ['financeWebService', 'unknown', { method: 'status_cashbox' }],
    ['getReceipt', 'rejected', undefined],
    ['sendReceiptEmail', 'rejected', undefined],
    ['issueInvoice', 'rejected', undefined],
  ];
  for (const [rumpf, grund] of rumpfe) {
    for (const [name, erwartet, zusatz] of aufrufe) {
      const a = antwort(rumpf);
      const e = await fehler(createTransport({ auth: schluessel(), fetch: async () => a })(name, {}, zusatz));
      assert.ok(e instanceof KasseneckHttpError, `${name} ${JSON.stringify(rumpf)}: ${String(e)}`);
      assert.equal(e.statusCode, 200);
      assert.equal(e.reason, grund, `${name} ${JSON.stringify(rumpf)}`);
      assert.equal(e.outcome, erwartet, `${name} ${JSON.stringify(rumpf)}`);
      assert.equal(isOutcomeUnknown(e), erwartet === 'unknown');
    }
  }
  // Auch mit dem Kassen-Benutzer (Kassenweg, Kanal app) bleibt es unklar.
  const leer = antwort('');
  const ek = await fehler(createTransport({ auth: kassenBenutzer(), fetch: async () => leer })('createReceipt', {}));
  assert.equal((ek as KasseneckHttpError).outcome, 'unknown');
});

test('v3: HTTP 200 ohne Kennzeichen bleibt dialect_mismatch, der Rumpf wird nicht gelesen', async () => {
  const a = antwort('', { kennzeichen: null });
  const e = await fehler(createTransport({ auth: schluessel(), fetch: async () => a })('createReceipt', {}));
  assert.equal((e as KasseneckApiError).code, 'dialect_mismatch');
  assert.equal(a.gelesen, 0);
});

test('v3: HTTP 200 mit Kennzeichen und text/html: signierende Aufrufe unknown, ohne Kennzeichen route_missing rejected', async () => {
  for (const name of ['createReceipt', 'cancelReceipt', 'financeWebService']) {
    for (const auth of [schluessel(), kassenBenutzer()]) {
      const mit = antwort('<html>umgeschrieben</html>', { contentType: 'text/html; charset=utf-8' });
      const e = await fehler(createTransport({ auth, fetch: async () => mit })(name, {}));
      assert.ok(e instanceof KasseneckHttpError, `${name}: ${String(e)}`);
      assert.equal(e.reason, 'not-json', name);
      assert.equal(e.outcome, 'unknown', name);
      assert.ok(isOutcomeUnknown(e), name);
      assert.equal(mit.gelesen, 0, `${name}: Rumpf ungelesen`);

      const ohne = antwort('<html>SPA</html>', { kennzeichen: null, contentType: 'text/html' });
      const e2 = await fehler(createTransport({ auth, fetch: async () => ohne })(name, {}));
      assert.ok(e2 instanceof KasseneckApiError, name);
      assert.equal(e2.code, 'route_missing', name);
      assert.equal(e2.outcome, 'rejected', name);
    }
  }
  // Nicht signierende Aufrufe bleiben auch mit Kennzeichen route_missing.
  const mit = antwort('<html></html>', { contentType: 'text/html' });
  const e3 = await fehler(createTransport({ auth: schluessel(), fetch: async () => mit })('getReceipt', {}));
  assert.equal((e3 as KasseneckApiError).code, 'route_missing');
  assert.equal((e3 as KasseneckApiError).outcome, 'rejected');
});

test('v3: route_missing und dialect_mismatch zeigen dem Kassier einen Menschentext, der technische Satz bleibt in message', async () => {
  const html = antwort('<!doctype html>', { kennzeichen: null, contentType: 'text/html' });
  const ohne = erfolg({}, { kennzeichen: null });
  const faelle = [
    { a: html, code: 'route_missing', technisch: /Route fehlt/, schirm: 'server.connection_disturbed' },
    { a: ohne, code: 'dialect_mismatch', technisch: /spricht nicht \/v3/, schirm: 'server.response_unreadable' },
  ] as const;
  for (const f of faelle) {
    const e = await fehler(createTransport({ auth: schluessel(), fetch: async () => f.a })('getReceipt', {}));
    assert.ok(e instanceof KasseneckApiError, f.code);
    assert.equal(e.code, f.code);
    assert.match(e.message, f.technisch, f.code);
    const regel = findErrorRule('api', e.code);
    assert.ok('key' in regel && regel.key === f.schirm, f.code);
    assert.doesNotMatch(messageText(regel.key), f.technisch, f.code);
  }
});
