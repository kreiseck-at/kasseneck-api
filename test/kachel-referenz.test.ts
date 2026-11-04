import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  checkReference, isDigitsOnlyPattern, isValidReferencePattern, referenceLineName, fromReferencePayload,
  REFERENCE_PATTERN_TEMPLATES, fromPosArticlePayload, isBookableArticle, tilePrompts, type PosReference,
} from '../src/pos/index.js';
import { fromStoredArticle } from '../src/stored/index.js';

interface Faelle {
  patterns: { pattern: string; valid: boolean; digitsOnly: boolean }[];
  inputs: { name: string; reference: Pick<PosReference, 'mode' | 'pattern' | 'patternStrict'> | null; input: string; result: string; value: string }[];
  lineNames: { articleName: string; value: string; lineName: string }[];
}
const faelle = JSON.parse(readFileSync(new URL('../../fixtures/reference-cases.json', import.meta.url), 'utf8')) as Faelle;

test('Pruefaelle: Muster gueltig und Ziffernfeld', () => {
  for (const f of faelle.patterns) {
    assert.equal(isValidReferencePattern(f.pattern), f.valid, f.pattern);
    assert.equal(isDigitsOnlyPattern(f.pattern), f.digitsOnly, f.pattern);
  }
});

test('Pruefaelle: Eingabe pruefen', () => {
  for (const f of faelle.inputs) assert.deepEqual(checkReference(f.input, f.reference), { result: f.result, value: f.value }, f.name);
});

test('Pruefaelle: Positionsname', () => {
  for (const f of faelle.lineNames) assert.equal(referenceLineName(f.articleName, f.value), f.lineName);
});

test('Vorlagen sind gueltige Muster', () => {
  for (const v of REFERENCE_PATTERN_TEMPLATES) assert.equal(isValidReferencePattern(v.pattern), true, v.key);
});

test('Leser: reference und askPrice vom Draht', () => {
  const a = fromPosArticlePayload({
    id: 'a', name: 'Honorarnote', unitPriceCents: null, askPrice: true,
    reference: { mode: 'required', label: 'Honorarnote Nr.', hint: 'z. B. 2026/0123', pattern: '\\d+', patternStrict: true },
  });
  assert.equal(a.askPrice, true);
  assert.deepEqual(a.reference, { mode: 'required', label: 'Honorarnote Nr.', hint: 'z. B. 2026/0123', pattern: '\\d+', patternStrict: true });
  assert.equal(isBookableArticle(a), true);
  assert.deepEqual(tilePrompts(a), { amount: true, reference: true, quantity: false });
  const alt = fromPosArticlePayload({ id: 'b', name: 'Semmel', unitPriceCents: null });
  assert.equal(alt.askPrice, false);
  assert.equal(alt.reference, null);
  assert.equal(isBookableArticle(alt), false);
  assert.equal(isBookableArticle({ unitPriceCents: 0, askPrice: false }), true);
});

test('Leser: unbrauchbare reference wird null, patternStrict ohne Muster false', () => {
  assert.equal(fromReferencePayload({ mode: 'immer', label: 'x' }), null);
  assert.equal(fromReferencePayload({ mode: 'optional', label: '' }), null);
  assert.equal(fromReferencePayload('x'), null);
  assert.deepEqual(fromReferencePayload({ mode: 'optional', label: 'Nr.', patternStrict: true }), { mode: 'optional', label: 'Nr.', hint: null, pattern: null, patternStrict: false });
});

test('Gespeichertes Dokument: preisFragen und referenz wie am Kassenweg', () => {
  const a = fromStoredArticle('art', {
    name: 'Honorarnote', unitPriceCents: null, vatRate: 20, active: true, preisFragen: true,
    referenz: { stufe: 'fragen', bezeichnung: 'Nr.', hinweis: null, muster: null, musterStreng: false },
  });
  assert.equal(a.askPrice, true);
  assert.deepEqual(a.reference, { mode: 'optional', label: 'Nr.', hint: null, pattern: null, patternStrict: false });
});
