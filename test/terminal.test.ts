import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createKasseneckApi } from '../src/client/api.js';
import { ALL_CALLS, CALLS_WITHOUT_EFFECT, POS_CALLS, PUBLIC_CALLS, isPosOnlyCall, isUnknownOutcomeCall } from '../src/client/aufrufe.js';
import { apiKeyAuth } from '../src/client/auth.js';
import {
  KasseneckValidationError,
  isKasseneckApiError,
  isKasseneckNetworkError,
  isKasseneckValidationError,
  isOutcomeUnknown,
} from '../src/client/errors.js';
import {
  TERMINAL_CODE_SOURCES,
  TERMINAL_CODE_STATUSES,
  TERMINAL_ERROR_CODES,
  TERMINAL_PLATFORMS,
  TERMINAL_SETUP_STATES,
  type TerminalAccess,
  type TerminalErrorCode,
} from '../src/client/terminal.js';
import type { FetchLike, HttpRequestInit, HttpResponseLike } from '../src/client/transport.js';
import { inventoryKeyAuth } from '../src/inventory/auth.js';
import * as wurzel from '../src/index.js';

/*
 * Kartenterminal am Handy (registerTerminalDevice, getTerminalAccess,
 * claimTerminal, requestTerminalCode, getTerminalCode, reportTerminalLogin,
 * reportTerminalReady) mit einer Attrappe des Servers. Die Antwortformen
 * stammen aus dem Backend (genius-daten.js, genius-core.js); Betrieb, Konto,
 * TIDs, Code und Geraete-Ausweis sind erfunden.
 */

type Json = Record<string, any>;

/** Vertrags-Export des Backends (`fixtures/v3/v3-vokabular.json`, scripts/v3-vertrag-holen.mjs). */
const VOKABULAR = JSON.parse(readFileSync(new URL('../../fixtures/v3/v3-vokabular.json', import.meta.url), 'utf8')) as Json;

const NAMEN = ['registerTerminalDevice', 'getTerminalAccess', 'claimTerminal', 'requestTerminalCode', 'getTerminalCode', 'reportTerminalLogin', 'reportTerminalReady'];

const API_KEY = 'kr_live_Beispielschluessel0123456789';
const GERAET = 'Q7fK2mXp9LcR4tVw8NbZ';
const GEHEIM = 'EXAMPLEa1b2c3d4AAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const AUSWEIS = { deviceId: GERAET, deviceSecret: GEHEIM };
const PASSWORT = 'Beispiel-Passwort-7xQ';
const CODE = 'Xk7pQ2';

function huelle(rumpf: Json): HttpResponseLike {
  const text = JSON.stringify(rumpf);
  return {
    status: 200,
    headers: { get: (name: string) => ({ 'content-type': 'application/json', 'kasseneck-api-version': 'v3' } as Record<string, string>)[name.toLowerCase()] ?? null },
    text: async () => text,
    arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer,
  };
}

const erfolg = (data: Json): Json => ({ status: 'success', message: '', data });

interface Aufruf {
  url: string;
  params: Json;
  headers: Record<string, string>;
}

/** Attrappe: Antworten je Aufruf der Reihe nach; eine Error-Instanz wird geworfen (Netzfehler). */
function server(antworten: Array<Json | Error>, auth = apiKeyAuth({ apiKey: API_KEY, cashregisterToken: 'cb_live_EXAMPLE00000000' })) {
  const aufrufe: Aufruf[] = [];
  const holen: FetchLike = async (url: string, init: HttpRequestInit) => {
    aufrufe.push({ url, params: (JSON.parse(init.body) as { params: Json }).params, headers: init.headers });
    const roh = antworten[aufrufe.length - 1];
    if (!roh) throw new Error(`unerwarteter Aufruf Nr. ${aufrufe.length}`);
    if (roh instanceof Error) throw roh;
    return huelle(roh);
  };
  return { api: createKasseneckApi({ auth, fetch: holen }), aufrufe };
}

/** Zugang in der Form von `genius-daten.zugangHolen` (Konto livia@melisse-nails.example, TID 12345678). */
function zugang(extra: Json = {}): Json {
  return {
    available: true,
    username: 'livia@melisse-nails.example',
    password: PASSWORT,
    terminalId: '12345678',
    terminalName: 'Melisse Nails Studio',
    accountId: 'melisse',
    autoCode: true,
    codeFormat: { length: 6, labels: ['Autorisierungscode', 'Authorization code'] },
    setup: { state: 'assigned', since: '2026-11-07T08:00:00.000Z' },
    updatedAt: '2026-11-06T10:00:00.000Z',
    ...extra,
  };
}

