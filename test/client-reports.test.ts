import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { downloadDailyReport, downloadMonthlyReport } from '../src/client/reports.js';
import { getCashboxStatus, getSignatureStatus } from '../src/client/status.js';
import { createKasseneckApi } from '../src/client/api.js';
import {
  createTransport,
  createBinaryTransport,
  DEFAULT_BASE_URL,
  type FetchLike,
  type HttpRequestInit,
  type HttpResponseLike,
} from '../src/client/transport.js';
import { apiKeyAuth, registerUserAuth } from '../src/client/auth.js';
import {
  KasseneckApiError,
  KasseneckAuthError,
  KasseneckHttpError,
  KasseneckNetworkError,
  KasseneckValidationError,
} from '../src/client/errors.js';
import type { ReportMonth } from '../src/models/index.js';

/**
 * Vertragstests der Bericht- und Status-Aufrufe: welcher Endpunktname geht
 * raus, mit welchen Parameternamen und -werten.
 *
 * Die Erwartungen sind aus dem Flutter-Vorbild
 * (kasseneck_api/lib/kasseneck_api.dart, Zeilen 113-128 und 410-440)
 * **abgeschrieben**, nicht aus der Umsetzung dieses Pakets abgeleitet. Das ist
 * hier besonders wichtig: `downloadMonthlyReport` ruft den Endpunkt
 * `downloadReport` — Methodenname und Endpunktname fallen auseinander, und eine
 * aus der eigenen Umsetzung abgeleitete Erwartung wuerde genau diesen Fehler
 * mitschreiben.
 */

const API_KEY = 'kr_live_GEHEIMERAPIKEY';
const KASSEN_TOKEN = 'cb_live_GEHEIMESKASSENTOKEN';
const ID_TOKEN = 'eyJ-GEHEIMESIDTOKEN';
const SITZUNG = 'sess-GEHEIMESITZUNG';
const KASSEN_ID = 'kasse-1';
const GEHEIMNISSE = [API_KEY, KASSEN_TOKEN];

interface Aufruf {
  url: string;
  init: HttpRequestInit;
}

const apiSchluesselWeg = () => apiKeyAuth({ apiKey: API_KEY, cashregisterToken: KASSEN_TOKEN });

/**
 * JSON-Antwort im Sinn von `HttpResponseLike` (Fake, kein echtes fetch).
 *
 * Sie traegt **beide** Seiten desselben Rumpfs: Text und Bytes. Nur so laesst
 * sich derselbe Fall ueber den JSON- **und** ueber den Binaerweg schicken. Eine
 * Attrappe ohne Bytes brachte den Binaerweg schon beim Lesen zu Fall — die
 * Auswertung, um die es in solchen Tests geht, lief dann nie.
 */
function jsonAntwort(
  rumpf: string,
  { status = 200, contentType = 'application/json' }: { status?: number; contentType?: string | null } = {},
): HttpResponseLike {
  return {
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null) },
    text: async () => rumpf,
    arrayBuffer: async () => new TextEncoder().encode(rumpf).buffer,
  };
}

const erfolg = (daten: unknown): HttpResponseLike => jsonAntwort(JSON.stringify({ status: 'success', message: '', data: daten }));

/**
 * Binaerantwort: liefert Bytes ueber `arrayBuffer()` und **wirft** in `text()`.
 * Das Werfen ist Absicht — ein Binaerweg, der die Antwort als Zeichenkette
 * liest, faellt damit sofort auf und nicht erst an zerstoerten Bytes.
 */
function binaerAntwort(
  bytes: Uint8Array,
  { status = 200, contentType = 'application/pdf' }: { status?: number; contentType?: string | null } = {},
): HttpResponseLike {
  return {
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null) },
    text: async () => {
      throw new Error('Der Binaerweg darf text() nicht anfassen');
    },
    arrayBuffer: async () => bytes.slice().buffer,
  };
}

/** Fehlerhuelle des Backends, wie sie auf dem Binaerweg ankommt: HTTP 200 + JSON. */
function huelleAlsBinaerAntwort(huelle: unknown, contentType: string | null = 'application/json'): HttpResponseLike {
  return binaerAntwort(new TextEncoder().encode(JSON.stringify(huelle)), { contentType });
}

