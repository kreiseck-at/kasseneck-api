import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTransport,
  DEFAULT_BASE_URL,
  DEFAULT_TIMEOUT_MS,
  type FetchLike,
  type HttpRequestInit,
  type HttpResponseLike,
} from '../src/client/transport.js';
import {
  KasseneckApiError,
  KasseneckHttpError,
  KasseneckNetworkError,
  isKasseneckApiError,
  isKasseneckHttpError,
  isKasseneckNetworkError,
} from '../src/client/errors.js';
import { apiKeyAuth, registerUserAuth } from '../src/client/auth.js';

const API_KEY = 'kr_live_GEHEIMERAPIKEY';
const KASSEN_TOKEN = 'cb_live_GEHEIMESKASSENTOKEN';
const ID_TOKEN = 'eyJ-GEHEIMESIDTOKEN';
const SITZUNG = 'sess-GEHEIMESITZUNG';

const geheimnisse = [API_KEY, KASSEN_TOKEN, ID_TOKEN, SITZUNG];

interface Aufruf {
  url: string;
  init: HttpRequestInit;
}

/** Baut eine Antwort im Sinn von `HttpResponseLike` (Fake, kein echtes fetch). */
function antwort(
  rumpf: string,
  { status = 200, contentType = 'application/json' }: { status?: number; contentType?: string | null } = {},
): HttpResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null) },
    text: async () => rumpf,
  };
}

const erfolg = (daten: unknown): HttpResponseLike => antwort(JSON.stringify({ status: 'success', message: '', data: daten }));
const fachfehler = (meldung: string): HttpResponseLike => antwort(JSON.stringify({ status: 'error', message: meldung, data: undefined }));

/** Fake-fetch, das jede Anfrage mitschreibt und der Reihe nach antwortet. */
function fetchFake(antworten: HttpResponseLike | HttpResponseLike[]): { holen: FetchLike; aufrufe: Aufruf[] } {
  const warteschlange = Array.isArray(antworten) ? [...antworten] : null;
  const aufrufe: Aufruf[] = [];
  const holen: FetchLike = async (url, init) => {
    aufrufe.push({ url, init });
    if (warteschlange) {
      const naechste = warteschlange.shift();
      if (!naechste) throw new Error('Fake: keine Antwort mehr hinterlegt');
      return naechste;
    }
    return antworten as HttpResponseLike;
  };
  return { holen, aufrufe };
}

const apiSchluesselWeg = () => apiKeyAuth({ apiKey: API_KEY, cashregisterToken: KASSEN_TOKEN });
const kassenBenutzerWeg = () =>
  registerUserAuth({ getIdToken: () => ID_TOKEN, getSessionId: () => SITZUNG, cashregisterId: 'kasse-1' });

// --- Anfrage bauen -----------------------------------------------------

test('Aufruf geht als POST an <basis>/<funktionsname> mit JSON-Rumpf {params}', async () => {
  const { holen, aufrufe } = fetchFake(erfolg({ ok: true }));
  const rufen = createTransport({ auth: apiSchluesselWeg(), fetch: holen });

  await rufen('createReceipt', { receiptId: 'r1' });

  assert.equal(aufrufe.length, 1);
  const [aufruf] = aufrufe;
  assert.equal(aufruf!.url, `${DEFAULT_BASE_URL}/createReceipt`);
  assert.equal(aufruf!.init.method, 'POST');
  assert.equal(aufruf!.init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(aufruf!.init.body), { params: { receiptId: 'r1' } });
});

test('Basis-URL ist konfigurierbar (eigene Rewrites der Browser-Kasse)', async () => {
  const { holen, aufrufe } = fetchFake(erfolg({}));
  const rufen = createTransport({ auth: apiSchluesselWeg(), fetch: holen, baseUrl: 'https://kasse.example.at/api/v1/' });

  await rufen('getReceipt', { receiptId: 'r1' });

  assert.equal(aufrufe[0]!.url, 'https://kasse.example.at/api/v1/getReceipt');
});

test('Vorgabewerte: Basis-URL und Zeitlimit wie im Flutter-Zwilling', () => {
  assert.equal(DEFAULT_BASE_URL, 'https://api.kasseneck.at/v1');
  assert.equal(DEFAULT_TIMEOUT_MS, 30000);
});

// --- Die zwei Anmeldewege am selben Aufruf -----------------------------