/** Prueft, dass ein Fehler weder Geheimnis noch Passwort noch Code nennt (Meldung, Details, JSON). */
function ohneGeheimnis(e: unknown): void {
  const text = `${(e as Error).message} ${JSON.stringify(e)} ${JSON.stringify((e as { details?: unknown }).details ?? null)}`;
  for (const geheim of [GEHEIM, PASSWORT, CODE]) assert.equal(text.includes(geheim), false, 'Fehler nennt ein Geheimnis');
}

// ---- Einordnung ------------------------------------------------------------------------------

test('Kartenterminal: sieben oeffentliche Aufrufe nur unter /v3, nicht am Kassenweg', () => {
  for (const n of NAMEN) {
    assert.ok((PUBLIC_CALLS as readonly string[]).includes(n), n);
    assert.ok((ALL_CALLS as readonly string[]).includes(n), n);
    assert.equal((POS_CALLS as readonly string[]).includes(n), false, `${n} gibt es am Kassenweg noch nicht`);
    assert.equal(isPosOnlyCall(n), false, `${n} geht an die oeffentliche Basis`);
    assert.ok(VOKABULAR.schemas[n], `${n}: kein Schema im Vertrag`);
  }
  // In Vertragsreihenfolge am Ende der oeffentlichen Liste.
  assert.deepEqual(PUBLIC_CALLS.slice(-7), NAMEN);
});

test('Kartenterminal: Ausgang nach Zeitlimit – nur Geraet anmelden und Code holen haben Wirkung, der Rest ist wiederholbar', () => {
  for (const n of ['registerTerminalDevice', 'getTerminalCode']) {
    assert.equal(isUnknownOutcomeCall(n), true, n);
    assert.equal(n in CALLS_WITHOUT_EFFECT, false, n);
  }
  for (const n of ['getTerminalAccess', 'claimTerminal', 'requestTerminalCode', 'reportTerminalLogin', 'reportTerminalReady']) {
    assert.equal(isUnknownOutcomeCall(n), false, n);
    assert.equal(CALLS_WITHOUT_EFFECT[n], 'repeatable', n);
  }
});

test('Kartenterminal: TERMINAL_ERROR_CODES = errorCodes.terminal des Vertrags (mit Reihenfolge), jeder Code in errorCodes.all', () => {
  assert.deepEqual([...TERMINAL_ERROR_CODES], VOKABULAR.errorCodes.terminal);
  const alle = new Set(VOKABULAR.errorCodes.all as string[]);
  assert.deepEqual(TERMINAL_ERROR_CODES.filter((c) => !alle.has(c)), []);
  const code: TerminalErrorCode = 'terminal_code_manual';
  assert.equal(code, 'terminal_code_manual');
  assert.equal(wurzel.TERMINAL_ERROR_CODES, TERMINAL_ERROR_CODES);
  for (const n of NAMEN) assert.equal(typeof (wurzel as Record<string, unknown>)[n], 'function', n);
});

test('Kartenterminal: Wertlisten wie im Backend', () => {
  assert.deepEqual([...TERMINAL_PLATFORMS], ['android', 'ios']);
  assert.deepEqual([...TERMINAL_SETUP_STATES], ['assigned', 'waiting_for_code', 'setting_up', 'ready', 'failed']);
  assert.deepEqual([...TERMINAL_CODE_STATUSES], ['none', 'searching', 'found', 'delivered', 'unclear', 'no_code', 'expired']);
  assert.deepEqual([...TERMINAL_CODE_SOURCES], ['mailbox', 'support']);
});

// ---- registerTerminalDevice ------------------------------------------------------------------

