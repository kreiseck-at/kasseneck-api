import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import antworten from './fixtures/partner-v3-antworten.json' with { type: 'json' };
import { createPartnerApi, PARTNER_BASE_URL } from '../src/partner/api.js';
import { parseWebhookEvent, type ContractAcceptedEventData } from '../src/partner/webhooks.js';
import type { Betrieb } from '../src/partner/typen.js';
import { DEFAULT_BASE_URL, apiKeyAuth, createKasseneckApi } from '../src/index.js';
import { createRechnungApi } from '../src/rechnung/api.js';
import type { FetchLike, HttpRequestInit, HttpResponseLike } from '../src/client/transport.js';

/*
 * Die Partner-Seite spricht seit 0.28.0 `/v3`. Die Antworten hier sind keine
 * erfundenen Beispiele: `test/fixtures/partner-v3-antworten.json` entsteht aus
 * den echten Sichten des Backends, durch dessen `/v3`-Rand gereicht
 * (`scripts/partner-v3-antworten.cjs`). Faellt ein Test hier, liest der Client
 * etwas anderes, als der Server schickt.
 */

const A = antworten as unknown as Record<string, unknown>;
const PARTNER_KEY = 'pk_live_GEHEIMERPARTNERSCHLUESSEL42';

function antwort(rumpf: unknown): HttpResponseLike {
  const text = JSON.stringify(rumpf);
  return {
    status: 200,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
    text: async () => text,
    arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer,
  };
}

/** Ein Client, der je Endpunkt die Fixture-Antwort liefert und mitschreibt. */
function stelle(optionen: { baseUrl?: string } = {}) {
  const gesehen: { url: string; init: HttpRequestInit }[] = [];
  const fetchLike: FetchLike = async (url, init) => {
    gesehen.push({ url, init });
    const name = url.slice(url.lastIndexOf('/') + 1);
    return antwort(A[name] ?? { status: 'success', message: '', data: {} });
  };
  return { api: createPartnerApi({ partnerKey: PARTNER_KEY, fetch: fetchLike, ...optionen }), gesehen };
}

const params = (a: { init: HttpRequestInit }) => (JSON.parse(a.init.body) as { params: Record<string, unknown> }).params;

// ---------------------------------------------------------------------------
// Adresse: nur der Partner-Teil geht auf /v3
// ---------------------------------------------------------------------------

test('v3: jeder Partner-Aufruf geht an https://api.kasseneck.at/v3/<name>', async () => {
  assert.equal(PARTNER_BASE_URL, 'https://api.kasseneck.at/v3');
  const { api, gesehen } = stelle();
  await api.getPartnerCustomer('cust_1');
  await api.requestCustomerSignature('cust_1');
  await api.listPartnerWebhooks();
  await api.listPartnerWebhookDeliveries();
  assert.deepEqual(
    gesehen.map((g) => g.url),
    [
      'https://api.kasseneck.at/v3/getPartnerCustomer',
      'https://api.kasseneck.at/v3/requestCustomerSignature',
      'https://api.kasseneck.at/v3/listPartnerWebhooks',
      'https://api.kasseneck.at/v3/listPartnerWebhookDeliveries',
    ],
  );
});

test('v3: baseUrl bleibt einstellbar', async () => {
  const { api, gesehen } = stelle({ baseUrl: 'http://127.0.0.1:5001/v3/' });
  await api.getPartnerCustomer('cust_1');
  assert.equal(gesehen[0]!.url, 'http://127.0.0.1:5001/v3/getPartnerCustomer');
});

/**
 * Rot-Probe: `DEFAULT_BASE_URL` in client/transport.ts auf `/v3` stellen (statt
 * die Vorgabe nur in partner/api.ts zu setzen) — dann faellt dieser Test. Belege
 * und Rechnungen haben noch keine `/v3`; dorthin geschickt, antwortete der
 * Server mit `not_found`.
 */
