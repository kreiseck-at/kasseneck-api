import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mock, test } from 'node:test';
import { createKasseneckApi } from '../src/client/api.js';
import { CALLS_WITHOUT_EFFECT, PUBLIC_CALLS, isPosOnlyCall, isUnknownOutcomeCall } from '../src/client/aufrufe.js';
import { apiKeyAuth } from '../src/client/auth.js';
import {
  DEP_EXPORT_DOWNLOAD_TIMEOUT_MS,
  DEP_EXPORT_ERROR_CODES,
  DEP_EXPORT_FAILURES,
  DepExportChecksumError,
  DepExportTimeoutError,
  type DepExportErrorCode,
} from '../src/client/dep-export.js';
import {
  KasseneckApiError,
  KasseneckHttpError,
  KasseneckNetworkError,
  KasseneckValidationError,
  isKasseneckApiError,
  isKasseneckValidationError,
} from '../src/client/errors.js';
import type { FetchLike, HttpRequestInit, HttpResponseLike } from '../src/client/transport.js';
import * as wurzel from '../src/index.js';

/*
 * DEP-Export fuer die Kassennachschau (createDepExport, getDepExport,
 * waitForDepExport, getDepExportFile, createDepHandoverLink,
 * revokeDepHandoverLink) mit einer Attrappe des Servers. Die Antwortformen
 * stammen aus dem Backend (dep-nachschau-core.exportNachAussen,
 * dep-nachschau-endpoints, dep-link-endpoints); Kasse, Beleg-Kennungen und
 * Pruefsummen sind erfunden.
 */

type Json = Record<string, any>;

/** Vertrags-Export des Backends (`fixtures/v3/v3-vokabular.json`, scripts/v3-vertrag-holen.mjs). */
const VOKABULAR = JSON.parse(readFileSync(new URL('../../fixtures/v3/v3-vokabular.json', import.meta.url), 'utf8')) as Json;

const KOPF: Record<string, string> = { 'content-type': 'application/json', 'kasseneck-api-version': 'v3' };
const sha = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');

function huelle(rumpf: Json, kopf: Record<string, string> = {}): HttpResponseLike {
  const text = JSON.stringify(rumpf);
  return datei(new TextEncoder().encode(text), { ...KOPF, ...kopf });
}

function datei(bytes: Uint8Array, kopf: Record<string, string>, status = 200): HttpResponseLike {
  const k = Object.fromEntries(Object.entries(kopf).map(([n, w]) => [n.toLowerCase(), w]));
  return {
    status,
    headers: { get: (name: string) => k[name.toLowerCase()] ?? null },
    text: async () => new TextDecoder().decode(bytes),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  };
}

const erfolg = (data: Json): Json => ({ status: 'success', message: '', data });
const fehler = (code: string, message: string): Json => ({ status: 'error', message, code });

const ID = 'DEP-2026-10-30-0001';
const LINK_URL = 'https://storage.example.test/dep/DEP-2026-10-30-0001.zip?sig=GEHEIM123';

interface Aufruf {
  url: string;
  method: string;
  params: Json;
  headers: Record<string, string>;
}

/** Attrappe: Antworten je Aufruf der Reihe nach; Aufrufe an fremde Adressen (Lese-Link) beantwortet `extern`. */
function server(antworten: Array<Json | HttpResponseLike> | ((n: number) => Json | HttpResponseLike), extern?: (url: string) => HttpResponseLike | Promise<HttpResponseLike>) {
  const aufrufe: Aufruf[] = [];
  const externe: Aufruf[] = [];
  const holen: FetchLike = async (url: string, init: HttpRequestInit) => {
    if (!url.startsWith('https://api.kasseneck.at/')) {
      externe.push({ url, method: init.method, params: {}, headers: init.headers });
      if (!extern) throw new Error(`unerwarteter Aufruf an ${url}`);
      return extern(url);
    }
    aufrufe.push({ url, method: init.method, params: (JSON.parse(init.body) as { params: Json }).params, headers: init.headers });
    const n = aufrufe.length - 1;
    const roh = typeof antworten === 'function' ? antworten(n) : antworten[n];
    if (!roh) throw new Error(`unerwarteter Aufruf Nr. ${n + 1}`);
    return 'status' in roh && typeof (roh as Json).status === 'number' ? (roh as HttpResponseLike) : huelle(roh as Json);
  };
  const api = createKasseneckApi({
    auth: apiKeyAuth({ apiKey: 'kr_test_Beispielschluessel0123456789', cashregisterToken: 'cb_test_EXAMPLE00000000' }),
    fetch: holen,
  });
  return { api, aufrufe, externe };
}

