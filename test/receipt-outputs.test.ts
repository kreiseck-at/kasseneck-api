import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  logReceiptOutputs, getReceiptWithCompany, createKasseneckApi, apiKeyAuth, registerUserAuth,
  RECEIPT_OUTPUT_KINDS, RECEIPT_OUTPUT_LOG_KINDS, RECEIPT_OUTPUT_RESULTS, RECEIPT_OUTPUT_ENTRIES_MAX,
  RECEIPT_OUTPUT_ERROR_CODES, RECEIPT_OUTPUT_ENTRY_ERROR_CODES, isReceiptOutputError, isReceiptOutputErrorCode,
  receiptOutputErrorCode, receiptOutputFieldErrors, CLIENT_ERROR_CODES,
  POS_CALLS, UNKNOWN_OUTCOME_CALLS, ALL_CALLS, POS_BASE_URL, createTransport,
  isKasseneckValidationError, isOutcomeUnknown, KasseneckNetworkError,
  type ReceiptOutput, type ReceiptOutputEntry, type FetchLike, type HttpRequestInit, type HttpResponseLike,
} from '../src/index.js';
import * as kasse from '../src/pos/index.js';
import { LABELS, labelText, receiptOutputLabel, type LabelKey } from '../src/pos/index.js';
import { isPosOnlyCall, isUnknownOutcomeCall } from '../src/client/aufrufe.js';
import { randUndAnmeldung } from './kassenweg-codes.js';

/*
 * Ausgaben eines Belegs (Spec 2026-10-24-beleg-ausgaben-design.md, Abschnitt 3):
 * `logReceiptOutputs` am Kassenweg gegen den Vertrags-Export
 * (fixtures/v3/antworten/kasse.json), `outputs` aus `getReceipt` (belege.json,
 * kasse-belege.json, Fall get_receipt_with_outputs), Kataloge, Codes, Texte.
 */

type Json = Record<string, any>;
interface Fall { case: string; caller: string; params: Json; httpStatus: number; headers: Record<string, string>; response: Json }
interface BelegFall { name: string; endpoint: string; path: string; params: Json; httpStatus: number; headers: Record<string, string>; response: Json }

const lies = (datei: string): Json => JSON.parse(readFileSync(fileURLToPath(new URL(`../../fixtures/${datei}`, import.meta.url)), 'utf8')) as Json;
const FAELLE = (lies('v3/antworten/kasse.json').endpoints as Record<string, { cases: Fall[] }>).logReceiptOutputs!.cases;
const VOKABULAR = lies('v3/v3-vokabular.json');
const BELEGE = lies('v3/antworten/belege.json').cases as BelegFall[];
const KASSE_BELEGE = lies('v3/antworten/kasse-belege.json').cases as BelegFall[];

function antwortAus(f: Pick<Fall, 'httpStatus' | 'headers' | 'response'>): HttpResponseLike {
  const rumpf = JSON.stringify(f.response);
  const kopf: Record<string, string> = { 'content-type': 'application/json' };
  for (const [k, v] of Object.entries(f.headers)) kopf[k.toLowerCase()] = v;
  return {
    status: f.httpStatus,
    headers: { get: (name: string) => kopf[name.toLowerCase()] ?? null },
    text: async () => rumpf,
    arrayBuffer: async () => new TextEncoder().encode(rumpf).buffer as ArrayBuffer,
  };
}

const KASSIER = () => registerUserAuth({ getIdToken: () => 'eyJ-ID', getSessionId: () => 'sess-1', cashregisterId: 'KASSE1' });
const GERAET = () => apiKeyAuth({ apiKey: 'kr_live_Ab12', cashregisterToken: 'cb_live_Xy34' });