test('registerTerminalDevice: sendet label, platform, app (und requestedBy nur, wenn gesetzt) an /v3 und liefert den Ausweis', async () => {
  const { api, aufrufe } = server([erfolg({ deviceId: GERAET, deviceSecret: GEHEIM }), erfolg({ deviceId: GERAET, deviceSecret: GEHEIM })]);
  const ausweis = await api.registerTerminalDevice({ label: 'Pixel 8 - Livia', platform: 'android', app: 'karteck/1.6.21', requestedBy: 'Livia Lindmayr' });
  assert.deepEqual(ausweis, AUSWEIS);
  assert.equal(aufrufe[0]!.url, 'https://api.kasseneck.at/v3/registerTerminalDevice');
  assert.deepEqual(aufrufe[0]!.params, { label: 'Pixel 8 - Livia', platform: 'android', app: 'karteck/1.6.21', requestedBy: 'Livia Lindmayr' });
  assert.equal(aufrufe[0]!.headers['Authorization'], `Bearer ${API_KEY}`);

  await api.registerTerminalDevice({ label: 'iPhone 15', platform: 'ios', app: 'karteck/1.6.21' });
  assert.equal('requestedBy' in aufrufe[1]!.params, false);
});

test('registerTerminalDevice: prueft die Eingabe vor dem Senden', async () => {
  const { api, aufrufe } = server([]);
  const gut = { label: 'Pixel 8', platform: 'android', app: 'karteck/1.6.21' };
  const faelle: Array<[Json, RegExp]> = [
    [{ ...gut, label: '' }, /label fehlt/],
    [{ ...gut, label: '   ' }, /label fehlt/],
    [{ ...gut, label: 'x'.repeat(61) }, /label: hoechstens 60/],
    [{ ...gut, platform: 'windows' }, /platform muss android oder ios/],
    [{ ...gut, app: undefined }, /app fehlt/],
    [{ ...gut, app: 'x'.repeat(41) }, /app: hoechstens 40/],
    [{ ...gut, requestedBy: 'x'.repeat(81) }, /requestedBy: hoechstens 80/],
    [{ ...gut, requestedBy: '' }, /requestedBy fehlt/],
  ];
  for (const [eingabe, muster] of faelle) {
    await assert.rejects(() => api.registerTerminalDevice(eingabe as never), (e: unknown) => {
      assert.ok(isKasseneckValidationError(e));
      assert.equal((e as KasseneckValidationError).scope, 'request');
      assert.match((e as Error).message, muster);
      return true;
    });
  }
  // Leerraum am Rand zaehlt nicht mit (wie am Server).
  const { api: api2 } = server([erfolg({ deviceId: GERAET, deviceSecret: GEHEIM })]);
  await api2.registerTerminalDevice({ label: `  ${'x'.repeat(60)}  `, platform: 'ios', app: 'karteck/1.6.21' });
  assert.equal(aufrufe.length, 0);
});

test('registerTerminalDevice: Antwort ohne Ausweis ist ein Antwortfehler (ohne das Geheimnis zu nennen); Backend-Codes kommen als code an', async () => {
  const { api } = server([
    erfolg({ deviceId: GERAET }),
    erfolg({ deviceSecret: GEHEIM }),
    { status: 'error', message: 'Für diesen Betrieb sind schon zu viele Geräte angemeldet. Bitte Kasseneck kontaktieren.', code: 'too_many_terminal_devices' },
    { status: 'error', message: 'Genius Pay gibt es nur in der Live-Umgebung.', code: 'terminal_test_environment' },
  ]);
  const eingabe = { label: 'Pixel 8', platform: 'android', app: 'karteck/1.6.21' } as const;
  await assert.rejects(() => api.registerTerminalDevice(eingabe), (e: unknown) => isKasseneckValidationError(e) && e.scope === 'response');
  await assert.rejects(() => api.registerTerminalDevice(eingabe), (e: unknown) => {
    ohneGeheimnis(e);
    return isKasseneckValidationError(e) && e.scope === 'response';
  });
  await assert.rejects(() => api.registerTerminalDevice(eingabe), (e: unknown) => isKasseneckApiError(e) && e.code === 'too_many_terminal_devices');
  await assert.rejects(() => api.registerTerminalDevice(eingabe), (e: unknown) => isKasseneckApiError(e) && e.code === 'terminal_test_environment');
});

test('registerTerminalDevice: Netzfehler nach dem Senden ist ein unklarer Ausgang (eine Wiederholung legt ein weiteres Geraet an)', async () => {
  const { api } = server([new TypeError('fetch failed')]);
  await assert.rejects(() => api.registerTerminalDevice({ label: 'Pixel 8', platform: 'android', app: 'karteck/1.6.21' }), (e: unknown) => {
    return isKasseneckNetworkError(e) && isOutcomeUnknown(e);
  });
});

