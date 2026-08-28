import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createHpsConnectClient,
  type HpsConnectFetch,
  type HpsConnectFetchResponse,
} from '../src/payments/hobex-hps/connect-client.js';
import { createHpsPayments } from '../src/payments/hobex-hps/payments.js';
import { mayRetrySafely } from '../src/payments/hobex-hps/outcome.js';
import {
  HpsConnectTerminalError,
  HpsConnectTransportError,
  HpsPreflightError,
  HpsTransactionIdError,
} from '../src/payments/hobex-hps/errors.js';
import {
  createHpsTransactionIdGenerator,
  isValidHpsTransactionId,
} from '../src/payments/hobex-hps/transaction-id.js';
import {
  isApproved,
  isCanceled,
  isConclusive,
  isNoStatement,
  isNotAbortable,
  isTechnicalError,
  isUnknownCode,
  parseHpsTransactionResponse,
} from '../src/payments/hobex-hps/transaction-response.js';

/**
 * Verhaltenstests des HPS-Zahlwegs ueber Kasseneck Connect.
 *
 * Die Attrappe unten spielt einen ECHTEN Fake-Server: sie antwortet mit
 * derselben JSON-Huelle wie Kasseneck Connect (`{ok:true, hps:{...}}` /
 * `{ok:false, error:{code, message}}`, siehe
 * `kasseneck-connect/lib/src/api/responses.dart` und `routes_terminal.dart`)
 * -- kein Mock der eigenen Client-Klasse. Damit laufen `connect-client.ts`s
 * eigene Auswertung UND `payments.ts`s Klaerlogik in jedem Test wirklich mit.
 */

const TARGET = { host: '192.168.1.50', tid: '3600335' };
const TOKEN = 'kc_test_TOKEN';

interface ScriptedResponse {
  status: number;
  body: unknown;
}
type ScriptEntry = ScriptedResponse | 'network-error';
type ScriptPath =
  | '/v1/terminal/payment'
  | '/v1/terminal/status'
  | '/v1/terminal/abort'
  | '/v1/terminal/refund'
  | '/v1/terminal/cancel';
type Script = Partial<Record<ScriptPath, ScriptEntry[]>>;

interface RecordedCall {
  path: string;
  body: Record<string, unknown>;
}

function fakeConnect(script: Script, calls: RecordedCall[]): HpsConnectFetch {
  const counters = new Map<string, number>();
  return async (url, init) => {
    const path = new URL(url).pathname;
    const body = JSON.parse(init.body) as Record<string, unknown>;
    calls.push({ path, body });
    assert.equal(init.headers['Authorization'], `Bearer ${TOKEN}`, 'Kopplungstoken fehlt oder ist falsch');

    const queue = script[path as keyof Script];
    if (!queue || queue.length === 0) {
      throw new Error(`Testfehler: kein Skript fuer ${path}`);
    }
    const i = counters.get(path) ?? 0;
    counters.set(path, i + 1);
    const entry = queue[Math.min(i, queue.length - 1)]!;
    if (entry === 'network-error') {
      throw new Error('simulierter Netzfehler (Connect nicht erreichbar)');
    }
    const response: HpsConnectFetchResponse = {
      status: entry.status,
      text: async () => JSON.stringify(entry.body),
    };
    return response;
  };
}

function okPayment(hps: Record<string, unknown>): ScriptedResponse {
  return { status: 200, body: { ok: true, hps } };
}
function failConnect(
  code: string,
  message: string,
  options: { status?: number; terminalHttpStatus?: number } = {},
): ScriptedResponse {
  return {
    status: options.status ?? 200,
    body: {
      ok: false,
      error: {
        code,
        message,
        // Wie Kasseneck Connect es seit Commit 0fb6f66 mitgibt: NUR gesetzt,
        // wenn das Terminal selbst einen Status genannt hat.
        ...(options.terminalHttpStatus === undefined ? {} : { detail: { terminalHttpStatus: options.terminalHttpStatus } }),
      },
    },
  };
}

/** Deterministische Uhr: schreitet nur durch explizites `sleep` voran. */
function fakeClock(startMs = 0) {
  let value = startMs;
  return {
    now: () => value,
    sleep: async (ms: number) => {
      value += ms;
    },
  };
}

function buildPayments(
  script: Script,
  calls: RecordedCall[],
  overrides: { resolveBudgetMs?: number; maxBackoffMs?: number; maxTransportFailures?: number } = {},
) {
  const client = createHpsConnectClient({ baseUrl: 'http://127.0.0.1:27182', token: TOKEN, fetch: fakeConnect(script, calls) });
  const clock = fakeClock();
  const payments = createHpsPayments(client, TARGET, {
    resolveBudgetMs: overrides.resolveBudgetMs ?? 90_000,
    maxBackoffMs: overrides.maxBackoffMs ?? 10_000,
    maxTransportFailures: overrides.maxTransportFailures ?? 3,
    now: clock.now,
    sleep: clock.sleep,
  });
  return payments;
}

// ---------------------------------------------------------------------------
// Direkte Antwort entscheidet
// ---------------------------------------------------------------------------