/** Ruft den Fall ueber `logReceiptOutputs`; die Kassenbindung der Anmeldung zaehlt nur, wenn der Fall sie nennt. */
async function rufe(f: Fall): Promise<{ ergebnis?: unknown; fehler?: unknown; gesendet: Json[] }> {
  const gesendet: Json[] = [];
  const holen: FetchLike = async (url: string, init: HttpRequestInit) => {
    assert.equal(url, `${POS_BASE_URL}/logReceiptOutputs`, f.case);
    const p = (JSON.parse(init.body) as { params: Json }).params;
    if (!('cashregisterId' in f.params)) delete p.cashregisterId;
    gesendet.push(p);
    return antwortAus(f);
  };
  const r = createTransport({ auth: f.caller === 'device_api_key' ? GERAET() : KASSIER(), fetch: holen, timeoutMs: 50 });
  const { cashregisterId: _kasse, ...optionen } = f.params;
  try {
    return { ergebnis: await logReceiptOutputs(r, optionen as never), gesendet };
  } catch (fehler) {
    return { fehler, gesendet };
  }
}

const fall = (name: string): Fall => {
  const f = FAELLE.find((c) => c.case === name);
  if (!f) throw new Error(`kasse.json: kein Fall logReceiptOutputs/${name}`);
  return f;
};

/** Faelle, die das Paket schon vor dem Senden abweist (sicher falsch ohne Netz): genau diese. Fall -> Grund. */
const VOR_DEM_SENDEN: Record<string, string> = {
  data_missing: 'entries fehlt',
  entries_empty: 'leere Liste',
};

/**
 * Eintraege der Erfolgsfaelle, die das Paket vor dem Senden abweist, weil der
 * Schluessel nicht der Regel des Servers folgt (8–64 Zeichen [A-Za-z0-9_-]).
 * Der Server zeigt damit `idempotency_key_required`; die Kasse soll den Fehler
 * schon beim Entwickeln sehen und `rejected[].key` immer ihren Pufferschluessel tragen.
 */
const VORAB_ABGEWIESEN: Record<string, string[]> = { mixed: ['kurz'] };

// --- logReceiptOutputs am Kassenweg ------------------------------------------

test('logReceiptOutputs: jeder Erfolgsfall sendet genau die Eintraege des Falls und liest accepted/rejected wie gesendet', async () => {
  const faelle = FAELLE.filter((c) => c.response.status === 'success');
  assert.ok(faelle.length >= 4, `nur ${faelle.length} Erfolgsfaelle`);
  for (const f of faelle) {
    const weg = VORAB_ABGEWIESEN[f.case] ?? [];
    if (weg.length > 0) {
      // Wie gesendet weist das Paket den Fall vor dem Senden ab (Schluessel ausserhalb der Regel des Servers) ...
      const ganz = await rufe(f);
      assert.equal(ganz.gesendet.length, 0, f.case);
      assert.ok(isKasseneckValidationError(ganz.fehler) && ganz.fehler.scope === 'request', `${f.case}: ${String(ganz.fehler)}`);
    }
    // ... ohne diese Eintraege geht der Rest Feld fuer Feld hinaus.
    const ohne = structuredClone(f);
    ohne.params.entries = f.params.entries.filter((e: Json) => !weg.includes(e.key));
    assert.equal(ohne.params.entries.length, f.params.entries.length - weg.length, f.case);
    const { ergebnis, fehler, gesendet } = await rufe(ohne);
    assert.equal(fehler, undefined, `${f.case}: ${String(fehler)}`);
    assert.deepEqual(gesendet, [ohne.params], f.case);
    assert.deepEqual(ergebnis, f.response.data, f.case);
  }
});

test('logReceiptOutputs: abgelehnte Eintraege kommen je Schluessel mit Code zurueck, die anderen sind angenommen (Review Focus 5)', async () => {
  const f = structuredClone(fall('mixed'));
  f.params.entries = f.params.entries.filter((e: Json) => e.key !== 'kurz');
  const { ergebnis, gesendet } = await rufe(f);
  // Mail und Abruf meldet die Kasse nie selbst; das Paket sendet sie trotzdem,
  // damit der Server genau diesen Eintrag ablehnt und der Puffer ihn verwirft.
  assert.deepEqual(gesendet[0]!.entries.map((e: Json) => e.kind), ['email', 'opened', 'print', 'print', 'reprint', 'reprint']);
  const r = ergebnis as { accepted: number; rejected: { key: string; code: string }[] };
  assert.equal(r.accepted, 1);
  assert.deepEqual(r.rejected.find((x) => x.key === 'fremd-0001'), { key: 'fremd-0001', code: 'receipt_not_found' });
  for (const { code } of r.rejected) assert.ok((RECEIPT_OUTPUT_ENTRY_ERROR_CODES as readonly string[]).includes(code), code);
  // Jeder Code je Eintrag aus dem Vertrag steht in der Liste, und umgekehrt.
  assert.deepEqual([...new Set(r.rejected.map((x) => x.code))].sort(), [...RECEIPT_OUTPUT_ENTRY_ERROR_CODES].sort());
});