// ---- getTerminalAccess / claimTerminal ------------------------------------------------------

test('getTerminalAccess: sendet den Ausweis und nur gesetzte Anzeigewerte, liefert den Zugang', async () => {
  const { api, aufrufe } = server([erfolg(zugang()), erfolg(zugang({ terminalName: null, updatedAt: null, setup: { state: 'ready', since: null } }))]);
  const z = await api.getTerminalAccess({ ...AUSWEIS, platform: 'android', app: 'karteck/1.6.22', label: 'Pixel 8 - Livia' });
  assert.deepEqual(z, zugang());
  assert.equal(aufrufe[0]!.url, 'https://api.kasseneck.at/v3/getTerminalAccess');
  assert.deepEqual(aufrufe[0]!.params, { ...AUSWEIS, platform: 'android', app: 'karteck/1.6.22', label: 'Pixel 8 - Livia' });

  const ohne = await api.getTerminalAccess(AUSWEIS);
  assert.deepEqual(aufrufe[1]!.params, AUSWEIS);
  assert.ok(ohne.available);
  const zugaenglich = ohne as TerminalAccess;
  assert.equal(zugaenglich.terminalName, null);
  assert.equal(zugaenglich.updatedAt, null);
  assert.deepEqual(zugaenglich.setup, { state: 'ready', since: null });
});

test('getTerminalAccess: keine TID frei - Liste der TIDs des eigenen Betriebs', async () => {
  const liste = {
    available: false,
    reason: 'no_free_terminal',
    terminals: [
      { terminalId: '12345678', name: 'Melisse Nails Studio', lastUsedBy: 'iPhone 15 - Mirela', lastUsedAt: '2026-11-06T15:30:00.000Z' },
      { terminalId: '12345679', name: null, lastUsedBy: null, lastUsedAt: null },
    ],
  };
  const { api } = server([erfolg(liste)]);
  const r = await api.getTerminalAccess(AUSWEIS);
  assert.deepEqual(r, liste);
  assert.equal(r.available, false);
  if (!r.available) assert.equal(r.terminals[1]!.name, null);
});

test('getTerminalAccess: ein spaeter ergaenzter Einrichtungsstand kommt unveraendert an', async () => {
  const { api } = server([erfolg(zugang({ setup: { state: 'paused', since: null } }))]);
  const r = (await api.getTerminalAccess(AUSWEIS)) as TerminalAccess;
  assert.equal(r.setup.state, 'paused');
});

test('getTerminalAccess: unvollstaendige Antwort ist ein Antwortfehler, der weder Passwort noch Geheimnis nennt', async () => {
  const kaputt: Json[] = [
    {},
    zugang({ password: undefined }),
    zugang({ username: '' }),
    zugang({ terminalId: 12345678 }),
    zugang({ autoCode: 'ja' }),
    zugang({ codeFormat: { length: 0, labels: [] } }),
    zugang({ codeFormat: { length: 6, labels: [1] } }),
    zugang({ setup: null }),
    { available: false, reason: 'no_free_terminal' },
    { available: false, reason: 'no_free_terminal', terminals: [{ name: 'ohne TID' }] },
  ];
  const { api } = server(kaputt.map(erfolg));
  for (let i = 0; i < kaputt.length; i++) {
    await assert.rejects(() => api.getTerminalAccess(AUSWEIS), (e: unknown) => {
      ohneGeheimnis(e);
      return isKasseneckValidationError(e) && e.scope === 'response';
    }, `Fall ${i}`);
  }
});

test('getTerminalAccess: Ausweis und Anzeigewerte werden vor dem Senden geprueft, ohne das Geheimnis zu nennen', async () => {
  const { api, aufrufe } = server([]);
  const faelle: Array<[Json, RegExp]> = [
    [{ deviceSecret: GEHEIM }, /deviceId fehlt/],
    [{ deviceId: GERAET }, /deviceSecret fehlt/],
    [{ deviceId: GERAET, deviceSecret: '' }, /deviceSecret fehlt/],
    [{ ...AUSWEIS, platform: 'web' }, /platform muss android oder ios/],
    [{ ...AUSWEIS, label: '' }, /label fehlt/],
    [{ ...AUSWEIS, app: 'x'.repeat(41) }, /app: hoechstens 40/],
  ];
  for (const [eingabe, muster] of faelle) {
    await assert.rejects(() => api.getTerminalAccess(eingabe as never), (e: unknown) => {
      ohneGeheimnis(e);
      assert.ok(isKasseneckValidationError(e));
      assert.match((e as Error).message, muster);
      return true;
    });
  }
  await assert.rejects(() => api.getTerminalAccess(null as never), (e: unknown) => isKasseneckValidationError(e));
  assert.equal(aufrufe.length, 0);
});

