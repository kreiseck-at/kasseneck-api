import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HPS_CODES, HPS_REASON_HINTS, TERMINAL_BUSY_HTTP_STATUS } from '../src/payments/hobex-hps/index.js';

/**
 * Golden-Test des Vertrags mit dem Dart-Zwilling: `fixtures/hobex-hps-codes.json`
 * muss genau die Codetabelle fuehren, die `transaction-response.ts`
 * tatsaechlich als schluessig bzw. Wissensluecke behandelt.
 *
 * Anders als `test/oberflaeche.test.ts` liest dieser Test die Quelle nicht
 * "was gibt es alles" (kein automatisches Ableiten ueber Namensmuster) --
 * die Codetabelle IST bereits die single source of truth ([HPS_CODES]), der
 * Generator (`scripts/hobex-hps-codes.mjs`) schreibt sie nur unveraendert in
 * JSON. Der Test haelt trotzdem beide Seiten synchron, weil ein
 * `npm run build` zwischen einer Aenderung an [HPS_CODES] und einem erneuten
 * `fixtures:hobex-hps-codes`-Lauf leicht vergessen wird.
 */

const vertrag = JSON.parse(
  readFileSync(new URL('../../fixtures/hobex-hps-codes.json', import.meta.url), 'utf8'),
) as {
  version: string;
  codes: {
    code: string;
    title: string;
    meaning: string;
    conclusive: boolean;
    effect: string;
    reason: string;
    source: string;
    rejectsRequest: boolean;
  }[];
  gruende: Record<string, string>;
  terminalBusyHttpStatus: number;
};

const veraltet = 'fixtures/hobex-hps-codes.json ist veraltet -- `npm run fixtures:hobex-hps-codes` ausfuehren';

test('Golden: die Codetabelle steht in fixtures/hobex-hps-codes.json', () => {
  assert.deepEqual(
    vertrag.codes,
    HPS_CODES.map(({ code, title, meaning, conclusive, effect, reason, source, rejectsRequest }) => ({
      code,
      title,
      meaning,
      conclusive,
      effect,
      reason,
      source,
      rejectsRequest,
    })),
    veraltet,
  );
  assert.deepEqual(vertrag.gruende, HPS_REASON_HINTS, veraltet);
  assert.equal(vertrag.terminalBusyHttpStatus, TERMINAL_BUSY_HTTP_STATUS, veraltet);
});

test('Die Vertragsdatei nennt die Paketversion', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
  assert.equal(vertrag.version, pkg.version, veraltet);
});

test('Jeder schluessige Code ist genau einmal genannt -- keine Dopplung, keine Luecke in der Positivliste', () => {
  const schluessige = HPS_CODES.filter((c) => c.conclusive).map((c) => c.code);
  assert.equal(new Set(schluessige).size, schluessige.length, 'ein Code kommt doppelt vor');
  // '0' (genehmigt) und die vier Ablehnungsgruende muessen zwingend dabei
  // sein -- faellt einer weg, meldet der Zahlweg fuer einen tatsaechlich
  // entschiedenen Vorgang faelschlich "unresolved".
  // Dazu 55: die erste gemessene Host-Ablehnung (02.09.2026, Betrieb).
  for (const erwartet of ['0', '9002', '9011', '100002', '100003', '100010', '55']) {
    assert.ok(schluessige.includes(erwartet), `${erwartet} fehlt in der Positivliste`);
  }
  // 9027 und 9900 sind GEMESSEN, aber ausdruecklich KEINE Aussage -- die
  // Regression, die dieses ganze Vorhaben ausgeloest hat.
  for (const wissensluecke of ['9027', '9900']) {
    assert.ok(!schluessige.includes(wissensluecke), `${wissensluecke} duerfte NICHT schluessig sein`);
  }
});

/**
 * Die Antwortcodeliste von hobex, wie sie am 11.09.2026 kam -- wortwoertlich
 * und nicht aus [HPS_CODES] abgeleitet: wer die Tabelle aendert, soll an genau
 * dieser Liste vorbei muessen. Zwilling: `test/hobex_hps_codes_test.dart`.
 */