/** Erfundener Export der Baeckerei Kornblum in der Form von `exportNachAussen`. */
function exportDoc(extra: Json = {}): Json {
  return {
    exportId: ID,
    status: 'done',
    from: '2026-10-01',
    to: '2026-10-29',
    createdAt: '2026-10-30T08:00:00.000Z',
    finishedAt: '2026-10-30T08:01:00.000Z',
    receiptCount: 12,
    counterFrom: 1,
    counterTo: 12,
    sha256: sha('dep'),
    size: 3,
    findings: {
      receiptCount: 12,
      counterFrom: 1,
      counterTo: 12,
      gaps: [{ from: 5, to: 6 }],
      chainBreaks: [{ counter: 9, expected: 'abc', found: 'abd' }],
      withoutCounter: [],
      withoutSignature: ['KECK-1-ID-11'],
    },
    items: { rowCount: 30, sha256: sha('items'), size: 5 },
    handoverLinks: [],
    ...extra,
  };
}

const laufend = (): Json => erfolg(exportDoc({ status: 'running', finishedAt: null, sha256: null, size: null, findings: null, items: null }));

// ---- Einordnung ------------------------------------------------------------------------------

test('DEP-Export: fuenf oeffentliche Aufrufe nur unter /v3, Lesen und Anlegen/Widerruf wiederholbar, keiner mit unklarem Ausgang', () => {
  const namen = ['createDepExport', 'getDepExport', 'getDepExportFile', 'createDepHandoverLink', 'revokeDepHandoverLink'];
  for (const n of namen) assert.ok((PUBLIC_CALLS as readonly string[]).includes(n), n);
  for (const n of namen) assert.equal(isPosOnlyCall(n), false, `${n} geht an die oeffentliche Basis`);
  for (const n of namen) assert.equal(isUnknownOutcomeCall(n), false, n);
  for (const n of ['getDepExport', 'getDepExportFile']) assert.equal(CALLS_WITHOUT_EFFECT[n], 'read', n);
  for (const n of ['createDepExport', 'createDepHandoverLink', 'revokeDepHandoverLink']) assert.equal(CALLS_WITHOUT_EFFECT[n], 'repeatable', n);
});

test('DEP-Export: DEP_EXPORT_ERROR_CODES = errorCodes.depExport des Vertrags (mit Reihenfolge), jeder Code in errorCodes.all', () => {
  assert.deepEqual([...DEP_EXPORT_ERROR_CODES], VOKABULAR.errorCodes.depExport);
  const alle = new Set(VOKABULAR.errorCodes.all as string[]);
  assert.deepEqual(DEP_EXPORT_ERROR_CODES.filter((c) => !alle.has(c)), []);
  assert.ok((DEP_EXPORT_ERROR_CODES as readonly string[]).includes('idempotency_conflict'));
  assert.equal(wurzel.DEP_EXPORT_ERROR_CODES, DEP_EXPORT_ERROR_CODES);
  assert.equal(typeof wurzel.createDepExport, 'function');
  assert.equal(typeof wurzel.DepExportTimeoutError, 'function');
});

test('DEP-Export: DEP_EXPORT_FAILURES = Werte des Katalogs DEP_EXPORT_FEHLER im Vertrag', () => {
  const katalog = VOKABULAR.catalogs.DEP_EXPORT_FEHLER as Record<string, string>;
  assert.ok(katalog, 'Katalog DEP_EXPORT_FEHLER fehlt im Vertrag');
  assert.deepEqual([...DEP_EXPORT_FAILURES].sort(), [...new Set(Object.values(katalog))].sort());
  assert.equal(wurzel.DEP_EXPORT_FAILURES, DEP_EXPORT_FAILURES);
  // waitForDepExport wirft diese Gruende als code: der Typ der Fehlercodes kennt sie.
  const gestockt: DepExportErrorCode = 'export_stalled';
  assert.equal(gestockt, 'export_stalled');
});

// ---- createDepExport -------------------------------------------------------------------------

