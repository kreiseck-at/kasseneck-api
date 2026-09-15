import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createRechnungApi } from '../src/rechnung/api.js';
import { rechnungKeyAuth } from '../src/rechnung/auth.js';
import { istRechnungFehler, rechnungFehlerCode, rechnungFeldFehler } from '../src/rechnung/fehler.js';
import type { IssueInvoiceRequest } from '../src/rechnung/typen.js';
import { KasseneckApiError, KasseneckAuthError, KasseneckValidationError } from '../src/client/errors.js';
import type { FetchLike, HttpRequestInit, HttpResponseLike } from '../src/client/transport.js';

const API_KEY = 'kr_test_Beispielschluessel0123456789';

interface Aufzeichnung {
  url: string;
  init: HttpRequestInit;
}

function antwort(rumpf: unknown, inhaltstyp = 'application/json'): HttpResponseLike {
  const bytes = rumpf instanceof Uint8Array ? rumpf : new TextEncoder().encode(JSON.stringify(rumpf));
  return {
    status: 200,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? inhaltstyp : null) },
    text: async () => new TextDecoder().decode(bytes),
    arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer,
  };
}

const erfolg = (data: unknown) => ({ status: 'success', message: 'ok', data });
const fehler = (message: string, code: string, data: unknown = {}) => ({ status: 'error', message, code, data });

/** Fake-fetch: zeichnet jede Anfrage auf und antwortet der Reihe nach. */
function attrappe(...antworten: HttpResponseLike[]): { fetch: FetchLike; anfragen: Aufzeichnung[] } {
  const anfragen: Aufzeichnung[] = [];
  let i = 0;
  const fetch: FetchLike = async (url, init) => {
    anfragen.push({ url, init });
    const naechste = antworten[i++];
    if (!naechste) throw new Error('Attrappe: keine Antwort mehr vorbereitet');
    return naechste;
  };
  return { fetch, anfragen };
}

const kopf = (a: Aufzeichnung, name: string): string | undefined => {
  const h = a.init.headers as Record<string, string> | undefined;
  if (!h) return undefined;
  const treffer = Object.keys(h).find((k) => k.toLowerCase() === name.toLowerCase());
  return treffer ? h[treffer] : undefined;
};
const params = (a: Aufzeichnung): Record<string, unknown> => JSON.parse(String(a.init.body)).params;

const rechnung = {
  id: 'inv1', number: '2026-0042', docType: 'RE', status: 'final',
  invoiceDate: '2026-09-14', dueDate: '2026-09-28', customerId: 'k1',
  totals: { netCents: 10000, vatCents: 2000, grossCents: 12000, byRate: [{ rate: 20, netCents: 10000, vatCents: 2000 }] },
  einvoice: { level: 'full', formats: ['UBL', 'Factur-X'], missing: [] },
  statusUrl: 'https://mein.kasseneck.at/r/abc', statusPassword: 'XK4P', metadata: {},
};

// ---- Anmeldung --------------------------------------------------------------

test('rechnungKeyAuth: Bearer ohne Kassen-Token', async () => {
  const cred = await rechnungKeyAuth({ apiKey: API_KEY })();
  assert.equal(cred.headers['Authorization'], `Bearer ${API_KEY}`);
  assert.equal(cred.headers['cashregister-token'], undefined);
});

test('rechnungKeyAuth: leerer Schluessel, Partner-Schluessel und Kassen-Token werden abgewiesen, ohne den Wert zu nennen', () => {
  assert.throws(() => rechnungKeyAuth({ apiKey: '' }), KasseneckAuthError);
  for (const falsch of ['pk_live_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345', 'cb_live_ZmFsc2NoZXJUb2tlbg']) {
    assert.throws(() => rechnungKeyAuth({ apiKey: falsch }), (e: unknown) =>
      e instanceof KasseneckAuthError && !e.message.includes(falsch));
  }
});

test('rechnungKeyAuth: Altformate eines Kontoschluessels bleiben gueltig', () => {
  assert.doesNotThrow(() => rechnungKeyAuth({ apiKey: '0a1b2c3d4e5f-uid123' }));
});

// ---- Aufrufe ----------------------------------------------------------------