const HOBEX_LISTE: readonly (readonly [string, string, string, string])[] = [
  ['0', 'Authorized', 'conclusive', 'approved'],
  ['100001', 'Bad Request', 'conclusive', 'requestRejected'],
  ['100002', 'Aborted', 'conclusive', 'aborted'],
  ['100003', 'Card not present', 'conclusive', 'noCard'],
  ['100004', 'Card read failed', 'conclusive', 'cardReadFailed'],
  ['100005', 'App select failed', 'conclusive', 'cardReadFailed'],
  ['100006', 'Communication with TecsXml failed', 'hostUncertain', 'hostFault'],
  ['100007', 'Processing of TecsXml step failed', 'hostUncertain', 'hostFault'],
  ['100008', 'Invalid TID', 'conclusive', 'terminalSetup'],
  ['100009', 'Invalid Tx Type', 'conclusive', 'requestRejected'],
  ['100010', 'Unable to abort transaction', 'conclusive', 'notAbortable'],
  ['100011', 'Not Found', 'noStatement', 'noStatement'],
  ['100012', 'Max retries exceeded', 'conclusive', 'cardReadFailed'],
  ['100013', 'Diagnosis failed', 'conclusive', 'terminalFault'],
  ['100014', "Card information wasn't entered", 'conclusive', 'noCard'],
  ['100015', 'Card declined', 'conclusive', 'cardDeclined'],
  ['100017', 'Card Not Supported', 'conclusive', 'cardDeclined'],
  ['100018', 'Scep enrollment failed', 'conclusive', 'terminalSetup'],
  ['100019', 'Amount is not in a valid range', 'conclusive', 'amountInvalid'],
  ['100020', 'Refund password is invalid', 'conclusive', 'refundPassword'],
  ['100021', 'Failed to enter the password', 'conclusive', 'refundPassword'],
  ['100022', 'Terminal is blocked', 'conclusive', 'terminalBlocked'],
  ['100023', 'Invalid message type', 'hostUncertain', 'hostFault'],
  ['100024', 'Transaction completion has failed', 'hostUncertain', 'hostFault'],
  ['100025', 'Refund transactions are disabled', 'conclusive', 'refundDisabled'],
  ['100026', 'Transaction was declined.', 'hostUncertain', 'hostFault'],
  ['100027', 'Unsupported UserData in TecsXml Response', 'hostUncertain', 'hostFault'],
  ['100028', 'Tip selection process has failed.', 'conclusive', 'tipNotSelected'],
  ['100029', 'Communication with TecsXml timeout', 'conclusive', 'hostTimeoutReversed'],
  ['100998', 'Terminal is busy', 'conclusive', 'terminalBusy'],
  ['100999', 'Internal Error', 'hostUncertain', 'internalError'],
];

test('Antwortcodeliste von hobex: jeder Code steht in der Tabelle, so eingeordnet', () => {
  for (const [code, title, effect, reason] of HOBEX_LISTE) {
    const info = HPS_CODES.find((c) => c.code === code);
    assert.ok(info, `${code} fehlt`);
    assert.equal(info.title, title, code);
    assert.equal(info.effect, effect, code);
    assert.equal(info.reason, reason, code);
    assert.ok(info.source === 'documented' || info.source === 'measuredAndDocumented', `${code} steht in der Liste von hobex`);
  }
});

test('Kein Code doppelt, jeder Grund hat einen Satz', () => {
  const codes = HPS_CODES.map((c) => c.code);
  assert.equal(new Set(codes).size, codes.length);
  for (const c of HPS_CODES) {
    assert.ok(HPS_REASON_HINTS[c.reason].endsWith('.'), c.reason);
  }
});

test('Genau diese Codes weisen die Anfrage selbst ab -- Zwilling: HpsCode.rejectsRequest', () => {
  const abweisend = HPS_CODES.filter((c) => c.rejectsRequest).map((c) => c.code).sort();
  assert.deepEqual(
    abweisend,
    ['100001', '100008', '100009', '100010', '100013', '100018', '100022', '100108', '100998', '9002'],
  );
  for (const c of HPS_CODES.filter((x) => x.rejectsRequest)) {
    assert.equal(c.conclusive, true, c.code);
  }
});