test('genehmigt direkt -- keine Klaerung noetig', async () => {
  const calls: RecordedCall[] = [];
  const payments = buildPayments(
    { '/v1/terminal/payment': [okPayment({ responseCode: '0', transactionId: '111', approvalCode: '654321' })] },
    calls,
  );
  const result = await payments.pay({ amountCents: 1500, transactionId: '111' });
  assert.equal(result.outcome, 'approved');
  assert.equal(result.transactionId, '111');
  assert.equal(calls.length, 1, 'es haette nur der Zahlungs-Request rausgehen duerfen');
});

test('abgelehnt direkt -- ein gemessener Code, der nicht 0 ist, entscheidet sofort', async () => {
  const calls: RecordedCall[] = [];
  const payments = buildPayments(
    { '/v1/terminal/payment': [okPayment({ responseCode: '100003', transactionId: '112' })] },
    calls,
  );
  const result = await payments.pay({ amountCents: 500, transactionId: '112' });
  assert.equal(result.outcome, 'declined');
  assert.equal(calls.length, 1);
});

// ---------------------------------------------------------------------------
// Der gemessene Klaerweg: Abbruch vor Polling
// ---------------------------------------------------------------------------

test('Antwort bleibt aus, Abbruch gelingt (responseCode 0) -- declined, beweisbar, ohne Polling', async () => {
  const calls: RecordedCall[] = [];
  const payments = buildPayments(
    {
      '/v1/terminal/payment': ['network-error'],
      '/v1/terminal/abort': [okPayment({ responseCode: '0', transactionId: '113' })],
    },
    calls,
  );
  const result = await payments.pay({ amountCents: 1000, transactionId: '113' });
  assert.equal(result.outcome, 'declined');
  assert.equal(calls.filter((c) => c.path === '/v1/terminal/status').length, 0, 'ein gelungener Abbruch braucht kein Polling');
});

test('Antwort bleibt aus, Abbruch scheitert (100010 nicht abbrechbar) -- Polling entscheidet: genehmigt', async () => {
  const calls: RecordedCall[] = [];
  const payments = buildPayments(
    {
      '/v1/terminal/payment': ['network-error'],
      '/v1/terminal/abort': [okPayment({ responseCode: '100010', transactionId: '114' })],
      '/v1/terminal/status': [okPayment({ responseCode: '0', transactionId: '114' })],
    },
    calls,
  );
  const result = await payments.pay({ amountCents: 1000, transactionId: '114' });
  assert.equal(result.outcome, 'approved');
  assert.equal(calls.filter((c) => c.path === '/v1/terminal/status').length, 1);
});

test('Abbruch scheitert am Transport -- gepollt wird trotzdem', async () => {
  const calls: RecordedCall[] = [];
  const payments = buildPayments(
    {
      '/v1/terminal/payment': ['network-error'],
      '/v1/terminal/abort': ['network-error'],
      '/v1/terminal/status': [okPayment({ responseCode: '0', transactionId: '115' })],
    },
    calls,
  );
  const result = await payments.pay({ amountCents: 1000, transactionId: '115' });
  assert.equal(result.outcome, 'approved');
});

// ---------------------------------------------------------------------------
// Mutationsprobe 1: "9027 als 'nichts belastet' lesen"
//
// Wuerde `fromResponse`/`isConclusive` 9027 als Ablehnung lesen, meldete
// dieser Test 'declined' statt 'unresolved' -- und genau das war der Fehler
// vom 24.08.2026.
// ---------------------------------------------------------------------------

test('9027 ist KEINE Aussage -- dauerhaftes 9027 endet bei unresolved, niemals bei declined', async () => {
  const calls: RecordedCall[] = [];
  const payments = buildPayments(
    {
      '/v1/terminal/payment': ['network-error'],
      '/v1/terminal/abort': [okPayment({ responseCode: '100010', transactionId: '116' })],
      '/v1/terminal/status': [okPayment({ responseCode: '9027', transactionId: '116' })],
    },
    calls,
    { resolveBudgetMs: 5000, maxBackoffMs: 2000 },
  );
  const result = await payments.pay({ amountCents: 1000, transactionId: '116' });
  assert.equal(result.outcome, 'unresolved');
  assert.notEqual(result.outcome, 'declined');
  assert.equal(result.transactionId, '116', 'die Kennung muss auch bei unresolved gesetzt sein');
  assert.ok(calls.filter((c) => c.path === '/v1/terminal/status').length >= 2, 'es sollte mehrfach gepollt worden sein');
});

// ---------------------------------------------------------------------------
// Mutationsprobe 2: "einen unbekannten Code als Aussage behandeln"
//
// Ein Code, den dieses Paket nie gemessen hat, darf NIE zu approved/declined
// fuehren -- egal ob er direkt oder beim Pollen auftaucht.
// ---------------------------------------------------------------------------

test('ein unbekannter Code ist eine Wissensluecke, keine Aussage -- endet bei unresolved', async () => {
  const calls: RecordedCall[] = [];
  const payments = buildPayments(
    {
      '/v1/terminal/payment': [okPayment({ responseCode: '424242', transactionId: '117' })],
      '/v1/terminal/abort': [okPayment({ responseCode: '100010', transactionId: '117' })],
      '/v1/terminal/status': [okPayment({ responseCode: '424242', transactionId: '117' })],
    },
    calls,
    { resolveBudgetMs: 3000, maxBackoffMs: 1000 },
  );
  const result = await payments.pay({ amountCents: 1000, transactionId: '117' });
  assert.equal(result.outcome, 'unresolved');
});