test('issueInvoice: POST an /v1/issueInvoice, Parameter unveraendert, Ergebnis mit replayed', async () => {
  const { fetch, anfragen } = attrappe(antwort(erfolg({ invoice: rechnung, replayed: false })));
  const api = createRechnungApi({ apiKey: API_KEY, fetch });
  const anfrage: IssueInvoiceRequest = {
    idempotencyKey: 'bestellung-4711', customerId: 'k1', taxScheme: 'normal', priceMode: 'net',
    serviceStart: '2026-09-14', items: [{ description: 'Beratung', quantity: 2, unitPriceCents: 5000, vatRate: 20 }],
  };
  const ergebnis = await api.issueInvoice(anfrage);
  assert.equal(anfragen.length, 1);
  assert.equal(anfragen[0]!.url, 'https://api.kasseneck.at/v1/issueInvoice');
  assert.equal(kopf(anfragen[0]!, 'Authorization'), `Bearer ${API_KEY}`);
  assert.deepEqual(params(anfragen[0]!), anfrage);
  assert.equal(ergebnis.invoice.number, '2026-0042');
  assert.equal(ergebnis.invoice.totals.grossCents, 12000);
  assert.equal(ergebnis.replayed, false);
});

test('issueInvoice: fehlt die zugesagte Rechnung in der Antwort, gibt es einen Antwortfehler statt eines TypeError', async () => {
  const { fetch } = attrappe(antwort(erfolg({ replayed: false })));
  const api = createRechnungApi({ apiKey: API_KEY, fetch });
  await assert.rejects(
    api.issueInvoice({ idempotencyKey: 'x', taxScheme: 'normal', priceMode: 'net', serviceStart: '2026-09-14',
      items: [{ description: 'A', quantity: 1, unitPriceCents: 1, vatRate: 20 }] }),
    (e: unknown) => e instanceof KasseneckValidationError && e.scope === 'response',
  );
});

test('getCustomer: sendet nur die gewaehlte Kennung', async () => {
  const kunde = { id: 'k1', type: 'company', name: 'Café Muster GmbH', country: 'AT', externalId: 'shop-4711' };
  const { fetch, anfragen } = attrappe(antwort(erfolg({ customer: kunde })));
  const api = createRechnungApi({ apiKey: API_KEY, fetch });
  const ergebnis = await api.getCustomer({ externalId: 'shop-4711' });
  assert.deepEqual(params(anfragen[0]!), { externalId: 'shop-4711' });
  assert.equal(ergebnis.id, 'k1');
});

test('getInvoicePdf: liefert die Bytes des PDF', async () => {
  const pdf = new TextEncoder().encode('%PDF-1.7\n…');
  const { fetch, anfragen } = attrappe(antwort(pdf, 'application/pdf'));
  const api = createRechnungApi({ apiKey: API_KEY, fetch });
  const bytes = await api.getInvoicePdf('inv1');
  assert.equal(anfragen[0]!.url, 'https://api.kasseneck.at/v1/getInvoicePdf');
  assert.deepEqual(params(anfragen[0]!), { invoiceId: 'inv1' });
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), '%PDF');
});

test('getInvoiceXml: XML kommt als Text im Umschlag, Standardformat ubl', async () => {
  const { fetch, anfragen } = attrappe(antwort(erfolg({ xml: '<Invoice/>', format: 'ubl', filename: 'rechnung-2026-0042.xml' })));
  const api = createRechnungApi({ apiKey: API_KEY, fetch });
  const xml = await api.getInvoiceXml('inv1');
  assert.deepEqual(params(anfragen[0]!), { invoiceId: 'inv1', format: 'ubl' });
  assert.equal(xml, '<Invoice/>');
});

// ---- Fehler -----------------------------------------------------------------

test('Fehlercode: am Code entscheiden, die Nutzlast bleibt lesbar', async () => {
  const { fetch } = attrappe(antwort(fehler('Gutschrift übersteigt die Rechnung.', 'credit_exceeds_invoice', { remainingCents: { total: 6000 } })));
  const api = createRechnungApi({ apiKey: API_KEY, fetch });
  try {
    await api.createCreditNote({ idempotencyKey: 'g1', invoiceId: 'inv1', reason: 'price_reduction',
      items: [{ description: 'Nachlass', quantity: 1, unitPriceCents: 6001, vatRate: 20 }] });
    assert.fail('haette werfen muessen');
  } catch (e) {
    assert.ok(e instanceof KasseneckApiError);
    assert.equal(rechnungFehlerCode(e), 'credit_exceeds_invoice');
    assert.ok(istRechnungFehler(e, 'credit_exceeds_invoice'));
    assert.ok(!istRechnungFehler(e, 'validation'));
    assert.deepEqual(e.details['remainingCents'], { total: 6000 });
  }
});

test('Feldfehler: validation liefert Feld und Meldung', async () => {
  const errors = [{ field: 'items[0].vatRate', message: 'Bei diesem Steuerschema ist der USt-Satz 0.' }];
  const { fetch } = attrappe(antwort(fehler('Bitte Eingaben prüfen.', 'validation', { errors })));
  const api = createRechnungApi({ apiKey: API_KEY, fetch });
  const e = await api.getInvoice({ invoiceId: 'inv1' }).catch((x: unknown) => x);
  assert.equal(rechnungFehlerCode(e), 'validation');
  assert.deepEqual(rechnungFeldFehler(e), errors);
});