test('derselbe Aufruf: apiKeyAuth erzeugt die eine, registerUserAuth die andere Kopfzeile', async () => {
  const mitSchluessel = fetchFake(erfolg({}));
  await createTransport({ auth: apiSchluesselWeg(), fetch: mitSchluessel.holen })('createReceipt', { receiptId: 'r1' });

  const mitBenutzer = fetchFake(erfolg({}));
  await createTransport({ auth: kassenBenutzerWeg(), fetch: mitBenutzer.holen })('createReceipt', { receiptId: 'r1' });

  const kopfSchluessel = mitSchluessel.aufrufe[0]!.init.headers;
  const kopfBenutzer = mitBenutzer.aufrufe[0]!.init.headers;

  assert.equal(kopfSchluessel['Authorization'], `Bearer ${API_KEY}`);
  assert.equal(kopfSchluessel['cashregister-token'], KASSEN_TOKEN);
  assert.equal(kopfSchluessel['register-session'], undefined);

  assert.equal(kopfBenutzer['Authorization'], `Bearer ${ID_TOKEN}`);
  assert.equal(kopfBenutzer['register-session'], SITZUNG);
  assert.equal(kopfBenutzer['cashregister-token'], undefined);

  // Die Kasse geht nur beim Kassen-Benutzer-Weg als Parameter mit.
  assert.deepEqual(JSON.parse(mitSchluessel.aufrufe[0]!.init.body), { params: { receiptId: 'r1' } });
  assert.deepEqual(JSON.parse(mitBenutzer.aufrufe[0]!.init.body), {
    params: { cashregisterId: 'kasse-1', receiptId: 'r1' },
  });
});

test('Token und Sitzung werden bei jedem Aufruf frisch geholt, nicht beim Anlegen gemerkt', async () => {
  // Ein einmal gemerktes ID-Token waere nach einer Stunde tot, die Sitzung der
  // Browser-Kasse schon nach 90 Sekunden.
  let tokenNr = 0;
  let sitzungNr = 0;
  const { holen, aufrufe } = fetchFake([erfolg({}), erfolg({})]);
  const rufen = createTransport({
    auth: registerUserAuth({
      getIdToken: () => `token-${++tokenNr}`,
      getSessionId: () => `sess-${++sitzungNr}`,
      cashregisterId: 'kasse-1',
    }),
    fetch: holen,
  });
  assert.equal(tokenNr, 0, 'createTransport darf noch kein Token holen');

  await rufen('getReceipt', { receiptId: 'r1' });
  await rufen('getReceipt', { receiptId: 'r2' });

  assert.equal(aufrufe[0]!.init.headers['Authorization'], 'Bearer token-1');
  assert.equal(aufrufe[1]!.init.headers['Authorization'], 'Bearer token-2');
  assert.equal(aufrufe[0]!.init.headers['register-session'], 'sess-1');
  assert.equal(aufrufe[1]!.init.headers['register-session'], 'sess-2');
});

// --- Fehlerhuelle ------------------------------------------------------

test('Erfolg liefert die Nutzlast ohne Huelle', async () => {
  const { holen } = fetchFake(erfolg({ receiptId: 'r1', sum: 1234 }));
  const rufen = createTransport({ auth: apiSchluesselWeg(), fetch: holen });

  const ergebnis = await rufen<{ receiptId: string; sum: number }>('getReceipt', { receiptId: 'r1' });

  assert.deepEqual(ergebnis, { receiptId: 'r1', sum: 1234 });
  assert.equal((ergebnis as Record<string, unknown>)['status'], undefined, 'die Huelle darf nicht durchschlagen');
  assert.equal((ergebnis as Record<string, unknown>)['data'], undefined);
});

test('fachlicher Fehler (HTTP 200, status=error) wirft mit Backend-Meldung UND Funktionsname', async () => {
  const { holen } = fetchFake(fachfehler('Kasse ist gesperrt'));
  const rufen = createTransport({ auth: apiSchluesselWeg(), fetch: holen });

  await assert.rejects(rufen('createReceipt', { receiptId: 'r1' }), (fehler: unknown) => {
    assert.ok(fehler instanceof KasseneckApiError, 'muss KasseneckApiError sein');
    assert.match(fehler.message, /Kasse ist gesperrt/);
    assert.match(fehler.message, /createReceipt/);
    assert.equal(fehler.functionName, 'createReceipt');
    assert.equal(fehler.serverMessage, 'Kasse ist gesperrt');
    return true;
  });
});