test('v3: Belege und Rechnungen bleiben auf /v1', async () => {
  assert.equal(DEFAULT_BASE_URL, 'https://api.kasseneck.at/v1');
  const urls: string[] = [];
  const holen: FetchLike = async (url) => {
    urls.push(url);
    return antwort({ status: 'success', message: '', data: {} });
  };
  const kasse = createKasseneckApi({ auth: apiKeyAuth({ apiKey: 'kr_live_ABCDEFGHIJKLMNOPQRSTUVWX', cashregisterToken: 'cb_live_ABCDEFGHIJKLMNOPQRSTUVWX' }), fetch: holen });
  await kasse.zeroReceipt().catch(() => undefined);
  const rechnung = createRechnungApi({ apiKey: 'kr_live_ABCDEFGHIJKLMNOPQRSTUVWX', fetch: holen });
  await rechnung.listInvoices().catch(() => undefined);
  assert.equal(urls.length, 2);
  for (const url of urls) assert.ok(url.startsWith('https://api.kasseneck.at/v1/'), url);
});

// ---------------------------------------------------------------------------
// Betriebe
// ---------------------------------------------------------------------------

test('v3: createPartnerCustomer liest fee{cents,interval,test} statt entgelt', async () => {
  const { api } = stelle();
  const r = await api.createPartnerCustomer({ appId: 'a_1', business: {} as Betrieb });
  assert.deepEqual(r.fee, { cents: 1500, interval: 'monthly', test: false });

  // Ohne Preis in den Konditionen fuehrt die Antwort kein fee: dann null, kein
  // erfundenes 0, das wie ein kostenloser Posten aussaehe.
  const holen: FetchLike = async () => antwort({ status: 'success', message: '', data: { customerId: 'cust_2', access: {} } });
  const ohne = await createPartnerApi({ partnerKey: PARTNER_KEY, fetch: holen }).createPartnerCustomer({ appId: 'a_1', business: {} as Betrieb });
  assert.equal(ohne.fee, null);
});

test('v3: der Betrieb kommt mit englischer Rechtsform, ISO-Bundesland, englischen Rollen und avv.mode', async () => {
  const { api } = stelle();
  const k = await api.getPartnerCustomer('cust_1');
  const b = k.business as { legalForm: string; state: string; contacts: { roles: string[] }[]; taxDetails: { vatId: string } };
  assert.equal(b.legalForm, 'sole_proprietor');
  assert.equal(b.state, 'AT-9');
  assert.deepEqual(b.contacts[0]!.roles, ['management', 'pos']);
  assert.equal(b.taxDetails.vatId, 'ATU12345675');
  assert.equal(k.avv?.mode, 'power_of_attorney');

  const liste = await api.listPartnerCustomers();
  assert.equal(liste.customers[0]?.avv?.mode, 'power_of_attorney');
});

test('v3: ein Betrieb mit den Werten der /v1 ist ein Compilerfehler', () => {
  const betrieb: Betrieb = {
    companyName: 'A',
    // @ts-expect-error `einzel` gibt es unter /v3 nicht mehr (sole_proprietor)
    legalForm: 'einzel',
    email: 'a@b.at',
    address: { street: 'S', zip: '1010', city: 'Wien' },
    // @ts-expect-error `wien` gibt es unter /v3 nicht mehr (AT-9)
    state: 'wien',
    // @ts-expect-error die UID heisst auf der Leitung vatId
    taxDetails: { taxNumber: '12-345/6789', smallBusiness: false, uid: 'ATU12345675' },
    // @ts-expect-error `kasse` heisst unter /v3 `pos`
    contacts: [{ name: 'A', email: 'a@b.at', roles: ['kasse'] }],
  };
  assert.ok(betrieb);
});

// ---------------------------------------------------------------------------
// Signatur
// ---------------------------------------------------------------------------

/**
 * Rot-Probe: in endpunkte.ts `kind: optionen.kind` zurueck auf `art` stellen —
 * dann steht `kind` nicht mehr auf der Leitung, und der Server nimmt still die
 * Vorgabe, statt die gewuenschte Art zu pruefen.
 */