test('createDepExport: sendet nur gesetzte Felder an /v3 und liefert Kennung und Zustand', async () => {
  const { api, aufrufe } = server([erfolg({ exportId: ID, status: 'running', from: '2026-10-01', to: '2026-10-29' }), erfolg({ exportId: ID, status: 'running', from: null, to: null })]);

  const e = await api.createDepExport({ from: '2026-10-01', to: '2026-10-29', requestId: 'nachschau_2026-10-30' });
  assert.deepEqual(e, { exportId: ID, status: 'running', from: '2026-10-01', to: '2026-10-29' });
  assert.equal(aufrufe[0]!.url, 'https://api.kasseneck.at/v3/createDepExport');
  assert.deepEqual(aufrufe[0]!.params, { from: '2026-10-01', to: '2026-10-29', requestId: 'nachschau_2026-10-30' });

  await api.createDepExport();
  for (const feld of ['from', 'to', 'requestId']) assert.equal(feld in aufrufe[1]!.params, false, `${feld} geht ohne Eingabe nicht hinaus`);
});

test('createDepExport: prueft die Eingabe vor dem Senden (Datum, Reihenfolge, requestId)', async () => {
  const { api, aufrufe } = server([]);
  const faelle: Array<[Json, RegExp]> = [
    [{ from: '2026-02-30' }, /from muss ein Datum/],
    [{ to: '30.10.2026' }, /to muss ein Datum/],
    [{ from: '2026-10-10', to: '2026-10-09' }, /to liegt vor from/],
    [{ requestId: 'mit leerzeichen' }, /requestId/],
    [{ requestId: 'x'.repeat(65) }, /requestId/],
    [{ requestId: '' }, /requestId/],
  ];
  for (const [eingabe, muster] of faelle) {
    await assert.rejects(() => api.createDepExport(eingabe), (e: unknown) => {
      assert.ok(isKasseneckValidationError(e));
      assert.equal((e as KasseneckValidationError).scope, 'request');
      assert.match((e as Error).message, muster);
      return true;
    });
  }
  assert.equal(aufrufe.length, 0);
});

test('createDepExport: Antwort ohne Kennung oder mit unbekanntem Zustand ist ein Antwortfehler; Backend-Codes kommen als code an', async () => {
  const { api } = server([
    erfolg({ status: 'running' }),
    erfolg({ exportId: ID, status: 'queued', from: null, to: null }),
    { status: 'error', message: 'Es laeuft schon ein Export.', code: 'export_running', data: { code: 'export_running', exportId: ID } },
    fehler('invalid_period', 'from: darf nicht in der Zukunft liegen.'),
    fehler('idempotency_conflict', 'Diese requestId gehoert zu einem Export mit anderem Zeitraum.'),
  ]);
  await assert.rejects(() => api.createDepExport(), (e: unknown) => isKasseneckValidationError(e) && e.scope === 'response');
  await assert.rejects(() => api.createDepExport(), (e: unknown) => isKasseneckValidationError(e) && e.scope === 'response');
  await assert.rejects(() => api.createDepExport(), (e: unknown) => isKasseneckApiError(e) && e.code === 'export_running' && (e.details as Json)['exportId'] === ID);
  await assert.rejects(() => api.createDepExport({ from: '2099-01-01' }), (e: unknown) => isKasseneckApiError(e) && e.code === 'invalid_period');
  await assert.rejects(() => api.createDepExport({ from: '2026-10-02', requestId: 'r1' }), (e: unknown) => isKasseneckApiError(e) && e.code === 'idempotency_conflict');
});

// ---- getDepExport ----------------------------------------------------------------------------

test('getDepExport: liefert Kennzahlen, Befund und Links unveraendert', async () => {
  const link = { linkId: 'AbCdEfGhIjKlMnOpQrSt', createdAt: '2026-10-30T09:00:00.000Z', expiresAt: '2026-11-13T09:00:00.000Z', revokedAt: null, firstAccessAt: null, accessCount: 0 };
  const { api, aufrufe } = server([erfolg(exportDoc({ handoverLinks: [link] }))]);
  const e = await api.getDepExport({ exportId: ID });
  assert.deepEqual(aufrufe[0]!.params, { exportId: ID });
  assert.equal(e.status, 'done');
  assert.deepEqual(e.findings!.gaps, [{ from: 5, to: 6 }]);
  assert.equal(e.findings!.chainBreaks[0]!.counter, 9);
  assert.deepEqual(e.findings!.withoutSignature, ['KECK-1-ID-11']);
  assert.equal(e.items!.rowCount, 30);
  assert.deepEqual(e.handoverLinks, [link]);
  assert.equal('error' in e, false);
});

