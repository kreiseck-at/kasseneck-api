import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { hobexReceiptToCardPaymentData } from '../src/models/hobex-receipt.js';
import {
  createHpsConnectClient,
  normalizeHpsTid,
  type HpsConnectFetch,
  type HpsConnectFetchResponse,
} from '../src/payments/hobex-hps/connect-client.js';
import { HpsPreflightError } from '../src/payments/hobex-hps/errors.js';
import type { CardPaymentOutcome } from '../src/payments/hobex-hps/outcome.js';
import { createHpsPayments } from '../src/payments/hobex-hps/payments.js';
import { hobexReceiptFromHps } from '../src/payments/hobex-hps/receipt.js';
import { parseHpsTransactionResponse } from '../src/payments/hobex-hps/transaction-response.js';

/**
 * Die Prueffaelle aus `fixtures/hobex-hps-cases.json` -- derselbe Vertrag,
 * den der Dart-Zwilling (`test/hps_faelle_vertrag_test.dart`) rechnet.
 *
 * Die Attrappe spielt Kasseneck Connect mit dessen Huelle
 * (`{ok:true, hps:{...}}`) und antwortet je Weg aus dem Prueffall. Wie das
 * echte HPS weist sie jeden Aufruf mit einer anderen TID als `hpsTid` mit der
 * gemessenen Antwort `invalidTid` ab -- eingetragen ist `clarifyTid`, also die
 * TID mit fuehrender Null wie auf dem Beleg.
 */

type Antwort = Record<string, unknown>;

interface TidFall {
  name?: string;
  input: string;
  expected: string;
}

interface BelegFall {
  name: string;
  response: string;
  overrides?: Antwort;
  expected: { amountCents: number; tipCents: number; cardPaymentData: Record<string, string> };
}

interface Erwartet {
  outcome: CardPaymentOutcome;
  reason: string | null;
  response?: Record<string, string>;
  lastResponseCode?: string;
  abortCalls: number;
  statusCalls: number;
  reversalCalls?: number;
  reversalAmountCents?: number;
  stepIncludes?: string;
}

interface KlaerFall {
  name: string;
  operation: 'pay' | 'refund';
  amountCents: number;
  tipCents?: number;
  transactionId: string;
  originalTransactionId?: string;
  resolveBudgetMs: number;
  abortWhilePaymentRuns?: boolean;
  request: string;
  abort: string;
  reversal?: string;
  status: string[];
  expected: Erwartet;
}

interface Vertrag {
  responses: Record<string, Antwort>;
  tid: TidFall[];
  receipts: BelegFall[];
  clarifyTid: string;
  hpsTid: string;
  clarify: KlaerFall[];
  reversalAnswers: { notExecuted: string[]; mayHaveWorked: string[] };
}

const vertrag = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../fixtures/hobex-hps-cases.json', import.meta.url)), 'utf8'),
) as Vertrag;

/** Name im Prueffall fuer "die Leitung reisst ab, keine Antwort". */
const TRANSPORT = 'transport';
/** Namen im Prueffall fuer "das Terminal antwortet mit diesem HTTP-Status". */
const HTTP_404 = 'http404';
const HTTP_409 = 'http409';
/** Name in reversalAnswers fuer "Antwort ohne Ergebniscode". */
const OHNE_CODE = 'noCode';
const TOKEN = 'kc_test_TOKEN';
const ZIEL_HOST = '192.168.1.50';

type Weg = 'request' | 'abort' | 'status' | 'reversal';
const WEGE: Readonly<Record<string, Weg>> = {
  '/v1/terminal/payment': 'request',
  '/v1/terminal/refund': 'request',
  '/v1/terminal/abort': 'abort',
  '/v1/terminal/status': 'status',
  '/v1/terminal/cancel': 'reversal',
};

/** Die Antwort [name] aus `responses`, ohne die Messvermerke (`_…`). */
function antwort(name: string): Antwort {
  const a = vertrag.responses[name];
  if (a === undefined) throw new Error(`Prueffall nennt die Antwort "${name}", die in responses fehlt`);
  return Object.fromEntries(Object.entries(a).filter(([k]) => !k.startsWith('_')));
}

function huelle(hps: Antwort): HpsConnectFetchResponse {
  return { status: 200, text: async () => JSON.stringify({ ok: true, hps }) };
}

/** Wie Connect einen HTTP-Status des Terminals weiterreicht (`error.detail.terminalHttpStatus`). */
function terminalHttp(status: number): HpsConnectFetchResponse {
  const rumpf = {
    ok: false,
    error: { code: 'terminal_error', message: `Terminal meldet (HTTP ${status})`, detail: { terminalHttpStatus: status } },
  };
  return { status: 200, text: async () => JSON.stringify(rumpf) };
}