test('v3: requestCustomerSignature sendet kind und liest Historie und fee englisch', async () => {
  const { api, gesehen } = stelle();
  const r = await api.requestCustomerSignature('cust_1', { kind: 'signature_card', additional: true });
  assert.deepEqual(params(gesehen[0]!), { customerId: 'cust_1', kind: 'signature_card', additional: true });
  assert.equal(r.request.kind, 'signature_card');
  assert.deepEqual(
    r.request.history.map((h) => [h.from, h.to, h.reason]),
    [
      [null, 'requested', 'api'],
      ['requested', 'assigned', 'card_entered'],
      ['assigned', 'registered', 'finanzonline'],
      ['registered', 'ready', null],
    ],
  );
  assert.deepEqual(r.fee, { cents: 4900, interval: 'once', test: false });
  assert.equal(r.replayed, true);
});

test('v3: getCustomerSignatureStatus liest signature, signatures[] und requests[]', async () => {
  const { api } = stelle();
  const s = await api.getCustomerSignatureStatus('cust_1');
  assert.equal(s.customerId, 'cust_1');
  assert.deepEqual(s.signature, { ready: true, signatureId: 'sig_1', vdaId: 'AT1' });
  assert.equal(s.signatures.length, 1);
  assert.equal(s.signatures[0]?.signatureRequestId, 'req_1');
  assert.equal(s.signatures[0]?.ready, true);
  assert.equal(s.signatures[0]?.kind, 'signature_card');
  assert.equal(s.requests[0]?.history[1]?.reason, 'card_entered');
});

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

test('v3: ein Webhook zeigt apiVersion und lastDelivery als Objekt', async () => {
  const { api } = stelle();
  const neu = await api.createPartnerWebhook({ url: 'https://api.example.at/kasseneck', events: ['cashregister.live'] });
  assert.equal(neu.webhook.apiVersion, 'v3');
  assert.equal(neu.webhook.lastDelivery, null);

  const { webhooks } = await api.listPartnerWebhooks();
  assert.equal(webhooks[0]?.apiVersion, 'v1', 'Bestands-Webhook spricht v1');
  assert.deepEqual(webhooks[0]?.lastDelivery, { at: 1788052010651, status: 'dropped', statusCode: null });
  assert.equal(webhooks[1]?.apiVersion, 'v3');
  assert.deepEqual(webhooks[1]?.lastDelivery, { at: 1788052010651, status: 'delivered', statusCode: 200 });
});

test('v3: fehlt apiVersion in der Antwort, gilt v1 und nicht v3', async () => {
  const holen: FetchLike = async () => antwort({ status: 'success', message: '', data: { webhooks: [{ webhookId: 'wh_x' }], events: [] } });
  const { webhooks } = await createPartnerApi({ partnerKey: PARTNER_KEY, fetch: holen }).listPartnerWebhooks();
  assert.equal(webhooks[0]?.apiVersion, 'v1');
});

test('v3: updatePartnerWebhook stellt mit patch.apiVersion auf englische Nutzlast um', async () => {
  const { api, gesehen } = stelle();
  const w = await api.updatePartnerWebhook('wh_alt', { apiVersion: 'v3' });
  assert.deepEqual(params(gesehen[0]!), { webhookId: 'wh_alt', patch: { apiVersion: 'v3' } });
  assert.equal(w.apiVersion, 'v3');
  // Zurueck auf v1 gibt es nicht, auch nicht im Typ.
  // @ts-expect-error nur 'v3' ist moeglich
  const zurueck: Parameters<typeof api.updatePartnerWebhook>[1] = { apiVersion: 'v1' };
  assert.ok(zurueck);
});

test('v3: deletePartnerWebhook liest deleted statt geloescht', async () => {
  const { api } = stelle();
  assert.deepEqual(await api.deletePartnerWebhook('wh_1'), { webhookId: 'wh_1', deleted: true });
});

