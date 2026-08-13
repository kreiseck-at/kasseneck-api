import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
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
  KasseneckAuthError,
  KasseneckHttpError,
  KasseneckNetworkError,
  isKasseneckApiError,
  isKasseneckAuthError,
  isKasseneckHttpError,
  isKasseneckNetworkError,
} from '../src/client/errors.js';
import { apiKeyAuth, registerUserAuth, type KasseneckAuth } from '../src/client/auth.js';

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

const offeneWecker = () => process.getActiveResourcesInfo().filter((eintrag) => eintrag === 'Timeout').length;

test('kein Aufruf laesst einen Wecker offen — auf keinem Pfad (Prozess darf enden)', async () => {
  // Zieht jemand das clearTimeout aus dem finally in den Erfolgszweig, faellt
  // genau hier auf, dass jeder Fehlerpfad den Prozess bis zum Zeitlimit
  // wachhaelt.
  const pfade: Array<[string, () => Promise<unknown>]> = [
    [
      'erfolg',
      () => createTransport({ auth: apiSchluesselWeg(), fetch: fetchFake(erfolg({})).holen, timeoutMs: 60_000 })('getReceipt'),
    ],
    [
      'fachlich',
      () =>
        createTransport({ auth: apiSchluesselWeg(), fetch: fetchFake(fachfehler('gesperrt')).holen, timeoutMs: 60_000 })(
          'getReceipt',
        ),
    ],
    [
      'http',
      () =>
        createTransport({
          auth: apiSchluesselWeg(),
          fetch: fetchFake(antwort('<html>500</html>', { status: 500, contentType: 'text/html' })).holen,
          timeoutMs: 60_000,
        })('getReceipt'),
    ],
    [
      'netz',
      () =>
        createTransport({
          auth: apiSchluesselWeg(),
          fetch: async () => {
            throw new TypeError('fetch failed');
          },
          timeoutMs: 60_000,
        })('getReceipt'),
    ],
    [
      'anmeldung',
      () =>
        createTransport({
          auth: () => {
            throw new Error('kaputt');
          },
          fetch: fetchFake(erfolg({})).holen,
          timeoutMs: 60_000,
        })('getReceipt'),
    ],
  ];

  for (const [name, pfad] of pfade) {
    const vorher = offeneWecker();
    await pfad().catch(() => undefined);
    assert.equal(offeneWecker(), vorher, `Pfad ${name}: der Zeitlimit-Wecker muss abgeraeumt werden`);
  }
});

// --- Kein Geheimnis in der Fehlermeldung -------------------------------

/**
 * Alles, was ueblicherweise in Protokollen/Fehlerdiensten landet. `inspect`
 * ist dabei der wichtigste Fall: genau das druckt `console.error(err)` — und
 * es folgt der `cause`-Kette, die weder `message` noch `JSON.stringify` sieht.
 */
function protokollSpuren(fehler: unknown): string[] {
  const err = fehler as Error;
  return [
    err.message,
    String(err),
    err.toString(),
    JSON.stringify(err),
    String(err.stack ?? ''),
    inspect(err, { depth: 5 }),
  ];
}

/** Wirft, wenn irgendeine Spur eines der Geheimnisse traegt. */
function keineGeheimnisse(fehler: unknown, hinweis = ''): true {
  for (const spur of protokollSpuren(fehler)) {
    for (const geheim of geheimnisse) {
      assert.ok(!spur.includes(geheim), `${hinweis}Geheimnis "${geheim.slice(0, 12)}…" steckt in "${spur}"`);
    }
  }
  return true;
}

/**
 * Fehler, wie ihn eine fremde fetch-Umsetzung wirft: axios haengt seine
 * `config` (samt Kopfzeilen!) an den Fehler, got seine `options`. Genau der
 * Erweiterungspunkt, den dieses Paket mit `options.fetch` anbietet.
 */
