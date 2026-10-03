import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { stripeCaptureIntent, createStripeLink } from '../src/payments/stripe.js';
import { hobexPay, hobexRefund } from '../src/payments/hobex.js';
import { createTransport, type FetchLike, type HttpResponseLike } from '../src/client/transport.js';
import { apiKeyAuth } from '../src/client/auth.js';
import { createKasseneckApi } from '../src/client/api.js';
import {
  KasseneckApiError,
  KasseneckHttpError,
  KasseneckNetworkError,
  isOutcomeUnknown,
  PAYMENT_CALL_REJECTED_CODES,
  CLIENT_ERROR_CODES,
} from '../src/client/errors.js';
import { StripeLinkMode, VatRate } from '../src/enums/index.js';

/*
 * Geldwege mit unklarem Ausgang (Zwilling von kasseneck_api F10):
 * `hobexPayApi` belastet eine Karte, `hobexRefundApi` erstattet,
 * `stripeCaptureIntent` zieht eine vorgemerkte Zahlung ein. Scheitert einer,
 * nachdem die Anfrage unterwegs war (Netz, Zeitlimit, HTTP 5xx, unlesbare
 * Erfolgsantwort, HTML mit Kennzeichen), kann das Geld bewegt sein. Ein
 * `rejected` luede die App zum zweiten Versuch ein: doppelte Belastung bzw.
 * doppelte Erstattung.
 */

function antwort(
  rumpf: string,
  { kennzeichen = 'v3' as string | null, contentType = 'application/json' as string | null, status = 200 } = {},
): HttpResponseLike {
  return {
    status,
    headers: {
      get: (name: string) => {
        const n = name.toLowerCase();
        if (n === 'content-type') return contentType;
        if (n === 'kasseneck-api-version') return kennzeichen;
        return null;
      },
    },
    text: async () => rumpf,
    arrayBuffer: async () => new TextEncoder().encode(rumpf).buffer as ArrayBuffer,
  };
}

const erfolg = (daten: unknown) => antwort(JSON.stringify({ status: 'success', message: '', data: daten }));

const weg = (holen: FetchLike, timeoutMs?: number) =>
  createTransport({ auth: apiKeyAuth({ apiKey: 'kr_test_SCHLUESSEL', cashregisterToken: 'cb_test_TOKEN' }), fetch: holen, timeoutMs });

async function fehler(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  assert.fail('kein Fehler geworfen');
}

/** Die drei Geldwege, je ueber ihre Paketfunktion. */
const GELDWEGE: Array<[string, (holen: FetchLike, timeoutMs?: number) => Promise<unknown>]> = [
  ['hobexPayApi', (holen, t) => hobexPay(weg(holen, t), { transactionId: 'tx-1', amountCents: 1234 })],
  ['hobexRefundApi', (holen, t) => hobexRefund(weg(holen, t), { transactionId: 'tx-1', amountCents: 1234 })],
  ['stripeCaptureIntent', (holen, t) => stripeCaptureIntent(weg(holen, t), 'cs_test_a1b2c3')],
];

test('Geldwege: Netzfehler nach dem Senden ist outcome unknown', async () => {
  const netzWeg: FetchLike = async () => {
    throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
  };
  for (const [name, aufruf] of GELDWEGE) {
    const e = await fehler(aufruf(netzWeg));
    assert.ok(e instanceof KasseneckNetworkError, name);
    assert.equal(e.functionName, name);
    assert.equal(e.outcome, 'unknown', name);
    assert.ok(isOutcomeUnknown(e), name);
  }
});

test('Geldwege: Zeitlimit nach dem Senden (haengender Rumpf) ist outcome unknown', async () => {
  const haengt: FetchLike = async () => ({
    status: 200,
    headers: { get: (n: string) => (n.toLowerCase() === 'kasseneck-api-version' ? 'v3' : 'application/json') },
    text: () => new Promise<string>(() => {}),
    arrayBuffer: () => new Promise<ArrayBuffer>(() => {}),
  });
  for (const [name, aufruf] of GELDWEGE) {
    const e = await fehler(aufruf(haengt, 30));
    assert.ok(e instanceof KasseneckNetworkError && e.timedOut, name);
    assert.equal(e.outcome, 'unknown', name);
  }
});

test('Geldwege: HTTP 5xx ist outcome unknown, 4xx rejected (mit und ohne Kennzeichen)', async () => {
  for (const [name, aufruf] of GELDWEGE) {
    for (const kennzeichen of ['v3', null]) {
      for (const [status, erwartet] of [
        [500, 'unknown'],
        [502, 'unknown'],
        [504, 'unknown'],
        [400, 'rejected'],
        [429, 'rejected'],
      ] as const) {
        const e = await fehler(aufruf(async () => antwort('<html>x</html>', { status, kennzeichen, contentType: 'text/html' })));
        assert.ok(e instanceof KasseneckHttpError, `${name} ${status}`);
        assert.equal(e.outcome, erwartet, `${name} ${status} ${kennzeichen}`);
        assert.equal(isOutcomeUnknown(e), erwartet === 'unknown', `${name} ${status}`);
      }
    }
  }
});