/**
 * [zusatz] stellt Antworten bereit, die nicht in `responses` stehen -- fuer
 * reversalAnswers, die nur einen Code nennen.
 */
function attrappe(fall: KlaerFall, zusatz: Readonly<Record<string, Antwort>> = {}) {
  const aufrufe: Array<{ weg: Weg; tid: unknown; amountCents: unknown }> = [];
  let statusIndex = 0;
  let meldeGesendet!: () => void;
  const gesendet = new Promise<void>((r) => { meldeGesendet = r; });
  let freigeben!: () => void;
  const freigabe = new Promise<void>((r) => { freigeben = r; });

  const holen: HpsConnectFetch = async (url, init) => {
    const pfad = new URL(url).pathname;
    const weg = WEGE[pfad];
    if (weg === undefined) throw new Error(`Prueffall sieht keinen Aufruf ${pfad} vor`);
    const rumpf = JSON.parse(init.body) as Record<string, unknown>;
    aufrufe.push({ weg, tid: rumpf['tid'], amountCents: rumpf['amountCents'] });

    if (weg === 'request' && fall.abortWhilePaymentRuns) meldeGesendet();
    // Wie das HPS: eine fremde TID wird sofort abgewiesen, ohne Kartenfluss.
    if (rumpf['tid'] !== vertrag.hpsTid) return huelle(antwort('invalidTid'));

    let name: string;
    switch (weg) {
      case 'request':
        if (fall.abortWhilePaymentRuns) await freigabe;
        name = fall.request;
        break;
      case 'abort':
        name = fall.abort;
        break;
      case 'reversal':
        if (fall.reversal === undefined) throw new Error(`Prueffall "${fall.name}" sieht kein Storno vor`);
        name = fall.reversal;
        break;
      case 'status': {
        const n = fall.status[Math.min(statusIndex, fall.status.length - 1)];
        if (n === undefined) throw new Error(`Prueffall "${fall.name}" hat keine Statusantwort`);
        statusIndex += 1;
        name = n;
        break;
      }
    }
    if (name === TRANSPORT) throw new Error('Leitung abgerissen (Prueffall)');
    if (name === HTTP_404) return terminalHttp(404);
    if (name === HTTP_409) return terminalHttp(409);
    return huelle(zusatz[name] ?? antwort(name));
  };

  return { holen, aufrufe, gesendet, freigeben };
}

async function klaeren(fall: KlaerFall, zusatz: Readonly<Record<string, Antwort>> = {}) {
  const t = attrappe(fall, zusatz);
  const client = createHpsConnectClient({ baseUrl: 'http://127.0.0.1:27182', token: TOKEN, fetch: t.holen });
  let jetzt = 0;
  const ziel = { host: ZIEL_HOST, tid: vertrag.clarifyTid };
  const payments = createHpsPayments(client, ziel, {
    resolveBudgetMs: fall.resolveBudgetMs,
    now: () => jetzt,
    sleep: async (ms) => {
      jetzt += ms;
    },
  });
  const lauf = fall.operation === 'pay'
    ? payments.pay({ amountCents: fall.amountCents, tipCents: fall.tipCents, transactionId: fall.transactionId })
    : payments.refund({
      amountCents: fall.amountCents,
      transactionId: fall.transactionId,
      originalTransactionId: fall.originalTransactionId ?? '',
    });
  if (fall.abortWhilePaymentRuns) {
    // Wie der Abbrechen-Knopf der Kasse: eigener Abbruch, waehrend pay() wartet.
    await t.gesendet;
    await client.abort({ ...ziel, transactionId: fall.transactionId });
    t.freigeben();
  }
  return { result: await lauf, aufrufe: t.aufrufe };
}

test('Vertrag: Prueffaelle vorhanden', () => {
  assert.ok(vertrag.tid.length > 0);
  assert.ok(vertrag.receipts.length > 0);
  assert.ok(vertrag.clarify.length > 0);
  assert.notEqual(vertrag.clarifyTid, vertrag.hpsTid, 'die eingetragene TID soll eine Umschreibung brauchen');
});

test('TID: welche Schreibweise hinausgeht (normalizeHpsTid)', () => {
  for (const f of vertrag.tid) {
    assert.equal(normalizeHpsTid(f.input), f.expected, f.name ?? JSON.stringify(f.input));
  }
});