test('getTerminalAccess: Fachfehler kommen als code an und nennen das Geheimnis nicht, auch wenn der Server es zurueckschickt', async () => {
  const { api } = server([
    { status: 'error', message: 'Dieses Gerät ist für Genius Pay nicht angemeldet.', code: 'terminal_device_unknown', data: { deviceSecret: GEHEIM } },
    { status: 'error', message: 'Dieses Gerät ist für Genius Pay gesperrt. Bitte Kasseneck kontaktieren.', code: 'terminal_device_blocked' },
    { status: 'error', message: 'Für diesen Betrieb ist Genius Pay nicht eingerichtet. Bitte Kasseneck kontaktieren.', code: 'terminal_not_enabled' },
  ]);
  await assert.rejects(() => api.getTerminalAccess(AUSWEIS), (e: unknown) => {
    ohneGeheimnis(e);
    return isKasseneckApiError(e) && e.code === 'terminal_device_unknown';
  });
  await assert.rejects(() => api.getTerminalAccess(AUSWEIS), (e: unknown) => isKasseneckApiError(e) && e.code === 'terminal_device_blocked');
  await assert.rejects(() => api.getTerminalAccess(AUSWEIS), (e: unknown) => isKasseneckApiError(e) && e.code === 'terminal_not_enabled');
});

test('getTerminalAccess: geht auch mit einer Anmeldung nur mit dem api_key (ohne Kassen-Token)', async () => {
  const { api, aufrufe } = server([erfolg(zugang())], inventoryKeyAuth({ apiKey: API_KEY }));
  await api.getTerminalAccess(AUSWEIS);
  assert.equal(aufrufe[0]!.headers['Authorization'], `Bearer ${API_KEY}`);
  assert.equal('cashregister-token' in aufrufe[0]!.headers, false);
});

test('claimTerminal: sendet Ausweis, terminalId und label, liefert den Zugang; fremde TID kommt als code an', async () => {
  const { api, aufrufe } = server([
    erfolg(zugang({ terminalId: '12345679', terminalName: null })),
    { status: 'error', message: 'Diese Terminal-ID gehört nicht zu diesem Betrieb.', code: 'terminal_not_in_business' },
    erfolg({ available: false, reason: 'no_free_terminal', terminals: [] }),
  ]);
  const z = await api.claimTerminal({ ...AUSWEIS, terminalId: '12345679', label: 'Pixel 8 - Livia' });
  assert.equal(z.available, true);
  assert.equal(z.terminalId, '12345679');
  assert.equal(aufrufe[0]!.url, 'https://api.kasseneck.at/v3/claimTerminal');
  assert.deepEqual(aufrufe[0]!.params, { ...AUSWEIS, terminalId: '12345679', label: 'Pixel 8 - Livia' });

  await assert.rejects(() => api.claimTerminal({ ...AUSWEIS, terminalId: '87654321' }), (e: unknown) => isKasseneckApiError(e) && e.code === 'terminal_not_in_business');
  // Uebernehmen liefert immer einen Zugang; eine Liste ist eine unbrauchbare Antwort.
  await assert.rejects(() => api.claimTerminal({ ...AUSWEIS, terminalId: '12345679' }), (e: unknown) => isKasseneckValidationError(e) && e.scope === 'response');
});

test('claimTerminal: ohne terminalId wird nicht gesendet', async () => {
  const { api, aufrufe } = server([]);
  await assert.rejects(() => api.claimTerminal({ ...AUSWEIS, terminalId: '' }), (e: unknown) => isKasseneckValidationError(e) && /terminalId/.test((e as Error).message));
  assert.equal(aufrufe.length, 0);
});

// ---- requestTerminalCode / getTerminalCode -------------------------------------------------