test('Geldwege: HTTP 200 mit Kennzeichen, aber unlesbarem Rumpf ist outcome unknown', async () => {
  const rumpfe: [string, string][] = [
    ['', 'empty-body'],
    ['{"status":"succ', 'not-json'],
    [JSON.stringify({ data: {} }), 'missing-status'],
  ];
  for (const [name, aufruf] of GELDWEGE) {
    for (const [rumpf, grund] of rumpfe) {
      const e = await fehler(aufruf(async () => antwort(rumpf)));
      assert.ok(e instanceof KasseneckHttpError, `${name} ${JSON.stringify(rumpf)}: ${String(e)}`);
      assert.equal(e.reason, grund, name);
      assert.equal(e.outcome, 'unknown', `${name} ${JSON.stringify(rumpf)}`);
    }
  }
});

test('Geldwege: HTML mit Kennzeichen ist unlesbar mit outcome unknown, ohne Kennzeichen route_missing', async () => {
  for (const [name, aufruf] of GELDWEGE) {
    const e = await fehler(aufruf(async () => antwort('<html>umgeschrieben</html>', { contentType: 'text/html' })));
    assert.ok(e instanceof KasseneckHttpError, `${name}: ${String(e)}`);
    assert.equal(e.reason, 'not-json', name);
    assert.equal(e.outcome, 'unknown', name);

    const e2 = await fehler(aufruf(async () => antwort('<html>SPA</html>', { kennzeichen: null, contentType: 'text/html' })));
    assert.ok(e2 instanceof KasseneckApiError, name);
    assert.equal(e2.code, 'route_missing', name);
    assert.equal(e2.outcome, 'rejected', name);
  }
});

test('Geldwege: Fehlerhuelle wirft KasseneckApiError mit Code, nie false oder Lesefehler', async () => {
  for (const [name, aufruf] of GELDWEGE) {
    const huelle = { status: 'error', message: 'Karte abgelehnt', code: 'validation', data: { field: 'amount' } };
    const e = await fehler(aufruf(async () => antwort(JSON.stringify(huelle))));
    assert.ok(e instanceof KasseneckApiError, `${name}: ${String(e)}`);
    assert.equal(e.functionName, name);
    assert.equal(e.code, 'validation', name);
    assert.equal(e.serverMessage, 'Karte abgelehnt', name);
    assert.equal(e.outcome, 'rejected', name);

    // Ein Ausgang-unklar-Code des Rands bleibt unklar.
    const unklar = { status: 'error', message: 'x', code: 'response_translation_failed', data: { handled: true } };
    const e2 = await fehler(aufruf(async () => antwort(JSON.stringify(unklar))));
    assert.ok(e2 instanceof KasseneckApiError, name);
    assert.equal(e2.outcome, 'unknown', name);
  }
});

test('Geldwege ueber die Fassade: hobexRefund wirft bei Ablehnung statt false zu liefern', async () => {
  const api = createKasseneckApi({
    auth: apiKeyAuth({ apiKey: 'kr_test_SCHLUESSEL', cashregisterToken: 'cb_test_TOKEN' }),
    fetch: async () => antwort(JSON.stringify({ status: 'error', message: 'Erstattung abgelehnt', code: 'validation' })),
  });
  const e = await fehler(api.hobexRefund({ transactionId: 'tx-1', amountCents: 1234 }));
  assert.ok(e instanceof KasseneckApiError);
  assert.equal(e.code, 'validation');
  const e5 = await fehler(
    createKasseneckApi({
      auth: apiKeyAuth({ apiKey: 'kr_test_SCHLUESSEL', cashregisterToken: 'cb_test_TOKEN' }),
      fetch: async () => antwort('', { status: 503 }),
    }).hobexRefund({ transactionId: 'tx-1', amountCents: 1234 }),
  );
  assert.ok(isOutcomeUnknown(e5), 'Erstattung mit HTTP 503: kann gelaufen sein');
});

