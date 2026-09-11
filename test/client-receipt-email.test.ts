import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendReceiptEmail } from '../src/client/receipts.js';
import { createKasseneckApi } from '../src/client/api.js';
import { RECEIPT_EMAIL_ERROR_CODES, isReceiptEmailErrorCode } from '../src/models/index.js';
import { AUFRUFE } from '../src/client/aufrufe.js';
import {
  isKasseneckApiError,
  isKasseneckHttpError,
  isKasseneckValidationError,
} from '../src/client/errors.js';
import {
  createTransport,
  DEFAULT_BASE_URL,
  type FetchLike,
  type HttpRequestInit,
  type HttpResponseLike,
  type KasseneckTransport,
} from '../src/client/transport.js';
import { apiKeyAuth, registerUserAuth } from '../src/client/auth.js';

/**
 * Vertragstests von `sendReceiptEmail` (Backend: beleg-mail-endpoints.js,
 * beleg-mail-core.js).
 *
 * Die Erwartungen sind aus dem Backend **abgeschrieben**, nicht aus der
 * Umsetzung dieses Pakets abgeleitet: Feldnamen (`fullReceiptId`, `to`,
 * `sprache`), Antwortfelder (`to`, `at`, `via`) und der Fehlercode-Katalog.
 * Ein Tippfehler in einer dieser Zeichenketten faellt der Typpruefung nicht
 * auf und wuerde sonst erst am Tresen auffallen.
 *
 * Rot-Probe, jeder Fall am laufenden Code belegt:
 * - anderer Endpunktname in `rufen(...)` -> 1 und 4b rot.
 * - `to`/`fullReceiptId` ungetrimmt gesendet -> 2 rot.
 * - `sprache` immer gesendet (`?? 'de'`) -> 1, 2 und 3 rot.
 * - ohne Vorpruefung -> 5 rot (es ging eine Anfrage hinaus).
 * - Fehler des Transports umgehuellt statt durchgereicht -> 6, 6b und 8 rot.
 * - Antwort ungeprueft durchgereicht -> 7 und 7b rot.
 * - `versand_fehlgeschlagen` aus dem Katalog entfernt -> 9 rot.
 * - fehlt der Aufruf in AUFRUFE, ist er schon ein Compilerfehler
 *   (InternerTransport kennt nur bekannte Namen); 9b haelt ihn zusaetzlich im
 *   Zwillingsvertrag fest.
 */

const API_KEY = 'kr_live_GEHEIMERAPIKEY';
const KASSEN_TOKEN = 'cb_live_GEHEIMESKASSENTOKEN';
const ID_TOKEN = 'eyJ-GEHEIMESIDTOKEN';
const SITZUNG = 'sess-GEHEIMESITZUNG';
const KASSEN_ID = 'kasse-1';
const VOLL_ID = 'a1b2c3.d4e5f6';

interface Aufruf {
  url: string;
  init: HttpRequestInit;
}

function antwort(rumpf: string, contentType = 'application/json'): HttpResponseLike {
  return {
    status: 200,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null) },
    text: async () => rumpf,
    arrayBuffer: async () => new TextEncoder().encode(rumpf).buffer,
  };
}

const erfolg = (daten: unknown): HttpResponseLike => antwort(JSON.stringify({ status: 'success', message: '', data: daten }));
const fehlschlag = (message: string, code?: string): HttpResponseLike =>
  antwort(JSON.stringify({ status: 'error', message, code, data: code === undefined ? null : { code } }));

/** Antwort des Backends bei Erfolg (beleg-mail-endpoints.js, successResponse). */
const MAIL_ANTWORT = { to: 'gast@example.at', at: '2026-09-11T14:05:00+02:00', via: 'eigen' };

function fetchFake(antwortWert: HttpResponseLike): { holen: FetchLike; aufrufe: Aufruf[] } {
  const aufrufe: Aufruf[] = [];
  const holen: FetchLike = async (url, init) => {
    aufrufe.push({ url, init });
    return antwortWert;
  };
  return { holen, aufrufe };
}

/** Transport plus Aufruf-Mitschrift fuer den Geraeteweg (api_key + Kassen-Token). */
function apiSchluesselWeg(antwortWert: HttpResponseLike = erfolg(MAIL_ANTWORT)): { rufen: KasseneckTransport; aufrufe: Aufruf[] } {
  const { holen, aufrufe } = fetchFake(antwortWert);
  return {
    rufen: createTransport({ auth: apiKeyAuth({ apiKey: API_KEY, cashregisterToken: KASSEN_TOKEN }), fetch: holen }),
    aufrufe,
  };
}

