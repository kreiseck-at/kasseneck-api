import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendReceiptEmail } from '../src/client/receipts.js';
import { createKasseneckApi } from '../src/client/api.js';
import { RECEIPT_EMAIL_ERROR_CODES, RECEIPT_EMAIL_SEND_ERROR_CODES, isReceiptEmailErrorCode } from '../src/models/index.js';
import { ALL_CALLS } from '../src/client/aufrufe.js';
import {
  isKasseneckApiError,
  isKasseneckHttpError,
  isKasseneckValidationError,
} from '../src/client/errors.js';
import {
  createTransport,
  DEFAULT_BASE_URL,
  POS_BASE_URL,
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
 * `language`), Antwortfelder (`to`, `at`, `via`) und der Fehlercode-Katalog.
 * Ein Tippfehler in einer dieser Zeichenketten faellt der Typpruefung nicht
 * auf und wuerde sonst erst am Tresen auffallen.
 *
 * Rot-Probe, jeder Fall am laufenden Code belegt:
 * - anderer Endpunktname in `rufen(...)` -> 1 und 4b rot.
 * - `to`/`fullReceiptId` ungetrimmt gesendet -> 2 rot.
 * - `language` immer gesendet (`?? 'de'`) -> 1, 2 und 3 rot.
 * - ohne Vorpruefung -> 5 rot (es ging eine Anfrage hinaus).
 * - Fehler des Transports umgehuellt statt durchgereicht -> 6, 6b und 8 rot.
 * - `to`/`at` der Antwort ungeprueft durchgereicht -> 7 und 7b rot; ein
 *   Wurf bei fehlendem `to`/`at` -> 7 rot (Befund rc.3).
 * - `send_failed` aus dem Katalog entfernt -> 9 rot.
 * - fehlt der Aufruf in ALL_CALLS, ist er schon ein Compilerfehler
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
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : name.toLowerCase() === 'kasseneck-api-version' ? 'v3' : null) },
    text: async () => rumpf,
    arrayBuffer: async () => new TextEncoder().encode(rumpf).buffer,
  };
}

const erfolg = (daten: unknown): HttpResponseLike => antwort(JSON.stringify({ status: 'success', message: '', data: daten }));
const fehlschlag = (message: string, code?: string): HttpResponseLike =>
  antwort(JSON.stringify({ status: 'error', message, code, data: code === undefined ? null : { code } }));

/** Antwort des Backends bei Erfolg (beleg-mail-endpoints.js, successResponse). */
const MAIL_ANTWORT = { to: 'gast@example.at', at: '2026-09-11T14:05:00+02:00', via: 'own' };

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

/**
 * Endpunkt, Parameter und Kopfzeilen des einzigen Aufrufs. `basis` ist die
 * erwartete Basis: oeffentlich (api_key) oder Kassenweg (Kassen-Benutzer,
 * Kanal app).
 */
function gesendet(
  aufrufe: Aufruf[],
  basis: string = DEFAULT_BASE_URL,
): { endpunkt: string; params: Record<string, unknown>; kopf: Record<string, string> } {
  assert.equal(aufrufe.length, 1, 'genau ein Aufruf erwartet');
  const aufruf = aufrufe[0]!;
  assert.ok(aufruf.url.startsWith(`${basis}/`), `unerwartete URL: ${aufruf.url}`);
  const rumpf = JSON.parse(aufruf.init.body) as { params: Record<string, unknown> };
  return {
    endpunkt: aufruf.url.slice(basis.length + 1),
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
  assert.deepEqual(ergebnis, { to: 'gast@example.at', at: '2026-09-11T14:05:00+02:00', via: 'own' });
});

test('2) Adresse und Beleg-Kennung gehen getrimmt hinaus', async () => {
  const { rufen, aufrufe } = apiSchluesselWeg();
  await sendReceiptEmail(rufen, { fullReceiptId: `  ${VOLL_ID}\n`, to: '  gast@example.at ' });
  const { params } = gesendet(aufrufe);
  assert.deepEqual(params, { fullReceiptId: VOLL_ID, to: 'gast@example.at' });
});