function fetchFake(antwortWert: HttpResponseLike): { holen: FetchLike; aufrufe: Aufruf[] } {
  const aufrufe: Aufruf[] = [];
  const holen: FetchLike = async (url, init) => {
    aufrufe.push({ url, init });
    return antwortWert;
  };
  return { holen, aufrufe };
}

const jsonWeg = (holen: FetchLike) => createTransport({ auth: apiSchluesselWeg(), fetch: holen });
const binaerWeg = (holen: FetchLike) => createBinaryTransport({ auth: apiSchluesselWeg(), fetch: holen });

/**
 * Ein PDF mit Bytes ueber 0x7F. `0xC3 0x28` ist eine ungueltige UTF-8-Folge,
 * `0x80`/`0xFF` sind einzeln nie gueltiges UTF-8 — eine Textdeutung ersetzt sie
 * durch U+FFFD, und die Datei ist hin.
 */
const PDF_BYTES = new Uint8Array([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, // "%PDF-1.7\n"
  0x80, 0xff, 0xc3, 0x28, 0xfe, 0x81,
  0x25, 0x25, 0x45, 0x4f, 0x46, // "%%EOF"
]);

const rumpfVon = (aufruf: Aufruf): { params?: Record<string, unknown>; method?: unknown } => JSON.parse(aufruf.init.body);

// --- downloadDailyReport ------------------------------------------------

test('downloadDailyReport ruft den Endpunkt downloadDailyReport mit year/month/day', async () => {
  const { holen, aufrufe } = fetchFake(binaerAntwort(PDF_BYTES));

  await downloadDailyReport(binaerWeg(holen), new Date('2026-03-17T09:00:00+01:00'));

  assert.equal(aufrufe.length, 1);
  assert.equal(aufrufe[0]!.url, `${DEFAULT_BASE_URL}/downloadDailyReport`);
  assert.deepEqual(rumpfVon(aufrufe[0]!), { params: { year: 2026, month: 3, day: 17 } });
});

test('downloadDailyReport nimmt den Tag der Wiener Wanduhr, nicht den des Rechners', async () => {
  // Beide Zeitpunkte liegen in Wien und auf dem ausfuehrenden Rechner an
  // verschiedenen Tagen — je nach Zeitzone der Suite (Vienna/UTC/Kiritimati).
  const faelle: Array<[string, Date, { year: number; month: number; day: number }]> = [
    // Wien 01.03.2026 00:30 (Winterzeit, UTC+1) — in UTC noch der 28. Februar.
    ['Monatswechsel kurz nach Mitternacht', new Date('2026-02-28T23:30:00Z'), { year: 2026, month: 3, day: 1 }],
    // Wien 01.03.2026 22:00 — auf Kiritimati (UTC+14) schon der 2. Maerz.
    ['Abend vor dem Datumswechsel im Osten', new Date('2026-03-01T21:00:00Z'), { year: 2026, month: 3, day: 1 }],
  ];

  for (const [name, zeitpunkt, erwartet] of faelle) {
    const { holen, aufrufe } = fetchFake(binaerAntwort(PDF_BYTES));
    await downloadDailyReport(binaerWeg(holen), zeitpunkt);
    assert.deepEqual(rumpfVon(aufrufe[0]!).params, erwartet, `Fall ${name}: Wiener Kalendertag`);
  }
});

test('downloadDailyReport lehnt einen unbrauchbaren Zeitpunkt ab, bevor etwas rausgeht', async () => {
  const { holen, aufrufe } = fetchFake(binaerAntwort(PDF_BYTES));

  await assert.rejects(downloadDailyReport(binaerWeg(holen), new Date('kein Datum')), (fehler: unknown) => {
    assert.ok(fehler instanceof KasseneckValidationError);
    assert.equal(fehler.scope, 'request');
    assert.equal(fehler.functionName, 'downloadDailyReport');
    return true;
  });
  assert.equal(aufrufe.length, 0, 'ohne brauchbaren Tag darf keine Anfrage rausgehen');
});