test('v3: sendPartnerWebhookTest liest event und die Zustellungen', async () => {
  const { api } = stelle();
  const t = await api.sendPartnerWebhookTest('wh_1', 'signature.ready');
  assert.equal(t.event, 'signature.ready');
  assert.deepEqual(t.deliveries, [{ deliveryId: 'dlv_1', webhookId: 'wh_1', status: 'pending', statusCode: null }]);
});

test('v3: listPartnerWebhookDeliveries liest lastAttemptAt/nextAttemptAt und den Status dropped', async () => {
  const { api } = stelle();
  const z = await api.listPartnerWebhookDeliveries({ webhookId: 'wh_1' });
  assert.equal(z[0]?.status, 'dropped');
  assert.equal(z[0]?.lastAttemptAt, 1788052010662);
  assert.equal(z[0]?.nextAttemptAt, null);
  assert.equal(z[1]?.status, 'delivered');
  assert.equal(z[1]?.lastAttemptAt, 1788052010650);
});

test('v3: customer.terms_accepted und customer.avv_accepted tragen kind und source englisch', async () => {
  const secret = 'whsec_TESTGEHEIMNIS_0123456789';
  const ereignisse = A['ereignisse'] as Record<string, ContractAcceptedEventData>;
  for (const [type, data] of Object.entries(ereignisse)) {
    const body = JSON.stringify({ id: `evt_${type}`, type, createdAt: 1, partnerId: 'ptn_1', data });
    const t = 1_756_000_000;
    const signatureHeader = `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
    const r = await parseWebhookEvent({ secret, signatureHeader, body, nowSec: t });
    assert.ok(r.ok, type);
    const nutzlast = r.event.data as unknown as ContractAcceptedEventData;
    assert.equal(nutzlast.kind, type === 'customer.terms_accepted' ? 'terms' : 'avv');
  }
  assert.equal(ereignisse['customer.terms_accepted']?.source, 'setup_link');
  assert.equal(ereignisse['customer.avv_accepted']?.source, 'partner_power_of_attorney');
});

// ---------------------------------------------------------------------------
// Die Fixtures selbst
// ---------------------------------------------------------------------------

test('v3: keine Fixture-Antwort fuehrt ein deutsches Feld oder einen deutschen Wert der /v1', () => {
  // Faellt, wenn der Generator versehentlich an /v3 vorbei (also /v1) liest.
  // Nur Schluessel und kurze Werte: Texte fuer Menschen bleiben deutsch.
  const verboten = new Set([
    'entgelt', 'rhythmus', 'geloescht', 'monat', 'jahr', 'einmal',
    'einzel', 'verein', 'sonstige', 'wien', 'salzburg', 'geschaeftsfuehrung', 'buchhaltung', 'technik', 'kasse',
    'direkt', 'vollmacht', 'unterauftrag', 'karte_eingetragen', 'fon', 'zugestellt', 'offen', 'fehlgeschlagen',
    'verworfen', 'nutzung', 'einrichten', 'prozess', 'partner_vollmacht', 'admin_papier', 'papier_upload',
  ]);
  const funde: string[] = [];
  const pruefe = (wert: unknown, pfad: string): void => {
    if (Array.isArray(wert)) return wert.forEach((w, i) => pruefe(w, `${pfad}[${i}]`));
    if (wert !== null && typeof wert === 'object') {
      for (const [k, v] of Object.entries(wert)) {
        if (k === 'fon') {
          // `fon` ist unter /v3 ein Objektname (FinanzOnline-Stand), kein Wert.
          pruefe(v, `${pfad}.${k}`);
          continue;
        }
        if (verboten.has(k)) funde.push(`${pfad}.${k}`);
        pruefe(v, `${pfad}.${k}`);
      }
      return;
    }
    if (typeof wert === 'string' && verboten.has(wert)) funde.push(`${pfad} = ${wert}`);
  };
  for (const [name, wert] of Object.entries(A)) if (!name.startsWith('_')) pruefe(wert, name);
  assert.deepEqual(funde, []);
});