test('Geldwege: Erfolg gemeldet, Nutzlast unbrauchbar ist response_unreadable mit outcome unknown', async () => {
  const faelle: Array<[string, () => Promise<unknown>]> = [
    ['hobexPayApi', () => hobexPay(weg(async () => erfolg({})), { transactionId: 'tx-1', amountCents: 1234 })],
    ['hobexPayApi', () => hobexPay(weg(async () => erfolg(null)), { transactionId: 'tx-1', amountCents: 1234 })],
    ['stripeCaptureIntent', () => stripeCaptureIntent(weg(async () => erfolg({ id: 'pi_1' })), 'cs_test_a1b2c3')],
    ['stripeCaptureIntent', () => stripeCaptureIntent(weg(async () => erfolg(null)), 'cs_test_a1b2c3')],
  ];
  for (const [name, aufruf] of faelle) {
    const e = await fehler(aufruf());
    assert.ok(e instanceof KasseneckApiError, `${name}: ${String(e)}`);
    assert.equal(e.functionName, name);
    assert.equal(e.code, 'response_unreadable', name);
    assert.equal(e.outcome, 'unknown', name);
  }
});

test('Gegenprobe: createStripeLink bewegt kein Geld und bleibt bei 5xx und Netzfehler rejected', async () => {
  const link = (holen: FetchLike) =>
    createStripeLink(weg(holen), {
      items: [{ name: 'Semmel', quantity: 1, vat: VatRate.vat10, priceCents: 120 }],
      createReceiptAfterPayment: false,
      mode: StripeLinkMode.payment,
    });
  const e5 = await fehler(link(async () => antwort('', { status: 503 })));
  assert.ok(e5 instanceof KasseneckHttpError);
  assert.equal(e5.outcome, 'rejected');
  const en = await fehler(
    link(async () => {
      throw new Error('socket hang up');
    }),
  );
  assert.ok(en instanceof KasseneckNetworkError);
  assert.equal(en.outcome, 'rejected');
});

/*
 * Fehlerhuelle auf einem Geldweg (Zwilling von kasseneck_api 10.0.0-rc.2):
 * Die drei Handler antworten nach dem Anbieteraufruf mit Huellen OHNE Code
 * ("Error hobex details", "Fehler beim Capturing: ..."). Belastung,
 * Erstattung bzw. Einzug koennen dann schon gelaufen sein. `rejected` gilt
 * darum nur fuer Codes, die belegen, dass der Anbieter nie gerufen wurde.
 */

const fixtureV3 = (): { errorCodes: { auth: string[]; edge: string[] } } =>
  JSON.parse(readFileSync(fileURLToPath(new URL('../../fixtures/v3/v3-vokabular.json', import.meta.url)), 'utf8'));

test('Geldwege: Fehlerhuelle ohne Code ist outcome unknown (Geld kann bewegt sein)', async () => {
  for (const [name, aufruf] of GELDWEGE) {
    for (const huelle of [
      { status: 'error', message: 'Error hobex details 2' },
      { status: 'error', message: 'Fehler beim Capturing: Your card was declined.', data: null },
      { status: 'error', message: 'x', data: { field: 'amount' } },
      { status: 'error', message: 'x', code: 'Kein Bezeichner mit Leerzeichen' },
    ]) {
      const e = await fehler(aufruf(async () => antwort(JSON.stringify(huelle))));
      assert.ok(e instanceof KasseneckApiError, `${name}: ${String(e)}`);
      assert.equal(e.code, undefined, name);
      assert.equal(e.outcome, 'unknown', `${name} ${JSON.stringify(huelle)}`);
      assert.ok(isOutcomeUnknown(e), name);
    }
  }
});

test('Geldwege: nur die Ablehnungscodes sind rejected, jeder andere Code unknown', async () => {
  for (const [name, aufruf] of GELDWEGE) {
    for (const code of PAYMENT_CALL_REJECTED_CODES) {
      const e = await fehler(aufruf(async () => antwort(JSON.stringify({ status: 'error', message: 'x', code }))));
      assert.ok(e instanceof KasseneckApiError, `${name} ${code}`);
      assert.equal(e.outcome, 'rejected', `${name} ${code}`);
      // Auch unter data.code (zweiter Ablageort).
      const e2 = await fehler(aufruf(async () => antwort(JSON.stringify({ status: 'error', message: 'x', data: { code } }))));
      assert.ok(e2 instanceof KasseneckApiError, `${name} data.code ${code}`);
      assert.equal(e2.outcome, 'rejected', `${name} data.code ${code}`);
    }
    for (const [code, data] of [
      ['payment_amount_invalid', {}],
      ['rate_limited', {}],
      ['partner_locked', {}],
      ['server_error', {}],
      ['provider_declined', {}],
      ['response_translation_failed', { handled: false }],
      ['response_translation_failed', { handled: true }],
    ] as const) {
      const e = await fehler(aufruf(async () => antwort(JSON.stringify({ status: 'error', message: 'x', code, data }))));
      assert.ok(e instanceof KasseneckApiError, `${name} ${code}`);
      assert.equal(e.outcome, 'unknown', `${name} ${code} ${JSON.stringify(data)}`);
    }
  }
});