// ---------------------------------------------------------------------------
// HTTP 409 "Terminal beschaeftigt" -- nur bei der ERZEUGENDEN Anfrage eine Aussage
// ---------------------------------------------------------------------------

test('HTTP 409 auf die Zahlung selbst (error.detail.terminalHttpStatus) -- declined, sofort, ohne Abbruch oder Polling', async () => {
  const calls: RecordedCall[] = [];
  const payments = buildPayments(
    {
      '/v1/terminal/payment': [
        failConnect('terminal_error', 'Terminal meldet (HTTP 409): Terminal is busy', { terminalHttpStatus: 409 }),
      ],
    },
    calls,
  );
  const result = await payments.pay({ amountCents: 1000, transactionId: '118' });
  assert.equal(result.outcome, 'declined');
  assert.equal(calls.length, 1, 'ein 409 auf die Zahlung selbst braucht weder Abbruch noch Statusabfrage');
});

test('Rueckfall: 409 aus dem Meldungstext, wenn eine aeltere Connect-Fassung kein detail.terminalHttpStatus sendet', async () => {
  const calls: RecordedCall[] = [];
  const payments = buildPayments(
    // Kein `terminalHttpStatus` im Skript -- so antwortete Connect vor Commit
    // 0fb6f66. Der Textabgleich ist die einzige Absicherung fuer eine
    // Installation im Feld, die noch nicht aktualisiert hat.
    { '/v1/terminal/payment': [failConnect('terminal_error', 'Terminal meldet (HTTP 409): Terminal is busy')] },
    calls,
  );
  const result = await payments.pay({ amountCents: 1000, transactionId: '1182' });
  assert.equal(result.outcome, 'declined');
});

test('das Feld gewinnt gegen einen abweichenden Meldungstext', async () => {
  const calls: RecordedCall[] = [];
  const payments = buildPayments(
    {
      '/v1/terminal/payment': [
        // Text nennt gar keinen HTTP-Status -- nur das Feld sagt "409". Wird
        // trotzdem als "Terminal beschaeftigt" erkannt, wenn das Feld gewinnt.
        failConnect('terminal_error', 'Terminal meldet einen Fehler.', { terminalHttpStatus: 409 }),
      ],
    },
    calls,
  );
  const result = await payments.pay({ amountCents: 1000, transactionId: '1183' });
  assert.equal(result.outcome, 'declined');
  assert.equal(calls.length, 1, 'wird das Feld gelesen, braucht es weder Abbruch noch Statusabfrage');
});

test('das Feld gewinnt auch in die andere Richtung: Text sagt 409, das Feld sagt etwas anderes -- keine Aussage', async () => {
  const calls: RecordedCall[] = [];
  const payments = buildPayments(
    {
      '/v1/terminal/payment': ['network-error'],
      // Text enthaelt "(HTTP 409)", das Feld nennt aber 503 -- das Feld
      // gewinnt, also KEIN "Terminal beschaeftigt".
      '/v1/terminal/abort': [
        failConnect('terminal_error', 'Terminal meldet (HTTP 409): Terminal is busy', { terminalHttpStatus: 503 }),
      ],
      '/v1/terminal/status': [okPayment({ responseCode: '0', transactionId: '1184' })],
    },
    calls,
  );
  const result = await payments.pay({ amountCents: 1000, transactionId: '1184' });
  assert.equal(result.outcome, 'approved');
});

test('HTTP 409 beim ABBRUCH ist NICHT dieselbe Aussage -- die Klaerung geht weiter', async () => {
  const calls: RecordedCall[] = [];
  const payments = buildPayments(
    {
      '/v1/terminal/payment': ['network-error'],
      '/v1/terminal/abort': [
        failConnect('terminal_error', 'Terminal meldet (HTTP 409): Terminal is busy', { terminalHttpStatus: 409 }),
      ],
      '/v1/terminal/status': [okPayment({ responseCode: '0', transactionId: '119' })],
    },
    calls,
  );
  const result = await payments.pay({ amountCents: 1000, transactionId: '119' });
  // Waere 409 auch beim Abbruch ein "declined", stuende hier faelschlich
  // "nichts belastet" -- obwohl der Kartenfluss lief und genehmigt wurde.
  assert.equal(result.outcome, 'approved');
});

// ---------------------------------------------------------------------------
// Preflight: Connect lehnt VOR jedem Terminal-Kontakt ab -- wirft, statt zu klaeren
// ---------------------------------------------------------------------------

test('bad_request von Connect wirft sofort (HpsPreflightError) -- kein Klaerlauf', async () => {
  const calls: RecordedCall[] = [];
  const payments = buildPayments(
    { '/v1/terminal/payment': [failConnect('bad_request', 'Es fehlt die Terminal-ID (tid).')] },
    calls,
  );
  await assert.rejects(
    () => payments.pay({ amountCents: 1000, transactionId: '120' }),
    (e: unknown) => e instanceof HpsPreflightError,
  );
  assert.equal(calls.length, 1, 'nur der abgelehnte Versuch selbst, keine Klaerung');
});