test('requestTerminalCode: sendet Ausweis, platform und requestedBy (nur wenn gesetzt), liefert den Stand', async () => {
  const { api, aufrufe } = server([
    erfolg({ status: 'searching' }),
    erfolg({ status: 'found' }),
    { status: 'error', message: 'Der Code kommt per E-Mail an das Genius-Konto. Bitte den Code eingeben.', code: 'terminal_code_manual' },
    { status: 'error', message: 'Zu viele Code-Anfragen. Bitte später erneut versuchen.', code: 'terminal_code_rate_limited' },
    { status: 'error', message: 'Diesem Gerät ist keine Terminal-ID zugeordnet. Bitte zuerst den Zugang holen.', code: 'terminal_not_assigned' },
  ]);
  assert.deepEqual(await api.requestTerminalCode({ ...AUSWEIS, platform: 'android', requestedBy: 'Livia Lindmayr' }), { status: 'searching' });
  assert.equal(aufrufe[0]!.url, 'https://api.kasseneck.at/v3/requestTerminalCode');
  assert.deepEqual(aufrufe[0]!.params, { ...AUSWEIS, platform: 'android', requestedBy: 'Livia Lindmayr' });
  // Doppeltipp: die offene Anfrage bleibt und nennt ihren Stand.
  assert.deepEqual(await api.requestTerminalCode({ ...AUSWEIS, platform: 'ios' }), { status: 'found' });
  assert.deepEqual(aufrufe[1]!.params, { ...AUSWEIS, platform: 'ios' });
  for (const code of ['terminal_code_manual', 'terminal_code_rate_limited', 'terminal_not_assigned']) {
    await assert.rejects(() => api.requestTerminalCode({ ...AUSWEIS, platform: 'android' }), (e: unknown) => isKasseneckApiError(e) && e.code === code, code);
  }
});

test('requestTerminalCode: platform ist Pflicht; Antwort ohne status ist ein Antwortfehler', async () => {
  const { api, aufrufe } = server([erfolg({})]);
  await assert.rejects(() => api.requestTerminalCode({ ...AUSWEIS } as never), (e: unknown) => isKasseneckValidationError(e) && e.scope === 'request');
  assert.equal(aufrufe.length, 0);
  await assert.rejects(() => api.requestTerminalCode({ ...AUSWEIS, platform: 'android' }), (e: unknown) => isKasseneckValidationError(e) && e.scope === 'response');
});

test('getTerminalCode: ohne Anfrage none mit Einrichtungsstand, gefunden mit Code, Quelle und Ablauf', async () => {
  const setup = { state: 'waiting_for_code', since: '2026-11-07T08:01:00.000Z' };
  const { api, aufrufe } = server([
    erfolg({ status: 'none', setup: { state: 'assigned', since: null } }),
    erfolg({ status: 'searching', setup }),
    erfolg({ status: 'found', code: CODE, source: 'mailbox', validUntil: '2026-11-07T08:21:00.000Z', setup }),
    erfolg({ status: 'delivered', code: CODE, source: 'support', validUntil: '2026-11-07T08:21:00.000Z', setup }),
    erfolg({ status: 'expired', setup }),
  ]);
  assert.deepEqual(await api.getTerminalCode(AUSWEIS), { status: 'none', setup: { state: 'assigned', since: null } });
  assert.equal(aufrufe[0]!.url, 'https://api.kasseneck.at/v3/getTerminalCode');
  assert.deepEqual(aufrufe[0]!.params, AUSWEIS);
  assert.deepEqual(await api.getTerminalCode(AUSWEIS), { status: 'searching', setup });
  assert.deepEqual(await api.getTerminalCode(AUSWEIS), { status: 'found', code: CODE, source: 'mailbox', validUntil: '2026-11-07T08:21:00.000Z', setup });
  // iOS: der Code bleibt bis validUntil lesbar.
  assert.deepEqual(await api.getTerminalCode(AUSWEIS), { status: 'delivered', code: CODE, source: 'support', validUntil: '2026-11-07T08:21:00.000Z', setup });
  const abgelaufen = await api.getTerminalCode(AUSWEIS);
  assert.equal('code' in abgelaufen, false);
});