test('fachlicher Fehler ohne Meldung bekommt trotzdem eine lesbare Meldung', async () => {
  const { holen } = fetchFake(antwort(JSON.stringify({ status: 'error', message: '' })));
  const rufen = createTransport({ auth: apiSchluesselWeg(), fetch: holen });

  await assert.rejects(rufen('zeroReceipt'), (fehler: unknown) => {
    assert.ok(fehler instanceof KasseneckApiError);
    assert.match(fehler.message, /zeroReceipt/);
    assert.ok(fehler.message.trim().length > 'zeroReceipt'.length);
    return true;
  });
});

test('unbekannter Statuswert gilt als fachlicher Fehler, nicht als Erfolg', async () => {
  const { holen } = fetchFake(antwort(JSON.stringify({ status: 'pending', data: { a: 1 } })));
  const rufen = createTransport({ auth: apiSchluesselWeg(), fetch: holen });

  await assert.rejects(rufen('createReceipt'), (fehler: unknown) => isKasseneckApiError(fehler));
});

// --- Die drei Fehlerarten sind unterscheidbar --------------------------

test('HTTP-Fehler (500) ist kein fachlicher Fehler', async () => {
  const { holen } = fetchFake(antwort('<html>Internal Server Error</html>', { status: 500, contentType: 'text/html' }));
  const rufen = createTransport({ auth: apiSchluesselWeg(), fetch: holen });

  await assert.rejects(rufen('createReceipt'), (fehler: unknown) => {
    assert.ok(fehler instanceof KasseneckHttpError, 'muss KasseneckHttpError sein');
    assert.ok(!(fehler instanceof KasseneckApiError));
    assert.ok(!(fehler instanceof KasseneckNetworkError));
    assert.equal(fehler.statusCode, 500);
    assert.equal(fehler.functionName, 'createReceipt');
    assert.ok(isKasseneckHttpError(fehler) && !isKasseneckApiError(fehler) && !isKasseneckNetworkError(fehler));
    return true;
  });
});

test('HTML statt JSON bei HTTP 200 (fehlender Rewrite) ist ein HTTP-Fehler, kein fachlicher', async () => {
  const { holen } = fetchFake(antwort('<!doctype html><html><body>App</body></html>', { contentType: 'text/html; charset=utf-8' }));
  const rufen = createTransport({ auth: apiSchluesselWeg(), fetch: holen, baseUrl: 'https://kasse.example.at/v1' });

  await assert.rejects(rufen('getReceipt'), (fehler: unknown) => {
    assert.ok(fehler instanceof KasseneckHttpError, 'muss KasseneckHttpError sein');
    assert.equal(fehler.statusCode, 200);
    assert.match(fehler.contentType ?? '', /text\/html/);
    assert.match(fehler.message, /getReceipt/);
    return true;
  });
});

test('leerer Rumpf ist ein HTTP-Fehler', async () => {
  const { holen } = fetchFake(antwort(''));
  const rufen = createTransport({ auth: apiSchluesselWeg(), fetch: holen });
  await assert.rejects(rufen('getReceipt'), (fehler: unknown) => isKasseneckHttpError(fehler));
});

test('JSON ohne Statusfeld ist ein HTTP-Fehler, kein stiller Erfolg', async () => {
  const { holen } = fetchFake(antwort(JSON.stringify({ irgendwas: true })));
  const rufen = createTransport({ auth: apiSchluesselWeg(), fetch: holen });
  await assert.rejects(rufen('getReceipt'), (fehler: unknown) => isKasseneckHttpError(fehler));
});

test('Netzfehler ist von fachlichem und HTTP-Fehler unterscheidbar', async () => {
  const holen: FetchLike = async () => {
    throw new TypeError('fetch failed');
  };
  const rufen = createTransport({ auth: apiSchluesselWeg(), fetch: holen });

  await assert.rejects(rufen('createReceipt'), (fehler: unknown) => {
    assert.ok(fehler instanceof KasseneckNetworkError, 'muss KasseneckNetworkError sein');
    assert.ok(!(fehler instanceof KasseneckApiError));
    assert.ok(!(fehler instanceof KasseneckHttpError));
    assert.equal(fehler.timedOut, false);
    assert.equal(fehler.functionName, 'createReceipt');
    return true;
  });
});