test('logReceiptOutputs: jeder Fehlerfall wird am Code erkannt; vor dem Senden abgewiesen nur die benannten', async () => {
  const abgewiesen: string[] = [];
  for (const f of FAELLE.filter((c) => c.response.status === 'error' && !('$body' in c.params))) {
    const { fehler, gesendet } = await rufe(f);
    if (gesendet.length === 0) {
      assert.ok(isKasseneckValidationError(fehler) && fehler.scope === 'request', `${f.case}: ${String(fehler)}`);
      abgewiesen.push(f.case);
      continue;
    }
    assert.ok(isReceiptOutputError(fehler, f.response.code), `${f.case}: ${String(fehler)}`);
  }
  assert.deepEqual(abgewiesen.sort(), Object.keys(VOR_DEM_SENDEN).sort());
});

test('logReceiptOutputs vor dem Senden: unbekannte Felder, Form der Liste und der Eintraege', async () => {
  const nie: FetchLike = async () => { throw new Error('darf nicht senden'); };
  const r = createTransport({ auth: KASSIER(), fetch: nie, timeoutMs: 50 });
  const gut: ReceiptOutputEntry = { key: 'druck-0001', receiptId: 'KASSE1-ID-7', kind: 'print', at: '2026-09-26T09:58:00+02:00', result: 'ok' };
  const abgewiesen = async (optionen: unknown, muster: RegExp) => {
    await assert.rejects(logReceiptOutputs(r, optionen as never), (e) => isKasseneckValidationError(e) && e.scope === 'request' && muster.test(e.message));
  };
  await abgewiesen(null, /Objekt/);
  await abgewiesen({ entries: [gut], drawerId: 'x' }, /unbekanntes Feld "drawerId"/);
  // Die Kasse steht in der Anmeldung (Kopfzeile bzw. registerUserAuth), nie ein zweites Mal in der Nutzlast.
  await abgewiesen({ entries: [gut], cashregisterId: 'KASSE2' }, /unbekanntes Feld "cashregisterId"/);
  await abgewiesen({ entries: [{ ...gut, receiptID: 'KASSE1-ID-7' }] }, /entries\[0\]: unbekanntes Feld "receiptID"/);
  await abgewiesen({ entries: [gut, { ...gut, key: 'druck-0002', note: 'Kopie' }] }, /entries\[1\]: unbekanntes Feld "note"/);
  await abgewiesen({ entries: 'druck' }, /entries/);
  await abgewiesen({ entries: Array.from({ length: RECEIPT_OUTPUT_ENTRIES_MAX + 1 }, (_, i) => ({ ...gut, key: `druck-${1000 + i}` })) }, /1.50/);
  await abgewiesen({ entries: [null] }, /entries\[0\]/);
  await abgewiesen({ entries: [{ ...gut, key: '' }] }, /entries\[0\]\.key/);
  await abgewiesen({ entries: [{ ...gut, key: undefined }] }, /entries\[0\]\.key/);
  await abgewiesen({ entries: [{ ...gut, receiptId: ' ' }] }, /entries\[0\]\.receiptId/);
  // Ein Wert ausserhalb des Katalogs liesse den Rand die GANZE Anfrage abweisen.
  await abgewiesen({ entries: [{ ...gut, kind: 'erstdruck' }] }, /entries\[0\]\.kind/);
  await abgewiesen({ entries: [{ ...gut, result: 'fehler' }] }, /entries\[0\]\.result/);
  await abgewiesen({ entries: [{ ...gut, at: new Date(0) }] }, /entries\[0\]\.at/);
  await abgewiesen({ entries: [{ ...gut, at: 1.5 }] }, /entries\[0\]\.at/);
  await abgewiesen({ entries: [{ ...gut, at: '' }] }, /entries\[0\]\.at/);
  // Schluessel nach der Regel des Servers: 8–64 Zeichen [A-Za-z0-9_-].
  await abgewiesen({ entries: [{ ...gut, key: 'kurz' }] }, /entries\[0\]\.key muss 8–64 Zeichen/);
  await abgewiesen({ entries: [{ ...gut, key: 'druck 0001' }] }, /entries\[0\]\.key/);
  await abgewiesen({ entries: [{ ...gut, key: 'drück-0001' }] }, /entries\[0\]\.key/);
  await abgewiesen({ entries: [{ ...gut, key: 'd'.repeat(65) }] }, /entries\[0\]\.key/);
  // Zeit als Text nur mit Zone (Ruling): ohne Zone, Offset ohne Doppelpunkt, nur Datum, Leerzeichen statt T.
  for (const at of ['2026-09-26T09:58:00', '2026-09-26T09:58:00.123', '2026-09-26T09:58:00+0200', '2026-09-26', '2026-09-26 09:58:00Z']) {
    await abgewiesen({ entries: [{ ...gut, at }] }, /entries\[0\]\.at muss/);
  }
});

