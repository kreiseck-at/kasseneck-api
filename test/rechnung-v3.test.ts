import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createInvoiceApi,
  invoiceErrorCode,
  DOC_TYPES,
  EINVOICE_MISSING_CODES,
  INVOICE_ENDPOINTS,
  INVOICE_ERROR_CODES,
  INVOICE_NOTICE_CODES,
  INVOICE_REQUESTS,
  TAX_SCHEMES,
  WRITE_OFF_REASON_CODES,
  type IssueInvoiceRequest,
} from '../src/rechnung/index.js';
import { KasseneckApiError } from '../src/client/errors.js';
import type { FetchLike, HttpRequestInit, HttpResponseLike } from '../src/client/transport.js';

/*
 * Rechnungs-API am englischen Draht `/v3`, gegen den Vertrags-Export des
 * Backends (fixtures/v3). Die Werte der Kataloge kommen aus
 * `v3-vokabular.json`, nie aus diesem Test; jeder Fall aus
 * `antworten/rechnungen.json` geht durch den Client: gesendet wird genau der
 * Fall, gelesen wird nur, was der Vertrag nennt.
 */

type Json = Record<string, any>;
interface Fall {
  name: string;
  endpoint: string;
  path: string;
  params: Json;
  httpStatus: number;
  headers: Record<string, string>;
  response: Json;
}

const lies = (datei: string): Json =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../fixtures/v3/${datei}`, import.meta.url)), 'utf8')) as Json;
const VOKABULAR = lies('v3-vokabular.json');
const FAELLE = lies('antworten/rechnungen.json').cases as Fall[];
const katalog = (name: string): string[] => Object.values(VOKABULAR.catalogs[name] as Record<string, string>);
const werteVon = (aufruf: keyof typeof INVOICE_REQUESTS, feld: string): readonly unknown[] => {
  const f = INVOICE_REQUESTS[aufruf][feld];
  assert.ok(f && f.type === 'enum', `${aufruf}.${feld} ist kein enum`);
  return f.values;
};

test('Kataloge: Steuerfall, Belegart, Abschreibungsgrund und fehlende E-Rechnungs-Angaben wie im Vokabular', () => {
  // Reihenfolge wie im Backend: neue Faelle stehen hinten.
  assert.deepEqual([...TAX_SCHEMES], katalog('STEUERFALL'));
  assert.ok(TAX_SCHEMES.includes('intraCommunitySupply'));
  assert.deepEqual([...DOC_TYPES], katalog('DOKART'));
  assert.deepEqual([...DOC_TYPES], ['invoice', 'credit_note']);
  assert.deepEqual([...WRITE_OFF_REASON_CODES], katalog('ABSCHREIBUNG'));
  assert.deepEqual([...EINVOICE_MISSING_CODES], katalog('EINVOICE_FEHLT'));
  assert.deepEqual([...INVOICE_ERROR_CODES], VOKABULAR.errorCodes.invoice);
  assert.deepEqual([...INVOICE_NOTICE_CODES], VOKABULAR.noticeCodes);
});

test('Anfragen: taxScheme und docType nehmen nur die englischen Werte an', () => {
  assert.deepEqual(werteVon('issueInvoice', 'taxScheme'), [...TAX_SCHEMES]);
  assert.deepEqual(werteVon('listInvoices', 'docType'), [...DOC_TYPES]);
  for (const deutsch of ['igLieferung', 'RE', 'GU']) {
    assert.ok(!werteVon('issueInvoice', 'taxScheme').includes(deutsch), deutsch);
    assert.ok(!werteVon('listInvoices', 'docType').includes(deutsch), deutsch);
  }
});

test('Aufrufe: jeder Rechnungs-Endpunkt ist oeffentlich und unter /v3 geroutet', () => {
  for (const name of INVOICE_ENDPOINTS) {
    assert.ok(VOKABULAR.endpoints.public.includes(name), name);
    assert.ok(VOKABULAR.endpoints.v3Routed.includes(name), name);
    assert.ok(VOKABULAR.schemas[name], `${name} ohne Schema im Vokabular`);
  }
});

test('Schema-Fixture: keine deutschen Werte mehr in der Anfrageform', () => {
  const schema = readFileSync(fileURLToPath(new URL('../../fixtures/rechnung-api.schema.json', import.meta.url)), 'utf8');
  assert.ok(schema.includes('"intraCommunitySupply"'));
  assert.ok(schema.includes('"credit_note"'));
  for (const deutsch of ['"igLieferung"', '"RE"', '"GU"']) assert.ok(!schema.includes(deutsch), deutsch);
});

function antwortAus(fall: Fall): HttpResponseLike {
  const rumpf = JSON.stringify(fall.response);
  const kopf: Record<string, string> = { 'content-type': 'application/json' };
  for (const [k, v] of Object.entries(fall.headers)) kopf[k.toLowerCase()] = v;
  return {
    status: fall.httpStatus,
    headers: { get: (name: string) => kopf[name.toLowerCase()] ?? null },
    text: async () => rumpf,
    arrayBuffer: async () => new TextEncoder().encode(rumpf).buffer,
  };
}

/** Prueft jede Rechnungssicht einer Antwort gegen die Kataloge, rekursiv. */
function sichtenPruefen(wert: unknown, pfad: string): void {
  if (Array.isArray(wert)) {
    wert.forEach((w, i) => sichtenPruefen(w, `${pfad}[${i}]`));
    return;
  }
  if (wert === null || typeof wert !== 'object') return;
  const o = wert as Json;
  if ('docType' in o) assert.ok((DOC_TYPES as readonly string[]).includes(o.docType), `${pfad}.docType ${o.docType}`);
  if ('taxScheme' in o) assert.ok((TAX_SCHEMES as readonly string[]).includes(o.taxScheme), `${pfad}.taxScheme ${o.taxScheme}`);
  if ('writeOffReasonCode' in o && o.writeOffReasonCode !== null) {
    assert.ok((WRITE_OFF_REASON_CODES as readonly string[]).includes(o.writeOffReasonCode), `${pfad}.writeOffReasonCode`);
  }
  if (o.einvoice && Array.isArray(o.einvoice.missing)) {
    for (const m of o.einvoice.missing) assert.ok((EINVOICE_MISSING_CODES as readonly string[]).includes(m), `${pfad}.einvoice.missing ${m}`);
  }
  for (const [k, v] of Object.entries(o)) sichtenPruefen(v, `${pfad}.${k}`);
}

async function fallAusfuehren(fall: Fall): Promise<{ url: string; params: Json; ergebnis?: unknown; fehler?: unknown }> {
  let url = '';
  let params: Json = {};
  const holen: FetchLike = async (u: string, init: HttpRequestInit) => {
    url = u;
    params = (JSON.parse(init.body) as { params: Json }).params;
    return antwortAus(fall);
  };
  const api = createInvoiceApi({ apiKey: 'kr_test_Beispielschluessel0123456789', fetch: holen });
  const p = fall.params;
  const aufruf = async (): Promise<unknown> => {
    switch (fall.endpoint) {
      case 'issueInvoice': {
        const { dryRun, ...rest } = p;
        // `dryRun: false` schickt der Export ausdruecklich mit; der Client laesst es weg,
        // es bedeutet dasselbe. Darum wandert es als eigenes Feld mit.
        return dryRun === true
          ? api.previewInvoice(rest as IssueInvoiceRequest)
          : api.issueInvoice({ ...rest, ...(dryRun === false ? { dryRun } : {}) } as IssueInvoiceRequest);
      }
      case 'getInvoice': return api.getInvoice(p as { invoiceId: string });
      case 'listInvoices': return api.listInvoices(p);
      case 'createCreditNote': return api.createCreditNote(p as never);
      case 'cancelInvoice': return api.cancelInvoice(p as never);
      case 'recordInvoicePayment': return api.recordInvoicePayment(p as never);
      case 'getInvoiceSetupStatus': return api.getInvoiceSetupStatus();
      case 'listBrands': return api.listBrands();
      default: throw new Error(`Fall ${fall.name}: Endpunkt ${fall.endpoint} nicht abgedeckt`);
    }
  };
  try {
    const ergebnis = await aufruf();
    return { url, params, ergebnis };
  } catch (fehler) {
    return { url, params, fehler };
  }
}

test('Vertragsfaelle: jeder Fall geht unveraendert an /v3/<name>, die Antwort traegt nur englische Werte', async () => {
  assert.ok(FAELLE.length >= 20);
  for (const fall of FAELLE) {
    const { url, params, ergebnis, fehler } = await fallAusfuehren(fall);
    assert.equal(url, `https://api.kasseneck.at${fall.path}`, fall.name);
    assert.deepEqual(params, fall.params, fall.name);
    if (fall.response.status === 'success') {
      assert.equal(fehler, undefined, `${fall.name}: ${String(fehler)}`);
      sichtenPruefen(ergebnis, fall.name);
    } else {
      assert.ok(fehler instanceof KasseneckApiError, fall.name);
      assert.equal(fehler.code, fall.response.code, fall.name);
      assert.equal(invoiceErrorCode(fehler), fall.response.code, `${fall.name}: Code nicht im Katalog`);
      const missing = fehler.details['missing'];
      if (Array.isArray(missing)) {
        for (const m of missing) assert.ok((EINVOICE_MISSING_CODES as readonly string[]).includes(m), `${fall.name}: ${m}`);
      }
    }
  }
});

