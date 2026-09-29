import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTransport, type FetchLike } from '../src/client/transport.js';
import { apiKeyAuth } from '../src/client/auth.js';
import { ALL_CALLS } from '../src/client/aufrufe.js';
import { KasseneckNetworkError } from '../src/client/errors.js';
import { CALLS_WITH_EFFECT, ERROR_RULES, findErrorRule, messageOutcome, messageText } from '../src/pos/texte.js';

/*
 * Frist und Netzfehler am echten Transport: welcher Satz kommt auf den
 * Kassenschirm? Auf einem Aufruf mit Wirkung raet er nie zum Wiederholen
 * (der Vorgang kann gebucht sein); auf allen anderen bleibt der Satz von rc.4.
 */
const RAET_ZUM_WIEDERHOLEN = /erneut|nochmal|noch einmal|wiederhol|neu senden/i;
const schluessel = () => apiKeyAuth({ apiKey: 'kr_test_SCHLUESSEL', cashregisterToken: 'cb_test_TOKEN' });

async function fehlerBei(call: string, holen: FetchLike, timeoutMs?: number): Promise<unknown> {
  try {
    await createTransport({ auth: schluessel(), fetch: holen, ...(timeoutMs ? { timeoutMs } : {}) })(call, {});
  } catch (e) {
    return e;
  }
  return assert.fail(`${call}: kein Fehler`);
}

const netzWeg: FetchLike = async () => { throw new TypeError('fetch failed'); };
const antwortetNie: FetchLike = (_url, init) => new Promise((_, ablehnen) => {
  init.signal?.addEventListener('abort', () => ablehnen(new Error('abgebrochen')));
});

function satz(e: unknown): string {
  assert.ok(e instanceof KasseneckNetworkError, String(e));
  const regel = findErrorRule(e.timedOut ? 'timeout' : 'network', { outcome: messageOutcome(e) });
  assert.ok('key' in regel);
  return messageText(regel.key);
}

test('CALLS_WITH_EFFECT sind echte Aufrufe und enthalten jeden, dessen Ausgang der Transport als unklar fuehrt', async () => {
  const alle = new Set<string>(ALL_CALLS);
  for (const c of CALLS_WITH_EFFECT) assert.ok(alle.has(c), c);
  // Druckjob und Belegmail fuehrt der Transport als abgelehnt; ihr zweiter Versuch druckt bzw. mailt doppelt.
  for (const c of ['createPrintJob', 'sendReceiptEmail']) assert.ok((CALLS_WITH_EFFECT as readonly string[]).includes(c), c);
  for (const call of ALL_CALLS) {
    const e = await fehlerBei(call, netzWeg);
    assert.ok(e instanceof KasseneckNetworkError, `${call}: ${String(e)}`);
    if (e.outcome === 'unknown') assert.ok((CALLS_WITH_EFFECT as readonly string[]).includes(call), `${call} ist unklar, fehlt in CALLS_WITH_EFFECT`);
  }
});

test('Netzfehler: auf einem Aufruf mit Wirkung nie „erneut versuchen“, sonst der Satz von rc.4', async () => {
  const rc4 = ERROR_RULES.find((r) => r.kind === 'network');
  assert.ok(rc4 && 'key' in rc4);
  for (const call of ALL_CALLS) {
    const e = await fehlerBei(call, netzWeg);
    if ((CALLS_WITH_EFFECT as readonly string[]).includes(call)) {
      assert.equal(messageOutcome(e), 'unknown', call);
      assert.doesNotMatch(satz(e), RAET_ZUM_WIEDERHOLEN, call);
    } else {
      assert.equal(satz(e), messageText(rc4.key), call);
    }
  }
});

test('Frist: auf einem Aufruf mit Wirkung nie „erneut versuchen“, sonst der Satz von rc.4', async () => {
  const rc4 = ERROR_RULES.find((r) => r.kind === 'timeout');
  assert.ok(rc4 && 'key' in rc4);
  for (const call of ['createReceipt', 'createPrintJob', 'sendReceiptEmail', 'hobexPayApi', 'listMyArticles', 'getReceipt']) {
    const e = await fehlerBei(call, antwortetNie, 5);
    assert.ok(e instanceof KasseneckNetworkError && e.timedOut, call);
    if ((CALLS_WITH_EFFECT as readonly string[]).includes(call)) assert.doesNotMatch(satz(e), RAET_ZUM_WIEDERHOLEN, call);
    else assert.equal(satz(e), messageText(rc4.key), call);
  }
});

test('messageOutcome: fremde Fehler haben keinen Ausgang', () => {
  assert.equal(messageOutcome(new Error('x')), undefined);
  assert.equal(messageOutcome(null), undefined);
});