test('logReceiptOutputs: Schluessel an den Grenzen und Zeiten mit Zone gehen hinaus', async () => {
  const gesendet: Json[] = [];
  const holen: FetchLike = async (_url, init) => {
    gesendet.push((JSON.parse(init.body) as { params: Json }).params);
    return antwortAus({ httpStatus: 200, headers: { 'Kasseneck-Api-Version': 'v3' }, response: { status: 'success', message: '', data: { accepted: 4, rejected: [] } } });
  };
  const r = createTransport({ auth: KASSIER(), fetch: holen });
  const entries: ReceiptOutputEntry[] = [
    { key: 'Ab_-0123', receiptId: 'KASSE1-ID-7', kind: 'print', at: '2026-09-26T07:58:00Z', result: 'ok' },
    { key: 'k'.repeat(64), receiptId: 'KASSE1-ID-7', kind: 'reprint', at: '2026-09-26T09:58:00.123456+02:00', result: 'unclear' },
    { key: 'teilen-0001', receiptId: 'KASSE1-ID-7', kind: 'link_shared', at: new Date(Date.UTC(2026, 8, 26, 7, 59)).toISOString() },
    { key: 'teilen-0002', receiptId: 'KASSE1-ID-7', kind: 'pdf_shared', at: 0 },
  ];
  await logReceiptOutputs(r, { entries });
  assert.deepEqual(gesendet[0]!.entries, entries);
});

test('logReceiptOutputs: 50 Eintraege gehen in einem Aufruf hinaus, undefined-Felder nicht', async () => {
  const gesendet: Json[] = [];
  const holen: FetchLike = async (_url, init) => {
    gesendet.push((JSON.parse(init.body) as { params: Json }).params);
    return antwortAus({ httpStatus: 200, headers: { 'Kasseneck-Api-Version': 'v3' }, response: { status: 'success', message: '', data: { accepted: 50, rejected: [] } } });
  };
  const r = createTransport({ auth: KASSIER(), fetch: holen });
  const entries = Array.from({ length: RECEIPT_OUTPUT_ENTRIES_MAX }, (_, i) => ({ key: `teilen-${1000 + i}`, receiptId: 'KASSE1-ID-7', kind: 'link_shared' as const, at: 1790409570000, result: undefined }));
  const ergebnis = await logReceiptOutputs(r, { entries });
  assert.deepEqual(ergebnis, { accepted: 50, rejected: [] });
  assert.equal(gesendet[0]!.entries.length, 50);
  assert.deepEqual(gesendet[0]!.entries[0], { key: 'teilen-1000', receiptId: 'KASSE1-ID-7', kind: 'link_shared', at: 1790409570000 });
  assert.equal(gesendet[0]!.cashregisterId, 'KASSE1');
});