// Die sieben Codes des Partner-Zugangs; er trifft die Geldwege (api_key mit
// Kassen-Token) nie. Dieselbe Abgrenzung wie bei RECEIPT_ERROR_CODES.
const PARTNER_ZUGANG = [
  'partner_locked',
  'scope_missing',
  'rate_limited',
  'not_a_partner',
  'partner_membership_missing',
  'partner_owner_only',
  'partner_account_not_allowed',
];

test('Geldwege: Ablehnungscodes = Anmeldung ohne Partner + Rand vor dem Handler + Tore + route_missing (Vertrag v3)', () => {
  const { auth, edge } = fixtureV3().errorCodes;
  for (const c of PARTNER_ZUGANG) assert.ok(auth.includes(c), `${c} steht nicht mehr in errorCodes.auth`);
  const erwartet = new Set([
    ...auth.filter((c) => !PARTNER_ZUGANG.includes(c)),
    ...edge.filter((c) => c !== 'dialect_mismatch' && c !== 'response_translation_failed'),
    'module_inactive',
    'not_permitted',
    'route_missing',
  ]);
  assert.equal(erwartet.size, 24);
  assert.deepEqual([...PAYMENT_CALL_REJECTED_CODES].sort(), [...erwartet].sort());
  assert.ok(Object.isFrozen(PAYMENT_CALL_REJECTED_CODES));
});

test('Geldwege: Ablehnungscodes stehen im Vertrag (errorCodes.all) und gleichen paymentCallRejectedCodes im Dart-Zwilling', () => {
  const vok = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../fixtures/v3/v3-vokabular.json', import.meta.url)), 'utf8'),
  ) as { errorCodes: { all: string[] } };
  const alle = new Set(vok.errorCodes.all);
  for (const code of PAYMENT_CALL_REJECTED_CODES) {
    assert.ok(alle.has(code) || (CLIENT_ERROR_CODES as readonly string[]).includes(code), `${code} nicht im Vertrag`);
  }
  for (const code of ['dialect_mismatch', 'response_translation_failed', 'response_unreadable']) {
    assert.ok(!PAYMENT_CALL_REJECTED_CODES.includes(code), `${code} darf nie abgelehnt heissen`);
  }
  // Festgeschrieben wie in kasseneck_api (lib/src/register/fehler.dart,
  // paymentCallRejectedCodes); aendert sich eine Seite, zieht die andere mit.
  assert.deepEqual([...PAYMENT_CALL_REJECTED_CODES].sort(), [
    'account_not_found',
    'admin_required',
    'api_not_approved',
    'cashregister_not_assigned',
    'cashregister_not_found',
    'cashregister_token_invalid',
    'cashregister_token_missing',
    'internal_translation_error',
    'live_not_enabled',
    'method_not_allowed',
    'mfa_required',
    'module_inactive',
    'not_found',
    'not_permitted',
    'register_user_no_business',
    'register_user_not_allowed',
    'register_user_not_found',
    'route_missing',
    'session_expired',
    'session_other_cashregister',
    'unauthorized',
    'user_disabled',
    'user_verification_failed',
    'validation',
  ]);
});

test('Geldwege ueber die Fassade: Erstattung mit Huelle ohne Code ist outcome unknown', async () => {
  const api = createKasseneckApi({
    auth: apiKeyAuth({ apiKey: 'kr_test_SCHLUESSEL', cashregisterToken: 'cb_test_TOKEN' }),
    fetch: async () => antwort(JSON.stringify({ status: 'error', message: 'Error hobex details:' })),
  });
  const e = await fehler(api.hobexRefund({ transactionId: 'tx-1', amountCents: 1234 }));
  assert.ok(e instanceof KasseneckApiError);
  assert.ok(isOutcomeUnknown(e), 'Erstattung ohne Code: kann gelaufen sein');
});

test('Gegenprobe: createStripeLink bleibt bei Huelle ohne Code oder mit fremdem Code rejected', async () => {
  const link = (holen: FetchLike) =>
    createStripeLink(weg(holen), {
      items: [{ name: 'Semmel', quantity: 1, vat: VatRate.vat10, priceCents: 120 }],
      createReceiptAfterPayment: false,
      mode: StripeLinkMode.payment,
    });
  for (const huelle of [
    { status: 'error', message: 'Fehler bei Stripe-Session: x' },
    { status: 'error', message: 'x', code: 'payment_amount_invalid' },
  ]) {
    const e = await fehler(link(async () => antwort(JSON.stringify(huelle))));
    assert.ok(e instanceof KasseneckApiError);
    assert.equal(e.outcome, 'rejected', JSON.stringify(huelle));
  }
});