/** Transport plus Mitschrift fuer den Kassen-Benutzer-Weg (Browser-Kasse). */
function kassenBenutzerWeg(antwortWert: HttpResponseLike = erfolg(MAIL_ANTWORT)): { rufen: KasseneckTransport; aufrufe: Aufruf[] } {
  const { holen, aufrufe } = fetchFake(antwortWert);
  return {
    rufen: createTransport({
      auth: registerUserAuth({ getIdToken: () => ID_TOKEN, getSessionId: () => SITZUNG, cashregisterId: KASSEN_ID }),
      fetch: holen,
    }),
    aufrufe,
  };
}

function gesendet(aufrufe: Aufruf[]): { endpunkt: string; params: Record<string, unknown>; kopf: Record<string, string> } {
  assert.equal(aufrufe.length, 1, 'genau ein Aufruf erwartet');
  const aufruf = aufrufe[0]!;
  assert.ok(aufruf.url.startsWith(`${DEFAULT_BASE_URL}/`), `unerwartete URL: ${aufruf.url}`);
  const rumpf = JSON.parse(aufruf.init.body) as { params: Record<string, unknown> };
  return {
    endpunkt: aufruf.url.slice(DEFAULT_BASE_URL.length + 1),
    params: rumpf.params,
    kopf: aufruf.init.headers as Record<string, string>,
  };
}

// --- 1..4 der Aufruf selbst --------------------------------------------

test('1) sendReceiptEmail ruft den Endpunkt mit fullReceiptId und to und liest to/at/via', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg();
  const ergebnis = await sendReceiptEmail(rufen, { fullReceiptId: VOLL_ID, to: 'gast@example.at' });
  const { endpunkt, params, kopf } = gesendet(aufrufe);
  assert.equal(endpunkt, 'sendReceiptEmail');
  assert.deepEqual(params, { fullReceiptId: VOLL_ID, to: 'gast@example.at' });
  // Der Geraeteweg bindet die Kasse ueber die Kopfzeile, nicht ueber die Nutzlast.
  assert.equal(kopf['cashregister-token'], KASSEN_TOKEN);
  assert.equal('cashregisterId' in params, false);
  assert.deepEqual(ergebnis, { to: 'gast@example.at', at: '2026-09-11T14:05:00+02:00', via: 'eigen' });
});

test('2) Adresse und Beleg-Kennung gehen getrimmt hinaus', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg();
  await sendReceiptEmail(rufen, { fullReceiptId: `  ${VOLL_ID}\n`, to: '  gast@example.at ' });
  const { params } = gesendet(aufrufe);
  assert.deepEqual(params, { fullReceiptId: VOLL_ID, to: 'gast@example.at' });
});

test('3) sprache geht nur mit, wenn sie gesetzt ist', async () => {
  const ohne = apiSchluesselWeg();
  await sendReceiptEmail(ohne.rufen, { fullReceiptId: VOLL_ID, to: 'gast@example.at' });
  assert.equal('sprache' in gesendet(ohne.aufrufe).params, false);

  const mit = apiSchluesselWeg();
  await sendReceiptEmail(mit.rufen, { fullReceiptId: VOLL_ID, to: 'gast@example.at', sprache: 'de' });
  assert.equal(gesendet(mit.aufrufe).params['sprache'], 'de');
});

test('4) Kassen-Benutzer-Weg: die Kasse kommt aus der Anmeldung, nicht aus den Optionen', async () => {
  const { rufen, aufrufe } = kassenBenutzerWeg();
  await sendReceiptEmail(rufen, { fullReceiptId: VOLL_ID, to: 'gast@example.at' });
  const { params, kopf } = gesendet(aufrufe);
  assert.equal(params['cashregisterId'], KASSEN_ID);
  assert.equal(kopf['register-session'], SITZUNG);
});

test('4b) die Fassade traegt den Aufruf', async () => {
  const { holen, aufrufe } = fetchFake(erfolg(MAIL_ANTWORT));
  const api = createKasseneckApi({ auth: apiKeyAuth({ apiKey: API_KEY, cashregisterToken: KASSEN_TOKEN }), fetch: holen });
  const ergebnis = await api.sendReceiptEmail({ fullReceiptId: VOLL_ID, to: 'gast@example.at' });
  assert.equal(gesendet(aufrufe).endpunkt, 'sendReceiptEmail');
  assert.equal(ergebnis.to, 'gast@example.at');
});

// --- 5..8 die Fehlerlagen ----------------------------------------------

test('5) fehlende Pflichtfelder gehen gar nicht erst hinaus', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg();
  for (const [optionen, muster] of [
    [{ fullReceiptId: '   ', to: 'gast@example.at' }, /fullReceiptId/],
    [{ fullReceiptId: VOLL_ID, to: '' }, /to/],
  ] as const) {
    await assert.rejects(
      () => sendReceiptEmail(rufen, optionen),
      (fehler: unknown) => {
        assert.ok(isKasseneckValidationError(fehler));
        assert.equal(fehler.scope, 'request');
        assert.equal(fehler.functionName, 'sendReceiptEmail');
        assert.match(fehler.message, muster);
        return true;
      },
    );
  }
  assert.equal(aufrufe.length, 0, 'eine Vorpruefung, die trotzdem sendet, ist keine');
});