test('logReceiptOutputs: unklarer Ausgang nach Zeitlimit (mit demselben Schluessel gefahrlos wiederholbar)', async () => {
  const haengt: FetchLike = (_url, init) => new Promise((_, ab) => init.signal.addEventListener('abort', () => ab(new Error('abgebrochen')), { once: true }));
  const r = createTransport({ auth: KASSIER(), fetch: haengt, timeoutMs: 20 });
  await assert.rejects(
    logReceiptOutputs(r, { entries: [{ key: 'druck-0001', receiptId: 'KASSE1-ID-7', kind: 'print', at: 1790409480000, result: 'ok' }] }),
    (e) => e instanceof KasseneckNetworkError && isOutcomeUnknown(e),
  );
});

test('logReceiptOutputs: kaputte Erfolgsantwort ist ein Antwortfehler, nie 0 angenommen', async () => {
  for (const data of [{ accepted: '3', rejected: [] }, { accepted: 3 }, { accepted: -1, rejected: [] }, { accepted: 1, rejected: [{ key: 'druck-0001' }] }, { accepted: 1, rejected: {} }, null]) {
    const f = structuredClone(fall('success_cashier'));
    f.response.data = data;
    const { fehler } = await rufe(f);
    assert.ok(isKasseneckValidationError(fehler) && fehler.scope === 'response', `${JSON.stringify(data)}: ${String(fehler)}`);
  }
  // Ein Code je Eintrag, den das Paket noch nicht kennt (neuerer Server), bleibt lesbar.
  const f = structuredClone(fall('success_cashier'));
  f.response.data = { accepted: 2, rejected: [{ key: 'druck-0002', code: 'receipt_archived' }], hint: 'neu' };
  const { ergebnis } = await rufe(f);
  assert.deepEqual(ergebnis, { accepted: 2, rejected: [{ key: 'druck-0002', code: 'receipt_archived' }] });
});

test('logReceiptOutputs ist ein Kassenaufruf mit Wirkung: Kassenweg, unklarer Ausgang, Fassade auch mit api_key', async () => {
  assert.ok((ALL_CALLS as readonly string[]).includes('logReceiptOutputs'));
  assert.ok((POS_CALLS as readonly string[]).includes('logReceiptOutputs'));
  assert.ok((UNKNOWN_OUTCOME_CALLS as readonly string[]).includes('logReceiptOutputs'));
  assert.ok(isPosOnlyCall('logReceiptOutputs'));
  assert.ok(isUnknownOutcomeCall('logReceiptOutputs'));
  const f = fall('success_api_key');
  const urls: string[] = [];
  const api = createKasseneckApi({
    auth: GERAET(),
    fetch: async (url, _init) => { urls.push(url); return antwortAus(f); },
  });
  const ergebnis = await api.logReceiptOutputs({ entries: f.params.entries });
  assert.deepEqual(ergebnis, f.response.data);
  assert.deepEqual(urls, [`${POS_BASE_URL}/logReceiptOutputs`]);
});

// --- outputs aus getReceipt ---------------------------------------------------

/** Liest einen Beleg-Fall ueber getReceiptWithCompany (Kanal aus dem Pfad). */
async function belegLesen(f: BelegFall) {
  const holen: FetchLike = async () => antwortAus(f);
  const kassenweg = f.path.startsWith('/api/v3/');
  const r = createTransport({ auth: kassenweg ? registerUserAuth({ getIdToken: () => 'eyJ-ID', getSessionId: () => 'sess-1', cashregisterId: 'KECK-1' }) : GERAET(), fetch: holen });
  return getReceiptWithCompany(r, f.params.receiptId);
}