test('getDepExport: leere Kennung wird nicht gesendet, unbekannte Antwortform ist ein Antwortfehler', async () => {
  const { api, aufrufe } = server([erfolg({ exportId: ID, status: 'zerstoert', handoverLinks: [] }), erfolg({ exportId: ID, status: 'done' })]);
  await assert.rejects(() => api.getDepExport({ exportId: ' ' }), (e: unknown) => isKasseneckValidationError(e) && e.scope === 'request');
  assert.equal(aufrufe.length, 0);
  await assert.rejects(() => api.getDepExport({ exportId: ID }), (e: unknown) => isKasseneckValidationError(e) && e.scope === 'response');
  await assert.rejects(() => api.getDepExport({ exportId: ID }), (e: unknown) => isKasseneckValidationError(e) && e.scope === 'response');
});

// ---- waitForDepExport (falsche Uhren) --------------------------------------------------------

/** Laesst anstehende Mikroaufgaben (Antworten der Attrappe) durchlaufen; setImmediate ist nicht gefaelscht. */
const beruhigen = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise<void>((weiter) => setImmediate(weiter));
};

test('waitForDepExport: fragt nach 2 s, x1,5, hoechstens 15 s und gibt den fertigen Export zurueck', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  try {
    const laeufe = 8;
    const { api, aufrufe } = server((n) => (n < laeufe ? laufend() : erfolg(exportDoc())));
    let fertig: Awaited<ReturnType<typeof api.waitForDepExport>> | undefined;
    const p = api.waitForDepExport({ exportId: ID }).then((e) => { fertig = e; });

    await beruhigen();
    assert.equal(aufrufe.length, 1, 'die erste Abfrage geht sofort');
    const abstaende = [2000, 3000, 4500, 6750, 10125, 15000, 15000, 15000];
    let erwartet = 1;
    for (const ms of abstaende) {
      mock.timers.tick(ms - 1);
      await beruhigen();
      assert.equal(aufrufe.length, erwartet, `${ms} ms: eine Millisekunde zu frueh`);
      mock.timers.tick(1);
      await beruhigen();
      erwartet += 1;
      assert.equal(aufrufe.length, erwartet, `${ms} ms: jetzt fragt er`);
    }
    await p;
    assert.equal(fertig!.status, 'done');
    assert.equal(fertig!.exportId, ID);
    assert.ok(aufrufe.every((a) => a.url.endsWith('/getDepExport') && a.params['exportId'] === ID));
  } finally {
    mock.timers.reset();
  }
});

test('waitForDepExport: endet nach timeoutMs mit eigenem Fehler; die letzte Abfrage liegt auf der Frist', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  try {
    const { api, aufrufe } = server(() => laufend());
    let fehlerErgebnis: unknown;
    const p = api.waitForDepExport({ exportId: ID, timeoutMs: 5000 }).catch((e: unknown) => { fehlerErgebnis = e; });
    await beruhigen();
    mock.timers.tick(2000); // zweite Abfrage, Rest 3000 -> die Wartezeit wird auf den Rest gekuerzt
    await beruhigen();
    assert.equal(aufrufe.length, 2);
    mock.timers.tick(2999);
    await beruhigen();
    assert.equal(aufrufe.length, 2);
    mock.timers.tick(1);
    await beruhigen();
    await p;
    assert.equal(aufrufe.length, 3, 'noch eine Abfrage genau zur Frist');
    assert.ok(fehlerErgebnis instanceof DepExportTimeoutError);
    assert.equal(fehlerErgebnis.exportId, ID);
    assert.equal(fehlerErgebnis.timeoutMs, 5000);
    assert.equal(fehlerErgebnis.lastStatus, 'running');
    assert.ok(!(fehlerErgebnis instanceof KasseneckApiError), 'kein Serverfehler: der Export laeuft weiter');
  } finally {
    mock.timers.reset();
  }
});