test('unbrauchbare Transaktionskennung wirft LOKAL -- es geht gar keine Anfrage raus', async () => {
  const calls: RecordedCall[] = [];
  const payments = buildPayments({}, calls);
  await assert.rejects(
    () => payments.pay({ amountCents: 1000, transactionId: 'TX-1' }),
    (e: unknown) => e instanceof HpsTransactionIdError,
  );
  assert.equal(calls.length, 0, 'die Kennungspruefung muss VOR jedem Netzweg greifen');
});

// ---------------------------------------------------------------------------
// Mutationsprobe 3: "die Ziffernpruefung entfernen"
//
// Diese Tests werden rot, wenn `isValidHpsTransactionId` (oder ihr Aufruf in
// connect-client.ts) verschwindet oder verwaessert wird -- genau der Fehler,
// der am 27.08.2026 im Dart-Zwilling gemessen wurde: eine Kennung mit
// Buchstaben wird angenommen, die Karte verarbeitet, der Vorgang ist danach
// dauerhaft unauffindbar.
// ---------------------------------------------------------------------------

test('isValidHpsTransactionId: Grenzen der Kennung', () => {
  assert.equal(isValidHpsTransactionId('1'), true);
  assert.equal(isValidHpsTransactionId('1'.repeat(18)), true, '18 Ziffern sind erlaubt');
  assert.equal(isValidHpsTransactionId('1'.repeat(19)), false, '19 Ziffern ueberschreiten die HPS-Grenze');
  assert.equal(isValidHpsTransactionId(''), false);
  assert.equal(isValidHpsTransactionId('A1787860907'), false, 'Buchstaben sind gemessen dauerhaft unauffindbar (9900)');
  assert.equal(isValidHpsTransactionId('12 34'), false);
  assert.equal(isValidHpsTransactionId('12.34'), false);
});

// ---------------------------------------------------------------------------
// Kennungserzeugung
// ---------------------------------------------------------------------------

test('newHpsTransactionId: 18 Ziffern, rein numerisch, keine fuehrende Null', () => {
  const gen = createHpsTransactionIdGenerator({ now: () => 1_798_000_000_000 });
  const id = gen();
  assert.equal(id.length, 18);
  assert.match(id, /^[1-9]\d{17}$/);
});

test('newHpsTransactionId: dieselbe Millisekunde erzeugt unterschiedliche Kennungen ueber den Zaehler', () => {
  const gen = createHpsTransactionIdGenerator({ now: () => 1_798_000_000_000 });
  const a = gen();
  const b = gen();
  assert.notEqual(a, b);
  assert.equal(a.slice(0, 13), b.slice(0, 13), 'derselbe Zeitanteil');
  assert.equal(Number(b.slice(13)), Number(a.slice(13)) + 1, 'der Zaehler steigt um genau eins');
});

test('newHpsTransactionId: eine rueckwaerts springende Uhr laesst die Kennung nicht rueckwaerts laufen', () => {
  let t = 1_798_000_000_500;
  const gen = createHpsTransactionIdGenerator({ now: () => t });
  const a = gen();
  t = 1_798_000_000_000; // Uhr springt zurueck (NTP-Korrektur)
  const b = gen();
  assert.ok(BigInt(b) > BigInt(a), 'die Kennung darf nie kleiner werden als die vorherige');
});

// ---------------------------------------------------------------------------
// Transportfehler zu Connect selbst -- nie eine Aussage
// ---------------------------------------------------------------------------

test('Connect selbst nicht erreichbar -- HpsConnectTransportError, nie ein Ausgang', async () => {
  const client = createHpsConnectClient({
    token: TOKEN,
    fetch: async () => {
      throw new Error('ECONNREFUSED');
    },
  });
  await assert.rejects(
    () => client.status({ ...TARGET, transactionId: '1' }),
    (e: unknown) => e instanceof HpsConnectTransportError,
  );
});

test('Antwort von Connect ist kein JSON -- HpsConnectTransportError', async () => {
  const client = createHpsConnectClient({
    token: TOKEN,
    fetch: async () => ({ status: 200, text: async () => '<html>nicht Connect</html>' }),
  });
  await assert.rejects(
    () => client.status({ ...TARGET, transactionId: '1' }),
    (e: unknown) => e instanceof HpsConnectTransportError,
  );
});

test('Antwort ohne "ok"-Feld -- HpsConnectTransportError', async () => {
  const client = createHpsConnectClient({
    token: TOKEN,
    fetch: async () => ({ status: 200, text: async () => JSON.stringify({ irgendwas: true }) }),
  });
  await assert.rejects(
    () => client.status({ ...TARGET, transactionId: '1' }),
    (e: unknown) => e instanceof HpsConnectTransportError,
  );
});

test('HTTP 401 (kein/falscher Token) -- HpsPreflightError mit connectCode "unauthorized"', async () => {
  const client = createHpsConnectClient({
    token: 'falsch',
    fetch: async () => ({
      status: 401,
      text: async () => JSON.stringify({ ok: false, error: { code: 'unauthorized', message: 'Kasse ist nicht gekoppelt.' } }),
    }),
  });
  await assert.rejects(
    () => client.status({ ...TARGET, transactionId: '1' }),
    (e: unknown) => e instanceof HpsPreflightError && e.connectCode === 'unauthorized',
  );
});

// ---------------------------------------------------------------------------
// isTerminalBusy -- die Erkennung ist an den EXAKTEN Connect-Text gekoppelt
// ---------------------------------------------------------------------------