test('Zeitueberschreitung bricht die Anfrage ab und meldet sich als solche', async () => {
  let gesehenerSignal: AbortSignal | undefined;
  const haengendesFetch: FetchLike = (_url, init) =>
    new Promise((_erfuellen, ablehnen) => {
      gesehenerSignal = init.signal;
      init.signal.addEventListener('abort', () => ablehnen(new Error('The operation was aborted')));
    });
  const rufen = createTransport({ auth: apiSchluesselWeg(), fetch: haengendesFetch, timeoutMs: 20 });

  await assert.rejects(rufen('createReceipt'), (fehler: unknown) => {
    assert.ok(fehler instanceof KasseneckNetworkError);
    assert.equal(fehler.timedOut, true, 'Zeitueberschreitung muss als solche erkennbar sein');
    assert.equal(fehler.timeoutMs, 20);
    assert.match(fehler.message, /createReceipt/);
    return true;
  });
  assert.equal(gesehenerSignal?.aborted, true, 'die Anfrage muss wirklich abgebrochen werden');
});

test('erfolgreicher Aufruf laesst keinen Wecker offen (Prozess darf enden)', async () => {
  const { holen } = fetchFake(erfolg({}));
  const rufen = createTransport({ auth: apiSchluesselWeg(), fetch: holen, timeoutMs: 60_000 });
  const vorher = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
  await rufen('getReceipt');
  const nachher = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
  assert.equal(nachher, vorher, 'der Zeitlimit-Wecker muss abgeraeumt werden');
});

// --- Kein Geheimnis in der Fehlermeldung -------------------------------

/** Alles, was ueblicherweise in Protokollen/Fehlerdiensten landet. */
function protokollSpuren(fehler: unknown): string[] {
  const err = fehler as Error;
  return [err.message, String(err), err.toString(), JSON.stringify(err), String(err.stack ?? '')];
}

test('kein Geheimnis in Fehlern des api_key-Wegs (alle drei Fehlerarten)', async () => {
  const faelle: Array<[string, FetchLike]> = [
    ['fachlich', async () => fachfehler('Kasse ist gesperrt')],
    ['http', async () => antwort('<html>500</html>', { status: 500, contentType: 'text/html' })],
    [
      'netz',
      async () => {
        throw new Error(`Verbindung zu api.kasseneck.at fehlgeschlagen`);
      },
    ],
  ];

  for (const [name, holen] of faelle) {
    const rufen = createTransport({ auth: apiSchluesselWeg(), fetch: holen });
    await assert.rejects(rufen('createReceipt', { receiptId: 'r1' }), (fehler: unknown) => {
      for (const spur of protokollSpuren(fehler)) {
        for (const geheim of geheimnisse) {
          assert.ok(!spur.includes(geheim), `Fall ${name}: Geheimnis "${geheim.slice(0, 12)}…" steckt in "${spur}"`);
        }
      }
      return true;
    });
  }
});

test('kein Geheimnis in Fehlern des Kassen-Benutzer-Wegs (alle drei Fehlerarten)', async () => {
  const faelle: FetchLike[] = [
    async () => fachfehler('Sitzung abgelaufen'),
    async () => antwort('nicht json', { status: 404, contentType: 'text/plain' }),
    async () => {
      throw new Error('socket hang up');
    },
  ];

  for (const holen of faelle) {
    const rufen = createTransport({ auth: kassenBenutzerWeg(), fetch: holen });
    await assert.rejects(rufen('createReceipt', { receiptId: 'r1' }), (fehler: unknown) => {
      for (const spur of protokollSpuren(fehler)) {
        for (const geheim of geheimnisse) {
          assert.ok(!spur.includes(geheim), `Geheimnis "${geheim.slice(0, 12)}…" steckt in "${spur}"`);
        }
      }
      return true;
    });
  }
});

test('kein Geheimnis in den eigenen Feldern eines Fehlers', async () => {
  const { holen } = fetchFake(fachfehler('Kasse ist gesperrt'));
  const rufen = createTransport({ auth: kassenBenutzerWeg(), fetch: holen });

  await assert.rejects(rufen('createReceipt', { receiptId: 'r1' }), (fehler: unknown) => {
    const felder = Object.entries(fehler as Record<string, unknown>);
    for (const [name, wert] of felder) {
      const text = typeof wert === 'string' ? wert : JSON.stringify(wert) ?? '';
      for (const geheim of geheimnisse) {
        assert.ok(!text.includes(geheim), `Feld ${name} traegt ein Geheimnis`);
      }
    }
    return true;
  });
});