test('waitForDepExport: failed endet mit Fehler samt error-Code (export_failed, export_stalled)', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  try {
    const { api, aufrufe } = server([
      laufend(),
      erfolg(exportDoc({ status: 'failed', error: 'export_stalled', sha256: null, size: null, findings: null, items: null })),
      erfolg(exportDoc({ status: 'failed', error: 'export_failed', sha256: null, size: null, findings: null, items: null })),
    ]);
    let e1: unknown;
    const p1 = api.waitForDepExport({ exportId: ID }).catch((e: unknown) => { e1 = e; });
    await beruhigen();
    mock.timers.tick(2000);
    await beruhigen();
    await p1;
    assert.ok(e1 instanceof KasseneckApiError);
    assert.equal(e1.code, 'export_stalled');
    assert.equal(e1.details['exportId'], ID);
    assert.equal(aufrufe.length, 2, 'nach failed fragt er nicht weiter');

    await assert.rejects(() => api.waitForDepExport({ exportId: ID }), (e: unknown) => isKasseneckApiError(e) && e.code === 'export_failed');
  } finally {
    mock.timers.reset();
  }
});

test('waitForDepExport: ein Fehler beim Abfragen bricht ab; ein fertiger Export braucht keine Wartezeit; timeoutMs wird geprueft', async () => {
  const { api, aufrufe } = server([erfolg(exportDoc()), fehler('export_not_found', 'Export nicht gefunden.')]);
  assert.equal((await api.waitForDepExport({ exportId: ID })).status, 'done');
  await assert.rejects(() => api.waitForDepExport({ exportId: 'DEP-2026-10-30-0002' }), (e: unknown) => isKasseneckApiError(e) && e.code === 'export_not_found');
  for (const timeoutMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    await assert.rejects(() => api.waitForDepExport({ exportId: ID, timeoutMs }), (e: unknown) => isKasseneckValidationError(e) && e.scope === 'request');
  }
  assert.equal(aufrufe.length, 2);
});

// ---- getDepExportFile ------------------------------------------------------------------------

const ATTACH = (name: string, art: string): Record<string, string> => ({ 'content-disposition': `attachment; filename="${name}"`, 'content-type': art });

test('getDepExportFile: Binaerantwort kommt als Bytes mit Dateiname und Inhaltstyp; Summe wird gerechnet', async () => {
  const dep = new TextEncoder().encode('{"Belege-Gruppe":[]}');
  const { api, aufrufe } = server([
    datei(dep, { ...KOPF, ...ATTACH(`${ID}.json`, 'application/json') }),
    datei(new TextEncoder().encode('a;b\n1;2\n'), { ...KOPF, ...ATTACH(`${ID}_positionen.csv`, 'text/csv; charset=utf-8') }),
    datei(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0xff, 0xfe, 0x00, 0x80]), { ...KOPF, ...ATTACH(`${ID}.pdf`, 'application/pdf') }),
  ]);

  const a = await api.getDepExportFile({ exportId: ID, file: 'dep', sha256: sha(dep) });
  assert.deepEqual(aufrufe[0]!.params, { exportId: ID, file: 'dep' }, 'die Summe ist kein Parameter des Servers');
  assert.equal(aufrufe[0]!.url, 'https://api.kasseneck.at/v3/getDepExportFile');
  assert.equal(a.fileName, `${ID}.json`);
  assert.equal(a.contentType, 'application/json');
  assert.deepEqual(a.bytes, dep);
  assert.equal(a.sha256, sha(dep));

  const b = await api.getDepExportFile({ exportId: ID, file: 'items' });
  assert.equal(b.fileName, `${ID}_positionen.csv`);
  assert.equal(b.contentType, 'text/csv; charset=utf-8');

  const c = await api.getDepExportFile({ exportId: ID, file: 'protocol' });
  assert.deepEqual([...c.bytes], [0x25, 0x50, 0x44, 0x46, 0xff, 0xfe, 0x00, 0x80], 'Bytes bleiben Bytes, kein Text');
});

test('getDepExportFile: weicht die Datei von der bekannten Summe ab, ist das ein Fehler (Binaerweg)', async () => {
  const dep = new TextEncoder().encode('{"Belege-Gruppe":[]}');
  const { api } = server([datei(dep, { ...KOPF, ...ATTACH(`${ID}.json`, 'application/json') })]);
  await assert.rejects(
    () => api.getDepExportFile({ exportId: ID, file: 'dep', sha256: sha('anderes') }),
    (e: unknown) => {
      assert.ok(e instanceof DepExportChecksumError);
      assert.ok(isKasseneckValidationError(e));
      assert.equal(e.scope, 'response');
      assert.equal(e.expected, sha('anderes'));
      assert.equal(e.actual, sha(dep));
      return true;
    },
  );
});