test('6) jeder Fehlercode des Backends kommt unveraendert als KasseneckApiError.code heraus', async () => {
  for (const code of RECEIPT_EMAIL_ERROR_CODES) {
    const { rufen } = apiSchluesselWeg(fehlschlag('Irgendein deutscher Text.', code));
    await assert.rejects(
      () => sendReceiptEmail(rufen, { fullReceiptId: VOLL_ID, to: 'gast@example.at' }),
      (fehler: unknown) => {
        assert.ok(isKasseneckApiError(fehler));
        assert.equal(fehler.code, code);
        assert.ok(isReceiptEmailErrorCode(fehler.code));
        // Der Text ist nur fuer den Menschen davor -- entschieden wird am Code.
        assert.equal(fehler.serverMessage, 'Irgendein deutscher Text.');
        return true;
      },
    );
  }
});

test('6b) ein fachlicher Fehler ohne Code bleibt ohne Code (Auth-/Parameterfehler)', async () => {
  const { rufen } = apiSchluesselWeg(fehlschlag('Ungueltiger Request: Authorization key erwartet.'));
  await assert.rejects(
    () => sendReceiptEmail(rufen, { fullReceiptId: VOLL_ID, to: 'gast@example.at' }),
    (fehler: unknown) => {
      assert.ok(isKasseneckApiError(fehler));
      assert.equal(fehler.code, undefined);
      assert.equal(isReceiptEmailErrorCode(fehler.code), false);
      return true;
    },
  );
});

test('7) eine Antwort ohne die zugesagten Felder ist ein Antwortfehler, kein halbes Ergebnis', async () => {
  for (const daten of [{}, { at: '2026-09-11T14:05:00+02:00' }, { to: 'gast@example.at' }, { to: 42, at: 7 }]) {
    const { rufen } = apiSchluesselWeg(erfolg(daten));
    await assert.rejects(
      () => sendReceiptEmail(rufen, { fullReceiptId: VOLL_ID, to: 'gast@example.at' }),
      (fehler: unknown) => {
        assert.ok(isKasseneckValidationError(fehler));
        assert.equal(fehler.scope, 'response');
        assert.equal(fehler.functionName, 'sendReceiptEmail');
        return true;
      },
    );
  }
});

test('7b) fehlendes via ist kein Fehler, sondern null', async () => {
  const { rufen } = apiSchluesselWeg(erfolg({ to: 'gast@example.at', at: '2026-09-11T14:05:00+02:00' }));
  const ergebnis = await sendReceiptEmail(rufen, { fullReceiptId: VOLL_ID, to: 'gast@example.at' });
  assert.equal(ergebnis.via, null);
});

test('8) eine Antwort, die kein JSON ist, ist ein HTTP-Fehler', async () => {
  const { rufen } = apiSchluesselWeg(antwort('<!doctype html><html>Auffangseite</html>', 'text/html'));
  await assert.rejects(
    () => sendReceiptEmail(rufen, { fullReceiptId: VOLL_ID, to: 'gast@example.at' }),
    (fehler: unknown) => {
      assert.ok(isKasseneckHttpError(fehler));
      assert.equal(fehler.reason, 'not-json');
      return true;
    },
  );
});

// --- 9 der Katalog ------------------------------------------------------

test('9) der Fehlercode-Katalog ist der des Backends (beleg-mail-core.js FEHLERCODES)', () => {
  assert.deepEqual(
    [...RECEIPT_EMAIL_ERROR_CODES],
    ['adresse_ungueltig', 'beleg_nicht_gefunden', 'zu_oft', 'versand_fehlgeschlagen'],
  );
  assert.equal(isReceiptEmailErrorCode('zu_oft'), true);
  assert.equal(isReceiptEmailErrorCode('storno_fehlgeschlagen'), false);
  assert.equal(isReceiptEmailErrorCode(undefined), false);
});

test('9b) der Aufruf steht in AUFRUFE (und damit im Zwillingsvertrag)', () => {
  assert.ok((AUFRUFE as readonly string[]).includes('sendReceiptEmail'));
});

test('9c) geheime Werte stehen in keiner Fehlermeldung', async () => {
  const { rufen } = apiSchluesselWeg(fehlschlag('Beleg nicht gefunden.', 'beleg_nicht_gefunden'));
  await assert.rejects(
    () => sendReceiptEmail(rufen, { fullReceiptId: VOLL_ID, to: 'gast@example.at' }),
    (fehler: unknown) => {
      const text = String(fehler);
      assert.equal(text.includes(API_KEY), false);
      assert.equal(text.includes(KASSEN_TOKEN), false);
      return true;
    },
  );
});