// --- downloadMonthlyReport ----------------------------------------------

test('downloadMonthlyReport ruft den Endpunkt downloadReport (nicht downloadMonthlyReport)', async () => {
  const { holen, aufrufe } = fetchFake(binaerAntwort(PDF_BYTES));

  await downloadMonthlyReport(binaerWeg(holen), { month: 3, year: 2026 });

  assert.equal(aufrufe.length, 1);
  // Abgeschrieben aus dem Dart-Vorbild: `endpoint: 'downloadReport'`.
  assert.equal(aufrufe[0]!.url, `${DEFAULT_BASE_URL}/downloadReport`);
  assert.ok(
    !aufrufe[0]!.url.endsWith('/downloadMonthlyReport'),
    'der Endpunktname folgt dem Vorbild, nicht dem Methodennamen',
  );
});

test('downloadMonthlyReport sendet month als Zahl 1-12, nicht als Name und nicht nullbasiert', async () => {
  const faelle: Array<[ReportMonth, number]> = [
    [{ month: 1, year: 2026 }, 1],
    [{ month: 3, year: 2026 }, 3],
    [{ month: 12, year: 2025 }, 12],
  ];

  for (const [berichtsmonat, erwarteteZahl] of faelle) {
    const { holen, aufrufe } = fetchFake(binaerAntwort(PDF_BYTES));
    await downloadMonthlyReport(binaerWeg(holen), berichtsmonat);
    const params = rumpfVon(aufrufe[0]!).params!;
    assert.equal(typeof params['month'], 'number', 'month geht als Zahl raus (KeckMonth.id im Vorbild)');
    assert.equal(params['month'], erwarteteZahl);
    assert.equal(params['year'], berichtsmonat.year);
    assert.deepEqual(params, { month: erwarteteZahl, year: berichtsmonat.year });
  }
});

test('downloadMonthlyReport lehnt einen unmoeglichen Monat ab, bevor etwas rausgeht', async () => {
  for (const kaputt of [{ month: 0, year: 2026 }, { month: 13, year: 2026 }, { month: Number.NaN, year: 2026 }]) {
    const { holen, aufrufe } = fetchFake(binaerAntwort(PDF_BYTES));
    await assert.rejects(downloadMonthlyReport(binaerWeg(holen), kaputt), (fehler: unknown) => {
      assert.ok(fehler instanceof KasseneckValidationError);
      assert.equal(fehler.scope, 'request');
      return true;
    });
    assert.equal(aufrufe.length, 0, `Monat ${kaputt.month}: keine Anfrage`);
  }
});

// --- Binaerdaten bleiben Binaerdaten ------------------------------------

test('das PDF kommt Byte fuer Byte an — auch Bytes ueber 0x7F', async () => {
  // Vorbedingung: eine Textdeutung wuerde dieses PDF nachweislich zerstoeren.
  const nachTextdeutung = new TextEncoder().encode(new TextDecoder().decode(PDF_BYTES));
  assert.notDeepEqual(
    Array.from(nachTextdeutung),
    Array.from(PDF_BYTES),
    'Vorbedingung des Tests: UTF-8-Deutung muss diese Bytefolge zerstoeren',
  );

  const { holen } = fetchFake(binaerAntwort(PDF_BYTES));
  const pdf = await downloadDailyReport(binaerWeg(holen), new Date('2026-03-17T09:00:00+01:00'));

  assert.ok(pdf instanceof Uint8Array, 'Berichte sind Binaerdaten, keine Zeichenkette');
  assert.deepEqual(Array.from(pdf), Array.from(PDF_BYTES));
});

