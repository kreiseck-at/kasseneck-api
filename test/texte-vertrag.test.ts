import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RECEIPT_EMAIL_ERROR_MESSAGES, LABELS, ERROR_RULES, MESSAGES, CANCELLATION_PAYMENT_ERROR_MESSAGES, messageText } from '../src/pos/texte.js';
import type { MessageKey } from '../src/pos/texte.js';

const lies = (name: string) => JSON.parse(readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), 'utf8'));
const veraltet = 'fixtures/kasse-texte.json ist veraltet — `npm run fixtures:texte` ausfuehren';

test('Golden: der Katalog steht in fixtures/kasse-texte.json', () => {
  const vertrag = lies('kasse-texte.json');
  assert.deepEqual(vertrag.meldungen, MESSAGES, veraltet);
  assert.deepEqual(vertrag.fehlerregeln, ERROR_RULES, veraltet);
  // Die App liest die Zuordnung `code` -> Satz aus dieser Datei; fehlt sie
  // dort, entscheidet die App am Satz des Backends und weicht vom Web ab.
  assert.deepEqual(vertrag.belegMailFehler, RECEIPT_EMAIL_ERROR_MESSAGES, veraltet);
  assert.deepEqual(vertrag.stornoZahlungFehler, CANCELLATION_PAYMENT_ERROR_MESSAGES, veraltet);
  assert.deepEqual(vertrag.beschriftungen, LABELS, veraltet);
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(vertrag.version, pkg.version, veraltet);
});

test('die Faelle decken jede Fehlerart ab und erwarten nur, was der Katalog hergibt', () => {
  const { faelle } = lies('kasse-meldungen-faelle.json') as { faelle: Array<{ name: string; fehler: { art: string }; ersatz: string; erwartet: string | { schluessel: keyof typeof MESSAGES; werte?: Record<string, string | number> } }> };
  const arten = new Set(faelle.map((f) => f.fehler.art));
  assert.deepEqual([...arten].sort(), ERROR_RULES.map((r) => r.art).sort());
  for (const fall of faelle) {
    if (typeof fall.erwartet === 'string') continue;
    // Eigene Variable statt `fall.erwartet` in der Closure: TypeScript verengt
    // eine Eigenschaft nicht ueber Funktionsgrenzen hinweg.
    const erwartet: { schluessel: MessageKey; werte?: Record<string, string | number> } = fall.erwartet;
    assert.ok(erwartet.schluessel in MESSAGES, fall.name);
    assert.doesNotThrow(() => messageText(erwartet.schluessel, erwartet.werte), fall.name);
  }
});