test('TID ohne Text (etwa eine Zahl) geht unveraendert hinaus -- Connect weist sie vor dem Terminal ab', async () => {
  const zahl = 3600335 as unknown as string;
  assert.equal(normalizeHpsTid(zahl), zahl);

  // Wie Connect (routes_terminal.dart): eine TID, die kein rein ziffriger Text
  // ist, wird vor jedem Terminal-Kontakt mit bad_request abgewiesen.
  const gesendet: unknown[] = [];
  const holen: HpsConnectFetch = async (_url, init) => {
    const tid = (JSON.parse(init.body) as Record<string, unknown>)['tid'];
    gesendet.push(tid);
    const gueltig = typeof tid === 'string' && /^\d{1,16}$/.test(tid.trim());
    const rumpf = gueltig
      ? { ok: true, hps: { responseCode: '0' } }
      : { ok: false, error: { code: 'bad_request', message: 'Es fehlt die Terminal-ID (tid).' } };
    return { status: gueltig ? 200 : 400, text: async () => JSON.stringify(rumpf) };
  };
  const payments = createHpsPayments(createHpsConnectClient({ token: TOKEN, fetch: holen }), { host: ZIEL_HOST, tid: zahl });
  await assert.rejects(
    payments.pay({ amountCents: 1, transactionId: '261110033825505739' }),
    (e: unknown) => e instanceof HpsPreflightError && e.connectCode === 'bad_request',
  );
  assert.deepEqual(gesendet, [3600335], 'genau ein Aufruf, ohne Abbruch und Statusabfrage');
});

test('TID 03600335 geht bei jedem Aufruf als 3600335 hinaus: Zahlung, Status, Abbruch, Aufhebung, Gutschrift, Diagnose', async () => {
  const gesendet: Array<{ pfad: string; tid: unknown }> = [];
  const holen: HpsConnectFetch = async (url, init) => {
    const rumpf = JSON.parse(init.body) as Record<string, unknown>;
    gesendet.push({ pfad: new URL(url).pathname, tid: rumpf['tid'] });
    return huelle(rumpf['tid'] === vertrag.hpsTid ? { responseCode: '0' } : antwort('invalidTid'));
  };
  const client = createHpsConnectClient({ token: TOKEN, fetch: holen });
  const ziel = { host: ZIEL_HOST, tid: '03600335' };
  const zahlung = '261110033825505723';

  const antworten = [
    await client.payment({ ...ziel, transactionId: zahlung, amountCents: 1 }),
    await client.status({ ...ziel, transactionId: zahlung }),
    await client.abort({ ...ziel, transactionId: zahlung }),
    await client.cancel({ ...ziel, transactionId: zahlung, amountCents: 1 }),
    await client.refund({ ...ziel, transactionId: '261110033825505729', originalTransactionId: zahlung, amountCents: 1 }),
  ];
  const diagnose = await client.diagnosis(ziel);

  assert.deepEqual(
    gesendet.map((g) => g.pfad),
    [
      '/v1/terminal/payment',
      '/v1/terminal/status',
      '/v1/terminal/abort',
      '/v1/terminal/cancel',
      '/v1/terminal/refund',
      '/v1/terminal/diagnosis',
    ],
  );
  for (const g of gesendet) assert.equal(g.tid, '3600335', g.pfad);
  for (const a of antworten) assert.equal(a.responseCode, '0');
  assert.equal(diagnose['responseCode'], '0');
  assert.equal(ziel.tid, '03600335', 'das Ziel des Aufrufers bleibt unveraendert');
});

for (const fall of vertrag.receipts) {
  test(`Beleg: ${fall.name}`, () => {
    const roh = { ...antwort(fall.response), ...(fall.overrides ?? {}) };
    const beleg = hobexReceiptFromHps(parseHpsTransactionResponse(roh));
    assert.equal(beleg.amountCents, fall.expected.amountCents, 'amountCents');
    assert.equal(beleg.tipCents, fall.expected.tipCents, 'tipCents');
    assert.deepEqual(hobexReceiptToCardPaymentData(beleg), fall.expected.cardPaymentData);
  });
}