test('isTerminalBusy: das strukturierte Feld entscheidet, wenn es da ist', () => {
  assert.equal(
    new HpsConnectTerminalError('terminal_error', 'Terminal meldet (HTTP 409): Terminal is busy', 409).isTerminalBusy,
    true,
  );
  assert.equal(
    new HpsConnectTerminalError('terminal_error', 'Terminal meldet (HTTP 400): Missing amount', 400).isTerminalBusy,
    false,
    'ein anderer HTTP-Status darf NICHT als "beschaeftigt" gelesen werden',
  );
  // Das Feld gewinnt gegen einen Text, der das Gegenteil nahelegt -- in
  // beide Richtungen.
  assert.equal(
    new HpsConnectTerminalError('terminal_error', 'Terminal meldet einen Fehler.', 409).isTerminalBusy,
    true,
    'das Feld allein muss reichen, auch ohne "(HTTP 409)" im Text',
  );
  assert.equal(
    new HpsConnectTerminalError('terminal_error', 'Terminal meldet (HTTP 409): Terminal is busy', 503).isTerminalBusy,
    false,
    'ein widersprechendes Feld muss den Text schlagen, nicht umgekehrt',
  );
});

test('isTerminalBusy: Rueckfall auf den Meldungstext, wenn terminalHttpStatus fehlt (aeltere Connect-Fassung)', () => {
  assert.equal(
    new HpsConnectTerminalError('terminal_error', 'Terminal meldet (HTTP 409): Terminal is busy').isTerminalBusy,
    true,
  );
  assert.equal(
    new HpsConnectTerminalError('terminal_error', 'Terminal meldet (HTTP 400): Missing amount').isTerminalBusy,
    false,
    'ein anderer HTTP-Status darf NICHT als "beschaeftigt" gelesen werden',
  );
  assert.equal(
    new HpsConnectTerminalError('timeout', 'Das Terminal hat nicht rechtzeitig geantwortet.').isTerminalBusy,
    false,
  );
});

// ---------------------------------------------------------------------------
// Codetabelle: reine Unit-Grenzen
// ---------------------------------------------------------------------------

test('Codetabelle: Grenzfaelle der Positivliste', () => {
  assert.equal(isConclusive({ responseCode: '0' }), true);
  assert.equal(isApproved({ responseCode: '0' }), true);
  assert.equal(isConclusive({ responseCode: '9027' }), false);
  assert.equal(isNoStatement({ responseCode: '9027' }), true);
  assert.equal(isConclusive({ responseCode: '9900' }), false);
  assert.equal(isTechnicalError({ responseCode: '9900' }), true);
  assert.equal(isConclusive({ responseCode: '424242' }), false);
  assert.equal(isUnknownCode({ responseCode: '424242' }), true);
  assert.equal(isUnknownCode({ responseCode: '9027' }), false, '9027 ist eine benannte Wissensluecke, keine unbekannte');
  assert.equal(isNotAbortable({ responseCode: '100010' }), true);
  assert.equal(isConclusive({ responseCode: undefined }), false);
});

test('ein leerer responseCode aus dem Rumpf wird zu undefined normalisiert, nicht als Ablehnung gelesen', () => {
  const res = parseHpsTransactionResponse({ responseCode: '', transactionId: '1' });
  assert.equal(res.responseCode, undefined);
  assert.equal(isConclusive(res), false);
});

// ---------------------------------------------------------------------------
// Gutschrift (refund) -- EXAKT derselbe Klaerweg wie pay(), Abbruch eingeschlossen
// ---------------------------------------------------------------------------

test('Gutschrift genehmigt direkt -- keine Klaerung noetig', async () => {
  const calls: RecordedCall[] = [];
  const payments = buildPayments(
    { '/v1/terminal/refund': [okPayment({ responseCode: '0', transactionId: '200' })] },
    calls,
  );
  const result = await payments.refund({ amountCents: 500, originalTransactionId: '199', transactionId: '200' });
  assert.equal(result.outcome, 'approved');
  assert.equal(result.transactionId, '200');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.body['originalTransactionId'], '199');
});

test('Gutschrift auf unbekannte Original-Kennung -- 9002 ist ein gemessener, schluessiger Ablehnungscode', async () => {
  const calls: RecordedCall[] = [];
  const payments = buildPayments(
    { '/v1/terminal/refund': [okPayment({ responseCode: '9002', transactionId: '201' })] },
    calls,
  );
  const result = await payments.refund({ amountCents: 500, originalTransactionId: '9999999999', transactionId: '201' });
  assert.equal(result.outcome, 'declined');
});

test('Gutschrift: Antwort bleibt aus, Abbruch gelingt (responseCode 0) -- declined, ohne Polling', async () => {
  const calls: RecordedCall[] = [];
  const payments = buildPayments(
    {
      '/v1/terminal/refund': ['network-error'],
      '/v1/terminal/abort': [okPayment({ responseCode: '0', transactionId: '202' })],
    },
    calls,
  );
  const result = await payments.refund({ amountCents: 500, originalTransactionId: '199', transactionId: '202' });
  assert.equal(result.outcome, 'declined');
  assert.equal(calls.filter((c) => c.path === '/v1/terminal/status').length, 0);
});