test('getReceipt: outputs aus dem Vertragsfall get_receipt_with_outputs, beide Kanaele, Feld fuer Feld', async () => {
  for (const liste of [BELEGE, KASSE_BELEGE]) {
    const f = liste.find((c) => c.name === 'get_receipt_with_outputs');
    assert.ok(f, 'Fall get_receipt_with_outputs fehlt im Vertrag');
    const { outputs } = await belegLesen(f);
    assert.deepEqual(outputs, f.response.data.outputs, f.path);
    const arten = outputs!.map((o: ReceiptOutput) => o.kind).sort();
    assert.deepEqual(arten, ['email', 'opened', 'print', 'reprint']);
    const abruf = outputs!.find((o) => o.kind === 'opened')!;
    assert.equal(abruf.by, null);
    assert.equal(abruf.count, 3);
    // Nur der Abruf traegt eine Anzahl.
    for (const o of outputs!) assert.equal('count' in o, o.kind === 'opened', o.kind);
  }
});

test('getReceipt: jeder Erfolgsfall unter /v3 liest outputs als Liste; ohne Feld fehlt es', async () => {
  let n = 0;
  for (const f of [...BELEGE, ...KASSE_BELEGE].filter((c) => c.endpoint === 'getReceipt' && c.response.status === 'success')) {
    const ergebnis = await belegLesen(f);
    assert.ok(Array.isArray(f.response.data.outputs), `${f.name}: der Vertrag nennt outputs`);
    assert.deepEqual(ergebnis.outputs, f.response.data.outputs, f.name);
    n += 1;
  }
  assert.ok(n >= 6, `nur ${n} Faelle`);
  // Antwort ohne Protokoll (/api, createReceipt): kein Feld, keine leere Liste erfunden.
  const ohne = structuredClone(BELEGE.find((c) => c.name === 'get_receipt_with_outputs')!);
  delete ohne.response.data.outputs;
  assert.equal('outputs' in (await belegLesen(ohne)), false);
});

test('getReceipt: ein kaputtes Protokoll laesst den Beleg nie scheitern; unbekannte Werte bleiben stehen', async () => {
  const f = structuredClone(BELEGE.find((c) => c.name === 'get_receipt_with_outputs')!);
  f.response.data.outputs = [
    { kind: 'print', at: '2026-09-26T10:00:05+02:00', result: 'ok', by: { id: 'ru_livia', name: 'Livia Lindmayr' } },
    { kind: 'fax', at: '2026-09-26T10:01:00+02:00', result: 'pending', by: { id: 'ru_livia' }, count: 'x' },
    null,
    'print',
    { at: '2026-09-26T10:02:00+02:00', result: 'ok', by: null },
    { kind: 'reprint', at: 5, result: 'ok', by: null },
    { kind: 'opened', at: '2026-09-26T10:03:00+02:00', result: 'ok', by: { name: 'ohne Kennung' }, count: 2, extra: true },
  ];
  const { receipt, outputs } = await belegLesen(f);
  assert.equal(receipt.receiptId, f.response.data.receipt.receiptId);
  assert.deepEqual(outputs, [
    { kind: 'print', at: '2026-09-26T10:00:05+02:00', result: 'ok', by: { id: 'ru_livia', name: 'Livia Lindmayr' } },
    { kind: 'fax', at: '2026-09-26T10:01:00+02:00', result: 'pending', by: { id: 'ru_livia', name: null } },
    { kind: 'opened', at: '2026-09-26T10:03:00+02:00', result: 'ok', by: null, count: 2 },
  ]);
  const kaputt = structuredClone(f);
  kaputt.response.data.outputs = { kind: 'print' };
  const ohne = await belegLesen(kaputt);
  assert.equal(ohne.outputs, undefined);
});

// --- Kataloge und Codes ------------------------------------------------------

test('Kataloge: Arten und Ergebnisse sind die des /v3-Vokabulars, die Kasse meldet nur vier Arten', () => {
  assert.deepEqual([...RECEIPT_OUTPUT_KINDS], Object.values(VOKABULAR.catalogs.AUSGABE_ART));
  assert.deepEqual([...RECEIPT_OUTPUT_RESULTS], Object.values(VOKABULAR.catalogs.AUSGABE_ERGEBNIS));
  assert.deepEqual([...RECEIPT_OUTPUT_LOG_KINDS], ['print', 'reprint', 'link_shared', 'pdf_shared']);
  for (const k of RECEIPT_OUTPUT_LOG_KINDS) assert.ok((RECEIPT_OUTPUT_KINDS as readonly string[]).includes(k), k);
  // ./pos fuehrt dieselben Listen wie die Wurzel (die Kasse liest Texte und Arten an einer Stelle).
  assert.equal(kasse.RECEIPT_OUTPUT_KINDS, RECEIPT_OUTPUT_KINDS);
  assert.equal(kasse.RECEIPT_OUTPUT_RESULTS, RECEIPT_OUTPUT_RESULTS);
  assert.equal(RECEIPT_OUTPUT_ENTRIES_MAX, 50);
});

