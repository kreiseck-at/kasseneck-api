import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RECEIPT_EMAIL_ERROR_MESSAGES, LABELS, ERROR_RULES, ERROR_CODE_RULES, ERROR_OUTCOME_RULES, CALLS_WITH_EFFECT, MESSAGES, CANCELLATION_PAYMENT_ERROR_MESSAGES, findErrorRule, messageText } from '../src/pos/texte.js';
import type { ErrorKind } from '../src/pos/texte.js';
import type { MessageKey } from '../src/pos/texte.js';

const lies = (name: string) => JSON.parse(readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), 'utf8'));
const veraltet = 'fixtures/pos-texts.json ist veraltet — `npm run fixtures:texte` ausfuehren';

test('Golden: der Katalog steht in fixtures/pos-texts.json', () => {
  const vertrag = lies('pos-texts.json');
  assert.deepEqual(Object.keys(vertrag), ['version', 'messages', 'errorRules', 'errorCodeRules', 'errorOutcomeRules', 'callsWithEffect', 'receiptEmailErrors', 'cancellationPaymentErrors', 'labels'], veraltet);
  assert.deepEqual(vertrag.messages, MESSAGES, veraltet);
  assert.deepEqual(vertrag.errorRules, ERROR_RULES, veraltet);
  assert.deepEqual(vertrag.errorCodeRules, ERROR_CODE_RULES, veraltet);
  assert.deepEqual(vertrag.errorOutcomeRules, ERROR_OUTCOME_RULES, veraltet);
  assert.deepEqual(vertrag.callsWithEffect, CALLS_WITH_EFFECT, veraltet);
  // Die App liest die Zuordnung `code` -> Satz aus dieser Datei; fehlt sie
  // dort, entscheidet die App am Satz des Backends und weicht vom Web ab.
  assert.deepEqual(vertrag.receiptEmailErrors, RECEIPT_EMAIL_ERROR_MESSAGES, veraltet);
  assert.deepEqual(vertrag.cancellationPaymentErrors, CANCELLATION_PAYMENT_ERROR_MESSAGES, veraltet);
  assert.deepEqual(vertrag.labels, LABELS, veraltet);
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(vertrag.version, pkg.version, veraltet);
});

test('die Faelle decken jede Fehlerart ab und erwarten nur, was der Katalog hergibt', () => {
  const datei = lies('pos-message-cases.json') as { version: number; cases: Array<{ name: string; error: { kind: string }; fallback: string; expected: string | { key: keyof typeof MESSAGES; values?: Record<string, string | number> } }> };
  assert.deepEqual(Object.keys(datei), ['version', 'cases']);
  const arten = new Set(datei.cases.map((f) => f.error.kind));
  assert.deepEqual([...arten].sort(), [...new Set(ERROR_RULES.map((r) => r.kind))].sort());
  for (const fall of datei.cases) {
    assert.deepEqual(Object.keys(fall), ['name', 'error', 'fallback', 'expected'], fall.name);
    if (typeof fall.expected === 'string') continue;
    // Eigene Variable statt `fall.expected` in der Closure: TypeScript verengt
    // eine Eigenschaft nicht ueber Funktionsgrenzen hinweg.
    const erwartet: { key: MessageKey; values?: Record<string, string | number> } = fall.expected;
    assert.ok(erwartet.key in MESSAGES, fall.name);
    assert.doesNotThrow(() => messageText(erwartet.key, erwartet.values), fall.name);
  }
});

type Fall = {
  name: string;
  error: { kind: ErrorKind; code?: string; outcome?: 'unknown' | 'rejected'; serverMessage?: string; text?: string; status?: number };
  fallback: string;
  expected: string | { key: MessageKey; values?: Record<string, string | number> };
};

/** Was eine Kasse mit der Regel macht (Web: `bildschirmtext`, App: dasselbe in Dart). */
function bildschirm(fall: Fall): string {
  const regel = findErrorRule(fall.error.kind, { code: fall.error.code, outcome: fall.error.outcome });
  if ('key' in regel) return messageText(regel.key, regel.key === 'server.unexpected' ? { status: fall.error.status ?? 0 } : {});
  switch (regel.behavior) {
    case 'server_text': return fall.error.serverMessage ?? '';
    case 'own_text': return fall.error.text ?? '';
    default: return fall.fallback;
  }
}

test('jeder Fall ergibt ueber findErrorRule genau seinen erwarteten Satz', () => {
  const { cases } = lies('pos-message-cases.json') as { cases: Fall[] };
  for (const fall of cases) {
    assert.deepEqual(Object.keys(fall.error).filter((k) => !['kind', 'code', 'outcome', 'serverMessage', 'text', 'status'].includes(k)), [], fall.name);
    const erwartet = typeof fall.expected === 'string' ? fall.expected : messageText(fall.expected.key, fall.expected.values);
    assert.equal(bildschirm(fall), erwartet, fall.name);
  }
});

test('jede Regel hat einen Fall, jeder Code und jeder Ausgang einer Regel ebenso', () => {
  const { cases } = lies('pos-message-cases.json') as { cases: Fall[] };
  const trifft = (f: Fall) => findErrorRule(f.error.kind, { code: f.error.code, outcome: f.error.outcome });
  for (const regel of ERROR_RULES) {
    assert.ok(cases.some((f) => trifft(f) === regel), `kein Fall fuer ${regel.kind}`);
  }
  for (const regel of ERROR_CODE_RULES) {
    for (const code of regel.codes) assert.ok(cases.some((f) => f.error.code === code && trifft(f) === regel), `kein Fall fuer ${regel.kind} ${code}`);
  }
  for (const regel of ERROR_OUTCOME_RULES) {
    assert.ok(cases.some((f) => f.error.outcome === regel.outcome && trifft(f) === regel), `kein Fall fuer ${regel.kind} ${regel.outcome}`);
  }
});