test('getDepExportFile: Lese-Link wird gefolgt (GET ohne Kopfzeilen der Kasse), Summe und Groesse des Servers gelten', async () => {
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 250, 251]);
  const link = { url: LINK_URL, expiresAt: '2026-10-30T09:15:00.000Z', size: zip.length, sha256: sha(zip), fileName: `${ID}.zip`, contentType: 'application/zip' };
  const { api, aufrufe, externe } = server([erfolg({ download: link })], () => datei(zip, { 'content-type': 'application/zip' }));

  const d = await api.getDepExportFile({ exportId: ID, file: 'zip' });
  assert.equal(aufrufe.length, 1);
  assert.equal(externe.length, 1);
  assert.equal(externe[0]!.url, LINK_URL);
  assert.equal(externe[0]!.method, 'GET');
  assert.deepEqual(externe[0]!.headers, {}, 'weder Schluessel noch Kassen-Token gehen an die Speicheradresse');
  assert.deepEqual(d.bytes, zip);
  assert.equal(d.fileName, `${ID}.zip`);
  assert.equal(d.contentType, 'application/zip');
  assert.equal(d.sha256, sha(zip));
});

test('getDepExportFile: Lese-Link mit veraenderten Bytes oder falscher Groesse ist ein Fehler, ohne die Adresse zu nennen', async () => {
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
  const falsch = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 9]);
  const link = { url: LINK_URL, expiresAt: '2026-10-30T09:15:00.000Z', size: zip.length, sha256: sha(zip), fileName: `${ID}.zip`, contentType: 'application/zip' };

  // gleiche Laenge, anderer Inhalt: nur die Summe faellt auf
  const a = server([erfolg({ download: link })], () => datei(falsch, {}));
  await assert.rejects(() => a.api.getDepExportFile({ exportId: ID, file: 'zip' }), (e: unknown) => {
    assert.ok(e instanceof DepExportChecksumError);
    assert.equal(e.expected, sha(zip));
    assert.ok(!String(e.message).includes('GEHEIM123'));
    return true;
  });

  // andere Laenge
  const b = server([erfolg({ download: link })], () => datei(new Uint8Array([1, 2]), {}));
  await assert.rejects(() => b.api.getDepExportFile({ exportId: ID, file: 'zip' }), (e: unknown) => isKasseneckValidationError(e) && /Byte/.test((e as Error).message));

  // richtige Bytes, aber die bekannte Summe des Exports sagt etwas anderes
  const c = server([erfolg({ download: link })], () => datei(zip, {}));
  await assert.rejects(() => c.api.getDepExportFile({ exportId: ID, file: 'zip', sha256: sha('x') }), (e: unknown) => e instanceof DepExportChecksumError);
});

test('getDepExportFile: Fehler beim Laden des Links (HTTP, Netz) nennen die Adresse nicht', async () => {
  const zip = new Uint8Array([1, 2, 3]);
  const link = { url: LINK_URL, expiresAt: '2026-10-30T09:15:00.000Z', size: 3, sha256: sha(zip), fileName: `${ID}.zip`, contentType: 'application/zip' };
  const abgelaufen = server([erfolg({ download: link })], () => datei(new Uint8Array(), { 'content-type': 'application/xml' }, 403));
  await assert.rejects(() => abgelaufen.api.getDepExportFile({ exportId: ID, file: 'zip' }), (e: unknown) => {
    assert.ok(e instanceof KasseneckHttpError);
    assert.equal(e.statusCode, 403);
    assert.ok(!e.message.includes('GEHEIM123'));
    return true;
  });
  const netz = server([erfolg({ download: link })], () => { throw new TypeError(`fetch failed ${LINK_URL}`); });
  await assert.rejects(() => netz.api.getDepExportFile({ exportId: ID, file: 'zip' }), (e: unknown) => {
    assert.ok(e instanceof Error && e.name === 'KasseneckNetworkError');
    assert.ok(!JSON.stringify(e).includes('GEHEIM123') && !e.message.includes('GEHEIM123'));
    return true;
  });
});

