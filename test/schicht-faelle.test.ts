import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EUR_DENOMINATIONS, parseCentsAllowZero, sumDenominations } from '../src/pos/index.js';

/*
 * Die Helfer der Schicht gegen die gemeinsamen Faelle (fixtures/shift-cases.json),
 * die der Dart-Zwilling ebenso abspielt: Stueckelung summieren und einen
 * eingetippten Betrag lesen, beides ohne Gleitkomma und ohne Raten.
 */

type Faelle = {
  sumDenominations: Array<{ denominations: unknown; expected: number | null }>;
  parseCentsAllowZero: Array<{ text: string; expected: number | null }>;
};
const FAELLE = JSON.parse(readFileSync(new URL('../../fixtures/shift-cases.json', import.meta.url), 'utf8')) as Faelle;

test('sumDenominations: die gemeinsamen Faelle', () => {
  assert.ok(FAELLE.sumDenominations.length >= 15);
  for (const { denominations, expected } of FAELLE.sumDenominations) {
    assert.equal(sumDenominations(denominations as never), expected, JSON.stringify(denominations));
  }
});

test('sumDenominations: Zahlen als Schluessel gelten wie ihr Text, jede Euro-Stueckelung zaehlt', () => {
  assert.equal(sumDenominations({ 2000: 1, 500: 3 }), 3500);
  const alle = Object.fromEntries(EUR_DENOMINATIONS.map((w) => [String(w), 1]));
  assert.equal(sumDenominations(alle), 88888);
});

test('parseCentsAllowZero: die gemeinsamen Faelle', () => {
  assert.ok(FAELLE.parseCentsAllowZero.length >= 25);
  for (const { text, expected } of FAELLE.parseCentsAllowZero) {
    assert.equal(parseCentsAllowZero(text), expected, JSON.stringify(text));
  }
  // Kein Text ergibt null statt eines Wurfs.
  assert.equal(parseCentsAllowZero(undefined as never), null);
  assert.equal(parseCentsAllowZero(12 as never), null);
});

test('Faelle-Datei: jede Zeile hat genau ihre Felder', () => {
  assert.deepEqual(Object.keys(FAELLE), ['_note', 'sumDenominations', 'parseCentsAllowZero']);
  for (const f of FAELLE.sumDenominations) assert.deepEqual(Object.keys(f), ['denominations', 'expected']);
  for (const f of FAELLE.parseCentsAllowZero) assert.deepEqual(Object.keys(f), ['text', 'expected']);
});