test('eine Fehlerhuelle wird auf dem Binaerweg als Fehler geworfen, nicht als PDF durchgereicht', async () => {
  const faelle: Array<[string, HttpResponseLike]> = [
    [
      'Inhaltstyp JSON',
      huelleAlsBinaerAntwort({ status: 'error', message: 'Kasse ist gesperrt', data: null }),
    ],
    [
      // Ein Proxy davor kann den Inhaltstyp verlieren; die Bytes entscheiden.
      'Inhaltstyp fehlt',
      huelleAlsBinaerAntwort({ status: 'error', message: 'Kasse ist gesperrt', data: null }, null),
    ],
    [
      'Inhaltstyp faelschlich application/pdf',
      huelleAlsBinaerAntwort({ status: 'error', message: 'Kasse ist gesperrt', data: null }, 'application/pdf'),
    ],
  ];

  for (const [name, antwortWert] of faelle) {
    const { holen } = fetchFake(antwortWert);
    let ergebnis: unknown = 'nichts geworfen';
    try {
      ergebnis = await downloadMonthlyReport(binaerWeg(holen), { month: 3, year: 2026 });
    } catch (fehler) {
      assert.ok(fehler instanceof KasseneckApiError, `Fall ${name}: fachlicher Fehler wie auf dem JSON-Weg`);
      assert.equal(fehler.serverMessage, 'Kasse ist gesperrt');
      assert.equal(fehler.functionName, 'downloadReport');
      continue;
    }
    assert.fail(`Fall ${name}: die Fehlerhuelle kam als Nutzlast durch (${inspect(ergebnis).slice(0, 80)})`);
  }
});

test('eine Erfolgshuelle ohne PDF ist ein Antwortfehler, kein Bericht', async () => {
  const { holen } = fetchFake(huelleAlsBinaerAntwort({ status: 'success', message: '', data: { irgendwas: true } }));

  await assert.rejects(downloadMonthlyReport(binaerWeg(holen), { month: 3, year: 2026 }), (fehler: unknown) => {
    assert.ok(fehler instanceof KasseneckValidationError);
    assert.equal(fehler.scope, 'response');
    return true;
  });
});

test('der Binaerweg trennt seine Fehlerfaelle mit denselben Gruenden wie der JSON-Weg', async () => {
  // Kein eigener Sammelgrund fuer "kein PDF": der fehlende Rewrite (HTML-Seite
  // der Single-Page-App) und ein geaenderter Backend-Vertrag (JSON ohne
  // Statusfeld) bedeuten betrieblich Verschiedenes und heissen deshalb hier wie
  // dort `not-json` und `missing-status`.
  const faelle: Array<[string, HttpResponseLike]> = [
    ['server-error', binaerAntwort(new Uint8Array([0x35, 0x30, 0x30]), { status: 500, contentType: 'text/html' })],
    ['empty-body', binaerAntwort(new Uint8Array())],
    ['not-json', binaerAntwort(new TextEncoder().encode('<!doctype html><html></html>'), { contentType: 'text/html' })],
    ['missing-status', binaerAntwort(new TextEncoder().encode('{"irgendwas":true}'))],
  ];

  for (const [grund, antwortWert] of faelle) {
    const { holen } = fetchFake(antwortWert);
    await assert.rejects(downloadMonthlyReport(binaerWeg(holen), { month: 3, year: 2026 }), (fehler: unknown) => {
      assert.ok(fehler instanceof KasseneckHttpError, `Fall ${grund}`);
      assert.equal(fehler.reason, grund);
      return true;
    });
  }
});

// --- getCashboxStatus ---------------------------------------------------

test('getCashboxStatus ruft financeWebService mit method status_cashbox', async () => {
  const { holen, aufrufe } = fetchFake(erfolg({ rkdbMessage: { rc: '0', status: 'IN_BETRIEB' } }));

  const status = await getCashboxStatus(jsonWeg(holen));

  assert.equal(aufrufe.length, 1);
  assert.equal(aufrufe[0]!.url, `${DEFAULT_BASE_URL}/financeWebService`);
  // `method` steht im Vorbild NEBEN `params`, nicht darin.
  assert.deepEqual(rumpfVon(aufrufe[0]!), { params: {}, method: 'status_cashbox' });
  assert.equal(status, 'IN_BETRIEB');
});

test('getCashboxStatus meldet eine Antwort ohne Status als Antwortfehler', async () => {
  const { holen } = fetchFake(erfolg({ rkdbMessage: { rc: '0' } }));

  await assert.rejects(getCashboxStatus(jsonWeg(holen)), (fehler: unknown) => {
    assert.ok(fehler instanceof KasseneckValidationError);
    assert.equal(fehler.scope, 'response');
    return true;
  });
});