for (const fall of vertrag.clarify) {
  test(`Klaerung: ${fall.name}`, async () => {
    const { result, aufrufe } = await klaeren(fall);
    const e = fall.expected;

    assert.equal(result.outcome, e.outcome);
    assert.equal(result.reason ?? null, e.reason);
    assert.equal(result.transactionId, fall.transactionId);
    if (e.response === undefined) {
      assert.equal(result.response, undefined, 'ein offener Ausgang hat keinen Beleg');
    } else {
      assert.ok(result.response, 'die festschreibende Antwort fehlt');
      const felder = result.response as unknown as Record<string, unknown>;
      for (const [feld, wert] of Object.entries(e.response)) assert.equal(felder[feld], wert, feld);
    }
    if (e.lastResponseCode !== undefined) assert.equal(result.lastResponse?.responseCode, e.lastResponseCode);
    assert.equal(aufrufe.filter((a) => a.weg === 'abort').length, e.abortCalls, 'Abbrueche');
    assert.equal(aufrufe.filter((a) => a.weg === 'status').length, e.statusCalls, 'Statusabfragen');
    const stornos = aufrufe.filter((a) => a.weg === 'reversal');
    assert.equal(stornos.length, e.reversalCalls ?? 0, 'Stornos');
    if (e.reversalAmountCents !== undefined) {
      for (const s of stornos) assert.equal(s.amountCents, e.reversalAmountCents, 'Stornobetrag in Cent');
    }
    for (const a of aufrufe) assert.equal(a.tid, vertrag.hpsTid, `TID beim Weg ${a.weg}`);
    if (e.stepIncludes !== undefined) {
      assert.ok(result.steps.some((s) => s.includes(e.stepIncludes!)), result.steps.join(' | '));
    }
    if (e.outcome !== 'declined') {
      const behauptet = result.steps.filter((s) => s.includes('nichts belastet'));
      assert.deepEqual(behauptet, [], 'der Nachweis behauptet "nichts belastet", obwohl der Ausgang es nicht sagt');
    }
  });
}

/**
 * reversalAnswers: dieselbe Zahlung (9908, Trinkgeld) je Antwort auf das
 * Storno. Was nach der Positivliste nicht ausgefuehrt wurde, laesst eine
 * Genehmigung im Status gelten; alles andere, auch jeder Storniert-Code, nimmt
 * ihr die Aussage.
 */
function stornoFall(antwortAufsStorno: string, status: string): { fall: KlaerFall; zusatz: Record<string, Antwort> } {
  const name = `storno:${antwortAufsStorno}`;
  const sonder = [TRANSPORT, HTTP_404, HTTP_409].includes(antwortAufsStorno);
  const zusatz: Record<string, Antwort> = sonder
    ? {}
    : { [name]: antwortAufsStorno === OHNE_CODE ? {} : { responseCode: antwortAufsStorno } };
  return {
    fall: {
      name: `Storno ${antwortAufsStorno}, Status ${status}`,
      operation: 'pay',
      amountCents: 1000,
      tipCents: 150,
      transactionId: '261110033825505799',
      resolveBudgetMs: 30000,
      request: 'hostTimeout',
      abort: 'abortAccepted',
      reversal: sonder ? antwortAufsStorno : name,
      status: [status],
      expected: { outcome: 'approved', reason: null, abortCalls: 0, statusCalls: 0 },
    },
    zusatz,
  };
}

for (const [gruppe, codes] of Object.entries(vertrag.reversalAnswers).filter(([k]) => !k.startsWith('_'))) {
  const nichtAusgefuehrt = gruppe === 'notExecuted';
  for (const code of codes as string[]) {
    test(`Storno-Antwort ${code} (${gruppe}), Status genehmigt`, async () => {
      const { fall, zusatz } = stornoFall(code, 'statusApproved');
      const { result, aufrufe } = await klaeren(fall, zusatz);
      assert.equal(aufrufe.filter((a) => a.weg === 'reversal').length, 1);
      assert.equal(aufrufe.find((a) => a.weg === 'reversal')!.amountCents, 1150);
      if (nichtAusgefuehrt) {
        assert.equal(result.outcome, 'approved', result.steps.join(' | '));
        assert.equal(aufrufe.filter((a) => a.weg === 'status').length, 1);
      } else {
        assert.equal(result.outcome, 'unresolved', result.steps.join(' | '));
        assert.equal(result.reason, 'hostTimeout');
        assert.equal(aufrufe.filter((a) => a.weg === 'status').length, 2);
        assert.deepEqual(result.steps.filter((s) => s.includes('nichts belastet')), []);
      }
    });
    test(`Storno-Antwort ${code} (${gruppe}), Status 9011`, async () => {
      const { fall, zusatz } = stornoFall(code, 'statusCanceled');
      const { result } = await klaeren(fall, zusatz);
      assert.equal(result.outcome, 'declined', result.steps.join(' | '));
      assert.equal(result.reason, nichtAusgefuehrt ? 'canceled' : 'voidedAfterHostFault');
    });
  }
}
