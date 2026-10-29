import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createBinaryTransport, type FetchLike, type HttpResponseLike } from '../src/client/transport.js';
import { apiKeyAuth } from '../src/client/auth.js';
import { KasseneckApiError } from '../src/client/errors.js';

/**
 * `antworten/berichte.json` aus dem Backend-Vertrag: `getCashregisterReport`
 * als Binaerweg, erzeugt aus dem echten Handler. Die Datei kommt als PDF, jede
 * Ablehnung mit HTTP 200 als Huelle. Der Binaerweg muss die Datei Byte fuer
 * Byte liefern und jede Ablehnung als Fehler mit dem Code des Vertrags werfen;
 * kasseneck_api reichte die Huelle bis 11.8.0 als PDF durch (Befund 29.10.2026).
 *
 * Gerufen wird der Transport selbst, nicht `getCashregisterReport`: dessen
 * Eingabepruefung wiese `error_invalid_period` (Mischform) schon vor dem Senden
 * ab, und hier geht es um die Antwort des Servers.
 */
interface BerichtFall {
  name: string;
  endpoint: string;
  params: Record<string, unknown>;
  httpStatus: number;
  headers: Record<string, string>;
  file?: { startsWith: string };
  response?: { status: string; message: string; code: string; data: { code: string } };
}

const BERICHTE = (
  JSON.parse(readFileSync(fileURLToPath(new URL('../../fixtures/v3/antworten/berichte.json', import.meta.url)), 'utf8')) as {
    cases: BerichtFall[];
  }
).cases;

/** Die Bytes einer Datei des Vertrags: ihr Anfang, dann Bytes, die kein UTF-8 sind. */
const dateiBytes = (f: BerichtFall): Uint8Array =>
  new Uint8Array([...new TextEncoder().encode(`${f.file!.startsWith}1.7\n`), 0xc3, 0x28, 0xff, 0x00, 0x0a]);

function antwortAus(f: BerichtFall): HttpResponseLike {
  const bytes = f.file ? dateiBytes(f) : new TextEncoder().encode(JSON.stringify(f.response));
  const kopf: Record<string, string> = {};
  for (const [k, v] of Object.entries(f.headers)) kopf[k.toLowerCase()] = v;
  return {
    status: f.httpStatus,
    headers: { get: (name: string) => kopf[name.toLowerCase()] ?? null },
    text: async () => {
      throw new Error('Der Binaerweg darf text() nicht anfassen');
    },
    arrayBuffer: async () => bytes.slice().buffer,
  };
}

function rufe(f: BerichtFall): Promise<Uint8Array> {
  const holen: FetchLike = async () => antwortAus(f);
  const rufen = createBinaryTransport({
    auth: apiKeyAuth({ apiKey: 'kr_test_GEHEIMERAPIKEY', cashregisterToken: 'cb_test_GEHEIMESKASSENTOKEN' }),
    fetch: holen,
  });
  return rufen(f.endpoint, f.params);
}

test('berichte.json: Datei und Ablehnung sind beide im Vertrag', () => {
  // Sonst liefen die beiden Tests unten leer und blieben gruen.
  assert.ok(BERICHTE.some((f) => f.file), 'kein Fall mit Datei');
  assert.ok(BERICHTE.some((f) => f.response?.status === 'error'), 'kein Fall mit Ablehnung');
  for (const f of BERICHTE) assert.equal(f.endpoint, 'getCashregisterReport', f.name);
});

test('berichte.json: die Datei kommt Byte fuer Byte an', async () => {
  for (const f of BERICHTE.filter((x) => x.file)) {
    assert.deepEqual(Array.from(await rufe(f)), Array.from(dateiBytes(f)), f.name);
  }
});

test('berichte.json: jede Ablehnung mit HTTP 200 ist ein KasseneckApiError mit dem Code des Vertrags', async () => {
  for (const f of BERICHTE.filter((x) => !x.file)) {
    assert.equal(f.httpStatus, 200, f.name);
    await assert.rejects(rufe(f), (fehler: unknown) => {
      assert.ok(fehler instanceof KasseneckApiError, `${f.name}: ${String(fehler)}`);
      assert.equal(fehler.code, f.response!.code, f.name);
      assert.equal(fehler.outcome, 'rejected', f.name);
      assert.equal(fehler.functionName, 'getCashregisterReport', f.name);
      assert.equal(fehler.serverMessage, f.response!.message, f.name);
      return true;
    });
  }
});
