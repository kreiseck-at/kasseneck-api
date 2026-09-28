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
  type CancelResult,
  type CreditNoteResult,
  type EInvoiceStatus,
  type Invoice,
  type InvoiceDetail,
  type InvoiceDetailPayment,
  type InvoiceItem,
  type InvoiceNotice,
  type InvoicePage,
  type InvoicePayment,
  type InvoicePreview,
  type InvoiceRateTotals,
  type InvoiceRecipient,
  type InvoiceSetupStatus,
  type InvoiceTotals,
  type IssueInvoiceRequest,
  type IssueResult,
  type PreviewResult,
  type RecordPaymentResult,
  INVOICE_REQUEST_ERROR_CODES,
  isInvoiceErrorCode,
  isInvoiceError,
  invoiceFieldErrors,
  type InvoiceApiErrorCode,
} from '../src/invoice/index.js';
import { KasseneckApiError } from '../src/client/errors.js';
import { randUndAnmeldung } from './kassenweg-codes.js';
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
  const schema = readFileSync(fileURLToPath(new URL('../../fixtures/invoice-api.schema.json', import.meta.url)), 'utf8');
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

// ---- Feldmengen: jede Sicht traegt genau die Felder ihres Typs ------------------

/**
 * Schluesselliste eines Typs, in beide Richtungen geprueft: ein Name, den der
 * Typ nicht kennt, scheitert am `keyof`, und fehlt ein Feld des Typs, verlangt
 * der Aufruf ein zweites Argument und die Uebersetzung schlaegt fehl.
 */
function schluessel<T>() {
  return <const K extends readonly (keyof T & string)[]>(
    k: K,
    ..._vollstaendig: [Exclude<keyof T, K[number]>] extends [never] ? [] : [fehlt: Exclude<keyof T, K[number]>]
  ): readonly string[] => k;
}

const FELDER = {
  invoice: schluessel<Invoice>()(['id', 'number', 'docType', 'status', 'invoiceDate', 'dueDate', 'customerId', 'totals',
    'einvoice', 'statusUrl', 'statusPassword', 'metadata', 'language', 'brand', 'paidCents', 'openCents']),
  detail: schluessel<InvoiceDetail>()(['id', 'number', 'docType', 'status', 'invoiceDate', 'dueDate', 'customerId', 'totals',
    'einvoice', 'statusUrl', 'statusPassword', 'metadata', 'language', 'brand', 'paidCents', 'openCents', 'items', 'customer',
    'taxScheme', 'reverseChargeReason', 'taxCountry', 'priceMode', 'serviceStart', 'serviceEnd', 'paymentTermDays',
    'orderReference', 'payments', 'overdue', 'writtenOff', 'writeOffReasonCode', 'related', 'creditNotes', 'source',
    'createdAt', 'finalizedAt']),
  totals: schluessel<InvoiceTotals>()(['netCents', 'vatCents', 'grossCents', 'byRate']),
  rate: schluessel<InvoiceRateTotals>()(['rate', 'netCents', 'vatCents', 'grossCents']),
  einvoice: schluessel<EInvoiceStatus>()(['level', 'formats', 'missing']),
  brand: schluessel<NonNullable<Invoice['brand']>>()(['id', 'name']),
  item: schluessel<InvoiceItem>()(['description', 'subtitle', 'quantity', 'unit', 'kind', 'unitPriceCents', 'unitPriceMicros',
    'vatRate', 'discountPct']),
  recipient: schluessel<InvoiceRecipient>()(['name', 'type', 'street', 'houseNumber', 'zip', 'city', 'country', 'vatId',
    'shortCode', 'email', 'isAuthority']),
  detailPayment: schluessel<InvoiceDetailPayment>()(['id', 'amountCents', 'date', 'method', 'reference']),
  related: schluessel<NonNullable<InvoiceDetail['related']>>()(['invoiceId', 'number']),
  creditNoteRef: schluessel<InvoiceDetail['creditNotes'][number]>()(['id', 'number', 'grossCents']),
  preview: schluessel<InvoicePreview>()(['docType', 'invoiceDate', 'dueDate', 'customerId', 'taxScheme', 'taxSchemeReason',
    'reverseChargeReason', 'taxCountry', 'priceMode', 'totals', 'language', 'brand', 'einvoice']),
  notice: schluessel<InvoiceNotice>()(['code', 'message']),
  payment: schluessel<InvoicePayment>()(['id', 'amountCents', 'paidAt', 'method', 'reference']),
  original: schluessel<CancelResult['original']>()(['id', 'status']),
  setup: schluessel<InvoiceSetupStatus>()(['ready', 'environment', 'missing']),
  issue: schluessel<IssueResult>()(['invoice', 'replayed', 'notice']),
  previewResult: schluessel<PreviewResult>()(['preview', 'notice']),
  cancel: schluessel<CancelResult>()(['creditNote', 'original', 'originalPaidCents', 'replayed']),
  creditNote: schluessel<CreditNoteResult>()(['creditNote', 'remainingCents', 'replayed']),
  record: schluessel<RecordPaymentResult>()(['invoice', 'payment', 'replayed', 'notice']),
  page: schluessel<InvoicePage>()(['invoices', 'nextCursor']),
} as const;