test('getCashboxStatus reicht einen noch unbekannten Status unveraendert durch', async () => {
  const { holen } = fetchFake(erfolg({ rkdbMessage: { rc: '0', status: 'AUSSER_BETRIEB' } }));

  assert.equal(await getCashboxStatus(jsonWeg(holen)), 'AUSSER_BETRIEB');
});

// --- getSignatureStatus -------------------------------------------------

test('getSignatureStatus ruft financeWebService mit method status_signature und zertifikatnr_hex', async () => {
  const { holen, aufrufe } = fetchFake(erfolg({ rkdbMessage: { rc: '0', status: 'AUSFALL' } }));

  const status = await getSignatureStatus(jsonWeg(holen), '6F0404F0');

  assert.equal(aufrufe[0]!.url, `${DEFAULT_BASE_URL}/financeWebService`);
  assert.deepEqual(rumpfVon(aufrufe[0]!), { params: { zertifikatnr_hex: '6F0404F0' }, method: 'status_signature' });
  assert.equal(status, 'AUSFALL');
});

test('getSignatureStatus liest rc B33 VOR dem Status: nicht registriert schlaegt jeden Statuswert', async () => {
  // Die Reihenfolge ist die Aussage: kommt B33 zusammen mit einem Statusfeld,
  // gilt trotzdem NOT_REGISTERED (so das Vorbild). Ein Pruefen des Status
  // zuerst wuerde eine nie registrierte Karte als "in Betrieb" melden.
  const { holen } = fetchFake(erfolg({ rkdbMessage: { rc: 'B33', msg: 'nicht registriert', status: 'IN_BETRIEB' } }));

  assert.equal(await getSignatureStatus(jsonWeg(holen), '6F0404F0'), 'NOT_REGISTERED');
});

test('getSignatureStatus verlangt eine Zertifikatsnummer, bevor etwas rausgeht', async () => {
  const { holen, aufrufe } = fetchFake(erfolg({ rkdbMessage: { rc: '0', status: 'IN_BETRIEB' } }));

  await assert.rejects(getSignatureStatus(jsonWeg(holen), ''), (fehler: unknown) => {
    assert.ok(fehler instanceof KasseneckValidationError);
    assert.equal(fehler.scope, 'request');
    return true;
  });
  assert.equal(aufrufe.length, 0);
});

// --- Zusagen des Pakets -------------------------------------------------

/** Alle vier Aufrufe dieses Tasks, jeweils an ein Fake-fetch gebunden. */
const alleAufrufe: Array<[string, (holen: FetchLike) => Promise<unknown>]> = [
  ['downloadDailyReport', (holen) => downloadDailyReport(binaerWeg(holen), new Date('2026-03-17T09:00:00+01:00'))],
  ['downloadMonthlyReport', (holen) => downloadMonthlyReport(binaerWeg(holen), { month: 3, year: 2026 })],
  ['getCashboxStatus', (holen) => getCashboxStatus(jsonWeg(holen))],
  ['getSignatureStatus', (holen) => getSignatureStatus(jsonWeg(holen), '6F0404F0')],
];

/**
 * Stoerungen, die **beide** Wege gleich treffen muessen: die Attrappen tragen
 * Text und Bytes, ein Binaeraufruf laeuft damit wirklich durch `pdfAuswerten`
 * und nicht in einen Lesefehler.
 */
const stoerungen: Array<[string, FetchLike, string]> = [
  [
    'Netz weg',
    async () => {
      throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    },
    'Network',
  ],
  ['HTTP 500', async () => jsonAntwort('<html>500</html>', { status: 500, contentType: 'text/html' }), 'Http:server-error'],
  // HTTP 200 mit HTML: der Aufruf landete mangels Rewrite auf der Single-Page-App.
  ['HTML statt Antwort', async () => jsonAntwort('<html>oops</html>', { contentType: 'text/html' }), 'Http:not-json'],
  ['leere Antwort', async () => jsonAntwort(''), 'Http:empty-body'],
  ['JSON ohne Statusfeld', async () => jsonAntwort('{"irgendwas":true}'), 'Http:missing-status'],
  ['fachlicher Fehler', async () => jsonAntwort(JSON.stringify({ status: 'error', message: 'nein', data: null })), 'Api'],
];