function proxyFehler(kopfzeilen: Record<string, string>): Error {
  return Object.assign(new Error('connect ECONNREFUSED 10.0.0.7:443'), {
    name: 'AxiosError',
    code: 'ECONNREFUSED',
    config: { url: 'https://api.kasseneck.at/v1/createReceipt', headers: kopfzeilen },
  });
}

test('kein Geheimnis in Fehlern des api_key-Wegs (alle vier Fehlerarten)', async () => {
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
    await assert.rejects(rufen('createReceipt', { receiptId: 'r1' }), (fehler: unknown) =>
      keineGeheimnisse(fehler, `Fall ${name}: `),
    );
  }

  // Vierte Fehlerart: die Anmeldung selbst scheitert und traegt die Geheimnisse
  // in Meldung und Code mit sich.
  const anmeldeFehler = createTransport({
    auth: () => {
      throw Object.assign(new Error(`Schluessel ${API_KEY} abgelehnt`), { name: 'KeyStoreError', code: KASSEN_TOKEN });
    },
    fetch: async () => erfolg({}),
  });
  await assert.rejects(anmeldeFehler('createReceipt'), (fehler: unknown) => keineGeheimnisse(fehler, 'Fall anmeldung: '));
});

test('kein Geheimnis in Fehlern des Kassen-Benutzer-Wegs (alle vier Fehlerarten)', async () => {
  const faelle: FetchLike[] = [
    async () => fachfehler('Sitzung abgelaufen'),
    async () => antwort('nicht json', { status: 404, contentType: 'text/plain' }),
    async () => {
      throw new Error('socket hang up');
    },
  ];

  for (const holen of faelle) {
    const rufen = createTransport({ auth: kassenBenutzerWeg(), fetch: holen });
    await assert.rejects(rufen('createReceipt', { receiptId: 'r1' }), (fehler: unknown) => keineGeheimnisse(fehler));
  }

  const anmeldeFehler = createTransport({
    auth: registerUserAuth({
      getIdToken: () => {
        throw Object.assign(new Error(`refresh fuer ${ID_TOKEN} fehlgeschlagen`), { name: 'FirebaseError', code: SITZUNG });
      },
      getSessionId: () => SITZUNG,
      cashregisterId: 'kasse-1',
    }),
    fetch: async () => erfolg({}),
  });
  await assert.rejects(anmeldeFehler('createReceipt'), (fehler: unknown) => keineGeheimnisse(fehler, 'Fall anmeldung: '));
});

test('der Anmeldepfad verdichtet keine fremde Ursache — dort ist kein Geheimnis bekannt', async () => {
  // Der Sitzungsbezeichner der Browser-Kasse ist bezeichner-foermig und kaeme
  // durch jeden reinen Formfilter. Auf dem Anmeldepfad liegt aber gar keine
  // Geheimnisliste vor (es wurde noch nichts gesendet), also gibt es dort
  // ueberhaupt keine Ursachen-Verdichtung.
  const rufen = createTransport({
    auth: registerUserAuth({
      getIdToken: () => {
        throw Object.assign(new Error('token refresh failed'), { name: 'FirebaseError', code: SITZUNG });
      },
      getSessionId: () => SITZUNG,
      cashregisterId: 'kasse-1',
    }),
    fetch: async () => erfolg({}),
  });

  await assert.rejects(rufen('createReceipt'), (fehler: unknown) => {
    assert.ok(fehler instanceof KasseneckAuthError);
    const felder = fehler as unknown as Record<string, unknown>;
    assert.equal(felder['causeCode'], undefined, 'ein bezeichner-foermiges Geheimnis darf nicht durchkommen');
    assert.equal(felder['causeName'], undefined);
    keineGeheimnisse(fehler);
    return true;
  });
});

// --- Eine unbrauchbare Anmeldung faellt nicht an der Union vorbei ------