test('getDepExportFile: unvollstaendiger oder unsicherer Lese-Link wird nicht gefolgt', async () => {
  const zip = new Uint8Array([1, 2, 3]);
  const ok = { url: LINK_URL, expiresAt: '2026-10-30T09:15:00.000Z', size: 3, sha256: sha(zip), fileName: `${ID}.zip`, contentType: 'application/zip' };
  const faelle: Json[] = [
    {},
    { ...ok, url: 'http://storage.example.test/x' },
    { ...ok, url: 'file:///etc/passwd' },
    { ...ok, url: 'kein link' },
    { ...ok, sha256: 'abc' },
    { ...ok, size: -1 },
    { ...ok, fileName: undefined },
  ];
  for (const download of faelle) {
    const { api, externe } = server([erfolg({ download })]);
    await assert.rejects(() => api.getDepExportFile({ exportId: ID, file: 'zip' }), (e: unknown) => isKasseneckValidationError(e) && e.scope === 'response');
    assert.equal(externe.length, 0);
  }
  // Antwort weder Datei noch Link
  const leer = server([erfolg({})]);
  await assert.rejects(() => leer.api.getDepExportFile({ exportId: ID, file: 'zip' }), (e: unknown) => isKasseneckValidationError(e));
});

test('getDepExportFile: Eingabe wird vor dem Senden geprueft; Backend-Codes kommen als code an', async () => {
  const { api, aufrufe } = server([fehler('file_not_available', 'Diese Datei gibt es zu diesem Export nicht.'), fehler('export_not_ready', 'Der Export wird noch erstellt.'), fehler('invalid_file', 'Unbekannte Datei.')]);
  await assert.rejects(() => api.getDepExportFile({ exportId: ID, file: 'pdf' as never }), (e: unknown) => isKasseneckValidationError(e) && e.scope === 'request');
  await assert.rejects(() => api.getDepExportFile({ exportId: '', file: 'dep' }), (e: unknown) => isKasseneckValidationError(e));
  await assert.rejects(() => api.getDepExportFile({ exportId: ID, file: 'dep', sha256: 'zu kurz' }), (e: unknown) => isKasseneckValidationError(e));
  assert.equal(aufrufe.length, 0);
  for (const code of ['file_not_available', 'export_not_ready', 'invalid_file']) {
    await assert.rejects(() => api.getDepExportFile({ exportId: ID, file: 'items' }), (e: unknown) => isKasseneckApiError(e) && e.code === code);
  }
});

// ---- Pruefer-Link ----------------------------------------------------------------------------

test('createDepHandoverLink und revokeDepHandoverLink: Formen und Codes', async () => {
  const { api, aufrufe } = server([
    erfolg({ linkId: 'AbCdEfGhIjKlMnOpQrSt', url: 'https://check.kasseneck.at/d#link=AbCdEfGhIjKlMnOpQrSt.tok', code: '042917', expiresAt: '2026-11-13T09:00:00.000Z' }),
    erfolg({ linkId: 'AbCdEfGhIjKlMnOpQrSt', revokedAt: '2026-10-30T10:00:00.000Z' }),
    fehler('link_not_found', 'Pruefer-Link nicht gefunden.'),
    fehler('too_many_links', 'Zu viele Links heute.'),
    fehler('export_not_ready', 'Der Export wird noch erstellt.'),
  ]);

  const l = await api.createDepHandoverLink({ exportId: ID });
  assert.deepEqual(aufrufe[0]!.params, { exportId: ID });
  assert.equal(aufrufe[0]!.url, 'https://api.kasseneck.at/v3/createDepHandoverLink');
  assert.equal(l.code, '042917', 'Code mit fuehrender Null bleibt Text');
  assert.deepEqual(Object.keys(l).sort(), ['code', 'expiresAt', 'linkId', 'url']);

  const r = await api.revokeDepHandoverLink({ linkId: l.linkId });
  assert.deepEqual(aufrufe[1]!.params, { linkId: l.linkId });
  assert.equal(aufrufe[1]!.url, 'https://api.kasseneck.at/v3/revokeDepHandoverLink');
  assert.deepEqual(r, { linkId: l.linkId, revokedAt: '2026-10-30T10:00:00.000Z' });

  await assert.rejects(() => api.revokeDepHandoverLink({ linkId: 'ZzZzZzZzZzZzZzZzZzZz' }), (e: unknown) => isKasseneckApiError(e) && e.code === 'link_not_found');
  await assert.rejects(() => api.createDepHandoverLink({ exportId: ID }), (e: unknown) => isKasseneckApiError(e) && e.code === 'too_many_links');
  await assert.rejects(() => api.createDepHandoverLink({ exportId: ID }), (e: unknown) => isKasseneckApiError(e) && e.code === 'export_not_ready');
  await assert.rejects(() => api.createDepHandoverLink({ exportId: '' }), (e: unknown) => isKasseneckValidationError(e));
  await assert.rejects(() => api.revokeDepHandoverLink({ linkId: '' }), (e: unknown) => isKasseneckValidationError(e));
});