/** Kurzform eines Fehlers — `fremd:` fuer alles ausserhalb der Union. */
function kennung(fehler: unknown): string {
  if (fehler instanceof KasseneckHttpError) return `Http:${fehler.reason}`;
  if (fehler instanceof KasseneckApiError) return 'Api';
  if (fehler instanceof KasseneckNetworkError) return 'Network';
  if (fehler instanceof KasseneckAuthError) return 'Auth';
  if (fehler instanceof KasseneckValidationError) return `Validation:${fehler.reason}`;
  return `fremd:${inspect(fehler)}`;
}

test('alle vier Aufrufe melden dieselbe Stoerung als denselben Fehler der Union', async () => {
  // Zwei Aussagen in einer: aus keinem Aufruf faellt ein nacktes Error, und der
  // Binaerweg ordnet dieselben Stoerungen genauso ein wie der JSON-Weg. Die
  // erwartete Kennung steht neben der Stoerung — ein Aufruf, der stattdessen im
  // Lesen scheitert (`Validation:… arrayBuffer …`), faellt damit auf, statt die
  // Zusage nur scheinbar zu erfuellen.
  for (const [name, aufruf] of alleAufrufe) {
    for (const [stoerung, holen, erwartet] of stoerungen) {
      await assert.rejects(aufruf(holen), (fehler: unknown) => {
        assert.equal(kennung(fehler), erwartet, `${name} / ${stoerung}`);
        return true;
      });
    }
  }
});

test('kein Geheimnis wandert in einen Fehler dieser vier Aufrufe', async () => {
  const undichteStellen: Array<[string, FetchLike]> = [
    [
      'fremde Ursache mit Bearer',
      async () => {
        // Eine fremde Bibliothek haengt gern die Anfrage samt Bearer an ihren Fehler.
        throw Object.assign(new Error(`Anfrage fehlgeschlagen: Bearer ${API_KEY}`), {
          code: 'ECONNRESET',
          config: { headers: { Authorization: `Bearer ${API_KEY}`, 'cashregister-token': KASSEN_TOKEN } },
        });
      },
    ],
    [
      // Ein fremder Proxy kann die Anfrage zurueckspiegeln — der EMPFANGENE
      // Rumpf gehoert deshalb genauso wenig in einen Fehler wie der gesendete.
      'Antwortrumpf spiegelt die Anfrage',
      async () =>
        jsonAntwort(`<html>Authorization: Bearer ${API_KEY}\ncashregister-token: ${KASSEN_TOKEN}</html>`, {
          contentType: 'text/html',
        }),
    ],
    [
      'Erfolgsrumpf mit Zugangsdaten',
      async () => jsonAntwort(JSON.stringify({ status: 'success', message: '', data: { echo: API_KEY } })),
    ],
    ['fachlicher Fehler', async () => jsonAntwort(JSON.stringify({ status: 'error', message: 'nein', data: null }))],
  ];

  for (const [name, aufruf] of alleAufrufe) {
    for (const [stelle, holen] of undichteStellen) {
      try {
        await aufruf(holen);
        // Der Erfolgsrumpf mit Zugangsdaten geht bei den Statusabfragen nicht
        // durch (kein Status), bei den Downloads nicht (kein PDF) — faellt einer
        // dennoch durch, ist nichts zu pruefen und der Fall ist harmlos.
        continue;
      } catch (fehler) {
        const abdruck = inspect(fehler, { depth: 10 }) + String((fehler as Error).message);
        for (const geheim of GEHEIMNISSE) {
          assert.ok(!abdruck.includes(geheim), `${name} / ${stelle}: Geheimnis im Fehler: ${abdruck}`);
        }
        assert.ok(!/arrayBuffer/.test(abdruck), `${name} / ${stelle}: der Aufruf erreicht die Auswertung gar nicht`);
      }
    }
  }
});