/** Felder, die der Typ als optional fuehrt und die in einer Antwort fehlen duerfen. */
const OPTIONAL = new Set(['unitPriceMicros', 'notice']);

const geprueft = new Set<string>();

function feldmenge(wert: unknown, sicht: keyof typeof FELDER, pfad: string): void {
  if (wert === null) return;
  assert.ok(wert !== undefined && typeof wert === 'object' && !Array.isArray(wert), `${pfad}: kein Objekt`);
  geprueft.add(sicht);
  const erwartet = FELDER[sicht];
  const da = Object.keys(wert as Json);
  for (const k of da) assert.ok(erwartet.includes(k), `${pfad}: Feld ${k} fehlt im Typ (${sicht})`);
  for (const k of erwartet) assert.ok(da.includes(k) || OPTIONAL.has(k), `${pfad}: Feld ${k} fehlt in der Antwort (${sicht})`);
}

function rechnungssicht(r: Json, pfad: string, detail: boolean): void {
  feldmenge(r, detail ? 'detail' : 'invoice', pfad);
  feldmenge(r.totals, 'totals', `${pfad}.totals`);
  for (const [i, s] of (r.totals.byRate as Json[]).entries()) feldmenge(s, 'rate', `${pfad}.totals.byRate[${i}]`);
  feldmenge(r.einvoice, 'einvoice', `${pfad}.einvoice`);
  feldmenge(r.brand, 'brand', `${pfad}.brand`);
  if (!detail) return;
  for (const [i, p] of (r.items as Json[]).entries()) feldmenge(p, 'item', `${pfad}.items[${i}]`);
  feldmenge(r.customer, 'recipient', `${pfad}.customer`);
  for (const [i, z] of (r.payments as Json[]).entries()) feldmenge(z, 'detailPayment', `${pfad}.payments[${i}]`);
  feldmenge(r.related, 'related', `${pfad}.related`);
  for (const [i, g] of (r.creditNotes as Json[]).entries()) feldmenge(g, 'creditNoteRef', `${pfad}.creditNotes[${i}]`);
}

function hinweisePruefen(d: Json, pfad: string): void {
  for (const [i, h] of ((d.notice ?? []) as Json[]).entries()) feldmenge(h, 'notice', `${pfad}.notice[${i}]`);
}

test('Feldmengen: jede Sicht der Vertragsfaelle traegt genau die Felder ihres Typs, keines mehr, keines weniger', () => {
  // Die Schleife ueberspringt Fehlerfaelle; ohne Erfolgsfall pruefte sie still nichts.
  assert.ok(FAELLE.filter((f) => f.response.status === 'success').length >= 5, 'zu wenige Erfolgsfaelle im Vertrag');
  for (const fall of FAELLE) {
    if (fall.response.status !== 'success') continue;
    const d = fall.response.data as Json;
    const p = fall.name;
    switch (fall.endpoint) {
      case 'issueInvoice':
        if (d.preview) {
          feldmenge(d, 'previewResult', p);
          feldmenge(d.preview, 'preview', `${p}.preview`);
          feldmenge(d.preview.totals, 'totals', `${p}.preview.totals`);
          feldmenge(d.preview.einvoice, 'einvoice', `${p}.preview.einvoice`);
          feldmenge(d.preview.brand, 'brand', `${p}.preview.brand`);
        } else {
          feldmenge(d, 'issue', p);
          rechnungssicht(d.invoice, `${p}.invoice`, false);
        }
        hinweisePruefen(d, p);
        break;
      case 'getInvoice': rechnungssicht(d.invoice, `${p}.invoice`, true); break;
      case 'listInvoices':
        feldmenge(d, 'page', p);
        for (const [i, r] of (d.invoices as Json[]).entries()) rechnungssicht(r, `${p}.invoices[${i}]`, false);
        break;
      case 'createCreditNote': feldmenge(d, 'creditNote', p); rechnungssicht(d.creditNote, `${p}.creditNote`, false); break;
      case 'cancelInvoice':
        feldmenge(d, 'cancel', p);
        rechnungssicht(d.creditNote, `${p}.creditNote`, false);
        feldmenge(d.original, 'original', `${p}.original`);
        break;
      case 'recordInvoicePayment':
        feldmenge(d, 'record', p);
        rechnungssicht(d.invoice, `${p}.invoice`, false);
        feldmenge(d.payment, 'payment', `${p}.payment`);
        hinweisePruefen(d, p);
        break;
      case 'getInvoiceSetupStatus': feldmenge(d, 'setup', p); break;
      case 'listBrands': assert.deepEqual(Object.keys(d), ['brands'], p); break;
      default: assert.fail(`${p}: Endpunkt ${fall.endpoint} ohne Feldpruefung`);
    }
  }
  // Was der Export nicht belegt, belegen die beiden Tests darunter.
  assert.deepEqual(Object.keys(FELDER).filter((s) => !geprueft.has(s)).sort(), ['detailPayment', 'related']);
});