test('eine unbrauchbare Anmeldung wird zum KasseneckAuthError, nicht zum rohen TypeError', async () => {
  // `auth()` ist der Erweiterungspunkt fuer fremden Code — die Typen verbieten
  // das hier zwar, zur Laufzeit kommt trotzdem an, was ankommt.
  const unbrauchbar: Array<[string, unknown]> = [
    ['undefined', undefined],
    ['null', null],
    ['String', API_KEY],
    ['ohne headers', { params: {} }],
    ['ohne params', { headers: { Authorization: `Bearer ${API_KEY}` } }],
    ['headers mit Zahl', { headers: { Authorization: 42 }, params: {} }],
  ];

  for (const [name, ergebnis] of unbrauchbar) {
    const { holen, aufrufe } = fetchFake(erfolg({}));
    const rufen = createTransport({ auth: () => ergebnis as never, fetch: holen });
    await assert.rejects(rufen('createReceipt'), (fehler: unknown) => {
      assert.ok(fehler instanceof KasseneckAuthError, `Fall ${name}: muss KasseneckAuthError sein`);
      assert.ok(!(fehler instanceof TypeError), `Fall ${name}: kein roher TypeError`);
      assert.match(fehler.message, /createReceipt/);
      // Der zurueckgegebene Wert selbst darf nicht in die Meldung wandern —
      // im Fall 'String' waere das der api_key.
      keineGeheimnisse(fehler, `Fall ${name}: `);
      return true;
    });
    assert.equal(aufrufe.length, 0, `Fall ${name}: ohne brauchbare Anmeldung geht nichts raus`);
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

test('kein Geheimnis, wenn die fremde fetch-Umsetzung die Kopfzeilen an ihren Fehler haengt', async () => {
  // Der Pfad, auf dem die Zusage wirklich brechen kann: `console.error(err)`
  // druckt die Ursachenkette mit — eine angehaengte axios-`config` traegt den
  // Bearer-Schluessel dann direkt ins Protokoll.
  const wege: Array<{ name: string; auth: KasseneckAuth; kopf: Record<string, string> }> = [
    { name: 'api_key', auth: apiSchluesselWeg(), kopf: { Authorization: `Bearer ${API_KEY}`, 'cashregister-token': KASSEN_TOKEN } },
    { name: 'kassenbenutzer', auth: kassenBenutzerWeg(), kopf: { Authorization: `Bearer ${ID_TOKEN}`, 'register-session': SITZUNG } },
  ];

  for (const weg of wege) {
    const rufen = createTransport({
      auth: weg.auth,
      fetch: async () => {
        throw proxyFehler(weg.kopf);
      },
    });
    await assert.rejects(rufen('createReceipt', { receiptId: 'r1' }), (fehler: unknown) => {
      assert.ok(fehler instanceof KasseneckNetworkError);
      keineGeheimnisse(fehler, `Weg ${weg.name}: `);
      // Die Ursache bleibt in verdichteter, geheimnisfreier Form erkennbar.
      assert.equal(fehler.causeName, 'AxiosError');
      assert.equal(fehler.causeCode, 'ECONNREFUSED');
      return true;
    });
  }
});

test('die verdichtete Ursache verwirft alles, was ein Geheimnis sein koennte', async () => {
  const rufen = createTransport({
    auth: kassenBenutzerWeg(),
    fetch: async () => {
      // Ein Fehlercode, der zufaellig (oder boswillig) den Sitzungsbezeichner
      // traegt, und ein Name, der gar kein Bezeichner ist.
      throw Object.assign(new Error('kaputt'), { name: `Fehler bei ${ID_TOKEN}`, code: SITZUNG });
    },
  });

  await assert.rejects(rufen('createReceipt'), (fehler: unknown) => {
    assert.ok(fehler instanceof KasseneckNetworkError);
    keineGeheimnisse(fehler);
    assert.equal(fehler.causeName, undefined, 'freier Text ist kein verwertbarer Name');
    assert.equal(fehler.causeCode, undefined, 'ein Code, der ein Geheimnis traegt, wird verworfen');
    return true;
  });
});

// --- Die Anmeldung als eigene, vierte Fehlerart ------------------------

test('scheiternde Anmeldung ist eine eigene Fehlerart, kein blanker Error', async () => {
  const { holen, aufrufe } = fetchFake(erfolg({}));
  const rufen = createTransport({
    auth: registerUserAuth({
      getIdToken: () => {
        // So wirft Firebase: Meldung samt Kontext, hier mitsamt Token.
        throw Object.assign(new Error(`auth/internal-error: refresh fuer ${ID_TOKEN} fehlgeschlagen`), {
          name: 'FirebaseError',
          code: 'auth/internal-error',
        });
      },
      getSessionId: () => SITZUNG,
      cashregisterId: 'kasse-1',
    }),
    fetch: holen,
  });

  await assert.rejects(rufen('createReceipt'), (fehler: unknown) => {
    assert.ok(fehler instanceof KasseneckAuthError, 'muss KasseneckAuthError sein');
    assert.ok(!(fehler instanceof KasseneckApiError));
    assert.ok(!(fehler instanceof KasseneckHttpError));
    assert.ok(!(fehler instanceof KasseneckNetworkError));
    assert.ok(isKasseneckAuthError(fehler) && !isKasseneckNetworkError(fehler));
    assert.equal(fehler.functionName, 'createReceipt');
    // Die fremde Meldung bleibt draussen; eine Ursachen-Verdichtung gibt es auf
    // diesem Pfad nicht (siehe Test zum Anmeldepfad weiter unten).
    assert.match(fehler.message, /Anmeldung fehlgeschlagen/);
    keineGeheimnisse(fehler);
    return true;
  });
  assert.equal(aufrufe.length, 0, 'ohne Anmeldung darf keine Anfrage rausgehen');
});

test('die eigenen Anmelde-Pruefungen kommen als KasseneckAuthError mit Funktionsname', async () => {
  const rufen = createTransport({
    auth: registerUserAuth({ getIdToken: () => '', getSessionId: () => SITZUNG, cashregisterId: 'kasse-1' }),
    fetch: async () => erfolg({}),
  });

  await assert.rejects(rufen('zeroReceipt'), (fehler: unknown) => {
    assert.ok(fehler instanceof KasseneckAuthError);
    assert.match(fehler.message, /zeroReceipt/);
    assert.match(fehler.message, /getIdToken/);
    keineGeheimnisse(fehler);
    return true;
  });
});

test('das Zeitlimit deckt auch die Anmeldung ab', async () => {
  // Haengt die Token-Erneuerung auf flauem Netz, darf der Aufruf nicht
  // unbegrenzt haengen — sonst steht die Kasse ohne Ergebnis und ohne Fehler da.
  const { holen, aufrufe } = fetchFake(erfolg({}));
  const rufen = createTransport({
    auth: registerUserAuth({
      getIdToken: () => new Promise<string>(() => {}),
      getSessionId: () => SITZUNG,
      cashregisterId: 'kasse-1',
    }),
    fetch: holen,
    timeoutMs: 20,
  });

  await assert.rejects(rufen('createReceipt'), (fehler: unknown) => {
    assert.ok(fehler instanceof KasseneckNetworkError, 'haengende Anmeldung ist eine Zeitueberschreitung');
    assert.equal(fehler.timedOut, true);
    assert.equal(fehler.timeoutMs, 20);
    return true;
  });
  assert.equal(aufrufe.length, 0);
});

// --- Nutzlast: die Kassenbindung darf nicht still verschwinden ---------

test('ein anwesender undefined-Parameter loescht die Kassenbindung nicht', async () => {
  // `{ …, cashregisterId: opts.cashregisterId }` ist in der Endpunkt-Schicht
  // das natuerlichste Muster der Welt — ist der Wert undefined, wuerde ein
  // reines Spread die Kasse aus der Nutzlast werfen (JSON.stringify laesst
  // undefined weg) und der Aufruf ginge ohne Kassenbindung raus.
  const { holen, aufrufe } = fetchFake(erfolg({}));
  const rufen = createTransport({ auth: kassenBenutzerWeg(), fetch: holen });

  await rufen('createReceipt', { receiptId: 'r1', cashregisterId: undefined });

  assert.deepEqual(JSON.parse(aufrufe[0]!.init.body), {
    params: { cashregisterId: 'kasse-1', receiptId: 'r1' },
  });
});

test('ein ausdruecklich gesetzter Aufruferwert sticht den Auth-Parameter', async () => {
  const { holen, aufrufe } = fetchFake(erfolg({}));
  const rufen = createTransport({ auth: kassenBenutzerWeg(), fetch: holen });

  await rufen('createReceipt', { cashregisterId: 'kasse-9' });

  assert.deepEqual(JSON.parse(aufrufe[0]!.init.body), { params: { cashregisterId: 'kasse-9' } });
});

test('ein null-Parameter bleibt erhalten (null ist eine Aussage, undefined nicht)', async () => {
  const { holen, aufrufe } = fetchFake(erfolg({}));
  const rufen = createTransport({ auth: apiSchluesselWeg(), fetch: holen });

  await rufen('createReceipt', { customProjectId: null });

  assert.deepEqual(JSON.parse(aufrufe[0]!.init.body), { params: { customProjectId: null } });
});

// --- Kein Wiederholen --------------------------------------------------

test('kein Aufruf wird wiederholt — auch nicht auf dem Fehlerpfad', async () => {
  // Der teure Fall waere der doppelte Beleg: ohne entschiedene Idempotenz
  // darf dieses Paket nie von sich aus ein zweites Mal senden.
  const faelle: Array<[string, FetchLike]> = [
    ['fachlich', async () => fachfehler('Kasse ist gesperrt')],
    ['http-500', async () => antwort('<html>500</html>', { status: 500, contentType: 'text/html' })],
    ['html-200', async () => antwort('<!doctype html>', { contentType: 'text/html' })],
    [
      'netz',
      async () => {
        throw new TypeError('fetch failed');
      },
    ],
  ];

  for (const [name, antwortGeber] of faelle) {
    let versuche = 0;
    const holen: FetchLike = (url, init) => {
      versuche += 1;
      return antwortGeber(url, init);
    };
    const rufen = createTransport({ auth: apiSchluesselWeg(), fetch: holen });
    await assert.rejects(rufen('createReceipt', { receiptId: 'r1' }));
    assert.equal(versuche, 1, `Fall ${name}: genau ein Versuch, kein zweiter Beleg`);
  }
});

// --- Grund des HTTP-Fehlers maschinenlesbar ----------------------------

test('der HTTP-Fehler nennt seinen Grund als eigenes Feld, nicht nur im Text', async () => {
  const faelle: Array<[string, HttpResponseLike]> = [
    ['server-error', antwort('<html>500</html>', { status: 500, contentType: 'text/html' })],
    ['not-json', antwort('<!doctype html><html></html>', { contentType: 'text/html' })],
    ['empty-body', antwort('')],
    ['missing-status', antwort(JSON.stringify({ irgendwas: true }))],
  ];

  for (const [grund, antwortWert] of faelle) {
    const { holen } = fetchFake(antwortWert);
    const rufen = createTransport({ auth: apiSchluesselWeg(), fetch: holen });
    await assert.rejects(rufen('getReceipt'), (fehler: unknown) => {
      assert.ok(fehler instanceof KasseneckHttpError);
      assert.equal(fehler.reason, grund, 'der Rewrite-Fall muss ohne Textparsen vom 500er trennbar sein');
      return true;
    });
  }
});