test('getTerminalCode: Gross-/Kleinschreibung des Codes bleibt; Antwort ohne setup oder mit Code als Zahl ist ein Antwortfehler ohne den Code', async () => {
  const { api } = server([
    erfolg({ status: 'found', code: 'aBcD12', source: 'mailbox', validUntil: null, setup: { state: 'waiting_for_code', since: null } }),
    erfolg({ status: 'found', code: CODE }),
    erfolg({ status: 'found', code: 123456, setup: { state: 'waiting_for_code', since: null } }),
  ]);
  assert.equal((await api.getTerminalCode(AUSWEIS)).code, 'aBcD12');
  for (let i = 0; i < 2; i++) {
    await assert.rejects(() => api.getTerminalCode(AUSWEIS), (e: unknown) => {
      ohneGeheimnis(e);
      return isKasseneckValidationError(e) && e.scope === 'response';
    });
  }
});

test('getTerminalCode: Netzfehler nach dem Senden ist ein unklarer Ausgang (auf Android kann der Code verbraucht sein)', async () => {
  const { api } = server([new TypeError('fetch failed')]);
  await assert.rejects(() => api.getTerminalCode(AUSWEIS), (e: unknown) => {
    ohneGeheimnis(e);
    return isKasseneckNetworkError(e) && isOutcomeUnknown(e);
  });
});

test('claimTerminal und reportTerminalReady: Netzfehler nach dem Senden ist abgelehnt (wiederholbar), nicht unklar', async () => {
  const { api } = server([new TypeError('fetch failed'), new TypeError('fetch failed')]);
  await assert.rejects(() => api.claimTerminal({ ...AUSWEIS, terminalId: '12345679' }), (e: unknown) => isKasseneckNetworkError(e) && !isOutcomeUnknown(e));
  await assert.rejects(() => api.reportTerminalReady(AUSWEIS), (e: unknown) => {
    ohneGeheimnis(e);
    return isKasseneckNetworkError(e) && !isOutcomeUnknown(e);
  });
});

// ---- reportTerminalLogin / reportTerminalReady ---------------------------------------------

test('reportTerminalLogin: sendet genau Ausweis, terminalId, success und newOnDevice; Antwort nichts', async () => {
  const { api, aufrufe } = server([erfolg({}), erfolg({})]);
  assert.equal(await api.reportTerminalLogin({ ...AUSWEIS, terminalId: '12345678', success: true, newOnDevice: true }), undefined);
  assert.equal(aufrufe[0]!.url, 'https://api.kasseneck.at/v3/reportTerminalLogin');
  assert.deepEqual(aufrufe[0]!.params, { ...AUSWEIS, terminalId: '12345678', success: true, newOnDevice: true });
  await api.reportTerminalLogin({ ...AUSWEIS, terminalId: '12345678', success: false, newOnDevice: false });
  assert.deepEqual(aufrufe[1]!.params, { ...AUSWEIS, terminalId: '12345678', success: false, newOnDevice: false });
});

test('reportTerminalLogin: weist Unbrauchbares vor dem Senden ab', async () => {
  const { api, aufrufe } = server([]);
  const gut = { ...AUSWEIS, terminalId: '12345678', success: true, newOnDevice: false };
  for (const kaputt of [{ ...gut, terminalId: '' }, { ...gut, success: 'ja' }, { ...gut, newOnDevice: undefined }, { ...gut, deviceSecret: undefined }]) {
    await assert.rejects(() => api.reportTerminalLogin(kaputt as never), (e: unknown) => {
      ohneGeheimnis(e);
      return isKasseneckValidationError(e) && e.scope === 'request';
    });
  }
  assert.equal(aufrufe.length, 0);
});

test('reportTerminalReady: sendet nur den Ausweis; ohne zugeordnete TID kommt der code an', async () => {
  const { api, aufrufe } = server([
    erfolg({}),
    { status: 'error', message: 'Diesem Gerät ist keine Terminal-ID zugeordnet. Bitte zuerst den Zugang holen.', code: 'terminal_not_assigned' },
  ]);
  assert.equal(await api.reportTerminalReady(AUSWEIS), undefined);
  assert.equal(aufrufe[0]!.url, 'https://api.kasseneck.at/v3/reportTerminalReady');
  assert.deepEqual(aufrufe[0]!.params, AUSWEIS);
  await assert.rejects(() => api.reportTerminalReady(AUSWEIS), (e: unknown) => isKasseneckApiError(e) && e.code === 'terminal_not_assigned');
});