/*
 * Gebuchte Zahlungen und der Bezug einer Gutschrift kommen in keinem Exportfall
 * gefuellt vor. Ihre Form stammt aus dem Backend (invoice-api-core.js,
 * `oeffentlicheRechnung`): jedes Feld einer Zahlung kann bei Altbestand `null`
 * sein, ausser dem Betrag. Dieselbe Zahlung heisst in `recordInvoicePayment`
 * `paidAt`, hier `date` (Backend-Draht, nicht umbenannt).
 */
const DETAIL_MIT_ZAHLUNGEN: Json = {
  ...(FAELLE.find((f) => f.name === 'get_invoice')!.response.data.invoice as Json),
  payments: [
    { id: 'z1', amountCents: 5000, date: '2026-09-26', method: 'transfer', reference: 'pi_3Q' },
    { id: null, amountCents: 1200, date: null, method: null, reference: null },
  ],
  related: { invoiceId: 'auto0', number: null },
};

test('getInvoice: gebuchte Zahlungen mit id und reference, fehlende Angaben als null', async () => {
  rechnungssicht(DETAIL_MIT_ZAHLUNGEN, 'getInvoice(Zahlungen)', true);
  const fall: Fall = {
    name: 'get_invoice_payments', endpoint: 'getInvoice', path: '/v3/getInvoice', params: { invoiceId: 'auto1' }, httpStatus: 200,
    headers: { 'Kasseneck-Api-Version': 'v3' },
    response: { status: 'success', message: '', data: { invoice: DETAIL_MIT_ZAHLUNGEN } },
  };
  const detail = (await fallAusfuehren(fall)).ergebnis as InvoiceDetail;
  const [erste, zweite] = detail.payments;
  assert.equal(erste?.reference, 'pi_3Q');
  assert.equal(erste?.id, 'z1');
  assert.equal(zweite?.date, null);
  assert.equal(zweite?.method, null);
  // Typebene: ein Aufrufer muss null bedenken, bevor er das Datum zerlegt.
  const monat = (z: InvoiceDetailPayment): string | null => (z.date === null ? null : z.date.slice(0, 7));
  assert.deepEqual(detail.payments.map(monat), ['2026-09', null]);
  assert.deepEqual(detail.related, { invoiceId: 'auto0', number: null });
});

// --- Fehlerhelfer: dieselbe Form wie Kasse, Anmeldung, Belege und Partner -------

test('INVOICE_REQUEST_ERROR_CODES: Anmeldung und Rand aus dem Vertrag, dahinter route_missing; Helfer erkennen beide Listen', () => {
  const katalog = VOKABULAR.errorCodes.invoice as string[];
  assert.deepEqual([...INVOICE_REQUEST_ERROR_CODES], [...randUndAnmeldung().filter((c) => !katalog.includes(c)), 'route_missing']);
  for (const c of ['dialect_mismatch', 'response_translation_failed', 'internal_translation_error', 'not_found', 'method_not_allowed', 'route_missing']) {
    assert.ok(isInvoiceErrorCode(c), c);
    const e = new KasseneckApiError('issueInvoice', 'x', {}, c);
    assert.equal(invoiceErrorCode(e), c);
    assert.ok(isInvoiceError(e, c as InvoiceApiErrorCode), c);
    assert.ok(isInvoiceError(e), c);
  }
  assert.equal(isInvoiceErrorCode('customer_exists'), true);
  assert.equal(isInvoiceErrorCode('brand_new_code_2027'), false);
  assert.equal(isInvoiceError(new KasseneckApiError('issueInvoice', 'x', {}, 'brand_new_code_2027')), false);
  assert.equal(isInvoiceError(new Error('x')), false);
  // Typwaechter: danach ist `details` ohne Umwandlung lesbar.
  const e: unknown = new KasseneckApiError('issueInvoice', 'x', { errors: [{ field: 'items[0].vatRate', message: 'm' }] }, 'validation');
  if (isInvoiceError(e, 'validation')) assert.ok(Array.isArray(e.details['errors']));
  else assert.fail('validation nicht erkannt');
  assert.deepEqual(invoiceFieldErrors(e), [{ field: 'items[0].vatRate', message: 'm' }]);
});