test('Fehlercodes: die des Endpunkts laut Vokabular, dahinter Rand und Anmeldung, zuletzt route_missing', () => {
  const eigen = [...(VOKABULAR.errorCodes.registerHandlersByEndpoint.logReceiptOutputs as string[])];
  const rand = randUndAnmeldung();
  const erwartet = [...eigen, ...rand.filter((c) => !eigen.includes(c)), 'route_missing'];
  assert.deepEqual([...RECEIPT_OUTPUT_ERROR_CODES], erwartet);
  for (const code of RECEIPT_OUTPUT_ERROR_CODES) {
    assert.ok((VOKABULAR.errorCodes.all as string[]).includes(code) || (CLIENT_ERROR_CODES as readonly string[]).includes(code), code);
  }
  // Codes je Eintrag: die des Endpunkts ohne server_error (ein Eintrag scheitert nie am Server selbst).
  assert.deepEqual([...RECEIPT_OUTPUT_ENTRY_ERROR_CODES].sort(), eigen.filter((c) => c !== 'server_error').sort());
  assert.equal(isReceiptOutputErrorCode('receipt_not_found'), true);
  assert.equal(isReceiptOutputErrorCode('RECEIPT_NOT_FOUND'), false);
  assert.equal(receiptOutputErrorCode(new Error('x')), undefined);
});

test('Feldfehler einer validation-Antwort sind lesbar', async () => {
  const f = structuredClone(fall('entries_empty'));
  const gesendet: Json[] = [];
  const r = createTransport({ auth: KASSIER(), fetch: async (_u, init) => { gesendet.push(JSON.parse(init.body)); return antwortAus(f); } });
  // Die Liste ist nicht leer, damit die Anfrage hinausgeht; die Antwort ist die des Falls.
  const e = await logReceiptOutputs(r, { entries: [{ key: 'druck-0001', receiptId: 'KASSE1-ID-7', kind: 'print', at: 1790409480000, result: 'ok' }] }).catch((x: unknown) => x);
  assert.equal(gesendet.length, 1);
  assert.ok(isReceiptOutputError(e, 'validation'));
  assert.deepEqual(receiptOutputFieldErrors(e), [{ field: 'entries', message: 'Ein bis 50 Einträge angeben.' }]);
});

// --- Texte -------------------------------------------------------------------

test('Texte: Ausgaben am Belegdetail, Web und App gleich, mit genau diesem Wortlaut', () => {
  const erwartet: Record<string, [string, string[]?]> = {
    'receipt.outputs_title': ['Ausgaben'],
    'receipt.outputs_count': ['{count} Ausgaben', ['count']],
    'receipt.output_print': ['Erstdruck'],
    'receipt.output_reprint': ['Duplikat'],
    'receipt.output_email': ['E-Mail'],
    'receipt.output_link_shared': ['Link geteilt'],
    'receipt.output_pdf_shared': ['PDF geteilt'],
    'receipt.output_opened': ['Vom Kunden geöffnet ({count}×)', ['count']],
    'receipt.output_failed': ['fehlgeschlagen'],
  };
  for (const [schluessel, [text, platzhalter]] of Object.entries(erwartet)) {
    const eintrag = (LABELS as Record<string, { text: string; placeholders?: readonly string[]; only?: readonly string[] }>)[schluessel];
    assert.ok(eintrag, schluessel);
    assert.equal(eintrag.text, text, schluessel);
    assert.deepEqual(eintrag.placeholders === undefined ? undefined : [...eintrag.placeholders], platzhalter, schluessel);
    assert.equal(eintrag.only, undefined, `${schluessel}: gilt auf beiden Seiten`);
  }
  // Jede Art hat ihre Beschriftung unter receipt.output_<art>, und genau diese gibt es.
  for (const art of RECEIPT_OUTPUT_KINDS) assert.ok(`receipt.output_${art}` in LABELS, art);
  const ausgaben = Object.keys(LABELS).filter((k) => k.startsWith('receipt.output')).sort();
  assert.deepEqual(ausgaben, Object.keys(erwartet).sort());
  assert.equal(labelText('receipt.output_opened' as LabelKey, { count: 3 }), 'Vom Kunden geöffnet (3×)');
  assert.equal(labelText('receipt.outputs_count' as LabelKey, { count: 4 }), '4 Ausgaben');
});

