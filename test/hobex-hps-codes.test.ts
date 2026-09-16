import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  HPS_CODES,
  HPS_REASON_HINTS,
  TERMINAL_BUSY_HTTP_STATUS,
  hpsCodeInfo,
  isApproved,
  isConclusive,
  isConclusiveAsStatus,
  isHostUncertain,
  isUnknownCode,
  needsReversal,
  normalizeHpsCode,
  parseHpsTransactionResponse,
} from '../src/payments/hobex-hps/index.js';

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
    sendReversal: boolean;
    tecsTitle: string | null;
  }[];
  gruende: Record<string, string>;
  terminalBusyHttpStatus: number;
};

const veraltet = 'fixtures/hobex-hps-codes.json ist veraltet -- `npm run fixtures:hobex-hps-codes` ausfuehren';

test('Golden: die Codetabelle steht in fixtures/hobex-hps-codes.json', () => {
  assert.deepEqual(
    vertrag.codes,
    HPS_CODES.map(({ code, title, meaning, conclusive, effect, reason, source, rejectsRequest, sendReversal, tecsTitle }) => ({
      code,
      title,
      meaning,
      conclusive,
      effect,
      reason,
      source,
      rejectsRequest,
      sendReversal,
      tecsTitle,
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
  // Die TECS-Liste hat ihren eigenen Test.
  const abweisend = HPS_CODES
    .filter((c) => c.rejectsRequest && (c.tecsTitle === null || c.source !== 'documented'))
    .map((c) => c.code)
    .sort();
  assert.deepEqual(
    abweisend,
    ['100001', '100008', '100009', '100010', '100013', '100018', '100022', '100108', '100998', '9002'],
  );
  for (const c of HPS_CODES.filter((x) => x.rejectsRequest)) {
    assert.equal(c.conclusive, true, c.code);
  }
});

/**
 * Jeder Code der TECS-Liste, wie hobex sie am 16.09.2026 geschickt hat -- in
 * der Schreibweise der Liste (vierstellig). Zwilling:
 * `test/hobex_tecs_codes_test.dart`.
 */
const TECS_LISTE: readonly string[] = [
  '0000', '9002', '9003', '9011', '9027', '9900', '0055', '0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008', '0009', '0010', '0011', '0012', '0013', '0014', '0015', '0016', '0017', '0018', '0019', '0020', '0021', '0022', '0023', '0024', '0025', '0026', '0027', '0028', '0029', '0030', '0031', '0032', '0033', '0034', '0035', '0036', '0037', '0038', '0040', '0041', '0042', '0043', '0044', '0051', '0052', '0053', '0054', '0056', '0057', '0058', '0059', '0060', '0061', '0062', '0063', '0064', '0065', '0066', '0067', '0068', '0075', '0076', '0077', '0080', '0081', '0082', '0083', '0086', '0087', '0088', '0089', '0090', '0091', '0092', '0093', '0094', '0095', '0096', '0097', '0098', '0099', '0117', '3018', '3019', '3021', '3030', '3031', '3032', '3033', '3034', '3035', '3036', '3037', '3038', '3039', '3050', '3051', '3052', '3053', '3054', '3055', '3056', '3057', '3058', '3059', '3060', '3061', '3062', '3063', '3064', '3065', '3066', '3531', '3532', '3533', '3534', '3537', '3539', '3547', '3549', '3559', '3569', '3579', '3589', '3590', '3596', '3597', '3598', '3693', '3694', '3695', '3696', '3697', '3699', '3993', '3994', '3995', '3996', '4000', '4001', '4002', '4003', '4004', '4005', '4006', '4007', '4011', '4012', '4013', '4020', '4021', '4022', '4023', '4024', '4025', '4026', '4027', '4028', '4029', '4030', '4060', '4061', '4062', '4063', '4064', '4065', '5127', '5158', '5256', '5271', '5272', '5273', '5274', '5275', '5276', '5277', '5278', '6000', '6001', '6002', '6003', '7777', '7001', '7002', '7005', '7006', '7007', '7008', '7009', '7010', '7011', '7012', '7013', '7014', '7015', '7016', '7017', '7018', '7019', '7020', '7021', '7022', '7023', '7024', '7100', '7101', '7102', '8001', '8002', '8003', '8004', '8005', '8006', '8007', '8008', '8009', '8010', '8011', '8012', '8013', '8014', '8015', '8016', '8017', '8018', '8019', '8020', '81xx', '8201', '8202', '8203', '8500', '8501', '8502', '8503', '8504', '8505', '8506', '8507', '8508', '8509', '8510', '8511', '8512', '8513', '8514', '8515', '8516', '8517', '8518', '8519', '8520', '8521', '8522', '8523', '8530', '8531', '8532', '8533', '8534', '8537', '8538', '8539', '8540', '8547', '8548', '8549', '8550', '8559', '8560', '8561', '8562', '8563', '8564', '8565', '8566', '8567', '8568', '8569', '8570', '8571', '8809', '8999', '9001', '9004', '9005', '9006', '9007', '9008', '9009', '9010', '9012', '9013', '9014', '9015', '9016', '9017', '9018', '9019', '9020', '9021', '9022', '9023', '9024', '9025', '9026', '9028', '9029', '9031', '9032', '9033', '9034', '9096', '9222', '9901', '9902', '9905', '9906', '9907', '9908', '9909', '30091', '30093', '30094', '30095', '30096', '30099',
];

const mit = (code: string) => parseHpsTransactionResponse({ responseCode: code });

test('TECS-Liste: jeder Code ist benannt und traegt seinen TECS-Titel', () => {
  for (const code of TECS_LISTE) {
    const info = hpsCodeInfo(code);
    assert.ok(info, `${code} fehlt`);
    assert.notEqual(info.tecsTitle, null, code);
    assert.notEqual(info.source, 'measured', code);
  }
});

test('TECS-Liste: die Familie 81xx deckt jedes Feld ab', () => {
  for (const code of ['8100', '8105', '8199']) {
    assert.equal(hpsCodeInfo(code)?.code, '81xx', code);
    assert.equal(isConclusive(mit(code)), true, code);
    assert.equal(isConclusiveAsStatus(mit(code)), false, code);
  }
  assert.equal(hpsCodeInfo('81')!.title, 'Message flow error');
  assert.equal(hpsCodeInfo('810'), undefined);
  assert.equal(hpsCodeInfo('81000'), undefined);
});

test('TECS-Liste: kein Code doppelt, auch nicht ueber die Schreibweise', () => {
  const codes = HPS_CODES.map((c) => normalizeHpsCode(c.code));
  assert.equal(new Set(codes).size, HPS_CODES.length);
});

test('TECS-Liste: vierstellig und ohne Nullen sind derselbe Code', () => {
  assert.equal(normalizeHpsCode('0055'), '55');
  assert.equal(normalizeHpsCode('0000'), '0');
  assert.equal(normalizeHpsCode(' 9908 '), '9908');
  assert.equal(normalizeHpsCode('81xx'), '81xx');
  assert.equal(isApproved(mit('0000')), true, 'sonst waere eine Genehmigung eine Ablehnung');
  assert.equal(mit('0000').responseCode, '0');
  assert.equal(hpsCodeInfo('0055')!.reason, 'wrongPin');
  assert.equal(hpsCodeInfo('0117')!.reason, 'wrongPin');
});

test('TECS-Liste: eine Genehmigung, die nicht 0 ist, wird nie zur Ablehnung', () => {
  for (const code of ['0008', '0010', '0011', '0016', '0032']) {
    const r = mit(code);
    assert.equal(isConclusive(r), false, code);
    assert.equal(isApproved(r), false, code);
    assert.equal(isHostUncertain(r), true, code);
    assert.equal(hpsCodeInfo(code)!.reason, 'approvedWithCondition', code);
    assert.equal(needsReversal(r), false, code);
  }
});

test('TECS-Liste: 9908 ist ein Timeout wie jeder andere -- offen, mit Storno', () => {
  const r = mit('9908');
  assert.equal(isConclusive(r), false);
  assert.equal(isHostUncertain(r), true);
  assert.equal(needsReversal(r), true);
  assert.equal(hpsCodeInfo('9908')!.reason, 'hostTimeout');
  for (const code of ['0068', '9905', '9906', '9907', '9909', '3051']) {
    assert.equal(needsReversal(mit(code)), true, code);
  }
  for (const code of ['100006', '100007', '100023', '100024', '100026', '100027']) {
    assert.equal(needsReversal(mit(code)), true, code);
  }
  assert.equal(needsReversal(mit('100029')), false, 'storniert laut hobex selbst');
  assert.equal(needsReversal(mit('100999')), false);
});

test('TECS-Liste: Storno nur bei ungewissem Ausgang und ausgebliebener Antwort', () => {
  for (const c of HPS_CODES) {
    const ausgeblieben = c.reason === 'hostFault' || c.reason === 'hostTimeout';
    assert.equal(c.sendReversal, ausgeblieben, c.code);
    if (c.sendReversal) assert.equal(c.effect, 'hostUncertain', c.code);
  }
});

test('TECS-Liste: Host-Ablehnungen sind schluessig und nennen den Grund', () => {
  const erwartet: Record<string, string> = {
    '0005': 'issuerDeclined',
    '0051': 'insufficientFunds',
    '0054': 'cardExpired',
    '0043': 'cardBlocked',
    '0075': 'pinTriesExceeded',
    '0077': 'pinRequired',
    '0091': 'hostUnavailable',
    '0096': 'hostUnavailable',
    '0003': 'acquirerSetup',
    '0030': 'hostRejected',
    '9018': 'cardBlocked',
    '9032': 'reversedByHost',
    '8009': 'hostTimeoutReversed',
  };
  for (const [code, grund] of Object.entries(erwartet)) {
    const r = mit(code);
    assert.equal(isConclusive(r), true, code);
    assert.equal(isApproved(r), false, code);
    assert.equal(isConclusiveAsStatus(r), true, code);
    assert.equal(hpsCodeInfo(code)!.reason, grund, code);
  }
});

test('TECS-Liste: Codes anderer TECS-Produkte sagen nichts ueber die Zahlung', () => {
  for (const code of ['3537', '3697', '4012', '7001', '7011', '7777', '8515', '8570', '9024', '30096']) {
    const r = mit(code);
    assert.equal(isConclusive(r), false, code);
    assert.equal(isHostUncertain(r), false, code);
    assert.equal(isUnknownCode(r), false, code);
    assert.equal(hpsCodeInfo(code)!.effect, 'noStatement', code);
  }
});

test('TECS-Liste: Aufhebung -- "bleibt belastet" nur, wo es stimmt', () => {
  assert.equal(hpsCodeInfo('9023')!.reason, 'cancelDenied');
  assert.equal(isConclusive(mit('9023')), true);
  // 9033: die Originalzahlung war abgelehnt -- als "Aufhebung hat nicht
  // gegriffen" gelesen, laed das zu einer Gutschrift ohne Belastung ein.
  assert.equal(isConclusive(mit('9033')), false);
  assert.equal(hpsCodeInfo('9033')!.reason, 'originalDeclined');
});

test('TECS-Liste: gemessene Codes tragen den TECS-Titel, behalten aber ihren', () => {
  const pin = hpsCodeInfo('55')!;
  assert.equal(pin.title, 'PIN falsch');
  assert.equal(pin.tecsTitle, 'Incorrect PIN');
  assert.equal(pin.source, 'measuredAndDocumented');
  assert.equal(hpsCodeInfo('0')!.tecsTitle, 'Approved Transaction / OK');
  assert.equal(hpsCodeInfo('100003')!.tecsTitle, null);
  // 9900: gemessen nach verarbeiteter Karte, laut TECS ein Backend-Fehler.
  assert.equal(hpsCodeInfo('9900')!.effect, 'hostUncertain');
  assert.equal(hpsCodeInfo('9900')!.reason, 'internalError');
});