test('3) language geht nur mit, wenn sie gesetzt ist (nie das alte sprache)', async () => {
  const ohne = apiSchluesselWeg();
  await sendReceiptEmail(ohne.rufen, { fullReceiptId: VOLL_ID, to: 'gast@example.at' });
  assert.equal('language' in gesendet(ohne.aufrufe).params, false);

  const mit = apiSchluesselWeg();
  await sendReceiptEmail(mit.rufen, { fullReceiptId: VOLL_ID, to: 'gast@example.at', language: 'de' });
  assert.equal(gesendet(mit.aufrufe).params['language'], 'de');
  assert.equal('sprache' in gesendet(mit.aufrufe).params, false);
});

test('4) Kassen-Benutzer-Weg: die Kasse kommt aus der Anmeldung, nicht aus den Optionen', async () => {
  const { rufen, aufrufe } = kassenBenutzerWeg();
  await sendReceiptEmail(rufen, { fullReceiptId: VOLL_ID, to: 'gast@example.at' });
  // Kassen-Benutzer: ueber den Kassenweg (Kanal app), nicht api.kasseneck.at.
  const { endpunkt, params, kopf } = gesendet(aufrufe, POS_BASE_URL);
  assert.equal(endpunkt, 'sendReceiptEmail');
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

test('7) eine Erfolgsantwort ohne to/at ist kein Fehler: die Mail ist verschickt, zurueck kommt, was da ist', async () => {
  // Ein Wurf luede zum zweiten Versand ein (und zaehlte auf die Schleuse).
  for (const [daten, soll] of [
    [{}, { to: 'gast@example.at', at: null, via: null }],
    [{ at: '2026-09-11T14:05:00+02:00' }, { to: 'gast@example.at', at: '2026-09-11T14:05:00+02:00', via: null }],
    [{ to: 'gast@example.at' }, { to: 'gast@example.at', at: null, via: null }],
    [{ to: 42, at: 7 }, { to: 'gast@example.at', at: null, via: null }],
  ] as const) {
    const { rufen } = apiSchluesselWeg(erfolg(daten));
    assert.deepEqual(await sendReceiptEmail(rufen, { fullReceiptId: VOLL_ID, to: 'gast@example.at' }), soll);
  }
});

test('7b) fehlendes oder unbekanntes via ist kein Fehler, sondern null', async () => {
  const { rufen } = apiSchluesselWeg(erfolg({ to: 'gast@example.at', at: '2026-09-11T14:05:00+02:00' }));
  const ergebnis = await sendReceiptEmail(rufen, { fullReceiptId: VOLL_ID, to: 'gast@example.at' });
  assert.equal(ergebnis.via, null);
  const alt = apiSchluesselWeg(erfolg({ to: 'gast@example.at', at: '2026-09-11T14:05:00+02:00', via: 'eigen' }));
  assert.equal((await sendReceiptEmail(alt.rufen, { fullReceiptId: VOLL_ID, to: 'gast@example.at' })).via, null);
});

test('8) eine Antwort, die kein JSON ist, ist ein HTTP-Fehler', async () => {
  // text/plain: eine HTML-Auffangseite waere route_missing (transport-v3.test.ts).
  const { rufen } = apiSchluesselWeg(antwort('<!doctype html><html>Auffangseite</html>', 'text/plain'));
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

test('9) der Fehlercode-Katalog ist der des /v3-Vokabulars (errorCodes.receiptEmail)', () => {
  assert.deepEqual(
    [...RECEIPT_EMAIL_SEND_ERROR_CODES],
    ['invalid_address', 'receipt_not_found', 'too_many_requests', 'send_failed'],
  );
  // Die Versandcodes zuerst, dahinter die der Anmeldung und des Rands.
  assert.deepEqual(RECEIPT_EMAIL_ERROR_CODES.slice(0, 4), [...RECEIPT_EMAIL_SEND_ERROR_CODES]);
  assert.equal(isReceiptEmailErrorCode('register_user_not_found'), true);
  assert.equal(isReceiptEmailErrorCode('too_many_requests'), true);
  assert.equal(isReceiptEmailErrorCode('zu_oft'), false);
  assert.equal(isReceiptEmailErrorCode('storno_fehlgeschlagen'), false);
  assert.equal(isReceiptEmailErrorCode(undefined), false);
});

test('9b) der Aufruf steht in ALL_CALLS (und damit im Zwillingsvertrag)', () => {
  assert.ok((ALL_CALLS as readonly string[]).includes('sendReceiptEmail'));
});

test('9c) geheime Werte stehen in keiner Fehlermeldung', async () => {
  const { rufen } = apiSchluesselWeg(fehlschlag('Beleg nicht gefunden.', 'receipt_not_found'));
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