test('tax_scheme_mismatch: erwartet und gegeben sind Steuerfaelle des Katalogs', async () => {
  const fall = FAELLE.find((f) => f.name === 'error_tax_scheme_mismatch');
  assert.ok(fall);
  const { fehler } = await fallAusfuehren(fall);
  assert.ok(fehler instanceof KasseneckApiError);
  assert.equal(fehler.details['expected'], 'intraCommunitySupply');
  assert.ok((TAX_SCHEMES as readonly unknown[]).includes(fehler.details['given']));
});

test('Abschreibung und Gutschrift: englische Werte kommen beim Aufrufer an', async () => {
  const abgeschrieben = FAELLE.find((f) => f.name === 'get_invoice_written_off');
  assert.ok(abgeschrieben);
  const a = (await fallAusfuehren(abgeschrieben)).ergebnis as Json;
  assert.equal(a.writtenOff, true);
  assert.ok((WRITE_OFF_REASON_CODES as readonly string[]).includes(a.writeOffReasonCode));

  const gutschriften = FAELLE.find((f) => f.name === 'list_credit_notes');
  assert.ok(gutschriften);
  const g = (await fallAusfuehren(gutschriften)).ergebnis as Json;
  assert.ok(g.invoices.length > 0);
  for (const r of g.invoices) assert.equal(r.docType, 'credit_note');
});