// --- Rumpfaufbau: params bleibt params ----------------------------------

test('ein Zusatzfeld kann params nicht verdraengen — auch nicht ohne Typen', async () => {
  const { holen, aufrufe } = fetchFake(erfolg({ rkdbMessage: { rc: '0', status: 'IN_BETRIEB' } }));
  const rufen = createTransport({
    auth: registerUserAuth({ getIdToken: () => ID_TOKEN, getSessionId: () => SITZUNG, cashregisterId: KASSEN_ID }),
    fetch: holen,
  });

  // Der Typ laesst nur `method` zu; ein Verbraucher ohne Typen kommt daran
  // vorbei. Wuerde sein `params` gewinnen, verschwaende die Kassenbindung aus
  // der Anmeldung still — genau der Fehler, der weiter unten im Rumpf schon
  // einmal behoben wurde.
  await rufen('financeWebService', { zertifikatnr_hex: '6F0404F0' }, {
    method: 'status_signature',
    params: { boese: true },
  } as unknown as { method?: string });

  assert.deepEqual(rumpfVon(aufrufe[0]!), {
    params: { cashregisterId: KASSEN_ID, zertifikatnr_hex: '6F0404F0' },
    method: 'status_signature',
  });
});

// --- Fehler nennen den Vorgang ------------------------------------------

test('ein Fehler nennt den Vorgang, nicht nur den geteilten Endpunkt financeWebService', async () => {
  // Beide Statusabfragen laufen ueber denselben Endpunkt; ein Fehler, der nur
  // "financeWebService" sagt, verschweigt, welche der beiden scheiterte.
  const faelle: Array<[string, (holen: FetchLike) => Promise<unknown>, string]> = [
    ['Kassenstatus', (holen) => getCashboxStatus(jsonWeg(holen)), 'financeWebService/status_cashbox'],
    ['Signaturstatus', (holen) => getSignatureStatus(jsonWeg(holen), '6F0404F0'), 'financeWebService/status_signature'],
  ];

  for (const [name, aufruf, erwartet] of faelle) {
    // Fachlicher Fehler (kommt aus dem Transport) …
    const { holen } = fetchFake(jsonAntwort(JSON.stringify({ status: 'error', message: 'nein', data: null })));
    await assert.rejects(aufruf(holen), (fehler: unknown) => {
      assert.ok(fehler instanceof KasseneckApiError);
      assert.equal(fehler.functionName, erwartet, `${name}: fachlicher Fehler`);
      return true;
    });
    // … und Antwortfehler (kommt aus dem Endpunktmodul).
    const { holen: holen2 } = fetchFake(erfolg({ rkdbMessage: { rc: '0' } }));
    await assert.rejects(aufruf(holen2), (fehler: unknown) => {
      assert.ok(fehler instanceof KasseneckValidationError);
      assert.equal(fehler.functionName, erwartet, `${name}: Antwortfehler`);
      return true;
    });
  }

  // Und die Pruefung vor dem Senden nennt ihn ebenfalls.
  const { holen } = fetchFake(erfolg({}));
  await assert.rejects(getSignatureStatus(jsonWeg(holen), ''), (fehler: unknown) => {
    assert.ok(fehler instanceof KasseneckValidationError);
    assert.equal(fehler.functionName, 'financeWebService/status_signature');
    return true;
  });
});

test('createKasseneckApi bietet die vier Aufrufe gebunden an', async () => {
  const { holen, aufrufe } = fetchFake(binaerAntwort(PDF_BYTES));
  const api = createKasseneckApi({ auth: apiSchluesselWeg(), fetch: holen });

  const pdf = await api.downloadMonthlyReport({ month: 5, year: 2026 });

  assert.ok(pdf instanceof Uint8Array);
  assert.equal(aufrufe[0]!.url, `${DEFAULT_BASE_URL}/downloadReport`);
  assert.equal(typeof api.downloadDailyReport, 'function');
  assert.equal(typeof api.getCashboxStatus, 'function');
  assert.equal(typeof api.getSignatureStatus, 'function');
});