test('receiptOutputLabel: Art -> Beschriftung, nie eine Ausnahme (kaputtes oder neueres Protokoll)', () => {
  const o = (kind: string, extra: Partial<ReceiptOutput> = {}): ReceiptOutput => ({ kind, at: '2026-09-26T10:00:05+02:00', result: 'ok', by: null, ...extra });
  assert.equal(receiptOutputLabel(o('print')), 'Erstdruck');
  assert.equal(receiptOutputLabel(o('reprint', { result: 'unclear' })), 'Duplikat');
  assert.equal(receiptOutputLabel(o('email')), 'E-Mail');
  assert.equal(receiptOutputLabel(o('link_shared')), 'Link geteilt');
  assert.equal(receiptOutputLabel(o('pdf_shared')), 'PDF geteilt');
  assert.equal(receiptOutputLabel(o('opened', { count: 40 })), 'Vom Kunden geöffnet (40×)');
  // Nur die Art: „fehlgeschlagen“ setzt die Kasse selbst dazu.
  assert.equal(receiptOutputLabel(o('print', { result: 'failed' })), 'Erstdruck');
  assert.equal(labelText('receipt.output_failed'), 'fehlgeschlagen');
  // Abruf ohne gueltige Anzahl zaehlt als ein Abruf.
  for (const count of [undefined, 0, -2, 1.5, Number.NaN, '3' as never]) {
    assert.equal(receiptOutputLabel(o('opened', count === undefined ? {} : { count })), 'Vom Kunden geöffnet (1×)', String(count));
  }
  // Unbekannte Art (neuerer Server) oder kaputtes Protokoll: null, keine Ausnahme.
  for (const kind of ['fax', '', 'constructor', 'toString', '__proto__', 'outputs_title', null as never, 42 as never]) {
    assert.equal(receiptOutputLabel(o(kind)), null, String(kind));
  }
  assert.equal(receiptOutputLabel(null as never), null);
  assert.equal(receiptOutputLabel({} as never), null);
  // Jede Art des Katalogs hat eine Beschriftung.
  for (const art of RECEIPT_OUTPUT_KINDS) assert.equal(typeof receiptOutputLabel(o(art)), 'string', art);
});

test('receiptOutputLabel: jeder Eintrag des Vertragsfalls und eines kaputten Protokolls ergibt eine Zeile ohne Ausnahme', async () => {
  const f = structuredClone(BELEGE.find((c) => c.name === 'get_receipt_with_outputs')!);
  const { outputs } = await belegLesen(f);
  assert.deepEqual(outputs!.map(receiptOutputLabel), ['Duplikat', 'Vom Kunden geöffnet (3×)', 'E-Mail', 'Erstdruck']);
  f.response.data.outputs = [
    { kind: 'fax', at: '2026-09-26T10:01:00+02:00', result: 'ok', by: null },
    { kind: 'opened', at: '2026-09-26T10:03:00+02:00', result: 'ok', by: null },
    { kind: 'reprint', at: '2026-09-26T10:04:00+02:00', result: 'failed', by: { id: 'ru_livia', name: 'Livia Lindmayr' } },
  ];
  const kaputt = (await belegLesen(f)).outputs!;
  assert.deepEqual(kaputt.map(receiptOutputLabel), [null, 'Vom Kunden geöffnet (1×)', 'Duplikat']);
  assert.equal(kaputt[2]!.result, 'failed');
});