test('Gutschrift: Antwort bleibt aus, Abbruch scheitert (100010) -- Polling entscheidet: genehmigt (100002 waere abgebrochen)', async () => {
  const calls: RecordedCall[] = [];
  const payments = buildPayments(
    {
      '/v1/terminal/refund': ['network-error'],
      '/v1/terminal/abort': [okPayment({ responseCode: '100010', transactionId: '203' })],
      '/v1/terminal/status': [okPayment({ responseCode: '0', transactionId: '203' })],
    },
    calls,
  );
  const result = await payments.refund({ amountCents: 500, originalTransactionId: '199', transactionId: '203' });
  assert.equal(result.outcome, 'approved');
});

test('Gutschrift: unbrauchbare originalTransactionId wirft LOKAL -- keine Anfrage geht raus', async () => {
  const calls: RecordedCall[] = [];
  const payments = buildPayments({}, calls);
  await assert.rejects(
    () => payments.refund({ amountCents: 500, originalTransactionId: 'TX-1', transactionId: '204' }),
    (e: unknown) => e instanceof HpsTransactionIdError,
  );
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------------------
// Aufhebung (cancel) -- eigener Klaerweg: kein Abbruch, '0' bedeutet dort das
// GEGENTEIL von "genehmigt", 9011 auf dem direkten Weg entscheidet nichts.
// ---------------------------------------------------------------------------

test('Aufhebung direkt bestaetigt (responseCode 0 der Aufhebung selbst) -- approved, ohne Statusabfrage', async () => {
  const calls: RecordedCall[] = [];
  const payments = buildPayments(
    { '/v1/terminal/cancel': [okPayment({ responseCode: '0', transactionId: '210' })] },
    calls,
  );
  const result = await payments.cancel({ amountCents: 1000, transactionId: '210' });
  assert.equal(result.outcome, 'approved');
  assert.equal(calls.length, 1, 'eine direkt bestaetigte Aufhebung braucht keine Statusabfrage');
});

test('Aufhebung auf unbekannte Kennung -- 9002 ist eine direkte, schluessige Ablehnung', async () => {
  const calls: RecordedCall[] = [];
  const payments = buildPayments(
    { '/v1/terminal/cancel': [okPayment({ responseCode: '9002', transactionId: '211' })] },
    calls,
  );
  const result = await payments.cancel({ amountCents: 1000, transactionId: '211' });
  assert.equal(result.outcome, 'declined');
});

test(
  'Aufhebung: 9011 auf dem DIREKTEN Weg entscheidet NICHTS -- die Klaerung fragt den Zustand der ' +
    'Originalzahlung ab, statt 9011 als "hat nicht gegriffen" zu lesen',
  async () => {
    const calls: RecordedCall[] = [];
    const payments = buildPayments(
      {
        '/v1/terminal/cancel': [okPayment({ responseCode: '9011', transactionId: '212' })],
        '/v1/terminal/status': [okPayment({ responseCode: '9011', transactionId: '212' })],
      },
      calls,
      { resolveBudgetMs: 5000, maxBackoffMs: 1000 },
    );
    const result = await payments.cancel({ amountCents: 1000, transactionId: '212' });
    assert.equal(result.outcome, 'approved', '9011 auf die Originalkennung heisst: die Aufhebung hat gewirkt');
    assert.equal(calls.filter((c) => c.path === '/v1/terminal/status').length, 1);
  },
);

test('Aufhebung: Klaerung nutzt NIEMALS einen Abbruch -- die Originalzahlung ist laengst abgeschlossen', async () => {
  const calls: RecordedCall[] = [];
  const payments = buildPayments(
    {
      '/v1/terminal/cancel': ['network-error'],
      // Ein Abbruch waere hier scharf geladen: wuerde die Klaerung ihn
      // dennoch versuchen, antwortete er mit '0' und der Test bestaetigte
      // faelschlich "declined", OHNE dass ueberhaupt die Statusabfrage lief.
      '/v1/terminal/abort': [okPayment({ responseCode: '0', transactionId: '213' })],
      '/v1/terminal/status': [
        okPayment({ responseCode: '9011', transactionId: '213' }),
      ],
    },
    calls,
  );
  const result = await payments.cancel({ amountCents: 1000, transactionId: '213' });
  assert.equal(calls.filter((c) => c.path === '/v1/terminal/abort').length, 0, 'cancel() darf niemals abort() aufrufen');
  assert.equal(result.outcome, 'approved');
});

test(
  "Aufhebung: '0' auf die Statusabfrage entscheidet NICHT bei der ersten Abfrage -- der Void kann noch " +
    'unterwegs sein. Erst die ZWEITE Abfrage mit weiterhin 0 ergibt declined',
  async () => {
    const calls: RecordedCall[] = [];
    const payments = buildPayments(
      {
        '/v1/terminal/cancel': ['network-error'],
        '/v1/terminal/status': [
          okPayment({ responseCode: '0', transactionId: '214' }),
          okPayment({ responseCode: '0', transactionId: '214' }),
        ],
      },
      calls,
      { resolveBudgetMs: 20_000, maxBackoffMs: 5000 },
    );
    const result = await payments.cancel({ amountCents: 1000, transactionId: '214' });
    assert.equal(result.outcome, 'declined');
    assert.equal(calls.filter((c) => c.path === '/v1/terminal/status').length, 2, 'die erste 0 darf noch nicht entscheiden');
  },
);

test(
  "Aufhebung: reicht das Budget nur fuer EINE Statusabfrage, bleibt '0' unentschieden -- unresolved, " +
    'niemals ein geratenes declined',
  async () => {
    const calls: RecordedCall[] = [];
    const payments = buildPayments(
      {
        '/v1/terminal/cancel': ['network-error'],
        '/v1/terminal/status': [okPayment({ responseCode: '0', transactionId: '215' })],
      },
      calls,
      // Budget reicht fuer die erste Abfrage, aber nicht mehr fuer die Pause
      // plus eine zweite -- die Uhr ruehrt sich nur durch die Attrappen-Pause.
      { resolveBudgetMs: 500, maxBackoffMs: 5000 },
    );
    const result = await payments.cancel({ amountCents: 1000, transactionId: '215' });
    assert.equal(result.outcome, 'unresolved');
    assert.notEqual(result.outcome, 'declined');
    assert.equal(calls.filter((c) => c.path === '/v1/terminal/status').length, 1);
  },
);

test('Aufhebung: eine gescheiterte Statusabfrage zaehlt NICHT als "erste Abfrage" -- die naechste 9011 entscheidet trotzdem sofort', async () => {
  const calls: RecordedCall[] = [];
  const payments = buildPayments(
    {
      '/v1/terminal/cancel': ['network-error'],
      '/v1/terminal/status': ['network-error', okPayment({ responseCode: '9011', transactionId: '216' })],
    },
    calls,
    { resolveBudgetMs: 10_000, maxBackoffMs: 2000 },
  );
  const result = await payments.cancel({ amountCents: 1000, transactionId: '216' });
  assert.equal(result.outcome, 'approved');
});

test('Aufhebung: 9027 (keine Auskunft) entscheidet nie -- endet bei unresolved', async () => {
  const calls: RecordedCall[] = [];
  const payments = buildPayments(
    {
      '/v1/terminal/cancel': ['network-error'],
      '/v1/terminal/status': [okPayment({ responseCode: '9027', transactionId: '217' })],
    },
    calls,
    { resolveBudgetMs: 3000, maxBackoffMs: 1000 },
  );
  const result = await payments.cancel({ amountCents: 1000, transactionId: '217' });
  assert.equal(result.outcome, 'unresolved');
});

test('HTTP 409 auf die Aufhebung selbst -- declined, sofort, ohne Statusabfrage', async () => {
  const calls: RecordedCall[] = [];
  const payments = buildPayments(
    {
      '/v1/terminal/cancel': [
        failConnect('terminal_error', 'Terminal meldet (HTTP 409): Terminal is busy', { terminalHttpStatus: 409 }),
      ],
    },
    calls,
  );
  const result = await payments.cancel({ amountCents: 1000, transactionId: '218' });
  assert.equal(result.outcome, 'declined');
  assert.equal(calls.length, 1);
});

// ---------------------------------------------------------------------------
// Mutationsprobe: "9011 auf dem direkten Aufhebungsweg als 'hat nicht
// gegriffen' lesen" -- die untenstehende reine Unit-Grenze belegt, dass
// `fromCancelResponse` fuer 9011 KEIN Ergebnis liefert, nur ueber das
// oeffentliche Verhalten des obigen Verhaltenstests pruefbar: wuerde
// `fromCancelResponse` durch `fromResponse` ersetzt (die Mutation, die dieser
// Bericht tatsaechlich gefahren hat), wird aus dem 'approved' oben ein
// 'declined', weil 9011 dann sofort als Ablehnung der Aufhebung gelesen wird.
// ---------------------------------------------------------------------------

test('Codetabelle: 9011 ist schluessig -- isCanceled trifft nur auf 9011 zu', () => {
  assert.equal(isConclusive({ responseCode: '9011' }), true);
  assert.equal(isCanceled({ responseCode: '9011' }), true);
  assert.equal(isCanceled({ responseCode: '0' }), false);
  assert.equal(isApproved({ responseCode: '9011' }), false);
});

// ---------------------------------------------------------------------------
// Abgeschlossene Antwort mit unbekanntem Code -- der Alltagsfall "abgelehnt"
// ---------------------------------------------------------------------------

test('unbekannter Code direkt, dann zweimal 9027 -> declined', async () => {
  // Am 28.08.2026 gemessen: hat das Terminal die Zahlung mit einem
  // Ergebniscode beantwortet, ist der Vorgang dort BEENDET. Die Statusabfrage
  // unterscheidet dann sehr wohl -- genehmigt antwortet '0' (Beleg 408811,
  // dreimal geprueft), abgelehnt antwortet 9027. Genau das deckt den
  // Alltagsfall ab, dessen Code wir nicht kennen ("keine Deckung",
  // "Karte abgelaufen").
  const calls: RecordedCall[] = [];
  const payments = buildPayments(
    {
      '/v1/terminal/payment': [okPayment({ responseCode: '5555', responseText: 'Unbekannt' })],
      '/v1/terminal/abort': [okPayment({ responseCode: '100010' })],
      '/v1/terminal/status': [
        okPayment({ responseCode: '9027' }),
        okPayment({ responseCode: '9027' }),
      ],
    },
    calls,
    { resolveBudgetMs: 30_000 },
  );
  const result = await payments.pay({ amountCents: 2500, transactionId: '910' });

  assert.equal(result.outcome, 'declined');
  assert.equal(mayRetrySafely(result), true);
  assert.equal(result.transactionId, '910');
  assert.ok(result.steps.some((s) => s.includes('zweimal ohne Auskunft')));
});

test('unbekannter Code direkt, aber nur EINE Statusabfrage -> unresolved', async () => {
  // Die erste Abfrage laeuft unmittelbar nach der Antwort -- das Fenster, in
  // dem der Datensatz am Terminal noch nicht stehen koennte.
  const calls: RecordedCall[] = [];
  const payments = buildPayments(
    {
      '/v1/terminal/payment': [okPayment({ responseCode: '5555', responseText: 'Unbekannt' })],
      '/v1/terminal/abort': [okPayment({ responseCode: '100010' })],
      '/v1/terminal/status': [
        okPayment({ responseCode: '9027' }),
        'network-error',
        'network-error',
        'network-error',
      ],
    },
    calls,
    { resolveBudgetMs: 30_000 },
  );
  const result = await payments.pay({ amountCents: 2500, transactionId: '911' });

  assert.equal(result.outcome, 'unresolved');
  assert.equal(mayRetrySafely(result), false);
});

test('GAR KEINE Antwort, dann zweimal 9027 -> bleibt unresolved', async () => {
  // Der Vorfall vom 24.08.2026 selbst: die Antwort geht verloren, die Zahlung
  // laeuft am Terminal weiter. Hier ist NICHT bekannt, dass der Vorgang
  // beendet ist -- 9027 bleibt eine reine Nicht-Aussage.
  const calls: RecordedCall[] = [];
  const payments = buildPayments(
    {
      '/v1/terminal/payment': ['network-error'],
      '/v1/terminal/abort': [okPayment({ responseCode: '100010' })],
      '/v1/terminal/status': [
        okPayment({ responseCode: '9027' }),
        okPayment({ responseCode: '9027' }),
        okPayment({ responseCode: '9027' }),
      ],
    },
    calls,
    { resolveBudgetMs: 30_000 },
  );
  const result = await payments.pay({ amountCents: 2500, transactionId: '912' });

  assert.equal(result.outcome, 'unresolved');
  assert.equal(mayRetrySafely(result), false);
});

test('eine genehmigte Zahlung bleibt genehmigt, auch nach 9027 davor', async () => {
  const calls: RecordedCall[] = [];
  const payments = buildPayments(
    {
      '/v1/terminal/payment': [okPayment({ responseCode: '5555', responseText: 'Unbekannt' })],
      '/v1/terminal/abort': [okPayment({ responseCode: '100010' })],
      '/v1/terminal/status': [
        okPayment({ responseCode: '9027' }),
        okPayment({ responseCode: '0', receipt: '408811' }),
      ],
    },
    calls,
    { resolveBudgetMs: 30_000 },
  );
  const result = await payments.pay({ amountCents: 2500, transactionId: '913' });

  assert.equal(result.outcome, 'approved');
  assert.equal(result.response?.receipt, '408811');
});

test('zwei 9027 mit etwas dazwischen zaehlen nicht als zwei in Folge', async () => {
  // "Zweimal" heisst HINTEREINANDER. Antwortet das Terminal dazwischen ohne
  // Ergebniscode -- also "laeuft noch" --, faengt das Zaehlen von vorn an.
  const calls: RecordedCall[] = [];
  const payments = buildPayments(
    {
      '/v1/terminal/payment': [okPayment({ responseCode: '5555', responseText: 'Unbekannt' })],
      '/v1/terminal/abort': [okPayment({ responseCode: '100010' })],
      '/v1/terminal/status': [
        okPayment({ responseCode: '9027' }),
        okPayment({}),
        okPayment({ responseCode: '9027' }),
        'network-error',
        'network-error',
        'network-error',
      ],
    },
    calls,
    { resolveBudgetMs: 30_000 },
  );
  const result = await payments.pay({ amountCents: 2500, transactionId: '914' });

  assert.equal(result.outcome, 'unresolved');
});

test('9003, 100019 und 100108 sind gemessene Ablehnungen -> declined', async () => {
  // Alle drei weist das Terminal ab, BEVOR es eine Karte verlangt
  // (27./28.08.2026). Positive Aussagen, keine Wissensluecken -- eine
  // Klaerungsrunde waere reine Wartezeit.
  for (const [code, text, id] of [
    ['9003', 'Invalid Amount', '920'],
    ['100019', 'Amount is not in a valid range', '921'],
    ['100108', 'Invalid TID', '922'],
  ] as const) {
    const calls: RecordedCall[] = [];
    const payments = buildPayments(
      { '/v1/terminal/payment': [okPayment({ responseCode: code, responseText: text })] },
      calls,
    );
    const result = await payments.pay({ amountCents: 2500, transactionId: id });

    assert.equal(result.outcome, 'declined', `${code} ist gemessen: nichts belastet`);
    assert.equal(mayRetrySafely(result), true);
    assert.equal(
      calls.filter((c) => c.path === '/v1/terminal/status').length,
      0,
      'ein gemessener Code braucht keine Klaerungsrunde',
    );
  }
});