test('Fehlercode: ein Code, den der Vertrag nicht kennt, ist kein Rechnungs-Fehlercode', async () => {
  const { fetch } = attrappe(antwort(fehler('Irgendwas.', 'rate_limited')));
  const api = createRechnungApi({ apiKey: API_KEY, fetch });
  const e = await api.listInvoices().catch((x: unknown) => x);
  assert.ok(e instanceof KasseneckApiError);
  assert.equal(rechnungFehlerCode(e), undefined);
  assert.deepEqual(rechnungFeldFehler(new Error('fremd')), []);
});

// ---- Freigabe und Einrichtung ------------------------------------------------

test('getInvoiceSetupStatus: ohne Parameter, liefert ready, Umgebung und was fehlt', async () => {
  const missing = [{ requirement: 'bank_account', message: 'IBAN fehlt.' }];
  const { fetch, anfragen } = attrappe(antwort(erfolg({ ready: false, environment: 'test', missing })));
  const api = createRechnungApi({ apiKey: API_KEY, fetch });
  const status = await api.getInvoiceSetupStatus();
  assert.equal(anfragen[0]!.url, 'https://api.kasseneck.at/v1/getInvoiceSetupStatus');
  assert.deepEqual(params(anfragen[0]!), {});
  assert.deepEqual(status, { ready: false, environment: 'test', missing });
});

test('getInvoiceSetupStatus: eine Antwort ohne ready ist ein Antwortfehler', async () => {
  const { fetch } = attrappe(antwort(erfolg({ missing: [] })));
  const api = createRechnungApi({ apiKey: API_KEY, fetch });
  await assert.rejects(api.getInvoiceSetupStatus(), (e: unknown) => e instanceof KasseneckValidationError && e.scope === 'response');
});

test('Freigabe und Einrichtung: eigene Codes, was fehlt steht in den Details', async () => {
  const missing = [{ requirement: 'api_enabled', message: 'Nicht freigegeben.' }];
  const { fetch } = attrappe(
    antwort(fehler('Die Rechnungs-API ist für dieses Konto nicht freigegeben.', 'invoice_api_not_enabled')),
    antwort(fehler('Die Einrichtung ist unvollständig.', 'invoice_setup_incomplete', { missing })),
  );
  const api = createRechnungApi({ apiKey: API_KEY, fetch });
  const anfrage = { idempotencyKey: 'k', taxScheme: 'normal' as const, priceMode: 'net' as const, serviceStart: '2026-09-15',
    items: [{ description: 'A', quantity: 1, unitPriceCents: 1, vatRate: 20 as const }] };
  const e1 = await api.issueInvoice(anfrage).catch((x: unknown) => x);
  assert.ok(istRechnungFehler(e1, 'invoice_api_not_enabled'));
  const e2 = await api.issueInvoice(anfrage).catch((x: unknown) => x);
  assert.ok(istRechnungFehler(e2, 'invoice_setup_incomplete'));
  assert.deepEqual((e2 as KasseneckApiError).details['missing'], missing);
});

// ---- Beispiele des Vertrags -------------------------------------------------

test('Beispiele: jede gueltige Anfrage geht unveraendert an ihren Aufruf', async () => {
  const ordner = new URL('../../fixtures/rechnung-api-beispiele/', import.meta.url);
  const gute = readdirSync(ordner).filter((d) => d.endsWith('.json'))
    .map((d) => JSON.parse(readFileSync(new URL(d, ordner), 'utf8')))
    .filter((b) => b.erwartet.ok === true);
  assert.ok(gute.length >= 3);
  for (const b of gute) {
    const { fetch, anfragen } = attrappe(antwort(erfolg({ invoice: rechnung, creditNote: rechnung, customer: { id: 'k1' }, replayed: false, remainingCents: 0, ready: true, environment: 'live', missing: [] })));
    const api = createRechnungApi({ apiKey: API_KEY, fetch }) as unknown as Record<string, (a: unknown) => Promise<unknown>>;
    const aufruf = api[b.aufruf];
    assert.ok(aufruf, `Client kennt ${b.aufruf} nicht`);
    await aufruf(b.aufruf === 'createCustomer' ? b.anfrage.customer : b.anfrage);
    assert.equal(anfragen[0]!.url, `https://api.kasseneck.at/v1/${b.aufruf}`);
    assert.deepEqual(params(anfragen[0]!), b.anfrage, `${b.aufruf}: Parameter veraendert`);
  }
});