test('createDepHandoverLink: Antwort ohne Adresse, Code oder Ablauf ist ein Antwortfehler', async () => {
  const voll = { linkId: 'AbCdEfGhIjKlMnOpQrSt', url: 'https://check.kasseneck.at/dep#link=AbCdEfGhIjKlMnOpQrSt.tok', code: '042917', expiresAt: '2026-11-13T09:00:00.000Z' };
  const ohne = (feld: string): Json => Object.fromEntries(Object.entries(voll).filter(([k]) => k !== feld));
  const { api } = server([erfolg(ohne('url')), erfolg(ohne('code')), erfolg(ohne('expiresAt')), erfolg({ ...voll, expiresAt: null })]);
  for (let i = 0; i < 4; i++) {
    await assert.rejects(() => api.createDepHandoverLink({ exportId: ID }), (e: unknown) => isKasseneckValidationError(e) && e.scope === 'response');
  }
});

// ---- Zeitlimit von getDepExportFile ----------------------------------------------------------

/** Eine direkte Datei, die erst nach `ms` ankommt (der Server liest und prueft sie vorher ganz). */
function langsameDatei(ms: number) {
  const dep = new TextEncoder().encode('{"Belege-Gruppe":[]}');
  const holen: FetchLike = (_url, init) => new Promise((fertig, abgelehnt) => {
    const wecker = setTimeout(() => fertig(datei(dep, { ...KOPF, ...ATTACH(`${ID}.json`, 'application/json') })), ms);
    init.signal?.addEventListener('abort', () => {
      clearTimeout(wecker);
      abgelehnt(new Error('abgebrochen'));
    });
  });
  const api = createKasseneckApi({
    auth: apiKeyAuth({ apiKey: 'kr_test_Beispielschluessel0123456789', cashregisterToken: 'cb_test_EXAMPLE00000000' }),
    fetch: holen,
    // Das allgemeine Zeitlimit des Transports, hier verkuerzt (Vorgabe 30 s).
    timeoutMs: 20,
  });
  return { api, dep };
}

test('getDepExportFile: der Aufruf selbst laeuft mit downloadTimeoutMs, nicht mit dem allgemeinen Zeitlimit des Transports', async () => {
  const { api, dep } = langsameDatei(60);
  const a = await api.getDepExportFile({ exportId: ID, file: 'dep', downloadTimeoutMs: 2_000 });
  assert.deepEqual(a.bytes, dep);
  await assert.rejects(() => api.getDepExportFile({ exportId: ID, file: 'dep', downloadTimeoutMs: 10 }), (e: unknown) => {
    assert.ok(e instanceof KasseneckNetworkError);
    assert.equal(e.timedOut, true);
    assert.equal(e.timeoutMs, 10);
    return true;
  });
});

test('getDepExportFile: ohne downloadTimeoutMs gilt fuer den Aufruf die Vorgabe des Downloads (600 s), nicht 30 s', async () => {
  const { api, dep } = langsameDatei(60);
  assert.equal(DEP_EXPORT_DOWNLOAD_TIMEOUT_MS, 600_000);
  assert.deepEqual((await api.getDepExportFile({ exportId: ID, file: 'dep' })).bytes, dep);
});

test('getDepExportFile: downloadTimeoutMs wird vor dem Senden geprueft', async () => {
  const { api, aufrufe } = server([]);
  for (const downloadTimeoutMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    await assert.rejects(() => api.getDepExportFile({ exportId: ID, file: 'dep', downloadTimeoutMs }), (e: unknown) => isKasseneckValidationError(e) && e.scope === 'request');
  }
  assert.equal(aufrufe.length, 0);
});
